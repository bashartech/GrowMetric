# GrowMetrics — AI Business Intelligence & Decision Platform

## 1. Project Definition

Build a production-quality, multi-tenant SaaS application called **GrowMetrics**.

GrowMetrics is an **AI-powered Business Intelligence and Decision Intelligence platform**.

The platform allows a business to:

* Upload business data such as Excel/CSV files.
* Connect an external business database using read-only credentials.
* Normalize and manage data inside a business workspace.
* View business performance through dynamic dashboards.
* Ask an AI Business Analyst questions about the data.
* Investigate business problems using AI-powered data analysis.
* Run structured business simulations such as price changes and expense changes.
* Receive AI-generated recommendations.
* Automatically detect important business problems and anomalies.
* Generate weekly business reports.
* Send reports and alerts through email.
* View detected problems and recommendations inside the application.

The goal is to demonstrate strong skills in:

* Full-stack development
* SaaS architecture
* Multi-tenancy
* Database design
* Data ingestion
* Data normalization
* Secure external database connections
* Analytics
* AI agents
* Tool calling
* Background processing
* Redis queues
* Email automation
* Scheduled jobs
* AI reliability
* Observability
* Security
* Subscription-ready architecture

This should be a serious portfolio project that can be discussed in interviews for full-stack, backend, AI engineering, and software engineering roles.

---

# 2. Important Product Boundary

Do NOT turn GrowMetrics into:

* A generic chatbot
* An "AI employee"
* An autonomous company
* A generic AI operating system
* A recruitment agent
* A customer-support platform

GrowMetrics is specifically a:

> **Business Intelligence + Decision Intelligence SaaS platform**

AI is embedded into business analytics and decision workflows.

The AI should not simply generate text.

It should use actual business data through controlled tools, calculations, SQL queries, analytics functions, and business rules.

Never allow the LLM to invent business numbers.

---

# 3. Technology Stack

Use the following stack unless there is a strong technical reason to introduce another technology.

## Frontend

* Next.js
* TypeScript
* React
* Tailwind CSS
* shadcn/ui
* Recharts
* React Hook Form
* Zod
* TanStack Query where appropriate

Use the Next.js App Router.

---

## Backend

Use:

* Node.js
* Express.js
* TypeScript

The Express backend should expose a clean REST API.

Do not put all business logic inside Next.js API routes.

Keep frontend and backend responsibilities clearly separated.

---

## Main Database

Use:

* PostgreSQL
* Prisma ORM

PostgreSQL stores application data such as:

* users
* organizations
* workspaces
* subscriptions
* datasets
* data sources
* imports
* schemas
* relationships
* business metrics
* dashboards
* conversations
* agent runs
* recommendations
* alerts
* reports
* audit logs

---

## AI

Use:

* OpenAI Agents SDK
* Groq API as the model provider

The architecture must keep the AI provider abstract enough that another model provider can be introduced later.

Do not hard-code the entire application around one specific model.

---

## Background Processing

Use:

* Redis
* Upstash Redis
* Queue-based background jobs

Background jobs should handle operations such as:

* Excel processing
* large CSV processing
* data imports
* database synchronization
* anomaly detection
* weekly reports
* email delivery
* scheduled analysis

Do not perform long-running operations synchronously inside normal HTTP requests.

---

## Email

Use:

* Nodemailer

Email should support:

* weekly reports
* important business alerts
* anomaly notifications
* manager notifications

Create a reusable email service.

---

## Object Storage

Use:

* Cloudflare R2 where needed

Use R2 for original uploaded files and generated files when appropriate.

Do not use object storage as the primary analytics database.

---

# 4. High-Level Architecture

Use this conceptual architecture:

```text
                         Next.js Frontend
                               |
                               v
                         Express API
                               |
          +--------------------+--------------------+
          |                    |                    |
          v                    v                    v
     PostgreSQL            Redis/Queue          R2 Storage
       Prisma
          |
          v
   Business Data Layer
          |
          +-------------------+
          |                   |
          v                   v
    Analytics Engine     AI Agent Layer
                              |
                  +-----------+-----------+
                  |           |           |
                  v           v           v
             Data Agent  Investigation  Simulation
```

Background:

```text
Scheduler
    |
    v
Redis Queue
    |
    +--> Data Processing Worker
    |
    +--> Anomaly Detection Worker
    |
    +--> Report Worker
    |
    +--> Email Worker
```

