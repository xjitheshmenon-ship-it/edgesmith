from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_
from pydantic import BaseModel
from typing import Optional, List
from app.database import get_db
from app.models.uid import UID, UIDStepHistory, UIDTransfer, UIDStatus, PriorityLevel
from app.models.product import DesignSizeValidity
from app.auth import require_manager, require_supervisor, require_operator, get_current_user
from app.services.uid_service import bulk_create_uids, complete_step, do_converting

router = APIRouter(prefix="/api/uids", tags=["uids"])


def uid_out(u: UID, include_history: bool = False) -> dict:
    data = {
        "id": u.id,
        "code": u.code,
        "status": u.status,
        "priority": u.priority,
        "factory_location_id": u.factory_location_id,
        "factory_location_code": u.factory_location.code if u.factory_location else None,
        "cycle_type_id": u.cycle_type_id,
        "cycle_type_name": u.cycle_type.name if u.cycle_type else None,
        "cycle_version_id": u.cycle_version_id,
        "current_step_id": u.current_step_id,
        "current_step_number": u.current_step.step_number if u.current_step else None,
        "current_step_name": u.current_step.operation_name if u.current_step else None,
        "current_storage_id": u.current_storage_id,
        "current_storage_code": u.current_storage.code if u.current_storage else None,
        "product_type_id": u.product_type_id,
        "size_id": u.size_id,
        "size_mm": u.size.value_mm if u.size else None,
        "design_id": u.design_id,
        "design_code": u.design.code if u.design else None,
        "design_confirmed": u.design_confirmed,
        "design_locked": u.design_locked,
        "mo_id": u.mo_id,
        "mo_number": u.mo.mo_number if u.mo else None,
        "parent_uid_id": u.parent_uid_id,
        "parent_uid_code": u.parent_uid.code if u.parent_uid else None,
        "child_suffix": u.child_suffix,
        "children": [{"id": c.id, "code": c.code, "status": c.status} for c in (u.children or [])],
        "created_at": u.created_at,
        "notes": u.notes,
        # Material traceability
        "faridabad_dispatch_id": u.faridabad_dispatch_id,
        "receiving_event_id": u.receiving_event_id,
        "alloy_supplier": u.alloy_supplier,
        "alloy_grade": u.alloy_grade,
        "alloy_heat_number": u.alloy_heat_number,
        "ms_supplier": u.ms_supplier,
        "ms_grade": u.ms_grade,
        "ms_heat_number": u.ms_heat_number,
        "rolling_contractor": u.rolling_contractor,
    }
    if include_history:
        data["step_history"] = [
            {
                "id": h.id,
                "cycle_step_id": h.cycle_step_id,
                "step_number": h.cycle_step.step_number if h.cycle_step else None,
                "operation_name": h.cycle_step.operation_name if h.cycle_step else None,
                "workstation_code": h.workstation.code if h.workstation else None,
                "performed_by": h.performed_by_user.full_name if h.performed_by_user else None,
                "performed_at": h.performed_at,
                "qc_result": h.qc_result,
                "qc_values": h.qc_values,
                "notes": h.notes,
                "child_uids_created": h.child_uids_created,
            }
            for h in u.step_history
        ]
    return data


# ── Lookup (service team + all) ────────────────────────────────────────────────

