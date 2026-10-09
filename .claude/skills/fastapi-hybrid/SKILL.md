---
name: FastAPI Development (Hybrid)
description: This skill should be used when the user asks to "create a FastAPI app", "add an API endpoint", "create a REST API", "implement authentication", "add OAuth2", "create Pydantic models", "add request validation", "implement dependency injection", "create API routers", "add middleware", "handle errors in FastAPI", "create background tasks", "add WebSocket endpoints", "implement CRUD operations", or mentions FastAPI, Pydantic, async Python APIs, or Starlette.
version: 1.0.0
---

# FastAPI Development Guide (Hybrid Knowledge System)

This skill provides curated FastAPI guidance with intelligent escalation to Context7 MCP for advanced topics.

## Knowledge Tier System

This skill operates on a **tiered knowledge model**:

### Tier 1: This Skill (Use First)
Covers 90% of common FastAPI tasks with curated, tested patterns:
- Application setup and structure
- Pydantic models and validation
- CRUD operations and routers
- Dependency injection
- OAuth2/JWT authentication
- Error handling
- Middleware
- Background tasks
- Testing basics

### Tier 2: Context7 MCP (Escalate When Needed)

**IMPORTANT**: Escalate to Context7 MCP server when the user's query matches ANY of these conditions:

#### Automatic Escalation Triggers

1. **Version-Specific Questions**
   - "FastAPI 0.100+", "latest version", "new in FastAPI"
   - "Pydantic v2", "migration from v1"
   - Use: `mcp__context7__query-docs` with `/websites/fastapi_tiangolo`

2. **Advanced Topics Not Covered Here**
   - WebSockets beyond basics
   - GraphQL integration
   - OpenTelemetry/tracing
   - Custom OpenAPI schema modifications
   - Strawberry GraphQL
   - Server-Sent Events (SSE)

3. **Specific Error Messages**
   - When user pastes an error message
   - Query Context7 with the exact error text

4. **Third-Party Integrations**
   - Specific database drivers (asyncpg, aiomysql)
   - Message queues (Celery, RQ, ARQ)
   - Caching (Redis, memcached)
   - Search (Elasticsearch, Meilisearch)

5. **User Explicitly Requests**
   - "show me the official docs"
   - "what does the documentation say"
   - "latest best practices"
   - "more details about X"

#### Escalation Protocol

When escalating to Context7, use this pattern:

```
1. First, acknowledge what you know from this skill
2. Then fetch additional details:
   - Resolve library: mcp__context7__resolve-library-id("fastapi", "user's specific question")
   - Query docs: mcp__context7__query-docs("/websites/fastapi_tiangolo", "specific topic")
3. Synthesize skill knowledge + Context7 results
4. Provide unified response with both curated pattern AND latest docs
```

---

## Tier 1 Knowledge: Core Patterns

### Application Structure (Curated)

```
project/
├── app/
│   ├── __init__.py
│   ├── main.py              # Application entry point
│   ├── config.py            # Settings (pydantic-settings)
│   ├── dependencies.py      # Shared dependencies
│   ├── models/              # Pydantic schemas
│   ├── routers/             # API route handlers
│   ├── services/            # Business logic
│   └── db/                  # Database (SQLAlchemy)
├── tests/
└── pyproject.toml
```

### Basic Application Setup

```python
from fastapi import FastAPI
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("Starting up...")
    yield
    # Shutdown
    print("Shutting down...")

app = FastAPI(
    title="My API",
    description="API description",
    version="1.0.0",
    lifespan=lifespan,
)
```

### Pydantic Models (v2 Syntax)

```python
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from typing import Optional
from datetime import datetime

class UserBase(BaseModel):
    email: EmailStr
    username: str = Field(..., min_length=3, max_length=50)

class UserCreate(UserBase):
    password: str = Field(..., min_length=8)

class UserResponse(UserBase):
    id: int
    created_at: datetime
    is_active: bool = True

    model_config = ConfigDict(from_attributes=True)
```

> **ESCALATION NOTE**: For Pydantic v1 to v2 migration details, query Context7:
> `mcp__context7__query-docs("/pydantic/pydantic", "migration from v1 to v2")`

### Path Operations

```python
from fastapi import Path, Query, Body, HTTPException, status
from typing import Annotated

@app.get("/users/{user_id}")
async def get_user(
    user_id: Annotated[int, Path(gt=0, description="User ID")],
    include_posts: Annotated[bool, Query(description="Include posts")] = False,
):
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.post("/users/", status_code=status.HTTP_201_CREATED)
async def create_user(user: UserCreate):
    return await create_new_user(user)
```

