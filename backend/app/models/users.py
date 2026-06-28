import enum
from sqlalchemy import Column, Integer, String, Boolean, Enum, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


class UserRole(str, enum.Enum):
    admin = "admin"
    manager = "manager"
    supervisor = "supervisor"
    operator = "operator"
    service = "service"
    shopfloor = "shopfloor"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    full_name = Column(String(128), nullable=False)
    email = Column(String(256), unique=True, nullable=True)
    hashed_password = Column(String(256), nullable=False)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.operator)
    is_active = Column(Boolean, default=True, nullable=False)

    # Operators and Supervisors are assigned to a primary location
    primary_location_id = Column(Integer, ForeignKey("factory_locations.id"), nullable=True)
    primary_location = relationship("FactoryLocation", foreign_keys=[primary_location_id])

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    uid_step_histories = relationship("UIDStepHistory", back_populates="performed_by_user")
