# FleetWorks Universal Styling Guide

## Purpose

All styling in FleetWorks must be **centralized and universal**. A single CSS change should affect the entire application consistently.

## CSS File Hierarchy

### Load Order (DO NOT CHANGE)
1. **`css/style.css`** — Base colors, fonts, resets
2. **`css/design-system.css`** — Components, utilities, menus, buttons
3. **`css/landing.css`** — Front page only (index.html specific)

All other HTML pages use CSS files #1 & #2 only.

## CSS File Responsibilities

### `css/style.css`
- Global resets and element defaults
- Base color palette (`:root` variables)
- Core typography
- Existing component styles (don't duplicate in design-system.css)

### `css/design-system.css`
- **NEVER duplicate** base styles from style.css
- Navigation system (`.nav-sidebar`, `.nav-item`, `.nav-section`)
- Button system (all `.btn-*` variants)
- Menu components (`.btn-menu`)
- Cards, modals, forms, tables
- Utility classes (spacing, flexbox, text)
- Responsive breakpoints

### `css/landing.css`
- **Front page ONLY** (linked only in index.html)
- Override dark theme styles
- Don't put anything here that other pages need

## Universal Styling Rules

### ✅ DO THIS

**Use CSS variables for everything:**
```css
.nav-item {
  color: var(--muted-light);        /* ✅ Use variable */
  padding: var(--space-md);          /* ✅ Use spacing token */
  font-size: var(--text-sm);         /* ✅ Use typography token */
  transition: all var(--transition-base); /* ✅ Use transition token */
}
```

**Define colors in `:root` once:**
```css
/* In style.css :root ONLY */
:root {
  --navy: #0f1e33;
  --amber: #f5a623;
  --muted-light: #94a3b8;
}
```

**Reference existing tokens in design-system.css:**
```css
/* In design-system.css */
.nav-item {
  color: var(--muted-light);  /* From style.css :root */
}
```

### ❌ DON'T DO THIS

**Hardcode colors:**
```css
.nav-item {
  color: #94a3b8;  /* ❌ Hardcoded — can't update everywhere at once */
}
```

**Duplicate styles across files:**
```css
/* style.css */
.btn { padding: 12px 24px; }

/* design-system.css */
.btn { padding: 12px 24px; }  /* ❌ Duplicate — which one wins? */
```

**Create page-specific overrides outside design-system.css:**
```html
<!-- admin.html -->
<style>
  .btn { color: red; }  /* ❌ Overrides design system unpredictably */
</style>
```

## Updating Styling Universally

### Change a color
1. Find the variable in `css/style.css` `:root`
2. Update it ONCE
3. All pages using that variable update automatically

**Example:**
```css
/* Change primary button color */
:root {
  --amber: #f5a623;  /* Change from this */
  --amber: #ff9500;  /* ...to this */
}
/* All .btn-primary buttons on all pages now use #ff9500 */
```

### Change button styling
1. Edit `.btn-primary` (or variant) in `css/design-system.css`
2. Change applies to all pages automatically

**Example:**
```css
.btn-primary {
  padding: 12px 24px;  /* Change from this */
  padding: 14px 28px;  /* ...to this */
}
/* All primary buttons on all pages now have new padding */
```

### Change navigation styling
1. Edit `.nav-item` or `.nav-sidebar` in `css/design-system.css`
2. Change applies everywhere automatically

## Page-Specific CSS (Allowed ONLY for)

### Allowed
- Layout variations (grid, flexbox specific to page)
- Page structure (main, aside, section)
- Scoped overrides using CSS variables already defined
- Dark theme overrides (landing.css only)

### NOT Allowed
- Color overrides (use CSS variables instead)
- Typography overrides (use text utilities instead)
- Button styling overrides (use button variants instead)
- Custom component styles (add to design-system.css instead)

## Implementation Checklist

Before publishing a page:

- [ ] **CSS Links** — Does HTML include both style.css AND design-system.css?
  ```html
  <link rel="stylesheet" href="css/style.css" />
  <link rel="stylesheet" href="css/design-system.css" />
  ```

- [ ] **No Inline Styles** — Are there `style="color: #abc"` attributes? ❌ Use classes instead.

- [ ] **Color Consistency** — Are colors using `var(--*)` or hardcoded values? Must be variables.

- [ ] **Typography Consistency** — Are text classes applied (`.text-sm`, `.font-bold`)? Check.

- [ ] **Button Usage** — Do all buttons use `.btn` + variant? Never custom button styles.

- [ ] **Spacing** — Are margins/padding using `.mt-lg`, `.mb-md`, etc.? Or CSS variables?

- [ ] **Dark Theme** — Does page look correct in both light and dark? Test.

## CSS Variable Reference

### Colors
```
--navy, --navy-2, --navy-3, --navy-light
--amber, --amber-dark, --amber-light
--green, --green-light
--red, --red-light
--blue, --blue-light
--orange, --orange-light
--ink, --ink2, --muted, --muted-light
--bg, --bg-alt, --bg-light
--line, --border
```

### Typography
```
--text-xs, --text-sm, --text-base, --text-md, --text-lg, --text-xl, --text-2xl, --text-3xl, --text-4xl
--fw-regular, --fw-medium, --fw-semibold, --fw-bold, --fw-extrabold
```

### Spacing
```
--space-xs, --space-sm, --space-md, --space-lg, --space-xl, --space-2xl, --space-3xl, --space-4xl, --space-5xl, --space-6xl
```

### Sizing & Radius
```
--radius-sm, --radius-md, --radius-lg, --radius-xl, --radius-2xl, --radius-full
```

### Effects
```
--shadow-xs, --shadow-sm, --shadow, --shadow-lg, --shadow-xl
--transition-fast, --transition-base, --transition-slow
```

## Verification

### Test universality
1. Edit a CSS variable in `css/style.css` `:root`
2. Reload ANY page in the app
3. Verify the change applies to ALL matching elements

### Test component consistency
1. Edit a button style in `css/design-system.css` (e.g., `.btn-primary`)
2. Visit multiple pages (fleet.html, admin.html, team.html)
3. Verify ALL primary buttons changed identically

## What NOT to Do

❌ **Add CSS to HTML files**
```html
<!-- ❌ Never do this -->
<style>
  .custom-btn { color: blue; }
</style>
```

❌ **Use hardcoded colors**
```css
/* ❌ Never do this */
.nav-item { color: #94a3b8; }
```

❌ **Create page-specific button variants**
```css
/* ❌ Never do this */
/* admin.html specific */
.admin-btn { padding: 20px; }  /* Different from normal .btn */
```

❌ **Duplicate component styles**
```css
/* ❌ Never do this */
/* Both style.css and design-system.css define .btn */
```

## Future Changes

When you need to:

**Add a new color:** Add to `:root` in `style.css`  
**Add a new button variant:** Add to `design-system.css`  
**Change all button spacing:** Edit `.btn` in `design-system.css`  
**Update primary brand color:** Edit `--amber` in `style.css` `:root`  
**Create new text size:** Add to `--text-*` variables in `style.css`  

---

**Remember:** One change in the right place = universal update across 10+ pages.

