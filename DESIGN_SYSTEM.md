# FleetWorks Design System — Complete Guide

## Overview

The FleetWorks Design System provides comprehensive, standardized CSS components, tokens, and utilities to ensure consistency across ALL pages, modals, forms, tabs, and interactive elements throughout the application.

## Files

- **`css/style.css`** — Base styles, core components, page-specific styles
- **`css/design-system.css`** — Extended design system (load AFTER style.css)
- **`css/landing.css`** — Front page (index.html) dark theme overrides

All application pages (except landing page) should include BOTH `style.css` and `design-system.css`.

## Color Palette

### Primary Colors
- `--navy: #0f1e33` — Primary brand color (dark blue)
- `--amber: #f5a623` — Accent color (warm orange)

### Semantic Colors
- `--green: #16a34a` — Success, active states
- `--red: #dc2626` — Errors, dangerous actions
- `--blue: #2563eb` — Information, links
- `--orange: #e69120` — Warnings

### Grays
- `--ink: #1c2733` — Primary text
- `--muted: #64748b` — Secondary text
- `--line: #e2e8f0` — Borders, dividers
- `--bg: #ffffff` — Background
- `--bg-alt: #f4f7fb` — Alternate background

## Typography

### Heading Sizes
```html
<h1>Large heading</h1>   <!-- 3.2rem, 800 weight -->
<h2>Medium heading</h2>   <!-- 2.2rem, 800 weight -->
<h3>Small heading</h3>    <!-- 1.35rem, 700 weight -->
<h4>Sub heading</h4>      <!-- 1.15rem, 700 weight -->
```

### Utility Classes
```html
<p class="text-xs">Extra small text</p>
<p class="text-sm">Small text</p>
<p class="text-base">Base text</p>
<p class="text-lg">Large text</p>

<strong class="font-bold">Bold text</strong>
<em class="font-semibold">Semibold text</em>
<span class="text-muted">Muted text</span>
```

## Buttons

### Button Types

**Primary** (amber, navy text) — Main call-to-action
```html
<button class="btn btn-primary">Primary Action</button>
```

**Secondary** (navy outline) — Alternative actions
```html
<button class="btn btn-secondary">Secondary Action</button>
```

**Outline** (navy border) — Secondary styling
```html
<button class="btn btn-outline">Outline Button</button>
```

**Light** (white background) — Light backgrounds
```html
<button class="btn btn-light">Light Button</button>
```

**Ghost** (transparent) — Minimal styling
```html
<button class="btn btn-ghost">Ghost Button</button>
```

**Danger** (red) — Destructive actions
```html
<button class="btn btn-danger">Delete</button>
```

**Link** (text only) — Inline links
```html
<button class="link-btn">Click here</button>
```

### Button Sizes
```html
<button class="btn btn-xs">Extra Small</button>
<button class="btn btn-sm">Small</button>
<button class="btn btn-base">Base (default)</button>
<button class="btn btn-lg">Large</button>
<button class="btn btn-xl">Extra Large</button>
```

### Button Modifiers
```html
<button class="btn btn-primary btn-block">Full width</button>
<button class="btn btn-icon">📎</button>
<button class="btn" disabled>Disabled</button>
```

## Forms

### Inputs & Selects
```html
<label>
  Email Address
  <input type="email" placeholder="you@example.com" />
</label>

<label>
  Vehicle Type
  <select>
    <option>Select...</option>
    <option>Truck</option>
    <option>Bus</option>
  </select>
</label>

<label>
  Textarea
  <textarea placeholder="Enter details..."></textarea>
</label>
```

### Form Helpers
```html
<label>
  Password
  <input type="password" />
  <span class="field-hint">Minimum 6 characters</span>
</label>

<label>
  Email
  <input type="email" class="invalid" />
  <span class="field-error">Invalid email address</span>
</label>

<label>
  Phone
  <input type="tel" class="valid" />
  <span class="field-success">Verified</span>
</label>
```

### Form Layouts
```html
<!-- Two-column layout -->
<div class="form-row">
  <label>First Name <input type="text" /></label>
  <label>Last Name <input type="text" /></label>
</div>

<!-- Three-column layout -->
<div class="form-row three">
  <label>City <input type="text" /></label>
  <label>State <input type="text" /></label>
  <label>ZIP <input type="text" /></label>
</div>

<!-- Full width -->
<div class="form-row full">
  <label>Address <input type="text" /></label>
</div>
```

## Dropdowns & Menus

