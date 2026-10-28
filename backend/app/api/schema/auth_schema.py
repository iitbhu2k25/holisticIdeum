from typing import Literal
from pydantic import BaseModel


class LoginRequest(BaseModel):
    email: str
    password: str
    # which sign-in page was used: superusers sign in on the admin page, everyone else on the user page
    portal: Literal["user", "admin"] = "user"


class RefreshRequest(BaseModel):
    refresh_token: str
