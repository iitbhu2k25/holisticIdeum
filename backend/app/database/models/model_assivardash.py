from app.database.models.base import PlainBase
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import BigInteger, String, Text, DateTime, ForeignKey, UniqueConstraint
from datetime import datetime, timezone
from typing import List, Optional

PHASE_ORDER = ['techReport', 'dpr', 'workAwarded', 'finished']
STATUS_CHOICES = ['pending', 'in-progress', 'completed']


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class River(PlainBase):
    __tablename__ = 'assivardash_river'
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    image: Mapped[str] = mapped_column(String(255), nullable=False, default='')
    description: Mapped[str] = mapped_column(Text, nullable=False, default='')
    locations: Mapped[List["River_Location"]] = relationship(
        back_populates="river", cascade="all, delete-orphan", order_by="River_Location.id")


class River_Location(PlainBase):
    __tablename__ = 'assivardash_river_location'
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    river_id: Mapped[int] = mapped_column(BigInteger, ForeignKey('assivardash_river.id'), index=True, nullable=False)
    river: Mapped["River"] = relationship(back_populates="locations")
    actions: Mapped[List["River_Action"]] = relationship(
        back_populates="location", cascade="all, delete-orphan", order_by="River_Action.id")


class River_Action(PlainBase):
    __tablename__ = 'assivardash_river_action'
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    icon: Mapped[str] = mapped_column(String(10), nullable=False, default='')
    color: Mapped[str] = mapped_column(String(20), nullable=False, default='')
    location_id: Mapped[int] = mapped_column(BigInteger, ForeignKey('assivardash_river_location.id'), index=True, nullable=False)
    location: Mapped["River_Location"] = relationship(back_populates="actions")
    interventions: Mapped[List["River_Intervention"]] = relationship(
        back_populates="action", cascade="all, delete-orphan", order_by="River_Intervention.id")


class River_Intervention(PlainBase):
    __tablename__ = 'assivardash_river_intervention'
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    action_id: Mapped[int] = mapped_column(BigInteger, ForeignKey('assivardash_river_action.id'), index=True, nullable=False)
    action: Mapped["River_Action"] = relationship(back_populates="interventions")
    workflows: Mapped[List["River_WorkflowPhase"]] = relationship(
        back_populates="intervention", cascade="all, delete-orphan", order_by="River_WorkflowPhase.id")
    fund_department: Mapped[Optional["Fund_Department"]] = relationship(
        back_populates="intervention", cascade="all, delete-orphan", uselist=False)


class River_WorkflowPhase(PlainBase):
    __tablename__ = 'assivardash_river_workflowphase'
    __table_args__ = (UniqueConstraint('intervention_id', 'phase'),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    phase: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default='pending')
    commenced: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    deadline: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    intervention_id: Mapped[int] = mapped_column(BigInteger, ForeignKey('assivardash_river_intervention.id'), index=True, nullable=False)
    intervention: Mapped["River_Intervention"] = relationship(back_populates="workflows")

    @property
    def is_locked(self) -> bool:
        """A phase is locked until the previous phase is completed (techReport is never locked)."""
        current_index = PHASE_ORDER.index(self.phase)
        if current_index == 0:
            return False
        previous_phase = PHASE_ORDER[current_index - 1]
        previous = next((w for w in self.intervention.workflows if w.phase == previous_phase), None)
        if previous is None:
            return True
        return previous.status != 'completed'


class Fund_Department(PlainBase):
    __tablename__ = 'assivardash_fund_department'
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    department_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    fund_scheme_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)
    intervention_id: Mapped[int] = mapped_column(BigInteger, ForeignKey('assivardash_river_intervention.id'), unique=True, nullable=False)
    intervention: Mapped["River_Intervention"] = relationship(back_populates="fund_department")

    @property
    def is_fully_assigned(self) -> bool:
        return bool(self.department_name and self.fund_scheme_name)

    @property
    def is_partially_assigned(self) -> bool:
        return bool(self.department_name) != bool(self.fund_scheme_name)