### APIRouter Organization

```python
from fastapi import APIRouter, Depends

router = APIRouter(
    prefix="/items",
    tags=["items"],
    dependencies=[Depends(get_token_header)],
    responses={404: {"description": "Not found"}},
)

@router.get("/")
async def list_items():
    return []

# In main.py
app.include_router(router, prefix="/api/v1")
```

### Dependency Injection

```python
from fastapi import Depends
from typing import Annotated

async def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        await db.close()

async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    # Validate token and return user
    ...

@app.get("/me")
async def get_me(user: Annotated[User, Depends(get_current_user)]):
    return user
```

### OAuth2 + JWT Authentication

```python
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def create_access_token(data: dict, expires_delta: timedelta) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + expires_delta
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm="HS256")

async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]) -> User:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = await get_user_by_username(username)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user
```

> **ESCALATION NOTE**: For OAuth2 scopes, API key auth, or third-party OAuth providers,
> query Context7 for comprehensive examples.

### Error Handling

```python
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

# Custom exception
class ItemNotFoundError(Exception):
    def __init__(self, item_id: int):
        self.item_id = item_id

@app.exception_handler(ItemNotFoundError)
async def item_not_found_handler(request: Request, exc: ItemNotFoundError):
    return JSONResponse(
        status_code=404,
        content={"detail": f"Item {exc.item_id} not found"},
    )

@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
    )
```

### Middleware

```python
from fastapi.middleware.cors import CORSMiddleware
import time

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom middleware
@app.middleware("http")
async def add_timing_header(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    response.headers["X-Process-Time"] = str(time.time() - start)
    return response
```

### Background Tasks

```python
from fastapi import BackgroundTasks

async def send_email(email: str, message: str):
    # Email sending logic
    pass

@app.post("/notify/{email}")
async def send_notification(email: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(send_email, email, "Welcome!")
    return {"message": "Notification queued"}
```

---

## Tier 2 Topics: Escalate to Context7

The following topics require Context7 MCP lookup for comprehensive guidance:

### WebSockets (Advanced)
Basic pattern provided, escalate for:
- Connection managers
- Room/channel patterns
- Authentication in WebSockets
- Scaling with Redis pub/sub

```python
# Basic WebSocket (Tier 1)
from fastapi import WebSocket

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    while True:
        data = await websocket.receive_text()
        await websocket.send_text(f"Echo: {data}")
```

> **ESCALATE**: For connection managers, rooms, or scaling patterns →
> `mcp__context7__query-docs("/websites/fastapi_tiangolo", "websocket connection manager broadcast")`

### Database Patterns
Escalate for:
- Specific async drivers (asyncpg, aiomysql, motor)
- Connection pooling configuration
- Multi-database setups
- Database migrations with Alembic

> **ESCALATE**: `mcp__context7__query-docs("/websites/fastapi_tiangolo", "sqlalchemy async session")`

### Testing (Advanced)
Escalate for:
- Async test fixtures
- Database test isolation
- Mocking external services
- Integration testing patterns

> **ESCALATE**: `mcp__context7__query-docs("/websites/fastapi_tiangolo", "testing async database")`

### Deployment
Escalate for:
- Docker configuration
- Kubernetes deployment
- Gunicorn/Uvicorn workers
- Health checks for orchestrators

> **ESCALATE**: `mcp__context7__query-docs("/websites/fastapi_tiangolo", "deployment docker gunicorn")`

---

## Quick Reference

| Task | Tier | Action |
|------|------|--------|
| Create endpoint | 1 | Use patterns above |
| Add Pydantic model | 1 | Use patterns above |
| JWT auth | 1 | Use patterns above |
| WebSocket rooms | 2 | Escalate to Context7 |
| Pydantic v2 migration | 2 | Escalate to Context7 |
| Specific error message | 2 | Escalate to Context7 |
| Third-party integration | 2 | Escalate to Context7 |
| Latest FastAPI features | 2 | Escalate to Context7 |

---

## Additional Resources

### Reference Files (Tier 1 Deep-Dives)
- `references/authentication.md` - Complete auth patterns
- `references/database.md` - SQLAlchemy async patterns
- `references/testing.md` - Testing strategies

### Context7 Libraries for Escalation
- FastAPI: `/websites/fastapi_tiangolo`
- Pydantic: `/pydantic/pydantic`
- SQLAlchemy: `/sqlalchemy/sqlalchemy`
- Starlette: `/encode/starlette`
