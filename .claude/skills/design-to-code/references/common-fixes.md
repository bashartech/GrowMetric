# Common Design-to-Code Fixes

Before/after examples of the exact mistakes Claude makes when converting designs to code. Each entry shows the wrong code, why it's wrong, and the correct fix.

---

## Table of Contents

1. [Layout Mistakes](#layout-mistakes)
2. [Spacing Mistakes](#spacing-mistakes)
3. [Color & Typography Mistakes](#color--typography-mistakes)
4. [Missing Visual Details](#missing-visual-details)
5. [Component Choice Mistakes](#component-choice-mistakes)
6. [Image & Media Mistakes](#image--media-mistakes)
7. [Responsive Mistakes](#responsive-mistakes)

---

## Layout Mistakes

### 1. Wrong Flex Direction

**Design shows:** Items side by side horizontally (icon, text, badge in a row)
```jsx
// ❌ WRONG — Claude defaults to vertical stacking
<div>
  <UserIcon />
  <span>John Doe</span>
  <Badge>Admin</Badge>
</div>

// ✅ CORRECT — Explicit horizontal flex with vertical centering
<div className="flex items-center gap-2">
  <UserIcon className="h-4 w-4 shrink-0" />
  <span className="text-sm font-medium">John Doe</span>
  <Badge>Admin</Badge>
</div>
```

### 2. Missing justify-between in Header Rows

**Design shows:** Title on the left, button on the right, same row
```jsx
// ❌ WRONG — Both items stack or sit next to each other on the left
<div className="flex items-center gap-2">
  <h1 className="text-2xl font-bold">Courses</h1>
  <Button>Create Course</Button>
</div>

// ✅ CORRECT — Push them to opposite edges
<div className="flex items-center justify-between">
  <h1 className="text-2xl font-bold tracking-tight">Courses</h1>
  <Button><Plus className="h-4 w-4" /> Create Course</Button>
</div>
```

### 3. Wrong Grid Column Count

**Design shows:** 4 cards per row on desktop
```jsx
// ❌ WRONG — Claude guesses grid-cols-3
<div className="grid grid-cols-3 gap-6">

// ✅ CORRECT — Count the cards carefully, add responsive breakpoints
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
```

**How to count:** Look at the screenshot. Count the items in a single row. That's your `lg:grid-cols-N` or `xl:grid-cols-N` value. Then work backwards: tablet gets N/2 (rounded up), mobile gets 1.

### 4. Content Stretching Full Width Instead of Contained

**Design shows:** Content centered with max-width, whitespace on both sides
```jsx
// ❌ WRONG — Content stretches edge to edge
<main className="p-6">
  {children}
</main>

// ✅ CORRECT — Contained with max-width
<main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
  {children}
</main>
```

### 5. Sidebar Not Fixed

**Design shows:** Sidebar stays in place while main content scrolls
```jsx
// ❌ WRONG — Sidebar scrolls with content
<div className="flex">
  <aside className="w-64 border-r">...</aside>
  <main>...</main>
</div>

// ✅ CORRECT — Fixed sidebar, offset main content
<div className="flex min-h-screen">
  <aside className="hidden lg:flex w-64 flex-col border-r bg-card fixed inset-y-0 left-0 z-30">
    ...
  </aside>
  <main className="flex-1 lg:pl-64">
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
      {children}
    </div>
  </main>
</div>
```

### 6. Missing Sticky Header

**Design shows:** Header stays at the top when page scrolls
```jsx
// ❌ WRONG — Header scrolls away
<header className="border-b bg-background px-4 h-14">

// ✅ CORRECT — Sticky with z-index and blur
<header className="sticky top-0 z-50 flex h-14 items-center border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 sm:px-6">
```

---

## Spacing Mistakes

### 7. Inconsistent Spacing

**Design shows:** Even, rhythmic spacing between elements
```jsx
// ❌ WRONG — Random spacing values
<div className="mt-3 mb-5 px-7">
  <h2 className="mb-2">Title</h2>
  <p className="mt-4">Text</p>
  <div className="mt-3">More</div>
</div>

// ✅ CORRECT — Consistent space-y rhythm
<div className="space-y-4 px-6">
  <div className="space-y-1.5">
    <h2 className="text-lg font-semibold">Title</h2>
    <p className="text-sm text-muted-foreground">Text</p>
  </div>
  <div>More</div>
</div>
```

### 8. Using Margin When Gap Is Correct

**Design shows:** Even spacing between row items
```jsx
// ❌ WRONG — Individual margins create inconsistent spacing
<div className="flex items-center">
  <Icon className="mr-2" />
  <span className="mr-3">Text</span>
  <Badge className="ml-auto">Tag</Badge>
</div>

// ✅ CORRECT — Gap for even spacing, ml-auto for push-right
<div className="flex items-center gap-2">
  <Icon className="h-4 w-4 shrink-0" />
  <span className="text-sm">Text</span>
  <Badge className="ml-auto">Tag</Badge>
</div>
```

### 9. Too-Tight or Too-Loose Card Padding

**Design shows:** Comfortable card padding
```jsx
// ❌ WRONG — Too tight
<Card className="p-2">

// ❌ WRONG — Too loose
<Card className="p-10">

// ✅ CORRECT — Shadcn default card padding
<Card>
  <CardHeader>       {/* py-6 px-6 by default */}
    <CardTitle>...</CardTitle>
  </CardHeader>
  <CardContent>      {/* px-6 pb-6 by default */}
    ...
  </CardContent>
</Card>

// Or for compact custom cards:
<Card className="p-4"> or <Card className="p-5">
```

### 10. Missing Gap Between Icon and Text

**Design shows:** Icon and text with small gap between them
```jsx
// ❌ WRONG — Icon and text touching
<Button><Plus />Create</Button>

// ✅ CORRECT — Consistent gap (Shadcn Button handles this, but for custom elements:)
<Button><Plus className="h-4 w-4" /> Create</Button>

// For custom non-button elements:
<div className="flex items-center gap-2">
  <Plus className="h-4 w-4" />
  <span>Create</span>
</div>
```

---

## Color & Typography Mistakes

### 11. Hardcoded Colors Breaking Dark Mode

```jsx
// ❌ WRONG — Hardcoded colors
<div className="bg-white text-gray-900 border-gray-200">
  <h2 className="text-black">Title</h2>
  <p className="text-gray-500">Subtitle</p>
</div>

// ✅ CORRECT — CSS variables
<div className="bg-background text-foreground border">
  <h2 className="text-foreground">Title</h2>
  <p className="text-muted-foreground">Subtitle</p>
</div>
```

**The complete mapping:**
```
bg-white        → bg-background
bg-gray-50      → bg-muted or bg-muted/50
bg-gray-100     → bg-muted
bg-gray-900     → bg-foreground (rare — usually for text)
text-black      → text-foreground
text-gray-900   → text-foreground
text-gray-700   → text-foreground (or text-muted-foreground for slightly lighter)
text-gray-500   → text-muted-foreground
text-gray-400   → text-muted-foreground/60 or text-muted-foreground
border-gray-200 → border (uses border-border variable)
bg-gray-800     → bg-card (in dark mode) or bg-secondary
```

### 12. Wrong Heading Sizes

**Design shows:** Clear heading hierarchy
```jsx
// ❌ WRONG — Claude guesses sizes, often too big or too small
<h1 className="text-4xl font-bold">Page Title</h1>
<h2 className="text-2xl">Section</h2>
<h3 className="text-xl">Card Title</h3>

// ✅ CORRECT — Realistic sizes that match real apps
<h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Page Title</h1>
<h2 className="text-lg sm:text-xl font-semibold">Section</h2>
<h3 className="text-base font-semibold">Card Title</h3>
```

### 13. Missing Muted Text Color

**Design shows:** Primary text + lighter secondary text below it
```jsx
// ❌ WRONG — Both texts same color
<h3 className="font-semibold">React Hooks Course</h3>
<p className="text-sm">Learn React hooks from scratch</p>

// ✅ CORRECT — Secondary text is visually lighter
<h3 className="font-semibold">React Hooks Course</h3>
<p className="text-sm text-muted-foreground">Learn React hooks from scratch</p>
```

### 14. Missing Font Weight Differentiation

**Design shows:** Bold title next to lighter metadata
```jsx
// ❌ WRONG — Everything same weight
<div>
  <span>Course Title</span>
  <span>by John Doe</span>
  <span>4.8 rating</span>
</div>

// ✅ CORRECT — Clear weight hierarchy
<div className="flex items-center gap-2 text-sm">
  <span className="font-semibold">Course Title</span>
  <span className="text-muted-foreground">by John Doe</span>
  <span className="text-muted-foreground">4.8 ★</span>
</div>
```

---

## Missing Visual Details

### 15. Missing Borders

**Design shows:** Subtle borders separating sections
```jsx
// ❌ WRONG — Sections blend together
<div className="space-y-6">
  <section>Section 1</section>
  <section>Section 2</section>
</div>

// ✅ CORRECT — Border or Separator between sections
<div className="space-y-6">
  <section>Section 1</section>
  <Separator />
  <section>Section 2</section>
</div>

// Or using border-b on the first section:
<section className="pb-6 border-b">Section 1</section>
```

### 16. Missing Shadow on Elevated Elements

**Design shows:** Card floating above background
```jsx
// ❌ WRONG — Flat card (no depth)
<Card>

// ✅ CORRECT — Shadow matches the design
<Card className="shadow-sm">    // subtle
<Card className="shadow-md">    // standard
<Card className="shadow-lg">    // prominent
```

### 17. Skipping Decorative Icons

**Design shows:** Icon next to every menu item, stat card, or section heading
```jsx
// ❌ WRONG — Text only, no icons
<nav>
  <a href="/dashboard">Dashboard</a>
  <a href="/courses">Courses</a>
  <a href="/settings">Settings</a>
</nav>

// ✅ CORRECT — Icon + text for every nav item
<nav className="flex flex-col gap-1">
  <Link href="/dashboard" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm">
    <LayoutDashboard className="h-4 w-4" /> Dashboard
  </Link>
  <Link href="/courses" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm">
    <BookOpen className="h-4 w-4" /> Courses
  </Link>
  <Link href="/settings" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm">
    <Settings className="h-4 w-4" /> Settings
  </Link>
</nav>
```

### 18. Missing Badge/Status Indicators

**Design shows:** Status badge next to item titles
```jsx
// ❌ WRONG — Status only as text
<span>Published</span>

// ✅ CORRECT — Proper Badge with visual distinction
<Badge variant="default">Published</Badge>
// or with color coding:
<Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
  Published
</Badge>
```

### 19. Missing Hover States on Interactive Elements

```jsx
// ❌ WRONG — Card with no hover feedback
<Card>
  <CardContent>...</CardContent>
</Card>

// ✅ CORRECT — If card is clickable, add hover
<Card className="cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
  <CardContent>...</CardContent>
</Card>
```

### 20. Missing Background Color Differences Between Sections

**Design shows:** Alternating or different background shades for different sections
```jsx
// ❌ WRONG — Same background everywhere
<section>Stats</section>
<section>Table</section>

// ✅ CORRECT — Background variation as shown in design
<section className="bg-muted/50 rounded-lg p-6">Stats</section>
<section className="bg-background p-6">Table</section>
```

---

## Component Choice Mistakes

### 21. Using Select When DropdownMenu Is Correct (and Vice Versa)

```
<Select>       → Form input. User PICKS a value for a form field. Has a label. Part of a form.
<DropdownMenu> → Action menu. User TRIGGERS an action. "Edit", "Delete", "Export". Not a form value.

Design shows: clicking "⋯" shows Edit/Delete/Share → <DropdownMenu>
Design shows: clicking a field shows category options → <Select>
```

### 22. Using Dialog When Sheet Is Better (Mobile)

```
Desktop wide-form popup       → <Dialog>
Slide-in panel (right side)   → <Sheet side="right">
Mobile bottom panel            → <Sheet side="bottom">
Full-screen mobile overlay     → <Sheet side="bottom" className="h-screen"> or dedicated mobile page
```

### 23. Custom Div When Shadcn Card Exists

```jsx
// ❌ WRONG — Custom container mimicking a card
<div className="rounded-lg border p-6 bg-white shadow">

// ✅ CORRECT — Shadcn Card
<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Subtitle</CardDescription>
  </CardHeader>
  <CardContent>Content</CardContent>
</Card>
```

---

## Image & Media Mistakes

### 24. Wrong Image Sizing / Cropping

```jsx
// ❌ WRONG — Image distorted or wrong size
<img src={url} className="w-full h-full" />

// ✅ CORRECT — Object-cover fills container, crops excess
<img src={url} alt={alt} className="h-full w-full object-cover" />

// For image containers with fixed aspect ratio:
<div className="relative aspect-video overflow-hidden rounded-lg">
  <img src={url} alt={alt} className="h-full w-full object-cover" />
</div>
```

### 25. Missing overflow-hidden on Rounded Image Containers

```jsx
// ❌ WRONG — Image corners poke outside rounded card
<Card className="rounded-lg">
  <img src={url} className="rounded-t-lg" /> {/* might not match exactly */}
</Card>

// ✅ CORRECT — overflow-hidden clips everything inside
<Card className="overflow-hidden">
  <img src={url} alt={alt} className="h-40 w-full object-cover" />
  <CardContent className="p-4">...</CardContent>
</Card>
```

### 26. Icons Shrinking in Flex Container

```jsx
// ❌ WRONG — Icon gets squished when text is long
<div className="flex items-center gap-2">
  <BookOpen className="h-4 w-4" />
  <span>Very Long Course Title That Takes Up All Available Space</span>
</div>

// ✅ CORRECT — shrink-0 prevents icon from collapsing
<div className="flex items-center gap-2">
  <BookOpen className="h-4 w-4 shrink-0" />
  <span className="truncate">Very Long Course Title That Takes Up All Available Space</span>
</div>
```

---

## Responsive Mistakes

### 27. Not Hiding Desktop Elements on Mobile

```jsx
// ❌ WRONG — Desktop sidebar visible on mobile, breaking layout
<aside className="w-64 border-r">

// ✅ CORRECT — Hidden on mobile, visible on desktop
<aside className="hidden lg:flex w-64 flex-col border-r">
```

### 28. Fixed Widths Instead of Responsive

```jsx
// ❌ WRONG — Fixed pixel width breaks on small screens
<div className="w-[800px]">

// ✅ CORRECT — Max-width with full-width fallback
<div className="w-full max-w-3xl">
```

### 29. Not Making Buttons Full-Width on Mobile

```jsx
// ❌ WRONG — Tiny button on mobile hard to tap
<Button>Create Course</Button>

// ✅ CORRECT — Full-width on mobile, auto on desktop
<Button className="w-full sm:w-auto">Create Course</Button>
```

### 30. Table on Mobile Without Alternative

```jsx
// ❌ WRONG — Horizontal scroll table on tiny screen
<Table>...</Table>

// ✅ CORRECT — Card layout on mobile, table on desktop
<div className="hidden md:block">
  <Table>...</Table>
</div>
<div className="grid gap-3 md:hidden">
  {items.map(item => (
    <Card key={item.id} className="p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium">{item.title}</span>
        <Badge>{item.status}</Badge>
      </div>
      <p className="text-sm text-muted-foreground mt-1">{item.subtitle}</p>
    </Card>
  ))}
</div>
```
