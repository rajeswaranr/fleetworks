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

// Every early-return path below must still leave `sel` (the automated-
// payment driver dropdown) in a clear, explained state — an untouched
// <select> just looks like a bug ("driver name isn't in the dropdown")
// rather than "you haven't set up automated payouts yet".
function setSelUnavailable(sel, btn, message) {
  if (sel) sel.innerHTML = `<option value="">${esc(message)}</option>`;
  if (btn) btn.disabled = true;
}

async function renderPayroll() {
  const roster = document.getElementById("payrollRoster");
  const sel = document.getElementById("paySalaryDriver");
  const sendBtn = document.querySelector("#paySalaryForm button[type=submit]");
  const manualSel = document.getElementById("manualSalaryDriver");
  if (!roster) return; // tab not in DOM yet

  renderApprovals(); // independent of the Cashfree roster below — never blocked by its early returns

  if (manualSel) {
    manualSel.innerHTML = db.drivers.length
      ? db.drivers.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("")
      : `<option value="">Add a driver first</option>`;
    updatePayNowHint();
  }

  if (!db.drivers.length) {
    roster.innerHTML = "<p class='muted'>Add drivers first — Fleet &rarr; Drivers &amp; Contacts.</p>";
    setSelUnavailable(sel, sendBtn, "Add a driver first");
    return;
  }
  if (!payrollSignedIn()) {
    roster.innerHTML = "<p class='muted'>Sign in to set up automated payouts.</p>";
    setSelUnavailable(sel, sendBtn, "Sign in first");
    return;
  }

  const org = await (window.getMyOrgId ? getMyOrgId() : null);
  if (!org) {
    roster.innerHTML = "<p class='muted'>No organization found yet — save something once while signed in, then reload this tab.</p>";
    setSelUnavailable(sel, sendBtn, "Sign in and save something first");
    return;
  }

  const rows = await fwCloud.authGet("driver_payout_details", `select=*&org_id=eq.${org}`);
  if (rows === null) {
    roster.innerHTML = "<p class='muted'>Payroll needs <code>db/schema-payroll.sql</code> run once in Supabase.</p>";
    setSelUnavailable(sel, sendBtn, "Not set up in Supabase yet");
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
        <td><button type="button" class="link-btn" onclick="openPayoutModal(${escAttr(JSON.stringify(d.id))},${escAttr(JSON.stringify(d.name))})">${p ? "Update" : "Set up payout"}</button></td></tr>`;
    }).join("") + "</tbody></table>";

  const payable = db.drivers.filter(d => PAYOUTS[d.id]);
  if (sel) {
    if (payable.length) {
      sel.innerHTML = payable.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("");
      if (sendBtn) sendBtn.disabled = false;
    } else {
      setSelUnavailable(sel, sendBtn, "No driver set up for automated payouts yet — use 'Set up payout' above");
    }
  }

  await renderPayrollHistory(org);
}

async function renderPayrollHistory(org) {
  const el = document.getElementById("payrollHistory");
  if (!el) return;
  const rows = await fwCloud.authGet("salary_payments", `select=*&org_id=eq.${org}&order=initiated_at.desc&limit=50`);
  if (!rows || !rows.length) { el.innerHTML = "<p class='muted'>No salary payments logged yet.</p>"; return; }
  el.innerHTML = `<table class="chart-table-el"><thead><tr><th>Date</th><th>Driver</th><th>Period</th><th>Amount</th><th>Method</th><th>Source</th><th>Status</th><th>Ref</th></tr></thead><tbody>` +
    rows.map(r => {
      const d = db.drivers.find(x => x.id === r.driver_ext_id);
      const cls = r.status === "success" ? "ok" : r.status === "failed" ? "overdue" : "soon";
      return `<tr><td>${fmtDate(r.initiated_at)}</td><td>${esc(d ? d.name : r.driver_ext_id)}</td><td>${esc(r.period || "")}</td>
        <td>${fmtINR(r.amount)}</td><td>${esc(r.method || "")}</td>
        <td>${r.source === "manual" ? "<span class='fw-badge upcoming'>Manual</span>" : "<span class='fw-badge ok'>Cashfree</span>"}</td>
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
    toast("Payout details saved.");
  } catch (ex) {
    errEl.textContent = ex.message || "Could not save payout details.";
    errEl.hidden = false;
  }
  btn.disabled = false;
});

