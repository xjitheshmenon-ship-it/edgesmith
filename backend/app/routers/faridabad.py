from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import date

from app.database import get_db
from app.auth import require_admin, require_manager, get_current_user
from app.models.faridabad import RawMaterialIntake, JoiningOperation, FaridabadDispatch, ReceivingEvent, MaterialType

router = APIRouter(prefix="/api/faridabad", tags=["faridabad"])


# ── Serializers ──────────────────────────────────────────────────────────────

def intake_out(r: RawMaterialIntake) -> dict:
    return {
        "id": r.id,
        "material_type": r.material_type,
        "supplier_name": r.supplier_name,
        "heat_number": r.heat_number,
        "steel_grade": r.steel_grade,
        "weight_kg": r.weight_kg,
        "date_received": r.date_received.isoformat() if r.date_received else None,
        "num_bars": r.num_bars,
        "bar_dimensions_mm": r.bar_dimensions_mm,
        "notes": r.notes,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def joining_out(j: JoiningOperation) -> dict:
    return {
        "id": j.id,
        "alloy_intake_id": j.alloy_intake_id,
        "alloy_heat_number": j.alloy_intake.heat_number if j.alloy_intake else None,
        "alloy_supplier": j.alloy_intake.supplier_name if j.alloy_intake else None,
        "ms_intake_id": j.ms_intake_id,
        "ms_heat_number": j.ms_intake.heat_number if j.ms_intake else None,
        "ms_supplier": j.ms_intake.supplier_name if j.ms_intake else None,
        "num_billets_produced": j.num_billets_produced,
        "output_billet_dimensions_mm": j.output_billet_dimensions_mm,
        "operator_name": j.operator_name,
        "date_joined": j.date_joined.isoformat() if j.date_joined else None,
        "notes": j.notes,
        "created_at": j.created_at.isoformat() if j.created_at else None,
    }


def dispatch_out(d: FaridabadDispatch) -> dict:
    return {
        "id": d.id,
        "batch_reference": d.batch_reference,
        "joining_operation_id": d.joining_operation_id,
        "rolling_contractor_name": d.rolling_contractor_name,
        "num_billets_dispatched": d.num_billets_dispatched,
        "date_dispatched": d.date_dispatched.isoformat() if d.date_dispatched else None,
        "billet_dimensions_mm": d.billet_dimensions_mm,
        "notes": d.notes,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "receiving_count": len(d.receiving_events),
        "total_received": sum(e.num_billets_received for e in d.receiving_events),
    }


def receiving_out(r: ReceivingEvent) -> dict:
    d = r.faridabad_dispatch
    return {
        "id": r.id,
        "faridabad_dispatch_id": r.faridabad_dispatch_id,
        "batch_reference": d.batch_reference if d else None,
        "rolling_contractor_name": d.rolling_contractor_name if d else None,
        "date_received": r.date_received.isoformat() if r.date_received else None,
        "num_billets_received": r.num_billets_received,
        "condition": r.condition,
        "received_by": r.received_by,
        "notes": r.notes,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


# ── Raw Material Intake ───────────────────────────────────────────────────────

class IntakeCreate(BaseModel):
    material_type: MaterialType
    supplier_name: str
    heat_number: str
    steel_grade: str
    weight_kg: Optional[float] = None
    date_received: date
    num_bars: Optional[int] = None
    bar_dimensions_mm: Optional[str] = None
    notes: Optional[str] = None


@router.get("/intakes")
def list_intakes(material_type: Optional[str] = None, db: Session = Depends(get_db), _=Depends(get_current_user)):
    q = db.query(RawMaterialIntake)
    if material_type:
        q = q.filter(RawMaterialIntake.material_type == material_type)
    return [intake_out(r) for r in q.order_by(RawMaterialIntake.date_received.desc()).all()]


@router.post("/intakes", status_code=201)
def create_intake(body: IntakeCreate, db: Session = Depends(get_db), user=Depends(require_manager)):
    r = RawMaterialIntake(**body.model_dump(), created_by_id=user.id)
    db.add(r)
    db.commit()
    db.refresh(r)
    return intake_out(r)


# ── Joining Operations ────────────────────────────────────────────────────────

class JoiningCreate(BaseModel):
    alloy_intake_id: int
    ms_intake_id: int
    num_billets_produced: int
    output_billet_dimensions_mm: Optional[str] = None
    operator_name: Optional[str] = None
    date_joined: date
    notes: Optional[str] = None


@router.get("/joinings")
def list_joinings(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return [joining_out(j) for j in db.query(JoiningOperation).order_by(JoiningOperation.date_joined.desc()).all()]


@router.post("/joinings", status_code=201)
def create_joining(body: JoiningCreate, db: Session = Depends(get_db), user=Depends(require_manager)):
    alloy = db.query(RawMaterialIntake).filter(
        RawMaterialIntake.id == body.alloy_intake_id,
        RawMaterialIntake.material_type == MaterialType.alloy_steel
    ).first()
    ms = db.query(RawMaterialIntake).filter(
        RawMaterialIntake.id == body.ms_intake_id,
        RawMaterialIntake.material_type == MaterialType.ms
    ).first()
    if not alloy:
        raise HTTPException(400, "Alloy steel intake not found")
    if not ms:
        raise HTTPException(400, "MS intake not found")
    j = JoiningOperation(**body.model_dump(), created_by_id=user.id)
    db.add(j)
    db.commit()
    db.refresh(j)
    return joining_out(j)


# ── Dispatch ──────────────────────────────────────────────────────────────────

class DispatchCreate(BaseModel):
    joining_operation_id: int
    rolling_contractor_name: str
    num_billets_dispatched: int
    date_dispatched: date
    billet_dimensions_mm: Optional[str] = None
    notes: Optional[str] = None


@router.get("/dispatches")
def list_dispatches(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return [dispatch_out(d) for d in db.query(FaridabadDispatch).order_by(FaridabadDispatch.date_dispatched.desc()).all()]


@router.get("/dispatches/{dispatch_id}")
def get_dispatch(dispatch_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    d = db.query(FaridabadDispatch).filter(FaridabadDispatch.id == dispatch_id).first()
    if not d:
        raise HTTPException(404, "Dispatch not found")
    return {**dispatch_out(d), "receiving_events": [receiving_out(r) for r in d.receiving_events]}


@router.post("/dispatches", status_code=201)
def create_dispatch(body: DispatchCreate, db: Session = Depends(get_db), user=Depends(require_manager)):
    import datetime
    batch_ref = f"FAR-{datetime.date.today().strftime('%Y%m%d')}-{db.query(FaridabadDispatch).count() + 1:04d}"
    d = FaridabadDispatch(**body.model_dump(), batch_reference=batch_ref, created_by_id=user.id)
    db.add(d)
    db.commit()
    db.refresh(d)
    return dispatch_out(d)


# ── Receiving Events ──────────────────────────────────────────────────────────

class ReceivingCreate(BaseModel):
    faridabad_dispatch_id: int
    date_received: date
    num_billets_received: int
    condition: Optional[str] = None
    received_by: Optional[str] = None
    notes: Optional[str] = None


@router.get("/receivings")
def list_receivings(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return [receiving_out(r) for r in db.query(ReceivingEvent).order_by(ReceivingEvent.date_received.desc()).all()]


@router.post("/receivings", status_code=201)
def create_receiving(body: ReceivingCreate, db: Session = Depends(get_db), user=Depends(require_manager)):
    d = db.query(FaridabadDispatch).filter(FaridabadDispatch.id == body.faridabad_dispatch_id).first()
    if not d:
        raise HTTPException(404, "Dispatch not found")
    r = ReceivingEvent(**body.model_dump(), created_by_id=user.id)
    db.add(r)
    db.commit()
    db.refresh(r)
    return receiving_out(r)
