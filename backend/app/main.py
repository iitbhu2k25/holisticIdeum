import asyncio

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import app_router, root_router
from app.api.exception.exceptions import JsonError
from prometheus_fastapi_instrumentator import Instrumentator
from contextlib import asynccontextmanager
from app.conf.redis.redis_async_manager import async_redis_manager
from app.conf.redis.redis_conf import close_redis
from app.conf.settings import Settings
from app.database.config.dependency import celery_session
from app.api.service.datasets.dataset_service import Dataset_service
from app.api.service.auth.user_sync import sync_users_from_csv


from app.conf.logging import logger

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting application...")

    await async_redis_manager.initialize()
    logger.info("Redis ready")

    logger.info("Redis listener ready for websockets")

    with celery_session() as db:
        interrupted = Dataset_service.mark_interrupted(db)
        users = sync_users_from_csv(db)
    if users.get("missing"):
        logger.info("No %s; add logins there or with script/create_user.py", users["file"])
    else:
        logger.info("Users from CSV: created %s, updated %s", users["created"], users["updated"])
        for err in users["errors"]:
            logger.warning("users.csv %s", err)
    if interrupted:
        logger.warning("Marked %s interrupted dataset uploads as failed", interrupted)
    
    yield


    logger.info("Shutting down application...")
    await close_redis() 

app = FastAPI(
    title="Decision support system", 
    version="1.0.0",
    lifespan=lifespan
)




instrumentator = Instrumentator().instrument(app)
instrumentator.expose(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://172.168.32.60:3000",
        "https://holistic-ideum.vercel.app",
        Settings().DOMAIN,
    ],
    allow_origin_regex=r"^https://(.*\.trycloudflare\.com|.*\.vercel\.app)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Coverage", "X-Zone-Field", "X-Selected-Zones", "X-Matched-Criteria", "X-Stats"],
)


@app.exception_handler(JsonError)
async def json_error_handler(request: Request, exc: JsonError):
    return JSONResponse(status_code=exc.status_code, content=exc.content)



app.include_router(app_router, prefix="/api")
app.include_router(root_router)
