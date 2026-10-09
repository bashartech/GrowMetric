# Shadcn/UI Visual-to-Code Mappings

When you see a visual element in a design screenshot, use this reference to identify the correct Shadcn component and its proper implementation.

---

## Table of Contents

1. [Buttons & Actions](#buttons--actions)
2. [Form Elements](#form-elements)
3. [Data Display](#data-display)
4. [Navigation](#navigation)
5. [Overlays & Popups](#overlays--popups)
6. [Feedback & Status](#feedback--status)
7. [Layout & Structure](#layout--structure)
8. [Common Visual Patterns](#common-visual-patterns)

---

## Buttons & Actions

### What You See → What You Use

```
Solid colored button (primary action)
→ <Button>Label</Button>

Outlined/bordered button
→ <Button variant="outline">Label</Button>

Subtle/ghost button (no background until hover)
→ <Button variant="ghost">Label</Button>

Red/dangerous button
→ <Button variant="destructive">Label</Button>

Text-only link styled as button
→ <Button variant="link">Label</Button>

Small button
→ <Button size="sm">Label</Button>

Icon-only button (no text, just icon)
→ <Button variant="ghost" size="icon"><Icon className="h-4 w-4" /></Button>

Button with icon + text
→ <Button><Icon className="h-4 w-4" /> Label</Button>

Three-dot menu button (⋯)
→ <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
  wrapped in <DropdownMenu>

Button group (multiple buttons in a row)
→ <div className="flex items-center gap-2"> or gap-3
  with primary button last (right-aligned)
```

### Button Sizing Reference

```
size="sm"      → h-8 px-3 text-xs     (compact tables, inline actions)
size="default" → h-9 px-4 text-sm     (standard forms, page actions)
size="lg"      → h-10 px-6 text-base  (hero CTAs, prominent actions)
size="icon"    → h-9 w-9              (icon-only, toolbar buttons)
```

---

## Form Elements

### What You See → What You Use

```
Text input field with label above
→ <div className="space-y-2">
    <Label htmlFor="name">Name</Label>
    <Input id="name" placeholder="Enter name" />
  </div>

  OR with react-hook-form:
  <FormField> + <FormItem> + <FormLabel> + <FormControl> + <Input> + <FormMessage>

Multi-line text area
→ <div className="space-y-2">
    <Label htmlFor="desc">Description</Label>
    <Textarea id="desc" className="min-h-[100px] resize-y" />
  </div>

Dropdown/select with options
→ <Select>
    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
    <SelectContent>
      <SelectItem value="a">Option A</SelectItem>
    </SelectContent>
  </Select>

Searchable dropdown (type to filter)
→ Combobox pattern: <Popover> + <Command>
  <Popover>
    <PopoverTrigger asChild><Button variant="outline">Select...</Button></PopoverTrigger>
    <PopoverContent>
      <Command>
        <CommandInput placeholder="Search..." />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup>
            <CommandItem>Option</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>

Checkbox with text beside it
→ <div className="flex items-center gap-2">
    <Checkbox id="terms" />
    <Label htmlFor="terms" className="text-sm">Accept terms</Label>
  </div>

Toggle switch
→ <div className="flex items-center justify-between">
    <Label htmlFor="notify">Notifications</Label>
    <Switch id="notify" />
  </div>

Date input / date picker
→ Date picker pattern: <Popover> + <Calendar>
  (see Shadcn docs for full implementation)

Slider / range input
→ <Slider defaultValue={[50]} max={100} step={1} />

Radio button group
→ <RadioGroup>
    <div className="flex items-center gap-2">
      <RadioGroupItem value="a" id="a" />
      <Label htmlFor="a">Option A</Label>
    </div>
  </RadioGroup>

Password field with show/hide
→ Custom: <Input type={show ? "text" : "password"} />
  with <Button variant="ghost" size="icon"> toggle using Eye/EyeOff icons

Search input with icon
→ <div className="relative">
    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    <Input className="pl-9" placeholder="Search..." />
  </div>
```

### Form Layout Patterns

```
Single column form (standard)
→ <form className="space-y-4"> or space-y-6

Two-column form fields side by side
→ <div className="grid gap-4 sm:grid-cols-2">

Form with section groupings
→ <div className="space-y-8">
    <div className="space-y-4">
      <h3 className="text-lg font-medium">Section Title</h3>
      <Separator />
      {/* fields */}
    </div>
  </div>

Form footer with cancel + submit
→ <div className="flex justify-end gap-3 pt-4">
    <Button type="button" variant="outline">Cancel</Button>
    <Button type="submit">Save</Button>
  </div>
```

---

## Data Display

### What You See → What You Use

```
Data table with columns and rows
→ <Table> + <TableHeader> + <TableBody> + <TableRow> + <TableHead> + <TableCell>
  For advanced (sort, filter, paginate): @tanstack/react-table + Shadcn Table

Small colored pill with text (status, category)
→ <Badge>Label</Badge>
  Variants: default (primary color), secondary (muted), outline (bordered), destructive (red)

Number with label above or below (stat card)
→ <Card>
    <CardHeader className="pb-2">
      <CardTitle className="text-sm font-medium text-muted-foreground">Revenue</CardTitle>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">$45,231</div>
    </CardContent>
  </Card>

Circular image or initials
→ <Avatar className="h-10 w-10">
    <AvatarImage src={url} alt="Name" />
    <AvatarFallback>JD</AvatarFallback>
  </Avatar>

Progress bar (horizontal fill)
→ <Progress value={75} className="h-2" />

Key-value pair (label: value)
→ <div className="flex justify-between text-sm">
    <span className="text-muted-foreground">Status</span>
    <span className="font-medium">Active</span>
  </div>

Description list
→ <dl className="space-y-3">
    <div className="flex justify-between">
      <dt className="text-sm text-muted-foreground">Name</dt>
      <dd className="text-sm font-medium">John Doe</dd>
    </div>
  </dl>

Star rating (filled/empty stars)
→ Custom with Lucide:
  <div className="flex items-center gap-0.5">
    {[1,2,3,4,5].map(i => (
      <Star key={i} className={cn("h-4 w-4",
        i <= rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"
      )} />
    ))}
  </div>

Timeline / activity feed
→ Custom with vertical line:
  <div className="space-y-4">
    {items.map(item => (
      <div className="flex gap-3">
        <div className="flex flex-col items-center">
          <div className="h-2 w-2 rounded-full bg-primary" />
          <div className="w-px flex-1 bg-border" />
        </div>
        <div>content</div>
      </div>
    ))}
  </div>
```

### Card Variants by Visual Appearance

```
Flat card (border only, no shadow)
→ <Card> (Shadcn default)

Elevated card (visible shadow)
→ <Card className="shadow-md">

Highlighted/selected card (colored border)
→ <Card className="border-primary">

Clickable card (hover effect)
→ <Card className="cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">

Card with colored left border accent
→ <Card className="border-l-4 border-l-blue-500">

Card with colored top strip
→ <Card className="overflow-hidden">
    <div className="h-1 bg-gradient-to-r from-blue-500 to-purple-500" />
    <CardContent className="pt-4">...</CardContent>
  </Card>

Card with header background color
→ <Card>
    <CardHeader className="bg-muted/50 rounded-t-lg">...</CardHeader>
    <CardContent>...</CardContent>
  </Card>
```

---

## Navigation

### What You See → What You Use

```
Top horizontal nav bar
→ <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
    <div className="mx-auto flex h-14 max-w-7xl items-center px-4 sm:px-6 lg:px-8">
      {/* logo + nav links + actions */}
    </div>
  </header>

Horizontal tab bar
→ <Tabs defaultValue="tab1">
    <TabsList>
      <TabsTrigger value="tab1">Tab 1</TabsTrigger>
      <TabsTrigger value="tab2">Tab 2</TabsTrigger>
    </TabsList>
    <TabsContent value="tab1">Content 1</TabsContent>
    <TabsContent value="tab2">Content 2</TabsContent>
  </Tabs>

Vertical sidebar nav
→ <aside className="hidden lg:flex w-64 flex-col border-r"> + <Sheet> for mobile

Breadcrumb trail (Home > Page > Subpage)
→ <Breadcrumb>
    <BreadcrumbList>
      <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
      <BreadcrumbSeparator />
      <BreadcrumbItem><BreadcrumbLink href="/courses">Courses</BreadcrumbLink></BreadcrumbItem>
      <BreadcrumbSeparator />
      <BreadcrumbItem><BreadcrumbPage>React Hooks</BreadcrumbPage></BreadcrumbItem>
    </BreadcrumbList>
  </Breadcrumb>

Pagination (page numbers)
→ Custom with <Button variant="outline" size="icon"> for page numbers
  Active page: <Button size="icon"> (primary variant)

Step indicator (step 1 of 3)
→ Custom: circles connected by lines (see UI/UX skill for pattern)
```

---

## Overlays & Popups

### What You See → What You Use

```
Centered modal/popup
→ <Dialog> + <DialogContent>

Confirmation popup ("Are you sure?")
→ <AlertDialog> + <AlertDialogContent>

Slide-in panel from right
→ <Sheet side="right"> + <SheetContent>

Slide-up panel from bottom (mobile)
→ <Sheet side="bottom"> + <SheetContent>

Small popup near trigger (on click)
→ <Popover> + <PopoverContent>

Small text on hover
→ <Tooltip> + <TooltipContent>

Right-click or three-dot menu
→ <DropdownMenu> + <DropdownMenuContent>

Command palette (⌘K search)
→ <CommandDialog> (Dialog + Command combined)
```

---

## Feedback & Status

### What You See → What You Use

```
Success/info/warning banner (in-page, persistent)
→ <Alert>
    <AlertTitle>Title</AlertTitle>
    <AlertDescription>Message</AlertDescription>
  </Alert>
  Variants: default, destructive

Temporary toast notification (top-right)
→ toast.success("Message") / toast.error("Message") via sonner

Loading skeleton (pulsing placeholder)
→ <Skeleton className="h-4 w-[200px]" />

Spinning loader (inline)
→ <Loader2 className="h-4 w-4 animate-spin" />

Progress bar
→ <Progress value={percentage} />

Empty state (illustration + text)
→ Custom: centered icon + heading + description + optional CTA button

Error state (something went wrong)
→ <Alert variant="destructive"> with retry <Button>
```

---

## Layout & Structure

### What You See → What You Use

```
Horizontal line/divider
→ <Separator /> or <Separator orientation="vertical" />
  OR <div className="border-b" /> for section dividers
  OR <hr className="border-border" />

Scroll area with custom scrollbar
→ <ScrollArea className="h-[300px]"> from Shadcn

Collapsible/accordion section
→ <Collapsible> from Shadcn
  OR <Accordion> for multiple collapsible sections

Resizable panels (drag to resize)
→ <ResizablePanel> from Shadcn (if installed)
```

---

## Common Visual Patterns

### Status Indicator Dot

```jsx
// Small colored dot (online/offline/status)
<span className="relative flex h-2 w-2">
  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
</span>

// Or simple static dot:
<div className="h-2 w-2 rounded-full bg-emerald-500" />
```

### Notification Badge on Icon

```jsx
<div className="relative">
  <Button variant="ghost" size="icon">
    <Bell className="h-5 w-5" />
  </Button>
  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
    3
  </span>
</div>
```

### Avatar Group (Overlapping)

```jsx
<div className="flex -space-x-2">
  {users.map(user => (
    <Avatar key={user.id} className="h-8 w-8 border-2 border-background">
      <AvatarImage src={user.avatar} />
      <AvatarFallback className="text-xs">{user.initials}</AvatarFallback>
    </Avatar>
  ))}
  {remaining > 0 && (
    <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium">
      +{remaining}
    </div>
  )}
</div>
```

### Stat with Trend Indicator

```jsx
<div className="flex items-center gap-1 text-xs">
  {trend > 0 ? (
    <TrendingUp className="h-3 w-3 text-emerald-600" />
  ) : (
    <TrendingDown className="h-3 w-3 text-red-600" />
  )}
  <span className={trend > 0 ? "text-emerald-600" : "text-red-600"}>
    {trend > 0 ? "+" : ""}{trend}%
  </span>
  <span className="text-muted-foreground">vs last month</span>
</div>
```

### Search Input with Icon

```jsx
<div className="relative">
  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
  <Input placeholder="Search..." className="pl-9" />
</div>
```

### "Empty" Profile Placeholder

```jsx
<Avatar className="h-10 w-10">
  <AvatarFallback className="bg-primary/10 text-primary">
    <User className="h-5 w-5" />
  </AvatarFallback>
</Avatar>
```

### Colored Icon Container (icon inside a colored circle/square)

```jsx
// Rounded square with soft color
<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
  <BookOpen className="h-5 w-5" />
</div>

// Circle variant
<div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
  <Zap className="h-5 w-5" />
</div>
```

### Tag/Chip List

```jsx
<div className="flex flex-wrap gap-2">
  {tags.map(tag => (
    <Badge key={tag} variant="secondary" className="gap-1">
      {tag}
      <button onClick={() => removeTag(tag)} className="ml-1 hover:text-foreground">
        <X className="h-3 w-3" />
      </button>
    </Badge>
  ))}
</div>
```

### Two-Line List Item

```jsx
<div className="flex items-center gap-3 py-3">
  <Avatar className="h-9 w-9 shrink-0">
    <AvatarImage src={item.avatar} />
    <AvatarFallback>{item.initials}</AvatarFallback>
  </Avatar>
  <div className="min-w-0 flex-1">
    <p className="text-sm font-medium truncate">{item.name}</p>
    <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
  </div>
  <Badge variant="secondary" className="shrink-0">{item.status}</Badge>
</div>
```

### Price Display

```jsx
// With original price crossed out
<div className="flex items-center gap-2">
  <span className="text-2xl font-bold">$49</span>
  <span className="text-sm text-muted-foreground line-through">$99</span>
  <Badge variant="secondary" className="text-emerald-600">50% OFF</Badge>
</div>
```
