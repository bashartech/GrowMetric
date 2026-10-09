# Python & FastAPI Code Quality Rules

Detailed rules and patterns for production-grade Python and FastAPI code. This supplements the main SKILL.md with language-specific depth.

## Type Hints

### Every Function Gets Full Type Hints

No exceptions. Parameters AND return types:

```python
# ❌ No type hints — caller has no idea what this returns
def get_users(filters, page, limit):
    ...

# ❌ Partial — missing return type
def get_users(filters: dict, page: int, limit: int):
    ...

# ✅ Complete — clear contract
async def get_users(
    filters: UserFilters,
    page: int = 1,
    limit: int = 20,
) -> PaginatedResponse[User]:
    ...
```

### Modern Python Type Syntax (3.10+)

```python
# ❌ Old style
from typing import Optional, List, Dict, Tuple, Union

def process(items: List[str]) -> Optional[Dict[str, int]]:
    ...

# ✅ Modern style — built-in generics + union operator
def process(items: list[str]) -> dict[str, int] | None:
    ...
```

### Use TypeAlias for Complex Types

```python
from typing import TypeAlias

# ❌ Repeated complex types
def save(data: dict[str, list[tuple[str, int]]]): ...
def load() -> dict[str, list[tuple[str, int]]]: ...

# ✅ Named type alias — defined once, used everywhere
ScoreBoard: TypeAlias = dict[str, list[tuple[str, int]]]

def save(data: ScoreBoard) -> None: ...
def load() -> ScoreBoard: ...
```

---

## FastAPI-Specific Rules

### Thin Routers — Fat Services

Route handlers should do exactly three things: validate input, call a service, return a response. All business logic lives in `service.py`:

```python
# ❌ Business logic in the router — untestable, unreusable
# router.py
@router.post("/users", status_code=201)
async def create_user(user_in: UserCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == user_in.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email exists")
    
    hashed = bcrypt.hash(user_in.password)
    user = User(name=user_in.name, email=user_in.email, password=hashed)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    
    # Send welcome email
    await send_email(user.email, "Welcome!", render_template("welcome.html", user=user))
    
    # Create audit log
    await db.execute(insert(AuditLog).values(action="user_created", user_id=user.id))
    await db.commit()
    
    return UserResponse.model_validate(user)

# ✅ Router is thin — calls service
# router.py
@router.post("/users", status_code=201, response_model=UserResponse)
async def create_user(
    user_in: UserCreate,
    service: UserService = Depends(get_user_service),
) -> UserResponse:
    return await service.create_user(user_in)

# service.py
class UserService:
    def __init__(self, db: AsyncSession, email_client: EmailClient) -> None:
        self.db = db
        self.email_client = email_client

    async def create_user(self, user_in: UserCreate) -> UserResponse:
        await self._check_email_unique(user_in.email)
        user = await self._save_user(user_in)
        await self._send_welcome_email(user)
        await self._create_audit_log(user, "user_created")
        return UserResponse.model_validate(user)
```

### Pydantic Schemas — Always in schemas.py

```python
# ❌ Schemas defined in the router file
# router.py
from pydantic import BaseModel

class UserCreate(BaseModel):
    name: str
    email: str

@router.post("/users")
async def create_user(user: UserCreate): ...

# ✅ Schemas in their own file
# schemas.py
from pydantic import BaseModel, Field, EmailStr

class UserBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr

class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)

class UserResponse(UserBase):
    id: str
    created_at: datetime
    is_active: bool

    model_config = ConfigDict(from_attributes=True)

class UserUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    email: EmailStr | None = None
```

### Custom Exceptions — Not Raw HTTPException

