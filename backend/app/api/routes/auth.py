from fastapi import APIRouter
from app.database.config.dependency import db_dependency
from app.api.schema.auth_schema import LoginRequest, RefreshRequest
from app.api.service.auth.auth_service import Auth_service, current_user_dependency, user_out

router = APIRouter()


@router.post("/login")
def login(db: db_dependency, payload: LoginRequest):
    return Auth_service.login(db, payload.email, payload.password)

@router.post("/refresh")
def refresh(db: db_dependency, payload: RefreshRequest):
    return Auth_service.refresh(db, payload.refresh_token)

@router.get("/me")
def me(user: current_user_dependency):
    return user_out(user)

@router.post("/logout")
def logout(user: current_user_dependency):
    # Tokens are stateless; the client drops them.
    return {"ok": True}
