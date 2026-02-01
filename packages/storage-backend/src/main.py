from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .dependencies import init_services as init_permission_services
from .middleware.auth import AuthMiddleware
from .routes import entities, feat, graph, permissions, relations, search, sync, utils
from .services.database import (
    check_milvus,
    check_mongodb,
    check_neo4j,
    close_services,
    get_mongodb_adapter,
    init_services,
)


logger = logging.getLogger("c4a.storage-backend")
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_services()
    mongodb = await get_mongodb_adapter()
    init_permission_services(mongodb)
    yield
    await close_services()


app = FastAPI(title="C4A Storage Backend", version="0.3.0", lifespan=lifespan)
app.add_middleware(AuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration = (time.perf_counter() - start) * 1000
    logger.info(
        "%s %s -> %s %.2fms",
        request.method,
        request.url.path,
        response.status_code,
        duration,
    )
    return response


@app.exception_handler(Exception)
async def handle_exception(_request: Request, exc: Exception):
    logger.exception("Unhandled error: %s", exc)
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "mongodb": await check_mongodb(),
        "neo4j": await check_neo4j(),
        "milvus": await check_milvus(),
    }


app.include_router(entities.router, prefix="/entities", tags=["entities"])
app.include_router(relations.router, prefix="/relations", tags=["relations"])
app.include_router(search.router, prefix="/search", tags=["search"])
app.include_router(graph.router, prefix="/graph", tags=["graph"])
app.include_router(feat.router, prefix="/feat", tags=["feat"])
app.include_router(utils.router, prefix="/utils", tags=["utils"])
app.include_router(sync.router, prefix="/sync", tags=["sync"])
app.include_router(permissions.router, prefix="/permissions", tags=["permissions"])
