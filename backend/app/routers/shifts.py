from datetime import date as date_type
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..auth import get_current_user, require_roles
from ..models.shifts import ShiftAssignment, JobAllotment, ShiftPeriod
from ..models.users import User, UserRole
from ..models.uid import UID, UIDStatus
from ..models.cycle import CycleStep

router = APIRouter(prefix='/api/shifts', tags=['shifts'])

require_supervisor = require_roles('admin', 'manager', 'supervisor')
require_manager = require_roles('admin', 'manager')


# ── Schemas ───────────────────────────────────────────────────────────────────

class AssignmentCreate(BaseModel):
    shift_date: date_type
    shift_period: ShiftPeriod
    workstation_id: int
    operator_id: int
    notes: Optional[str] = None

class AssignmentConfirm(BaseModel):
    confirmed: bool

class AllotmentCreate(BaseModel):
    uid_id: int
    operator_id: int
    workstation_id: int
    notes: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _assignment_out(a: ShiftAssignment):
    return {
        'id': a.id,
        'shift_date': str(a.shift_date),
        'shift_period': a.shift_period,
        'workstation_id': a.workstation_id,
        'workstation_code': a.workstation.code if a.workstation else None,
        'workstation_name': a.workstation.name if a.workstation else None,
        'operator_id': a.operator_id,
        'operator_username': a.operator.username if a.operator else None,
        'operator_full_name': a.operator.full_name if a.operator else None,
        'assigned_by': a.assigned_by.username if a.assigned_by else None,
        'confirmed_by': a.confirmed_by.username if a.confirmed_by else None,
        'notes': a.notes,
        'created_at': a.created_at.isoformat() if a.created_at else None,
        'updated_at': a.updated_at.isoformat() if a.updated_at else None,
    }

def _allotment_out(j: JobAllotment):
    uid = j.uid
    step = uid.current_step if uid else None
    return {
        'id': j.id,
        'uid_id': j.uid_id,
        'uid_code': uid.code if uid else None,
        'uid_status': uid.status if uid else None,
        'current_step': step.step_number if step else None,
        'current_step_name': step.operation_name if step else None,
        'from_storage_code': step.from_storage.code if (step and step.from_storage) else None,
        'to_storage_code': step.to_storage.code if (step and step.to_storage) else None,
        'operator_id': j.operator_id,
        'operator_username': j.operator.username if j.operator else None,
        'operator_full_name': j.operator.full_name if j.operator else None,
        'workstation_id': j.workstation_id,
        'workstation_code': j.workstation.code if j.workstation else None,
        'workstation_name': j.workstation.name if j.workstation else None,
        'allotted_by': j.allotted_by.username if j.allotted_by else None,
        'notes': j.notes,
        'is_active': bool(j.is_active),
        'created_at': j.created_at.isoformat() if j.created_at else None,
    }


# ── Shift Assignments ─────────────────────────────────────────────────────────

