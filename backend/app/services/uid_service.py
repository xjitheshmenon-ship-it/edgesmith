"""UID generation and core tracking logic."""
import string
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models.uid import UID, UIDStepHistory, UIDStatus
from app.models.cycle import CycleType, CycleVersion, CycleStep
from app.models.factory import FactoryLocation
from fastapi import HTTPException


LETTERS = list(string.ascii_uppercase)


def _next_uid_code(db: Session, cycle_type: CycleType) -> str:
    """
    Generate next UID code for a cycle type.
    Format: 1 letter + 3 digits. Letter starts as cycle prefix (E, S, O).
    When counter hits 999, advance to next available letter.
    """
    # Get the latest UID code for this cycle type
    latest = (
        db.query(UID)
        .filter(UID.cycle_type_id == cycle_type.id)
        .order_by(UID.id.desc())
        .first()
    )

    if latest is None:
        return f"{cycle_type.letter_prefix}001"

    last_letter = latest.code[0]
    last_num = int(latest.code[1:])

    if last_num < 999:
        return f"{last_letter}{last_num + 1:03d}"

    # Need next letter not claimed by any cycle type
    used_prefixes = {ct.letter_prefix for ct in db.query(CycleType).filter(CycleType.is_active == True).all()}
    current_idx = LETTERS.index(last_letter)
    for i in range(current_idx + 1, len(LETTERS)):
        candidate = LETTERS[i]
        if candidate not in used_prefixes:
            return f"{candidate}001"

    raise HTTPException(status_code=500, detail="UID namespace exhausted — all letters in use")


def bulk_create_uids(
    db: Session,
    quantity: int,
    cycle_type_id: int,
    factory_location_id: int,
    created_by_id: int,
    product_type_id: int = None,
    size_id: int = None,
    design_id: int = None,
    priority: str = "normal",
    mo_id: int = None,
) -> list[UID]:
    cycle_type = db.query(CycleType).filter(CycleType.id == cycle_type_id).first()
    if not cycle_type:
        raise HTTPException(status_code=404, detail="Cycle type not found")

    current_version = db.query(CycleVersion).filter(
        CycleVersion.cycle_type_id == cycle_type_id,
        CycleVersion.is_current == True,
    ).first()
    if not current_version:
        raise HTTPException(status_code=400, detail="Cycle type has no current version")

    first_step = db.query(CycleStep).filter(
        CycleStep.cycle_version_id == current_version.id
    ).order_by(CycleStep.step_order).first()

    uids = []
    for _ in range(quantity):
        code = _next_uid_code(db, cycle_type)
        uid = UID(
            code=code,
            factory_location_id=factory_location_id,
            cycle_type_id=cycle_type_id,
            cycle_version_id=current_version.id,
            current_step_id=first_step.id if first_step else None,
            current_storage_id=first_step.from_storage_id if first_step else None,
            product_type_id=product_type_id,
            size_id=size_id,
            design_id=design_id,
            priority=priority,
            mo_id=mo_id,
            created_by_id=created_by_id,
        )
        db.add(uid)
        db.flush()  # get ID before next iteration
        uids.append(uid)

    db.commit()
    for uid in uids:
        db.refresh(uid)
    return uids


