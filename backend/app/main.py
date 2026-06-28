"""
CPCMS — Configurable Production Cycle Management System
Edgesmith Tooling India Pvt Ltd

Implementation: Option A — Standalone Webapp
FastAPI backend, PostgreSQL database, React frontend.
Chosen over Odoo module for independent scalability (12k UIDs),
cleaner data model for cycle versioning, and easier future Odoo sync integration.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import engine, Base

# Import all models so SQLAlchemy registers them before create_all
import app.models  # noqa

from app.routers import auth, users, factory, cycle, product, uid, manufacturing, shopfloor

app = FastAPI(
    title="CPCMS — Edgesmith Tooling",
    description="Configurable Production Cycle Management System",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    from app.database import SessionLocal
    from app.seed import seed
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(factory.router)
app.include_router(cycle.router)
app.include_router(product.router)
app.include_router(uid.router)
app.include_router(manufacturing.router)
app.include_router(shopfloor.router)


@app.get("/health")
def health():
    return {"status": "ok", "app": "CPCMS"}
