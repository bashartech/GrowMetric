# Security Checklist

Cross-cutting security rules for TypeScript/Next.js and Python/FastAPI. Apply these whenever code handles user input, authentication, database queries, file operations, or external API calls.

---

## 1. Input Validation at System Boundaries

Validate ALL external input — user forms, API requests, URL params, file uploads. Internal function calls between trusted modules do not need re-validation.

### TypeScript

```typescript
// ❌ Trusting raw input
const handler = async (req: NextRequest) => {
  const { email, role } = await req.json()
  await db.users.create({ data: { email, role } }) // Arbitrary role injection
}

// ✅ Validate with Zod at the boundary
import { z } from "zod"

const createUserSchema = z.object({
  email: z.string().email(),
  role: z.enum(["user", "moderator"]), // Only allowed roles
})

const handler = async (req: NextRequest) => {
  const body = createUserSchema.parse(await req.json())
  await db.users.create({ data: body })
}
```

### Python

```python
# ❌ Trusting raw query parameters
@router.get("/users")
async def list_users(role: str, limit: int):
    return await db.execute(select(User).where(User.role == role).limit(limit))

# ✅ Constrained with Pydantic / Path/Query validators
from fastapi import Query
from typing import Literal

@router.get("/users", response_model=list[UserResponse])
async def list_users(
    role: Literal["user", "admin", "moderator"] = Query("user"),
    limit: int = Query(default=20, ge=1, le=100),
    service: UserService = Depends(get_user_service),
) -> list[UserResponse]:
    return await service.list_users(role=role, limit=limit)
```

---

## 2. SQL Injection Prevention

Never construct SQL queries with string concatenation or f-strings.

```python
# ❌ SQL injection vulnerability
async def search_users(query: str) -> list[User]:
    result = await db.execute(text(f"SELECT * FROM users WHERE name LIKE '%{query}%'"))
    return result.all()

# ✅ Parameterized query
async def search_users(query: str) -> list[User]:
    result = await db.execute(
        text("SELECT * FROM users WHERE name LIKE :query"),
        {"query": f"%{query}%"},
    )
    return result.all()

# ✅ Even better — use ORM
async def search_users(query: str) -> list[User]:
    result = await db.execute(
        select(User).where(User.name.ilike(f"%{query}%"))
    )
    return result.scalars().all()
```

---

## 3. Secrets Management

### Never Hardcode Secrets

```typescript
// ❌ Hardcoded secret — visible in source control
const API_KEY = "sk-1234567890abcdef"
const DATABASE_URL = "postgresql://admin:password@prod-db:5432/app"

// ✅ Environment variables
const API_KEY = process.env.API_KEY
const DATABASE_URL = process.env.DATABASE_URL

if (!API_KEY) throw new Error("API_KEY environment variable is required")
```

```python
# ❌ Hardcoded secret
SECRET_KEY = "my-super-secret-key"

# ✅ Environment variable with pydantic-settings
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    secret_key: str
    database_url: str
    api_key: str

    model_config = SettingsConfigDict(env_file=".env")

settings = Settings()
```

### Files That Must NEVER Be Committed

If you see any of these files untracked, warn the user immediately:
- `.env`, `.env.local`, `.env.production`
- `credentials.json`, `service-account.json`
- `*.pem`, `*.key`, `*.cert`
- `secrets.yaml`, `secrets.json`

Verify `.gitignore` includes them.

---

## 4. Authentication & Authorization

### Always Verify Permissions

```python
# ❌ Checks authentication but not authorization
@router.delete("/users/{user_id}")
async def delete_user(user_id: str, current_user: CurrentUser) -> None:
    await service.delete(user_id)  # Any authenticated user can delete anyone

# ✅ Verify the user has permission
@router.delete("/users/{user_id}")
async def delete_user(user_id: str, current_user: CurrentUser) -> None:
    if current_user.id != user_id and current_user.role != "admin":
        raise ForbiddenError("Cannot delete another user's account")
    await service.delete(user_id)
```

### Protect Against IDOR (Insecure Direct Object Reference)

```typescript
// ❌ User can access any order by guessing IDs
const getOrder = async (orderId: string) => {
  return await db.orders.findUnique({ where: { id: orderId } })
}

// ✅ Scope query to the authenticated user
const getOrder = async (orderId: string, userId: string) => {
  const order = await db.orders.findUnique({
    where: { id: orderId, userId }, // Must belong to this user
  })
  if (!order) throw new NotFoundError("Order", orderId)
  return order
}
```

---

## 5. XSS Prevention

### React (Built-in Protection)

React auto-escapes JSX content. But these patterns bypass it:

```typescript
// ❌ Directly inserting HTML — XSS vector
const Comment = ({ html }: { html: string }) => {
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}

// ✅ If you MUST render HTML, sanitize first
import DOMPurify from "dompurify"

const Comment = ({ html }: { html: string }) => {
  const clean = DOMPurify.sanitize(html)
  return <div dangerouslySetInnerHTML={{ __html: clean }} />
}

// ✅ Best — avoid dangerouslySetInnerHTML entirely
// Use a markdown renderer or structured content instead
```

---

## 6. Rate Limiting & DoS Prevention

### API Endpoints Must Have Limits

```python
# For FastAPI: use slowapi or custom middleware
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@router.post("/login")
@limiter.limit("5/minute")
async def login(request: Request, credentials: LoginRequest) -> TokenResponse:
    ...
```

### Pagination Is Required

Never return unbounded query results:

```python
# ❌ Returns entire table
@router.get("/users")
async def list_users(db: DB) -> list[UserResponse]:
    result = await db.execute(select(User))
    return result.scalars().all()

# ✅ Paginated with hard ceiling
@router.get("/users", response_model=PaginatedResponse[UserResponse])
async def list_users(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    db: DB = Depends(get_db),
) -> PaginatedResponse[UserResponse]:
    ...
```

---

## 7. File Upload Security

```python
# ❌ Accepts any file, uses user-provided filename
@router.post("/upload")
async def upload(file: UploadFile) -> dict:
    path = f"uploads/{file.filename}"  # Path traversal: "../../../etc/passwd"
    with open(path, "wb") as f:
        f.write(await file.read())  # No size limit — OOM risk

# ✅ Validate type, limit size, generate safe filename
import uuid
from pathlib import Path

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_SIZE = 5 * 1024 * 1024  # 5MB

@router.post("/upload")
async def upload(file: UploadFile) -> dict:
    if file.content_type not in ALLOWED_TYPES:
        raise ValidationError("file", f"Type {file.content_type} not allowed")

    content = await file.read()
    if len(content) > MAX_SIZE:
        raise ValidationError("file", "File exceeds 5MB limit")

    ext = Path(file.filename).suffix if file.filename else ".bin"
    safe_name = f"{uuid.uuid4()}{ext}"
    save_path = Path("uploads") / safe_name
    save_path.write_bytes(content)

    return {"filename": safe_name}
```

---

## Quick Scan Checklist

Before submitting any code that handles external data:

```
□ All user input validated at the boundary (Zod / Pydantic)
□ No string-concatenated SQL — parameterized or ORM only
□ No hardcoded secrets — all from environment variables
□ No dangerouslySetInnerHTML without DOMPurify
□ Authorization checked (not just authentication)
□ IDOR prevented — queries scoped to authenticated user
□ File uploads validated (type, size, safe filename)
□ API responses paginated with hard ceiling
□ CORS configured to specific origins (not wildcard *)
□ Error responses don't leak stack traces or internal details
□ .env files in .gitignore
```