```python
# ❌ HTTPException scattered throughout service code
async def get_user(user_id: str) -> User:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

# ✅ Domain exceptions in exceptions.py — router translates to HTTP
# exceptions.py
class AppError(Exception):
    """Base application exception."""

class NotFoundError(AppError):
    def __init__(self, resource: str, identifier: str) -> None:
        self.resource = resource
        self.identifier = identifier
        super().__init__(f"{resource} not found: {identifier}")

class ConflictError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__(message)

class ValidationError(AppError):
    def __init__(self, field: str, message: str) -> None:
        self.field = field
        super().__init__(f"Validation error on '{field}': {message}")

# service.py — raises domain exceptions
async def get_user(self, user_id: str) -> User:
    user = await self.db.get(User, user_id)
    if not user:
        raise NotFoundError("User", user_id)
    return user

# main.py — exception handlers translate to HTTP
@app.exception_handler(NotFoundError)
async def not_found_handler(request: Request, exc: NotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})

@app.exception_handler(ConflictError)
async def conflict_handler(request: Request, exc: ConflictError) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": str(exc)})
```

### Dependencies — Typed with Annotated

```python
from typing import Annotated
from fastapi import Depends

# dependencies.py
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session

async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    payload = verify_token(token)
    user = await db.get(User, payload.sub)
    if not user:
        raise NotFoundError("User", payload.sub)
    return user

# Type aliases for clean router signatures
DB = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]

# router.py — clean signatures
@router.get("/me", response_model=UserResponse)
async def get_me(user: CurrentUser) -> UserResponse:
    return UserResponse.model_validate(user)

@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user(user_id: str, db: DB, _: CurrentUser) -> UserResponse:
    ...
```

---

## Async Patterns

### Never Block the Event Loop

```python
# ❌ Blocking I/O in async function — freezes ALL concurrent requests
async def generate_report(data: ReportData) -> bytes:
    with open("template.docx", "rb") as f:  # BLOCKS
        template = f.read()
    result = render_pdf(template, data)  # BLOCKS (CPU-bound)
    return result

# ✅ Use asyncio.to_thread for blocking operations
import asyncio

async def generate_report(data: ReportData) -> bytes:
    return await asyncio.to_thread(_generate_report_sync, data)

def _generate_report_sync(data: ReportData) -> bytes:
    with open("template.docx", "rb") as f:
        template = f.read()
    return render_pdf(template, data)
```

### Proper Async DB Patterns

```python
# ❌ Synchronous SQLAlchemy in async endpoint
@router.get("/users")
async def list_users(db: Session = Depends(get_db)):
    return db.query(User).all()  # BLOCKS

# ✅ Async SQLAlchemy
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

@router.get("/users", response_model=list[UserResponse])
async def list_users(db: DB) -> list[UserResponse]:
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()
    return [UserResponse.model_validate(u) for u in users]
```

---

## Error Handling

### Specific Exceptions Only

```python
# ❌ Bare except — catches SystemExit, KeyboardInterrupt, everything
try:
    result = await external_api.fetch(resource_id)
except:
    return None

# ❌ Broad Exception with pass — silently swallows bugs
try:
    result = await external_api.fetch(resource_id)
except Exception:
    pass

# ✅ Specific exceptions with proper handling
try:
    result = await external_api.fetch(resource_id)
except httpx.TimeoutException:
    logger.warning("API timeout for resource %s", resource_id)
    raise ServiceUnavailableError("External API timed out")
except httpx.HTTPStatusError as e:
    logger.error("API error %d: %s", e.response.status_code, e.response.text)
    raise ExternalServiceError(f"API returned {e.response.status_code}")
```

### Exception Chaining

```python
# ❌ Original error lost
try:
    data = json.loads(raw_body)
except json.JSONDecodeError:
    raise ValidationError("body", "Invalid JSON")

# ✅ Chain preserves original cause for debugging
try:
    data = json.loads(raw_body)
except json.JSONDecodeError as e:
    raise ValidationError("body", "Invalid JSON") from e
```

---

## Logging

### Always Use logging, Never print()

