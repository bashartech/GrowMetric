---
name: ui-ux-engineering
description: "UI/UX engineering best practices for building production-quality frontend components with Tailwind CSS and Shadcn/UI. Use this skill EVERY TIME you build any React component, page, layout, dashboard, form, modal, table, sidebar, card, or any visual interface — even if the user doesn't explicitly mention UI/UX. This skill ensures Claude never ships components with missing states, poor accessibility, broken responsive layouts, or amateur UX patterns. Trigger on: any frontend component creation, any page layout, any form building, any dashboard, any interactive widget, any landing page, any data display, or when the user says 'build', 'create', 'make', or 'design' followed by any UI element. Also trigger when fixing, improving, or reviewing existing components. This skill assumes Tailwind CSS and Shadcn/UI as the styling stack."
---

# UI/UX Engineering Skill — Tailwind CSS + Shadcn/UI

## Purpose

This skill ensures every component Claude builds feels production-grade — not like a tutorial project. The styling stack is Tailwind CSS for utility classes and Shadcn/UI for pre-built, accessible components. Every example and pattern in this skill uses these tools exclusively.

## Shadcn/UI First Rule

Before building ANY component from scratch, check if Shadcn/UI already provides it. Never reinvent what Shadcn gives you for free:

```
Need a button?       → import { Button } from "@/components/ui/button"
Need a dialog?       → import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
Need a dropdown?     → import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
Need a form input?   → import { Input } from "@/components/ui/input"
Need a select?       → import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
Need a table?        → import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
Need tabs?           → import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
Need a toast?        → import { useToast } from "@/hooks/use-toast" OR sonner
Need a card?         → import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
Need a badge?        → import { Badge } from "@/components/ui/badge"
Need a skeleton?     → import { Skeleton } from "@/components/ui/skeleton"
Need a sheet?        → import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
Need a tooltip?      → import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
Need a separator?    → import { Separator } from "@/components/ui/separator"
Need an avatar?      → import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
Need a checkbox?     → import { Checkbox } from "@/components/ui/checkbox"
Need a switch?       → import { Switch } from "@/components/ui/switch"
Need a slider?       → import { Slider } from "@/components/ui/slider"
Need a textarea?     → import { Textarea } from "@/components/ui/textarea"
Need a label?        → import { Label } from "@/components/ui/label"
Need breadcrumbs?    → import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
Need a progress bar? → import { Progress } from "@/components/ui/progress"
Need an alert?       → import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
Need a popover?      → import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
Need a command menu? → import { Command, CommandInput, CommandList, CommandItem } from "@/components/ui/command"
Need a data table?   → Use @tanstack/react-table + Shadcn Table components
Need a date picker?  → Use Shadcn's date-picker pattern (Popover + Calendar)
Need a combobox?     → Use Shadcn's combobox pattern (Popover + Command)
```

Only build custom components for things Shadcn doesn't cover (e.g., video players, drag-and-drop builders, custom charts).

---

## Before Writing Any Component Code

Stop and answer these 6 questions:

### 1. What are ALL the states this component can be in?

Every component has more states than you think. Map them all:

- **Empty state** — No data yet. Never show a blank screen. Show a Lucide icon (from `lucide-react`), a helpful message, and a `<Button>` CTA.
- **Loading state** — Data is being fetched. Use Shadcn `<Skeleton>` components that match the layout shape. NEVER use a centered spinner. Skeletons feel faster and prevent layout shift.
- **Loaded state** — The happy path. This is the easy part.
- **Error state** — API failed. Use Shadcn `<Alert variant="destructive">` with `<AlertTitle>` and `<AlertDescription>` + a retry `<Button>`. Never show raw error messages.
- **Partial state** — Some data loaded, some failed. Don't blow up the whole page for one failed widget.
- **Overflow state** — What happens with 1000 items? 1 item? Text that's 3 lines long? A username that's 50 characters? Always test extremes with `line-clamp-N` and `truncate`.
- **Disabled state** — Wrap disabled buttons in `<TooltipProvider><Tooltip>` to explain why.
- **Interactive states** — Hover, focus, active, selected. Tailwind handles these with `hover:`, `focus-visible:`, `active:`, and `data-[state=active]:` prefixes.

### 2. What happens on every screen size?

Build mobile-first. Apply base styles for mobile, then enhance upward:

```
Default (no prefix): Mobile (320px+)     → Single column, stacked, full-width
sm: (640px+):        Large phone/tablet  → Minor adjustments
md: (768px+):        Tablet              → 2-column grids, sidebars appear
lg: (1024px+):       Laptop              → Full layout, sidebar expanded
xl: (1280px+):       Desktop             → Max-width container kicks in
```

