---
name: design-to-code
description: "Converts design screenshots, Figma exports, and UI mockups into pixel-accurate React + Tailwind CSS + Shadcn/UI code. Use this skill EVERY TIME the user provides a screenshot, image, mockup, design, Figma frame, or any visual reference and asks to convert it to code, recreate it, build it, replicate it, or implement it. Also trigger when the user says 'make this', 'code this', 'convert this', 'build this design', 'implement this UI', or 'recreate this page' while providing an image. This skill forces a systematic, layer-by-layer analysis of the design before writing any code — preventing Claude from guessing, interpreting, or skipping visual details. If a screenshot is attached and the user wants code, USE THIS SKILL."
---

# Design-to-Code Skill — Pixel-Accurate Conversion

## The Core Problem This Skill Solves

Claude's default behavior when given a screenshot is to glance at it, form a rough mental model, and start coding immediately — skipping details, guessing colors, approximating spacing, and missing decorative elements entirely. The result is code that captures maybe 30% of the original design.

This skill forces a **mandatory analysis phase** before any code is written. Claude must deconstruct the design layer by layer, document what it sees, and THEN code — referencing its own analysis throughout.

## THE GOLDEN RULE

**If you can see it in the screenshot, it must exist in the code.** Every border, shadow, gradient, icon, divider, badge, rounded corner, background color, and pixel of spacing. If you skip it, the output is wrong. There is no "close enough."

---

## Step 1: STOP — Do Not Write Code Yet

When the user provides a design screenshot, your FIRST response must be analysis, not code. Resist the urge to start coding. Instead, perform the 7-Layer Scan below.

If the user explicitly says "just code it" or "skip the analysis," you may abbreviate — but still perform the scan internally before writing any code.

---

## Step 2: The 7-Layer Scan

Go through the screenshot systematically, layer by layer. Document your findings for each layer. This is your blueprint — you'll reference it while coding.

### Layer 1: Page Structure & Layout Skeleton

Look at the BIG picture first. Ignore details. Only see the skeleton.

Ask yourself:
- Is this a full page or an isolated component?
- What is the overall layout? (sidebar + main? header + content + footer? single column? split screen?)
- How many major sections/regions exist on the page?
- What is the max-width of the content area? (Does it stretch full-width or is it contained/centered?)
- Is there a fixed header, sidebar, or footer?

Draw the layout mentally as nested boxes:
```
┌─────────────────────────────┐
│ Header (full-width, fixed)  │
├──────┬──────────────────────┤
│ Side │ Main Content          │
│ bar  │  ┌──────────────┐    │
│      │  │ Section 1    │    │
│      │  ├──────────────┤    │
│      │  │ Section 2    │    │
│      │  └──────────────┘    │
└──────┴──────────────────────┘
```

Map this to Tailwind:
- Full page with sidebar: `flex min-h-screen` → `aside` (fixed width) + `main` (flex-1)
- Centered content: `mx-auto max-w-7xl px-4 sm:px-6 lg:px-8`
- Header + content: `flex flex-col` → sticky header + scrollable content
- Grid of cards: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6`
- Split screen: `grid lg:grid-cols-2` (e.g., login pages with image + form)

### Layer 2: Spacing & Alignment Map

This is where Claude fails the most. Be extremely precise.

For EVERY gap, margin, and padding you see:
- What is the vertical spacing between sections? (likely `space-y-6`, `space-y-8`, or `gap-6`, `gap-8`)
- What is the horizontal padding of the page container? (likely `px-4 sm:px-6 lg:px-8`)
- What is the internal padding of cards/containers? (likely `p-4`, `p-5`, or `p-6`)
- What is the gap between items in a row? (likely `gap-2`, `gap-3`, or `gap-4`)
- What is the gap between a title and its subtitle? (`gap-1`, `gap-1.5`, or `gap-2`)
- Are items vertically centered? (`items-center`) Or top-aligned? (`items-start`)

**Spacing estimation guide from visual proportions:**
```
Barely visible gap    → gap-1 (4px) or gap-1.5 (6px)
Small tight gap       → gap-2 (8px)
Comfortable gap       → gap-3 (12px) or gap-4 (16px)
Section breathing room → gap-6 (24px) or gap-8 (32px)
Major section break   → gap-10 (40px), gap-12 (48px), or gap-16 (64px)