def complete_step(
    db: Session,
    uid_id: int,
    performed_by_id: int,
    workstation_id: int,
    qc_result: str = None,
    qc_values: dict = None,
    notes: str = None,
) -> UID:
    uid = db.query(UID).filter(UID.id == uid_id).first()
    if not uid:
        raise HTTPException(status_code=404, detail="UID not found")
    if uid.status not in (UIDStatus.active,):
        raise HTTPException(status_code=400, detail=f"UID is not active (status: {uid.status})")

    current_step = uid.current_step
    if not current_step:
        raise HTTPException(status_code=400, detail="UID has no current step")

    # Check design lock at step 16
    if current_step.is_converting_step and not uid.design_confirmed:
        uid.status = UIDStatus.on_hold
        db.commit()
        raise HTTPException(status_code=400, detail="Design must be confirmed before Converting (Step 16)")

    # Log history
    history = UIDStepHistory(
        uid_id=uid.id,
        cycle_step_id=current_step.id,
        workstation_id=workstation_id,
        factory_location_id=uid.factory_location_id,
        performed_by_id=performed_by_id,
        qc_result=qc_result,
        qc_values=qc_values,
        notes=notes,
    )
    db.add(history)

    # Advance to next step
    next_step = db.query(CycleStep).filter(
        CycleStep.cycle_version_id == uid.cycle_version_id,
        CycleStep.step_order > current_step.step_order,
    ).order_by(CycleStep.step_order).first()

    if next_step:
        uid.current_step_id = next_step.id
        uid.current_storage_id = next_step.from_storage_id
        # Lock design after step 17 (OP20) begins
        if next_step.step_number == "17":
            uid.design_locked = True
    else:
        uid.status = UIDStatus.dispatched
        uid.current_step_id = None

    db.commit()
    db.refresh(uid)
    return uid


def do_converting(
    db: Session,
    parent_uid_id: int,
    supervisor_id: int,
    children_data: list[dict],   # [{length_mm, cycle_type_id, suffix}]
    pattern_id: int = None,
) -> list[UID]:
    parent = db.query(UID).filter(UID.id == parent_uid_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent UID not found")
    if not parent.design_confirmed:
        raise HTTPException(status_code=400, detail="Design must be confirmed before Converting")
    if len(children_data) < 2 or len(children_data) > 4:
        raise HTTPException(status_code=400, detail="Converting produces 2–4 children")

    # Freeze parent
    parent.status = UIDStatus.converted
    current_step = parent.current_step

    history = UIDStepHistory(
        uid_id=parent.id,
        cycle_step_id=current_step.id,
        workstation_id=current_step.workstation_id,
        factory_location_id=parent.factory_location_id,
        performed_by_id=supervisor_id,
        notes=f"Converting: produced {len(children_data)} children",
        conversion_pattern_id=pattern_id,
        child_uids_created=[],
    )
    db.add(history)
    db.flush()

    children = []
    suffixes = ["A", "B", "C", "D"]
    child_codes = []

    for i, child_data in enumerate(children_data):
        child_cycle_type = db.query(CycleType).filter(
            CycleType.id == child_data["cycle_type_id"]
        ).first()
        if not child_cycle_type:
            raise HTTPException(status_code=404, detail=f"Cycle type {child_data['cycle_type_id']} not found")

        child_version = db.query(CycleVersion).filter(
            CycleVersion.cycle_type_id == child_cycle_type.id,
            CycleVersion.is_current == True,
        ).first()

        # Children start at step 17 equivalent (first step after converting)
        child_start_step = db.query(CycleStep).filter(
            CycleStep.cycle_version_id == child_version.id,
            CycleStep.step_order > 0,
        ).order_by(CycleStep.step_order).offset(16).first()  # step 17 index

        suffix = suffixes[i]
        child_code = f"{parent.code}-{suffix}"
        child_codes.append(child_code)

        child = UID(
            code=child_code,
            factory_location_id=parent.factory_location_id,
            cycle_type_id=child_cycle_type.id,
            cycle_version_id=child_version.id,
            current_step_id=child_start_step.id if child_start_step else None,
            current_storage_id=child_start_step.from_storage_id if child_start_step else None,
            product_type_id=parent.product_type_id,
            size_id=None,  # child has its own size from cut
            design_id=parent.design_id,
            design_confirmed=parent.design_confirmed,
            priority=parent.priority,
            mo_id=parent.mo_id,
            parent_uid_id=parent.id,
            child_suffix=suffix,
            created_by_id=supervisor_id,
        )
        db.add(child)
        children.append(child)

    history.child_uids_created = child_codes
    db.commit()
    for c in children:
        db.refresh(c)
    return children
