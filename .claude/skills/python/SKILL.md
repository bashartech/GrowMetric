---
name: python
description: This skill MUST be loaded when ANY .py file is being read, reviewed, edited, or created that does NOT involve FastAPI, FastMCP, OpenAI Agents SDK, or n8n Code nodes. Also use when the user asks to "create a Python project", "set up a Python package", "write a Python script", "add type hints", "create a dataclass", "write pytest tests", "add logging", "create a decorator", "write a generator", "implement a context manager", "handle exceptions", "read/write files in Python", "use async/await in Python", "manage Python dependencies", "set up pyproject.toml", "create a virtual environment", "use pathlib", "parse arguments with argparse", or mentions Python typing, dataclasses, pytest, logging, PEP 8, Python packaging, pip, uv, poetry, or general Python development patterns.
---

# Python Development Guide

This skill provides comprehensive guidance for writing modern, production-quality Python code following current best practices (Python 3.10+).

## Project Structure

```
project/
├── src/
│   └── mypackage/
│       ├── __init__.py
│       ├── main.py
│       ├── models.py
│       ├── utils.py
│       └── exceptions.py
├── tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── test_main.py
│   └── test_utils.py
├── pyproject.toml
├── README.md
└── .gitignore
```

**pyproject.toml (modern standard)**
```toml
[project]
name = "mypackage"
version = "0.1.0"
description = "My Python package"
requires-python = ">=3.10"
dependencies = [
    "pydantic>=2.0",
    "httpx>=0.27",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-cov>=5.0",
    "ruff>=0.5",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]

[tool.ruff]
target-version = "py310"
line-length = 88

[tool.ruff.lint]
select = ["E", "F", "I", "N", "UP", "B", "SIM"]
```

## Type Hints

```python
# Basic annotations (Python 3.10+ syntax)
def greet(name: str, times: int = 1) -> str:
    return f"Hello, {name}! " * times

# Union types with | (not Optional)
def find_user(user_id: int) -> User | None:
    ...

# Collections (lowercase generics)
def process(items: list[str], lookup: dict[str, int]) -> tuple[str, ...]:
    ...

# Callable types
from collections.abc import Callable

def retry(func: Callable[..., str], attempts: int = 3) -> str:
    ...
```

**Advanced typing patterns**
```python
from typing import TypeVar, Protocol, Literal, TypeAlias

# TypeVar for generics
T = TypeVar("T")

def first(items: list[T]) -> T:
    return items[0]

# Protocol for structural subtyping (duck typing)
class Renderable(Protocol):
    def render(self) -> str: ...

def display(item: Renderable) -> None:
    print(item.render())

# Literal for constrained values
def set_mode(mode: Literal["read", "write", "append"]) -> None:
    ...

# TypeAlias for complex types
JSON: TypeAlias = dict[str, "JSON"] | list["JSON"] | str | int | float | bool | None
```

## Dataclasses and Pydantic Models

**Dataclasses (for internal data structures)**
```python
from dataclasses import dataclass, field

@dataclass(slots=True)
class Point:
    x: float
    y: float

@dataclass(frozen=True)  # Immutable
class Config:
    host: str = "localhost"
    port: int = 8000
    tags: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.port < 0:
            raise ValueError(f"Invalid port: {self.port}")
```

**Pydantic (for validation and serialization)**
```python
from pydantic import BaseModel, Field, field_validator

class User(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: str
    age: int = Field(ge=0, le=150)
    tags: list[str] = []

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        if "@" not in v:
            raise ValueError("Invalid email")
        return v.lower()

# Usage
user = User(name="Alice", email="ALICE@example.com", age=30)
data = user.model_dump()        # To dict
json_str = user.model_dump_json()  # To JSON string
user2 = User.model_validate(data)  # From dict
```

**When to use which:**
| Use Case | Choice |
|----------|--------|
| Internal data containers | `@dataclass(slots=True)` |
| Immutable values | `@dataclass(frozen=True)` |
| External data / validation | Pydantic `BaseModel` |
| Simple tuples with names | `NamedTuple` |
| Config with env vars | Pydantic `BaseSettings` |

## Error Handling

**Custom exception hierarchy**
```python
class AppError(Exception):
    """Base exception for the application."""

class NotFoundError(AppError):
    def __init__(self, resource: str, id: str) -> None:
        self.resource = resource
        self.id = id
        super().__init__(f"{resource} not found: {id}")

class ValidationError(AppError):
    def __init__(self, field: str, message: str) -> None:
        self.field = field
        super().__init__(f"Validation error on '{field}': {message}")
```

