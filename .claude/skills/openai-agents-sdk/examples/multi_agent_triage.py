"""
Multi-Agent Triage Example

Demonstrates a customer service system with specialized agents
and intelligent routing via a triage agent.
"""

from agents import Agent, Runner, InputGuardrail, GuardrailFunctionOutput, function_tool
from agents.exceptions import InputGuardrailTripwireTriggered
from pydantic import BaseModel
import asyncio


# ============================================================
# Structured Output Types
# ============================================================

class ContentCheck(BaseModel):
    """Result of content moderation check."""
    is_appropriate: bool
    reason: str


class TicketInfo(BaseModel):
    """Support ticket information."""
    ticket_id: str
    status: str
    issue: str
    resolution: str | None = None


class RefundResult(BaseModel):
    """Result of a refund request."""
    approved: bool
    amount: float
    reason: str


# ============================================================
# Tools for Specialist Agents
# ============================================================

@function_tool
def lookup_order(order_id: str) -> dict:
    """Look up an order by ID.

    Args:
        order_id: The order identifier.

    Returns:
        Order details including status and items.
    """
    # Simulated order database
    orders = {
        "ORD-001": {
            "id": "ORD-001",
            "status": "delivered",
            "total": 99.99,
            "items": ["Widget A", "Gadget B"],
            "date": "2024-01-15",
        },
        "ORD-002": {
            "id": "ORD-002",
            "status": "shipped",
            "total": 149.99,
            "items": ["Premium Widget"],
            "date": "2024-01-20",
        },
    }
    return orders.get(order_id, {"error": "Order not found"})


@function_tool
def process_refund(order_id: str, reason: str) -> RefundResult:
    """Process a refund request.

    Args:
        order_id: The order to refund.
        reason: Reason for the refund.

    Returns:
        Refund result with approval status.
    """
    order = lookup_order(order_id)
    if "error" in order:
        return RefundResult(approved=False, amount=0, reason="Order not found")

    # Simple refund logic
    return RefundResult(
        approved=True,
        amount=order["total"],
        reason=f"Refund approved for: {reason}",
    )


@function_tool
def check_system_status(service: str) -> dict:
    """Check the status of a system service.

    Args:
        service: The service to check (api, database, auth).

    Returns:
        Service status information.
    """
    statuses = {
        "api": {"status": "operational", "latency_ms": 45},
        "database": {"status": "operational", "latency_ms": 12},
        "auth": {"status": "degraded", "latency_ms": 250},
    }
    return statuses.get(service, {"status": "unknown"})


@function_tool
def create_support_ticket(issue: str, priority: str = "medium") -> TicketInfo:
    """Create a support ticket.

    Args:
        issue: Description of the issue.
        priority: Ticket priority (low, medium, high).

    Returns:
        Created ticket information.
    """
    import random
    ticket_id = f"TKT-{random.randint(1000, 9999)}"
    return TicketInfo(
        ticket_id=ticket_id,
        status="open",
        issue=issue,
        resolution=None,
    )


# ============================================================
# Guardrail Agent
# ============================================================

guardrail_agent = Agent(
    name="Content Moderator",
    instructions="""Evaluate if the user's message is appropriate for a customer service context.

    Flag messages that contain:
    - Threats or harassment
    - Extremely vulgar language
    - Attempts to hack or exploit the system

    Normal complaints, frustration, or criticism are ALLOWED - customers may be upset.""",
    output_type=ContentCheck,
)


async def content_guardrail(ctx, agent, input_data) -> GuardrailFunctionOutput:
    """Check if input is appropriate for customer service."""
    result = await Runner.run(guardrail_agent, input_data, context=ctx.context)
    output = result.final_output_as(ContentCheck)
    return GuardrailFunctionOutput(
        output_info=output.model_dump(),
        tripwire_triggered=not output.is_appropriate,
    )


# ============================================================
# Specialist Agents
# ============================================================

billing_agent = Agent(
    name="Billing Specialist",
    handoff_description="Handles billing inquiries, payment issues, refunds, and invoices",
    instructions="""You are a billing specialist.

    You can help with:
    - Order lookups and status
    - Refund requests
    - Payment issues
    - Invoice questions

    Always verify the order ID before processing refunds.
    Be empathetic but follow refund policies.""",
    tools=[lookup_order, process_refund],
)

technical_agent = Agent(
    name="Technical Support",
    handoff_description="Handles technical issues, bugs, errors, and system problems",
    instructions="""You are a technical support specialist.

    You can help with:
    - System status checks
    - Error troubleshooting
    - Bug reports
    - Technical questions

    Always check system status first when users report issues.
    Create support tickets for complex issues.""",
    tools=[check_system_status, create_support_ticket],
)

general_agent = Agent(
    name="General Support",
    handoff_description="Handles general inquiries, product questions, and feedback",
    instructions="""You are a general customer support agent.

    You help with:
    - Product information
    - General questions
    - Feedback collection
    - Anything not billing or technical

    Be friendly and helpful. Collect feedback graciously.""",
)


# ============================================================
# Triage Agent
# ============================================================

triage_agent = Agent(
    name="Customer Service Triage",
    instructions="""You are the first point of contact for customers.

    Your job is to:
    1. Greet the customer warmly
    2. Understand their issue
    3. Route them to the right specialist:

       BILLING SPECIALIST - for:
       - Orders and order status
       - Payments and refunds
       - Invoices and billing questions

       TECHNICAL SUPPORT - for:
       - Errors and bugs
       - System issues
       - Technical questions
       - "Something isn't working"

       GENERAL SUPPORT - for:
       - Product questions
       - Feedback
       - General inquiries
       - Anything else

    If unclear, ask ONE clarifying question before routing.
    Don't try to solve the problem yourself - route to specialists.""",
    handoffs=[billing_agent, technical_agent, general_agent],
    input_guardrails=[
        InputGuardrail(guardrail_function=content_guardrail, name="content_filter"),
    ],
)


# ============================================================
# Example Usage
# ============================================================

async def handle_customer(message: str) -> str:
    """Handle a customer inquiry through the triage system."""
    try:
        result = await Runner.run(triage_agent, message)
        return result.final_output
    except InputGuardrailTripwireTriggered as e:
        return "I'm sorry, but I can't process that message. Please rephrase your request."


async def main():
    """Run example customer service scenarios."""
    print("=" * 60)
    print("Multi-Agent Customer Service System")
    print("=" * 60 + "\n")

    # Test scenarios
    scenarios = [
        ("Billing inquiry", "I need a refund for order ORD-001, the product was damaged"),
        ("Technical issue", "The website keeps showing error 500 when I try to log in"),
        ("General question", "What are your business hours?"),
        ("Unclear inquiry", "I have a problem"),
    ]

    for title, message in scenarios:
        print(f"--- {title} ---")
        print(f"Customer: {message}\n")
        response = await handle_customer(message)
        print(f"Response: {response}\n")
        print()


if __name__ == "__main__":
    asyncio.run(main())