// ---------- Pay Now via UPI (opens the owner's own UPI app — GPay/PhonePe/
// Paytm/BHIM all handle upi:// links — no gateway, no account, the owner
// just confirms the payment themselves like normal) + a scannable QR code
// of the same link (same idea as Razorpay's free public QR generator —
// encode the standard NPCI upi://pay URI as a QR image — but generated
// locally with an open-source library instead of depending on their site
// or requiring any account) for when it's easier to scan from a phone
// while managing payroll on a laptop. ----------
function buildUpiLink(vpa, name, amount, note) {
  if (window.FWPayments && FWPayments.buildUpiLink) return FWPayments.buildUpiLink(vpa, name, amount, note);
  const params = new URLSearchParams({ pa: vpa, pn: name, am: String(amount), cu: "INR" });
  if (note) params.set("tn", note.slice(0, 50));
  return "upi://pay?" + params.toString();
}
let qrcodeLoading = null;
function loadQrCode() {
  if (window.QRCode) return Promise.resolve();
  if (!qrcodeLoading) qrcodeLoading = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js";
    s.onload = res;
    s.onerror = () => { qrcodeLoading = null; rej(new Error("Could not load the QR code generator — check your internet connection.")); };
    document.head.appendChild(s);
  });
  return qrcodeLoading;
}
function updatePayNowHint() {
  const hint = document.getElementById("payNowUpiHint");
  const sel = document.getElementById("manualSalaryDriver");
  if (!hint || !sel) return;
  const driver = db.drivers.find(d => d.id === sel.value);
  hint.textContent = driver && !driver.upiId
    ? `${driver.name} has no UPI ID on file — add one in Drivers & Contacts to enable one-tap pay.`
    : "";
  renderUpiQr();
  renderBankInfo();
}
async function renderUpiQr() {
  const box = document.getElementById("payNowUpiQr");
  if (!box) return;
  const form = document.getElementById("manualSalaryForm");
  const driver = db.drivers.find(d => d.id === form.driverExtId.value);
  const amount = +form.amount.value || 0;
  if (!driver || !driver.upiId || !amount) { box.innerHTML = ""; return; }
  const note = (form.notes.value || "Salary " + (form.period.value || "")).trim();
  const link = buildUpiLink(driver.upiId, driver.name, amount, note);
  try {
    await loadQrCode();
    box.innerHTML = `<div id="payNowUpiQrImg" style="width:180px;height:180px;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0"></div><p class="muted" style="font-size:0.78rem;margin-top:4px">Scan with any UPI app to pay ${esc(fmtINR(amount))}</p>`;
    new QRCode(document.getElementById("payNowUpiQrImg"), { text: link, width: 178, height: 178, correctLevel: QRCode.CorrectLevel.M });
  } catch {
    box.innerHTML = "";
  }
}
// Bank transfer has no UPI-style "scan and it opens pre-filled" standard —
// this QR (and the copyable text next to it) just carries the account
// holder/number/IFSC as plain text, so a NEFT/IMPS transfer can be filled
// in without retyping (and risking a typo) — not a one-tap payment.
function buildBankInfoText(driver) {
  return `Account Holder: ${driver.name}\nAccount Number: ${driver.bankAccount}\nIFSC: ${driver.bankIfsc}`;
}
async function renderBankInfo() {
  const box = document.getElementById("payNowBankInfo");
  if (!box) return;
  const form = document.getElementById("manualSalaryForm");
  const driver = db.drivers.find(d => d.id === form.driverExtId.value);
  if (!driver || !driver.bankAccount || !driver.bankIfsc) { box.innerHTML = ""; return; }
  const text = buildBankInfoText(driver);
  let qrHtml = "";
  try {
    await loadQrCode();
    qrHtml = `<div id="payNowBankQrImg" style="width:180px;height:180px;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0"></div>`;
  } catch { /* QR is a nice-to-have here — the copyable text still works without it */ }
  box.innerHTML = `${qrHtml}
    <div class="chart-card" style="padding:10px;margin-top:${qrHtml ? "8px" : "0"};font-size:0.82rem;white-space:pre-line">${esc(text)}</div>
    <button type="button" class="link-btn" id="copyBankInfoBtn" style="margin-top:4px">${FWIcon("document", { size: 13 })} Copy for NEFT/IMPS</button>`;
  if (qrHtml) new QRCode(document.getElementById("payNowBankQrImg"), { text, width: 178, height: 178, correctLevel: QRCode.CorrectLevel.M });
  document.getElementById("copyBankInfoBtn")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); toast("Bank details copied."); }
    catch { toast("Could not copy — select the text above manually.", "err"); }
  });
}
// ---------- Payment Approvals (owner-UPI flow) ----------
// Queue a payment -> owner sees it pending -> "Approve & Pay" opens the
// owner's own UPI app pre-filled (driver's UPI + amount) -> owner authorises
// with their UPI PIN -> "Mark Paid" closes the request and logs it to the
// books. FleetWorks never moves money itself here — the owner's UPI app is
// the payment rail AND the approval step, which is why no gateway/KYC is
// needed. Requires db/schema-payment-approvals.sql run once.
async function renderApprovals() {
  const list = document.getElementById("payApprovalsList");
  const sel = document.getElementById("payReqDriver");
  if (!list) return;
  if (sel) {
    sel.innerHTML = db.drivers.length
      ? db.drivers.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("")
      : `<option value="">Add a driver first</option>`;
  }
  if (!payrollSignedIn()) { list.innerHTML = "<p class='muted'>Sign in to use payment approvals.</p>"; return; }
  const org = await (window.getMyOrgId ? getMyOrgId() : null);
  if (!org) { list.innerHTML = "<p class='muted'>No organization found yet.</p>"; return; }
  const rows = await fwCloud.authGet("payment_requests", `select=*&org_id=eq.${org}&status=eq.pending&order=created_at.asc`);
  if (rows === null) { list.innerHTML = "<p class='muted'>Payment approvals need <code>db/schema-payment-approvals.sql</code> run once in Supabase.</p>"; return; }
  const ownerUpi = (db.settings && db.settings.ownerUpi) || "";
  const head = ownerUpi
    ? `<p class="muted" style="font-size:0.8rem">Approvals are paid from your UPI: <strong>${esc(ownerUpi)}</strong></p>`
    : `<p class="muted" style="font-size:0.8rem">Tip: set your Owner UPI ID in Settings so payment records carry it.</p>`;
  if (!rows.length) { list.innerHTML = head + "<p class='muted'>No payments waiting for approval.</p>"; return; }
  list.innerHTML = head + `<table class="chart-table-el"><thead><tr><th>Driver</th><th>Period</th><th>Amount</th><th>Note</th><th></th></tr></thead><tbody>` +
    rows.map(r => {
      const d = db.drivers.find(x => x.id === r.driver_ext_id);
      const name = d ? d.name : r.driver_ext_id;
      const noUpi = d && !d.upiId;
      return `<tr><td>${esc(name)}</td><td>${esc(r.period || "")}</td><td><strong>${fmtINR(r.amount)}</strong></td>
        <td>${esc(r.note || "")}</td>
        <td style="white-space:nowrap">
          <button type="button" class="link-btn" onclick="approveAndPay(${escAttr(JSON.stringify(r.id))})" ${noUpi ? `title="${esc(name)} has no UPI ID on file — add one in Drivers & Contacts"` : ""}>${FWIcon("rupee", { size: 14 })} Approve &amp; Pay</button>
          <button type="button" class="link-btn" onclick="markRequestPaid(${escAttr(JSON.stringify(r.id))})">${FWIcon("check", { size: 14 })} Mark Paid</button>
          <button type="button" class="link-btn" style="color:#b91c1c" onclick="rejectRequest(${escAttr(JSON.stringify(r.id))})">Reject</button>
        </td></tr>`;
    }).join("") + "</tbody></table>";
  list.dataset.rows = JSON.stringify(rows);
}

