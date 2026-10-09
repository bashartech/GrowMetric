"""
Function Tools Example

Demonstrates various patterns for creating and using function tools
with the OpenAI Agents SDK.
"""

from agents import Agent, Runner, function_tool, RunContextWrapper
from pydantic import BaseModel, Field
from typing import Any, Literal
from typing_extensions import TypedDict
import asyncio
import httpx


# ============================================================
# Basic Tools
# ============================================================

@function_tool
def add_numbers(a: float, b: float) -> float:
    """Add two numbers together.

    Args:
        a: First number.
        b: Second number.

    Returns:
        Sum of the two numbers.
    """
    return a + b


@function_tool
def format_currency(amount: float, currency: str = "USD") -> str:
    """Format a number as currency.

    Args:
        amount: The monetary amount.
        currency: Currency code (USD, EUR, GBP).

    Returns:
        Formatted currency string.
    """
    symbols = {"USD": "$", "EUR": "€", "GBP": "£"}
    symbol = symbols.get(currency, currency)
    return f"{symbol}{amount:,.2f}"


# ============================================================
# Tools with Complex Types
# ============================================================

class Address(TypedDict):
    """Mailing address."""
    street: str
    city: str
    state: str
    zip_code: str


class Customer(TypedDict):
    """Customer information."""
    name: str
    email: str
    address: Address


@function_tool
def validate_address(address: Address) -> dict:
    """Validate a mailing address.

    Args:
        address: The address to validate.

    Returns:
        Validation result with suggestions.
    """
    # Simulated validation
    is_valid = bool(address.get("zip_code") and len(address["zip_code"]) == 5)
    return {
        "valid": is_valid,
        "normalized": {
            "street": address["street"].title(),
            "city": address["city"].title(),
            "state": address["state"].upper(),
            "zip_code": address["zip_code"],
        },
    }


@function_tool
def create_customer(customer: Customer) -> dict:
    """Create a new customer record.

    Args:
        customer: Customer information.

    Returns:
        Created customer with ID.
    """
    import uuid
    return {
        "id": str(uuid.uuid4())[:8],
        **customer,
        "created": True,
    }


# ============================================================
# Tools with Pydantic Models
# ============================================================

class OrderItem(BaseModel):
    """An item in an order."""
    product_id: str
    name: str
    quantity: int = Field(gt=0, description="Must be positive")
    price: float = Field(gt=0, description="Unit price")


class Order(BaseModel):
    """A customer order."""
    customer_id: str
    items: list[OrderItem]
    shipping_address: str
    notes: str | None = None


class OrderResult(BaseModel):
    """Result of order creation."""
    order_id: str
    total: float
    estimated_delivery: str


@function_tool
def place_order(order: Order) -> OrderResult:
    """Place a new order.

    Args:
        order: Order details including items and shipping.

    Returns:
        Order confirmation with total and delivery estimate.
    """
    import uuid
    from datetime import datetime, timedelta

    total = sum(item.quantity * item.price for item in order.items)
    delivery = datetime.now() + timedelta(days=5)

    return OrderResult(
        order_id=f"ORD-{uuid.uuid4().hex[:8].upper()}",
        total=total,
        estimated_delivery=delivery.strftime("%Y-%m-%d"),
    )


# ============================================================
# Async Tools
# ============================================================

@function_tool
async def fetch_weather(city: str) -> dict:
    """Fetch current weather for a city.

    Args:
        city: City name.

    Returns:
        Weather information.
    """
    # Simulated async API call
    await asyncio.sleep(0.1)  # Simulate network latency
    return {
        "city": city,
        "temperature": 72,
        "condition": "Sunny",
        "humidity": 45,
    }


@function_tool
async def fetch_stock_price(symbol: str) -> dict:
    """Fetch current stock price.

    Args:
        symbol: Stock ticker symbol.

    Returns:
        Stock price information.
    """
    # Simulated async API call
    await asyncio.sleep(0.1)
    prices = {
        "AAPL": 178.50,
        "GOOGL": 142.30,
        "MSFT": 378.90,
    }
    price = prices.get(symbol.upper(), 100.00)
    return {
        "symbol": symbol.upper(),
        "price": price,
        "currency": "USD",
    }


# ============================================================
# Context-Aware Tools
# ============================================================

@function_tool
def get_user_preference(ctx: RunContextWrapper[Any], key: str) -> str:
    """Get a user preference from context.

    Args:
        key: Preference key to look up.

    Returns:
        Preference value or default.
    """
    preferences = ctx.context.get("user_preferences", {})
    return preferences.get(key, "not set")


