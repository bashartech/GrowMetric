"""
Basic Agent Example

Demonstrates the fundamental setup and usage of an OpenAI Agents SDK agent.
"""

from agents import Agent, Runner, function_tool
from pydantic import BaseModel
import asyncio


# Define a structured output type
class TaskResponse(BaseModel):
    answer: str
    confidence: float
    sources: list[str] = []


# Define a simple tool
@function_tool
def get_current_time() -> str:
    """Get the current date and time.

    Returns:
        Current datetime as a formatted string.
    """
    from datetime import datetime

    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


@function_tool
def calculate(expression: str) -> float:
    """Safely evaluate a mathematical expression.

    Args:
        expression: A mathematical expression like "2 + 2" or "10 * 5".

    Returns:
        The result of the calculation.
    """
    # Only allow safe characters for math
    allowed = set("0123456789+-*/.() ")
    if not all(c in allowed for c in expression):
        raise ValueError("Invalid characters in expression")
    return eval(expression)


# Create the agent
assistant = Agent(
    name="Basic Assistant",
    instructions="""You are a helpful assistant that can:
    - Answer general questions
    - Tell the current time
    - Perform calculations

    Be concise and helpful in your responses.""",
    tools=[get_current_time, calculate],
)


# Agent with structured output
structured_assistant = Agent(
    name="Structured Assistant",
    instructions="""You are a research assistant.
    Always provide your answer with a confidence level (0-1).
    Include sources when available.""",
    output_type=TaskResponse,
)


async def basic_example():
    """Run a basic conversation with the agent."""
    print("=== Basic Agent Example ===\n")

    # Simple query
    result = await Runner.run(assistant, "What time is it?")
    print(f"Time query: {result.final_output}\n")

    # Calculation
    result = await Runner.run(assistant, "Calculate 15 * 7 + 23")
    print(f"Calculation: {result.final_output}\n")

    # General question
    result = await Runner.run(assistant, "What is the capital of Japan?")
    print(f"General question: {result.final_output}\n")


async def structured_output_example():
    """Run with structured output."""
    print("=== Structured Output Example ===\n")

    result = await Runner.run(
        structured_assistant,
        "What is machine learning?",
    )

    # Access structured output
    response = result.final_output_as(TaskResponse)
    print(f"Answer: {response.answer}")
    print(f"Confidence: {response.confidence}")
    print(f"Sources: {response.sources}\n")


async def conversation_example():
    """Demonstrate multi-turn conversation."""
    print("=== Conversation Example ===\n")

    from agents.items import UserMessageItem, AssistantMessageItem

    # Build conversation history
    history = [
        UserMessageItem(content="My name is Alice."),
        AssistantMessageItem(content="Nice to meet you, Alice! How can I help you today?"),
        UserMessageItem(content="What's my name?"),
    ]

    result = await Runner.run(assistant, history)
    print(f"Memory test: {result.final_output}\n")


async def context_example():
    """Demonstrate using context."""
    print("=== Context Example ===\n")

    # Create agent with context-aware tool
    @function_tool
    def get_user_info(ctx, field: str) -> str:
        """Get information about the current user.

        Args:
            field: The field to retrieve (name, email, plan).
        """
        user = ctx.context.get("user", {})
        return user.get(field, "Unknown")

    context_agent = Agent(
        name="Context Agent",
        instructions="Help users with their account. Use get_user_info to look up their details.",
        tools=[get_user_info],
    )

    # Provide context
    context = {
        "user": {
            "name": "Alice Smith",
            "email": "alice@example.com",
            "plan": "Premium",
        }
    }

    result = await Runner.run(
        context_agent,
        "What plan am I on?",
        context=context,
    )
    print(f"Context result: {result.final_output}\n")


async def main():
    """Run all examples."""
    await basic_example()
    await structured_output_example()
    await conversation_example()
    await context_example()


if __name__ == "__main__":
    asyncio.run(main())