**Proper exception patterns**
```python
# Exception chaining - preserve original cause
try:
    data = json.loads(raw_text)
except json.JSONDecodeError as e:
    raise ValidationError("body", "Invalid JSON") from e

# try/except/else/finally
try:
    file = open(path)
except FileNotFoundError:
    logger.warning("File not found: %s", path)
    return default_value
else:
    data = file.read()  # Only runs if no exception
finally:
    file.close()        # Always runs

# Exception groups (Python 3.11+)
try:
    async with asyncio.TaskGroup() as tg:
        tg.create_task(task1())
        tg.create_task(task2())
except* ValueError as eg:
    for exc in eg.exceptions:
        logger.error("Value error: %s", exc)
except* TypeError as eg:
    for exc in eg.exceptions:
        logger.error("Type error: %s", exc)
```

## Decorators

```python
import functools
import time

# Basic decorator with wraps
def log_calls(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        print(f"Calling {func.__name__}")
        return func(*args, **kwargs)
    return wrapper

# Decorator with arguments
def retry(max_attempts: int = 3, delay: float = 1.0):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_exc = None
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_exc = e
                    time.sleep(delay)
            raise last_exc
        return wrapper
    return decorator

@retry(max_attempts=3, delay=0.5)
def fetch_data(url: str) -> dict:
    ...

# Caching (built-in)
@functools.lru_cache(maxsize=128)
def expensive_computation(n: int) -> int:
    ...

@functools.cache  # Unlimited cache (Python 3.9+)
def fibonacci(n: int) -> int:
    if n < 2:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)
```

## Context Managers

```python
from contextlib import contextmanager, asynccontextmanager

# Function-based context manager
@contextmanager
def timer(label: str):
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed = time.perf_counter() - start
        print(f"{label}: {elapsed:.3f}s")

with timer("processing"):
    process_data()

# Class-based context manager
class DatabaseConnection:
    def __init__(self, url: str) -> None:
        self.url = url

    def __enter__(self):
        self.conn = create_connection(self.url)
        return self.conn

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
        self.conn.close()
        return False  # Don't suppress exceptions

# Async context manager
@asynccontextmanager
async def http_client():
    import httpx
    async with httpx.AsyncClient() as client:
        yield client
```

## Generators

```python
# Generator function
def read_large_file(path: str, chunk_size: int = 8192):
    with open(path, "rb") as f:
        while chunk := f.read(chunk_size):
            yield chunk

# Generator expression (lazy)
squares = (x ** 2 for x in range(1_000_000))

# yield from for delegation
def flatten(nested: list[list[int]]) -> list[int]:
    for sublist in nested:
        yield from sublist

# Pipeline pattern
def pipeline():
    lines = read_lines("data.txt")
    stripped = (line.strip() for line in lines)
    non_empty = (line for line in stripped if line)
    parsed = (parse_record(line) for line in non_empty)
    return list(parsed)
```

## Async/Await

```python
import asyncio

# Basic async function
async def fetch_url(url: str) -> str:
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.text

# Concurrent execution with gather
async def fetch_all(urls: list[str]) -> list[str]:
    results = await asyncio.gather(
        *(fetch_url(url) for url in urls),
        return_exceptions=True,
    )
    return [r for r in results if isinstance(r, str)]

# Task creation for background work
async def main():
    task = asyncio.create_task(background_job())
    await do_other_work()
    result = await task

# Entry point
asyncio.run(main())

# TaskGroup (Python 3.11+, preferred over gather)
async def fetch_all_v2(urls: list[str]) -> list[str]:
    results = []
    async with asyncio.TaskGroup() as tg:
        for url in urls:
            tg.create_task(fetch_and_append(url, results))
    return results
```

**Common pitfall:** Never call blocking I/O in async code — use `asyncio.to_thread()` for sync functions:
```python
result = await asyncio.to_thread(blocking_function, arg1, arg2)
```

## File I/O and pathlib

```python
from pathlib import Path

# Path operations
root = Path("project")
config_path = root / "config" / "settings.toml"
config_path.parent.mkdir(parents=True, exist_ok=True)

# Reading and writing
text = config_path.read_text(encoding="utf-8")
config_path.write_text("key = 'value'\n", encoding="utf-8")
data = Path("image.png").read_bytes()

# Globbing
py_files = list(Path("src").rglob("*.py"))

# JSON
import json
data = json.loads(Path("data.json").read_text())
Path("output.json").write_text(json.dumps(data, indent=2))

# CSV
import csv
with open("data.csv", newline="") as f:
    reader = csv.DictReader(f)
    rows = list(reader)

# TOML (Python 3.11+)
import tomllib
with open("config.toml", "rb") as f:
    config = tomllib.load(f)

# Temporary files
import tempfile
with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
    json.dump(data, f)
    temp_path = f.name
```

## Testing with pytest

