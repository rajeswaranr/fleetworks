/* ============ FleetWorks — garage-pay.js ============
   Workshop bank/UPI registration + payout history for garage.html.

   The raw account number / UPI ID is sent once to the vendor-add-beneficiary
   edge function and goes straight to Cashfree — this file never stores it.
   Only the masked display string + beneficiary status come back and are
   rendered here from vendor_payout_details (RLS-scoped to the garage user). */

"use strict";

(function () {

  /* ---- State ---- */
  let VPAYOUT = null;   // vendor_payout_details row for this garage, or null

  /* ---- Helpers ---- */
  function garageSignedIn() { return !!(window.fwCloud && fwCloud.user()); }

  function renderVpTile() {
    const tile = document.getElementById("gPayBankTile");
    if (!tile) return;
    if (!VPAYOUT) {
      tile.innerHTML = `
        <p class="muted">Register your bank or UPI details once — FleetWorks will credit your fortnightly payout directly to that account.</p>
        <button type="button" class="btn btn-primary" id="gPayBankOpenBtn"><i data-icon="rupee" data-icon-size="15"></i> Add Bank / UPI Details</button>`;
    } else {
      const p = VPAYOUT;
      const detail = p.method === "bank"
        ? `Current Account •••• ${p.bank_account_last4 || ""} &nbsp;·&nbsp; IFSC ${p.bank_ifsc || ""}`
        : `UPI ${p.upi_id_masked || ""}`;
      const statusCls = p.beneficiary_status === "verified" ? "ok" : "soon";
      tile.innerHTML = `
        <p><strong>${p.account_holder_name || "Workshop"}</strong> &nbsp;·&nbsp; ${detail}</p>
        ${p.gstin ? `<p class="muted" style="font-size:.85rem">GSTIN: ${p.gstin}</p>` : ""}
        <span class="fw-badge ${statusCls}">${p.beneficiary_status}</span>
        <button type="button" class="link-btn" id="gPayBankOpenBtn" style="margin-left:12px">Update</button>`;
    }
    document.getElementById("gPayBankOpenBtn")?.addEventListener("click", openBankModal);
  }

  async function loadVendorPayout() {
    if (!garageSignedIn()) return;
    const rows = await fwCloud.authGet("vendor_payout_details",
      `select=*&garage_user_id=eq.${fwCloud.user().id}&limit=1`
    ).catch(() => null);
    VPAYOUT = rows && rows.length ? rows[0] : null;
    renderVpTile();
    await loadPayoutHistory();
  }

  async function loadPayoutHistory() {
    const el = document.getElementById("gPayTable");
    if (!el) return;
    if (!garageSignedIn()) { el.innerHTML = "<p class='muted'>Sign in to view payout history.</p>"; return; }
    const rows = await fwCloud.authGet("vendor_payments",
      `select=*&garage_user_id=eq.${fwCloud.user().id}&order=initiated_at.desc&limit=40`
    ).catch(() => null);
    if (rows === null) { el.innerHTML = "<p class='muted'>Payout history unavailable.</p>"; return; }
    if (!rows.length) { el.innerHTML = "<p class='muted'>No payouts yet — they appear here after each fortnightly settlement.</p>"; return; }

    const fmt = (n) => typeof fmtINR === "function" ? fmtINR(n) : "₹" + Math.round(n).toLocaleString("en-IN");
    const fmtD = (d) => typeof fmtDate === "function" ? fmtDate(d) : d?.slice(0, 10);
    const cls = { success: "ok", failed: "overdue", reversed: "overdue", processing: "soon", pending: "soon" };
    el.innerHTML = `<table class="chart-table-el"><thead><tr>
      <th>Cycle</th><th>Gross</th><th>Platform Fee</th><th>Credited</th><th>Method</th><th>Status</th><th>UTR / Ref</th>
    </tr></thead><tbody>` + rows.map(r => `
      <tr>
        <td>${r.period || fmtD(r.initiated_at)}</td>
        <td>${fmt(r.gross_amount)}</td>
        <td>${fmt(r.platform_fee)} <span class="muted" style="font-size:.75rem">(10%)</span></td>
        <td><strong>${fmt(r.amount)}</strong></td>
        <td>${r.method || "—"}</td>
        <td><span class="fw-badge ${cls[r.status] || "soon"}">${r.status}</span></td>
        <td title="${r.failure_reason || ""}">${r.utr || r.transfer_ref}</td>
      </tr>`).join("") + "</tbody></table>";

    // Summary tiles
    const tiles = document.getElementById("gPayTiles");
    if (tiles) {
      const paid = rows.filter(r => r.status === "success").reduce((s, r) => s + (+r.amount || 0), 0);
      const pending = rows.filter(r => r.status === "processing" || r.status === "pending").reduce((s, r) => s + (+r.amount || 0), 0);
      tiles.innerHTML = `
        <div class="stat-card"><span class="stat-value">${fmt(paid)}</span><span class="stat-label">Total received</span></div>
        <div class="stat-card"><span class="stat-value">${fmt(pending)}</span><span class="stat-label">Pending</span></div>
        <div class="stat-card"><span class="stat-value">${rows.filter(r => r.status === "success").length}</span><span class="stat-label">Payouts completed</span></div>`;
    }
  }

  /* ---- Bank/UPI registration modal ---- */
  function openBankModal() {
    const modal = document.getElementById("gPayBankModal");
    const form  = document.getElementById("gPayBankForm");
    if (!modal || !form) return;
    form.reset();
    // Pre-fill from existing row
    if (VPAYOUT) {
      form.method.value = VPAYOUT.method || "bank";
      form.accountHolderName.value = VPAYOUT.account_holder_name || "";
      form.gstin.value = VPAYOUT.gstin || "";
    }
    toggleBankUpiFields();
    document.getElementById("gPayBankErr").hidden = true;
    modal.style.display = "flex";
  }

  function closeBankModal() {
    const modal = document.getElementById("gPayBankModal");
    if (modal) modal.style.display = "none";
  }

  function toggleBankUpiFields() {
    const method = document.getElementById("gPayBankMethod")?.value;
    const bankFields = document.getElementById("gPayBankBankFields");
    const upiFields  = document.getElementById("gPayBankUpiFields");
    if (bankFields) bankFields.hidden = method !== "bank";
    if (upiFields)  upiFields.hidden  = method !== "upi";
  }

  /* ---- Wire modal ---- */
  function initModal() {
    document.getElementById("gPayBankMethod")?.addEventListener("change", toggleBankUpiFields);
    document.getElementById("gPayBankModalClose")?.addEventListener("click", closeBankModal);

    document.getElementById("gPayBankForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("gPayBankErr");
      errEl.hidden = true;
      const fd = Object.fromEntries(new FormData(e.target));
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        await fwCloud.callFunction("vendor-add-beneficiary", {
          accountHolderName: fd.accountHolderName,
          method: fd.method,
          bankAccountNumber: fd.bankAccountNumber,
          bankIfsc: fd.bankIfsc,
          upiId: fd.upiId,
          gstin: fd.gstin,
        });
        closeBankModal();
        if (typeof toast === "function") toast("Bank details saved — payouts will land here each fortnight.", "ok");
        await loadVendorPayout();
      } catch (ex) {
        errEl.textContent = ex.message || "Could not save details.";
        errEl.hidden = false;
      }
      btn.disabled = false;
    });
  }

  /* ---- Init ---- */
  function init() {
    if (!document.getElementById("gPayTiles")) return;
    initModal();
    // Load when the Payments tab opens
    document.querySelectorAll('[data-tab="gpay"]').forEach((btn) =>
      btn.addEventListener("click", () => loadVendorPayout()));
    // Also load immediately if already on that tab
    if (document.getElementById("tab-gpay")?.classList.contains("active")) {
      loadVendorPayout();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

})();
