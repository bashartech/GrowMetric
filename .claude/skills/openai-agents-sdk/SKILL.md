---
name: OpenAI Agents SDK Development
description: This skill should be used when the user asks to "create an AI agent", "build a multi-agent system", "implement agent handoffs", "add guardrails to agents", "create function tools for agents", "implement agent tracing", "build agentic workflows", "create a triage agent", "implement input/output guardrails", "add tools to agents", or mentions OpenAI Agents SDK, agents, handoffs, guardrails, Runner, or multi-agent orchestration.
version: 1.0.0
---

# OpenAI Agents SDK Development Guide

This skill provides comprehensive guidance for building multi-agent AI applications using the OpenAI Agents SDK (Python).

## Core Concepts

The OpenAI Agents SDK is a lightweight framework for building agentic AI applications. It provides:

- **Agents**: LLMs configured with instructions, tools, and handoffs
- **Handoffs**: Allow agents to transfer control to other agents
- **Guardrails**: Input and output validation for safety
- **Tools**: Functions that agents can call to perform actions
- **Runner**: Executes agent loops and manages conversations
- **Tracing**: Built-in observability for debugging and monitoring

## Installation

```bash
pip install openai-agents
```

## Project Structure

```
project/
├── agents/
│   ├── __init__.py
│   ├── triage.py          # Main triage/routing agent
│   ├── specialists/       # Specialized agents
│   │   ├── __init__.py
│   │   ├── support.py
│   │   └── sales.py
│   └── guardrails/        # Guardrail definitions
│       ├── __init__.py
│       └── content_filter.py
├── tools/
│   ├── __init__.py
│   └── api_tools.py       # Function tools
├── main.py                # Application entry point
├── config.py              # Configuration
└── requirements.txt
```

## Basic Agent Setup

```python
from agents import Agent, Runner
import asyncio

# Create a simple agent
agent = Agent(
    name="Assistant",
    instructions="You are a helpful assistant that answers questions clearly and concisely.",
)

# Run the agent
async def main():
    result = await Runner.run(agent, "What is the capital of France?")
    print(result.final_output)

asyncio.run(main())
```

## Agent Configuration

### Basic Agent

```python
from agents import Agent

agent = Agent(
    name="Customer Support",
    instructions="""You are a customer support agent.
    - Be polite and professional
    - Ask clarifying questions when needed
    - Escalate complex issues to specialists""",
)
```

### Agent with Structured Output

```python
from agents import Agent
from pydantic import BaseModel

class TicketClassification(BaseModel):
    category: str
    priority: str
    summary: str

classifier = Agent(
    name="Ticket Classifier",
    instructions="Classify support tickets by category and priority.",
    output_type=TicketClassification,
)
```

### Agent with Model Selection

```python
agent = Agent(
    name="Analyst",
    instructions="You analyze complex data and provide insights.",
    model="gpt-4o",  # Specify model
)
```

## Function Tools

Tools allow agents to perform actions and access external data.

### Basic Function Tool

```python
from agents import Agent, function_tool

@function_tool
def get_weather(city: str) -> str:
    """Get the current weather for a city.

    Args:
        city: The city name to get weather for.
    """
    # In production, call a weather API
    return f"The weather in {city} is sunny, 72°F"

@function_tool
def search_database(query: str, limit: int = 10) -> list[dict]:
    """Search the database for records.

    Args:
        query: The search query.
        limit: Maximum number of results to return.
    """
    # In production, query your database
    return [{"id": 1, "name": "Result 1"}]

agent = Agent(
    name="Assistant",
    instructions="Help users with weather and database queries.",
    tools=[get_weather, search_database],
)
```

### Async Function Tool

```python
from agents import function_tool
import httpx

@function_tool
async def fetch_user_data(user_id: str) -> dict:
    """Fetch user data from the API.

    Args:
        user_id: The user's unique identifier.
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(f"https://api.example.com/users/{user_id}")
        return response.json()
```

### Tool with Context Access

```python
from agents import Agent, function_tool, RunContextWrapper
from typing import Any

@function_tool
def get_user_profile(ctx: RunContextWrapper[Any], user_id: str) -> dict:
    """Get user profile with context access.

    Args:
        user_id: The user ID to look up.
    """
    # Access shared context data
    db = ctx.context.get("database")
    return db.get_user(user_id)
```

