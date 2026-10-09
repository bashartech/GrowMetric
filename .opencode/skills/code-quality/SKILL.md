---
name: code-quality
description: >-
  Production-grade code quality enforcement for TypeScript, Next.js, Python, and
  FastAPI. This skill MUST be loaded when ANY .ts, .tsx, .py, .jsx, or .js file
  is being written, edited, reviewed, or created. Also trigger when the user asks
  to "create a component", "build a page", "add a feature", "write a function",
  "create an endpoint", "add a route", "implement a service", "review code",
  "refactor", "clean up", "improve code quality", "fix code", or any task that
  produces code output. This skill prevents the most common Claude failures:
  dumping all code into a single file, using function keyword instead of arrow
  functions, skipping error handling, missing type safety, writing insecure code,
  and creating untestable monolithic functions. Load this skill BEFORE writing
  any code — it governs structure, not just syntax.
---

# Production Code Quality

This skill enforces production-grade code quality across TypeScript/Next.js and Python/FastAPI. It targets the specific ways Claude fails when generating code — not theoretical best practices, but the actual mistakes that ship broken, unmaintainable, or insecure code to production.

**Language-specific rules:** When working on TypeScript/Next.js files, read `references/typescript-quality.md`. When working on Python/FastAPI files, read `references/python-quality.md`. For security patterns across both, read `references/security-checklist.md`.

---

## Rule #1: File Organization (The Single-File Problem)

Claude's worst habit is stuffing interfaces, constants, helper functions, schemas, API calls, sub-components, and the actual logic all into one file. This creates 400+ line monoliths that are untestable, unreusable, and unmaintainable.

### Before Creating ANY File, Ask:

1. **Does this project already have a `types/`, `lib/`, `utils/`, `constants/`, `schemas/`, or `services/` directory?** If yes, use it. Match the existing project structure — never invent a new organization pattern when one exists.

2. **Am I about to put more than one "kind" of code in this file?** Types are one kind. Constants are another. API calls are another. The component/handler is another. Each kind gets its own file.

### TypeScript / Next.js File Map

When building a feature, create these dedicated files:

```
feature/
├── page.tsx (or component.tsx)   ← ONLY the component JSX + hooks
├── types.ts                      ← All interfaces, types, enums
├── constants.ts                  ← Magic values, config objects, labels
├── schemas.ts                    ← Zod validation schemas
├── actions.ts                    ← Server actions (Next.js)
├── services/
│   └── feature-service.ts        ← API calls, data fetching
├── hooks/
│   └── use-feature.ts            ← Custom hooks
├── utils.ts                      ← Helper/transform functions
└── components/
    └── sub-component.tsx          ← Extracted sub-components (>30 lines)
```

**What goes where:**

| Code Type | Dedicated File | Extract When |
|-----------|---------------|--------------|
| Interfaces & types | `types.ts` | Always if >2 types OR any type is used by another file |
| Constants & config | `constants.ts` | Always if >1 constant OR any is reusable |
| Zod schemas | `schemas.ts` | Always — schemas are never inline |
| Server actions | `actions.ts` | Always — `'use server'` in its own file |
| API calls / fetching | `services/feature-service.ts` | Always |
| Custom hooks | `hooks/use-feature.ts` | Always |
| Utility functions | `utils.ts` | If >1 function OR any is reusable |
| Sub-components | `components/sub.tsx` | If >30 lines OR used in multiple places |

### Python / FastAPI File Map

```
feature/
├── router.py                     ← Route handlers ONLY (thin layer)
├── schemas.py                    ← Pydantic request/response models
├── models.py                     ← SQLAlchemy / ORM models
├── service.py                    ← Business logic
├── dependencies.py               ← FastAPI Depends() functions
├── constants.py                  ← Magic values, config
├── exceptions.py                 ← Custom exception classes
└── utils.py                      ← Helper functions
```

**What goes where:**

| Code Type | Dedicated File | Extract When |
|-----------|---------------|--------------|
| Pydantic schemas | `schemas.py` | Always — never inline in router |
| ORM models | `models.py` | Always |
| Business logic | `service.py` | Always — routers call services, not the other way |
| FastAPI dependencies | `dependencies.py` | Always if shared across routes |
| Custom exceptions | `exceptions.py` | If >1 exception class |
| Constants | `constants.py` | Always if >1 constant |
| Utilities | `utils.py` | If reusable |

### The Split Decision

