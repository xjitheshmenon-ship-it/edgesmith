from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from app.database import get_db
from app.models.manufacturing import ManufacturingOrder, ConversionPattern, BatchRule, MOStatus
from app.auth import require_manager, require_admin, get_current_user

router = APIRouter(prefix="/api/manufacturing", tags=["manufacturing"])


# ── Manufacturing Orders ───────────────────────────────────────────────────────

def mo_out(m: ManufacturingOrder) -> dict:
    return {
        "id": m.id, "mo_number": m.mo_number, "customer": m.customer,
        "quantity": m.quantity, "status": m.status,
        "size_id": m.size_id,
        "size_mm": m.size.value_mm if m.size else None,
        "design_id": m.design_id,
        "design_code": m.design.code if m.design else None,
        "uid_count": len(m.uids),
        "notes": m.notes,
        "created_at": m.created_at,
    }


@router.get("/orders")
def list_orders(status: Optional[MOStatus] = None, db: Session = Depends(get_db), _=Depends(get_current_user)):
    q = db.query(ManufacturingOrder)
    if status:
        q = q.filter(ManufacturingOrder.status == status)
    return [mo_out(m) for m in q.order_by(ManufacturingOrder.id.desc()).all()]


class MOCreate(BaseModel):
    mo_number: str
    customer: str
    quantity: int
    size_id: Optional[int] = None
    design_id: Optional[int] = None
    notes: Optional[str] = None


@router.post("/orders", status_code=201)
def create_order(body: MOCreate, db: Session = Depends(get_db), user=Depends(require_manager)):  # manager+ only
    if db.query(ManufacturingOrder).filter(ManufacturingOrder.mo_number == body.mo_number).first():
        raise HTTPException(status_code=400, detail="MO number already exists")
    mo = ManufacturingOrder(**body.model_dump(), created_by_id=user.id)
    db.add(mo)
    db.commit()
    db.refresh(mo)
    return mo_out(mo)


@router.get("/orders/{mo_id}/uids")
def list_mo_uids(mo_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    from app.models.uid import UID
    mo = db.query(ManufacturingOrder).filter(ManufacturingOrder.id == mo_id).first()
    if not mo:
        raise HTTPException(status_code=404, detail="MO not found")
    uids = db.query(UID).filter(UID.mo_id == mo_id).all()
    from app.routers.uid import uid_out
    return [uid_out(u) for u in uids]


@router.patch("/orders/{mo_id}/status")
def update_mo_status(mo_id: int, status: MOStatus, db: Session = Depends(get_db), _=Depends(require_manager)):  # manager+ only
    mo = db.query(ManufacturingOrder).filter(ManufacturingOrder.id == mo_id).first()
    if not mo:
        raise HTTPException(status_code=404, detail="MO not found")
    mo.status = status
    db.commit()
    return mo_out(mo)


# ── Conversion Patterns ────────────────────────────────────────────────────────

def pattern_out(p: ConversionPattern) -> dict:
    return {
        "id": p.id, "name": p.name,
        "input_length_mm": p.input_length_mm,
        "output_lengths_mm": p.output_lengths_mm,
        "kerf_mm": p.kerf_mm,
        "num_cuts": p.num_cuts,
        "scrap_mm": p.scrap_mm,
        "is_active": p.is_active,
    }


@router.get("/patterns")
def list_patterns(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return [pattern_out(p) for p in db.query(ConversionPattern).filter(ConversionPattern.is_active == True).all()]


class PatternCreate(BaseModel):
    name: str
    input_length_mm: int
    output_lengths_mm: List[int]
    kerf_mm: int = 3


@router.post("/patterns", status_code=201)
def create_pattern(body: PatternCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    scrap = body.input_length_mm - sum(body.output_lengths_mm) - ((len(body.output_lengths_mm) - 1) * body.kerf_mm)
    if scrap < 0:
        raise HTTPException(status_code=400, detail=f"Pattern results in negative scrap ({scrap}mm)")
    p = ConversionPattern(**body.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return pattern_out(p)


@router.patch("/patterns/{pattern_id}/archive")
def archive_pattern(pattern_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    p = db.query(ConversionPattern).filter(ConversionPattern.id == pattern_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Pattern not found")
    p.is_active = False
    db.commit()
    return {"archived": True}