```html
<div class="dropdown">
  <button class="btn btn-primary dropdown-trigger">
    Menu
    <span>▼</span>
  </button>
  <div class="dropdown-menu">
    <a href="#" class="dropdown-item">Option 1</a>
    <a href="#" class="dropdown-item active">Option 2</a>
    <div class="dropdown-divider"></div>
    <button class="dropdown-item" onclick="logout()">Logout</button>
  </div>
</div>
```

## Modals & Dialogs

```html
<!-- Modal overlay (always present, hidden by default) -->
<div class="modal-overlay" id="myModal">
  <div class="modal modal-md">
    <div class="modal-header">
      <h3 class="modal-title">Confirm Action</h3>
      <p class="modal-subtitle">Are you sure?</p>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    
    <div class="modal-body">
      <p>This action cannot be undone.</p>
    </div>
    
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger">Delete</button>
    </div>
  </div>
</div>

<!-- To open: -->
<script>
  document.getElementById('myModal').classList.add('open');
</script>
```

### Modal Sizes
- `.modal-sm` — max-width: 400px (confirmations, alerts)
- `.modal-md` — max-width: 560px (forms, default)
- `.modal-lg` — max-width: 760px (complex forms, dialogs)
- `.modal-xl` — max-width: 1000px (large tables, dashboards)

## Cards & Containers

```html
<!-- Standard card -->
<div class="card">
  <div class="card-header">
    <h3 class="card-title">Card Title</h3>
    <p class="card-subtitle">Subtitle or description</p>
  </div>
  <div class="card-body">
    <p>Card content goes here</p>
  </div>
  <div class="card-footer">
    <button class="btn btn-primary">Action</button>
  </div>
</div>

<!-- Highlight variant (dark navy) -->
<div class="card highlight">
  <h3 class="card-title">Featured Card</h3>
  <p>Highlighted content</p>
</div>

<!-- Semantic variants -->
<div class="card success">Success card</div>
<div class="card warning">Warning card</div>
<div class="card danger">Danger card</div>
<div class="card info">Info card</div>
```

## Chips, Badges & Pills

### Chips (selectable tags)
```html
<div class="chip">All Vehicles</div>
<div class="chip interactive">Active</div>
<div class="chip active">Selected</div>
```

### Badges (status labels)
```html
<span class="badge badge-primary">Pending</span>
<span class="badge badge-success">Active</span>
<span class="badge badge-danger">Overdue</span>
<span class="badge badge-warning">At Risk</span>
<span class="badge badge-info">New</span>
```

### Pills (inline labels)
```html
<span class="pill">Tag</span>
```

## Alerts & Status

```html
<!-- Success alert -->
<div class="alert alert-success">
  <span class="alert-icon">✓</span>
  <div class="alert-content">
    <p class="alert-title">Success!</p>
    <p class="alert-message">Your changes have been saved.</p>
  </div>
</div>

<!-- Danger alert -->
<div class="alert alert-danger">
  <span class="alert-icon">!</span>
  <div class="alert-content">
    <p class="alert-title">Error</p>
    <p class="alert-message">Something went wrong. Please try again.</p>
  </div>
</div>

<!-- Warning alert -->
<div class="alert alert-warning">
  <span class="alert-icon">⚠</span>
  <div class="alert-content">
    <p class="alert-title">Warning</p>
    <p class="alert-message">Review before proceeding.</p>
  </div>
</div>

<!-- Info alert -->
<div class="alert alert-info">
  <span class="alert-icon">ℹ</span>
  <div class="alert-content">
    <p class="alert-title">Information</p>
    <p class="alert-message">This is helpful context.</p>
  </div>
</div>
```

## Tabs

```html
<div class="tab-bar">
  <button class="tab-btn active" onclick="showTab('tab1')">Overview</button>
  <button class="tab-btn" onclick="showTab('tab2')">Details</button>
  <button class="tab-btn" onclick="showTab('tab3')">History</button>
</div>

<div id="tab1" class="tab-panel active">
  <p>Tab 1 content</p>
</div>

<div id="tab2" class="tab-panel">
  <p>Tab 2 content</p>
</div>

<div id="tab3" class="tab-panel">
  <p>Tab 3 content</p>
</div>
```

## Tables

```html
<table>
  <thead>
    <tr>
      <th>Vehicle</th>
      <th>Status</th>
      <th>Mileage</th>
      <th>Action</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>TN-01-AB-1234</td>
      <td><span class="badge badge-success">Active</span></td>
      <td>45,234 km</td>
      <td><button class="btn btn-sm btn-primary">Edit</button></td>
    </tr>
  </tbody>
</table>
```

## Spacing Utilities

