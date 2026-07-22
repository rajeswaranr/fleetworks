/* ============ FleetWorks — icons.js ============
   FleetWorks Design System (FDS) icon set. Professional, stroke-based
   inline SVGs (24x24, currentColor) that replace the old emoji icons
   across the app — one consistent, colour-token-driven system like the
   ones the big fleet platforms ship, but drawn for Indian fleet ops.

   Usage:
     • Markup:  <i data-icon="truck"></i>            -> hydrated on load
                <i data-icon="fuel" data-icon-size="18"></i>
     • JS:      FWIcon("wrench")                       -> returns SVG string
                FWIcon("wrench", { size: 20, cls: "spin" })

   Icons inherit text colour (stroke: currentColor), so colour them with
   the surrounding element's `color` or the .ic-* helper classes in CSS.
   Keep names semantic (concept, not shape) so callers stay stable even
   if the glyph is redrawn later. */

(function () {
  "use strict";

  /* Each entry is the inner markup of a 24x24 viewBox, stroke-based.
     paths use stroke="currentColor"; fills are "none" unless noted. */
  const P = {
    /* ---- navigation / modules ---- */
    gauge: '<path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="M13.4 12.6 19 7"/><path d="M4 20a9 9 0 1 1 16 0"/>',
    truck: '<path d="M2 17V6a1 1 0 0 1 1-1h11v12"/><path d="M14 9h4l3 3v5h-3"/><circle cx="7.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/><path d="M9.5 17.5h6"/>',
    driver: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    fuel: '<path d="M3 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16"/><path d="M2 21h13"/><path d="M6 9h6"/><path d="M15 7l3 3v7a2 2 0 0 0 4 0V9l-3-3"/>',
    clipboardCheck: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="m9.5 13 2 2 3.5-3.5"/>',
    wrench: '<path d="M14.5 5.5a4 4 0 0 0-5.4 5l-6 6 2.4 2.4 6-6a4 4 0 0 0 5-5.4l-2.6 2.6-2-2 2.6-2.6Z"/>',
    calendarClock: '<path d="M21 10V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h6"/><path d="M16 2v4M8 2v4M3 10h18"/><circle cx="17.5" cy="16.5" r="3.5"/><path d="M17.5 15v1.6l1 .9"/>',
    boxes: '<path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z"/><path d="M3 8.5V15l9 4.5M21 8.5V15l-9 4.5M12 13v6.5"/>',
    brain: '<path d="M9 4a2.5 2.5 0 0 0-2.5 2.5A2.5 2.5 0 0 0 5 11a2.5 2.5 0 0 0 1 4.5A2.5 2.5 0 0 0 9 20a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z"/><path d="M15 4a2.5 2.5 0 0 1 2.5 2.5A2.5 2.5 0 0 1 19 11a2.5 2.5 0 0 1-1 4.5A2.5 2.5 0 0 1 15 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/>',
    document: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
    tire: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
    charge: '<rect x="4" y="7" width="12" height="12" rx="2"/><path d="M16 10h2a2 2 0 0 1 2 2v3a1.5 1.5 0 0 1-3 0v-2"/><path d="m10 9-2 3h3l-2 3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 7 2.6h.1A1.6 1.6 0 0 0 9 1.1V1a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 15 2.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
    tools: '<path d="M14.5 5.5a4 4 0 0 0-5.4 5l-6 6 2.4 2.4 6-6a4 4 0 0 0 5-5.4l-2.6 2.6-2-2 2.6-2.6Z"/><path d="m15 15 5 5"/>',

    /* ---- status / alerts ---- */
    alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17.5v.5"/>',
    shieldCheck: '<path d="M12 3 5 6v6c0 4 3 6.5 7 8 4-1.5 7-4 7-8V6l-7-3Z"/><path d="m9.5 12 1.8 1.8L15 10"/>',
    shieldAlert: '<path d="M12 3 5 6v6c0 4 3 6.5 7 8 4-1.5 7-4 7-8V6l-7-3Z"/><path d="M12 9v3.5M12 15.5v.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.2 2.2L15.5 9.5"/>',
    xCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 14 18 8Z"/><path d="M10.5 20a1.8 1.8 0 0 0 3 0"/>',

    /* ---- money / analytics ---- */
    rupee: '<path d="M7 4h10M7 8h10M14.5 8c0 3-2.5 4.5-5.5 4.5H7l6.5 7"/>',
    trendUp: '<path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/>',
    trendDown: '<path d="M3 7l6 6 4-4 8 8"/><path d="M17 17h4v-4"/>',
    chartBar: '<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="7"/><rect x="12.5" y="7" width="3" height="11"/><rect x="18" y="13" width="3" height="5"/>',
    chartPie: '<path d="M12 3a9 9 0 1 0 9 9h-9V3Z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15V3.5Z"/>',
    receipt: '<path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21V3Z"/><path d="M9 8h6M9 12h6"/>',

    /* ---- actions ---- */
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z"/>',
    download: '<path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 20h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m14 6 4 4"/>',
    trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="M5 12.5 10 17.5 20 6.5"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    phone: '<path d="M6 3h3l1.5 5-2 1.5a12 12 0 0 0 6 6l1.5-2 5 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4 5.2 2 2 0 0 1 6 3Z"/>',
    mapPin: '<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    logout: '<path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 12h9M16 9l3 3-3 3"/>',
    building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    link: '<path d="M9 15 15 9"/><path d="M11 6.5 13 4.5a3.5 3.5 0 0 1 5 5l-2 2M13 17.5l-2 2a3.5 3.5 0 0 1-5-5l2-2"/>',
    engine: '<path d="M5 9h2V7h4l2 2h3v-2h2v2h2v4h-2v2h-2v2H9l-2-2H5v-2H3V9h2Z"/>',
    battery: '<rect x="3" y="8" width="16" height="9" rx="2"/><path d="M19 11h2v3h-2"/><path d="M7 11v3M11 11v3"/>',
    export: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4"/>'
  };

  /* aliases -> keep old callsites/semantics working */
  const ALIAS = {
    dashboard: "gauge", vehicle: "truck", drivers: "driver", diesel: "fuel",
    inspection: "clipboardCheck", issues: "wrench", jobcard: "wrench",
    maintenance: "calendarClock", parts: "boxes", spares: "boxes",
    ai: "brain", drishti: "brain", compliance: "shieldCheck",
    warranty: "shieldCheck", money: "rupee", cost: "rupee",
    analytics: "chartBar", reminder: "bell", reports: "chartBar",
    contacts: "driver", documents: "document", tools: "tools",
    charging: "charge", tyre: "tire"
  };

  function resolve(name) {
    if (P[name]) return name;
    if (ALIAS[name]) return ALIAS[name];
    return "chevronRight";
  }

  function FWIcon(name, opts) {
    opts = opts || {};
    const size = opts.size || 24;
    const cls = "fw-ic" + (opts.cls ? " " + opts.cls : "");
    const sw = opts.stroke || 2;
    return (
      '<svg class="' + cls + '" width="' + size + '" height="' + size + '" ' +
      'viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' + P[resolve(name)] + "</svg>"
    );
  }

  /* Hydrate any <i data-icon="..."> placeholders in the DOM. */
  function hydrate(root) {
    (root || document).querySelectorAll("[data-icon]").forEach(function (el) {
      if (el.dataset.fwHydrated) return;
      const name = el.getAttribute("data-icon");
      const size = parseInt(el.getAttribute("data-icon-size") || "0", 10) || undefined;
      const stroke = parseFloat(el.getAttribute("data-icon-stroke") || "0") || undefined;
      el.innerHTML = FWIcon(name, { size: size, stroke: stroke });
      el.dataset.fwHydrated = "1";
    });
  }

  window.FWIcon = FWIcon;
  window.FWIcons = { hydrate: hydrate, names: Object.keys(P), alias: ALIAS };

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", function () { hydrate(); });
  else hydrate();
})();
