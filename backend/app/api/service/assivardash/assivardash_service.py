from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import timezone
from app.api.exception.exceptions import JsonError
from app.api.schema.assivardash_schema import (
    RiverIn, RiverPatch, River_WorkflowPhaseIn, River_WorkflowPhasePatch,
    River_InterventionIn, River_InterventionPatch, UpdateStatusIn, AssignIn, RiverOut,
)
from app.database.crud.assivardash_crud import River_crud, River_WorkflowPhase_crud, River_Intervention_crud, Fund_Department_crud
from app.database.models.model_assivardash import PHASE_ORDER, STATUS_CHOICES, utc_now

# request field name -> model column name
_FK_FIELDS = {'intervention': 'intervention_id', 'action': 'action_id'}


def _to_columns(data: dict) -> dict:
    return {_FK_FIELDS.get(k, k): v for k, v in data.items()}


def _aware(value):
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _commit(crud, obj):
    try:
        return crud.commit(obj)
    except IntegrityError as e:
        crud.db.rollback()
        raise JsonError(400, detail=str(e.orig))


def _update(crud, id: int, data: dict):
    obj = crud.get(id)
    for key, value in _to_columns(data).items():
        setattr(obj, key, value)
    return _commit(crud, obj)


class River_service:

    def list(db: Session):
        return River_crud(db).get_all()

    def get(db: Session, id: int):
        River_crud(db).get(id)
        return River_crud(db).get_tree(id)

    def create(db: Session, payload: RiverIn):
        crud = River_crud(db)
        obj = crud.Model(**payload.model_dump())
        db.add(obj)
        return _commit(crud, obj)

    def update(db: Session, id: int, payload: RiverIn | RiverPatch, partial: bool = False):
        return _update(River_crud(db), id, payload.model_dump(exclude_unset=partial))

    def delete(db: Session, id: int):
        return River_crud(db).delete(id)


class River_WorkflowPhase_service:

    def list(db: Session):
        return River_WorkflowPhase_crud(db).get_all()

    def get(db: Session, id: int):
        return River_WorkflowPhase_crud(db).get(id)

    def create(db: Session, payload: River_WorkflowPhaseIn):
        crud = River_WorkflowPhase_crud(db)
        obj = crud.Model(**_to_columns(payload.model_dump()))
        db.add(obj)
        return _commit(crud, obj)

    def update(db: Session, id: int, payload: River_WorkflowPhaseIn | River_WorkflowPhasePatch, partial: bool = False):
        return _update(River_WorkflowPhase_crud(db), id, payload.model_dump(exclude_unset=partial))

    def delete(db: Session, id: int):
        return River_WorkflowPhase_crud(db).delete(id)

    def update_status(db: Session, id: int, payload: UpdateStatusIn):
        crud = River_WorkflowPhase_crud(db)
        phase = crud.get(id)
        new_status = payload.status

        if new_status not in STATUS_CHOICES:
            raise JsonError(400, error='Invalid status')

        if phase.is_locked:
            raise JsonError(400, error='This phase is locked. Complete previous phases first.')

        if new_status == 'in-progress':
            if not payload.deadline:
                raise JsonError(400, error='Deadline required')
            phase.deadline = _aware(payload.deadline)
            phase.commenced = utc_now()

        elif new_status == 'completed':
            phase.completed = utc_now()

            # Create next phase workflow if it doesn't exist
            current_index = PHASE_ORDER.index(phase.phase)
            if current_index < len(PHASE_ORDER) - 1:
                next_phase = PHASE_ORDER[current_index + 1]
                if crud.get_by_phase(phase.intervention_id, next_phase) is None:
                    db.add(crud.Model(intervention_id=phase.intervention_id, phase=next_phase, status='pending'))

        phase.status = new_status
        return crud.commit(phase)

    def delayed(db: Session):
        now = utc_now()
        delayed_interventions = {}

        for workflow in River_WorkflowPhase_crud(db).get_delayed(now):
            intervention = workflow.intervention

            if intervention.id not in delayed_interventions:
                fund_dept = intervention.fund_department
                delayed_interventions[intervention.id] = {
                    'id': f'delay-{intervention.id}',
                    'interventionId': intervention.id,
                    'interventionName': intervention.name,
                    'location': intervention.action.location.name,
                    'action': intervention.action.name,
                    'river': intervention.action.location.river.name,
                    'department': (fund_dept.department_name if fund_dept else None) or "Not Assigned",
                    'fundScheme': (fund_dept.fund_scheme_name if fund_dept else None) or "Not Assigned",
                    'delayedPhases': []
                }

            ref_date = workflow.completed if workflow.completed else now
            days_delayed = (ref_date - workflow.deadline).days if workflow.deadline else 0

            delayed_interventions[intervention.id]['delayedPhases'].append({
                'phase': workflow.phase,
                'deadline': workflow.deadline,
                'completedAt': workflow.completed,
                'daysDelayed': days_delayed,
                'status': workflow.status
            })

        return list(delayed_interventions.values())

    def dashboard_data(db: Session, river_id: str | None):
        if not river_id:
            raise JsonError(400, error='river_id parameter required')
        try:
            river = River_crud(db).get_tree(int(river_id))
        except ValueError:
            river = None
        if river is None:
            raise JsonError(404, error='River not found')

        workflow_counts = {phase: {status: 0 for status in STATUS_CHOICES} for phase in PHASE_ORDER}
        for location in river.locations:
            for action in location.actions:
                for intervention in action.interventions:
                    for workflow in intervention.workflows:
                        workflow_counts[workflow.phase][workflow.status] += 1

        data = RiverOut.model_validate(river).model_dump()
        data['workflow_counts'] = workflow_counts
        return data


