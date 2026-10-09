# TypeScript & Next.js Code Quality Rules

Detailed rules and patterns for production-grade TypeScript and Next.js code. This supplements the main SKILL.md with language-specific depth.

## Type Safety

### Never Use `any`

`any` is a virus — it disables type checking for everything it touches and spreads through inference:

```typescript
// ❌ One `any` infects the entire chain
const processData = (input: any) => {
  const result = transform(input) // result is now `any`
  return result.items.map((i: any) => i.name) // all `any`
}

// ✅ Type everything explicitly
interface DataInput {
  items: Item[]
  metadata: Record<string, string>
}

const processData = (input: DataInput): string[] => {
  return input.items.map((item) => item.name)
}
```

**When you genuinely don't know the type:**
- Use `unknown` + type narrowing (for external data)
- Use generics (for reusable functions)
- Use `Record<string, unknown>` (for dynamic objects)
- Use Zod `.parse()` (for validation + type inference)

### Discriminated Unions for State

```typescript
// ❌ Boolean flags create impossible states
interface RequestState {
  isLoading: boolean
  isError: boolean
  data: User[] | null
  error: Error | null
}
// Can have isLoading: true AND isError: true — makes no sense

// ✅ Discriminated union — only valid states exist
type RequestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: User[] }
  | { status: "error"; error: Error }
```

### Explicit Return Types on Exported Functions

Every exported function and every async function must have an explicit return type:

```typescript
// ❌ Implicit — return type changes silently if implementation changes
export const getUsers = async (filters: UserFilters) => {
  // If someone adds a `return null` branch, the type silently widens
}

// ✅ Explicit — contract is clear, accidental changes cause type errors
export const getUsers = async (filters: UserFilters): Promise<User[]> => {
  // If someone adds `return null`, TypeScript catches it
}
```

### Prefer `interface` for Object Shapes, `type` for Unions/Intersections

```typescript
// ✅ Interface for object shapes — extendable, better error messages
interface User {
  id: string
  name: string
  email: string
}

// ✅ Type for unions, intersections, mapped types
type Status = "active" | "inactive" | "suspended"
type UserWithPosts = User & { posts: Post[] }
type Nullable<T> = T | null
```

### Const Assertions for Constant Objects

```typescript
// ❌ Type is widened to Record<string, string>
const STATUS_MAP = {
  ACTIVE: "active",
  INACTIVE: "inactive",
}
// STATUS_MAP.ACTIVE is `string`, not `"active"`

// ✅ Const assertion — exact literal types
const STATUS_MAP = {
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const
// STATUS_MAP.ACTIVE is `"active"` — full type safety
```

---

## React Patterns

### Arrow Function Components

```typescript
// ✅ Named export with arrow function
export const UserCard = ({ user, onSelect }: UserCardProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{user.name}</CardTitle>
      </CardHeader>
    </Card>
  )
}

// ✅ Default export with arrow function
const DashboardPage = () => {
  return <div>...</div>
}
export default DashboardPage
```

### Custom Hooks — Always Extract

If a component uses more than 2 `useState` calls or any complex logic, extract a hook:

```typescript
// ❌ All state logic crammed in the component
const UserList = () => {
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)

  useEffect(() => {
    // 20 lines of fetch logic...
  }, [search, page])

  // Now the component has 50+ lines of state management before any JSX
}

// ✅ Extract to hooks/use-users.ts
// hooks/use-users.ts
export const useUsers = (search: string, page: number) => {
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const fetchUsers = async () => {
      setIsLoading(true)
      try {
        const data = await userService.getUsers({ search, page })
        setUsers(data)
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to fetch"))
      } finally {
        setIsLoading(false)
      }
    }
    fetchUsers()
  }, [search, page])

  return { users, isLoading, error }
}

// Component is now clean
const UserList = () => {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const { users, isLoading, error } = useUsers(search, page)

  if (isLoading) return <Skeleton />
  if (error) return <ErrorAlert error={error} />
  return <UserTable users={users} />
}
```

### Avoid Re-render Traps

```typescript
// ❌ New object created every render — child re-renders every time
const Parent = () => {
  return <Child style={{ color: "red" }} />
}

// ✅ Stable reference — extract to constant or useMemo
const childStyle = { color: "red" } as const

const Parent = () => {
  return <Child style={childStyle} />
}

// ❌ New function created every render
const Parent = () => {
  return <Child onClick={() => handleClick(id)} />
}

// ✅ useCallback for stable reference
const Parent = () => {
  const handleChildClick = useCallback(() => {
    handleClick(id)
  }, [id])

  return <Child onClick={handleChildClick} />
}
```

### useEffect Rules

