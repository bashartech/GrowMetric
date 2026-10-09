# Testing Patterns

## Basic Testing Setup

### Installation

```bash
pip install pytest pytest-asyncio httpx
```

### Configuration

```python
# pyproject.toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
python_files = ["test_*.py"]
python_functions = ["test_*"]
```

```python
# conftest.py
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.main import app
from app.db.database import Base, get_db

# Test database URL
TEST_DATABASE_URL = "sqlite+aiosqlite:///./test.db"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=True)
TestSessionLocal = async_sessionmaker(
    bind=test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


@pytest.fixture(scope="session")
def event_loop():
    import asyncio
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="function")
async def db_session():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with TestSessionLocal() as session:
        yield session

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture(scope="function")
async def client(db_session):
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture
async def authenticated_client(client, db_session):
    """Client with authentication token."""
    # Create test user
    from app.services.user_service import UserService
    from app.models.user import UserCreate

    service = UserService(db_session)
    user = await service.create_user(
        UserCreate(
            email="test@example.com",
            username="testuser",
            password="testpassword123",
        )
    )
    await db_session.commit()

    # Get token
    response = await client.post(
        "/auth/token",
        data={"username": "testuser", "password": "testpassword123"},
    )
    token = response.json()["access_token"]

    client.headers["Authorization"] = f"Bearer {token}"
    return client
```

## Testing Endpoints

### Basic Endpoint Tests

```python
# tests/test_users.py
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_user(client: AsyncClient):
    response = await client.post(
        "/users/",
        json={
            "email": "user@example.com",
            "username": "newuser",
            "password": "securepassword123",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "user@example.com"
    assert data["username"] == "newuser"
    assert "password" not in data
    assert "hashed_password" not in data


@pytest.mark.asyncio
async def test_create_user_duplicate_email(client: AsyncClient):
    # Create first user
    await client.post(
        "/users/",
        json={
            "email": "user@example.com",
            "username": "user1",
            "password": "password123",
        },
    )

    # Try to create user with same email
    response = await client.post(
        "/users/",
        json={
            "email": "user@example.com",
            "username": "user2",
            "password": "password123",
        },
    )
    assert response.status_code == 400
    assert "already registered" in response.json()["detail"]


@pytest.mark.asyncio
async def test_get_user(client: AsyncClient):
    # Create user first
    create_response = await client.post(
        "/users/",
        json={
            "email": "user@example.com",
            "username": "testuser",
            "password": "password123",
        },
    )
    user_id = create_response.json()["id"]

    # Get user
    response = await client.get(f"/users/{user_id}")
    assert response.status_code == 200
    assert response.json()["id"] == user_id


@pytest.mark.asyncio
async def test_get_user_not_found(client: AsyncClient):
    response = await client.get("/users/99999")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_list_users(client: AsyncClient):
    # Create multiple users
    for i in range(3):
        await client.post(
            "/users/",
            json={
                "email": f"user{i}@example.com",
                "username": f"user{i}",
                "password": "password123",
            },
        )

    response = await client.get("/users/")
    assert response.status_code == 200
    assert len(response.json()) == 3


@pytest.mark.asyncio
async def test_update_user(client: AsyncClient):
    # Create user
    create_response = await client.post(
        "/users/",
        json={
            "email": "user@example.com",
            "username": "testuser",
            "password": "password123",
        },
    )
    user_id = create_response.json()["id"]

    # Update user
    response = await client.put(
        f"/users/{user_id}",
        json={"username": "updateduser"},
    )
    assert response.status_code == 200
    assert response.json()["username"] == "updateduser"


@pytest.mark.asyncio
async def test_delete_user(client: AsyncClient):
    # Create user
    create_response = await client.post(
        "/users/",
        json={
            "email": "user@example.com",
            "username": "testuser",
            "password": "password123",
        },
    )
    user_id = create_response.json()["id"]

    # Delete user
    response = await client.delete(f"/users/{user_id}")
    assert response.status_code == 204

    # Verify deleted
    get_response = await client.get(f"/users/{user_id}")
    assert get_response.status_code == 404
```

### Testing with Authentication

```python
# tests/test_auth.py
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_login(client: AsyncClient):
    # Create user first
    await client.post(
        "/users/",
        json={
            "email": "user@example.com",
            "username": "testuser",
            "password": "password123",
        },
    )

    # Login
    response = await client.post(
        "/auth/token",
        data={"username": "testuser", "password": "password123"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_login_invalid_credentials(client: AsyncClient):
    response = await client.post(
        "/auth/token",
        data={"username": "nonexistent", "password": "wrongpassword"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_protected_endpoint(authenticated_client: AsyncClient):
    response = await authenticated_client.get("/users/me")
    assert response.status_code == 200
    assert response.json()["username"] == "testuser"


@pytest.mark.asyncio
async def test_protected_endpoint_no_token(client: AsyncClient):
    response = await client.get("/users/me")
    assert response.status_code == 401
```