@router.get('/assignments')
def list_assignments(
    shift_date: Optional[date_type] = None,
    shift_period: Optional[ShiftPeriod] = None,
    workstation_id: Optional[int] = None,
    location_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(ShiftAssignment)
    if shift_date:
        q = q.filter(ShiftAssignment.shift_date == shift_date)
    if shift_period:
        q = q.filter(ShiftAssignment.shift_period == shift_period)
    if workstation_id:
        q = q.filter(ShiftAssignment.workstation_id == workstation_id)
    if location_id:
        from ..models.factory import Workstation
        ws_ids = [w.id for w in db.query(Workstation).filter(
            (Workstation.factory_location_id == location_id) | (Workstation.factory_location_id == None)
        ).all()]
        q = q.filter(ShiftAssignment.workstation_id.in_(ws_ids))
    return [_assignment_out(a) for a in q.order_by(ShiftAssignment.shift_date, ShiftAssignment.shift_period).all()]


@router.post('/assignments')
def create_or_update_assignment(
    data: AssignmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor),
):
    existing = db.query(ShiftAssignment).filter(
        ShiftAssignment.shift_date == data.shift_date,
        ShiftAssignment.shift_period == data.shift_period,
        ShiftAssignment.workstation_id == data.workstation_id,
    ).first()

    operator = db.query(User).filter(User.id == data.operator_id).first()
    if not operator or operator.role != UserRole.operator:
        raise HTTPException(400, 'Selected user is not an operator')

    if existing:
        existing.operator_id = data.operator_id
        existing.assigned_by_id = current_user.id
        existing.notes = data.notes
        if current_user.role in ('admin', 'supervisor'):
            existing.confirmed_by_id = current_user.id
        else:
            existing.confirmed_by_id = None
        db.commit()
        db.refresh(existing)
        return _assignment_out(existing)

    assignment = ShiftAssignment(
        shift_date=data.shift_date,
        shift_period=data.shift_period,
        workstation_id=data.workstation_id,
        operator_id=data.operator_id,
        assigned_by_id=current_user.id,
        confirmed_by_id=current_user.id if current_user.role in ('admin', 'supervisor') else None,
        notes=data.notes,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return _assignment_out(assignment)


@router.post('/assignments/{assignment_id}/confirm')
def confirm_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor),
):
    a = db.query(ShiftAssignment).filter(ShiftAssignment.id == assignment_id).first()
    if not a:
        raise HTTPException(404, 'Assignment not found')
    if current_user.role not in ('admin', 'supervisor'):
        raise HTTPException(403, 'Only supervisors can confirm assignments')
    a.confirmed_by_id = current_user.id
    db.commit()
    db.refresh(a)
    return _assignment_out(a)


@router.delete('/assignments/{assignment_id}')
def delete_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor),
):
    a = db.query(ShiftAssignment).filter(ShiftAssignment.id == assignment_id).first()
    if not a:
        raise HTTPException(404, 'Assignment not found')
    db.delete(a)
    db.commit()
    return {'ok': True}


# ── Job Allotments ────────────────────────────────────────────────────────────

@router.get('/allotments')
def list_allotments(
    operator_id: Optional[int] = None,
    workstation_id: Optional[int] = None,
    active_only: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(JobAllotment)
    if active_only:
        q = q.filter(JobAllotment.is_active == 1)
    if operator_id:
        q = q.filter(JobAllotment.operator_id == operator_id)
    if workstation_id:
        q = q.filter(JobAllotment.workstation_id == workstation_id)
    if current_user.role == UserRole.operator:
        q = q.filter(JobAllotment.operator_id == current_user.id)
    return [_allotment_out(j) for j in q.order_by(JobAllotment.created_at.desc()).all()]


@router.post('/allotments')
def create_allotment(
    data: AllotmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor),
):
    uid = db.query(UID).filter(UID.id == data.uid_id).first()
    if not uid:
        raise HTTPException(404, 'UID not found')
    if uid.status not in (UIDStatus.active, UIDStatus.on_hold):
        raise HTTPException(400, f'UID is {uid.status}, cannot allot')

    db.query(JobAllotment).filter(
        JobAllotment.uid_id == data.uid_id,
        JobAllotment.is_active == 1,
    ).update({'is_active': 0})

    allotment = JobAllotment(
        uid_id=data.uid_id,
        operator_id=data.operator_id,
        workstation_id=data.workstation_id,
        allotted_by_id=current_user.id,
        notes=data.notes,
        is_active=1,
    )
    db.add(allotment)
    db.commit()
    db.refresh(allotment)
    return _allotment_out(allotment)


@router.delete('/allotments/{allotment_id}')
def remove_allotment(
    allotment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor),
):
    j = db.query(JobAllotment).filter(JobAllotment.id == allotment_id).first()
    if not j:
        raise HTTPException(404, 'Allotment not found')
    j.is_active = 0
    db.commit()
    return {'ok': True}


# ── Auto-Assign ───────────────────────────────────────────────────────────────

