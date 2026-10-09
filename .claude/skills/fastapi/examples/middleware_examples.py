# ===========================================
# EXAMPLE: Middleware Patterns
# File: app/middleware.py
# ===========================================

from fastapi import FastAPI, Request, Response, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp
from typing import Callable, Optional
import time
import uuid
import logging
from contextvars import ContextVar

# ===========================================
# Context Variables for Request Tracking
# ===========================================

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="")
logger = logging.getLogger(__name__)


# ===========================================
# Request ID Middleware
# ===========================================

class RequestIDMiddleware(BaseHTTPMiddleware):
    """Add unique request ID to each request for tracing."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Get existing request ID from header or generate new one
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request_id_ctx.set(request_id)

        # Store in request state for access in routes
        request.state.request_id = request_id

        response = await call_next(request)

        # Add request ID to response headers
        response.headers["X-Request-ID"] = request_id
        return response


# ===========================================
# Timing Middleware
# ===========================================

class TimingMiddleware(BaseHTTPMiddleware):
    """Measure and log request processing time."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        start_time = time.perf_counter()

        response = await call_next(request)

        process_time = time.perf_counter() - start_time
        response.headers["X-Process-Time"] = f"{process_time:.4f}"

        # Log slow requests
        if process_time > 1.0:
            logger.warning(
                f"Slow request: {request.method} {request.url.path} "
                f"took {process_time:.2f}s"
            )

        return response


# ===========================================
# Logging Middleware
# ===========================================

class LoggingMiddleware(BaseHTTPMiddleware):
    """Log all requests and responses."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Log request
        request_id = getattr(request.state, "request_id", "unknown")
        logger.info(
            f"Request started",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "query": str(request.query_params),
                "client_ip": request.client.host if request.client else "unknown",
            },
        )

        response = await call_next(request)

        # Log response
        logger.info(
            f"Request completed",
            extra={
                "request_id": request_id,
                "status_code": response.status_code,
            },
        )

        return response


# ===========================================
# Error Handling Middleware
# ===========================================

class ErrorHandlingMiddleware(BaseHTTPMiddleware):
    """Catch unhandled exceptions and return proper responses."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        try:
            response = await call_next(request)
            return response
        except Exception as exc:
            request_id = getattr(request.state, "request_id", "unknown")
            logger.exception(
                f"Unhandled exception: {exc}",
                extra={"request_id": request_id},
            )

            # Return generic error response
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={
                    "detail": "Internal server error",
                    "request_id": request_id,
                },
            )


# ===========================================
# Rate Limiting Middleware
# ===========================================

from collections import defaultdict
import asyncio

class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple IP-based rate limiting."""

    def __init__(
        self,
        app: ASGIApp,
        requests_per_minute: int = 60,
        exclude_paths: Optional[list[str]] = None,
    ):
        super().__init__(app)
        self.requests_per_minute = requests_per_minute
        self.exclude_paths = exclude_paths or ["/health", "/docs", "/openapi.json"]
        self.request_counts: dict[str, list[float]] = defaultdict(list)
        self._lock = asyncio.Lock()

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Skip rate limiting for excluded paths
        if request.url.path in self.exclude_paths:
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        window_start = now - 60

        async with self._lock:
            # Clean old entries
            self.request_counts[client_ip] = [
                t for t in self.request_counts[client_ip] if t > window_start
            ]

            # Check rate limit
            if len(self.request_counts[client_ip]) >= self.requests_per_minute:
                from fastapi.responses import JSONResponse
                return JSONResponse(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    content={"detail": "Rate limit exceeded. Try again later."},
                    headers={"Retry-After": "60"},
                )

            # Record request
            self.request_counts[client_ip].append(now)

        return await call_next(request)


# ===========================================
# Authentication Middleware (for all routes)
# ===========================================

class AuthenticationMiddleware(BaseHTTPMiddleware):
    """
    Middleware for authentication that can be applied globally.
    For specific routes, use dependencies instead.
    """

    def __init__(
        self,
        app: ASGIApp,
        exclude_paths: Optional[list[str]] = None,
    ):
        super().__init__(app)
        self.exclude_paths = exclude_paths or [
            "/",
            "/docs",
            "/openapi.json",
            "/health",
            "/auth/login",
            "/auth/register",
        ]

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Skip authentication for excluded paths
        if request.url.path in self.exclude_paths:
            return await call_next(request)

        # Check for authorization header
        auth_header = request.headers.get("Authorization")
        if not auth_header:
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Missing authorization header"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Validate token (simplified)
        if not auth_header.startswith("Bearer "):
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Invalid authorization header"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Token validation would happen here
        # For actual implementation, decode JWT and validate

        return await call_next(request)


# ===========================================
# Security Headers Middleware
# ===========================================

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)

        # Security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Content-Security-Policy"] = "default-src 'self'"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=()"

        return response


# ===========================================
# Database Session Middleware
# ===========================================

class DBSessionMiddleware(BaseHTTPMiddleware):
    """
    Manage database session per request.
    Note: Usually better handled with Depends(get_db).
    """

    def __init__(self, app: ASGIApp, session_factory):
        super().__init__(app)
        self.session_factory = session_factory

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        async with self.session_factory() as session:
            request.state.db = session
            try:
                response = await call_next(request)
                await session.commit()
                return response
            except Exception:
                await session.rollback()
                raise


# ===========================================
# Compression Middleware
# ===========================================

# Use built-in GZipMiddleware
# app.add_middleware(GZipMiddleware, minimum_size=1000)


# ===========================================
# Application Setup Example
# ===========================================

def create_app() -> FastAPI:
    """Create and configure FastAPI application with middleware."""

    app = FastAPI(
        title="My API",
        description="API with comprehensive middleware",
        version="1.0.0",
    )

    # Add middleware in order (last added = first executed)

    # 1. Security headers (outermost)
    app.add_middleware(SecurityHeadersMiddleware)

    # 2. Error handling
    app.add_middleware(ErrorHandlingMiddleware)

    # 3. Rate limiting
    app.add_middleware(
        RateLimitMiddleware,
        requests_per_minute=100,
        exclude_paths=["/health", "/docs"],
    )

    # 4. Request timing
    app.add_middleware(TimingMiddleware)

    # 5. Request ID (innermost - runs first)
    app.add_middleware(RequestIDMiddleware)

    # 6. Logging
    app.add_middleware(LoggingMiddleware)

    # 7. CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "https://myapp.com"],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID", "X-Process-Time"],
    )

    # 8. Trusted hosts
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["localhost", "*.myapp.com"],
    )

    # 9. GZip compression
    app.add_middleware(GZipMiddleware, minimum_size=500)

    return app


# ===========================================
# Function-Based Middleware Alternative
# ===========================================

async def simple_middleware(request: Request, call_next: Callable) -> Response:
    """
    Function-based middleware using @app.middleware decorator.

    Usage:
        @app.middleware("http")
        async def my_middleware(request: Request, call_next):
            # Before request
            response = await call_next(request)
            # After request
            return response
    """
    # Pre-processing
    start_time = time.time()

    # Process request
    response = await call_next(request)

    # Post-processing
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)

    return response


# ===========================================
# Health Check Endpoint
# ===========================================

"""
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
    }
"""
