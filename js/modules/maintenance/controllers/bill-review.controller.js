/* ============ FleetWorks — maintenance/bill-review controller ============
   The missing half of a feature that was already built. The bill-review edge
   function has been deployed and correct for a while: it reads a job card's
   line items, compares each against this fleet's own history, and returns an
   assessment. Nothing ever wrote work_order_lines, so it had nothing to read
   and no caller. This is the entry form and the results panel.

   WHY LINE ITEMS AND NOT A TOTAL. Closing a job card used to ask for one
   number via prompt(). A single total cannot be checked against anything —
   "Rs 48,000" is neither high nor low without knowing it contains two
   diagnostic charges and a clutch plate replaced four months ago. Every
   detector in the function keys off line_type and description, so the form has
   to collect them.

   THE ORDER MATTERS. Review runs BEFORE the job card closes, because the point
   is to catch a bad line while you can still dispute it. Closing the card
   writes the expense into the books; by then the argument is over.

   SIGNED-IN ONLY. The review compares against the fleet's history in Postgres
   and the function authenticates the caller against a real JWT. Offline and
   demo fleets keep the old prompt() flow — see completeWorkOrder in fleet.js.
   A local id is not a uuid, so there is nothing to send. */

(function () {
  "use strict";

  const LINE_TYPES = ["part", "labour", "diagnostic", "consumable", "tax", "other"];

  let billWO = null;      // the work order being billed
  let billRows = [];      // [{line_type, description, part_number, qty, unit_rate, amount, hours}]
  let lastReview = null;  // the bill_reviews row returned by the function

  const $ = (id) => document.getElementById(id);
  const money = (n) => (typeof fmtINR === "function" ? fmtINR(n) : "₹" + Math.round(n).toLocaleString("en-IN"));
  const _esc = (v) => (typeof esc === "function" ? esc(v) : String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  const _escAttr = (v) => (typeof escAttr === "function" ? escAttr(v) : _esc(v));

  function blankRow() {
    return { line_type: "part", description: "", part_number: "", qty: 1, unit_rate: "", amount: "", hours: "" };
  }

  /* Amount is derived from qty x rate while both are present, but stays
     editable: workshop bills round, bundle and discount, and a form that
     refuses the number actually printed on the paper is a form people abandon. */
  function recalcRow(i) {
    const r = billRows[i];
    const q = parseFloat(r.qty), u = parseFloat(r.unit_rate);
    if (isFinite(q) && isFinite(u)) r.amount = +(q * u).toFixed(2);
  }

  function billTotal() {
    return billRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  }

  function renderLines() {
    $("billLines").innerHTML = `
      <div class="chart-table" style="overflow-x:auto">
        <table style="width:100%;min-width:640px">
          <thead><tr>
            <th>Type</th><th>Description</th><th>Part no.</th>
            <th style="width:70px">Qty</th><th style="width:100px">Rate</th>
            <th style="width:110px">Amount</th><th style="width:34px"></th>
          </tr></thead>
          <tbody>${billRows.map((r, i) => `
            <tr>
              <td><select data-bill="line_type" data-i="${i}">${LINE_TYPES.map(t =>
                `<option value="${t}"${r.line_type === t ? " selected" : ""}>${t[0].toUpperCase() + t.slice(1)}</option>`).join("")}</select></td>
              <td><input type="text" data-bill="description" data-i="${i}" value="${_escAttr(r.description)}" placeholder="e.g. Clutch plate assembly" /></td>
              <td><input type="text" data-bill="part_number" data-i="${i}" value="${_escAttr(r.part_number)}" placeholder="optional" /></td>
              <td><input type="number" min="0" step="any" data-bill="qty" data-i="${i}" value="${_escAttr(r.qty)}" /></td>
              <td><input type="number" min="0" step="any" data-bill="unit_rate" data-i="${i}" value="${_escAttr(r.unit_rate)}" /></td>
              <td><input type="number" min="0" step="any" data-bill="amount" data-i="${i}" value="${_escAttr(r.amount)}" /></td>
              <td><button type="button" class="link-btn" data-bill-del="${i}" title="Remove line">&times;</button></td>
            </tr>`).join("")}</tbody>
        </table>
      </div>`;
    $("billTotal").textContent = money(billTotal());
  }

  /* Delegated so the handlers survive every re-render of the table. */
  function bindLineEvents() {
    const host = $("billLines");
    host.addEventListener("input", (e) => {
      const f = e.target.getAttribute("data-bill");
      if (!f) return;
      const i = +e.target.getAttribute("data-i");
      billRows[i][f] = e.target.value;
      if (f === "qty" || f === "unit_rate") { recalcRow(i); renderLines(); }
      else $("billTotal").textContent = money(billTotal());
    });
    host.addEventListener("change", (e) => {
      const f = e.target.getAttribute("data-bill");
      if (f === "line_type") billRows[+e.target.getAttribute("data-i")].line_type = e.target.value;
    });
    host.addEventListener("click", (e) => {
      const d = e.target.getAttribute("data-bill-del");
      if (d === null) return;
      billRows.splice(+d, 1);
      if (!billRows.length) billRows.push(blankRow());
      renderLines();
    });
  }

  function openBillEntry(woId) {
    const w = db.workOrders.find((x) => x.id === woId);
    if (!w) return;
    billWO = w;
    billRows = [blankRow(), blankRow(), blankRow()];
    lastReview = null;
    $("billSub").textContent =
      `${typeof vName === "function" ? vName(w.vehicleId) : ""} — ${w.title}` +
      (w.vendor ? ` at ${w.vendor}` : "") +
      (w.estCost ? ` · estimate ${money(w.estCost)}` : "");
    $("billErr").hidden = true;
    $("billCategory").value = "";
    $("billReviewOut").innerHTML = "";
    renderLines();
    $("billModal").style.display = "flex";
  }

  function closeBill() { $("billModal").style.display = "none"; billWO = null; lastReview = null; }

  function fail(msg) { const e = $("billErr"); e.textContent = msg; e.hidden = false; }

  /* Only lines with both a description and an amount are real. Blank spare rows
     are scaffolding, not data, and must never reach the table — a zero-amount
     line would skew the fleet's own price history that later reviews rely on. */
  function usableRows() {
    return billRows.filter((r) => String(r.description).trim() && parseFloat(r.amount) > 0);
  }

  async function saveLines() {
    const rows = usableRows();
    if (!rows.length) { fail("Add at least one line with a description and an amount."); return null; }

    // Replace rather than append, so re-checking an edited bill does not leave
    // the previous attempt's lines behind and double the total.
    await fwCloud.authDelete("work_order_lines", `work_order_id=eq.${billWO.id}`).catch(() => { });

    const org = await dbOrgId();
    if (!org) { fail("Could not identify your fleet account — try signing in again."); return null; }
    const payload = rows.map((r, n) => ({
      org_id: org, work_order_id: billWO.id, line_no: n + 1,
      line_type: r.line_type || "part",
      description: String(r.description).trim(),
      part_number: String(r.part_number || "").trim() || null,
      qty: parseFloat(r.qty) || 1,
      unit_rate: parseFloat(r.unit_rate) || null,
      amount: parseFloat(r.amount),
      hours: r.line_type === "labour" && parseFloat(r.hours) ? parseFloat(r.hours) : null,
    }));
    const ok = await fwCloud.authInsert("work_order_lines", payload);
    if (!ok) { fail(fwCloud.lastError() || "Could not save the bill lines."); return null; }
    return rows;
  }

  const SEV = { high: "is-danger", medium: "is-pending", low: "is-info" };

  /* Renders the assessment the way the function reports it: the verdict, how
     much of the fleet's own history it drew on, and every finding with its
     evidence. source_count is shown because "review required" backed by 40 past
     jobs and by 1 are different claims and the reader deserves to tell them
     apart. */
  function renderReview(rv) {
    const badge = rv.assessment === "approve" ? "is-success" : rv.assessment === "reject" ? "is-danger" : "is-pending";
    const label = rv.assessment === "approve" ? "Looks fine" : rv.assessment === "reject" ? "Do not pay yet" : "Review required";
    const findings = Array.isArray(rv.findings) ? rv.findings : [];
    $("billReviewOut").innerHTML = `
      <div class="chart-card" style="margin-top:16px;background:var(--surface-2, #f7f9fc)">
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
          <span class="fw-chip ${badge}"><span class="dot"></span>${label}</span>
          <span class="muted">Confidence: <strong>${_esc(rv.confidence)}</strong></span>
          <span class="muted">Sources: <strong>${rv.source_count}</strong> past line${rv.source_count === 1 ? "" : "s"}</span>
        </div>
        ${rv.summary ? `<p style="margin:12px 0 0">${_esc(rv.summary)}</p>` : ""}
        ${findings.length ? `<div style="margin-top:12px">${findings.map((f) => `
          <div class="pred-row">
            <div class="pred-main"><span class="fw-chip ${SEV[f.severity] || "is-info"}"><span class="dot"></span>${_esc(f.severity || "info")}</span> <strong>${_esc(f.title || f.code || "Finding")}</strong></div>
            <div class="pred-detail"><span>${_esc(f.detail || "")}</span></div>
          </div>`).join("")}</div>`
        : `<p class="muted" style="margin-top:10px">No issues found against this fleet's own history.</p>`}
        ${rv.source_count < 3 ? `<p class="muted" style="margin-top:10px">Only ${rv.source_count} comparable line${rv.source_count === 1 ? "" : "s"} in your history so far — price checks get sharper as you record more bills.</p>` : ""}
        <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
          <button type="button" class="btn btn-outline btn-sm" data-outcome="accepted">Accept the bill</button>
          <button type="button" class="btn btn-outline btn-sm" data-outcome="disputed">Mark as disputed</button>
          <button type="button" class="btn btn-outline btn-sm" data-outcome="overridden">Pay anyway (override)</button>
        </div>
        <p class="muted" style="margin-top:8px;font-size:.85rem">FleetWorks does not approve, reject or pay anything on its own — this is a second pair of eyes on the paperwork.</p>
      </div>`;
  }

  async function runCheck() {
    $("billErr").hidden = true;
    const btn = $("billCheckBtn");
    const saved = await saveLines();
    if (!saved) return;
    btn.disabled = true; btn.textContent = "Checking…";
    try {
      const rv = await fwCloud.authFn("bill-review", { workOrderId: billWO.id });
      if (!rv || rv.error) { fail((rv && rv.error) || "Could not run the review."); return; }
      lastReview = rv.review || rv;
      renderReview(lastReview);
    } catch (ex) {
      fail(ex.message || "Could not reach the review service.");
    } finally {
      btn.disabled = false; btn.textContent = "Re-check this bill";
    }
  }

  async function recordOutcome(outcome) {
    if (!lastReview || !lastReview.id) return;
    const ok = await fwCloud.authPatch(`bill_reviews?id=eq.${lastReview.id}`, {
      outcome, outcome_at: new Date().toISOString(),
    });
    if (typeof toast === "function") {
      toast(ok ? "Recorded — the job card keeps this decision." : "Could not save that decision.", ok ? "ok" : "err");
    }
  }

  /* Closing the card is deliberately still the owner's separate action, and it
     reuses the existing completion path so the expense, the issue status and
     the Tally export all behave exactly as before. */
  async function closeJobFromBill() {
    if (!billWO) return;
    const rows = usableRows();
    if (!rows.length) { fail("Add at least one line before closing the job card."); return; }
    const total = billTotal();
    if (!confirm(`Close this job card and record ${money(total)} as an expense?`)) return;
    const el = $("billCloseJobBtn");
    el.disabled = true;
    try {
      const cat = ($("billCategory").value || "").trim();
      await window.completeWorkOrderWithTotal(billWO.id, total, cat || "Other");
      closeBill();
    } catch (ex) {
      fail(ex.message || "Could not close the job card.");
    } finally { el.disabled = false; }
  }

  function init() {
    if (!$("billModal")) return;
    bindLineEvents();
    $("billAddLine").addEventListener("click", () => { billRows.push(blankRow()); renderLines(); });
    $("billCheckBtn").addEventListener("click", runCheck);
    $("billCloseJobBtn").addEventListener("click", closeJobFromBill);
    $("billCancel").addEventListener("click", closeBill);
    $("billReviewOut").addEventListener("click", (e) => {
      const o = e.target.getAttribute("data-outcome");
      if (o) recordOutcome(o);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.openBillEntry = openBillEntry;
})();
