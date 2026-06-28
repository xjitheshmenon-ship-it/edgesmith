from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from app.database import get_db
from app.models.cycle import CycleType, CycleVersion, CycleStep
from app.models.factory import Workstation, StorageLocation
from app.auth import require_admin, get_current_user
from app.services.cycle_service import create_new_version, export_cycle

router = APIRouter(prefix="/api/cycles", tags=["cycles"])


def step_out(s: CycleStep) -> dict:
    return {
        "id": s.id,
        "step_number": s.step_number,
        "step_order": s.step_order,
        "operation_name": s.operation_name,
        "workstation_id": s.workstation_id,
        "workstation_code": s.workstation.code if s.workstation else None,
        "workstation_name": s.workstation.name if s.workstation else None,
        "from_storage_id": s.from_storage_id,
        "from_storage_code": s.from_storage.code if s.from_storage else None,
        "to_storage_id": s.to_storage_id,
        "to_storage_code": s.to_storage.code if s.to_storage else None,
        "is_converting_step": s.is_converting_step,
        "is_child_marking_step": s.is_child_marking_step,
        "is_qc_step": s.is_qc_step,
    }


def version_out(v: CycleVersion) -> dict:
    return {
        "id": v.id,
        "version_number": v.version_number,
        "is_current": v.is_current,
        "created_at": v.created_at,
        "change_notes": v.change_notes,
        "steps": [step_out(s) for s in v.steps],
    }


def cycle_out(c: CycleType) -> dict:
    current = next((v for v in c.versions if v.is_current), None)
    return {
        "id": c.id,
        "name": c.name,
        "letter_prefix": c.letter_prefix,
        "description": c.description,
        "is_active": c.is_active,
        "is_archived": c.is_archived,
        "current_version": version_out(current) if current else None,
        "version_count": len(c.versions),
    }


@router.get("/")
def list_cycles(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return [cycle_out(c) for c in db.query(CycleType).filter(CycleType.is_archived == False).all()]


@router.get("/{cycle_id}")
def get_cycle(cycle_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    c = db.query(CycleType).filter(CycleType.id == cycle_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Cycle not found")
    return cycle_out(c)


@router.get("/{cycle_id}/versions")
def list_versions(cycle_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    versions = db.query(CycleVersion).filter(CycleVersion.cycle_type_id == cycle_id).order_by(CycleVersion.version_number.desc()).all()
    return [version_out(v) for v in versions]


class CycleCreate(BaseModel):
    name: str
    letter_prefix: str
    description: Optional[str] = None


@router.post("/", status_code=201)
def create_cycle(body: CycleCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    if db.query(CycleType).filter(CycleType.letter_prefix == body.letter_prefix).first():
        raise HTTPException(status_code=400, detail="Letter prefix already in use")
    c = CycleType(name=body.name, letter_prefix=body.letter_prefix.upper(), description=body.description)
    db.add(c)
    db.commit()
    db.refresh(c)
    return cycle_out(c)


class StepData(BaseModel):
    step_number: str
    operation_name: str
    workstation_id: int
    from_storage_id: Optional[int] = None
    to_storage_id: Optional[int] = None
    is_converting_step: bool = False
    is_child_marking_step: bool = False
    is_qc_step: bool = False


class VersionCreate(BaseModel):
    steps: List[StepData]
    change_notes: Optional[str] = None


@router.post("/{cycle_id}/versions", status_code=201)
def create_version(
    cycle_id: int,
    body: VersionCreate,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    version = create_new_version(
        db,
        cycle_type_id=cycle_id,
        steps_data=[s.model_dump() for s in body.steps],
        created_by_id=user.id,
        change_notes=body.change_notes,
    )
    return version_out(version)


@router.get("/{cycle_id}/export")
def export(cycle_id: int, version_id: Optional[int] = None, db: Session = Depends(get_db), _=Depends(get_current_user)):
    data = export_cycle(db, cycle_id, version_id)
    return JSONResponse(content=data, headers={"Content-Disposition": f'attachment; filename="cycle_{data["cycle_name"]}_v{data["version_number"]}.json"'})


class CycleImport(BaseModel):
    data: dict   # raw exported JSON
    update_existing: bool = False


@router.post("/import", status_code=201)
def import_cycle(body: CycleImport, db: Session = Depends(get_db), user=Depends(require_admin)):
    data = body.data
    cycle_name = data.get("cycle_name")
    letter_prefix = data.get("cycle_letter_prefix")
    steps_raw = data.get("steps", [])

    existing = db.query(CycleType).filter(CycleType.name == cycle_name).first()
    if existing and not body.update_existing:
        raise HTTPException(status_code=400, detail=f"Cycle '{cycle_name}' already exists. Set update_existing=true to create a new version.")

    # Resolve workstation and storage codes to IDs
    steps_data = []
    for s in steps_raw:
        ws = db.query(Workstation).filter(Workstation.code == s["workstation_code"]).first()
        from_storage = db.query(StorageLocation).filter(StorageLocation.code == s.get("from_storage_code")).first() if s.get("from_storage_code") else None
        to_storage = db.query(StorageLocation).filter(StorageLocation.code == s.get("to_storage_code")).first() if s.get("to_storage_code") else None
        steps_data.append({
            **s,
            "workstation_id": ws.id if ws else None,
            "from_storage_id": from_storage.id if from_storage else None,
            "to_storage_id": to_storage.id if to_storage else None,
        })

    if not existing:
        existing = CycleType(name=cycle_name, letter_prefix=letter_prefix, description=f"Imported from file")
        db.add(existing)
        db.flush()

    version = create_new_version(db, existing.id, steps_data, user.id, f"Imported from file")
    return {"cycle_id": existing.id, "version_id": version.id, "version_number": version.version_number}