```typescript
// ❌ Missing dependency — stale closure
const [count, setCount] = useState(0)
useEffect(() => {
  const interval = setInterval(() => {
    setCount(count + 1) // Always uses initial `count` value
  }, 1000)
  return () => clearInterval(interval)
}, []) // `count` missing from deps

// ✅ Use functional updater — no dependency needed
useEffect(() => {
  const interval = setInterval(() => {
    setCount((prev) => prev + 1)
  }, 1000)
  return () => clearInterval(interval)
}, [])

// ❌ Object/array in deps — infinite re-render loop
const filters = { status: "active", role: "admin" }
useEffect(() => {
  fetchData(filters)
}, [filters]) // New object every render → infinite loop

// ✅ useMemo the object or use individual values
const filters = useMemo(() => ({ status, role }), [status, role])
useEffect(() => {
  fetchData(filters)
}, [filters])
```

---

## Next.js App Router Specifics

### Server vs Client Boundary

```typescript
// ❌ Putting 'use client' at the top of a page — entire tree becomes client
'use client'
const DashboardPage = () => { ... } // Everything under this is client-rendered

// ✅ Keep page as Server Component, push 'use client' to leaf components
// page.tsx (Server Component)
const DashboardPage = async () => {
  const data = await getData() // Server-side data fetching
  return (
    <div>
      <h1>Dashboard</h1>
      <InteractiveChart data={data} /> {/* Only this is client */}
    </div>
  )
}

// components/interactive-chart.tsx
'use client'
const InteractiveChart = ({ data }: ChartProps) => {
  const [selected, setSelected] = useState(null)
  // Interactive logic here
}
```

### Server Actions in Dedicated Files

```typescript
// ❌ Server action mixed into the component file
'use server'
export const createUser = async (formData: FormData) => { ... }

// ✅ actions.ts — dedicated file for server actions
// actions.ts
'use server'

import { revalidatePath } from "next/cache"
import { userService } from "@/services/user-service"
import { createUserSchema } from "@/schemas"

export const createUser = async (formData: FormData) => {
  const validated = createUserSchema.parse(Object.fromEntries(formData))
  await userService.create(validated)
  revalidatePath("/users")
}
```

---

## Error Handling Patterns

### API Call Wrapper

Create a reusable fetch wrapper instead of try/catch in every component:

```typescript
// lib/api.ts
interface ApiResponse<T> {
  data: T | null
  error: string | null
}

export const api = {
  get: async <T>(url: string): Promise<ApiResponse<T>> => {
    try {
      const res = await fetch(url)
      if (!res.ok) {
        return { data: null, error: `Request failed: ${res.status}` }
      }
      const data: T = await res.json()
      return { data, error: null }
    } catch (err) {
      return { data: null, error: err instanceof Error ? err.message : "Unknown error" }
    }
  },
}
```

### Result Type Pattern

```typescript
// types.ts
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E }

// services/user-service.ts
export const getUser = async (id: string): Promise<Result<User>> => {
  try {
    const user = await db.users.findUnique({ where: { id } })
    if (!user) return { ok: false, error: new Error("User not found") }
    return { ok: true, value: user }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error("Unknown error") }
  }
}

// Usage — forces caller to handle both cases
const result = await getUser(id)
if (!result.ok) {
  toast.error(result.error.message)
  return
}
// result.value is typed as User here
```

---

## Import Organization

Keep imports organized in this order, separated by blank lines:

```typescript
// 1. React/Next.js framework imports
import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"

// 2. Third-party libraries
import { z } from "zod"
import { toast } from "sonner"

// 3. Internal absolute imports (@/ aliases)
import { Button } from "@/components/ui/button"
import { useUsers } from "@/hooks/use-users"

// 4. Relative imports (same feature)
import { UserCard } from "./components/user-card"
import { USER_ROLES } from "./constants"
import type { User, UserFilters } from "./types"
```

### Type-Only Imports

Use `import type` for types that don't exist at runtime:

```typescript
// ✅ Explicit — bundler can tree-shake this entirely
import type { User, UserFilters } from "./types"
import type { NextRequest } from "next/server"
```

---

## File Templates

### Component File (feature/page.tsx)

```typescript
import { Suspense } from "react"

import { UserTable } from "./components/user-table"
import { UserTableSkeleton } from "./components/user-table-skeleton"
import { getUsers } from "./services/user-service"
import type { SearchParams } from "./types"

interface PageProps {
  searchParams: Promise<SearchParams>
}

const UsersPage = async ({ searchParams }: PageProps) => {
  const params = await searchParams

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Users</h1>
      <Suspense fallback={<UserTableSkeleton />}>
        <UserTableData params={params} />
      </Suspense>
    </div>
  )
}

const UserTableData = async ({ params }: { params: SearchParams }) => {
  const users = await getUsers(params)
  return <UserTable users={users} />
}

export default UsersPage
```

### Types File (feature/types.ts)

```typescript
export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  createdAt: string
}

export type UserRole = "admin" | "user" | "moderator"

export interface SearchParams {
  query?: string
  page?: string
  sort?: string
}

export interface UserTableProps {
  users: User[]
}
```

### Constants File (feature/constants.ts)

```typescript
export const USER_ROLES = {
  ADMIN: "admin",
  USER: "user",
  MODERATOR: "moderator",
} as const

export const DEFAULT_PAGE_SIZE = 10

export const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  user: "User",
  moderator: "Moderator",
}
```
