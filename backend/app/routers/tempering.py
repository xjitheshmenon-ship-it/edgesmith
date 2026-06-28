from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

from app.database import get_db
from app.auth import require_admin, require_supervisor, get_current_user
from app.models.tempering import TemperingParameter, FurnaceBatch, FurnaceBatchUID
from app.models.cycle import CycleType, CycleStep
from app.models.uid import UID, UIDStepHistory, UIDStatus

router = APIRouter(prefix="/api/tempering", tags=["tempering"])


def param_out(p: TemperingParameter) -> dict:
    return {
        "id": p.id,
        "cycle_type_id": p.cycle_type_id,
        "cycle_type_name": p.cycle_type.name if p.cycle_type else None,
        "cycle_step_id": p.cycle_step_id,
        "step_number": p.cycle_step.step_number if p.cycle_step else None,
        "operation_name": p.cycle_step.operation_name if p.cycle_step else None,
        "target_temp_c": p.target_temp_c,
        "target_soak_minutes": p.target_soak_minutes,
        "tolerance_temp_c": p.tolerance_temp_c,
        "tolerance_soak_minutes": p.tolerance_soak_minutes,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def batch_out(b: FurnaceBatch, include_uids: bool = False) -> dict:
    data = {
        "id": b.id,
        "batch_number": b.batch_number,
        "cycle_type_id": b.cycle_type_id,
        "cycle_type_name": b.cycle_type.name if b.cycle_type else None,
        "cycle_step_id": b.cycle_step_id,
        "step_number": b.cycle_step.step_number if b.cycle_step else None,
        "operation_name": b.cycle_step.operation_name if b.cycle_step else None,
        "target_temp_c": b.target_temp_c,
        "target_soak_minutes": b.target_soak_minutes,
        "actual_temp_c": b.actual_temp_c,
        "actual_soak_minutes": b.actual_soak_minutes,
        "actuals_recorded": b.actuals_recorded,
        "deviation_flagged": b.deviation_flagged,
        "deviation_notes": b.deviation_notes,
        "started_at": b.started_at.isoformat() if b.started_at else None,
        "ended_at": b.ended_at.isoformat() if b.ended_at else None,
        "uid_count": len(b.uid_entries),
        "created_at": b.created_at.isoformat() if b.created_at else None,
    }
    if include_uids:
        data["uids"] = [{"uid_id": e.uid_id, "uid_code": e.uid.code if e.uid else None} for e in b.uid_entries]
    return data


# ── Tempering Parameters (Admin only) ────────────────────────────────────────

class ParamUpsert(BaseModel):
    cycle_type_id: int
    cycle_step_id: int
    target_temp_c: float
    target_soak_minutes: int
    tolerance_temp_c: float = 5.0
    tolerance_soak_minutes: int = 5


@router.get("/parameters")
def list_parameters(cycle_type_id: Optional[int] = None, db: Session = Depends(get_db), _=Depends(get_current_user)):
    q = db.query(TemperingParameter)
    if cycle_type_id:
        q = q.filter(TemperingParameter.cycle_type_id == cycle_type_id)
    return [param_out(p) for p in q.all()]


@router.post("/parameters", status_code=201)
def upsert_parameter(body: ParamUpsert, db: Session = Depends(get_db), user=Depends(require_admin)):
    existing = db.query(TemperingParameter).filter(
        TemperingParameter.cycle_type_id == body.cycle_type_id,
        TemperingParameter.cycle_step_id == body.cycle_step_id,
    ).first()
    if existing:
        for k, v in body.model_dump().items():
            setattr(existing, k, v)
        existing.updated_by_id = user.id
        db.commit()
        db.refresh(existing)
        return param_out(existing)
    p = TemperingParameter(**body.model_dump(), updated_by_id=user.id)
    db.add(p)
    db.commit()
    db.refresh(p)
    return param_out(p)


# ── Furnace Batches ───────────────────────────────────────────────────────────

class BatchCreate(BaseModel):
    cycle_type_id: int
    cycle_step_id: int
    uid_ids: List[int]


class BatchComplete(BaseModel):
    actual_temp_c: Optional[float] = None
    actual_soak_minutes: Optional[int] = None


@router.get("/batches")
def list_batches(cycle_type_id: Optional[int] = None, db: Session = Depends(get_db), _=Depends(get_current_user)):
    q = db.query(FurnaceBatch).order_by(FurnaceBatch.created_at.desc())
    if cycle_type_id:
        q = q.filter(FurnaceBatch.cycle_type_id == cycle_type_id)
    return [batch_out(b) for b in q.limit(100).all()]


@router.get("/batches/{batch_id}")
def get_batch(batch_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    b = db.query(FurnaceBatch).filter(FurnaceBatch.id == batch_id).first()
    if not b:
        raise HTTPException(404, "Batch not found")
    return batch_out(b, include_uids=True)


@router.post("/batches", status_code=201)
def create_batch(body: BatchCreate, db: Session = Depends(get_db), user=Depends(require_supervisor)):
    # Look up configured parameters
    param = db.query(TemperingParameter).filter(
        TemperingParameter.cycle_type_id == body.cycle_type_id,
        TemperingParameter.cycle_step_id == body.cycle_step_id,
    ).first()

    # Auto-generate batch number: HT90-YYYY-NNN
    count = db.query(FurnaceBatch).count() + 1
    from datetime import date
    batch_number = f"HT90-{date.today().year}-{count:03d}"

    batch = FurnaceBatch(
        batch_number=batch_number,
        cycle_type_id=body.cycle_type_id,
        cycle_step_id=body.cycle_step_id,
        tempering_parameter_id=param.id if param else None,
        target_temp_c=param.target_temp_c if param else None,
        target_soak_minutes=param.target_soak_minutes if param else None,
        started_at=datetime.utcnow(),
        created_by_id=user.id,
    )
    db.add(batch)
    db.flush()

    for uid_id in body.uid_ids:
        entry = FurnaceBatchUID(furnace_batch_id=batch.id, uid_id=uid_id)
        db.add(entry)

    db.commit()
    db.refresh(batch)
    return batch_out(batch, include_uids=True)


@router.post("/batches/{batch_id}/complete")
def complete_batch(batch_id: int, body: BatchComplete, db: Session = Depends(get_db), user=Depends(require_supervisor)):
    b = db.query(FurnaceBatch).filter(FurnaceBatch.id == batch_id).first()
    if not b:
        raise HTTPException(404, "Batch not found")
    if b.ended_at:
        raise HTTPException(400, "Batch already completed")

    b.ended_at = datetime.utcnow()
    b.operator_id = user.id

    if body.actual_temp_c is not None or body.actual_soak_minutes is not None:
        b.actual_temp_c = body.actual_temp_c
        b.actual_soak_minutes = body.actual_soak_minutes
        b.actuals_recorded = True

        # Check deviation
        flags = []
        if b.target_temp_c and b.actual_temp_c:
            param = db.query(TemperingParameter).filter(TemperingParameter.id == b.tempering_parameter_id).first()
            tol_t = param.tolerance_temp_c if param else 5.0
            tol_s = param.tolerance_soak_minutes if param else 5
            if abs(b.actual_temp_c - b.target_temp_c) > tol_t:
                flags.append(f"Temp deviation: target {b.target_temp_c}°C, actual {b.actual_temp_c}°C")
            if b.target_soak_minutes and b.actual_soak_minutes is not None:
                if abs(b.actual_soak_minutes - b.target_soak_minutes) > tol_s:
                    flags.append(f"Soak deviation: target {b.target_soak_minutes}min, actual {b.actual_soak_minutes}min")
        if flags:
            b.deviation_flagged = True
            b.deviation_notes = "; ".join(flags)
    else:
        # No actuals entered — use targets
        b.actuals_recorded = False

    db.commit()
    db.refresh(b)
    return batch_out(b, include_uids=True)
