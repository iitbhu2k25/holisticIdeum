import json
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, Query, Response, UploadFile, status

from app.api.exception.exceptions import JsonError
from app.api.schema.dataset_schema import DatasetClipRequest, DatasetPatch
from app.api.service.auth.auth_service import optional_user_dependency, superuser_dependency
from app.api.service.datasets.dataset_service import Dataset_service, dataset_out
from app.database.config.dependency import db_dependency

# Browsing, map loading and clipping are public; only changing data needs a superuser.
router = APIRouter()


@router.get("/categories")
def categories():
    return Dataset_service.categories()

@router.get("")
def list_datasets(
    db: db_dependency,
    user: optional_user_dependency,
    category: Optional[str] = None,
    criterion: Optional[str] = None,
    kind: Optional[str] = None,
):
    return Dataset_service.list(db, user, category, criterion, kind)

@router.post("/upload", status_code=status.HTTP_202_ACCEPTED)
def upload_dataset(
    db: db_dependency,
    user: superuser_dependency,
    background: BackgroundTasks,
    file: UploadFile = File(...),
    category: str = Form(...),
    criterion: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
    join_field: Optional[str] = Form(None),
):
    """Accepts up to 1 GB; the file is streamed to disk, checked for duplicates, then processed in the background."""
    ds = Dataset_service.upload(db, user, file, category, criterion, title, join_field)
    background.add_task(Dataset_service.process, ds.id)
    return dataset_out(ds)

@router.get("/{dataset_id}")
def get_dataset(db: db_dependency, dataset_id: int):
    return Dataset_service.get(db, dataset_id)

@router.patch("/{dataset_id}")
def update_dataset(db: db_dependency, user: superuser_dependency, dataset_id: int, payload: DatasetPatch):
    return Dataset_service.update(db, dataset_id, payload.model_dump(exclude_unset=True))

@router.post("/{dataset_id}/retry", status_code=status.HTTP_202_ACCEPTED)
def retry_dataset(db: db_dependency, user: superuser_dependency, background: BackgroundTasks, dataset_id: int):
    ds = Dataset_service.retry(db, dataset_id)
    background.add_task(Dataset_service.process, ds.id)
    return dataset_out(ds)

@router.delete("/{dataset_id}")
def delete_dataset(db: db_dependency, user: superuser_dependency, dataset_id: int):
    return Dataset_service.delete(db, dataset_id)

@router.get("/{dataset_id}/features")
def dataset_features(
    db: db_dependency,
    dataset_id: int,
    bbox: str = Query(..., description="minx,miny,maxx,maxy in EPSG:4326"),
    zoom: float = 10,
    limit: int = 2000,
):
    try:
        minx, miny, maxx, maxy = (float(v) for v in bbox.split(","))
    except ValueError:
        raise JsonError(400, detail="bbox must be minx,miny,maxx,maxy")
    return Dataset_service.features(db, dataset_id, (minx, miny, maxx, maxy), zoom, limit)

@router.get("/{dataset_id}/rows")
def dataset_rows(db: db_dependency, dataset_id: int, offset: int = 0, limit: int = 100):
    return Dataset_service.rows(db, dataset_id, max(0, offset), limit)

@router.post("/{dataset_id}/clip")
def clip_dataset(db: db_dependency, dataset_id: int, payload: DatasetClipRequest):
    result = Dataset_service.clip(db, dataset_id, payload.selected_zones or None, payload.polygon)
    if isinstance(result, tuple):
        content, stats = result
        return Response(
            content=content,
            media_type="image/tiff",
            headers={
                "Content-Disposition": f'inline; filename="dataset_{dataset_id}_clip.tif"',
                "X-Stats": json.dumps(stats),
            },
        )
    return result
