/* ============ FleetWorks — payroll.js ============
   Payroll tab: driver bank/UPI payout setup + salary payments via Cashfree
   Payouts. Raw account numbers/UPI IDs never touch this file's own storage
   — they're POSTed once to the payroll-add-beneficiary edge function, which
   forwards them to Cashfree and returns only a masked display string. This
   file just renders driver_payout_details/salary_payments (both fetched
   live from Supabase, RLS-scoped to owner/manager) against the local
   db.drivers list for names. Requires sign-in — no offline/demo mode. */

"use strict";

let PAYOUTS = {}; // driver_ext_id -> row from driver_payout_details

function payrollSignedIn() { return !!(window.fwCloud && fwCloud.user()); }

async function renderPayroll() {
  const roster = document.getElementById("payrollRoster");
  const sel = document.getElementById("paySalaryDriver");
  if (!roster) return; // tab not in DOM yet

  if (!db.drivers.length) {
    roster.innerHTML = "<p class='muted'>Add drivers first — Fleet &rarr; Drivers &amp; Contacts.</p>";
    if (sel) sel.innerHTML = "";
    return;
  }
  if (!payrollSignedIn()) {
    roster.innerHTML = "<p class='muted'>Sign in to set up driver payouts and send salary payments.</p>";
    if (sel) sel.innerHTML = "";
    return;
  }

  const org = await (window.getMyOrgId ? getMyOrgId() : null);
  if (!org) {
    roster.innerHTML = "<p class='muted'>No organization found yet — save something once while signed in, then reload this tab.</p>";
    return;
  }

  const rows = await fwCloud.authGet("driver_payout_details", `select=*&org_id=eq.${org}`);
  if (rows === null) {
    roster.innerHTML = "<p class='muted'>Payroll needs <code>db/schema-payroll.sql</code> run once in Supabase.</p>";
    return;
  }
  PAYOUTS = Object.fromEntries(rows.map(r => [r.driver_ext_id, r]));

  roster.innerHTML = `<table class="chart-table-el"><thead><tr><th>Driver</th><th>Payout method</th><th>Status</th><th></th></tr></thead><tbody>` +
    db.drivers.map(d => {
      const p = PAYOUTS[d.id];
      const detail = !p ? "<span class='muted'>Not set up</span>"
        : p.method === "bank" ? `Bank •••• ${esc(p.bank_account_last4 || "")}`
        : `UPI ${esc(p.upi_id_masked || "")}`;
      const status = !p ? "" : `<span class="fw-badge ${p.beneficiary_status === "verified" ? "ok" : "soon"}">${esc(p.beneficiary_status)}</span>`;
      return `<tr><td>${esc(d.name)}</td><td>${detail}</td><td>${status}</td>
        <td><button type="button" class="link-btn" onclick="openPayoutModal('${esc(d.id)}','${esc(d.name)}')">${p ? "Update" : "Set up payout"}</button></td></tr>`;
    }).join("") + "</tbody></table>";

  if (sel) {
    const payable = db.drivers.filter(d => PAYOUTS[d.id]);
    sel.innerHTML = payable.length
      ? payable.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("")
      : `<option value="">Set up a driver's payout details first</option>`;
  }

  await renderPayrollHistory(org);
}

async function renderPayrollHistory(org) {
  const el = document.getElementById("payrollHistory");
  if (!el) return;
  const rows = await fwCloud.authGet("salary_payments", `select=*&org_id=eq.${org}&order=initiated_at.desc&limit=50`);
  if (!rows || !rows.length) { el.innerHTML = "<p class='muted'>No salary payments sent yet.</p>"; return; }
  el.innerHTML = `<table class="chart-table-el"><thead><tr><th>Date</th><th>Driver</th><th>Period</th><th>Amount</th><th>Method</th><th>Status</th><th>Ref</th></tr></thead><tbody>` +
    rows.map(r => {
      const d = db.drivers.find(x => x.id === r.driver_ext_id);
      const cls = r.status === "success" ? "ok" : r.status === "failed" ? "overdue" : "soon";
      return `<tr><td>${fmtDate(r.initiated_at)}</td><td>${esc(d ? d.name : r.driver_ext_id)}</td><td>${esc(r.period || "")}</td>
        <td>${fmtINR(r.amount)}</td><td>${esc(r.method || "")}</td>
        <td><span class="fw-badge ${cls}">${esc(r.status)}</span></td>
        <td title="${esc(r.failure_reason || "")}">${esc(r.utr || r.transfer_ref)}</td></tr>`;
    }).join("") + "</tbody></table>";
}

window.openPayoutModal = function (driverExtId, driverName) {
  const modal = document.getElementById("payoutModal");
  const form = document.getElementById("payoutForm");
  form.reset();
  form.driverExtId.value = driverExtId;
  form.driverName.value = driverName;
  document.getElementById("payoutModalTitle").textContent = "Set up payout — " + driverName;
  document.getElementById("payoutErr").hidden = true;
  togglePayoutMethod();
  modal.style.display = "flex";
};
function togglePayoutMethod() {
  const isBank = document.getElementById("payoutMethod").value === "bank";
  document.getElementById("payoutBankFields").hidden = !isBank;
  document.getElementById("payoutUpiFields").hidden = isBank;
}
document.getElementById("payoutMethod")?.addEventListener("change", togglePayoutMethod);
document.getElementById("payoutModalClose")?.addEventListener("click", () => { document.getElementById("payoutModal").style.display = "none"; });

document.getElementById("payoutForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const errEl = document.getElementById("payoutErr");
  errEl.hidden = true;
  const fd = Object.fromEntries(new FormData(e.target));
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    await fwCloud.callFunction("payroll-add-beneficiary", {
      driverExtId: fd.driverExtId, driverName: fd.driverName, method: fd.method,
      bankAccountNumber: fd.bankAccountNumber, bankIfsc: fd.bankIfsc, upiId: fd.upiId,
    });
    document.getElementById("payoutModal").style.display = "none";
    renderPayroll();
  } catch (ex) {
    errEl.textContent = ex.message || "Could not save payout details.";
    errEl.hidden = false;
  }
  btn.disabled = false;
});

document.getElementById("paySalaryForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const errEl = document.getElementById("paySalaryErr");
  errEl.hidden = true;
  const fd = Object.fromEntries(new FormData(e.target));
  if (!fd.driverExtId) { errEl.textContent = "Set up a driver's payout details first."; errEl.hidden = false; return; }
  const driver = db.drivers.find(d => d.id === fd.driverExtId);
  if (!confirm(`Send ${fmtINR(+fd.amount)} to ${driver ? driver.name : "this driver"} for ${fd.period}? This moves real money via Cashfree.`)) return;
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    const res = await fwCloud.callFunction("payroll-transfer", {
      driverExtId: fd.driverExtId, amount: +fd.amount, period: fd.period, notes: fd.notes,
    });
    alert(res.status === "success" ? "Payment sent successfully." : "Payment submitted — status: " + res.status);
    e.target.reset();
    renderPayroll();
  } catch (ex) {
    errEl.textContent = ex.message || "Could not send this payment.";
    errEl.hidden = false;
  }
  btn.disabled = false;
});

if (typeof renderAuthState === "function") {
  const _origRenderAuthStateForPayroll = renderAuthState;
  renderAuthState = function () {
    _origRenderAuthStateForPayroll();
    renderPayroll();
  };
}

renderPayroll();