@function_tool
def log_action(ctx: RunContextWrapper[Any], action: str, details: str) -> bool:
    """Log an action to the audit trail.

    Args:
        action: Type of action performed.
        details: Action details.

    Returns:
        Whether logging succeeded.
    """
    user_id = ctx.context.get("user_id", "anonymous")
    # In production, this would write to a real audit log
    print(f"[AUDIT] User {user_id}: {action} - {details}")
    return True


# ============================================================
# Tools with Enum Parameters
# ============================================================

@function_tool
def set_priority(
    item_id: str,
    priority: Literal["low", "medium", "high", "critical"],
) -> dict:
    """Set the priority of an item.

    Args:
        item_id: The item to update.
        priority: Priority level.

    Returns:
        Updated item info.
    """
    priority_values = {"low": 1, "medium": 2, "high": 3, "critical": 4}
    return {
        "item_id": item_id,
        "priority": priority,
        "priority_value": priority_values[priority],
        "updated": True,
    }


@function_tool
def search_products(
    query: str,
    category: Literal["electronics", "clothing", "home", "all"] = "all",
    sort_by: Literal["price", "rating", "newest"] = "rating",
    limit: int = 10,
) -> list[dict]:
    """Search for products.

    Args:
        query: Search query.
        category: Product category filter.
        sort_by: Sort order.
        limit: Maximum results.

    Returns:
        List of matching products.
    """
    # Simulated product search
    return [
        {
            "id": f"PROD-{i}",
            "name": f"{query} Product {i}",
            "category": category if category != "all" else "electronics",
            "price": 29.99 + i * 10,
            "rating": 4.5 - i * 0.1,
        }
        for i in range(min(limit, 5))
    ]


# ============================================================
# Tool with Custom Name
# ============================================================

@function_tool(name_override="get_user_data")
def fetch_user_from_database(user_id: str) -> dict:
    """Fetch user data from the database.

    Args:
        user_id: User identifier.

    Returns:
        User data.
    """
    return {
        "id": user_id,
        "name": "John Doe",
        "email": "john@example.com",
        "plan": "premium",
    }


# ============================================================
# Example Agents Using Tools
# ============================================================

# Basic calculator agent
calculator_agent = Agent(
    name="Calculator",
    instructions="You are a calculator. Help users with math and currency formatting.",
    tools=[add_numbers, format_currency],
)

# E-commerce agent
ecommerce_agent = Agent(
    name="E-Commerce Assistant",
    instructions="""You help customers with shopping.
    You can search products, create customers, and place orders.
    Always validate addresses before shipping.""",
    tools=[
        search_products,
        validate_address,
        create_customer,
        place_order,
    ],
)

# Data fetching agent
data_agent = Agent(
    name="Data Agent",
    instructions="You fetch real-time data like weather and stock prices.",
    tools=[fetch_weather, fetch_stock_price],
)

# Context-aware agent
context_agent = Agent(
    name="Personalized Assistant",
    instructions="""You provide personalized assistance.
    Use get_user_preference to check user settings.
    Log important actions with log_action.""",
    tools=[get_user_preference, log_action, fetch_user_from_database],
)


# ============================================================
# Example Usage
# ============================================================

async def calculator_example():
    """Demonstrate calculator tools."""
    print("=== Calculator Example ===\n")

    result = await Runner.run(
        calculator_agent,
        "Add 1234.56 and 789.12, then format the result as EUR",
    )
    print(f"Result: {result.final_output}\n")


async def ecommerce_example():
    """Demonstrate e-commerce tools."""
    print("=== E-Commerce Example ===\n")

    result = await Runner.run(
        ecommerce_agent,
        "Search for wireless headphones in electronics, show me the top 3 by rating",
    )
    print(f"Search Result: {result.final_output}\n")


async def async_tools_example():
    """Demonstrate async tools."""
    print("=== Async Tools Example ===\n")

    result = await Runner.run(
        data_agent,
        "What's the weather in San Francisco and the current price of AAPL?",
    )
    print(f"Data Result: {result.final_output}\n")


async def context_example():
    """Demonstrate context-aware tools."""
    print("=== Context-Aware Example ===\n")

    context = {
        "user_id": "user_123",
        "user_preferences": {
            "theme": "dark",
            "language": "en",
            "notifications": "enabled",
        },
    }

    result = await Runner.run(
        context_agent,
        "What are my notification settings? Also look up my user data.",
        context=context,
    )
    print(f"Context Result: {result.final_output}\n")


async def main():
    """Run all examples."""
    await calculator_example()
    await ecommerce_example()
    await async_tools_example()
    await context_example()


if __name__ == "__main__":
    asyncio.run(main())