For small, self-contained code (under ~100 lines total, no reusable parts), keeping everything in one file is acceptable. But the moment you have:
- More than 2 type definitions → extract to `types.ts` / `schemas.py`
- More than 1 constant → extract to `constants.ts` / `constants.py`
- Any function used by another file → extract to `utils.ts` / `utils.py`
- Any API call → extract to `services/` or `service.py`
- Any file exceeding 150 lines → split by responsibility

**If in doubt, split.** Merging files is easy. Untangling a 500-line monolith is not.

---

## Rule #2: Arrow Functions (TypeScript)

Use arrow functions for everything in TypeScript. Never use the `function` keyword.

```typescript
// ❌ WRONG — function keyword
function UserTable({ users }: UserTableProps) {
  return <div>...</div>
}

function formatDate(date: Date): string {
  return date.toLocaleDateString()
}

function useUsers() {
  const [users, setUsers] = useState<User[]>([])
  return { users }
}

// ✅ CORRECT — arrow functions
const UserTable = ({ users }: UserTableProps) => {
  return <div>...</div>
}

const formatDate = (date: Date): string => {
  return date.toLocaleDateString()
}

const useUsers = () => {
  const [users, setUsers] = useState<User[]>([])
  return { users }
}
```

This applies to:
- React components (named exports: `export const Component = () => {}`)
- Custom hooks
- Helper/utility functions
- Event handlers
- Service functions
- Callbacks and inline functions

**Exception:** `export default` pages in Next.js App Router may use `export default function Page()` when required by the framework, but prefer named arrow exports when possible.

---

## Rule #3: Pre-Write Checklist

Before writing ANY code, answer these questions:

### 1. What files do I need to create?

Map out the files FIRST. Never start writing code in a single file and "figure out the structure later." Refer to the file maps above. Check what directories already exist in the project.

### 2. What can go wrong?

For every function that does I/O (API call, database query, file read), plan the error path:
- What exception/error can this throw?
- What does the user see when it fails?
- Is there a retry or fallback?

### 3. What types do I need?

Define interfaces and types BEFORE writing the implementation. If you're reaching for `any`, stop and design the type. If you're using inline `{ name: string; email: string }` more than once, extract it to `types.ts`.

### 4. What already exists that I can reuse?

Before writing a new utility function, check if the project already has:
- A similar function in `utils/`, `lib/`, or `helpers/`
- A shared type that covers this use case
- A service/hook that already fetches this data
- A constant file with values you're about to hardcode

---

## Rule #4: Post-Write Checklist

After writing code, verify against these gates:

### TypeScript / Next.js
```
□ No `any` types — every variable, parameter, and return has a specific type
□ No `function` keyword — arrow functions everywhere
□ No inline interfaces used more than once — extracted to types.ts
□ No hardcoded strings/numbers — extracted to constants.ts
□ No API calls in components — extracted to services/ or actions.ts
□ No Zod schemas inline — extracted to schemas.ts
□ No floating promises — every async call has await or proper error handling
□ No useEffect with missing/incorrect dependencies
□ No inline objects/functions in JSX props causing re-renders
□ Server/client boundary is correct ('use client' only where needed)
□ Error states handled — not just the happy path
□ Loading states exist for async operations
□ Each file has a single responsibility
□ Each file is under 200 lines (stretch limit: 300)
```

### Python / FastAPI
```
□ Every function has type hints on parameters AND return type
□ No bare except: — always catch specific exceptions
□ No print() — use logging module
□ No blocking I/O in async def — use await or asyncio.to_thread()
□ No string-formatted SQL — use parameterized queries
□ Pydantic schemas in schemas.py, not in router.py
□ Business logic in service.py, not in router.py
□ Route handlers are thin — validate input, call service, return response
□ Custom exceptions defined and used (not raw HTTPException everywhere)
□ No hardcoded secrets — use environment variables
□ Each file has a single responsibility
□ Each file is under 200 lines (stretch limit: 300)
```

---

## Common Mistakes Claude Makes (And How to Fix Them)

### 1. The Monolith File

**What Claude does:** Puts types, constants, helpers, schemas, API calls, and the component all in one file.

**Fix:** Before writing the first line, list the files you need. Create them all. Then write code into the correct file.

### 2. Using `any` When Types Are Unclear

**What Claude does:**
```typescript
// ❌
const handleResponse = (data: any) => { ... }
const config: any = { ... }
```

**Why it's dangerous:** `any` silently disables type checking for everything it touches. One `any` in a function signature means every caller loses type safety.

**Fix:**
```typescript
// ✅ Define the actual shape
interface ApiResponse {
  users: User[]
  pagination: PaginationMeta
}

const handleResponse = (data: ApiResponse) => { ... }
```