## Testing Services

```python
# tests/test_services.py
import pytest
from app.services.user_service import UserService
from app.models.user import UserCreate, UserUpdate


@pytest.mark.asyncio
async def test_user_service_create(db_session):
    service = UserService(db_session)

    user = await service.create_user(
        UserCreate(
            email="user@example.com",
            username="testuser",
            password="password123",
        )
    )
    await db_session.commit()

    assert user.id is not None
    assert user.email == "user@example.com"
    assert user.username == "testuser"
    assert user.hashed_password != "password123"


@pytest.mark.asyncio
async def test_user_service_get_by_email(db_session):
    service = UserService(db_session)

    await service.create_user(
        UserCreate(
            email="user@example.com",
            username="testuser",
            password="password123",
        )
    )
    await db_session.commit()

    user = await service.get_user_by_email("user@example.com")
    assert user is not None
    assert user.email == "user@example.com"


@pytest.mark.asyncio
async def test_user_service_update(db_session):
    service = UserService(db_session)

    user = await service.create_user(
        UserCreate(
            email="user@example.com",
            username="testuser",
            password="password123",
        )
    )
    await db_session.commit()

    updated = await service.update_user(
        user.id,
        UserUpdate(username="newusername"),
    )
    await db_session.commit()

    assert updated.username == "newusername"
```

## Testing with Mocks

```python
# tests/test_with_mocks.py
import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_external_api_call(client: AsyncClient):
    mock_response = {"data": "mocked"}

    with patch("app.services.external_api.fetch_data", new_callable=AsyncMock) as mock:
        mock.return_value = mock_response

        response = await client.get("/external-data")

        assert response.status_code == 200
        assert response.json() == mock_response
        mock.assert_called_once()


@pytest.mark.asyncio
async def test_email_service(client: AsyncClient):
    with patch("app.services.email_service.send_email", new_callable=AsyncMock) as mock:
        mock.return_value = True

        response = await client.post(
            "/users/",
            json={
                "email": "user@example.com",
                "username": "testuser",
                "password": "password123",
            },
        )

        assert response.status_code == 201
        mock.assert_called_once_with("user@example.com", subject="Welcome!")
```

## Testing WebSockets

```python
# tests/test_websockets.py
import pytest
from httpx import AsyncClient
from starlette.testclient import TestClient
from app.main import app


def test_websocket_connection():
    client = TestClient(app)

    with client.websocket_connect("/ws") as websocket:
        websocket.send_json({"message": "hello"})
        data = websocket.receive_json()
        assert data["message"] == "hello"


def test_websocket_broadcast():
    client = TestClient(app)

    with client.websocket_connect("/ws/room1") as ws1:
        with client.websocket_connect("/ws/room1") as ws2:
            ws1.send_json({"message": "broadcast"})

            # Both should receive
            data1 = ws1.receive_json()
            data2 = ws2.receive_json()

            assert data1["message"] == "broadcast"
            assert data2["message"] == "broadcast"
```

## Fixtures and Factories

```python
# tests/factories.py
from typing import Optional
from app.db.models import User, Post
from app.core.security import get_password_hash


class UserFactory:
    @staticmethod
    async def create(
        db,
        email: str = "user@example.com",
        username: str = "testuser",
        password: str = "password123",
        is_active: bool = True,
        is_admin: bool = False,
    ) -> User:
        user = User(
            email=email,
            username=username,
            hashed_password=get_password_hash(password),
            is_active=is_active,
            is_admin=is_admin,
        )
        db.add(user)
        await db.flush()
        await db.refresh(user)
        return user


class PostFactory:
    @staticmethod
    async def create(
        db,
        author: User,
        title: str = "Test Post",
        content: str = "Test content",
        published: bool = False,
    ) -> Post:
        post = Post(
            title=title,
            content=content,
            published=published,
            author_id=author.id,
        )
        db.add(post)
        await db.flush()
        await db.refresh(post)
        return post


# Usage in tests
@pytest.mark.asyncio
async def test_user_posts(client: AsyncClient, db_session):
    user = await UserFactory.create(db_session)
    post1 = await PostFactory.create(db_session, author=user, title="Post 1")
    post2 = await PostFactory.create(db_session, author=user, title="Post 2")
    await db_session.commit()

    response = await client.get(f"/users/{user.id}/posts")
    assert response.status_code == 200
    assert len(response.json()) == 2
```

## Coverage

```bash
# Install coverage
pip install pytest-cov

# Run with coverage
pytest --cov=app --cov-report=html --cov-report=term-missing

# View HTML report
open htmlcov/index.html
```
