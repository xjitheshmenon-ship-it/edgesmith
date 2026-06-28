import enum
from datetime import date
from sqlalchemy import Column, Integer, String, Date, Enum, ForeignKey, DateTime, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class ShiftPeriod(str, enum.Enum):
    morning = 'morning'
    afternoon = 'afternoon'
    night = 'night'


class ShiftAssignment(Base):
    __tablename__ = 'shift_assignments'

    id = Column(Integer, primary_key=True)
    shift_date = Column(Date, nullable=False)
    shift_period = Column(Enum(ShiftPeriod), nullable=False)
    workstation_id = Column(Integer, ForeignKey('workstations.id'), nullable=False)
    operator_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    assigned_by_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    confirmed_by_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    workstation = relationship('Workstation', foreign_keys=[workstation_id])
    operator = relationship('User', foreign_keys=[operator_id])
    assigned_by = relationship('User', foreign_keys=[assigned_by_id])
    confirmed_by = relationship('User', foreign_keys=[confirmed_by_id])


class JobAllotment(Base):
    __tablename__ = 'job_allotments'

    id = Column(Integer, primary_key=True)
    uid_id = Column(Integer, ForeignKey('uids.id'), nullable=False)
    operator_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    workstation_id = Column(Integer, ForeignKey('workstations.id'), nullable=False)
    allotted_by_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    notes = Column(Text, nullable=True)
    is_active = Column(Integer, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    uid = relationship('UID', foreign_keys=[uid_id])
    operator = relationship('User', foreign_keys=[operator_id])
    workstation = relationship('Workstation', foreign_keys=[workstation_id])
    allotted_by = relationship('User', foreign_keys=[allotted_by_id])