---

# 5. Multi-Tenant Architecture

The application must support multiple organizations.

Use this hierarchy:

```text
User
  |
  v
Organization
  |
  v
Workspace
  |
  +---- Data Sources
  |
  +---- Datasets
  |
  +---- Dashboards
  |
  +---- AI Conversations
  |
  +---- Investigations
  |
  +---- Recommendations
  |
  +---- Reports
  |
  +---- Alerts
```

## Single-Account Model

For the initial version, GrowMetrics ships a **single-account model** per organization
to keep the first release focused:

* A user registers an account and provides an organization name.
* Registration creates a `User`, its `Organization`, and a default `Workspace`
  in one transaction.
* The single user implicitly owns the organization. No memberships, invitations,
  or team management are implemented in this phase.
* There are no role-based permissions (OWNER/ADMIN/MANAGER/ANALYST/VIEWER) yet.
  Feature access is controlled by the subscription plan (see §38).
* A `role` column (default `OWNER`) is reserved on the user record so
  multi-user roles can be introduced later without a schema redesign.

## Tenant Isolation

Every workspace-scoped database operation must enforce tenant isolation.

Never allow a user from Organization A to access Organization B's data by manipulating an ID in an API request.

Always derive authorization from the authenticated user's own organization/workspace record, never from client-supplied IDs.

## Future Multi-User Model

When multi-user support is added, users will belong to an organization through a
membership, with roles such as:

```text
OWNER
ADMIN
MANAGER
ANALYST
VIEWER
```

---

# 6. Authentication

Implement secure authentication.

The exact authentication implementation can be selected during development, but it must support:

* registration
* login
* logout
* protected routes
* session/token handling
* password security
* authenticated API requests

Never store plaintext passwords.

Use secure cookies/tokens according to the selected authentication architecture.

---

# 7. Workspace Onboarding

After registration:

```text
Create Account (includes Organization name)
      |
      v
Create Organization
      |
      v
Create Workspace (default, automatic)
      |
      v
Add Business Data
```

In the initial single-account model, registration is a single step that
creates the user, the organization, and a default workspace in one transaction.

Example:

```text
Organization:
Acme Retail

Workspace:
Main Business
```

After registration the frontend redirects the user to an onboarding page.

For a brand-new account the onboarding page shows the empty state:

> Let's connect your business data.

Options:

```text
Upload Excel
Upload CSV
Connect Database
```

For returning accounts the frontend routes to the overview page instead.

Additional data-source options can be added later.

---

# 8. Data Source Architecture

The application must NOT assume that one Excel file represents the whole business.

Instead:

```text
Data Source
      |
      v
Dataset
      |
      v
Business Data Layer
      |
      v
Analytics
```

Supported initial sources:

### Source 1 — Excel

User uploads:

```text
business.xlsx
```

It might contain:

```text
Sales
Customers
Products
Inventory
Expenses
```

Each sheet can become a dataset.

---

### Source 2 — CSV

Example:

```text
sales.csv
customers.csv
inventory.csv
```

---

### Source 3 — External Database

Allow users to connect an external database.

Initial supported databases can be selected based on implementation complexity.

For example:

* PostgreSQL
* MySQL

The architecture should make adding additional database engines possible later.

---

# 9. External Database Security

This is extremely important.

GrowMetrics must connect to customer databases using **read-only credentials**.

The application must never request or require write access for analytics.

The UI should clearly communicate:

> GrowMetrics requires read-only database access for analytics.

Where supported, recommend that customers create a dedicated read-only database user.

Example conceptual permission:

```sql
GRANT SELECT ON ...
```

Do not execute arbitrary write operations against customer databases.

Never expose database credentials to the frontend.

Credentials must remain server-side.

Sensitive credentials must not be logged.

---

# 10. Database Connection Flow

Use:

```text
User enters connection information
             |
             v
Express backend
             |
             v
Validate connection
             |
             v
Verify read-only access
             |
             v
Inspect available schemas/tables
             |
             v
Show tables to user
             |
             v
User selects tables
             |
             v
Profile selected data
             |
             v
Map business fields
             |
             v
Create data source
```

Do not automatically ingest the entire customer database.

Allow the user to select which tables are available to GrowMetrics.

For example:

```text
[x] orders
[x] customers
[x] products
[x] inventory

[ ] employees
[ ] salaries
[ ] internal_hr
```

---

# 11. Data Ingestion Pipeline

For uploaded files:

```text
Upload
  |
  v
Store original file
  |
  v
Validate
  |
  v
Parse
  |
  v
Profile
  |
  v
Detect schema
  |
  v
Map fields
  |
  v
Validate relationships
  |
  v
Normalize
  |
  v
Store
  |
  v
Analytics ready
```

Large files should be processed asynchronously.

Example:

```text
POST /imports
       |
       v
Create Import Job
       |
       v
Queue
       |
       v
Worker
       |
       v
Process file
```

The API should return a job/import ID instead of waiting for large files to finish processing.

---

# 12. Business Data Model

Initially support canonical business datasets such as:

```text
Sales
Customers
Products
Inventory
Expenses
Orders
```

Do not force every uploaded dataset into these categories.

The system should allow unknown/custom datasets, but the AI and dashboard should understand canonical datasets more deeply.

---

# 13. Schema Mapping

Different businesses will name columns differently.

Example:

```text
"Sale Date"      -> order_date
"Total Amount"   -> revenue
"Qty"            -> quantity
"Item"           -> product
"Customer Name"  -> customer
```

Create a schema-mapping system.

The mapping process can use:

1. deterministic rules
2. data types
3. column names
4. sample values
5. AI assistance when ambiguity exists

Never blindly trust an AI-generated schema mapping.

If confidence is low, ask the user to confirm.

Example:

> We found two possible revenue columns.

```text
Total
Net Amount

Which represents revenue?

[Total] [Net Amount]
```

---

# 14. Data Quality

Every imported dataset should be profiled.

Display:

```text
Rows
Columns
Missing values
Duplicate rows
Invalid values
Invalid dates
Numeric anomalies
Potential relationships
```

Example:

```text
Sales Dataset

125,432 rows

Missing values: 2.1%
Duplicates: 0.4%
Invalid dates: 0.1%

Status:
Ready with warnings
```

Data quality warnings should be visible before analytics are trusted.

---

# 15. Dashboard

Create the main business dashboard.

The dashboard should operate at the workspace level.

It must NOT be tied to one uploaded file.

Example dashboard:

```text
Revenue
$125,400
+10.4%

Orders
4,231
+7.2%

Customers
2,843
+4.1%

Expenses
$72,300
+3.8%

Profit
$53,100
+18.2%
```

Charts:

* revenue over time
* expenses over time
* profit over time
* sales by product
* sales by region
* customer trends
* inventory levels
* top-performing products
* underperforming products

Allow filters such as:

```text
Date
Product
Category
Region
Customer
```

Only show metrics when the necessary data exists.

Do not fabricate metrics when the underlying dataset is missing.

---

# 16. AI Business Analyst

Create a dedicated section:

## AI Analyst

This is a conversational interface for interacting with business data.

Users can ask:

```text
What were our sales last month?

Which products generated the most revenue?

Why did revenue decrease?

Which region is performing poorly?

What are our biggest expenses?

Which products are losing money?

What changed compared with last month?

What should management investigate?
```

The agent must use actual data.

It should NOT answer from general model knowledge when the question requires business-specific data.

---

# 17. AI Agent Architecture

Do not implement the AI as:

```text
User question
    |
    v
LLM
    |
    v
Answer
```

Instead:

```text
User Question
      |
      v
Agent
      |
      +--> inspect schema
      |
      +--> select dataset
      |
      +--> generate/query SQL
      |
      +--> execute read-only query
      |
      +--> calculate metrics
      |
      +--> compare periods
      |
      +--> analyze result
      |
      +--> generate chart when useful
      |
      v
Evidence-backed answer
```

Potential tools:

```text
get_workspace_datasets()
get_dataset_schema()
get_dataset_sample()
run_readonly_sql()
calculate_metric()
compare_periods()
group_by_dimension()
find_top_entities()
find_anomalies()
generate_chart_spec()
get_business_context()
```

The agent should only have access to approved tools.

---

# 18. SQL Safety

Never allow the AI to execute unrestricted SQL against a customer database.

Implement safeguards.

For external databases:

* read-only connection
* allow SELECT operations only
* reject INSERT
* reject UPDATE
* reject DELETE
* reject DROP
* reject ALTER
* reject TRUNCATE
* reject other mutation operations

