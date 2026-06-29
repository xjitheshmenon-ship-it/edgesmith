from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.models.factory import FactoryLocation, Workstation, StorageLocation, WorkstationCategory
from app.auth import require_admin, get_current_user

router = APIRouter(prefix="/api/factory", tags=["factory"])


# ── Factory Locations ──────────────────────────────────────────────────────────

@router.get("/locations")
def list_locations(db: Session = Depends(get_db), _=Depends(get_current_user)):
    locs = db.query(FactoryLocation).filter(FactoryLocation.is_active == True).all()
    return [{"id": l.id, "code": l.code, "name": l.name} for l in locs]


class LocationCreate(BaseModel):
    code: str
    name: str


class LocationUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None


@router.patch("/locations/{loc_id}")
def update_location(loc_id: int, body: LocationUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    loc = db.query(FactoryLocation).filter(FactoryLocation.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(loc, field, value)
    db.commit()
    db.refresh(loc)
    return {"id": loc.id, "code": loc.code, "name": loc.name}


@router.post("/locations", status_code=201)
def create_location(body: LocationCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    loc = FactoryLocation(code=body.code, name=body.name)
    db.add(loc)
    db.commit()
    db.refresh(loc)
    return {"id": loc.id, "code": loc.code, "name": loc.name}


# ── Workstations ───────────────────────────────────────────────────────────────

def ws_out(w: Workstation) -> dict:
    return {
        "id": w.id, "code": w.code, "name": w.name,
        "category": w.category, "is_active": w.is_active,
        "factory_location_id": w.factory_location_id,
    }


@router.get("/workstations")
def list_workstations(location_id: Optional[int] = None, db: Session = Depends(get_db), _=Depends(get_current_user)):
    q = db.query(Workstation).filter(Workstation.is_active == True)
    if location_id:
        q = q.filter(
            (Workstation.factory_location_id == location_id) | (Workstation.factory_location_id == None)
        )
    return [ws_out(w) for w in q.all()]


class WorkstationCreate(BaseModel):
    code: str
    name: str
    category: WorkstationCategory = WorkstationCategory.other
    factory_location_id: Optional[int] = None


class WorkstationUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[WorkstationCategory] = None
    factory_location_id: Optional[int] = None
    is_active: Optional[bool] = None


@router.post("/workstations", status_code=201)
def create_workstation(body: WorkstationCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    ws = Workstation(**body.model_dump())
    db.add(ws)
    db.commit()
    db.refresh(ws)
    return ws_out(ws)


@router.patch("/workstations/{ws_id}")
def update_workstation(ws_id: int, body: WorkstationUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    ws = db.query(Workstation).filter(Workstation.id == ws_id).first()
    if not ws:
        raise HTTPException(status_code=404, detail="Workstation not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(ws, field, value)
    db.commit()
    db.refresh(ws)
    return ws_out(ws)


# ── Storage Locations ──────────────────────────────────────────────────────────

@router.get("/storage")
def list_storage(db: Session = Depends(get_db), _=Depends(get_current_user)):
    locs = db.query(StorageLocation).filter(StorageLocation.is_active == True).all()
    return [{"id": l.id, "code": l.code, "name": l.name, "factory_location_id": l.factory_location_id} for l in locs]


class StorageCreate(BaseModel):
    code: str
    name: Optional[str] = None
    factory_location_id: Optional[int] = None


@router.post("/storage", status_code=201)
def create_storage(body: StorageCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    s = StorageLocation(**body.model_dump())
    db.add(s)
    db.commit()
    db.refresh(s)
    return {"id": s.id, "code": s.code, "name": s.name, "factory_location_id": s.factory_location_id}
