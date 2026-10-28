"""Load login accounts from media/user/users.csv (there is no registration page).

Columns: email,password,role,full_name,active
  role    superuser | user            (default user)
  active  yes/no, true/false, 1/0     (default yes)

Rows are added or updated by email; accounts missing from the file are left alone
(disable them with active=no). Passwords are only stored hashed in the database.
"""
import csv
from pathlib import Path

from sqlalchemy.orm import Session

from app.api.service.auth.auth_service import hash_password, verify_password
from app.api.service.holistic.geo_utils import MEDIA_DIR
from app.database.models import User
from app.database.models.model_user import ROLES, ROLE_USER

USERS_CSV = MEDIA_DIR / "user" / "users.csv"
FALSE_VALUES = {"no", "false", "0", "n", "disabled"}


def sync_users_from_csv(db: Session, path: Path = USERS_CSV) -> dict:
    if not path.exists():
        return {"file": str(path), "missing": True}

    created, updated, errors = [], [], []
    with path.open(newline="", encoding="utf-8-sig") as f:
        for line, row in enumerate(csv.DictReader(f), start=2):
            row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
            email = row.get("email", "").lower()
            password = row.get("password", "")
            role = (row.get("role") or ROLE_USER).lower()
            if not email or email.startswith("#"):
                continue
            if role not in ROLES:
                errors.append(f"line {line}: role must be one of {', '.join(ROLES)}")
                continue
            if len(password) < 8:
                errors.append(f"line {line}: password for {email} must be at least 8 characters")
                continue

            active = row.get("active", "yes").lower() not in FALSE_VALUES
            user = db.query(User).filter(User.email == email).first()
            if user is None:
                db.add(User(email=email, hashed_password=hash_password(password), role=role,
                            full_name=row.get("full_name") or None, is_active=active))
                created.append(email)
                continue

            changed = False
            if not verify_password(password, user.hashed_password):
                user.hashed_password = hash_password(password)
                changed = True
            for attr, value in (("role", role), ("is_active", active), ("full_name", row.get("full_name") or user.full_name)):
                if getattr(user, attr) != value:
                    setattr(user, attr, value)
                    changed = True
            if changed:
                updated.append(email)

    db.commit()
    return {"file": str(path), "created": created, "updated": updated, "errors": errors}