function findRequest(id) {
  const list = document.getElementById("payApprovalsList");
  try { return (JSON.parse(list.dataset.rows || "[]")).find(r => r.id === id) || null; } catch { return null; }
}

// Opens the owner's UPI app (mobile) with the payment pre-filled — the
// approve + PIN step happens there — and renders a scan QR for desktop.
window.approveAndPay = async function (id) {
  const r = findRequest(id);
  if (!r) return;
  const d = db.drivers.find(x => x.id === r.driver_ext_id);
  if (!d) { toast("Driver not found.", "err"); return; }
  if (!d.upiId) { toast(`${d.name} has no UPI ID on file — add one in Drivers & Contacts.`, "err"); return; }
  const note = (r.note || `Salary ${r.period || ""}`).trim();
  const link = buildUpiLink(d.upiId, d.name, r.amount, note);
  const qrBox = document.getElementById("payApproveQr");
  if (qrBox) {
    try {
      await loadQrCode();
      qrBox.innerHTML = `<div class="chart-card" style="padding:12px;max-width:260px">
        <p style="font-size:0.85rem;margin-bottom:8px"><strong>${esc(d.name)}</strong> · ${fmtINR(r.amount)}<br>
        <span class="muted" style="font-size:0.78rem">Approve in your UPI app — or scan from your phone:</span></p>
        <div id="payApproveQrImg" style="width:180px;height:180px;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0"></div>
        <button type="button" class="btn btn-primary btn-sm" style="margin-top:10px" onclick="markRequestPaid(${escAttr(JSON.stringify(r.id))})">${FWIcon("check", { size: 14 })} Paid — record it</button>
        <button type="button" class="link-btn" style="margin-left:8px" onclick="document.getElementById('payApproveQr').innerHTML=''">Close</button>
      </div>`;
      new QRCode(document.getElementById("payApproveQrImg"), { text: link, width: 178, height: 178, correctLevel: QRCode.CorrectLevel.M });
    } catch { /* QR optional — the intent link below still fires */ }
  }
  window.location.href = link; // no-op on desktop without a UPI handler; opens the app chooser on mobile
};

