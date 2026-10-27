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


from app.conf.logging import logger

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting application...")

    await async_redis_manager.initialize()
    logger.info("Redis ready")

    logger.info("Redis listener ready for websockets")
    
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
    allow_origins=["http://localhost:3000","http://172.168.32.60:3000",Settings().DOMAIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Coverage", "X-Zone-Field", "X-Selected-Zones", "X-Matched-Criteria"],
)


@app.exception_handler(JsonError)
async def json_error_handler(request: Request, exc: JsonError):
    return JSONResponse(status_code=exc.status_code, content=exc.content)



app.include_router(app_router, prefix="/api")
app.include_router(root_router)
