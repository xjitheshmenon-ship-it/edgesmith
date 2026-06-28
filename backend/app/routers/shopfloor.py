"""Real-time shopfloor data endpoint — used by wall displays and dashboard."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from app.database import get_db
from app.models.uid import UID, UIDStatus
from app.models.factory import FactoryLocation, Workstation, StorageLocation
from app.models.cycle import CycleStep
from app.auth import get_current_user

router = APIRouter(prefix="/api/shopfloor", tags=["shopfloor"])


@router.get("/status")
def shopfloor_status(location_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Public endpoint — shopfloor wall display needs no auth."""

    locations = db.query(FactoryLocation).filter(FactoryLocation.is_active == True)
    if location_id:
        locations = locations.filter(FactoryLocation.id == location_id)
    locations = locations.all()

    result = []
    for loc in locations:
        # UIDs grouped by workstation
        workstation_counts = (
            db.query(CycleStep.workstation_id, func.count(UID.id).label("count"))
            .join(UID, UID.current_step_id == CycleStep.id)
            .filter(UID.factory_location_id == loc.id, UID.status == UIDStatus.active)
            .group_by(CycleStep.workstation_id)
            .all()
        )
        ws_map = {row.workstation_id: row.count for row in workstation_counts}

        workstations = db.query(Workstation).filter(
            (Workstation.factory_location_id == loc.id) | (Workstation.factory_location_id == None),
            Workstation.is_active == True,
        ).all()

        ws_status = []
        for ws in workstations:
            ws_status.append({
                "workstation_id": ws.id,
                "code": ws.code,
                "name": ws.name,
                "category": ws.category,
                "uid_count": ws_map.get(ws.id, 0),
            })

        # Storage counts
        storage_counts = (
            db.query(UID.current_storage_id, func.count(UID.id).label("count"))
            .filter(UID.factory_location_id == loc.id, UID.status == UIDStatus.active)
            .group_by(UID.current_storage_id)
            .all()
        )
        storage_map = {row.current_storage_id: row.count for row in storage_counts}

        all_storages = db.query(StorageLocation).filter(
            (StorageLocation.factory_location_id == loc.id) | (StorageLocation.factory_location_id == None),
            StorageLocation.is_active == True,
        ).all()

        storage_status = [
            {"storage_id": s.id, "code": s.code, "name": s.name, "uid_count": storage_map.get(s.id, 0)}
            for s in all_storages
        ]

        # Summary counts
        total_active = db.query(UID).filter(UID.factory_location_id == loc.id, UID.status == UIDStatus.active).count()
        on_hold = db.query(UID).filter(UID.factory_location_id == loc.id, UID.status == UIDStatus.on_hold).count()
        dispatched_today = 0  # could add date filter

        result.append({
            "location_id": loc.id,
            "location_code": loc.code,
            "location_name": loc.name,
            "total_active_uids": total_active,
            "on_hold": on_hold,
            "workstations": ws_status,
            "storage_locations": storage_status,
        })

    return result


@router.get("/dashboard")
def dashboard_summary(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Manager dashboard — cross-location summary."""
    total = db.query(UID).count()
    active = db.query(UID).filter(UID.status == UIDStatus.active).count()
    on_hold = db.query(UID).filter(UID.status == UIDStatus.on_hold).count()
    dispatched = db.query(UID).filter(UID.status == UIDStatus.dispatched).count()

    priority_urgent = db.query(UID).filter(UID.status == UIDStatus.active, UID.priority == "urgent").count()
    priority_high = db.query(UID).filter(UID.status == UIDStatus.active, UID.priority == "high").count()

    from app.models.manufacturing import ManufacturingOrder, MOStatus
    open_mos = db.query(ManufacturingOrder).filter(ManufacturingOrder.status == MOStatus.open).count()

    return {
        "uid_total": total,
        "uid_active": active,
        "uid_on_hold": on_hold,
        "uid_dispatched": dispatched,
        "priority_urgent": priority_urgent,
        "priority_high": priority_high,
        "open_manufacturing_orders": open_mos,
    }
