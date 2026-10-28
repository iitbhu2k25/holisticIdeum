from datetime import datetime, timedelta, timezone
from typing import Annotated

import bcrypt
import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.api.exception.exceptions import JsonError
from app.conf.settings import Settings
from app.database.config.dependency import db_dependency
from app.database.models import User

settings = Settings()
bearer = HTTPBearer(auto_error=False)

ACCESS = "access"
REFRESH = "refresh"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def _token(user: User, kind: str, lifetime: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user.id), "role": user.role, "type": kind, "iat": now, "exp": now + lifetime}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def _decode(token: str, kind: str) -> dict:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise JsonError(401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise JsonError(401, detail="Invalid token")
    if payload.get("type") != kind:
        raise JsonError(401, detail="Invalid token type")
    return payload


def _active_user(db: Session, user_id) -> User:
    user = db.get(User, int(user_id))
    if user is None or not user.is_active:
        raise JsonError(401, detail="User not found or disabled")
    return user


def user_out(user: User) -> dict:
    return {"id": user.id, "email": user.email, "full_name": user.full_name, "role": user.role}


class Auth_service:

    def tokens(user: User) -> dict:
        return {
            "access_token": _token(user, ACCESS, timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)),
            "refresh_token": _token(user, REFRESH, timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)),
            "token_type": "bearer",
            "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            "user": user_out(user),
        }

    def login(db: Session, email: str, password: str, portal: str = "user") -> dict:
        user = db.query(User).filter(User.email == email.strip().lower()).first()
        if user is None or not verify_password(password, user.hashed_password):
            raise JsonError(401, detail="Email or password is incorrect")
        if not user.is_active:
            raise JsonError(403, detail="This account is disabled")
        if portal == "admin" and not user.is_superuser:
            raise JsonError(403, detail="This page is for administrators only. Use Sign in in the menu bar.")
        if portal == "user" and user.is_superuser:
            raise JsonError(403, detail="Administrator accounts sign in from the Admin link in the footer.")
        user.last_login = datetime.now()
        db.commit()
        return Auth_service.tokens(user)

    def refresh(db: Session, refresh_token: str) -> dict:
        payload = _decode(refresh_token, REFRESH)
        return Auth_service.tokens(_active_user(db, payload["sub"]))


def get_current_user(db: db_dependency, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> User:
    if credentials is None:
        raise JsonError(401, detail="Not authenticated")
    payload = _decode(credentials.credentials, ACCESS)
    return _active_user(db, payload["sub"])


def get_optional_user(db: db_dependency, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> User | None:
    """For public endpoints that behave a little differently for a signed-in user; a bad token is still an error."""
    if credentials is None:
        return None
    return get_current_user(db, credentials)


def get_superuser(user: User = Depends(get_current_user)) -> User:
    if not user.is_superuser:
        raise JsonError(403, detail="Superuser access required")
    return user


current_user_dependency = Annotated[User, Depends(get_current_user)]
optional_user_dependency = Annotated[User | None, Depends(get_optional_user)]
superuser_dependency = Annotated[User, Depends(get_superuser)]
