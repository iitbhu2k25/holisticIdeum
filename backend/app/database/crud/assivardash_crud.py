from app.database.models import River, River_Location, River_Action, River_Intervention, River_WorkflowPhase, Fund_Department
from app.database.crud.base import CrudBase
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import or_, and_
from datetime import datetime


def _river_tree():
    """Eager-load the whole river -> location -> action -> intervention -> workflow/fund tree."""
    interventions = (selectinload(River.locations)
                     .selectinload(River_Location.actions)
                     .selectinload(River_Action.interventions))
    return [
        interventions.selectinload(River_Intervention.workflows),
        interventions.selectinload(River_Intervention.fund_department),
    ]


class River_crud(CrudBase):
    def __init__(self, db: Session, Model=River):
        super().__init__(db, Model)

    def get_all(self):
        return self.db.query(self.Model).options(*_river_tree()).order_by(self.Model.id).all()

    def get_tree(self, id: int):
        return self.db.query(self.Model).options(*_river_tree()).filter(self.Model.id == id).first()


class River_WorkflowPhase_crud(CrudBase):
    def __init__(self, db: Session, Model=River_WorkflowPhase):
        super().__init__(db, Model)

    def get_all(self):
        return self.db.query(self.Model).order_by(self.Model.id).all()

    def get_by_phase(self, intervention_id: int, phase: str):
        return self.db.query(self.Model).filter(
            self.Model.intervention_id == intervention_id,
            self.Model.phase == phase).first()

    def get_delayed(self, now: datetime):
        return self.db.query(self.Model).options(
            selectinload(River_WorkflowPhase.intervention)
            .selectinload(River_Intervention.action)
            .selectinload(River_Action.location)
            .selectinload(River_Location.river),
            selectinload(River_WorkflowPhase.intervention)
            .selectinload(River_Intervention.fund_department),
        ).filter(or_(
            and_(self.Model.status == 'completed', self.Model.completed > self.Model.deadline),
            and_(self.Model.status.in_(['pending', 'in-progress']), self.Model.deadline < now),
        )).order_by(self.Model.id).all()


class River_Intervention_crud(CrudBase):
    def __init__(self, db: Session, Model=River_Intervention):
        super().__init__(db, Model)

    def get_all(self):
        return self.db.query(self.Model).options(
            selectinload(River_Intervention.workflows),
            selectinload(River_Intervention.fund_department),
        ).order_by(self.Model.id).all()


class Fund_Department_crud(CrudBase):
    def __init__(self, db: Session, Model=Fund_Department):
        super().__init__(db, Model)

    def get_by_intervention(self, intervention_id: int):
        return self.db.query(self.Model).filter(self.Model.intervention_id == intervention_id).first()
