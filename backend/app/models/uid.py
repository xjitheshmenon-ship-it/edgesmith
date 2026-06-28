import enum
from sqlalchemy import Column, Integer, String, Boolean, Enum, ForeignKey, DateTime, Text, Float, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class UIDStatus(str, enum.Enum):
    active = "active"
    on_hold = "on_hold"          # design missing at step 16
    converting = "converting"    # mid-split, waiting for children confirmation
    converted = "converted"      # parent, permanently frozen after split
    dispatched = "dispatched"    # reached FG / step 26 complete
    archived = "archived"        # manual admin archive


class PriorityLevel(str, enum.Enum):
    normal = "normal"
    high = "high"
    urgent = "urgent"


class UID(Base):
    __tablename__ = "uids"

    id = Column(Integer, primary_key=True)
    code = Column(String(8), unique=True, nullable=False, index=True)   # E043, S012

    factory_location_id = Column(Integer, ForeignKey("factory_locations.id"), nullable=False)
    factory_location = relationship("FactoryLocation", back_populates="uids")

    cycle_type_id = Column(Integer, ForeignKey("cycle_types.id"), nullable=False)
    cycle_type = relationship("CycleType", back_populates="uids")

    cycle_version_id = Column(Integer, ForeignKey("cycle_versions.id"), nullable=False)
    cycle_version = relationship("CycleVersion", back_populates="uids")

    current_step_id = Column(Integer, ForeignKey("cycle_steps.id"), nullable=True)
    current_step = relationship("CycleStep", foreign_keys=[current_step_id])

    current_storage_id = Column(Integer, ForeignKey("storage_locations.id"), nullable=True)
    current_storage = relationship("StorageLocation", foreign_keys=[current_storage_id])

    # Product metadata
    product_type_id = Column(Integer, ForeignKey("product_types.id"), nullable=True)
    product_type = relationship("ProductType", back_populates="uids")

    size_id = Column(Integer, ForeignKey("sizes.id"), nullable=True)
    size = relationship("Size", back_populates="uids")

    design_id = Column(Integer, ForeignKey("designs.id"), nullable=True)
    design = relationship("Design", back_populates="uids")
    design_confirmed = Column(Boolean, default=False)
    design_locked = Column(Boolean, default=False)   # locked after step 17 starts

    status = Column(Enum(UIDStatus), default=UIDStatus.active, nullable=False, index=True)
    priority = Column(Enum(PriorityLevel), default=PriorityLevel.normal, nullable=False)

    # MO linkage
    mo_id = Column(Integer, ForeignKey("manufacturing_orders.id"), nullable=True)
    mo = relationship("ManufacturingOrder", back_populates="uids")

    # Parent/child split lineage
    parent_uid_id = Column(Integer, ForeignKey("uids.id"), nullable=True)
    parent_uid = relationship("UID", remote_side="UID.id", foreign_keys=[parent_uid_id], backref="children")
    child_suffix = Column(String(4), nullable=True)   # A, B, C, D

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    notes = Column(Text, nullable=True)
    flags = Column(JSON, nullable=True)

    step_history = relationship("UIDStepHistory", back_populates="uid", order_by="UIDStepHistory.performed_at")
    transfers = relationship("UIDTransfer", back_populates="uid")


class UIDStepHistory(Base):
    __tablename__ = "uid_step_history"

    id = Column(Integer, primary_key=True)
    uid_id = Column(Integer, ForeignKey("uids.id"), nullable=False, index=True)
    uid = relationship("UID", back_populates="step_history")

    cycle_step_id = Column(Integer, ForeignKey("cycle_steps.id"), nullable=False)
    cycle_step = relationship("CycleStep")

    workstation_id = Column(Integer, ForeignKey("workstations.id"), nullable=True)
    workstation = relationship("Workstation", back_populates="uid_step_histories")

    factory_location_id = Column(Integer, ForeignKey("factory_locations.id"), nullable=True)

    performed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    performed_by_user = relationship("User", back_populates="uid_step_histories")
    performed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    qc_result = Column(String(16), nullable=True)    # pass / fail / na
    qc_values = Column(JSON, nullable=True)           # measurements, HT params
    notes = Column(Text, nullable=True)

    # For converting steps
    conversion_pattern_id = Column(Integer, ForeignKey("conversion_patterns.id"), nullable=True)
    child_uids_created = Column(JSON, nullable=True)   # list of child UID codes


class UIDTransfer(Base):
    __tablename__ = "uid_transfers"

    id = Column(Integer, primary_key=True)
    uid_id = Column(Integer, ForeignKey("uids.id"), nullable=False)
    uid = relationship("UID", back_populates="transfers")
    from_location_id = Column(Integer, ForeignKey("factory_locations.id"), nullable=False)
    to_location_id = Column(Integer, ForeignKey("factory_locations.id"), nullable=False)
    transferred_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    transferred_at = Column(DateTime(timezone=True), server_default=func.now())
    reason = Column(Text, nullable=False)