```html
<!-- Margin top -->
<div class="mt-xs">Extra small margin top</div>
<div class="mt-sm">Small margin top</div>
<div class="mt-md">Medium margin top</div>
<div class="mt-lg">Large margin top</div>

<!-- Margin bottom -->
<div class="mb-lg">Large margin bottom</div>

<!-- Margin vertical (top & bottom) -->
<div class="my-lg">Large margin vertical</div>

<!-- Padding -->
<div class="p-lg">Padding on all sides</div>
<div class="px-lg">Padding left & right</div>
<div class="py-lg">Padding top & bottom</div>
```

## Flexbox Utilities

```html
<!-- Display flex -->
<div class="flex">Flex container</div>

<!-- Direction -->
<div class="flex flex-col">Column direction</div>
<div class="flex flex-row">Row direction</div>

<!-- Alignment -->
<div class="flex flex-center">Centered</div>
<div class="flex flex-between">Space between</div>
<div class="flex items-center">Vertically centered</div>

<!-- Gap -->
<div class="flex gap-md">Children with medium gap</div>
```

## Text Utilities

```html
<p class="text-center">Center aligned text</p>
<p class="text-left">Left aligned text</p>
<p class="text-right">Right aligned text</p>

<p class="uppercase">UPPERCASE TEXT</p>
<p class="lowercase">lowercase text</p>
<p class="capitalize">Capitalize text</p>

<p class="truncate">This long text will be truncated with ellipsis...</p>
<p class="italic">Italic text</p>
<p class="underline">Underlined text</p>
<p class="line-through">Struck through text</p>
```

## Display Utilities

```html
<div class="block">Block element</div>
<span class="inline-block">Inline-block element</span>
<div class="hidden">Hidden element</div>
<div class="invisible">Invisible but takes space</div>

<div class="w-full">Full width</div>
<div class="h-full">Full height</div>
```

## CSS Custom Properties (Tokens)

All design tokens are available as CSS variables:

```css
/* Colors */
var(--navy)
var(--amber)
var(--green)
var(--red)

/* Typography */
var(--text-xs)
var(--text-sm)
var(--text-base)
var(--text-lg)

/* Spacing */
var(--space-sm)
var(--space-md)
var(--space-lg)

/* Border radius */
var(--radius-sm)
var(--radius-md)
var(--radius-lg)
var(--radius-full)

/* Shadows */
var(--shadow)
var(--shadow-lg)

/* Transitions */
var(--transition-fast)
var(--transition-base)
var(--transition-slow)
```

## Accessibility

All components follow WCAG 2.1 AA guidelines:
- Sufficient color contrast
- Keyboard navigable buttons and forms
- Focus states visible
- Error messages associated with inputs
- Semantic HTML structure

## Responsive Breakpoints

- **Desktop**: Full width (1180px container)
- **Tablet**: 768px - 960px (adjust grid columns)
- **Mobile**: < 768px (single column layouts, full-width modals)

## Best Practices

1. **Use semantic HTML** — `<button>`, `<label>`, `<nav>`, etc.
2. **Combine utility classes** — Don't create new CSS for common patterns
3. **Maintain consistency** — Use design tokens, not hardcoded values
4. **Test responsive** — Verify layouts at tablet and mobile sizes
5. **Keyboard accessible** — All interactive elements must be keyboard navigable
6. **Focus visible** — Users must see focus states on buttons and inputs
7. **Color not only** — Don't convey info using color alone (combine with icons/text)

## Common Patterns

### Form with validation
```html
<form class="entry-form">
  <label>
    Email
    <input type="email" required />
    <span class="field-hint">We'll never share your email</span>
  </label>
  <div class="form-row">
    <button type="submit" class="btn btn-primary">Submit</button>
    <button type="reset" class="btn btn-outline">Clear</button>
  </div>
</form>
```

### Card with action
```html
<div class="card">
  <div class="card-header">
    <h3 class="card-title">Vehicle Status</h3>
  </div>
  <div class="card-body">
    <p>Status: <span class="badge badge-success">Active</span></p>
  </div>
  <div class="card-footer">
    <button class="btn btn-primary">View Details</button>
  </div>
</div>
```

### Tabs with forms
```html
<div class="tab-bar">
  <button class="tab-btn active">Vehicle Info</button>
  <button class="tab-btn">Compliance</button>
  <button class="tab-btn">Maintenance</button>
</div>

<div class="tab-panel active">
  <form class="entry-form">
    <!-- Vehicle form -->
  </form>
</div>
```

## Questions?

Refer to individual page implementations for more examples. All pages should use these components consistently.
