/* FWDialog — the app's one dialog box, replacing the browser's native alert()
   and confirm(). Built from the same framework parts as every other window
   (cards, .btn buttons, FWIcon icons) and picks up minimize / maximize / close
   from js/window-controls.js automatically.

     await FWDialog.alert("Saved.");                       // resolves when dismissed
     if (await FWDialog.confirm("Delete this?", { danger: true })) { ... }

   Native alert() is routed here, so existing calls get the framework look with
   no code change. confirm() has to return synchronously, so it cannot be
   swapped in place: use `await FWDialog.confirm(...)` instead. Dialogs queue
   rather than stack. Closing with the window's ✕, Esc or Cancel is "no". */
(function () {
  "use strict";
  if (window.FWDialog) return;

  var css = [
    '.fw-dialog-overlay{position:fixed;inset:0;z-index:900;background:rgba(11,22,38,.65);display:flex;align-items:center;justify-content:center;padding:16px}',
    '.fw-dialog{max-width:440px;width:100%;box-sizing:border-box;margin:0}',
    '.fw-dialog .fw-dialog-title{display:flex;align-items:center;gap:10px;margin:0 0 10px;font-size:1.15rem;padding-right:104px}',
    '.fw-dialog .fw-dialog-ic{display:inline-flex;flex:none;width:34px;height:34px;align-items:center;justify-content:center;border-radius:10px;background:var(--bg-alt,#f1f5f9);color:var(--navy,#0f1e33)}',
    '.fw-dialog.is-danger .fw-dialog-ic{background:#fee2e2;color:#b91c1c}',
    '.fw-dialog .fw-dialog-body{color:var(--ink,#1c2733);font-size:.95rem;line-height:1.55;max-height:50vh;overflow-y:auto;word-break:break-word}',
    '.fw-dialog .fw-dialog-body p{margin:0 0 8px}',
    '.fw-dialog .fw-dialog-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px;flex-wrap:wrap}'
  ].join('\n');
  var style = document.createElement('style');
  style.setAttribute('data-fw-dialogs', '');
  style.textContent = css;
  document.head.appendChild(style);

  var queue = [], busy = false;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function paragraphs(msg) {
    return String(msg == null ? "" : msg).split(/\n{2,}/).map(function (block) {
      return "<p>" + esc(block).replace(/\n/g, "<br>") + "</p>";
    }).join("");
  }
  function icon(name) {
    return typeof window.FWIcon === "function" ? window.FWIcon(name, { size: 18 }) : "";
  }
  function looksDestructive(msg) { return /\b(delete|remove|permanent|cannot be undone|discard|clear|wipe|archive)\b/i.test(msg); }

  function next() {
    if (busy || !queue.length) return;
    busy = true;
    var job = queue.shift(), opts = job.opts;
    var restoreTo = document.activeElement;
    var overlay = document.createElement("div");
    overlay.className = "fw-dialog-overlay";
    overlay.setAttribute("role", job.kind === "confirm" ? "alertdialog" : "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("data-fw-window", "");
    var danger = !!opts.danger;
    overlay.innerHTML =
      '<div class="chart-card fw-dialog' + (danger ? " is-danger" : "") + '">' +
        '<h2 class="fw-dialog-title"><span class="fw-dialog-ic">' + icon(danger ? "trash" : job.kind === "confirm" ? "shieldCheck" : "alert") + '</span><span>' + esc(opts.title) + '</span></h2>' +
        '<div class="fw-dialog-body">' + paragraphs(job.message) + '</div>' +
        '<div class="fw-dialog-actions">' +
          (job.kind === "confirm" ? '<button type="button" class="btn btn-outline" data-close data-answer="no">' + esc(opts.cancelText) + '</button>' : '') +
          '<button type="button" class="btn ' + (danger ? "btn-danger" : "btn-primary") + '" data-answer="yes">' + esc(opts.confirmText) + '</button>' +
        '</div>' +
      '</div>';
    if (job.kind === "alert") overlay.querySelector('[data-answer="yes"]').setAttribute("data-close", "");
    document.body.appendChild(overlay);

    function finish(answer) {
      if (!overlay.parentNode) return;
      overlay.remove();
      try { if (restoreTo && restoreTo.focus) restoreTo.focus(); } catch (e) { }
      busy = false;
      job.resolve(answer);
      next();
    }
    overlay.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-answer]");
      if (b) finish(b.getAttribute("data-answer") === "yes");
    });
    // The window's own close (✕) button and Esc go through the same "no" path.
    var mo = new MutationObserver(function () { if (!document.body.contains(overlay)) { mo.disconnect(); } });
    mo.observe(document.body, { childList: true });
    var primary = overlay.querySelector('[data-answer="yes"]');
    setTimeout(function () { if (primary) primary.focus(); }, 0);
  }

  function enqueue(kind, message, o) {
    o = o || {};
    var opts = {
      title: o.title || (kind === "confirm" ? "Please confirm" : "FleetWorks"),
      confirmText: o.confirmText || (kind === "confirm" ? "Confirm" : "OK"),
      cancelText: o.cancelText || "Cancel",
      danger: o.danger != null ? o.danger : (kind === "confirm" && looksDestructive(String(message)))
    };
    if (opts.danger && kind === "confirm" && !o.confirmText) opts.confirmText = "Yes, continue";
    return new Promise(function (resolve) { queue.push({ kind: kind, message: message, opts: opts, resolve: resolve }); next(); });
  }

  window.FWDialog = {
    alert: function (message, opts) { return enqueue("alert", message, opts).then(function () { return undefined; }); },
    confirm: function (message, opts) { return enqueue("confirm", message, opts); }
  };

  // Existing alert() calls get the framework dialog. It does not block, which
  // is fine for a notification; code that needs an answer must use confirm.
  window.nativeAlert = window.alert;
  window.alert = function (message) { window.FWDialog.alert(message); };
})();