window.markRequestPaid = async function (id) {
  const r = findRequest(id);
  if (!r) return;
  const utr = prompt("UPI Ref / UTR from your UPI app (optional — OK to leave blank):", "") || "";
  const ok = await fwCloud.authPatch(`payment_requests?id=eq.${id}`, {
    status: "paid", utr: utr.trim() || null, decided_at: new Date().toISOString(),
  });
  if (!ok) { toast("Could not update — check your connection and try again.", "err"); return; }
  // Best-effort books entry: salary_payments exists only once schema-payroll.sql has been run.
  const org = await (window.getMyOrgId ? getMyOrgId() : null);
  if (org) {
    await fwCloud.authInsert("salary_payments", {
      org_id: org, driver_ext_id: r.driver_ext_id, period: r.period, amount: +r.amount,
      method: "upi", source: "manual", status: "success",
      utr: utr.trim() || null, notes: r.note || null,
      transfer_ref: "apr" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      initiated_by: fwCloud.uid(),
    }).catch(() => {});
  }
  const qrBox = document.getElementById("payApproveQr");
  if (qrBox) qrBox.innerHTML = "";
  toast("Payment recorded.");
  renderPayroll();
};

window.rejectRequest = async function (id) {
  if (!confirm("Reject this payment request?")) return;
  const ok = await fwCloud.authPatch(`payment_requests?id=eq.${id}`, { status: "rejected", decided_at: new Date().toISOString() });
  if (!ok) { toast("Could not update — check your connection and try again.", "err"); return; }
  toast("Request rejected.");
  renderPayroll();
};