### Tool with Custom Name

```python
@function_tool(name_override="fetch_data")
def read_file(path: str) -> str:
    """Read file contents.

    Args:
        path: Path to the file.
    """
    with open(path) as f:
        return f.read()
```

## Handoffs

Handoffs allow agents to transfer control to specialized agents.

### Basic Handoffs

```python
from agents import Agent, handoff

# Specialist agents
billing_agent = Agent(
    name="Billing Agent",
    handoff_description="Handles billing, payments, and invoices",
    instructions="You handle all billing-related inquiries.",
)

technical_agent = Agent(
    name="Technical Support",
    handoff_description="Handles technical issues and troubleshooting",
    instructions="You provide technical support and troubleshooting.",
)

# Triage agent that routes to specialists
triage_agent = Agent(
    name="Triage Agent",
    instructions="""You are the first point of contact.
    - For billing questions, hand off to Billing Agent
    - For technical issues, hand off to Technical Support
    - Answer general questions directly""",
    handoffs=[billing_agent, technical_agent],
)
```

### Handoff with Custom Configuration

```python
from agents import Agent, handoff

support_agent = Agent(name="Support", instructions="...")

triage = Agent(
    name="Triage",
    instructions="Route customers to support.",
    handoffs=[
        handoff(
            support_agent,
            tool_name="transfer_to_support",
            tool_description="Transfer to support for assistance",
        )
    ],
)
```

### Handoff with Data Transfer

```python
from agents import Agent, handoff, Handoff
from pydantic import BaseModel

class EscalationData(BaseModel):
    reason: str
    priority: str
    context: str

def on_escalate(ctx, data: EscalationData):
    """Called when handoff occurs."""
    print(f"Escalating: {data.reason}")

escalation_handoff = Handoff(
    target=supervisor_agent,
    tool_name="escalate",
    tool_description="Escalate to supervisor",
    input_type=EscalationData,
    on_handoff=on_escalate,
)
```

## Guardrails

Guardrails validate inputs and outputs for safety and compliance.

### Input Guardrail

```python
from agents import Agent, InputGuardrail, GuardrailFunctionOutput, Runner
from pydantic import BaseModel

class ContentCheck(BaseModel):
    is_appropriate: bool
    reason: str

# Guardrail agent that checks input
guardrail_agent = Agent(
    name="Content Filter",
    instructions="Check if the input is appropriate. Flag harmful content.",
    output_type=ContentCheck,
)

async def content_guardrail(ctx, agent, input_data) -> GuardrailFunctionOutput:
    result = await Runner.run(guardrail_agent, input_data, context=ctx.context)
    output = result.final_output_as(ContentCheck)
    return GuardrailFunctionOutput(
        output_info=output,
        tripwire_triggered=not output.is_appropriate,
    )

main_agent = Agent(
    name="Assistant",
    instructions="Help users with their questions.",
    input_guardrails=[
        InputGuardrail(guardrail_function=content_guardrail),
    ],
)
```

### Output Guardrail

```python
from agents import Agent, output_guardrail, GuardrailFunctionOutput, RunContextWrapper
from pydantic import BaseModel

class ResponseCheck(BaseModel):
    response: str

@output_guardrail
async def pii_guardrail(
    ctx: RunContextWrapper,
    agent: Agent,
    output: ResponseCheck,
) -> GuardrailFunctionOutput:
    """Check if output contains PII."""
    has_pii = check_for_pii(output.response)  # Your PII detection logic
    return GuardrailFunctionOutput(
        output_info={"has_pii": has_pii},
        tripwire_triggered=has_pii,
    )

agent = Agent(
    name="Assistant",
    instructions="Help users.",
    output_guardrails=[pii_guardrail],
    output_type=ResponseCheck,
)
```

### Handling Guardrail Exceptions

```python
from agents import Runner
from agents.exceptions import InputGuardrailTripwireTriggered, OutputGuardrailTripwireTriggered

async def safe_run(agent, input_text):
    try:
        result = await Runner.run(agent, input_text)
        return result.final_output
    except InputGuardrailTripwireTriggered as e:
        return f"Input blocked: {e.guardrail_result.output.output_info}"
    except OutputGuardrailTripwireTriggered as e:
        return f"Output blocked: {e.guardrail_result.output.output_info}"
```

## Running Agents

### Basic Run