Prefer query validation before execution.

Use query timeouts and reasonable row limits.

Prevent unrestricted data extraction.

Never expose database credentials to the LLM.

---

# 19. AI Investigation Feature

Create a separate feature:

# Investigations

This should not be just another chat message.

The user can choose:

```text
Investigate Revenue
Investigate Expenses
Investigate Orders
Investigate Inventory
Investigate Customers
```

Example:

```text
Revenue Investigation

Question:
Why did revenue decrease this month?
```

The system performs structured analysis:

```text
Revenue
   |
   +--> Time comparison
   |
   +--> Product breakdown
   |
   +--> Region breakdown
   |
   +--> Customer breakdown
   |
   +--> Order analysis
   |
   +--> Inventory correlation
   |
   v
Potential contributors
```

The result should be presented as a rich UI.

Example:

```text
Revenue decreased 12.4%

Main contributors

Product Category A
-$18,400

Region X
-$11,200

Returning Customers
-$7,300
```

Show evidence behind every important conclusion.

Do not present correlation as proven causation.

Use language such as:

> "The data indicates..."

> "A likely contributor is..."

> "This pattern is correlated with..."

when causal certainty cannot be established.

---

# 20. Business Simulator

Create a separate section:

# Business Simulator

Do NOT make the simulator simply another conversational response.

It should have a structured interface.

Example:

```text
Scenario Type

[Price Change]
[Marketing Spend]
[Expense Reduction]
[Inventory Change]
[Custom Scenario]
```

Example:

```text
Product:
Product A

Current Price:
$100

New Price:
$110

Expected price change:
+10%
```

Then show:

```text
Current
Revenue       $100,000
Orders          1,000
Profit          $35,000

Scenario
Revenue        $?
Orders         $?
Profit         $?
```

The simulator must use explicit calculation/model assumptions.

The LLM should assist with:

* understanding the user's scenario
* selecting relevant data
* explaining assumptions
* interpreting results

But the numerical calculations should be performed by deterministic backend logic or statistical models.

Never allow the LLM to invent numerical projections.

---

# 21. Simulator Assumptions

Every simulation must clearly show assumptions.

Example:

```text
Scenario assumptions

Price increase: +10%

Estimated demand elasticity: -1.2

Projected demand change:
-12%

Projection confidence:
Based on historical relationship

Important:
This is a scenario estimate, not a guaranteed outcome.
```

If the required data does not exist:

```text
Insufficient historical data to produce
a reliable simulation.

Available alternative:
Run a simple sensitivity analysis.
```

Do not fabricate assumptions without labeling them.

---

# 22. Simulation Results UI

Make simulation results visually impressive.

Example:

```text
Scenario Result

Revenue
Current       $100K
Projected     $106K

Profit
Current        $35K
Projected      $39K

Orders
Current        1,000
Projected        880
```

Then:

```text
Potential Benefits

✓ Higher revenue
✓ Higher average order value

Potential Risks

⚠ Lower order volume
⚠ Demand sensitivity

Key assumptions

...
```

Allow:

```text
Save Scenario
Compare Scenario
Export Scenario
Ask AI to Explain
```

---

# 23. Recommendation Engine

Create a dedicated:

# Recommendations

page.

Recommendations can originate from:

* anomaly detection
* dashboard analysis
* AI investigations
* business rules
* simulator results

Example:

```text
High Priority

Revenue decline detected

Revenue decreased 14% compared
with the previous period.

Possible contributors:
• Product A
• Region X
• Inventory availability

[Investigate]
```

Another:

```text
Inventory Warning

Product A inventory is significantly
below its recent sales rate.

[View Product]
[Investigate]
```

Every recommendation should have:

* title
* severity
* category
* description
* evidence
* timestamp
* affected dataset
* status
* optional suggested action

---

# 24. Automated Anomaly Detection

GrowMetrics should proactively detect important business changes.

Examples:

```text
Revenue decreases significantly
Inventory falls unusually quickly
Expenses increase unusually
Orders suddenly decrease
Product demand spikes
Customer activity drops
```

Create a background process:

```text
Scheduled Worker
      |
      v
Load business metrics
      |
      v
Compare against historical baseline
      |
      v
Detect anomalies
      |
      v
Create recommendation/alert
      |
      +----> UI
      |
      +----> Email
```