document.getElementById("payReqForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const errEl = document.getElementById("payReqErr");
  errEl.hidden = true;
  if (!payrollSignedIn()) { errEl.textContent = "Sign in first."; errEl.hidden = false; return; }
  const fd = Object.fromEntries(new FormData(e.target));
  try {
    const ok = window.FWHex
      ? await FWHex.run("payments.createPaymentRequest", fd)
      : await fwCloud.authInsert("payment_requests", {
        org_id: await (window.getMyOrgId ? getMyOrgId() : null),
        driver_ext_id: fd.driverExtId,
        amount: +fd.amount,
        period: fd.period,
        note: (fd.note || "").trim() || null,
        requested_by: fwCloud.uid(),
      });
    if (ok) { e.target.reset(); toast("Queued — approve it from the list below (or your phone)."); renderPayroll(); }
    else { errEl.textContent = "Could not queue — has db/schema-payment-approvals.sql been run in Supabase?"; errEl.hidden = false; }
  } catch (ex) {
    errEl.textContent = ex.message || "Could not queue this payment request.";
    errEl.hidden = false;
  }
});

document.getElementById("manualSalaryDriver")?.addEventListener("change", updatePayNowHint);
document.getElementById("manualSalaryForm")?.addEventListener("input", e => {
  if (["amount", "notes", "period"].includes(e.target.name)) renderUpiQr();
});
document.getElementById("payNowUpiBtn")?.addEventListener("click", () => {
  const form = document.getElementById("manualSalaryForm");
  const hint = document.getElementById("payNowUpiHint");
  const driver = db.drivers.find(d => d.id === form.driverExtId.value);
  if (!driver) { hint.textContent = "Pick a driver first."; return; }
  if (!driver.upiId) { hint.textContent = `${driver.name} has no UPI ID on file — add one in Drivers & Contacts.`; return; }
  const amount = +form.amount.value || 0;
  if (!amount) { hint.textContent = "Enter an amount first."; return; }
  const note = (form.notes.value || "Salary " + (form.period.value || "")).trim();
  hint.textContent = "Opening your UPI app… or scan the QR code below from your phone.";
  window.location.href = buildUpiLink(driver.upiId, driver.name, amount, note);
});

document.getElementById("manualSalaryForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const errEl = document.getElementById("manualSalaryErr");
  errEl.hidden = true;
  if (!payrollSignedIn()) { errEl.textContent = "Sign in first."; errEl.hidden = false; return; }
  const fd = Object.fromEntries(new FormData(e.target));
  if (!fd.driverExtId) { errEl.textContent = "Add a driver first."; errEl.hidden = false; return; }
  const org = await (window.getMyOrgId ? getMyOrgId() : null);
  if (!org) { errEl.textContent = "No organization found yet — save something once while signed in, then retry."; errEl.hidden = false; return; }
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  const ok = await fwCloud.authInsert("salary_payments", {
    org_id: org, driver_ext_id: fd.driverExtId, period: fd.period, amount: +fd.amount,
    method: fd.method, source: "manual", status: "success",
    utr: (fd.utr || "").trim() || null, notes: (fd.notes || "").trim() || null,
    transfer_ref: "man" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    initiated_by: fwCloud.uid(),
  });
  if (ok) { e.target.reset(); renderPayroll(); toast("Payment logged to your books."); }
  else { errEl.textContent = "Could not save this payment — check your connection and try again."; errEl.hidden = false; }
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
