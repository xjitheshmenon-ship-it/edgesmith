import enum
from sqlalchemy import Column, Integer, String, Boolean, Enum, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class WorkstationCategory(str, enum.Enum):
    cutting = "Cutting"
    heat_treatment = "Heat Treatment"
    machining = "Machining"
    grinding = "Grinding"
    coating = "Coating"
    qc = "QC"
    packing = "Packing"
    other = "Other"


class FactoryLocation(Base):
    __tablename__ = "factory_locations"

    id = Column(Integer, primary_key=True)
    code = Column(String(16), unique=True, nullable=False)
    name = Column(String(128), nullable=False)
    is_active = Column(Boolean, default=True)

    workstations = relationship("Workstation", back_populates="factory_location")
    storage_locations = relationship("StorageLocation", back_populates="factory_location")
    uids = relationship("UID", back_populates="factory_location")


class Workstation(Base):
    __tablename__ = "workstations"

    id = Column(Integer, primary_key=True)
    code = Column(String(32), unique=True, nullable=False, index=True)
    name = Column(String(128), nullable=False)
    category = Column(Enum(WorkstationCategory), nullable=False, default=WorkstationCategory.other)
    # NULL means available at all locations
    factory_location_id = Column(Integer, ForeignKey("factory_locations.id"), nullable=True)
    factory_location = relationship("FactoryLocation", back_populates="workstations")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    cycle_steps = relationship("CycleStep", back_populates="workstation")
    uid_step_histories = relationship("UIDStepHistory", back_populates="workstation")


class StorageLocation(Base):
    __tablename__ = "storage_locations"

    id = Column(Integer, primary_key=True)
    code = Column(String(32), unique=True, nullable=False, index=True)
    name = Column(String(128), nullable=True)
    factory_location_id = Column(Integer, ForeignKey("factory_locations.id"), nullable=True)
    factory_location = relationship("FactoryLocation", back_populates="storage_locations")
    is_active = Column(Boolean, default=True)