```python
import logging

logger = logging.getLogger(__name__)

# ❌ print — no severity, no timestamps, no filtering
print(f"Processing user {user_id}")
print(f"Error: {e}")

# ✅ Structured logging with proper levels
logger.info("Processing user %s", user_id)
logger.error("Failed to process user %s: %s", user_id, e, exc_info=True)
logger.warning("Rate limit approaching: %d/%d", current, limit)
logger.debug("Query result: %s", result)
```

### Use %-formatting, Not f-strings in Logging

```python
# ❌ f-string — always evaluated, even if log level is disabled
logger.debug(f"Processing {len(items)} items: {items}")

# ✅ %-formatting — only formatted if log level is active
logger.debug("Processing %d items: %s", len(items), items)
```

---

## Project Structure Template

For a new FastAPI feature/module:

```
users/
├── __init__.py
├── router.py              # Route handlers — thin, no business logic
├── schemas.py             # Pydantic models — UserCreate, UserResponse, etc.
├── models.py              # SQLAlchemy models — User table definition
├── service.py             # Business logic — UserService class
├── dependencies.py        # FastAPI dependencies — get_current_user, etc.
├── constants.py           # Feature-specific constants
├── exceptions.py          # Domain exceptions — UserNotFoundError, etc.
└── utils.py               # Feature-specific utilities
```

**Router file template:**

```python
# router.py
from typing import Annotated
from fastapi import APIRouter, Depends, status

from .schemas import UserCreate, UserResponse, UserUpdate
from .service import UserService
from .dependencies import get_user_service

router = APIRouter(prefix="/users", tags=["users"])

Service = Annotated[UserService, Depends(get_user_service)]


@router.post("/", status_code=status.HTTP_201_CREATED, response_model=UserResponse)
async def create_user(user_in: UserCreate, service: Service) -> UserResponse:
    return await service.create(user_in)


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(user_id: str, service: Service) -> UserResponse:
    return await service.get_by_id(user_id)


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str, user_in: UserUpdate, service: Service
) -> UserResponse:
    return await service.update(user_id, user_in)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: str, service: Service) -> None:
    await service.delete(user_id)
```

---

## Testing Patterns

### Test File Structure

```python
# tests/test_user_service.py
import pytest
from unittest.mock import AsyncMock

from app.users.service import UserService
from app.users.schemas import UserCreate
from app.users.exceptions import NotFoundError


@pytest.fixture
def mock_db() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def service(mock_db: AsyncMock) -> UserService:
    return UserService(db=mock_db)


class TestCreateUser:
    async def test_creates_user_with_valid_input(self, service: UserService) -> None:
        user_in = UserCreate(name="Alice", email="alice@test.com", password="secure123")
        result = await service.create(user_in)
        assert result.name == "Alice"
        assert result.email == "alice@test.com"

    async def test_raises_conflict_for_duplicate_email(
        self, service: UserService, mock_db: AsyncMock
    ) -> None:
        mock_db.execute.return_value.scalar_one_or_none.return_value = True
        with pytest.raises(ConflictError, match="Email already exists"):
            await service.create(UserCreate(
                name="Alice", email="taken@test.com", password="secure123"
            ))


class TestGetUser:
    async def test_returns_user_when_found(self, service: UserService) -> None:
        ...

    async def test_raises_not_found_for_missing_user(
        self, service: UserService, mock_db: AsyncMock
    ) -> None:
        mock_db.get.return_value = None
        with pytest.raises(NotFoundError, match="User not found"):
            await service.get_by_id("nonexistent-id")
```

### Test Naming Convention

```python
# Pattern: test_{action}_{scenario}
# ✅ Clear, descriptive
async def test_creates_user_with_valid_input(): ...
async def test_raises_conflict_for_duplicate_email(): ...
async def test_returns_empty_list_when_no_users(): ...
async def test_paginates_results_with_offset_and_limit(): ...

# ❌ Vague, tells nothing about what's being tested
async def test_create_user(): ...
async def test_user_error(): ...
async def test_list(): ...
```
