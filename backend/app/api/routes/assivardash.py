from fastapi import APIRouter, status, Response
from typing import Optional
from app.database.config.dependency import db_dependency
from app.api.schema.assivardash_schema import (
    RiverOut, RiverIn, RiverPatch,
    River_WorkflowPhaseOut, River_WorkflowPhaseIn, River_WorkflowPhasePatch, UpdateStatusIn,
    River_InterventionOut, River_InterventionIn, River_InterventionPatch, AssignIn,
)
from app.api.service.assivardash.assivardash_service import River_service, River_WorkflowPhase_service, River_Intervention_service

router = APIRouter()


# ---------------- rivers ----------------
@router.get("/rivers/", response_model=list[RiverOut])
def list_rivers(db: db_dependency):
    return River_service.list(db)

@router.post("/rivers/", status_code=status.HTTP_201_CREATED, response_model=RiverOut)
def create_river(db: db_dependency, payload: RiverIn):
    return River_service.create(db, payload)

@router.get("/rivers/{id}/", response_model=RiverOut)
def get_river(db: db_dependency, id: int):
    return River_service.get(db, id)

@router.put("/rivers/{id}/", response_model=RiverOut)
def update_river(db: db_dependency, id: int, payload: RiverIn):
    return River_service.update(db, id, payload)

@router.patch("/rivers/{id}/", response_model=RiverOut)
def partial_update_river(db: db_dependency, id: int, payload: RiverPatch):
    return River_service.update(db, id, payload, partial=True)

@router.delete("/rivers/{id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_river(db: db_dependency, id: int):
    River_service.delete(db, id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------- river workflows ----------------
@router.get("/river_workflows/delayed/")
def delayed_workflows(db: db_dependency):
    """Interventions with phases past their deadline, grouped by intervention"""
    return River_WorkflowPhase_service.delayed(db)

@router.get("/river_workflows/dashboard_data/")
def dashboard_data(db: db_dependency, river_id: Optional[str] = None):
    """Get complete dashboard data for a river"""
    return River_WorkflowPhase_service.dashboard_data(db, river_id)

@router.get("/river_workflows/", response_model=list[River_WorkflowPhaseOut])
def list_workflows(db: db_dependency):
    return River_WorkflowPhase_service.list(db)

@router.post("/river_workflows/", status_code=status.HTTP_201_CREATED, response_model=River_WorkflowPhaseOut)
def create_workflow(db: db_dependency, payload: River_WorkflowPhaseIn):
    return River_WorkflowPhase_service.create(db, payload)

@router.get("/river_workflows/{id}/", response_model=River_WorkflowPhaseOut)
def get_workflow(db: db_dependency, id: int):
    return River_WorkflowPhase_service.get(db, id)

@router.put("/river_workflows/{id}/", response_model=River_WorkflowPhaseOut)
def update_workflow(db: db_dependency, id: int, payload: River_WorkflowPhaseIn):
    return River_WorkflowPhase_service.update(db, id, payload)

@router.patch("/river_workflows/{id}/", response_model=River_WorkflowPhaseOut)
def partial_update_workflow(db: db_dependency, id: int, payload: River_WorkflowPhasePatch):
    return River_WorkflowPhase_service.update(db, id, payload, partial=True)

@router.delete("/river_workflows/{id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow(db: db_dependency, id: int):
    River_WorkflowPhase_service.delete(db, id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@router.post("/river_workflows/{id}/update_status/", response_model=River_WorkflowPhaseOut)
def update_workflow_status(db: db_dependency, id: int, payload: UpdateStatusIn):
    return River_WorkflowPhase_service.update_status(db, id, payload)


# ---------------- river interventions ----------------
@router.get("/river_interventions/", response_model=list[River_InterventionOut])
def list_interventions(db: db_dependency):
    return River_Intervention_service.list(db)

@router.post("/river_interventions/", status_code=status.HTTP_201_CREATED, response_model=River_InterventionOut)
def create_intervention(db: db_dependency, payload: River_InterventionIn):
    return River_Intervention_service.create(db, payload)

@router.get("/river_interventions/{id}/", response_model=River_InterventionOut)
def get_intervention(db: db_dependency, id: int):
    return River_Intervention_service.get(db, id)

@router.put("/river_interventions/{id}/", response_model=River_InterventionOut)
def update_intervention(db: db_dependency, id: int, payload: River_InterventionIn):
    return River_Intervention_service.update(db, id, payload)

@router.patch("/river_interventions/{id}/", response_model=River_InterventionOut)
def partial_update_intervention(db: db_dependency, id: int, payload: River_InterventionPatch):
    return River_Intervention_service.update(db, id, payload, partial=True)

@router.delete("/river_interventions/{id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_intervention(db: db_dependency, id: int):
    River_Intervention_service.delete(db, id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@router.post("/river_interventions/{id}/assign/")
def assign_intervention(db: db_dependency, id: int, payload: AssignIn):
    """Assign department and fund scheme to intervention"""
    return River_Intervention_service.assign(db, id, payload)

@router.post("/river_interventions/{id}/reset/", response_model=River_InterventionOut)
def reset_intervention(db: db_dependency, id: int):
    return River_Intervention_service.reset(db, id)
