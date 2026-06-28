from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from app.database import get_db
from app.models.product import ProductType, Size, Design, DesignSizeValidity
from app.auth import require_admin, get_current_user

router = APIRouter(prefix="/api/products", tags=["products"])


# ── Sizes ──────────────────────────────────────────────────────────────────────

@router.get("/sizes")
def list_sizes(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return [{"id": s.id, "value_mm": s.value_mm, "is_active": s.is_active} for s in db.query(Size).filter(Size.is_active == True).all()]


class SizeCreate(BaseModel):
    value_mm: int


@router.post("/sizes", status_code=201)
def create_size(body: SizeCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    s = Size(value_mm=body.value_mm)
    db.add(s)
    db.commit()
    db.refresh(s)
    return {"id": s.id, "value_mm": s.value_mm}


# ── Designs ────────────────────────────────────────────────────────────────────

def design_out(d: Design) -> dict:
    return {
        "id": d.id, "code": d.code, "description": d.description, "is_active": d.is_active,
        "valid_size_ids": [v.size_id for v in d.valid_sizes],
        "valid_sizes_mm": [v.size.value_mm for v in d.valid_sizes],
    }


@router.get("/designs")
def list_designs(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return [design_out(d) for d in db.query(Design).filter(Design.is_active == True).all()]


class DesignCreate(BaseModel):
    code: str
    description: Optional[str] = None
    valid_size_ids: List[int] = []


@router.post("/designs", status_code=201)
def create_design(body: DesignCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    d = Design(code=body.code, description=body.description)
    db.add(d)
    db.flush()
    for size_id in body.valid_size_ids:
        db.add(DesignSizeValidity(design_id=d.id, size_id=size_id))
    db.commit()
    db.refresh(d)
    return design_out(d)


@router.put("/designs/{design_id}/valid-sizes")
def update_design_sizes(design_id: int, size_ids: List[int], db: Session = Depends(get_db), _=Depends(require_admin)):
    design = db.query(Design).filter(Design.id == design_id).first()
    if not design:
        raise HTTPException(status_code=404, detail="Design not found")
    db.query(DesignSizeValidity).filter(DesignSizeValidity.design_id == design_id).delete()
    for size_id in size_ids:
        db.add(DesignSizeValidity(design_id=design_id, size_id=size_id))
    db.commit()
    db.refresh(design)
    return design_out(design)


# ── Product Types ──────────────────────────────────────────────────────────────

@router.get("/types")
def list_product_types(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return [
        {
            "id": p.id, "code": p.code, "name": p.name, "is_active": p.is_active,
            "default_cycle_type_id": p.default_cycle_type_id,
            "valid_cycle_type_ids": [ct.id for ct in p.valid_cycle_types],
        }
        for p in db.query(ProductType).all()
    ]
