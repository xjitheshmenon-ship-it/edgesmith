from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, Float, Text, Table
from sqlalchemy.orm import relationship
from app.database import Base


product_cycle_association = Table(
    "product_cycle_types",
    Base.metadata,
    Column("product_type_id", Integer, ForeignKey("product_types.id")),
    Column("cycle_type_id", Integer, ForeignKey("cycle_types.id")),
)


class ProductType(Base):
    __tablename__ = "product_types"

    id = Column(Integer, primary_key=True)
    code = Column(String(32), unique=True, nullable=False)
    name = Column(String(128), nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)

    valid_cycle_types = relationship("CycleType", secondary=product_cycle_association)
    default_cycle_type_id = Column(Integer, ForeignKey("cycle_types.id"), nullable=True)
    default_cycle_type = relationship("CycleType", foreign_keys=[default_cycle_type_id])

    uids = relationship("UID", back_populates="product_type")


class Size(Base):
    __tablename__ = "sizes"

    id = Column(Integer, primary_key=True)
    value_mm = Column(Integer, unique=True, nullable=False)   # 1500, 1424, 2750
    is_active = Column(Boolean, default=True)

    uids = relationship("UID", back_populates="size")
    design_validities = relationship("DesignSizeValidity", back_populates="size")


class Design(Base):
    __tablename__ = "designs"

    id = Column(Integer, primary_key=True)
    code = Column(String(64), unique=True, nullable=False)   # Plain, 9/8534, 9/5032
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)

    valid_sizes = relationship("DesignSizeValidity", back_populates="design")
    uids = relationship("UID", back_populates="design")


class DesignSizeValidity(Base):
    """Matrix of which size-design combinations are valid."""
    __tablename__ = "design_size_validity"

    id = Column(Integer, primary_key=True)
    design_id = Column(Integer, ForeignKey("designs.id"), nullable=False)
    design = relationship("Design", back_populates="valid_sizes")
    size_id = Column(Integer, ForeignKey("sizes.id"), nullable=False)
    size = relationship("Size", back_populates="design_validities")
