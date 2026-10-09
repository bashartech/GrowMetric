# Function Tools Reference

## Overview

Function tools allow agents to perform actions and access external systems. The `@function_tool` decorator transforms Python functions into tools that agents can call.

## Basic Tool Definition

```python
from agents import function_tool

@function_tool
def calculate_total(items: list[dict], tax_rate: float = 0.1) -> float:
    """Calculate the total price including tax.

    Args:
        items: List of items with 'price' and 'quantity' keys.
        tax_rate: Tax rate to apply (default 10%).

    Returns:
        Total price including tax.
    """
    subtotal = sum(item["price"] * item["quantity"] for item in items)
    return subtotal * (1 + tax_rate)
```

## Tool Decorator Options

### name_override

Override the tool name (default is function name):

```python
@function_tool(name_override="fetch_user")
def get_user_by_id(user_id: str) -> dict:
    """Fetch user from database."""
    ...
```

### description_override

Override the tool description (default is docstring):

```python
@function_tool(description_override="Retrieve customer information by ID")
def get_customer(customer_id: str) -> dict:
    """Get customer."""  # This is ignored
    ...
```

### strict_mode

Enable/disable strict JSON schema validation (default True):

```python
@function_tool(strict_mode=False)
def flexible_tool(data: dict) -> str:
    """Tool with flexible input schema."""
    ...
```

### is_enabled

Conditionally enable/disable tools:

```python
from agents import RunContextWrapper, Agent

def check_admin(ctx: RunContextWrapper, agent: Agent) -> bool:
    return ctx.context.get("is_admin", False)

@function_tool(is_enabled=check_admin)
def admin_only_tool(action: str) -> str:
    """Only available to admin users."""
    ...
```

## Type Annotations

### Supported Types

```python
from typing import Optional, List, Dict, Union
from typing_extensions import TypedDict, Literal
from pydantic import BaseModel

# Primitives
@function_tool
def primitives(
    text: str,
    number: int,
    decimal: float,
    flag: bool,
) -> str:
    ...

# Optional parameters
@function_tool
def with_optional(
    required: str,
    optional: Optional[str] = None,
) -> str:
    ...

# Collections
@function_tool
def with_collections(
    items: List[str],
    mapping: Dict[str, int],
) -> list:
    ...

# Literal types for enums
@function_tool
def with_literal(
    status: Literal["pending", "active", "completed"],
) -> str:
    ...
```

### TypedDict for Complex Objects

```python
from typing_extensions import TypedDict

class Address(TypedDict):
    street: str
    city: str
    country: str
    postal_code: str

class Customer(TypedDict):
    name: str
    email: str
    address: Address

@function_tool
def create_customer(customer: Customer) -> dict:
    """Create a new customer.

    Args:
        customer: Customer information including name, email, and address.
    """
    return {"id": "cust_123", **customer}
```

### Pydantic Models

```python
from pydantic import BaseModel, Field

class OrderItem(BaseModel):
    product_id: str
    quantity: int = Field(gt=0)
    price: float = Field(gt=0)

class Order(BaseModel):
    customer_id: str
    items: list[OrderItem]
    notes: str | None = None

@function_tool
def place_order(order: Order) -> dict:
    """Place a new order.

    Args:
        order: Order details including customer and items.
    """
    return {"order_id": "ord_456", "status": "placed"}
```

## Async Tools

```python
import httpx
from agents import function_tool

@function_tool
async def fetch_api_data(endpoint: str) -> dict:
    """Fetch data from external API.

    Args:
        endpoint: API endpoint path.
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(f"https://api.example.com/{endpoint}")
        response.raise_for_status()
        return response.json()

@function_tool
async def parallel_fetch(urls: list[str]) -> list[dict]:
    """Fetch multiple URLs in parallel.

    Args:
        urls: List of URLs to fetch.
    """
    import asyncio

    async with httpx.AsyncClient() as client:
        tasks = [client.get(url) for url in urls]
        responses = await asyncio.gather(*tasks)
        return [r.json() for r in responses]
```

## Context-Aware Tools

Access shared context within tools:

```python
from agents import function_tool, RunContextWrapper
from typing import Any

@function_tool
def get_user_orders(ctx: RunContextWrapper[Any], limit: int = 10) -> list:
    """Get orders for the current user.

    Args:
        limit: Maximum number of orders to return.
    """
    user_id = ctx.context.get("user_id")
    db = ctx.context.get("database")
    return db.query_orders(user_id=user_id, limit=limit)

@function_tool
async def send_notification(
    ctx: RunContextWrapper[Any],
    message: str,
    channel: Literal["email", "sms", "push"] = "email",
) -> bool:
    """Send notification to the current user.

    Args:
        message: Notification message content.
        channel: Delivery channel.
    """
    user = ctx.context.get("current_user")
    notifier = ctx.context.get("notification_service")
    return await notifier.send(user, message, channel)
```

## Tool Error Handling

### Default Error Handling

By default, tool errors are caught and sent to the LLM:

```python
@function_tool
def risky_operation(data: str) -> str:
    """Perform a risky operation."""
    if not data:
        raise ValueError("Data cannot be empty")
    return process(data)
```

### Custom Error Function

```python
from agents import function_tool, ToolContext

def custom_error_handler(e: Exception, ctx: ToolContext, input_str: str) -> str:
    if isinstance(e, ValueError):
        return f"Validation error: {e}"
    elif isinstance(e, ConnectionError):
        return "Service temporarily unavailable. Please try again."
    return f"An error occurred: {e}"

@function_tool(failure_error_function=custom_error_handler)
def api_call(endpoint: str) -> dict:
    """Call external API."""
    ...
```

### Disable Error Handling

Raise exceptions instead of handling them:

```python
@function_tool(failure_error_function=None)
def critical_operation(data: str) -> str:
    """Operation that should fail fast."""
    ...
```

## Tool Input/Output Guardrails

Add validation to individual tools:

```python
from agents import function_tool, ToolInputGuardrail, ToolOutputGuardrail, GuardrailFunctionOutput

def validate_input(ctx, tool, input_data) -> GuardrailFunctionOutput:
    # Validate input before tool execution
    is_valid = check_input(input_data)
    return GuardrailFunctionOutput(
        tripwire_triggered=not is_valid,
        output_info={"valid": is_valid},
    )

def validate_output(ctx, tool, output_data) -> GuardrailFunctionOutput:
    # Validate output after tool execution
    is_safe = check_output(output_data)
    return GuardrailFunctionOutput(
        tripwire_triggered=not is_safe,
        output_info={"safe": is_safe},
    )

@function_tool(
    tool_input_guardrails=[ToolInputGuardrail(guardrail_function=validate_input)],
    tool_output_guardrails=[ToolOutputGuardrail(guardrail_function=validate_output)],
)
def guarded_tool(query: str) -> str:
    """Tool with input and output validation."""
    ...
```

## Organizing Tools

### Tool Modules

```python
# tools/database.py
from agents import function_tool

@function_tool
def query_users(filter: dict) -> list:
    """Query users from database."""
    ...

@function_tool
def update_user(user_id: str, data: dict) -> dict:
    """Update user in database."""
    ...

# tools/notifications.py
@function_tool
async def send_email(to: str, subject: str, body: str) -> bool:
    """Send email notification."""
    ...

# agents/main.py
from tools.database import query_users, update_user
from tools.notifications import send_email

agent = Agent(
    name="Assistant",
    tools=[query_users, update_user, send_email],
)
```

### Tool Factory Pattern

```python
def create_api_tool(base_url: str, endpoint: str):
    @function_tool(name_override=f"fetch_{endpoint}")
    async def api_tool(params: dict) -> dict:
        f"""Fetch data from {endpoint}."""
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{base_url}/{endpoint}", params=params)
            return response.json()
    return api_tool

# Create multiple similar tools
users_tool = create_api_tool("https://api.example.com", "users")
orders_tool = create_api_tool("https://api.example.com", "orders")
products_tool = create_api_tool("https://api.example.com", "products")
```

## Best Practices

1. **Clear Docstrings**: Write detailed docstrings - they become tool descriptions
2. **Type Everything**: Use type annotations for all parameters and returns
3. **Validate Inputs**: Check inputs before processing
4. **Handle Errors**: Use custom error handlers for better UX
5. **Keep Tools Focused**: Each tool should do one thing well
6. **Use Context**: Access shared state via context, not globals
7. **Async for I/O**: Use async for network/file operations
8. **Test Tools**: Write unit tests for tools independently
9. **Document Args**: Use Args section in docstrings for parameter descriptions
10. **Consider Guardrails**: Add tool-level guardrails for sensitive operations
