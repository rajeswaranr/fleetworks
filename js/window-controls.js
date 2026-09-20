/* Window controls for every dialog: minimize, maximize/restore, close, top right.

   Dialogs are found automatically, so existing and future ones need no code:
     - any element whose id ends in "Modal"
     - .modal-overlay
     - [role="dialog"] / [aria-modal="true"]
     - anything marked data-fw-window
   The dialog's window is the overlay's first visible element child. Add
   data-no-window-controls to an overlay to opt out.

   Minimize docks the window as a small bar at the bottom-left (its state is
   kept, so a half-filled form is still there on restore). Maximize fills the
   screen. Close uses the dialog's own close/cancel button when it has one (so
   the app's cleanup still runs), otherwise it hides the overlay. Esc closes
   the top-most open window. */
(function () {
  "use strict";
  if (window.__fwWindowControls) return;
  window.__fwWindowControls = true;

  var SELECTOR = '[id$="Modal"], .modal-overlay, [role="dialog"], [aria-modal="true"], [data-fw-window]';
  var TITLE_SEL = 'h1, h2, h3, .modal-title, [id$="Title"]';
  var CLOSE_SEL = '.modal-close, [data-close], [id$="Close"], [id$="Cancel"], button[aria-label="Close"]';
  var ICON = {
    min: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 11.5h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
    max: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>',
    restore: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3" y="5.5" width="7.5" height="7.5" rx="1.3" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M6 5.5V4.3A1.3 1.3 0 0 1 7.3 3H12a1 1 0 0 1 1 1v4.7A1.3 1.3 0 0 1 11.7 10H10.5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
    close: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>'
  };

  var css = [
    '.fw-winbar{position:absolute;top:10px;right:12px;display:flex;align-items:center;gap:4px;z-index:20;font-family:inherit}',
    '.fw-winbar .fw-win-title{display:none;font-size:.82rem;font-weight:600;color:var(--ink,#1c2733);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 6px}',
    '.fw-winbar button{all:unset;box-sizing:border-box;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;color:var(--muted,#64748b);background:transparent;transition:background .12s,color .12s}',
    '.fw-winbar button:hover{background:var(--bg-alt,#f1f5f9);color:var(--ink,#1c2733)}',
    '.fw-winbar button:focus-visible{outline:2px solid var(--amber,#f5a623);outline-offset:1px}',
    '.fw-winbar button.fw-win-close:hover{background:#fee2e2;color:#b91c1c}',
    '.fw-panel{position:relative}',
    '.fw-has-winbar > .fw-winbar + :is(h1,h2,h3,h4,.modal-title,.chart-head){padding-right:104px}',
    '.fw-panel .modal-close{display:none !important}',
    /* maximised */
    '.fw-win-max{padding:8px !important;align-items:stretch !important;justify-content:stretch !important}',
    '.fw-win-max > .fw-panel{max-width:none !important;width:100% !important;height:calc(100vh - 16px) !important;max-height:none !important;margin:0 !important;overflow-y:auto !important;border-radius:12px !important;transform:none !important}',
    /* minimised: a small bar docked bottom-left, page stays usable behind it */
    '.fw-win-min{top:auto !important;right:auto !important;bottom:12px !important;width:auto !important;height:auto !important;padding:0 !important;background:transparent !important;backdrop-filter:none !important;overflow:visible !important;pointer-events:none !important;opacity:1 !important;z-index:400 !important}',
    '.fw-win-min > .fw-panel{pointer-events:auto;width:auto !important;max-width:none !important;height:auto !important;min-height:0 !important;margin:0 !important;padding:4px 6px !important;overflow:hidden !important;border-radius:12px !important;box-shadow:0 8px 24px rgba(11,22,38,.28);border:1px solid var(--line,#e2e8f0);background:#fff !important;transform:none !important}',
    '.fw-win-min > .fw-panel > *:not(.fw-winbar){display:none !important}',
    '.fw-win-min .fw-winbar{position:static}',
    '.fw-win-min .fw-winbar .fw-win-title{display:block}',
    '.fw-win-min .fw-winbar .fw-win-btn-min,.fw-win-min .fw-winbar .fw-win-btn-max{display:none}'
  ].join('\n');
  var style = document.createElement('style');
  style.setAttribute('data-fw-window-controls', '');
  style.textContent = css;
  document.head.appendChild(style);

  var minimized = [];

  function panelOf(overlay) {
    var kids = overlay.children;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.tagName === 'SCRIPT' || k.tagName === 'STYLE' || k.classList.contains('fw-winbar')) continue;
      return k;
    }
    return null;
  }

  function isOpen(overlay) {
    var cs = getComputedStyle(overlay);
    if (cs.display === 'none' || cs.visibility === 'hidden' || overlay.hidden) return false;
    if (overlay.classList.contains('modal-overlay')) return overlay.classList.contains('open');
    return cs.opacity !== '0' && cs.pointerEvents !== 'none' || overlay.classList.contains('fw-win-min');
  }

  function titleOf(overlay) {
    var panel = panelOf(overlay), t = panel && panel.querySelector(TITLE_SEL);
    return (t && t.textContent.trim()) || 'Window';
  }

  function layoutMinimized() {
    minimized = minimized.filter(function (o) { return o.classList.contains('fw-win-min'); });
    minimized.forEach(function (o, i) { o.style.setProperty('left', (12 + i * 250) + 'px', 'important'); });
  }

  function setState(overlay, state) {
    var panel = panelOf(overlay); if (!panel) return;
    overlay.classList.toggle('fw-win-max', state === 'max');
    overlay.classList.toggle('fw-win-min', state === 'min');
    var bar = panel.querySelector(':scope > .fw-winbar');
    if (bar) {
      bar.querySelector('.fw-win-title').textContent = titleOf(overlay);
      var mx = bar.querySelector('.fw-win-btn-max');
      mx.innerHTML = state === 'max' ? ICON.restore : ICON.max;
      var lbl = state === 'max' ? 'Restore size' : 'Maximize'; mx.title = lbl; mx.setAttribute('aria-label', lbl);
    }
    if (state === 'min') { if (minimized.indexOf(overlay) < 0) minimized.push(overlay); }
    else { overlay.style.removeProperty('left'); }
    layoutMinimized();
  }

  function reset(overlay) { if (overlay.classList.contains('fw-win-max') || overlay.classList.contains('fw-win-min')) setState(overlay, 'normal'); }

  function closeWindow(overlay) {
    reset(overlay);
    var own = null, list = overlay.querySelectorAll(CLOSE_SEL);
    for (var i = 0; i < list.length; i++) { if (!list[i].closest('.fw-winbar')) { own = list[i]; break; } }
    if (own) { own.click(); return; }
    if (overlay.classList.contains('open')) overlay.classList.remove('open');
    overlay.hidden = true;
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
  }

  function enhance(overlay) {
    if (overlay.hasAttribute('data-no-window-controls') || overlay.__fwWin) return;
    var panel = panelOf(overlay); if (!panel) return;
    if (panel.querySelector(':scope > .fw-winbar')) { overlay.__fwWin = true; return; }
    overlay.__fwWin = true;
    panel.classList.add('fw-panel', 'fw-has-winbar');
    var bar = document.createElement('div');
    bar.className = 'fw-winbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Window controls');
    bar.innerHTML = '<span class="fw-win-title"></span>' +
      '<button type="button" class="fw-win-btn-min" title="Minimize" aria-label="Minimize">' + ICON.min + '</button>' +
      '<button type="button" class="fw-win-btn-max" title="Maximize" aria-label="Maximize">' + ICON.max + '</button>' +
      '<button type="button" class="fw-win-close" title="Close" aria-label="Close">' + ICON.close + '</button>';
    panel.insertBefore(bar, panel.firstChild);
    bar.addEventListener('click', function (e) { e.stopPropagation(); });
    bar.querySelector('.fw-win-btn-min').addEventListener('click', function () { setState(overlay, 'min'); });
    bar.querySelector('.fw-win-btn-max').addEventListener('click', function () { setState(overlay, overlay.classList.contains('fw-win-max') ? 'normal' : 'max'); });
    bar.querySelector('.fw-win-close').addEventListener('click', function () { closeWindow(overlay); });
    // A minimised bar restores when its title is clicked.
    bar.querySelector('.fw-win-title').addEventListener('click', function () { setState(overlay, 'normal'); });
    bar.querySelector('.fw-win-title').style.cursor = 'pointer';
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches(SELECTOR)) enhance(root);
    var list = root.querySelectorAll ? root.querySelectorAll(SELECTOR) : [];
    for (var i = 0; i < list.length; i++) enhance(list[i]);
  }

  // When the app closes a window itself (display:none / class removed), forget
  // any minimised or maximised state so it reopens at normal size.
  function sweepClosed() {
    document.querySelectorAll('.fw-win-min, .fw-win-max').forEach(function (o) {
      if (o.classList.contains('fw-win-min') && o.classList.contains('modal-overlay') && !o.classList.contains('open')) reset(o);
      else if (getComputedStyle(o).display === 'none' || o.hidden) reset(o);
    });
  }

  function start() {
    scan(document.body);
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        if (m.type === 'childList') { m.addedNodes.forEach(scan); var host = m.target.closest && m.target.closest(SELECTOR); if (host) enhance(host); }
        else if (m.target.matches && m.target.matches(SELECTOR)) enhance(m.target);
      });
      sweepClosed();
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var open = [].slice.call(document.querySelectorAll(SELECTOR)).filter(function (o) { return o.__fwWin && isOpen(o) && !o.classList.contains('fw-win-min'); });
      if (!open.length) return;
      open.sort(function (a, b) { return (parseInt(getComputedStyle(b).zIndex, 10) || 0) - (parseInt(getComputedStyle(a).zIndex, 10) || 0); });
      closeWindow(open[0]);
    });
  }

  window.FWWindows = { scan: scan, close: closeWindow };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
