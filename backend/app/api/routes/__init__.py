from fastapi import APIRouter
from app.api.routes.stp_operation import router as  stp_operation
from app.api.routes.holistic import router as holistic
from app.api.routes.assivardash import router as assivardash
from app.api.routes.auth import router as auth
from app.api.routes.datasets import router as datasets

# mounted under /api
app_router = APIRouter()

app_router.include_router(
    stp_operation,
    prefix="/stp_operation",
    tags=["Stp operations"]
)

app_router.include_router(
    auth,
    prefix="/auth",
    tags=["Auth"]
)

app_router.include_router(
    datasets,
    prefix="/datasets",
    tags=["Datasets"]
)

# mounted at the root, keeping the URLs the frontend already uses
root_router = APIRouter()

root_router.include_router(
    holistic,
    tags=["Holistic"]
)

root_router.include_router(
    assivardash,
    prefix="/assi",
    tags=["Assi Varuna dashboard"]
)
