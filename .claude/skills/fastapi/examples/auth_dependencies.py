# ===========================================
# EXAMPLE: Authentication Dependencies
# File: app/dependencies/auth.py
# ===========================================

from fastapi import Depends, HTTPException, status, Security, Request
from fastapi.security import (
    OAuth2PasswordBearer,
    SecurityScopes,
    APIKeyHeader,
    APIKeyQuery,
    HTTPBearer,
    HTTPAuthorizationCredentials,
)
from typing import Annotated, Optional, List
from jose import JWTError, jwt
from pydantic import BaseModel
from datetime import datetime
from enum import Enum

# ===========================================
# Configuration
# ===========================================

SECRET_KEY = "your-secret-key-change-in-production"
ALGORITHM = "HS256"
API_KEY = "your-api-key"


# ===========================================
# Models
# ===========================================

class TokenData(BaseModel):
    username: Optional[str] = None
    scopes: List[str] = []
    exp: Optional[datetime] = None


class UserRole(str, Enum):
    USER = "user"
    ADMIN = "admin"
    MODERATOR = "moderator"


class User(BaseModel):
    id: int
    username: str
    email: str
    is_active: bool = True
    role: UserRole = UserRole.USER
    scopes: List[str] = []


# ===========================================
# OAuth2 Bearer Token
# ===========================================

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="auth/token",
    scopes={
        "users:read": "Read user information",
        "users:write": "Create and update users",
        "items:read": "Read items",
        "items:write": "Create and update items",
        "admin": "Admin access",
    },
)


async def get_current_user(
    security_scopes: SecurityScopes,
    token: Annotated[str, Depends(oauth2_scheme)],
) -> User:
    """
    Validate JWT token and return current user.
    Supports scope-based authorization.
    """
    if security_scopes.scopes:
        authenticate_value = f'Bearer scope="{security_scopes.scope_str}"'
    else:
        authenticate_value = "Bearer"

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": authenticate_value},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception

        token_scopes = payload.get("scopes", [])
        token_data = TokenData(username=username, scopes=token_scopes)
    except JWTError:
        raise credentials_exception

    # Get user from database (simplified for example)
    user = await get_user_from_db(token_data.username)
    if user is None:
        raise credentials_exception

    # Check required scopes
    for scope in security_scopes.scopes:
        if scope not in token_data.scopes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not enough permissions",
                headers={"WWW-Authenticate": authenticate_value},
            )

    return user


async def get_current_active_user(
    current_user: Annotated[User, Security(get_current_user, scopes=[])],
) -> User:
    """Ensure the user is active."""
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user",
        )
    return current_user


# ===========================================
# Role-Based Access Control
# ===========================================

def require_roles(*roles: UserRole):
    """
    Factory for role-checking dependency.

    Usage:
        @router.get("/admin", dependencies=[Depends(require_roles(UserRole.ADMIN))])
    """
    async def role_checker(
        current_user: Annotated[User, Depends(get_current_active_user)],
    ) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role {current_user.role} not authorized. Required: {[r.value for r in roles]}",
            )
        return current_user

    return role_checker


