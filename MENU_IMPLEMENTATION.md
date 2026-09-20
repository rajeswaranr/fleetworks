# Menu & Navigation Implementation Guide

## Updated Design

All buttons and menus now follow a **minimal dark aesthetic** matching modern fleet management apps (Motive, Samsara style).

### Color Scheme
- **Background:** Navy (#0f1e33)
- **Text:** Light gray (#94a3b8)
- **Hover:** Light hover (#cbd5e1)
- **Active:** Indigo (#6366f1)
- **Primary Action:** Amber (#f5a623)

## Button Styles

### 1. Primary Button (Action Buttons)
```html
<button class="btn btn-primary">Save Changes</button>
```
- **Style:** Solid amber background, navy text
- **Use:** Main call-to-action buttons, form submissions
- **Hover:** Darker amber with slight lift

### 2. Menu Button (Navigation Items)
```html
<button class="btn btn-menu">
  <i data-icon="dashboard"></i>
  <span class="menu-label">Dashboard</span>
</button>
```
- **Style:** Gray text, transparent background
- **Use:** Sidebar navigation, menu items
- **Hover:** Light background with lighter text

### 3. Secondary Button (Alternative Actions)
```html
<button class="btn btn-secondary">Cancel</button>
```
- **Style:** Subtle light background, gray text
- **Use:** Secondary actions, alternatives to primary

### 4. Outline Button (Subtle Actions)
```html
<button class="btn btn-outline">View Details</button>
```
- **Style:** Minimal border, transparent background
- **Use:** Less prominent actions

### 5. Ghost Button (Minimal)
```html
<button class="btn btn-ghost">Skip</button>
```
- **Style:** Transparent with no border
- **Use:** Minimal actions, dismiss options

## Navigation Structure

### Sidebar Navigation Layout
```html
<nav class="nav-sidebar">
  <!-- Section 1 -->
  <div class="nav-section">
    <div class="nav-section-label">Main</div>
    <a href="#" class="nav-item active">
      <i class="nav-icon" data-icon="home"></i>
      <span class="nav-label">Fleet View</span>
    </a>
    <a href="#" class="nav-item">
      <i class="nav-icon" data-icon="alert"></i>
      <span class="nav-label">Safety</span>
    </a>
  </div>

  <!-- Section 2 -->
  <div class="nav-section">
    <div class="nav-section-label">Operations</div>
    <a href="#" class="nav-item">
      <i class="nav-icon" data-icon="vehicle"></i>
      <span class="nav-label">Vehicles</span>
    </a>
    <a href="#" class="nav-item">
      <i class="nav-icon" data-icon="users"></i>
      <span class="nav-label">Drivers</span>
    </a>
  </div>

  <!-- Section with badge -->
  <div class="nav-section">
    <div class="nav-section-label">Tools</div>
    <a href="#" class="nav-item">
      <i class="nav-icon" data-icon="settings"></i>
      <span class="nav-label">Settings</span>
      <span class="nav-badge">NEW</span>
    </a>
  </div>
</nav>
```

## CSS Classes Reference

### Navigation Item States
- `.nav-item` — Default state (gray text, transparent)
- `.nav-item:hover` — Light background, lighter text
- `.nav-item.active` — Indigo background + accent dot

### Sizing
- **Icon:** 18px × 18px
- **Padding:** 10px 14px (compact)
- **Gap between icon & label:** 16px

### Colors
| Element | Default | Hover | Active |
|---------|---------|-------|--------|
| Background | transparent | rgba(255,255,255,0.08) | rgba(99,102,241,0.15) |
| Text | #94a3b8 | #cbd5e1 | #6366f1 |
| Border | — | — | — |

## Implementation Across Pages

### 1. Fleet Manager (fleet.html)
```html
<nav class="nav-sidebar">
  <div class="nav-section">
    <div class="nav-section-label">Dashboard</div>
    <a href="#overview" class="nav-item active">
      <i class="nav-icon" data-icon="overview"></i>
      <span class="nav-label">Overview</span>
    </a>
    <a href="#compliance" class="nav-item">
      <i class="nav-icon" data-icon="compliance"></i>
      <span class="nav-label">Compliance</span>
    </a>
    <a href="#fuel" class="nav-item">
      <i class="nav-icon" data-icon="fuel"></i>
      <span class="nav-label">Fuel</span>
    </a>
  </div>
</nav>
```

### 2. Admin Console (admin.html)
```html
<nav class="nav-sidebar">
  <div class="nav-section">
    <div class="nav-section-label">Admin</div>
    <a href="#leads" class="nav-item">
      <i class="nav-icon" data-icon="leads"></i>
      <span class="nav-label">Leads</span>
    </a>
    <a href="#vendors" class="nav-item">
      <i class="nav-icon" data-icon="vendor"></i>
      <span class="nav-label">Vendors</span>
    </a>
  </div>
</nav>
```

### 3. Team Portal (team.html)
```html
<nav class="nav-sidebar">
  <div class="nav-section">
    <div class="nav-section-label">Team</div>
    <a href="#vehicles" class="nav-item">
      <i class="nav-icon" data-icon="vehicle"></i>
      <span class="nav-label">Vehicles</span>
    </a>
    <a href="#profile" class="nav-item">
      <i class="nav-icon" data-icon="profile"></i>
      <span class="nav-label">My Profile</span>
    </a>
  </div>
</nav>
```

## Styling Guidelines

### DO ✅
- Use `.nav-item` for navigation links
- Use `.btn btn-primary` for main actions
- Use `.btn btn-secondary` or `.btn btn-outline` for alternatives
- Add icons next to menu labels
- Use section labels to group related items
- Show active state with `.active` class

### DON'T ❌
- Don't use multiple primary buttons in one section
- Don't nest navigation items deeply (max 2 levels)
- Don't use bright colors for navigation items
- Don't add borders to primary buttons
- Don't use navy text on dark backgrounds

## Active State Implementation

### JavaScript to Toggle Active
```javascript
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', function() {
    // Remove active from siblings
    this.parentElement.querySelectorAll('.nav-item').forEach(i => {
      i.classList.remove('active');
    });
    // Add active to clicked
    this.classList.add('active');
  });
});
```

### Auto-Active Based on URL
```javascript
document.querySelectorAll('.nav-item').forEach(item => {
  if (item.href === window.location.href) {
    item.classList.add('active');
  }
});
```

## Icons

All icons should use `<i data-icon="name"></i>` format:
- `dashboard` — Dashboard overview
- `fleet` — Fleet view
- `safety` — Safety compliance
- `compliance` — Compliance status
- `fuel` — Fuel tracking
- `vehicle` — Vehicle
- `driver` — Driver
- `settings` — Settings
- `users` — Team/Users
- `alert` — Alerts/Notifications
- `vendor` — Partner/Vendor
- `profile` — User profile

See `js/icons.js` for complete list.

## Responsive Behavior

### Mobile (< 768px)
- Navigation slides in from left as drawer
- Smaller padding (8px 12px)
- Text label may be hidden on very small screens
- Full-width menu items

### Tablet (768px - 1024px)
- Sidebar becomes narrow (icon-only mode)
- Labels appear on hover
- Compact spacing maintained

### Desktop (> 1024px)
- Full sidebar with labels always visible
- Standard 18px icons
- 10px 14px padding

## Examples

### Complete Sidebar
```html
<div style="display: flex; height: 100vh;">
  <nav class="nav-sidebar" style="width: 250px;">
    <div class="nav-section">
      <div class="nav-section-label">Fleet Management</div>
      <a href="#dashboard" class="nav-item active">
        <i class="nav-icon" data-icon="dashboard"></i>
        <span class="nav-label">Dashboard</span>
      </a>
      <a href="#vehicles" class="nav-item">
        <i class="nav-icon" data-icon="vehicle"></i>
        <span class="nav-label">Vehicles</span>
      </a>
      <a href="#drivers" class="nav-item">
        <i class="nav-icon" data-icon="driver"></i>
        <span class="nav-label">Drivers</span>
      </a>
    </div>

    <div class="nav-section">
      <div class="nav-section-label">Compliance</div>
      <a href="#safety" class="nav-item">
        <i class="nav-icon" data-icon="safety"></i>
        <span class="nav-label">Safety</span>
      </a>
      <a href="#maintenance" class="nav-item">
        <i class="nav-icon" data-icon="maintenance"></i>
        <span class="nav-label">Maintenance</span>
      </a>
    </div>
  </nav>

  <main style="flex: 1; overflow-y: auto;">
    <!-- Page content -->
  </main>
</div>
```

### Button Group
```html
<div style="display: flex; gap: 12px;">
  <button class="btn btn-primary">Save</button>
  <button class="btn btn-secondary">Cancel</button>
  <button class="btn btn-outline">More Options</button>
</div>
```

## Next Steps

1. Apply `.nav-sidebar` structure to fleet.html, admin.html, team.html
2. Update all navigation items to use `.nav-item` class
3. Add `.active` class to current page navigation
4. Update button styling in modals and forms to use new variants
5. Test across all pages for consistency
6. Verify icons display correctly

---

**Design System Version:** 2.0 (Menu Redesign)  
**Last Updated:** 2026-09-20  
**Status:** ✅ Design approved and implemented
