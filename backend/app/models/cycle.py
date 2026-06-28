from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, Text, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class CycleType(Base):
    __tablename__ = "cycle_types"

    id = Column(Integer, primary_key=True)
    name = Column(String(32), unique=True, nullable=False)       # EAT, SWAN, OVEN
    letter_prefix = Column(String(1), unique=True, nullable=False)  # E, S, O
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    is_archived = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    versions = relationship("CycleVersion", back_populates="cycle_type", order_by="CycleVersion.version_number")
    uids = relationship("UID", back_populates="cycle_type")

    @property
    def current_version(self):
        active = [v for v in self.versions if v.is_current]
        return active[0] if active else None


class CycleVersion(Base):
    __tablename__ = "cycle_versions"

    id = Column(Integer, primary_key=True)
    cycle_type_id = Column(Integer, ForeignKey("cycle_types.id"), nullable=False)
    cycle_type = relationship("CycleType", back_populates="versions")
    version_number = Column(Integer, nullable=False)
    is_current = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    change_notes = Column(Text, nullable=True)

    steps = relationship("CycleStep", back_populates="cycle_version", order_by="CycleStep.step_number")
    uids = relationship("UID", back_populates="cycle_version")


class CycleStep(Base):
    __tablename__ = "cycle_steps"

    id = Column(Integer, primary_key=True)
    cycle_version_id = Column(Integer, ForeignKey("cycle_versions.id"), nullable=False)
    cycle_version = relationship("CycleVersion", back_populates="steps")

    step_number = Column(String(8), nullable=False)   # "1", "16", "16B"
    step_order = Column(Integer, nullable=False)       # for sorting
    operation_name = Column(String(128), nullable=False)
    workstation_id = Column(Integer, ForeignKey("workstations.id"), nullable=False)
    workstation = relationship("Workstation", back_populates="cycle_steps")
    from_storage_id = Column(Integer, ForeignKey("storage_locations.id"), nullable=True)
    from_storage = relationship("StorageLocation", foreign_keys=[from_storage_id])
    to_storage_id = Column(Integer, ForeignKey("storage_locations.id"), nullable=True)
    to_storage = relationship("StorageLocation", foreign_keys=[to_storage_id])
    is_converting_step = Column(Boolean, default=False)   # Step 16
    is_child_marking_step = Column(Boolean, default=False)  # Step 16B
    is_qc_step = Column(Boolean, default=False)
    extra_config = Column(JSON, nullable=True)
