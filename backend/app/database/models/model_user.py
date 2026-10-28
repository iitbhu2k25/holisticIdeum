from app.database.models.base import Base
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Boolean, DateTime, Integer, LargeBinary, ForeignKey, JSON, UniqueConstraint
from datetime import datetime
from typing import List, Optional

ROLE_SUPERUSER = "superuser"
ROLE_USER = "user"
ROLES = (ROLE_SUPERUSER, ROLE_USER)


class User(Base):
    """Accounts are created by hand (script/create_user.py); there is no self-registration."""
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default=ROLE_USER)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    sessions: Mapped[List["User_Session"]] = relationship(back_populates="user", cascade="all, delete-orphan")

    @property
    def is_superuser(self) -> bool:
        return self.role == ROLE_SUPERUSER


class User_Session(Base):
    """One saved split workspace. The whole client state is kept as zlib-compressed JSON bytes."""
    __tablename__ = "user_sessions"
    __table_args__ = (UniqueConstraint("user_id", "session_key", name="uq_user_sessions_user_key"),)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    session_key: Mapped[str] = mapped_column(String(100), nullable=False)
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    module: Mapped[str] = mapped_column(String(30), nullable=False, default="split")
    summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    state: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    state_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_activity_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now, index=True)

    user: Mapped["User"] = relationship(back_populates="sessions")


class User_Phase_Raster(Base):
    """Weighted phase raster a user generated in /holistic, read back by /split."""
    __tablename__ = "user_phase_rasters"
    __table_args__ = (UniqueConstraint("user_id", "stage_index", name="uq_user_phase_rasters_user_stage"),)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    stage_index: Mapped[int] = mapped_column(Integer, nullable=False)
    meta: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    tiff: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
