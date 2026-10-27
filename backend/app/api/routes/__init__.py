from fastapi import APIRouter
from app.api.routes.stp_operation import router as  stp_operation
from app.api.routes.holistic import router as holistic
from app.api.routes.assivardash import router as assivardash

# mounted under /api
app_router = APIRouter()

app_router.include_router(
    stp_operation,
    prefix="/stp_operation",
    tags=["Stp operations"]
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