class AutoAssignRequest(BaseModel):
    shift_date: date_type
    shift_period: ShiftPeriod

@router.post('/allotments/auto-assign')
def auto_assign_allotments(
    data: AutoAssignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_supervisor),
):
    """
    For each shift assignment on the given date/period, find all active UIDs
    whose current step's workstation matches the assigned workstation, then
    allot those UIDs to the assigned operator (deactivating prior allotments).
    """
    assignments = db.query(ShiftAssignment).filter(
        ShiftAssignment.shift_date == data.shift_date,
        ShiftAssignment.shift_period == data.shift_period,
    ).all()

    if not assignments:
        return {'allotted': 0, 'detail': 'No shift assignments found for this date/period'}

    total_allotted = 0
    for assignment in assignments:
        uids = db.query(UID).join(
            CycleStep, UID.current_step_id == CycleStep.id
        ).filter(
            CycleStep.workstation_id == assignment.workstation_id,
            UID.status.in_([UIDStatus.active, UIDStatus.on_hold]),
        ).all()

        for uid in uids:
            db.query(JobAllotment).filter(
                JobAllotment.uid_id == uid.id,
                JobAllotment.is_active == 1,
            ).update({'is_active': 0})

            allotment = JobAllotment(
                uid_id=uid.id,
                operator_id=assignment.operator_id,
                workstation_id=assignment.workstation_id,
                allotted_by_id=current_user.id,
                notes=f'Auto-assigned for {data.shift_date} {data.shift_period}',
                is_active=1,
            )
            db.add(allotment)
            total_allotted += 1

    db.commit()
    return {'allotted': total_allotted}


# ── Queue View ────────────────────────────────────────────────────────────────

@router.get('/queue-view')
def queue_view(
    shift_date: date_type,
    shift_period: ShiftPeriod,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    For the given shift, return each assigned workstation with:
    - operator info
    - already allotted UIDs (their queue)
    - ready UIDs (at that workstation's step, not yet allotted)
    Source/destination auto-derived from cycle step config.
    """
    assignments = db.query(ShiftAssignment).filter(
        ShiftAssignment.shift_date == shift_date,
        ShiftAssignment.shift_period == shift_period,
    ).all()

    result = []
    for a in assignments:
        allotted = db.query(JobAllotment).filter(
            JobAllotment.workstation_id == a.workstation_id,
            JobAllotment.is_active == 1,
        ).order_by(JobAllotment.created_at).all()

        allotted_uid_ids = {j.uid_id for j in allotted}

        steps = db.query(CycleStep).filter(CycleStep.workstation_id == a.workstation_id).all()
        from_codes = list({s.from_storage.code for s in steps if s.from_storage})
        to_codes = list({s.to_storage.code for s in steps if s.to_storage})

        ready_q = db.query(UID).join(
            CycleStep, UID.current_step_id == CycleStep.id
        ).filter(
            CycleStep.workstation_id == a.workstation_id,
            UID.status.in_([UIDStatus.active, UIDStatus.on_hold]),
        )
        if allotted_uid_ids:
            ready_q = ready_q.filter(UID.id.notin_(allotted_uid_ids))
        ready_uids = ready_q.order_by(UID.created_at).all()

        result.append({
            'assignment_id': a.id,
            'workstation_id': a.workstation_id,
            'workstation_code': a.workstation.code if a.workstation else None,
            'workstation_name': a.workstation.name if a.workstation else None,
            'operator_id': a.operator_id,
            'operator_name': a.operator.full_name or a.operator.username if a.operator else None,
            'confirmed': bool(a.confirmed_by_id),
            'from_storage': from_codes,
            'to_storage': to_codes,
            'queue': [_allotment_out(j) for j in allotted],
            'ready_count': len(ready_uids),
            'ready_uids': [{'id': u.id, 'code': u.code, 'status': u.status, 'priority': u.priority} for u in ready_uids[:50]],
        })

    return result
