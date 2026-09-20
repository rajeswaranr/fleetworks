/* Guards against controls whose fixed height leaves no room for their text.
   Selects and inputs get 11px of vertical padding from the base stylesheet; if a
   page or dialog also gives one a small fixed height (e.g. 28px), the padding
   eats the box and the selected value looks blank. Any control found in that
   state has its vertical padding removed, which centres the text instead.
   Runs on load and for anything added later (dialogs, dynamic panels). */
(function () {
  "use strict";
  var SKIP = /^(checkbox|radio|range|file|color|hidden|image|submit|button|reset)$/;

  function fix(el) {
    if (el.tagName === "INPUT" && SKIP.test(el.type)) return;
    var cs = getComputedStyle(el);
    if (cs.display === "none" || !el.offsetParent) return;
    var font = parseFloat(cs.fontSize) || 14;
    var room = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (room < font * 1.2 && el.clientHeight > 0) {
      el.style.setProperty("padding-top", "0", "important");
      el.style.setProperty("padding-bottom", "0", "important");
    }
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches("select,input")) fix(root);
    var list = root.querySelectorAll ? root.querySelectorAll("select,input") : [];
    for (var i = 0; i < list.length; i++) fix(list[i]);
  }

  var pending = [], timer = null;
  function flush() {
    timer = null;
    var batch = pending; pending = [];
    batch.forEach(scan);
  }

  function start() {
    scan(document.body);
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) { if (n.nodeType === 1) pending.push(n); });
        if (m.type === "attributes") pending.push(m.target);
      });
      if (!timer) timer = setTimeout(flush, 60);
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });
    // Dialogs are shown by toggling display on an existing element.
    document.addEventListener("click", function () { setTimeout(function () { scan(document.body); }, 120); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
