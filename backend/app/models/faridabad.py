import enum
from sqlalchemy import Column, Integer, String, Boolean, Enum, ForeignKey, DateTime, Text, Float, Date
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class RollingContractor(Base):
    __tablename__ = "rolling_contractors"

    id = Column(Integer, primary_key=True)
    name = Column(String(256), unique=True, nullable=False)
    contact_info = Column(String(256), nullable=True)
    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class MaterialType(str, enum.Enum):
    alloy_steel = "Alloy Steel"
    ms = "MS"


class RawMaterialIntake(Base):
    __tablename__ = "raw_material_intakes"

    id = Column(Integer, primary_key=True)
    material_type = Column(Enum(MaterialType), nullable=False)
    supplier_name = Column(String(256), nullable=False)
    heat_number = Column(String(64), nullable=False)
    steel_grade = Column(String(64), nullable=False)
    weight_kg = Column(Float, nullable=True)
    date_received = Column(Date, nullable=False)
    num_bars = Column(Integer, nullable=True)
    bar_dimensions_mm = Column(String(64), nullable=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    joining_ops_alloy = relationship("JoiningOperation", foreign_keys="JoiningOperation.alloy_intake_id", back_populates="alloy_intake")
    joining_ops_ms = relationship("JoiningOperation", foreign_keys="JoiningOperation.ms_intake_id", back_populates="ms_intake")


class JoiningOperation(Base):
    __tablename__ = "joining_operations"

    id = Column(Integer, primary_key=True)
    alloy_intake_id = Column(Integer, ForeignKey("raw_material_intakes.id"), nullable=False)
    alloy_intake = relationship("RawMaterialIntake", foreign_keys=[alloy_intake_id], back_populates="joining_ops_alloy")

    ms_intake_id = Column(Integer, ForeignKey("raw_material_intakes.id"), nullable=False)
    ms_intake = relationship("RawMaterialIntake", foreign_keys=[ms_intake_id], back_populates="joining_ops_ms")

    num_billets_produced = Column(Integer, nullable=False)
    output_billet_dimensions_mm = Column(String(64), nullable=True)
    operator_name = Column(String(128), nullable=True)
    date_joined = Column(Date, nullable=False)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    dispatches = relationship("FaridabadDispatch", back_populates="joining_operation")


class FaridabadDispatch(Base):
    __tablename__ = "faridabad_dispatches"

    id = Column(Integer, primary_key=True)
    batch_reference = Column(String(64), unique=True, nullable=False, index=True)
    joining_operation_id = Column(Integer, ForeignKey("joining_operations.id"), nullable=False)
    joining_operation = relationship("JoiningOperation", back_populates="dispatches")

    rolling_contractor_name = Column(String(256), nullable=False)
    num_billets_dispatched = Column(Integer, nullable=False)
    date_dispatched = Column(Date, nullable=False)
    billet_dimensions_mm = Column(String(64), nullable=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    receiving_events = relationship("ReceivingEvent", back_populates="faridabad_dispatch")


class ReceivingEvent(Base):
    __tablename__ = "receiving_events"

    id = Column(Integer, primary_key=True)
    faridabad_dispatch_id = Column(Integer, ForeignKey("faridabad_dispatches.id"), nullable=False)
    faridabad_dispatch = relationship("FaridabadDispatch", back_populates="receiving_events")

    date_received = Column(Date, nullable=False)
    num_billets_received = Column(Integer, nullable=False)
    condition = Column(String(128), nullable=True)
    received_by = Column(String(128), nullable=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
