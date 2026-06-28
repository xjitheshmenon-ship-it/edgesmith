import enum
from sqlalchemy import Column, Integer, String, Boolean, Enum, ForeignKey, DateTime, Text, Float, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class MOStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"


class BatchSelectionRule(str, enum.Enum):
    priority_fifo = "priority_fifo"
    strict_fifo = "strict_fifo"
    dimension_matched = "dimension_matched"


class BatchTriggerMode(str, enum.Enum):
    auto = "auto"
    manual = "manual"


class ManufacturingOrder(Base):
    __tablename__ = "manufacturing_orders"

    id = Column(Integer, primary_key=True)
    mo_number = Column(String(64), unique=True, nullable=False, index=True)
    customer = Column(String(256), nullable=False)
    quantity = Column(Integer, nullable=False)
    size_id = Column(Integer, ForeignKey("sizes.id"), nullable=True)
    size = relationship("Size")
    design_id = Column(Integer, ForeignKey("designs.id"), nullable=True)
    design = relationship("Design")
    status = Column(Enum(MOStatus), default=MOStatus.open, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    uids = relationship("UID", back_populates="mo")


class ConversionPattern(Base):
    """Standard cut patterns for Step 16 (Converting)."""
    __tablename__ = "conversion_patterns"

    id = Column(Integer, primary_key=True)
    name = Column(String(64), nullable=False)
    input_length_mm = Column(Integer, nullable=False)
    output_lengths_mm = Column(JSON, nullable=False)    # [1500, 1500, 1424]
    kerf_mm = Column(Integer, default=3, nullable=False)
    is_active = Column(Boolean, default=True)

    @property
    def num_cuts(self) -> int:
        return len(self.output_lengths_mm) - 1

    @property
    def scrap_mm(self) -> int:
        return self.input_length_mm - sum(self.output_lengths_mm) - (self.num_cuts * self.kerf_mm)


class BatchRule(Base):
    __tablename__ = "batch_rules"

    id = Column(Integer, primary_key=True)
    cycle_version_id = Column(Integer, ForeignKey("cycle_versions.id"), nullable=False)
    cycle_step_id = Column(Integer, ForeignKey("cycle_steps.id"), nullable=False)
    cycle_step = relationship("CycleStep")

    capacity_type = Column(String(32), nullable=True)   # count, weight, time
    capacity_value = Column(Float, nullable=True)
    min_batch_size = Column(Integer, default=1)
    selection_rule = Column(Enum(BatchSelectionRule), default=BatchSelectionRule.priority_fifo)
    allow_cycle_mixing = Column(Boolean, default=True)
    trigger_mode = Column(Enum(BatchTriggerMode), default=BatchTriggerMode.manual)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
