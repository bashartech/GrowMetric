# ===========================================
# EXAMPLE: Complete CRUD Router
# File: app/routers/items.py
# ===========================================

from fastapi import APIRouter, Depends, HTTPException, Query, Path, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Annotated, List, Optional
from pydantic import BaseModel, Field
from datetime import datetime

from app.db.database import get_db
from app.db.models import Item
from app.dependencies.auth import get_current_active_user
from app.models.user import User

router = APIRouter(
    prefix="/items",
    tags=["items"],
    responses={404: {"description": "Item not found"}},
)


# ===========================================
# Pydantic Models
# ===========================================

class ItemBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=1000)
    price: float = Field(..., gt=0)
    is_available: bool = True


class ItemCreate(ItemBase):
    pass


class ItemUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=1000)
    price: Optional[float] = Field(None, gt=0)
    is_available: Optional[bool] = None


class ItemResponse(ItemBase):
    id: int
    owner_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class PaginatedItems(BaseModel):
    items: List[ItemResponse]
    total: int
    page: int
    per_page: int
    pages: int


# ===========================================
# Dependencies
# ===========================================

async def get_item_or_404(
    item_id: int = Path(..., gt=0),
    db: AsyncSession = Depends(get_db),
) -> Item:
    """Dependency to get item or raise 404."""
    result = await db.execute(select(Item).where(Item.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Item with id {item_id} not found",
        )
    return item


async def verify_item_owner(
    item: Annotated[Item, Depends(get_item_or_404)],
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> Item:
    """Verify the current user owns the item."""
    if item.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this item",
        )
    return item


# ===========================================
# Routes
# ===========================================

@router.get("/", response_model=PaginatedItems)
async def list_items(
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=100, description="Items per page"),
    search: Optional[str] = Query(None, description="Search in name"),
    is_available: Optional[bool] = Query(None, description="Filter by availability"),
):
    """
    List all items with pagination and filtering.

    - **page**: Page number (default: 1)
    - **per_page**: Items per page (default: 20, max: 100)
    - **search**: Optional search term for item name
    - **is_available**: Optional filter by availability
    """
    # Build query
    query = select(Item)

    if search:
        query = query.where(Item.name.ilike(f"%{search}%"))
    if is_available is not None:
        query = query.where(Item.is_available == is_available)

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # Get paginated items
    offset = (page - 1) * per_page
    query = query.offset(offset).limit(per_page).order_by(Item.created_at.desc())
    result = await db.execute(query)
    items = result.scalars().all()

    return PaginatedItems(
        items=items,
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page if total > 0 else 0,
    )


@router.get("/my", response_model=List[ItemResponse])
async def list_my_items(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
):
    """List items owned by the current user."""
    result = await db.execute(
        select(Item)
        .where(Item.owner_id == current_user.id)
        .offset(skip)
        .limit(limit)
        .order_by(Item.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{item_id}", response_model=ItemResponse)
async def get_item(
    item: Annotated[Item, Depends(get_item_or_404)],
):
    """Get a specific item by ID."""
    return item


@router.post(
    "/",
    response_model=ItemResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        201: {"description": "Item created successfully"},
        401: {"description": "Not authenticated"},
        422: {"description": "Validation error"},
    },
)
async def create_item(
    item_data: ItemCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_active_user)],
):
    """
    Create a new item.

    - **name**: Item name (required, 1-100 characters)
    - **description**: Item description (optional, max 1000 characters)
    - **price**: Item price (required, must be positive)
    - **is_available**: Availability status (default: true)
    """
    item = Item(
        **item_data.model_dump(),
        owner_id=current_user.id,
    )
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return item


@router.put("/{item_id}", response_model=ItemResponse)
async def update_item(
    item_data: ItemUpdate,
    item: Annotated[Item, Depends(verify_item_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Update an existing item.

    Only the item owner can update it.
    Only provided fields will be updated.
    """
    update_data = item_data.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(item, field, value)

    await db.flush()
    await db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=ItemResponse)
async def partial_update_item(
    item_data: ItemUpdate,
    item: Annotated[Item, Depends(verify_item_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Partially update an item.

    Same as PUT but explicitly for partial updates.
    """
    update_data = item_data.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(item, field, value)

    await db.flush()
    await db.refresh(item)
    return item


@router.delete(
    "/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        204: {"description": "Item deleted successfully"},
        403: {"description": "Not authorized"},
        404: {"description": "Item not found"},
    },
)
async def delete_item(
    item: Annotated[Item, Depends(verify_item_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Delete an item.

    Only the item owner can delete it.
    """
    await db.delete(item)
    return None


@router.post("/{item_id}/toggle-availability", response_model=ItemResponse)
async def toggle_item_availability(
    item: Annotated[Item, Depends(verify_item_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Toggle item availability status."""
    item.is_available = not item.is_available
    await db.flush()
    await db.refresh(item)
    return item


# ===========================================
# EXAMPLE: Main App Integration
# File: app/main.py
# ===========================================

"""
from fastapi import FastAPI
from app.routers import items, users, auth

app = FastAPI(
    title="My API",
    description="API with CRUD operations",
    version="1.0.0",
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(items.router, prefix="/api/v1")
"""


# ===========================================
# EXAMPLE: SQLAlchemy Model
# File: app/db/models.py
# ===========================================

"""
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base


class Item(Base):
    __tablename__ = "items"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, index=True)
    description = Column(Text, nullable=True)
    price = Column(Float, nullable=False)
    is_available = Column(Boolean, default=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    owner = relationship("User", back_populates="items")
"""
