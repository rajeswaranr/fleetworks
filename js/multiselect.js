/* FWMultiSelect — the framework's multi-select dropdown.

     const ms = FWMultiSelect.mount(el, {
       options: [{ id, label, sub }],   // sub is optional secondary text
       selected: ["id1"],                // initially ticked ids
       placeholder: "Select one or more…",
       searchPlaceholder: "Search…",
       createLabel: "+ Create new",      // optional: adds a footer action
       onCreate: () => {},               // called when the footer action is clicked
       onChange: (idsArray) => {},
     });
     ms.getSelected() / ms.setSelected(ids) / ms.setOptions(options)

   Keyboard: Esc closes the list (without closing the dialog around it). */
(function () {
  "use strict";
  if (window.FWMultiSelect) return;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var CHEVRON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

  function mount(el, cfg) {
    var options = cfg.options || [], selected = new Set(cfg.selected || []), open = false;
    el.classList.add("fw-multi");
    el.innerHTML =
      '<button type="button" class="fw-multi-trigger" aria-haspopup="listbox" aria-expanded="false"><span class="fw-multi-label"></span>' + CHEVRON + '</button>' +
      '<div class="fw-multi-panel" role="listbox" aria-multiselectable="true" hidden>' +
        '<input type="search" class="fw-multi-search" placeholder="' + esc(cfg.searchPlaceholder || "Search…") + '" aria-label="Search" />' +
        '<div class="fw-multi-list"></div>' +
        (cfg.createLabel ? '<button type="button" class="fw-multi-create">' + esc(cfg.createLabel) + '</button>' : "") +
      '</div>';
    var trigger = el.querySelector(".fw-multi-trigger"), label = el.querySelector(".fw-multi-label"),
        panel = el.querySelector(".fw-multi-panel"), search = el.querySelector(".fw-multi-search"), list = el.querySelector(".fw-multi-list");

    function summary() {
      var n = selected.size;
      if (!n) return '<span class="fw-multi-placeholder">' + esc(cfg.placeholder || "Select…") + "</span>";
      var names = options.filter(function (o) { return selected.has(o.id); }).map(function (o) { return o.label; });
      return names.length <= 2 ? esc(names.join(", ")) : esc(names.slice(0, 2).join(", ")) + " +" + (names.length - 2) + " more";
    }
    function renderList() {
      var q = search.value.trim().toLowerCase();
      var shown = options.filter(function (o) { return !q || (o.label + " " + (o.sub || "")).toLowerCase().indexOf(q) >= 0; });
      list.innerHTML = shown.length ? shown.map(function (o) {
        return '<label class="fw-multi-opt"><input type="checkbox" value="' + esc(o.id) + '"' + (selected.has(o.id) ? " checked" : "") + ' />' +
          '<span><span class="fw-multi-opt-label">' + esc(o.label) + '</span>' + (o.sub ? '<small>' + esc(o.sub) + '</small>' : "") + '</span></label>';
      }).join("") : '<p class="fw-multi-empty">' + (options.length ? "No match." : "Nothing to choose yet.") + '</p>';
    }
    function refresh() { label.innerHTML = summary(); renderList(); }
    function setOpen(v) {
      open = v; panel.hidden = !v; trigger.setAttribute("aria-expanded", v ? "true" : "false");
      if (v) { search.value = ""; renderList(); setTimeout(function () { search.focus(); }, 0); }
    }
    function changed() { label.innerHTML = summary(); if (cfg.onChange) cfg.onChange(Array.from(selected)); }

    trigger.addEventListener("click", function () { setOpen(!open); });
    search.addEventListener("input", renderList);
    list.addEventListener("change", function (e) {
      var cb = e.target;
      if (cb.type !== "checkbox") return;
      if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
      changed();
    });
    var create = el.querySelector(".fw-multi-create");
    if (create) create.addEventListener("click", function () { setOpen(false); if (cfg.onCreate) cfg.onCreate(); });
    document.addEventListener("mousedown", function (e) { if (open && !el.contains(e.target)) setOpen(false); });
    el.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); trigger.focus(); }
    }, true);
    // Esc is also handled at document level by window-controls; capture on the document too.
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && open) { e.stopImmediatePropagation(); setOpen(false); }
    }, true);

    refresh();
    return {
      getSelected: function () { return Array.from(selected); },
      setSelected: function (ids) { selected = new Set(ids); refresh(); if (cfg.onChange) cfg.onChange(Array.from(selected)); },
      setOptions: function (opts) { options = opts; refresh(); }
    };
  }

  window.FWMultiSelect = { mount: mount };
})();
