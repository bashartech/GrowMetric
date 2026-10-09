# Handoffs Reference

## Overview

Handoffs allow agents to transfer control to other agents. This enables building sophisticated multi-agent systems where specialized agents handle specific tasks.

## Basic Handoffs

### Simple Handoff

```python
from agents import Agent

# Specialist agent
sales_agent = Agent(
    name="Sales Agent",
    handoff_description="Handles sales inquiries and product information",
    instructions="You are a sales specialist. Help with product questions and purchases.",
)

# Main agent with handoff capability
main_agent = Agent(
    name="Receptionist",
    instructions="Greet users and route sales questions to Sales Agent.",
    handoffs=[sales_agent],
)
```

### Using handoff() Function

```python
from agents import Agent, handoff

support_agent = Agent(name="Support", instructions="...")

main_agent = Agent(
    name="Main",
    handoffs=[
        handoff(support_agent),  # Equivalent to just passing the agent
    ],
)
```

## Handoff Configuration

### Custom Tool Name and Description

```python
from agents import Agent, handoff

billing_agent = Agent(name="Billing", instructions="...")

main_agent = Agent(
    name="Main",
    handoffs=[
        handoff(
            billing_agent,
            tool_name="transfer_to_billing",
            tool_description="Transfer customer to billing department for payment and invoice issues",
        ),
    ],
)
```

### Handoff with Input Data

Pass structured data when handing off:

```python
from agents import Agent, Handoff
from pydantic import BaseModel

class TransferContext(BaseModel):
    customer_id: str
    issue_summary: str
    priority: str

def handle_transfer(ctx, data: TransferContext):
    print(f"Transferring: {data.customer_id} - {data.issue_summary}")

specialist_agent = Agent(name="Specialist", instructions="...")

main_agent = Agent(
    name="Main",
    handoffs=[
        Handoff(
            target=specialist_agent,
            tool_name="escalate",
            tool_description="Escalate to specialist with context",
            input_type=TransferContext,
            on_handoff=handle_transfer,
        ),
    ],
)
```

## Multi-Agent Patterns

### Triage Pattern

Route users to the right specialist:

```python
from agents import Agent

# Specialists
tech_support = Agent(
    name="Technical Support",
    handoff_description="Handles technical issues, bugs, and troubleshooting",
    instructions="""You are a technical support specialist.
    - Diagnose technical issues
    - Provide step-by-step solutions
    - Escalate complex bugs to engineering""",
)

billing_support = Agent(
    name="Billing Support",
    handoff_description="Handles billing, payments, refunds, and subscriptions",
    instructions="""You are a billing specialist.
    - Answer billing questions
    - Process refund requests
    - Manage subscriptions""",
)

sales_support = Agent(
    name="Sales",
    handoff_description="Handles product inquiries, pricing, and new purchases",
    instructions="""You are a sales representative.
    - Answer product questions
    - Provide pricing information
    - Guide purchase decisions""",
)

# Triage agent
triage = Agent(
    name="Customer Service",
    instructions="""You are the first point of contact for customers.

    Route customers based on their needs:
    - Technical problems, errors, bugs → Technical Support
    - Billing, payments, refunds → Billing Support
    - Product questions, pricing → Sales

    If unclear, ask clarifying questions before routing.""",
    handoffs=[tech_support, billing_support, sales_support],
)
```

### Hierarchical Pattern

Multi-level organization with supervisors:

```python
from agents import Agent

# Level 1: Workers
researcher = Agent(
    name="Researcher",
    handoff_description="Conducts research and gathers information",
    instructions="You research topics and compile information.",
)

writer = Agent(
    name="Writer",
    handoff_description="Writes and edits content",
    instructions="You write clear, engaging content.",
)

# Level 2: Team Lead
content_lead = Agent(
    name="Content Lead",
    handoff_description="Manages content creation",
    instructions="""You coordinate content creation:
    - Assign research tasks to Researcher
    - Assign writing tasks to Writer
    - Review and approve outputs""",
    handoffs=[researcher, writer],
)

# Level 3: Manager
project_manager = Agent(
    name="Project Manager",
    instructions="You oversee projects and coordinate with Content Lead.",
    handoffs=[content_lead],
)
```

### Pipeline Pattern

Sequential processing through agents:

```python
from agents import Agent, Runner

# Stage agents
data_collector = Agent(
    name="Data Collector",
    instructions="Collect and structure raw data from the input.",
)

analyzer = Agent(
    name="Analyzer",
    instructions="Analyze the collected data and identify patterns.",
)

report_generator = Agent(
    name="Report Generator",
    instructions="Generate a comprehensive report from the analysis.",
)

async def process_pipeline(input_data: str) -> str:
    # Stage 1: Collect
    collection = await Runner.run(data_collector, input_data)

    # Stage 2: Analyze
    analysis = await Runner.run(analyzer, collection.final_output)

    # Stage 3: Report
    report = await Runner.run(report_generator, analysis.final_output)

    return report.final_output
```

### Collaborative Pattern

Agents that can hand off back and forth:

```python
from agents import Agent

# Define agents first, add handoffs after
planner = Agent(
    name="Planner",
    instructions="""You create plans and strategies.
    Hand off to Executor when the plan is ready.
    Accept feedback from Executor to revise plans.""",
)

executor = Agent(
    name="Executor",
    instructions="""You execute plans step by step.
    Hand off to Planner if the plan needs revision.
    Report progress and issues.""",
)

reviewer = Agent(
    name="Reviewer",
    instructions="""You review completed work.
    Hand off to Planner for major revisions.
    Hand off to Executor for minor fixes.""",
)

# Set up bidirectional handoffs
planner.handoffs = [executor]
executor.handoffs = [planner, reviewer]
reviewer.handoffs = [planner, executor]
```

## Handoff Events

### on_handoff Callback

Execute code when a handoff occurs:

```python
from agents import Handoff

async def log_handoff(ctx, input_data):
    user_id = ctx.context.get("user_id")
    print(f"User {user_id} transferred to specialist")
    await save_to_analytics(user_id, "handoff_occurred")

handoff = Handoff(
    target=specialist_agent,
    on_handoff=log_handoff,
)
```

### Conditional Handoffs

Control when handoffs are available:

```python
from agents import Agent, Handoff

def check_business_hours(ctx, agent) -> bool:
    from datetime import datetime
    hour = datetime.now().hour
    return 9 <= hour <= 17  # Only during business hours

human_agent = Agent(name="Human Agent", instructions="...")

main_agent = Agent(
    name="Bot",
    handoffs=[
        Handoff(
            target=human_agent,
            tool_name="speak_to_human",
            is_enabled=check_business_hours,
        ),
    ],
)
```

## Realtime Agent Handoffs

For voice/realtime applications:

```python
from agents.realtime import RealtimeAgent, realtime_handoff

billing_agent = RealtimeAgent(
    name="Billing",
    instructions="You handle billing questions via voice.",
)

technical_agent = RealtimeAgent(
    name="Technical",
    instructions="You handle technical support via voice.",
)

main_agent = RealtimeAgent(
    name="Reception",
    instructions="Greet callers and route them appropriately.",
    handoffs=[
        realtime_handoff(billing_agent, tool_description="Transfer to billing"),
        realtime_handoff(technical_agent, tool_description="Transfer to technical support"),
    ],
)
```

## Best Practices

### 1. Clear Handoff Descriptions

```python
# Good - specific and actionable
Agent(
    handoff_description="Handles refund requests for orders placed in the last 30 days",
)

# Bad - vague
Agent(
    handoff_description="Handles some customer issues",
)
```

### 2. Explicit Instructions

```python
triage = Agent(
    instructions="""Route based on customer intent:

    BILLING (hand to Billing Agent):
    - Payment issues
    - Invoice questions
    - Refund requests

    TECHNICAL (hand to Tech Agent):
    - Error messages
    - Feature questions
    - Integration help

    Ask clarifying questions if the intent is unclear.""",
)
```

### 3. Graceful Fallbacks

```python
general_agent = Agent(
    name="General Support",
    handoff_description="Handles general inquiries not covered by specialists",
    instructions="You help with general questions and guide users.",
)

triage = Agent(
    handoffs=[specialist1, specialist2, general_agent],  # Fallback last
)
```

### 4. Context Preservation

```python
from agents import Handoff
from pydantic import BaseModel

class HandoffContext(BaseModel):
    conversation_summary: str
    customer_sentiment: str
    previous_agents: list[str]

def preserve_context(ctx, data: HandoffContext):
    # Store context for the receiving agent
    ctx.context["handoff_context"] = data

handoff = Handoff(
    target=specialist,
    input_type=HandoffContext,
    on_handoff=preserve_context,
)
```

### 5. Avoid Circular Handoffs

```python
# Be careful with bidirectional handoffs
# Add clear conditions to prevent infinite loops

agent_a = Agent(
    instructions="""Only hand off to Agent B if:
    - You cannot solve the problem
    - The user explicitly requests it
    Do NOT hand off just to "check with" Agent B.""",
)
```