```python
from agents import Runner

result = await Runner.run(agent, "Hello, how can you help me?")
print(result.final_output)
```

### Run with Context

```python
from agents import Runner

# Shared context available to all tools
context = {
    "user_id": "12345",
    "session_id": "abc-xyz",
    "database": db_connection,
}

result = await Runner.run(
    agent,
    "What are my recent orders?",
    context=context,
)
```

### Run with Conversation History

```python
from agents import Runner
from agents.items import UserMessageItem, AssistantMessageItem

# Build conversation history
history = [
    UserMessageItem(content="Hi, I need help with my order"),
    AssistantMessageItem(content="I'd be happy to help! What's your order number?"),
    UserMessageItem(content="It's ORDER-12345"),
]

result = await Runner.run(agent, history)
```

### Streaming Responses

```python
from agents import Runner

async for event in Runner.run_streamed(agent, "Tell me a story"):
    if hasattr(event, "text"):
        print(event.text, end="", flush=True)
```

## Multi-Agent Patterns

### Triage Pattern

```python
from agents import Agent

# Specialist agents
math_tutor = Agent(
    name="Math Tutor",
    handoff_description="Specialist for math questions",
    instructions="You help with math problems. Show step-by-step solutions.",
)

writing_tutor = Agent(
    name="Writing Tutor",
    handoff_description="Specialist for writing and essays",
    instructions="You help with writing, grammar, and essays.",
)

# Triage agent
triage = Agent(
    name="Triage",
    instructions="""Determine the type of homework help needed:
    - Math problems → Math Tutor
    - Writing/essays → Writing Tutor
    - Other → Answer directly""",
    handoffs=[math_tutor, writing_tutor],
)
```

### Pipeline Pattern

```python
from agents import Agent, Runner

# Stage 1: Analyze
analyzer = Agent(
    name="Analyzer",
    instructions="Analyze the input and extract key information.",
)

# Stage 2: Process
processor = Agent(
    name="Processor",
    instructions="Process the analyzed data and generate results.",
)

# Stage 3: Format
formatter = Agent(
    name="Formatter",
    instructions="Format the results for presentation.",
)

async def pipeline(input_data):
    r1 = await Runner.run(analyzer, input_data)
    r2 = await Runner.run(processor, r1.final_output)
    r3 = await Runner.run(formatter, r2.final_output)
    return r3.final_output
```

### Supervisor Pattern

```python
from agents import Agent

worker1 = Agent(name="Researcher", instructions="Research topics thoroughly.")
worker2 = Agent(name="Writer", instructions="Write clear content.")

supervisor = Agent(
    name="Supervisor",
    instructions="""You coordinate work between specialists:
    1. Send research tasks to Researcher
    2. Send writing tasks to Writer
    3. Review and combine their outputs""",
    handoffs=[worker1, worker2],
)
```

## Tracing and Debugging

### Enable Tracing

```python
from agents import Runner, enable_tracing

# Enable tracing for debugging
enable_tracing()

result = await Runner.run(agent, "Test input")
```

### Custom Trace Handler

```python
from agents import set_trace_handler

def my_trace_handler(trace):
    print(f"Trace: {trace.name} - {trace.duration_ms}ms")

set_trace_handler(my_trace_handler)
```

## Best Practices

1. **Clear Instructions**: Write specific, unambiguous agent instructions
2. **Use Structured Output**: Define Pydantic models for predictable outputs
3. **Implement Guardrails**: Add input/output validation for production
4. **Handle Errors**: Catch guardrail exceptions and tool failures gracefully
5. **Use Context**: Share state via context rather than global variables
6. **Design Handoffs Carefully**: Make handoff descriptions clear and specific
7. **Monitor with Tracing**: Enable tracing in development and production
8. **Test Agents**: Write tests for agents, tools, and guardrails
9. **Keep Tools Focused**: Each tool should do one thing well
10. **Document Tool Functions**: Use clear docstrings for tool descriptions

## Common Patterns

See the `references/` directory for detailed patterns:
- `tools.md` - Advanced tool patterns and best practices
- `handoffs.md` - Multi-agent orchestration patterns
- `guardrails.md` - Safety and validation patterns

See the `examples/` directory for working code:
- `basic_agent.py` - Simple agent setup
- `multi_agent_triage.py` - Multi-agent routing example
- `tools_example.py` - Function tools implementation