@router.get("/lookup/{code}")
def lookup_uid(code: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    u = db.query(UID).filter(UID.code == code.upper()).first()
    if not u:
        raise HTTPException(status_code=404, detail="UID not found")
    return uid_out(u, include_history=True)


# ── List / search UIDs ────────────────────────────────────────────────────────

@router.get("/")
def list_uids(
    location_id: Optional[int] = None,
    cycle_type_id: Optional[int] = None,
    status: Optional[UIDStatus] = None,
    step_number: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(UID)
    if location_id:
        q = q.filter(UID.factory_location_id == location_id)
    if cycle_type_id:
        q = q.filter(UID.cycle_type_id == cycle_type_id)
    if status:
        q = q.filter(UID.status == status)
    if search:
        q = q.filter(UID.code.ilike(f"%{search}%"))
    total = q.count()
    uids = q.order_by(UID.id.desc()).offset(skip).limit(limit).all()
    return {"total": total, "items": [uid_out(u) for u in uids]}


# ── Operator queue: UIDs at current user's workstation step ───────────────────

@router.get("/queue/operator")
def operator_queue(
    location_id: Optional[int] = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    loc_id = location_id or user.primary_location_id
    q = db.query(UID).filter(UID.status == UIDStatus.active)
    if loc_id:
        q = q.filter(UID.factory_location_id == loc_id)
    return [uid_out(u) for u in q.order_by(UID.priority.desc(), UID.created_at).limit(200).all()]


# ── Bulk create ────────────────────────────────────────────────────────────────

class BulkCreateRequest(BaseModel):
    quantity: int
    cycle_type_id: int
    factory_location_id: int
    product_type_id: Optional[int] = None
    size_id: Optional[int] = None
    design_id: Optional[int] = None
    priority: PriorityLevel = PriorityLevel.normal
    mo_id: Optional[int] = None


@router.post("/bulk-create", status_code=201)
def bulk_create(body: BulkCreateRequest, db: Session = Depends(get_db), user=Depends(require_manager)):
    if body.quantity < 1 or body.quantity > 500:
        raise HTTPException(status_code=400, detail="Quantity must be 1–500")
    uids = bulk_create_uids(
        db,
        quantity=body.quantity,
        cycle_type_id=body.cycle_type_id,
        factory_location_id=body.factory_location_id,
        created_by_id=user.id,
        product_type_id=body.product_type_id,
        size_id=body.size_id,
        design_id=body.design_id,
        priority=body.priority,
        mo_id=body.mo_id,
    )
    return {"created": len(uids), "uids": [{"id": u.id, "code": u.code} for u in uids]}


# ── Step completion ────────────────────────────────────────────────────────────

class StepCompleteRequest(BaseModel):
    workstation_id: int
    qc_result: Optional[str] = None
    qc_values: Optional[dict] = None
    notes: Optional[str] = None


@router.post("/{uid_id}/complete-step")
def complete_uid_step(uid_id: int, body: StepCompleteRequest, db: Session = Depends(get_db), user=Depends(require_operator)):
    uid = complete_step(db, uid_id, user.id, body.workstation_id, body.qc_result, body.qc_values, body.notes)
    return uid_out(uid)


# ── Converting ────────────────────────────────────────────────────────────────

class ChildData(BaseModel):
    length_mm: Optional[int] = None
    cycle_type_id: int


class ConvertRequest(BaseModel):
    children: List[ChildData]
    pattern_id: Optional[int] = None


@router.post("/{uid_id}/convert")
def convert_uid(uid_id: int, body: ConvertRequest, db: Session = Depends(get_db), user=Depends(require_supervisor)):
    children = do_converting(
        db, uid_id, user.id,
        [c.model_dump() for c in body.children],
        body.pattern_id,
    )
    return {"parent_uid_id": uid_id, "children": [uid_out(c) for c in children]}


# ── Design confirmation ───────────────────────────────────────────────────────

class DesignConfirmRequest(BaseModel):
    design_id: int
    size_id: Optional[int] = None


@router.post("/{uid_id}/confirm-design")
def confirm_design(uid_id: int, body: DesignConfirmRequest, db: Session = Depends(get_db), user=Depends(require_manager)):
    uid = db.query(UID).filter(UID.id == uid_id).first()
    if not uid:
        raise HTTPException(status_code=404, detail="UID not found")
    if uid.design_locked:
        raise HTTPException(status_code=400, detail="Design is locked — cannot change after Step 17")

    # Validate design-size combination
    if body.size_id:
        valid = db.query(DesignSizeValidity).filter(
            DesignSizeValidity.design_id == body.design_id,
            DesignSizeValidity.size_id == body.size_id,
        ).first()
        if not valid:
            raise HTTPException(status_code=400, detail="Invalid design-size combination")
        uid.size_id = body.size_id

    uid.design_id = body.design_id
    uid.design_confirmed = True
    if uid.status == UIDStatus.on_hold:
        uid.status = UIDStatus.active
    db.commit()
    db.refresh(uid)
    return uid_out(uid)


# ── MO Linking ────────────────────────────────────────────────────────────────

@router.post("/{uid_id}/link-mo/{mo_id}")
def link_mo(uid_id: int, mo_id: int, db: Session = Depends(get_db), user=Depends(require_manager)):
    uid = db.query(UID).filter(UID.id == uid_id).first()
    if not uid:
        raise HTTPException(status_code=404, detail="UID not found")
    uid.mo_id = mo_id
    db.commit()
    return {"uid_id": uid_id, "mo_id": mo_id}


# ── Inter-location transfer ────────────────────────────────────────────────────

class TransferRequest(BaseModel):
    to_location_id: int
    reason: str


@router.post("/{uid_id}/transfer")
def transfer_uid(uid_id: int, body: TransferRequest, db: Session = Depends(get_db), user=Depends(require_supervisor)):
    uid = db.query(UID).filter(UID.id == uid_id).first()
    if not uid:
        raise HTTPException(status_code=404, detail="UID not found")
    transfer = UIDTransfer(
        uid_id=uid_id,
        from_location_id=uid.factory_location_id,
        to_location_id=body.to_location_id,
        transferred_by_id=user.id,
        reason=body.reason,
    )
    uid.factory_location_id = body.to_location_id
    db.add(transfer)
    db.commit()
    return {"transferred": True, "new_location_id": body.to_location_id}


# ── Bulk cycle type change (before any steps) ──────────────────────────────────

class BulkCycleChange(BaseModel):
    uid_ids: List[int]
    new_cycle_type_id: int


@router.post("/bulk-change-cycle")
def bulk_change_cycle(body: BulkCycleChange, db: Session = Depends(get_db), user=Depends(require_manager)):
    from app.models.cycle import CycleVersion
    new_version = db.query(CycleVersion).filter(
        CycleVersion.cycle_type_id == body.new_cycle_type_id,
        CycleVersion.is_current == True,
    ).first()
    if not new_version:
        raise HTTPException(status_code=404, detail="Cycle type or version not found")

    updated = []
    for uid_id in body.uid_ids:
        uid = db.query(UID).filter(UID.id == uid_id).first()
        if not uid:
            continue
        if uid.step_history:
            raise HTTPException(status_code=400, detail=f"UID {uid.code} has steps completed — cannot change cycle")
        uid.cycle_type_id = body.new_cycle_type_id
        uid.cycle_version_id = new_version.id
        updated.append(uid.code)

    db.commit()
    return {"updated": updated}