```python
# tests/test_main.py
import pytest
from mypackage.main import process, calculate

# Basic test
def test_process_valid_input():
    result = process("hello")
    assert result == "HELLO"

# Parametrize for multiple cases
@pytest.mark.parametrize("input_val, expected", [
    (0, 0),
    (1, 1),
    (5, 120),
    (10, 3628800),
])
def test_factorial(input_val, expected):
    assert calculate(input_val) == expected

# Testing exceptions
def test_negative_input_raises():
    with pytest.raises(ValueError, match="must be non-negative"):
        calculate(-1)

# Fixtures
@pytest.fixture
def sample_user():
    return User(name="Alice", email="alice@test.com", age=30)

@pytest.fixture
def db_session():
    session = create_session()
    yield session
    session.rollback()
    session.close()

def test_user_creation(db_session, sample_user):
    db_session.add(sample_user)
    assert db_session.query(User).count() == 1
```

**conftest.py (shared fixtures)**
```python
# tests/conftest.py
import pytest

@pytest.fixture(scope="session")
def app_config():
    return Config(host="localhost", port=8000)

@pytest.fixture(autouse=True)
def reset_state():
    yield
    cleanup()
```

**Mocking**
```python
from unittest.mock import patch, MagicMock

def test_fetch_data():
    with patch("mypackage.main.httpx.get") as mock_get:
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {"key": "value"},
        )
        result = fetch_data("https://api.example.com")
        assert result == {"key": "value"}
        mock_get.assert_called_once()
```

## Logging

```python
import logging

# Module-level logger (standard pattern)
logger = logging.getLogger(__name__)

def process_data(data: dict) -> dict:
    logger.info("Processing %d items", len(data))
    try:
        result = transform(data)
    except Exception:
        logger.exception("Failed to process data")  # Includes traceback
        raise
    logger.debug("Result: %s", result)
    return result
```

**Application-level configuration**
```python
import logging.config

LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {
            "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "standard",
            "level": "DEBUG",
        },
        "file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": "app.log",
            "maxBytes": 10_485_760,  # 10MB
            "backupCount": 5,
            "formatter": "standard",
        },
    },
    "root": {
        "level": "INFO",
        "handlers": ["console", "file"],
    },
}

logging.config.dictConfig(LOGGING_CONFIG)
```

**Log levels:**
| Level | Use For |
|-------|---------|
| `DEBUG` | Detailed diagnostic info (dev only) |
| `INFO` | Routine operations (startup, requests) |
| `WARNING` | Unexpected but handled situations |
| `ERROR` | Failures that need attention |
| `CRITICAL` | System-level failures |

## Virtual Environments and Dependencies

```bash
# uv (recommended - fast, modern)
uv venv                     # Create .venv
uv pip install -e ".[dev]"  # Install with dev deps
uv pip compile pyproject.toml -o requirements.lock  # Lock deps
uv sync                     # Install from lockfile

# Standard venv
python -m venv .venv
.venv\Scripts\activate      # Windows
source .venv/bin/activate   # macOS/Linux
pip install -e ".[dev]"

# Editable install (required for src layout)
pip install -e .
```

## Common Standard Library

```python
# collections
from collections import defaultdict, Counter, deque

word_count = Counter(words)                  # Count occurrences
grouped = defaultdict(list)                  # Auto-create missing keys
queue = deque(maxlen=100)                    # Fixed-size queue

# itertools
from itertools import chain, groupby, islice, batched

all_items = list(chain(list1, list2))        # Flatten iterables
first_10 = list(islice(generator, 10))       # Slice generators
chunks = list(batched(items, 5))             # Groups of 5 (3.12+)

# functools
from functools import lru_cache, partial, reduce

cached_fn = lru_cache(maxsize=256)(expensive_fn)
add_ten = partial(add, 10)                   # Partial application

# enum
from enum import Enum, auto

class Status(Enum):
    PENDING = auto()
    ACTIVE = auto()
    CLOSED = auto()

# abc (abstract base classes)
from abc import ABC, abstractmethod

class Repository(ABC):
    @abstractmethod
    def get(self, id: str) -> dict:
        ...

    @abstractmethod
    def save(self, data: dict) -> None:
        ...

# argparse
import argparse

parser = argparse.ArgumentParser(description="My CLI tool")
parser.add_argument("input", help="Input file path")
parser.add_argument("-o", "--output", default="out.json", help="Output path")
parser.add_argument("-v", "--verbose", action="store_true")
args = parser.parse_args()
```

## Best Practices

1. **Use type hints everywhere** — enables IDE support and catches bugs early
2. **Format with ruff** — `ruff check --fix . && ruff format .`
3. **Prefer `pathlib.Path`** over `os.path` for all file operations
4. **Use dataclasses or Pydantic** for data containers — avoid raw dicts
5. **Write custom exceptions** for domain-specific errors
6. **Use `logging`** not `print()` for operational output
7. **Write tests with pytest** from the start — aim for fixtures over setup/teardown
8. **Use `pyproject.toml`** as the single config file (not setup.py/setup.cfg)
9. **Prefer composition over inheritance** — use Protocol for interfaces
10. **Use `uv`** for fast dependency management and virtual environments
