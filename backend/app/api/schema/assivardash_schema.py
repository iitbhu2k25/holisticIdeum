from pydantic import BaseModel, ConfigDict, Field
from typing import List, Optional, Literal
from datetime import datetime

Phase = Literal['techReport', 'dpr', 'workAwarded', 'finished']
Status = Literal['pending', 'in-progress', 'completed']


class Fund_DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    department_name: Optional[str] = None
    fund_scheme_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    is_fully_assigned: bool
    is_partially_assigned: bool


class River_WorkflowPhaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_locked: bool
    phase: str
    status: str
    commenced: Optional[datetime] = None
    completed: Optional[datetime] = None
    deadline: Optional[datetime] = None
    intervention: int = Field(validation_alias='intervention_id')


class River_InterventionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    workflows: List[River_WorkflowPhaseOut] = []
    fund_department: Optional[Fund_DepartmentOut] = None
    name: str
    action: int = Field(validation_alias='action_id')


class River_ActionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    interventions: List[River_InterventionOut] = []
    name: str
    icon: str
    color: str
    location: int = Field(validation_alias='location_id')


class River_LocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    actions: List[River_ActionOut] = []
    name: str
    river: int = Field(validation_alias='river_id')


class RiverOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    locations: List[River_LocationOut] = []
    name: str
    image: str
    description: str


# ---- request bodies ----

class RiverIn(BaseModel):
    name: str = Field(max_length=50)
    image: str = Field(default='', max_length=255)
    description: str = ''


class RiverPatch(BaseModel):
    name: Optional[str] = Field(default=None, max_length=50)
    image: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = None


class River_WorkflowPhaseIn(BaseModel):
    intervention: int
    phase: Phase
    status: Status = 'pending'
    commenced: Optional[datetime] = None
    completed: Optional[datetime] = None
    deadline: Optional[datetime] = None


class River_WorkflowPhasePatch(BaseModel):
    intervention: Optional[int] = None
    phase: Optional[Phase] = None
    status: Optional[Status] = None
    commenced: Optional[datetime] = None
    completed: Optional[datetime] = None
    deadline: Optional[datetime] = None


class River_InterventionIn(BaseModel):
    name: str = Field(max_length=100)
    action: int


class River_InterventionPatch(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    action: Optional[int] = None


class UpdateStatusIn(BaseModel):
    status: Optional[str] = None
    deadline: Optional[datetime] = None


class AssignIn(BaseModel):
    department_name: Optional[str] = None
    fund_scheme_name: Optional[str] = None