Do not create alerts for every small fluctuation.

Use configurable thresholds and/or statistical detection.

---

# 25. Alert System

Create:

# Alerts

Users should be able to configure alert rules.

Example:

```text
When revenue decreases by more than 10%

Action:
Create recommendation
Send email
```

Another:

```text
When inventory falls below threshold

Action:
Send manager notification
```

Alert configuration should support:

```text
Metric
Condition
Threshold
Frequency
Recipients
Enabled/Disabled
```

---

# 26. Manager Notifications

When a significant issue occurs:

```text
Detection
   |
   v
Recommendation
   |
   +------> UI
   |
   +------> Email
```

Example email:

```text
Subject:
GrowMetrics Alert: Revenue decreased 14%

Revenue decreased significantly compared
with the previous period.

Main detected contributors:
...

Open GrowMetrics to investigate.
```

Email sending should happen through a background queue rather than blocking the API request.

---

# 27. Weekly Business Report

Create:

# Reports

Allow users to generate:

## Weekly Business Report

Example:

```text
Weekly Business Report

Executive Summary

Revenue
↑ 8.2%

Orders
↑ 4.3%

Profit
↑ 6.7%

Important Changes

1. Product A sales increased
2. Region B revenue decreased
3. Inventory risk detected

Recommendations

...

AI Analysis

...
```

Reports should be generated from actual business data.

Do not allow the AI to invent statistics.

---

# 28. Scheduled Reports

Allow users to configure:

```text
Weekly
Monthly
Custom
```

Example:

```text
Every Monday at 9:00 AM
Send report to:

manager@example.com
```

The report worker generates the report.

Then the email worker sends it.

Architecture:

```text
Scheduler
   |
   v
Report Job
   |
   v
Generate Report
   |
   v
Email Job
   |
   v
Nodemailer
```

---

# 29. Email Service

Create a reusable email service.

It should support:

```text
sendWeeklyReport()
sendBusinessAlert()
sendRecommendationNotification()
```

Email templates should be separated from business logic.

Do not put email HTML directly inside controllers.

---

# 30. Notification Center

Inside the UI create:

```text
Notifications
```

Example:

```text
🔴 Revenue decreased 14%

🟡 Inventory risk detected

🟢 Weekly report generated

💡 Product C has unusual growth
```

Allow:

```text
Mark as read
View
Dismiss
```

---

# 31. Audit Logging

Record important actions.

Example:

```text
User uploaded sales.xlsx

User connected PostgreSQL database

AI investigation executed

Report generated

Alert created

Email notification sent

User changed alert configuration
```

Audit log fields:

```text
userId
organizationId
workspaceId
action
resourceType
resourceId
timestamp
metadata
```

Never store sensitive credentials in audit logs.

---

# 32. Data Import History

Show:

```text
Import History

sales.xlsx
125,432 rows
Successful
10:42 AM

inventory.xlsx
22,341 rows
Successful
Yesterday

customers.csv
18,293 rows
Completed with warnings
Monday
```

Each import should have:

```text
source
filename
row count
status
startedAt
completedAt
error information
schema version
```

---

# 33. Data Versioning

Do not silently overwrite important data.

Track imports and versions.

Support concepts such as:

```text
Append
Replace
Upsert
```

The exact implementation can be decided during development.

The system should preserve enough metadata to understand how the current dataset was produced.

---

# 34. Dashboard/Data Relationship

The most important architectural rule:

> The dashboard belongs to the workspace, not the file.

Example:

```text
Workspace
   |
   +--- Sales.xlsx
   |      |
   |      +--- Sales
   |
   +--- Customers.xlsx
   |      |
   |      +--- Customers
   |
   +--- PostgreSQL
          |
          +--- Inventory
          +--- Products
```

The dashboard can query multiple datasets.

---

# 35. Dataset Relationships

Support relationships such as:

```text
Sales.customer_id
        |
        v
Customers.customer_id
```

and:

```text
Sales.product_id
        |
        v
Products.product_id
```

Relationships can be detected using:

* column names
* data types
* uniqueness
* sample values
* user confirmation

Never assume a relationship is valid without validation.

---

# 36. API Architecture

Use a modular Express architecture.

Example:

```text
backend/
  src/
    modules/
      auth/
      organizations/
      workspaces/
      datasets/
      data-sources/
      imports/
      analytics/
      ai/
      investigations/
      simulations/
      recommendations/
      alerts/
      reports/
      notifications/
      billing/
      audit/
    middleware/
    services/
    workers/
    queues/
    lib/
    config/
```

Avoid a giant `server.ts` or giant controller.

Use:

```text
Routes
  ↓
Controllers
  ↓
Services
  ↓
Repositories / Prisma
```

Keep domain logic inside services.

---

# 37. Suggested Prisma Models

Design the schema around concepts such as:

```text
User
Organization
Workspace

DataSource
Dataset
DatasetColumn
DatasetRelationship
ImportJob
ImportFile

Dashboard
DashboardWidget

Conversation
Message
AgentRun
ToolCall

Investigation
InvestigationFinding

Simulation
SimulationScenario
SimulationResult

Recommendation
Alert
AlertRule

Report
ReportSchedule
Notification

AuditLog

Subscription
Plan
UsageRecord
```

Do not blindly copy these models.

Analyze relationships and normalize the schema appropriately before implementation.

Use UUIDs or another appropriate non-sequential identifier strategy for public resource IDs.

Add:

* createdAt
* updatedAt

where appropriate.

Use indexes for frequently queried tenant/workspace fields.

---

# 38. Subscription-Ready Architecture

Design the system so subscription plans can control feature access.

Example:

### Free

* limited datasets
* basic dashboard
* limited AI questions

### Pro

* AI investigations
* simulations
* anomaly detection
* reports
* alerts

### Business

* multiple users
* advanced database connectors
* scheduled reports
* advanced permissions
* higher usage limits

Do not rely only on frontend checks.

Enforce entitlements in the backend.

Example:

```text
Request
   |
   v
Authentication
   |
   v
Authorization
   |
   v
Subscription entitlement
   |
   v
Usage limit
   |
   v
Feature
```

---

# 39. AI Reliability Rules

These rules are mandatory.

## Rule 1

Never invent business data.

## Rule 2

Never claim a calculation without performing the calculation.

## Rule 3

Show evidence for important findings.

## Rule 4

Clearly distinguish:

```text
Observed fact
Calculated metric
Inference
Recommendation
Projection
```

## Rule 5

Simulation results must show assumptions.

## Rule 6

If data is insufficient, tell the user.

## Rule 7

Do not claim causation from correlation alone.

## Rule 8

AI should use tools for business-specific questions.

---

# 40. AI Agent Observability

Every important agent execution should record:

```text
agentRunId
conversationId
model
startTime
endTime
latency
tool calls
errors
token usage if available
final status
```

This will make debugging much easier.

---

# 41. AI Evaluation

Create an architecture that allows evaluation of the AI later.

Store test cases such as:

```text
Question:
Why did revenue decrease?

Expected behavior:
Compare current period with previous period,
identify major contributing dimensions,
and provide evidence.
```

Evaluate:

* tool selection
* SQL validity
* answer correctness
* evidence usage
* hallucination
* latency
* failure rate

This does not need to be a polished customer-facing page in V1, but the architecture should make it possible.

---

# 42. Error Handling

Every API should return consistent errors.

Example:

```json
{
  "success": false,
  "error": {
    "code": "DATA_SOURCE_CONNECTION_FAILED",
    "message": "Unable to connect to the database."
  }
}
```

Do not expose internal stack traces to users.

Log detailed errors server-side.

---

# 43. Security Requirements

Implement:

* authentication
* authorization
* tenant isolation
* input validation
* Zod validation
* rate limiting
* secure cookies/tokens
* CORS configuration
* SQL safety
* read-only external DB access
* secret management
* no credentials in frontend
* no sensitive information in logs
* file validation
* file-size limits
* API authorization
* background-job authorization/context

Uploaded files should be validated before processing.

---

# 44. Performance Requirements

Do not load entire large datasets into application memory unnecessarily.

Use:

* pagination
* streaming where appropriate
* database aggregation
* background jobs
* caching where useful
* indexes
* query limits
* asynchronous processing

Large imports must not block the main API.

AI queries should use efficient aggregation rather than retrieving massive datasets.

---

# 45. UI/UX

The UI should look like a modern professional B2B SaaS.

Use:

* clean dashboard
* responsive design
* dark/light mode
* shadcn/ui
* consistent spacing
* useful empty states
* skeleton loading
* clear error states
* confirmation dialogs
* accessible forms
* keyboard-friendly interactions

Do not make the interface look like a generic AI chatbot.

The AI experience should be integrated into the business product.

---

# 46. Main Navigation

Suggested structure:

```text
Overview

Dashboard

AI Analyst
Investigations
Business Simulator
Recommendations

Reports

Alerts
Notifications

Data Hub
  ├── Datasets
  ├── Data Sources
  ├── Data Quality
  └── Import History

Audit Logs

Settings
Billing
```

`Team` is intentionally omitted in the initial single-account model. It can be
reintroduced when multi-user roles and memberships are added.

---

# 47. Important UI Principle

Different tasks should have different interfaces.

Use:

### AI Analyst

Conversational interface.

### Investigation

Structured investigation report.

### Business Simulator

Form + calculations + scenario visualization.

### Recommendations

Action-oriented cards.

### Dashboard

Charts and KPIs.

### Reports

Document/report interface.

Do not put everything inside one chat window.

---

# 48. Example User Journey

A new user should be able to perform this complete workflow:

```text
Register
   |
Create Organization
   |
Create Workspace
   |
Upload Excel
   |
System analyzes file
   |
User confirms column mapping
   |
Data processing starts
   |
Background worker processes data
   |
Dashboard becomes available
   |
User views revenue
   |
User asks AI:
"Why did revenue decrease?"
   |
AI investigates data
   |
AI provides evidence
   |
Recommendation created
   |
Manager receives email
   |
User opens Investigation
   |
User opens Business Simulator
   |
Tests:
"What if Product A price increases 10%?"
   |
Simulation results shown
   |
User saves scenario
   |
Weekly report generated
   |
Manager receives report by email
```

---

# 49. Example AI Interaction

User:

> Why did revenue decrease last month?

The system should NOT simply answer:

> Revenue decreased because customers bought less.

Instead:

```text
Analyzing...

1. Comparing revenue periods
2. Checking product performance
3. Checking regional performance
4. Checking customer segments
5. Checking inventory
```

Then:

```text
Revenue decreased 12.4%.

The largest observed contributors were:

Product Category A
-$18,400

Region X
-$11,200

Returning Customers
-$7,300

Inventory availability for Category A
also declined during the same period.

This indicates inventory availability may be
a contributing factor, but the available data
does not establish causation.
```

Provide:

```text
[View Evidence]
[Open Investigation]
[Create Recommendation]
```

---

# 50. Example Simulator Interaction

User:

> What happens if I increase Product A's price by 10%?

The simulator should:

1. Identify Product A.
2. Retrieve historical pricing/sales data.
3. Determine whether sufficient historical data exists.
4. Select an appropriate calculation/model.
5. Apply the scenario.
6. Produce projected values.
7. Display assumptions.
8. Display uncertainty/limitations.
9. Explain the result.

Never let the LLM simply make up:

> "Revenue will increase by 15%."

The numerical engine must produce the projection.

---

# 51. Background Jobs

Define queue types such as:

```text
IMPORT_DATA
PROCESS_DATASET
SYNC_DATABASE
DETECT_ANOMALIES
GENERATE_REPORT
SEND_EMAIL
RUN_SCHEDULED_ANALYSIS
```

Each job should have:

```text
jobId
workspaceId
type
status
attempts
createdAt
startedAt
completedAt
error
```

Implement retry behavior carefully.

Jobs must be idempotent where practical.

---

# 52. Logging

Use structured server-side logging.

Include:

```text
requestId
userId
organizationId
workspaceId
operation
duration
status
error
```

Never log:

* database passwords
* API keys
* session secrets
* sensitive customer data unnecessarily

---

# 53. Testing Strategy

The project must not rely only on manual testing.

Create:

## Unit tests

For:

* metric calculations
* simulation calculations
* validation
* entitlement checks
* anomaly detection
* data mapping

## Integration tests

For:

* authentication
* database operations
* imports
* AI tool execution
* report generation
* email queue

## End-to-end tests

For the main workflow:

```text
Register
→ Create workspace
→ Upload dataset
→ Process data
→ Dashboard
→ AI analysis
→ Investigation
→ Simulation
→ Recommendation
→ Report
```