If the type is genuinely unknown at write time, use `unknown` and narrow with type guards.

### 3. Using `function` Instead of Arrow Functions

**What Claude does:**
```typescript
// ❌
function calculateTotal(items: CartItem[]): number { ... }
export default function Dashboard() { ... }
```

**Fix:**
```typescript
// ✅
const calculateTotal = (items: CartItem[]): number => { ... }
const Dashboard = () => { ... }
export default Dashboard
```

### 4. No Error Handling on API Calls

**What Claude does:**
```typescript
// ❌ Assumes the happy path
const users = await fetch("/api/users").then(r => r.json())
```

**Fix:**
```typescript
// ✅ Handle failures
try {
  const res = await fetch("/api/users")
  if (!res.ok) throw new Error(`Failed to fetch users: ${res.status}`)
  const users: User[] = await res.json()
} catch (error) {
  // Handle: show toast, set error state, log, retry
}
```

### 5. Blocking I/O in Async Python

**What Claude does:**
```python
# ❌ Blocks the entire event loop
async def get_report(report_id: str):
    with open(f"reports/{report_id}.pdf", "rb") as f:  # BLOCKS!
        return f.read()
```

**Why it's dangerous:** A single blocking call in an async function freezes ALL concurrent requests in the event loop.

**Fix:**
```python
# ✅ Use asyncio.to_thread for blocking I/O
import asyncio

async def get_report(report_id: str):
    return await asyncio.to_thread(_read_report, report_id)

def _read_report(report_id: str) -> bytes:
    with open(f"reports/{report_id}.pdf", "rb") as f:
        return f.read()
```

### 6. Bare `except:` That Swallows Everything

**What Claude does:**
```python
# ❌ Swallows KeyboardInterrupt, SystemExit, and real bugs
try:
    result = process(data)
except:
    pass
```

**Fix:**
```python
# ✅ Catch specific exceptions
try:
    result = process(data)
except ValidationError as e:
    logger.warning("Invalid data: %s", e)
    raise HTTPException(status_code=422, detail=str(e))
except ExternalServiceError as e:
    logger.error("Service unavailable: %s", e)
    raise HTTPException(status_code=503, detail="Service temporarily unavailable")
```

### 7. Hardcoded Magic Values

**What Claude does:**
```typescript
// ❌ Magic numbers and strings scattered in code
if (user.role === "admin") { ... }
const timeout = 5000
if (items.length > 50) { ... }
```

**Fix:**
```typescript
// ✅ In constants.ts
export const USER_ROLES = {
  ADMIN: "admin",
  USER: "user",
  MODERATOR: "moderator",
} as const

export const API_TIMEOUT_MS = 5000
export const MAX_ITEMS_PER_PAGE = 50
```

### 8. Inline Type Assertions Instead of Type Guards

**What Claude does:**
```typescript
// ❌ Forces the type — no runtime safety
const user = data as User
```

**Fix:**
```typescript
// ✅ Type guard — validates at runtime
const isUser = (data: unknown): data is User => {
  return (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    "email" in data
  )
}

if (isUser(data)) {
  // data is now typed as User, verified at runtime
}
```

### 9. God Functions (100+ Lines)

**What Claude does:** Writes a single function that validates input, fetches data, transforms it, handles errors, and formats output.

**Fix:** Each function does ONE thing. Extract steps into named functions with clear inputs/outputs:

```typescript
// ❌ One function doing everything
const processOrder = async (input: unknown) => {
  // 100+ lines of validation, fetching, transforming, saving...
}

// ✅ Composed from focused functions
const processOrder = async (input: unknown) => {
  const validated = validateOrderInput(input)
  const enriched = await enrichWithPricing(validated)
  const order = await saveOrder(enriched)
  await notifyCustomer(order)
  return formatOrderResponse(order)
}
```

### 10. Missing Return Types

**What Claude does:**
```typescript
// ❌ Return type is inferred (fragile, unclear at call site)
const getUser = async (id: string) => {
  const res = await db.users.findUnique({ where: { id } })
  return res
}
```

**Fix:**
```typescript
// ✅ Explicit return type — documents intent, catches mistakes
const getUser = async (id: string): Promise<User | null> => {
  const res = await db.users.findUnique({ where: { id } })
  return res
}
```

---

## The Line Count Rule

If any single file exceeds 200 lines, something is wrong. Either:
- Multiple responsibilities are mixed → split into dedicated files
- A function is too long → extract sub-functions
- Too many types are inline → move to `types.ts`

Hard ceiling: 300 lines. If a file reaches 300, it MUST be split before proceeding. No exceptions.