async def get_admin_user(
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> User:
    """Require admin role."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


# ===========================================
# Scope-Based Access
# ===========================================

def require_scopes(*scopes: str):
    """
    Factory for scope-checking dependency.

    Usage:
        @router.get("/items", dependencies=[Depends(require_scopes("items:read"))])
    """
    async def scope_checker(
        current_user: Annotated[User, Security(get_current_user, scopes=list(scopes))],
    ) -> User:
        return current_user

    return scope_checker


# ===========================================
# API Key Authentication
# ===========================================

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
api_key_query = APIKeyQuery(name="api_key", auto_error=False)


async def get_api_key(
    api_key_header: Optional[str] = Security(api_key_header),
    api_key_query: Optional[str] = Security(api_key_query),
) -> str:
    """
    Validate API key from header or query parameter.
    """
    if api_key_header and api_key_header == API_KEY:
        return api_key_header
    if api_key_query and api_key_query == API_KEY:
        return api_key_query
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing API key",
    )


# ===========================================
# Combined Authentication (JWT or API Key)
# ===========================================

http_bearer = HTTPBearer(auto_error=False)


async def get_current_user_or_api_key(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Security(http_bearer),
    api_key: Optional[str] = Security(api_key_header),
) -> Optional[User]:
    """
    Allow authentication via JWT token OR API key.
    Returns User for JWT, None for API key (service account).
    """
    # Try JWT first
    if credentials and credentials.scheme.lower() == "bearer":
        try:
            payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
            username = payload.get("sub")
            if username:
                user = await get_user_from_db(username)
                if user:
                    return user
        except JWTError:
            pass

    # Try API key
    if api_key and api_key == API_KEY:
        return None  # Valid API key, but no user context

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


# ===========================================
# Optional Authentication
# ===========================================

async def get_optional_user(
    token: Optional[str] = Depends(OAuth2PasswordBearer(tokenUrl="auth/token", auto_error=False)),
) -> Optional[User]:
    """
    Get current user if authenticated, None otherwise.
    Useful for endpoints that work with or without authentication.
    """
    if not token:
        return None

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if username:
            return await get_user_from_db(username)
    except JWTError:
        pass

    return None


# ===========================================
# Rate Limiting Dependency
# ===========================================

from collections import defaultdict
import time

request_counts: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT = 100  # requests
RATE_WINDOW = 60  # seconds


async def rate_limit(
    request: Request,
    current_user: Optional[User] = Depends(get_optional_user),
):
    """
    Simple rate limiting based on user ID or IP.
    """
    # Use user ID if authenticated, otherwise IP
    if current_user:
        key = f"user:{current_user.id}"
        limit = RATE_LIMIT * 2  # Higher limit for authenticated users
    else:
        key = f"ip:{request.client.host}"
        limit = RATE_LIMIT

    now = time.time()
    window_start = now - RATE_WINDOW

    # Clean old requests
    request_counts[key] = [t for t in request_counts[key] if t > window_start]

    if len(request_counts[key]) >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded",
            headers={"Retry-After": str(RATE_WINDOW)},
        )

    request_counts[key].append(now)


# ===========================================
# Resource Ownership
# ===========================================

async def verify_resource_owner(
    resource_owner_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> User:
    """
    Verify user owns the resource or is admin.

    Usage in route:
        async def update_item(
            item_id: int,
            current_user: User = Depends(get_current_active_user),
        ):
            item = await get_item(item_id)
            await verify_resource_owner(item.owner_id, current_user)
    """
    if current_user.id != resource_owner_id and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this resource",
        )
    return current_user


# ===========================================
# Usage Examples
# ===========================================

"""
# In your router file:

from fastapi import APIRouter, Depends, Security
from app.dependencies.auth import (
    get_current_active_user,
    get_admin_user,
    require_roles,
    require_scopes,
    get_api_key,
    rate_limit,
    UserRole,
    User,
)
from typing import Annotated

router = APIRouter()

# Basic authentication
@router.get("/me")
async def get_me(
    current_user: Annotated[User, Depends(get_current_active_user)]
):
    return current_user

# Scope-based access
@router.get("/items")
async def list_items(
    current_user: Annotated[User, Security(get_current_user, scopes=["items:read"])]
):
    return {"items": []}

# Role-based access
@router.get("/admin/users")
async def admin_list_users(
    admin: Annotated[User, Depends(get_admin_user)]
):
    return {"users": []}

# Multiple roles
@router.delete("/items/{item_id}")
async def delete_item(
    item_id: int,
    user: Annotated[User, Depends(require_roles(UserRole.ADMIN, UserRole.MODERATOR))]
):
    return {"deleted": item_id}

# API key authentication
@router.post("/webhook")
async def webhook(
    api_key: Annotated[str, Depends(get_api_key)]
):
    return {"received": True}

# Rate limited endpoint
@router.get("/search", dependencies=[Depends(rate_limit)])
async def search(q: str):
    return {"results": []}
"""


# Helper function (would be in services)
async def get_user_from_db(username: str) -> Optional[User]:
    """Placeholder - replace with actual database query."""
    # Example: return await user_repository.get_by_username(username)
    return User(
        id=1,
        username=username,
        email=f"{username}@example.com",
        is_active=True,
        role=UserRole.USER,
        scopes=["users:read", "items:read", "items:write"],
    )