Key responsive patterns with Shadcn:
- Sidebar: `<Sheet>` on mobile → fixed sidebar on `lg:`
- Grids: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`
- Tables: card layout on mobile → `<Table>` on `md:`
- Modals: `<Sheet side="bottom">` on mobile → `<Dialog>` on `md:`
- Touch targets: minimum `h-11 w-11` (44px) on mobile buttons

### 3. What user actions need feedback?

Every action must produce visible feedback within 100ms:

- **Button clicks** — Use `<Button disabled={isPending}>` with loading content: `{isPending ? (<><Loader2 className="h-4 w-4 animate-spin" /> Saving...</>) : "Save Changes"}`.
- **Form submissions** — Button loading state → `toast({ title: "Success", description: "Course saved" })` or `toast({ variant: "destructive", title: "Error", description: "..." })`.
- **Destructive actions** — Always use `<AlertDialog>` with clear language. Use `<Button variant="destructive">` for confirm.
- **Navigation** — Use `usePathname()` to highlight active `<SidebarMenuButton>`. Show loading bar for page transitions.
- **Async mutations** — Optimistic UI where possible. Otherwise `<Loader2 className="h-4 w-4 animate-spin" />` near the affected area.

### 4. Is this accessible?

Shadcn/UI handles most accessibility via Radix UI primitives. But you still must:

- **Never skip `<Label>`** — Every `<Input>`, `<Textarea>`, `<Select>` needs `<Label htmlFor={id}>`. Placeholder is NOT a label.
- **Visible focus rings** — Shadcn provides `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`. NEVER override with `outline-none` alone.
- **Color contrast** — Use Shadcn CSS variables: `text-foreground`, `text-muted-foreground`, `text-destructive`. They handle light/dark contrast.
- **Don't convey meaning by color alone** — Pair colors with Lucide icons. Example: `<Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Failed</Badge>`.
- **ARIA on custom components** — Add `aria-label`, `aria-live="polite"` for dynamic content. Shadcn handles ARIA on its own components.

### 5. What are the edge cases?

- **Empty text** — Validate with Zod + react-hook-form. Show error via Shadcn `<FormMessage>`.
- **Very long text** — `truncate` (single line) or `line-clamp-2` / `line-clamp-3` (multi-line).
- **Double-click** — `<Button disabled={isPending}>` during async operations.
- **Fast network** — Skeletons flash too briefly. Consider a 300ms minimum delay before showing loaded content.
- **Browser back** — Persist URL state via `useSearchParams` for search, filters, pagination, and active tabs.
- **Slow connections** — Skeleton screens keep layout stable. All interactions still work.

### 6. Does this feel polished?

Micro-details with Tailwind + Shadcn:

- **Transitions** — `transition-all duration-200` on every interactive element. Cards: `transition-all duration-200 hover:shadow-md hover:-translate-y-0.5`. Buttons: Shadcn handles this by default.
- **Consistent spacing** — Tailwind scale only: `gap-1.5`, `gap-2`, `gap-3`, `gap-4`, `gap-6`, `gap-8`. NEVER `gap-[13px]` or arbitrary values.
- **Consistent radius** — `rounded-lg` for Card/containers, `rounded-md` for Button/Input (Shadcn default), `rounded-full` for Avatar/Badge.
- **Icon sizing** — Lucide icons: `h-4 w-4` with body text, `h-5 w-5` with headings, `h-3.5 w-3.5` in Badge. Always `flex items-center gap-2` for icon + text.
- **Page structure** — Every page:
  ```jsx
  <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-bold tracking-tight">Page Title</h1>
      <Button>Action</Button>
    </div>
    {/* Page content */}
  </div>
  ```
- **Dark mode** — ONLY use Shadcn CSS variables: `bg-background`, `text-foreground`, `bg-card`, `bg-muted`, `text-muted-foreground`, `border`, `bg-primary`, `text-primary-foreground`, `bg-destructive`. NEVER hardcode `bg-white`, `text-black`, `bg-gray-100`, `text-gray-900`. If you type `white`, `black`, or a raw gray value, you're breaking dark mode.

---

## Component-Level Patterns

Read `references/component-patterns.md` for detailed Tailwind + Shadcn patterns for:

- Buttons (loading states with Loader2, variants, icon placement)
- Forms (react-hook-form + Zod + Shadcn Form components)
- Tables (@tanstack/react-table + Shadcn Table, sort, filter, paginate)
- Dialogs and AlertDialogs (confirmation, forms, mobile Sheet fallback)
- Cards (hover, Skeleton, overflow, responsive grids)
- Sidebar Navigation (Shadcn Sheet for mobile, collapsible, active states)
- Toasts (sonner or Shadcn toast, positioning, when to use)
- Dashboards (stat cards with Card, Recharts containers, responsive grid)
- Search (Command component, debounce, empty results)
- Combobox and Select (Popover + Command, multi-select, async)
- File Upload (drag-and-drop, Progress component, preview)
- Pagination (Button-based, URL-persisted)
- Tabs (Shadcn Tabs, URL hash sync, responsive scroll)
- Empty States (Lucide icon + text + Button pattern)
- Loading Patterns (Skeleton, Loader2, Progress)

---

## Pre-Build Checklist

```
□ Checked if Shadcn/UI has a component for this (use it if yes)
□ Listed all component states (empty, loading, error, loaded, overflow)
□ Defined responsive behavior (mobile-first: default → sm → md → lg → xl)
□ Identified all user actions and their feedback (toast, loading, disable)
□ Using Shadcn CSS variables for ALL colors (no hardcoded colors)
□ Using Tailwind spacing scale (no arbitrary values)
□ Using Lucide React for all icons
```

## Post-Build Checklist

```
□ Every interactive element has hover, focus-visible, and active states
□ Loading uses <Skeleton> components matching content dimensions
□ Empty states use Lucide icon + message + <Button> CTA
□ Error states use <Alert variant="destructive"> with retry <Button>
□ Forms use <Label> + <Input> + <FormMessage> with Zod validation
□ Destructive actions use <AlertDialog> for confirmation
□ <Button disabled={isPending}> with <Loader2 className="animate-spin"> during processing
□ Text uses truncate or line-clamp-N on overflow
□ Tables/lists handle 0, 1, and 100+ items gracefully
□ Mobile layout works at 320px width
□ Touch targets are h-11 (44px) minimum on mobile
□ Focus rings visible (Shadcn defaults not overridden)
□ ALL colors use CSS variables (bg-background, text-foreground, etc.)
□ Transitions on interactive elements (transition-all duration-200)
□ Spacing uses Tailwind scale only (no arbitrary values)
□ Dark mode works (zero hardcoded color values)
□ Toast notifications for async action completion
□ No layout shift during loading (Skeletons match content dimensions)
```

---

## Common Mistakes Claude Makes (Avoid These)

### 1. Building only the happy path
ALWAYS build: `<Skeleton>` while loading, Lucide icon + message when empty, `<Alert variant="destructive">` on error — for every component that fetches data.

### 2. Ignoring mobile
Mobile-first: no prefix (mobile) → `sm:` → `md:` → `lg:`. Use `<Sheet>` instead of `<Dialog>` on mobile. Card layout instead of `<Table>` on mobile.

### 3. Missing feedback on actions
ALWAYS: `<Button disabled={isPending}>` + `<Loader2>` spinner + `toast()` on success/failure.

### 4. Hardcoding colors
Using `bg-white`, `text-black`, `bg-gray-100` breaks dark mode. ALWAYS use `bg-background`, `text-foreground`, `bg-muted`, `text-muted-foreground`, `bg-card`, `border`.

### 5. Not using Shadcn components
Building custom modals/dropdowns/tooltips when Shadcn has `<Dialog>`, `<DropdownMenu>`, `<Tooltip>`. Check the import list above FIRST.

### 6. Reinventing form validation
ALWAYS use `react-hook-form` + `zod` + Shadcn `<Form>`, `<FormField>`, `<FormItem>`, `<FormLabel>`, `<FormControl>`, `<FormMessage>`.

### 7. Spinners instead of Skeletons
Centered `<Loader2>` for page loads. Use `<Skeleton className="h-4 w-[250px]" />` matching content layout.

### 8. No confirmation on destructive actions
ALWAYS use `<AlertDialog>` with specific title, consequence description, `<AlertDialogCancel>`, and `<AlertDialogAction>` with `variant="destructive"` styling.

### 9. Inconsistent spacing
Mixing `p-3`, `p-[13px]`, `p-4` randomly. Page: `px-4 sm:px-6 lg:px-8`. Card: `p-4 sm:p-6`. Sections: `space-y-4 sm:space-y-6`. Stack: `gap-4` or `gap-6`.

### 10. Missing disabled state explanation
Grey button with no context. Wrap in `<TooltipProvider><Tooltip><TooltipTrigger asChild><Button disabled>...</Button></TooltipTrigger><TooltipContent>Complete required fields</TooltipContent></Tooltip></TooltipProvider>`.