---

# 54. Development Method

Do NOT generate the entire application in one huge implementation step.

Work incrementally.

First create:

```text
Architecture
Database schema
Folder structure
Environment configuration
Authentication
Organizations/workspaces
```

Then:

```text
Data sources
File ingestion
Datasets
Dashboard
```

Then:

```text
AI Analyst
Investigation
Simulator
```

Then:

```text
Recommendations
Alerts
Reports
Email
```

Then:

```text
Testing
Security
Observability
Performance
Deployment
```

After each phase:

1. Run the application.
2. Run tests.
3. Check TypeScript.
4. Check linting.
5. Check database migrations.
6. Fix errors.
7. Verify the feature manually.
8. Only then move to the next phase.

---

# 55. Environment Variables

Create a `.env.example`.

Potential variables:

```text
DATABASE_URL=

REDIS_URL=

GROQ_API_KEY=

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=

EMAIL_HOST=
EMAIL_PORT=
EMAIL_USER=
EMAIL_PASSWORD=
EMAIL_FROM=

APP_URL=
API_URL=
```

Never commit `.env`.

Never hard-code credentials.

---

# 56. Project Quality Requirements

The final application must demonstrate:

### Frontend engineering

* reusable components
* typed API clients
* proper loading/error states
* responsive UI
* accessible components
* clean state management

### Backend engineering

* modular architecture
* validation
* authorization
* tenant isolation
* services
* database transactions
* error handling
* background jobs

### Database engineering

* normalized schema
* indexes
* constraints
* relationships
* migrations
* efficient queries

### AI engineering

* tool-using agents
* structured outputs
* controlled SQL
* deterministic calculations
* evidence-based answers
* agent tracing
* evaluation-ready architecture

### Data engineering

* ingestion
* schema detection
* normalization
* data quality
* imports
* versioning

### SaaS engineering

* organizations
* workspaces
* RBAC
* subscriptions
* usage limits
* audit logs

---

# 57. Definition of Done

The project is not complete when the pages exist.

A feature is complete only when:

```text
UI
+
API
+
Database
+
Validation
+
Authorization
+
Error handling
+
Loading state
+
Tests
+
Logging
+
Security
```

are implemented appropriately.

---

# 58. Most Important Implementation Principle

Always ask:

> "Would this still work if 100 different businesses used it?"

Avoid writing business logic specifically for one sample Excel file.

The architecture should support:

```text
Business A
    |
    +-- Excel

Business B
    |
    +-- PostgreSQL

Business C
    |
    +-- CSV
    +-- Excel
    +-- PostgreSQL
```

while all three use the same:

```text
Dashboard
AI Analyst
Investigations
Simulator
Recommendations
Reports
Alerts
```

---

# 59. Portfolio Objective

The final project should allow the developer to explain in an interview:

> "I built a multi-tenant business decision platform using Next.js, Express, PostgreSQL and Prisma. Businesses can upload operational data or connect read-only databases. I built a data ingestion and normalization layer that feeds a workspace-level analytics system. On top of that I implemented tool-using AI agents for business analysis and root-cause investigation, a deterministic business simulation engine, automated anomaly detection, recommendation workflows, scheduled reports, email alerts, RBAC, audit logging, background processing with Redis, and AI observability."

The project should demonstrate engineering depth rather than simply the number of UI features.

---

# 60. First Development Milestone

Before writing large amounts of application code, produce the following design documents:

1. System architecture
2. Database ERD
3. Prisma schema proposal
4. Backend folder structure
5. Frontend folder structure
6. Data ingestion architecture
7. AI agent/tool architecture
8. Business simulator architecture
9. Queue/background-job architecture
10. Authentication and authorization design
11. API endpoint specification
12. Security model
13. Testing strategy
14. Development roadmap

Do not start implementing all features immediately.

First review the architecture for consistency and identify potential problems.

After the architecture is approved, implement the application phase by phase.

---

# 61. Final Product Principle

GrowMetrics should answer four fundamental business questions:

```text
WHAT is happening?
        ↓
Dashboard / Analytics

WHY is it happening?
        ↓
AI Analyst / Investigation

WHAT could happen if we change something?
        ↓
Business Simulator

WHAT should we pay attention to or do next?
        ↓
Recommendations / Alerts / Reports
```

This four-part structure should remain the central product experience.