Card/container padding:
Compact card          → p-3 (12px) or p-4 (16px)
Standard card         → p-5 (20px) or p-6 (24px)
Spacious section      → p-8 (32px) or p-10 (40px) or py-12 (48px)
```

**Alignment rules:**
- Row of items with different heights → `flex items-center` (vertical center)
- Icon next to text → `flex items-center gap-2`
- Label above input → `flex flex-col gap-1.5` or `space-y-1.5`
- Buttons at the end of a row → `flex items-center justify-between` or `flex justify-end gap-3`

### Layer 3: Color Extraction

Do NOT guess colors. Analyze what you see precisely.

**For each distinct color in the design, identify:**
- Background colors (page, cards, sections, sidebar, header)
- Text colors (headings, body, muted/secondary text, links)
- Border colors
- Accent/brand colors (buttons, active states, badges, links)
- Status colors (success green, error red, warning yellow, info blue)
- Shadow colors and intensity

**Map to Shadcn CSS variables first:**
```
White/light background     → bg-background (adapts to dark mode)
Slightly tinted background → bg-muted
Card/elevated background   → bg-card
Primary text (dark)        → text-foreground
Secondary/grey text        → text-muted-foreground
Faint/tertiary text        → text-muted-foreground/60 or text-muted-foreground with opacity
Borders                    → border (which applies border-border color)
Primary brand color        → bg-primary text-primary-foreground
Destructive/red            → bg-destructive text-destructive-foreground
```

**When the design uses colors outside Shadcn's system:**
- Specific brand colors → Use Tailwind's palette: `bg-blue-600`, `text-indigo-500`, etc.
- Gradients → `bg-gradient-to-r from-blue-600 to-indigo-600`
- Semi-transparent overlays → `bg-black/50`, `bg-white/80`
- If a color doesn't have a Tailwind match, use arbitrary: `bg-[#7C3AED]`

**CRITICAL: Check if the design is dark mode or light mode.** If dark:
- "Black" backgrounds are usually `bg-background` (which is dark in dark mode) or `bg-card`, NOT `bg-black`
- Text on dark backgrounds is `text-foreground`, NOT `text-white`
- Always prefer CSS variables so the output works in both modes

### Layer 4: Typography Inventory

For EVERY piece of text in the design:

- **Headings** — What size? What weight? What color?
  ```
  Page title:      text-2xl sm:text-3xl font-bold tracking-tight text-foreground
  Section title:   text-xl sm:text-2xl font-semibold text-foreground
  Card title:      text-lg font-semibold text-foreground
  Subtitle:        text-base font-medium text-foreground
  ```

- **Body text** — What size? What line-height? What color?
  ```
  Standard body:   text-sm text-foreground (14px — Shadcn default)
  Small body:      text-sm text-muted-foreground
  Tiny/caption:    text-xs text-muted-foreground
  ```

- **Special text** — Labels, badges, buttons, links, numbers
  ```
  Label:           text-sm font-medium text-foreground
  Muted label:     text-xs font-medium text-muted-foreground uppercase tracking-wide
  Badge text:      text-xs font-medium (inside <Badge>)
  Button text:     text-sm font-medium (Shadcn Button default)
  Large number:    text-2xl sm:text-3xl font-bold (dashboard stat cards)
  Link:            text-sm text-primary hover:underline
  ```

- **Font weight mapping:**
  ```
  Thin/light text   → font-light (300)
  Regular body      → font-normal (400) — default, don't specify
  Medium emphasis    → font-medium (500)
  Bold headings      → font-semibold (600) — preferred for most headings
  Extra bold/hero    → font-bold (700)
  ```

### Layer 5: Component Identification

List every UI component you see and map it to Shadcn/UI:

```
Rounded rectangle with text          → <Badge> or <Button>
Form field with label above          → <FormField> + <FormLabel> + <Input>
Dropdown selector                    → <Select> or <Combobox> (Popover + Command)
Elevated container                   → <Card> with appropriate sub-components
Three-dot menu                       → <DropdownMenu> with <Button variant="ghost" size="icon">
Toggle switch                        → <Switch>
Checkbox with label                  → <Checkbox> + <Label>
Modal/overlay                        → <Dialog> or <AlertDialog>
Tab navigation                       → <Tabs> + <TabsList> + <TabsTrigger>
Side panel sliding in                → <Sheet>
Progress indicator                   → <Progress>
Circular image/initials              → <Avatar> + <AvatarImage> + <AvatarFallback>
Breadcrumb trail                     → <Breadcrumb> components
Star rating                          → Custom with Lucide <Star> icons
Search input                         → <Input> with search icon or <Command>
Data table                           → <Table> components or @tanstack/react-table
Tooltip on hover                     → <Tooltip> components
Notification popup                   → <Toast> via sonner
```

### Layer 6: Decorative & Visual Details (THE MOST SKIPPED LAYER)

This is what Claude almost always misses. Go through the design and explicitly list:

**Borders:**
- Which elements have borders? → `border` (1px solid border-border)
- Bottom border only? → `border-b`
- Border color different from default? → `border-blue-200` or custom
- Thicker border? → `border-2`

**Shadows:**
- Subtle elevation → `shadow-sm`
- Standard card shadow → `shadow` or `shadow-md`
- Prominent elevation → `shadow-lg`
- No shadow (flat design) → Don't add shadow

**Border radius:**
- Slightly rounded → `rounded` (4px) or `rounded-md` (6px)
- Standard rounded → `rounded-lg` (8px) — Shadcn Card default
- Very rounded → `rounded-xl` (12px) or `rounded-2xl` (16px)
- Pill shape → `rounded-full`
- Specific corners only → `rounded-t-lg` (top only)

**Backgrounds & effects:**
- Gradient backgrounds → `bg-gradient-to-r from-X to-Y`
- Semi-transparent → `bg-white/80 backdrop-blur-sm` (glass effect)
- Dotted/dashed borders → `border-dashed`
- Background patterns → May need pseudo-elements or SVG
- Divider lines → `<Separator>` from Shadcn or `border-b` on container

**Icons:**
- List EVERY icon visible in the design
- Map each to a Lucide React icon name
- Note the size (usually `h-4 w-4`, `h-5 w-5`, or `h-6 w-6`)
- Note the color (`text-muted-foreground`, `text-primary`, etc.)
- Note if it's inside a colored circle/background container

**Hover/interaction states (if visible or implied):**
- Button hover → Already handled by Shadcn variants
- Card hover → `hover:shadow-md hover:-translate-y-0.5 transition-all duration-200`
- Row hover → `hover:bg-muted/50`
- Link hover → `hover:underline` or `hover:text-primary`

**Miscellaneous details people miss:**
- Divider lines between sections → `<Separator />` or `border-b`
- Dot separators between text → `<span className="text-muted-foreground">·</span>`
- Count badges on icons → Absolute positioned `<Badge>` on parent
- "New" or "Pro" tags → `<Badge variant="secondary">` next to title
- Avatar groups (overlapping circles) → negative margin `flex -space-x-2`
- Truncation indicators (... on long text) → `truncate` or `line-clamp-N`
- Placeholder/empty state illustrations
- Subtle background color differences between sections

### Layer 7: Responsive Behavior Assessment

Determine from the screenshot:
- Is this a desktop view, tablet view, or mobile view?
- If desktop: How should it collapse for mobile?
  - Sidebar → `<Sheet>` on mobile
  - Multi-column grid → single column
  - Horizontal nav → hamburger menu
  - Side-by-side layout → stacked
  - Table → card list
- If mobile: How should it expand for desktop?

---

## Step 3: Write the Code

NOW you can code. But follow these rules:

### Rule 1: Reference Your Analysis

As you code each section, mentally check it against your Layer analysis. After finishing a section, re-examine the screenshot to verify you haven't missed anything.

### Rule 2: Build Outside-In

```
1. Page layout shell (header, sidebar, main area)
2. Major sections within main area
3. Components within each section
4. Content within each component
5. Decorative details (borders, shadows, icons, badges)
6. Responsive adjustments
```

### Rule 3: Use Shadcn Components for Everything Possible

Check the Shadcn import list (see `references/shadcn-mappings.md`) before building anything custom. If Shadcn has it, use it.

### Rule 4: Exact Spacing — No Eyeballing

Every spacing value must come from the Tailwind scale. If you're unsure between two values, pick the one that's closer to Shadcn defaults:
- Card padding: `p-6` (Shadcn Card default)
- Gap between form fields: `space-y-4` or `space-y-6`
- Gap between icon and text: `gap-2`
- Page section gaps: `space-y-6` or `space-y-8`

### Rule 5: Dark Mode Safety

Use CSS variables for all colors. If you type `bg-white`, `text-black`, `bg-gray-100`, or any hardcoded gray — STOP and replace with `bg-background`, `text-foreground`, `bg-muted`.

Exception: Specific brand/accent colors (`bg-blue-600`, `text-emerald-500`) are fine — they're intentional, not theme-dependent.

### Rule 6: Every Visual Element Must Exist in Code

After writing the code, go through the screenshot one final time and check:
```
□ Every icon in the design has a corresponding Lucide icon in the code
□ Every border visible in the design exists in the code
□ Every shadow visible in the design exists in the code
□ Every badge/tag/label in the design exists in the code
□ Every color difference between sections is captured
□ Every divider/separator line exists in the code
□ Text sizes match the visual hierarchy in the design
□ Spacing between elements matches the design proportions
□ Border radius matches (rounded-md vs rounded-lg vs rounded-full)
□ Background colors of all sections/cards match
□ Any gradient or decorative effect is implemented
□ Avatar/image placeholders are included
□ Hover states are implemented (even if not visible in screenshot)
```

---

## Step 4: Self-Review Checklist

Before delivering the code, run this final check:

```
LAYOUT
□ Overall page structure matches the screenshot
□ Flex/grid layout matches the spatial arrangement
□ Content is contained (max-width) or full-width as shown
□ Sidebar/header/footer positioning matches

SPACING
□ Page padding matches (px-4 sm:px-6 lg:px-8 or as shown)
□ Section gaps match (space-y-N or gap-N)
□ Card/component internal padding matches
□ Icon-to-text gaps are consistent (gap-2 or gap-3)
□ Vertical rhythm between elements is consistent

COLORS
□ All background colors match (page, cards, sidebar, sections)
□ All text colors match (headings, body, muted, links)
□ All border colors match
□ Accent/brand colors match
□ Status colors match (success, error, warning)
□ Using CSS variables for theme colors (dark mode safe)

TYPOGRAPHY
□ Heading sizes and weights match
□ Body text size matches
□ Muted/secondary text color matches
□ Line-height looks correct (leading-tight, leading-normal, leading-relaxed)
□ Letter-spacing on any uppercase labels (tracking-wide)

COMPONENTS
□ All Shadcn components identified and used
□ Correct Shadcn variants chosen (Button variant, Badge variant, etc.)
□ Form fields have proper Label + Input + error structure

DETAILS
□ All icons present with correct size and color
□ All borders present (border, border-b, border-dashed, etc.)
□ All shadows present (shadow-sm, shadow, shadow-md, shadow-lg)
□ All border-radius values correct
□ Dividers/separators present where shown
□ Badges/tags/labels present where shown
□ Background effects (gradients, patterns, blur) implemented
□ Hover states added to interactive elements

RESPONSIVE
□ Mobile layout considered (or implemented if required)
□ Touch targets minimum h-11 on mobile
□ Text doesn't overflow containers
```

---

## Common Patterns Claude Gets Wrong

Read `references/common-fixes.md` for specific before/after examples of:

- Wrong flex direction (row vs column confusion)
- Missing `items-center` causing vertical misalignment
- Using `margin` when `gap` is correct
- Wrong grid template (grid-cols-3 when design shows grid-cols-4)
- Missing `justify-between` in header/row layouts
- Forgetting `relative` on parent for absolute-positioned badges
- Skipping `overflow-hidden` on cards with images
- Wrong `object-cover` vs `object-contain` on images
- Missing `shrink-0` on icons causing them to squish
- Forgetting `whitespace-nowrap` on buttons/badges
- Using wrong Shadcn component (Select vs DropdownMenu)
- Missing `<Separator>` between sections
