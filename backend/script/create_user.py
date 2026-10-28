"""
Add or update a login. There is no registration page; accounts are created here.

Inside the backend container:
    docker compose exec backend python script/create_user.py --email admin@example.com --role superuser
    docker compose exec backend python script/create_user.py --email user@example.com --name "Field User"

The password is prompted for unless --password is given. Running it again for an
existing email updates the password / role / name.

Other actions:
    --sync-csv                  add/update every account in media/user/users.csv
                                (also done automatically when the backend starts)
    --list                      show all accounts
    --disable / --enable        block or re-allow login for --email
"""
import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database.config.session import SessionLocal  # noqa: E402
from app.database.models import User  # noqa: E402
from app.database.models.model_user import ROLES, ROLE_USER  # noqa: E402
from app.api.service.auth.auth_service import hash_password  # noqa: E402
from app.api.service.auth.user_sync import sync_users_from_csv  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email")
    parser.add_argument("--password")
    parser.add_argument("--name")
    parser.add_argument("--role", choices=ROLES)
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--sync-csv", action="store_true")
    parser.add_argument("--disable", action="store_true")
    parser.add_argument("--enable", action="store_true")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.sync_csv:
            result = sync_users_from_csv(db)
            if result.get("missing"):
                sys.exit(f"{result['file']} not found")
            print(f"created: {', '.join(result['created']) or '-'}")
            print(f"updated: {', '.join(result['updated']) or '-'}")
            for err in result["errors"]:
                print(f"error: {err}")
            return
        if args.list:
            for u in db.query(User).order_by(User.id):
                print(f"{u.id:>4}  {u.email:<40} {u.role:<10} {'active' if u.is_active else 'disabled'}")
            return
        if not args.email:
            parser.error("--email is required")

        email = args.email.strip().lower()
        user = db.query(User).filter(User.email == email).first()

        if args.disable or args.enable:
            if user is None:
                sys.exit(f"No account for {email}")
            user.is_active = args.enable
            db.commit()
            print(f"{email} {'enabled' if args.enable else 'disabled'}")
            return

        password = args.password or getpass.getpass(f"Password for {email}: ")
        if len(password) < 8:
            sys.exit("Password must be at least 8 characters")

        if user is None:
            user = User(email=email, role=args.role or ROLE_USER, is_active=True)
            db.add(user)
            action = "created"
        else:
            action = "updated"
            if args.role:
                user.role = args.role
        user.hashed_password = hash_password(password)
        if args.name:
            user.full_name = args.name
        db.commit()
        print(f"{action} {email} ({user.role})")
    finally:
        db.close()


if __name__ == "__main__":
    main()