class River_Intervention_service:

    def list(db: Session):
        return River_Intervention_crud(db).get_all()

    def get(db: Session, id: int):
        return River_Intervention_crud(db).get(id)

    def create(db: Session, payload: River_InterventionIn):
        crud = River_Intervention_crud(db)
        obj = crud.Model(**_to_columns(payload.model_dump()))
        db.add(obj)
        return _commit(crud, obj)

    def update(db: Session, id: int, payload: River_InterventionIn | River_InterventionPatch, partial: bool = False):
        return _update(River_Intervention_crud(db), id, payload.model_dump(exclude_unset=partial))

    def delete(db: Session, id: int):
        return River_Intervention_crud(db).delete(id)

    def assign(db: Session, id: int, payload: AssignIn):
        """Assign department and fund scheme to intervention"""
        intervention = River_Intervention_crud(db).get(id)
        if not payload.department_name or not payload.fund_scheme_name:
            raise JsonError(400, error='Both department_name and fund_scheme_name are required')

        try:
            fund_crud = Fund_Department_crud(db)
            fund_dept = fund_crud.get_by_intervention(intervention.id)
            if fund_dept is None:
                fund_dept = fund_crud.Model(intervention_id=intervention.id)
                db.add(fund_dept)
            fund_dept.department_name = payload.department_name
            fund_dept.fund_scheme_name = payload.fund_scheme_name
            fund_crud.commit(fund_dept)
        except Exception as e:
            db.rollback()
            raise JsonError(500, success=False, error=str(e))

        return {
            'success': True,
            'message': 'Assignment saved successfully',
            'fund_department': {
                'department_name': fund_dept.department_name,
                'fund_scheme_name': fund_dept.fund_scheme_name,
                'is_fully_assigned': fund_dept.is_fully_assigned
            }
        }

    def reset(db: Session, id: int):
        crud = River_Intervention_crud(db)
        intervention = crud.get(id)
        for workflow in intervention.workflows:
            workflow.status = 'pending'
            workflow.commenced = None
            workflow.deadline = None
            workflow.completed = None
        return crud.commit(intervention)
