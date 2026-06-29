from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, Text, Float, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class TemperingParameter(Base):
    """Admin-configured target parameters per tempering step per cycle type."""
    __tablename__ = "tempering_parameters"

    id = Column(Integer, primary_key=True)
    cycle_type_id = Column(Integer, ForeignKey("cycle_types.id"), nullable=False)
    cycle_type = relationship("CycleType")

    cycle_step_id = Column(Integer, ForeignKey("cycle_steps.id"), nullable=False)
    cycle_step = relationship("CycleStep")

    target_temp_c = Column(Float, nullable=False)
    target_soak_minutes = Column(Integer, nullable=False)
    tolerance_temp_c = Column(Float, default=5.0)
    tolerance_soak_minutes = Column(Integer, default=5)

    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)


class FurnaceBatch(Base):
    __tablename__ = "furnace_batches"

    id = Column(Integer, primary_key=True)
    batch_number = Column(String(32), unique=True, nullable=False, index=True)

    cycle_type_id = Column(Integer, ForeignKey("cycle_types.id"), nullable=False)
    cycle_type = relationship("CycleType")

    cycle_step_id = Column(Integer, ForeignKey("cycle_steps.id"), nullable=False)
    cycle_step = relationship("CycleStep")

    tempering_parameter_id = Column(Integer, ForeignKey("tempering_parameters.id"), nullable=True)
    tempering_parameter = relationship("TemperingParameter")

    target_temp_c = Column(Float, nullable=True)
    target_soak_minutes = Column(Integer, nullable=True)

    actual_temp_c = Column(Float, nullable=True)
    actual_soak_minutes = Column(Integer, nullable=True)
    actuals_recorded = Column(Boolean, default=False)

    deviation_flagged = Column(Boolean, default=False)
    deviation_notes = Column(Text, nullable=True)

    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)

    operator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    operator = relationship("User", foreign_keys=[operator_id])

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    uid_entries = relationship("FurnaceBatchUID", back_populates="furnace_batch")


class FurnaceBatchUID(Base):
    __tablename__ = "furnace_batch_uids"

    id = Column(Integer, primary_key=True)
    furnace_batch_id = Column(Integer, ForeignKey("furnace_batches.id"), nullable=False)
    furnace_batch = relationship("FurnaceBatch", back_populates="uid_entries")

    uid_id = Column(Integer, ForeignKey("uids.id"), nullable=False)
    uid = relationship("UID")

    step_history_id = Column(Integer, ForeignKey("uid_step_history.id"), nullable=True)

    added_at = Column(DateTime(timezone=True), server_default=func.now())
