"""Cycle versioning service."""
from sqlalchemy.orm import Session
from fastapi import HTTPException
from app.models.cycle import CycleType, CycleVersion, CycleStep


def create_new_version(
    db: Session,
    cycle_type_id: int,
    steps_data: list[dict],
    created_by_id: int,
    change_notes: str = None,
) -> CycleVersion:
    cycle_type = db.query(CycleType).filter(CycleType.id == cycle_type_id).first()
    if not cycle_type:
        raise HTTPException(status_code=404, detail="Cycle type not found")

    # Deactivate current version
    db.query(CycleVersion).filter(
        CycleVersion.cycle_type_id == cycle_type_id,
        CycleVersion.is_current == True,
    ).update({"is_current": False})

    latest_version_num = db.query(CycleVersion).filter(
        CycleVersion.cycle_type_id == cycle_type_id
    ).count()

    new_version = CycleVersion(
        cycle_type_id=cycle_type_id,
        version_number=latest_version_num + 1,
        is_current=True,
        created_by_id=created_by_id,
        change_notes=change_notes,
    )
    db.add(new_version)
    db.flush()

    for order, step_data in enumerate(steps_data):
        step = CycleStep(
            cycle_version_id=new_version.id,
            step_number=step_data["step_number"],
            step_order=order,
            operation_name=step_data["operation_name"],
            workstation_id=step_data["workstation_id"],
            from_storage_id=step_data.get("from_storage_id"),
            to_storage_id=step_data.get("to_storage_id"),
            is_converting_step=step_data.get("is_converting_step", False),
            is_child_marking_step=step_data.get("is_child_marking_step", False),
            is_qc_step=step_data.get("is_qc_step", False),
        )
        db.add(step)

    db.commit()
    db.refresh(new_version)
    return new_version


def export_cycle(db: Session, cycle_type_id: int, version_id: int = None) -> dict:
    cycle_type = db.query(CycleType).filter(CycleType.id == cycle_type_id).first()
    if not cycle_type:
        raise HTTPException(status_code=404, detail="Cycle type not found")

    if version_id:
        version = db.query(CycleVersion).filter(
            CycleVersion.id == version_id,
            CycleVersion.cycle_type_id == cycle_type_id,
        ).first()
    else:
        version = db.query(CycleVersion).filter(
            CycleVersion.cycle_type_id == cycle_type_id,
            CycleVersion.is_current == True,
        ).first()

    if not version:
        raise HTTPException(status_code=404, detail="Cycle version not found")

    steps = []
    for step in version.steps:
        steps.append({
            "step_number": step.step_number,
            "step_order": step.step_order,
            "operation_name": step.operation_name,
            "workstation_code": step.workstation.code if step.workstation else None,
            "from_storage_code": step.from_storage.code if step.from_storage else None,
            "to_storage_code": step.to_storage.code if step.to_storage else None,
            "is_converting_step": step.is_converting_step,
            "is_child_marking_step": step.is_child_marking_step,
            "is_qc_step": step.is_qc_step,
        })

    return {
        "schema_version": "1.0",
        "cycle_name": cycle_type.name,
        "cycle_letter_prefix": cycle_type.letter_prefix,
        "version_number": version.version_number,
        "change_notes": version.change_notes,
        "steps": steps,
    }
