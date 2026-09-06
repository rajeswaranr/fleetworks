/* ============ FleetWorks — invoicing controller ============
   The other direction of the bill book. gstbills captures what the fleet pays;
   this is what it bills customers for moving their goods.

   THE TAX SPLIT IS THE WHOLE JOB. Two rules decide what a freight invoice says,
   and both are easy to get wrong in a way nobody notices until an audit:

   1. Reverse charge. Goods transport is very often billed under RCM, where the
      RECIPIENT pays the GST and the invoice itself carries none. It is an
      explicit choice on the document, never inferred, because being wrong in
      either direction is a real tax problem.

   2. Intra-state versus inter-state. Same state means CGST + SGST, split evenly;
      different states means IGST. The state is the first two digits of the
      GSTIN, so it comes off the document rather than a dropdown someone forgot.

   Everything is computed in paise with round-half-up and stored, never
   recalculated for display — two screens must not disagree about what a
   customer owes. */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const _esc = (v) => (typeof esc === "function" ? esc(v) : String(v == null ? "" : v));
  const _escAttr = (v) => (typeof escAttr === "function" ? escAttr(v) : _esc(v));
  const money = (n) => (typeof fmtINR === "function" ? fmtINR(n) : "₹" + Math.round(n).toLocaleString("en-IN"));

  const RATES = { rcm: 0, forward_5: 5, forward_12: 12, forward_18: 18, exempt: 0 };
  const TREATMENT_LABEL = {
    rcm: "Reverse charge — recipient pays GST",
    forward_5: "5% (no input credit)",
    forward_12: "12% (with input credit)",
    forward_18: "18%",
    exempt: "Exempt / nil rated",
  };

  let INVOICES = [];
  let invLines = [];

  /* A GSTIN's first two characters are the state code. Everything about the
     CGST/SGST-versus-IGST decision hangs on them. */
  function stateOf(gstin) {
    const g = String(gstin || "").trim();
    return /^\d{2}/.test(g) ? g.slice(0, 2) : null;
  }

  /* GSTIN format and checksum.

     15 characters: two state digits, a ten-character PAN, an entity digit, a
     fixed 'Z', then a check character. The checksum is a published algorithm,
     so a typo can be caught at entry rather than on a document a customer's
     accountant will reject. Weight alternates 1,2 across the first fourteen;
     each product contributes its quotient and remainder over 36.

     Format-invalid and checksum-invalid are reported separately: the first is
     "you mistyped", the second is "this looks right but isn't". */
  const GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

  function gstinCheckChar(first14) {
    let hash = 0;
    for (let i = 0; i < 14; i++) {
      const v = GST_CHARS.indexOf(first14[i]);
      if (v < 0) return null;
      const p = v * (i % 2 === 0 ? 1 : 2);
      hash += Math.floor(p / 36) + (p % 36);
    }
    return GST_CHARS[(36 - (hash % 36)) % 36];
  }

  // Returns null when it is fine, or a message explaining what is wrong.
  function gstinProblem(gstin) {
    const g = String(gstin || "").trim().toUpperCase();
    if (!g) return null;                       // unregistered is legitimate
    if (g.length !== 15) return "A GSTIN is 15 characters — that one is " + g.length + ".";
    if (!GSTIN_RE.test(g)) return "That doesn't look like a GSTIN (2 state digits, PAN, entity code, Z, check character).";
    const expected = gstinCheckChar(g.slice(0, 14));
    if (expected && g[14] !== expected) return "That GSTIN's check character doesn't match — likely a typo.";
    return null;
  }

  /* Round half up, in paise. JavaScript's Math.round already rounds .5 upward
     for positive numbers, but doing it on rupees would drop the paise a tax
     return is reconciled on. */
  const paise = (n) => Math.round((Number(n) || 0) * 100) / 100;

  /* The document's own arithmetic, given the amounts and the two states.
     Exported for the tests, because this is the part that must not drift. */
  function invoiceTax(taxableTotal, treatment, supplierState, placeOfSupply) {
    const taxable = paise(taxableTotal);
    const rate = RATES[treatment] ?? 0;
    if (!rate) return { taxable, cgst: 0, sgst: 0, igst: 0, total: taxable, rate: 0 };

    const tax = paise(taxable * rate / 100);
    // Unknown place of supply is treated as intra-state, matching the common
    // case of a local consignor, and the form asks for it whenever the customer
    // has no GSTIN to read it from.
    const interState = !!(supplierState && placeOfSupply && supplierState !== placeOfSupply);
    if (interState) return { taxable, cgst: 0, sgst: 0, igst: tax, total: paise(taxable + tax), rate };

    // Split evenly, then give any odd paise to CGST so the halves still sum to
    // the tax exactly. 5% of 1000.10 must not lose a paisa to rounding twice.
    const half = paise(tax / 2);
    const other = paise(tax - half);
    return { taxable, cgst: other, sgst: half, igst: 0, total: paise(taxable + tax), rate };
  }

  /* Next number in the fleet's own series. Reads the highest trailing number it
     has issued rather than counting rows, so deleting a draft never reissues a
     number that already went to a customer. */
  function nextInvoiceNo() {
    const year = new Date().getFullYear();
    const prefix = `INV/${year}/`;
    const used = INVOICES
      .map((i) => String(i.invoice_no || ""))
      .filter((n) => n.startsWith(prefix))
      .map((n) => parseInt(n.slice(prefix.length), 10))
      .filter(Number.isFinite);
    const next = (used.length ? Math.max(...used) : 0) + 1;
    return prefix + String(next).padStart(4, "0");
  }

  const blankLine = () => ({ description: "", sac_code: "996511", qty: 1, rate: "", amount: "" });

  function linesTotal() {
    return invLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  }

  function renderLines() {
    $("invLines").innerHTML = `
      <div class="chart-table" style="overflow-x:auto">
        <table style="width:100%;min-width:620px">
          <thead><tr>
            <th>Description</th><th style="width:110px">SAC</th>
            <th style="width:70px">Qty</th><th style="width:110px">Rate</th>
            <th style="width:120px">Amount</th><th style="width:34px"></th>
          </tr></thead>
          <tbody>${invLines.map((l, i) => `
            <tr>
              <td><input type="text" data-inv="description" data-i="${i}" list="invItemList" value="${_escAttr(l.description)}" placeholder="e.g. Freight Chennai to Salem, 18 MT" /></td>
              <td><input type="text" data-inv="sac_code" data-i="${i}" value="${_escAttr(l.sac_code)}" /></td>
              <td><input type="number" min="0" step="any" data-inv="qty" data-i="${i}" value="${_escAttr(l.qty)}" /></td>
              <td><input type="number" min="0" step="any" data-inv="rate" data-i="${i}" value="${_escAttr(l.rate)}" /></td>
              <td><input type="number" min="0" step="any" data-inv="amount" data-i="${i}" value="${_escAttr(l.amount)}" /></td>
              <td><button type="button" class="link-btn" data-inv-del="${i}">&times;</button></td>
            </tr>`).join("")}</tbody>
        </table>
      </div>`;
    renderTotals();
  }

  function currentTax() {
    const f = $("invoiceForm");
    if (!f) return invoiceTax(0, "rcm", null, null);
    const supplier = stateOf((db.settings && db.settings.gstin) || "");
    const pos = stateOf(f.elements.customerGstin.value) || (f.elements.placeOfSupply.value || "").trim() || null;
    return invoiceTax(linesTotal(), f.elements.taxTreatment.value, supplier, pos);
  }

  function renderTotals() {
    const t = currentTax();
    const f = $("invoiceForm");
    const treatment = f ? f.elements.taxTreatment.value : "rcm";
    $("invTotals").innerHTML = `
      <div style="text-align:right;line-height:1.9">
        <div>Taxable value: <strong>${money(t.taxable)}</strong></div>
        ${t.igst ? `<div>IGST @ ${t.rate}%: <strong>${money(t.igst)}</strong></div>` : ""}
        ${t.cgst ? `<div>CGST @ ${t.rate / 2}%: <strong>${money(t.cgst)}</strong></div>` : ""}
        ${t.sgst ? `<div>SGST @ ${t.rate / 2}%: <strong>${money(t.sgst)}</strong></div>` : ""}
        <div style="font-size:1.15rem;margin-top:6px">Invoice total: <strong>${money(t.total)}</strong></div>
        ${treatment === "rcm" ? `<p class="muted" style="font-size:.8rem;margin-top:6px">GST payable by the recipient under reverse charge — this invoice carries none.</p>` : ""}
      </div>`;
  }

  /* ---------- Parties and items: the two masters behind an invoice ---------- */

  let PARTIES = [];
  let ITEMS = [];

  async function loadMasters() {
    if (!(typeof coreDbBacked === "function" && coreDbBacked())) { PARTIES = []; ITEMS = []; renderMasters(); return; }
    try {
      const org = await dbOrgId();
      if (!org) { PARTIES = []; ITEMS = []; renderMasters(); return; }
      [PARTIES, ITEMS] = await Promise.all([
        fwCloud.authGet("parties", `select=*&org_id=eq.${org}&is_active=eq.true&order=name`).then(r => r || []),
        fwCloud.authGet("items", `select=*&org_id=eq.${org}&is_active=eq.true&order=name`).then(r => r || []),
      ]);
    } catch { PARTIES = []; ITEMS = []; }
    renderMasters();
  }

  function renderMasters() {
    // Customer picker on the invoice form. Choosing one fills the GSTIN, the
    // place of supply and the usual tax treatment, which is the whole point of
    // keeping a master.
    const sel = $("invParty");
    if (sel) {
      const keep = sel.value;
      sel.innerHTML = '<option value="">— type a new customer below —</option>' +
        PARTIES.filter(p => p.is_customer).map(p => `<option value="${_escAttr(p.id)}">${_esc(p.name)}${p.gstin ? " · " + _esc(p.gstin) : ""}</option>`).join("");
      if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
    }
    const dl = $("invItemList");
    if (dl) dl.innerHTML = ITEMS.map(i => `<option value="${_escAttr(i.name)}"></option>`).join("");

    const pl = $("partyList");
    if (pl) {
      pl.innerHTML = PARTIES.length
        ? `<table class="chart-table-el"><thead><tr><th>Name</th><th>GSTIN</th><th>State</th><th>Type</th><th>Credit</th><th></th></tr></thead><tbody>` +
          PARTIES.map(p => `<tr>
            <td><strong>${_esc(p.name)}</strong>${p.phone ? `<br /><span class="muted" style="font-size:.75rem">${_esc(p.phone)}</span>` : ""}</td>
            <td>${_esc(p.gstin || "—")}</td>
            <td>${_esc(p.state_code || "—")}</td>
            <td>${p.is_customer ? "Customer" : ""}${p.is_customer && p.is_supplier ? " + " : ""}${p.is_supplier ? "Supplier" : ""}</td>
            <td>${p.credit_limit ? money(+p.credit_limit) + (p.credit_days ? ` · ${p.credit_days}d` : "") : "—"}</td>
            <td><button class="link-btn" data-party-del="${_escAttr(p.id)}">Remove</button></td>
          </tr>`).join("") + "</tbody></table>"
        : "<p class='muted'>No parties yet — add the customers you invoice.</p>";
    }
    const il = $("itemList");
    if (il) {
      il.innerHTML = ITEMS.length
        ? `<table class="chart-table-el"><thead><tr><th>Item / service</th><th>HSN / SAC</th><th>Unit</th><th>Rate</th><th>GST</th><th></th></tr></thead><tbody>` +
          ITEMS.map(i => `<tr>
            <td><strong>${_esc(i.name)}</strong> <span class="muted" style="font-size:.75rem">${_esc(i.kind)}</span></td>
            <td>${_esc(i.hsn_sac || "—")}</td><td>${_esc(i.unit || "—")}</td>
            <td>${i.rate == null ? "—" : money(+i.rate)}</td><td>${_esc(i.gst_rate ?? 0)}%</td>
            <td><button class="link-btn" data-item-del="${_escAttr(i.id)}">Remove</button></td>
          </tr>`).join("") + "</tbody></table>"
        : "<p class='muted'>No items yet — add the services you bill for.</p>";
    }
  }

  /* Choosing a saved customer fills the fields that decide the tax split, so
     they are never retyped differently on two invoices for the same party. */
  function applyParty(id) {
    const f = $("invoiceForm");
    const p = PARTIES.find(x => x.id === id);
    if (!f || !p) return;
    f.elements.customerName.value = p.name || "";
    f.elements.customerGstin.value = p.gstin || "";
    f.elements.placeOfSupply.value = p.state_code || "";
    f.elements.customerAddress.value = p.billing_address || "";
    if (p.default_tax_treatment) f.elements.taxTreatment.value = p.default_tax_treatment;
    renderTotals();
  }

  async function saveParty(e) {
    e.preventDefault();
    const err = $("partyErr"); err.hidden = true;
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    if (!(typeof coreDbBacked === "function" && coreDbBacked())) return fail("Sign in to keep a customer list.");
    const f = e.target;
    const gstin = f.elements.gstin.value.trim().toUpperCase();
    // Validate before it can reach an invoice, not after a customer rejects one.
    const problem = gstinProblem(gstin);
    if (problem) return fail(problem);
    const org = await dbOrgId();
    if (!org) return fail("Could not identify your fleet account.");
    const ok = await fwCloud.authInsert("parties", {
      org_id: org, name: f.elements.name.value.trim(),
      is_customer: f.elements.isCustomer.checked, is_supplier: f.elements.isSupplier.checked,
      gstin: gstin || null,
      state_code: stateOf(gstin) || f.elements.stateCode.value.trim() || null,
      billing_address: f.elements.billingAddress.value.trim() || null,
      phone: f.elements.phone.value.trim() || null,
      email: f.elements.email.value.trim() || null,
      credit_limit: f.elements.creditLimit.value ? +f.elements.creditLimit.value : null,
      credit_days: f.elements.creditDays.value ? +f.elements.creditDays.value : null,
      default_tax_treatment: f.elements.defaultTax.value || null,
    });
    if (!ok) return fail(fwCloud.lastError() || "Could not save — that GSTIN may already be on your list.");
    f.reset(); f.elements.isCustomer.checked = true;
    await loadMasters();
    if (typeof toast === "function") toast("Customer saved.");
  }

  async function saveItem(e) {
    e.preventDefault();
    const err = $("itemErr"); err.hidden = true;
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    if (!(typeof coreDbBacked === "function" && coreDbBacked())) return fail("Sign in to keep an item list.");
    const f = e.target;
    const org = await dbOrgId();
    if (!org) return fail("Could not identify your fleet account.");
    const ok = await fwCloud.authInsert("items", {
      org_id: org, name: f.elements.name.value.trim(), kind: f.elements.kind.value,
      hsn_sac: f.elements.hsnSac.value.trim() || null,
      unit: f.elements.unit.value.trim() || "Nos",
      rate: f.elements.rate.value ? +f.elements.rate.value : null,
      gst_rate: f.elements.gstRate.value ? +f.elements.gstRate.value : 0,
    });
    if (!ok) return fail(fwCloud.lastError() || "Could not save — an item with that name may already exist.");
    f.reset();
    await loadMasters();
    if (typeof toast === "function") toast("Item saved.");
  }

  async function removeMaster(table, id, label) {
    if (!confirm(`Remove this ${label}? Invoices already raised keep their own copy.`)) return;
    const ok = await fwCloud.authPatch(`${table}?id=eq.${id}`, { is_active: false });
    if (ok) await loadMasters();
    if (typeof toast === "function") toast(ok ? `${label} removed.` : "Could not remove that.", ok ? "ok" : "err");
  }

  async function loadInvoices() {
    if (!(typeof coreDbBacked === "function" && coreDbBacked())) { INVOICES = []; renderInvoices(); return; }
    try {
      const org = await dbOrgId();
      if (!org) { INVOICES = []; renderInvoices(); return; }
      INVOICES = await fwCloud.authGet("sales_invoices",
        `select=*&org_id=eq.${org}&order=invoice_date.desc&limit=200`) || [];
    } catch { INVOICES = []; }
    renderInvoices();
  }

  const STATUS_CHIP = { draft: "is-pending", issued: "is-info", paid: "is-success", cancelled: "is-danger" };

  function renderInvoices() {
    const el = $("invoiceList");
    if (!el) return;
    if (!INVOICES.length) { el.innerHTML = "<p class='muted'>No invoices yet — raise one above.</p>"; return; }
    const outstanding = INVOICES.filter((i) => i.status === "issued").reduce((s, i) => s + (+i.total || 0), 0);
    const paid = INVOICES.filter((i) => i.status === "paid").reduce((s, i) => s + (+i.total || 0), 0);
    const tiles = $("invoiceTiles");
    if (tiles) tiles.innerHTML = `
      <div class="stat-tile"><span class="stat-label">Invoices</span><span class="stat-value">${INVOICES.length}</span><span class="stat-sub">this account</span></div>
      <div class="stat-tile"><span class="stat-label">Awaiting payment</span><span class="stat-value">${money(outstanding)}</span><span class="stat-sub">issued, not yet paid</span></div>
      <div class="stat-tile"><span class="stat-label">Collected</span><span class="stat-value">${money(paid)}</span><span class="stat-sub">marked paid</span></div>`;

    el.innerHTML = `<table class="chart-table-el"><thead><tr>
      <th>Invoice</th><th>Customer</th><th>Date</th><th>Tax</th><th>Total</th><th>Status</th><th></th>
      </tr></thead><tbody>` + INVOICES.map((i) => `
      <tr>
        <td><strong>${_esc(i.invoice_no)}</strong>${i.lr_no ? `<br /><span class="muted" style="font-size:.75rem">LR ${_esc(i.lr_no)}</span>` : ""}</td>
        <td>${_esc(i.customer_name)}${i.customer_gstin ? `<br /><span class="muted" style="font-size:.75rem">${_esc(i.customer_gstin)}</span>` : ""}</td>
        <td>${_esc(i.invoice_date)}</td>
        <td><span class="muted" style="font-size:.78rem">${_esc(TREATMENT_LABEL[i.tax_treatment] || i.tax_treatment)}</span></td>
        <td style="font-weight:700">${money(+i.total || 0)}</td>
        <td><span class="fw-chip ${STATUS_CHIP[i.status] || "is-info"}"><span class="dot"></span>${_esc(i.status)}</span></td>
        <td style="white-space:nowrap">
          ${i.status === "draft" ? `<button class="link-btn" data-inv-issue="${i.id}">Issue</button>` : ""}
          ${i.status === "issued" ? `<button class="link-btn" data-inv-paid="${i.id}">Mark paid</button>` : ""}
          <button class="link-btn" data-inv-print="${i.id}">Print</button>
        </td>
      </tr>`).join("") + "</tbody></table>";
  }

  async function saveInvoice(e) {
    e.preventDefault();
    const err = $("invoiceErr");
    err.hidden = true;
    const fail = (m) => { err.textContent = m; err.hidden = false; };

    if (!(typeof coreDbBacked === "function" && coreDbBacked())) return fail("Sign in to raise invoices — they're stored in your fleet's account.");
    const f = e.target;
    const rows = invLines.filter((l) => String(l.description).trim() && parseFloat(l.amount) > 0);
    if (!rows.length) return fail("Add at least one line with a description and an amount.");
    if (!f.elements.customerName.value.trim()) return fail("Who is this invoice for?");

    const t = currentTax();
    const org = await dbOrgId();
    if (!org) return fail("Could not identify your fleet account — try signing in again.");

    const row = {
      org_id: org,
      invoice_no: f.elements.invoiceNo.value.trim(),
      invoice_date: f.elements.invoiceDate.value,
      customer_name: f.elements.customerName.value.trim(),
      customer_gstin: f.elements.customerGstin.value.trim().toUpperCase() || null,
      customer_address: f.elements.customerAddress.value.trim() || null,
      place_of_supply: stateOf(f.elements.customerGstin.value) || f.elements.placeOfSupply.value.trim() || null,
      vehicle_id: f.elements.vehicleId.value ? dbVehicleUuid(f.elements.vehicleId.value) : null,
      lr_no: f.elements.lrNo.value.trim() || null,
      party_id: f.elements.invParty && f.elements.invParty.value ? f.elements.invParty.value : null,
      tax_treatment: f.elements.taxTreatment.value,
      taxable_total: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total,
      status: "draft",
      notes: f.elements.notes.value.trim() || null,
    };

    const saved = await fwCloud.authInsertRet("sales_invoices", row);
    if (!saved) return fail(fwCloud.lastError() || "Could not save the invoice — the number may already be used.");
    const invId = Array.isArray(saved) ? saved[0].id : saved.id;

    const ok = await fwCloud.authInsert("sales_invoice_lines", rows.map((l, n) => ({
      org_id: org, invoice_id: invId, line_no: n + 1,
      description: String(l.description).trim(),
      sac_code: String(l.sac_code || "").trim() || null,
      qty: parseFloat(l.qty) || 1,
      rate: parseFloat(l.rate) || null,
      amount: paise(l.amount),
    })));
    if (!ok) return fail("The invoice saved but its lines did not — open it and re-check before issuing.");

    f.reset();
    invLines = [blankLine(), blankLine()];
    await loadInvoices();
    f.elements.invoiceNo.value = nextInvoiceNo();
    f.elements.invoiceDate.value = new Date().toISOString().slice(0, 10);
    renderLines();
    if (typeof toast === "function") toast("Invoice saved as a draft.");
  }

  async function setStatus(id, status) {
    const patch = { status };
    if (status === "issued") patch.issued_at = new Date().toISOString();
    if (status === "paid") patch.paid_at = new Date().toISOString();
    const ok = await fwCloud.authPatch(`sales_invoices?id=eq.${id}`, patch);
    if (typeof toast === "function") toast(ok ? `Invoice marked ${status}.` : "Could not update that invoice.", ok ? "ok" : "err");
    if (ok) await loadInvoices();
  }

  /* Printing opens a plain window rather than generating a PDF: the browser's
     own print dialog already makes a PDF, on every device, with no library. */
  async function printInvoice(id) {
    const inv = INVOICES.find((i) => i.id === id);
    if (!inv) return;
    const lines = await fwCloud.authGet("sales_invoice_lines", `select=*&invoice_id=eq.${id}&order=line_no`) || [];
    const s = db.settings || {};
    const w = window.open("", "_blank");
    if (!w) { if (typeof toast === "function") toast("Allow pop-ups to print the invoice.", "err"); return; }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${_esc(inv.invoice_no)}</title>
      <style>body{font:14px/1.6 system-ui,sans-serif;padding:32px;color:#111}
      table{width:100%;border-collapse:collapse;margin:18px 0}
      th,td{border:1px solid #bbb;padding:7px 9px;text-align:left}
      th{background:#f2f4f7}.r{text-align:right}h1{font-size:20px;margin:0 0 4px}
      .muted{color:#555;font-size:12px}</style>
      <h1>${_esc(s.businessName || "Tax Invoice")}</h1>
      <div class="muted">${s.gstin ? "GSTIN: " + _esc(s.gstin) : ""}</div>
      <p><strong>Invoice ${_esc(inv.invoice_no)}</strong> &nbsp; Date: ${_esc(inv.invoice_date)}
      ${inv.lr_no ? " &nbsp; LR No: " + _esc(inv.lr_no) : ""}</p>
      <p><strong>Billed to:</strong><br />${_esc(inv.customer_name)}
      ${inv.customer_gstin ? "<br />GSTIN: " + _esc(inv.customer_gstin) : ""}
      ${inv.customer_address ? "<br />" + _esc(inv.customer_address) : ""}
      ${inv.place_of_supply ? '<br /><span class="muted">Place of supply: ' + _esc(inv.place_of_supply) + "</span>" : ""}</p>
      <table><thead><tr><th>#</th><th>Description</th><th>SAC</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
      <tbody>${lines.map((l, n) => `<tr><td>${n + 1}</td><td>${_esc(l.description)}</td><td>${_esc(l.sac_code || "")}</td>
        <td class="r">${_esc(l.qty)}</td><td class="r">${l.rate == null ? "" : money(+l.rate)}</td><td class="r">${money(+l.amount)}</td></tr>`).join("")}</tbody></table>
      <p class="r">Taxable value: <strong>${money(+inv.taxable_total)}</strong><br />
      ${+inv.igst ? "IGST: <strong>" + money(+inv.igst) + "</strong><br />" : ""}
      ${+inv.cgst ? "CGST: <strong>" + money(+inv.cgst) + "</strong><br />" : ""}
      ${+inv.sgst ? "SGST: <strong>" + money(+inv.sgst) + "</strong><br />" : ""}
      <span style="font-size:17px">Total: <strong>${money(+inv.total)}</strong></span></p>
      ${inv.tax_treatment === "rcm" ? '<p class="muted"><strong>GST payable by the recipient under reverse charge (RCM).</strong> This invoice does not charge GST.</p>' : ""}
      ${inv.notes ? '<p class="muted">' + _esc(inv.notes) + "</p>" : ""}`);
    w.document.close();
    w.focus();
    w.print();
  }

  function init() {
    const form = $("invoiceForm");
    if (!form || form.dataset.bound) return;
    form.dataset.bound = "1";
    invLines = [blankLine(), blankLine()];
    renderLines();
    form.elements.invoiceDate.value = new Date().toISOString().slice(0, 10);

    $("invLines").addEventListener("input", (e) => {
      const f = e.target.getAttribute("data-inv");
      if (!f) return;
      const i = +e.target.getAttribute("data-i");
      invLines[i][f] = e.target.value;
      if (f === "qty" || f === "rate") {
        const q = parseFloat(invLines[i].qty), r = parseFloat(invLines[i].rate);
        if (isFinite(q) && isFinite(r)) { invLines[i].amount = paise(q * r); renderLines(); return; }
      }
      renderTotals();
    });
    $("invLines").addEventListener("click", (e) => {
      const d = e.target.getAttribute("data-inv-del");
      if (d === null) return;
      invLines.splice(+d, 1);
      if (!invLines.length) invLines.push(blankLine());
      renderLines();
    });
    $("invAddLine").addEventListener("click", () => { invLines.push(blankLine()); renderLines(); });
    form.addEventListener("change", (e) => {
      if (["taxTreatment", "customerGstin", "placeOfSupply"].includes(e.target.name)) renderTotals();
    });
    form.addEventListener("submit", saveInvoice);

    $("invoiceList").addEventListener("click", (e) => {
      const issue = e.target.getAttribute("data-inv-issue");
      const paidId = e.target.getAttribute("data-inv-paid");
      const print = e.target.getAttribute("data-inv-print");
      if (issue) return setStatus(issue, "issued");
      if (paidId) return setStatus(paidId, "paid");
      if (print) return printInvoice(print);
    });

    $("invParty")?.addEventListener("change", (e) => { if (e.target.value) applyParty(e.target.value); });
    $("partyForm")?.addEventListener("submit", saveParty);
    $("itemForm")?.addEventListener("submit", saveItem);
    $("partyList")?.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-party-del");
      if (id) removeMaster("parties", id, "customer");
    });
    $("itemList")?.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-item-del");
      if (id) removeMaster("items", id, "item");
    });

    // Typing a saved item's name into a line fills its SAC and rate.
    $("invLines").addEventListener("change", (e) => {
      if (e.target.getAttribute("data-inv") !== "description") return;
      const it = ITEMS.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase());
      if (!it) return;
      const i = +e.target.getAttribute("data-i");
      if (it.hsn_sac) invLines[i].sac_code = it.hsn_sac;
      if (it.rate != null) {
        invLines[i].rate = it.rate;
        const q = parseFloat(invLines[i].qty) || 1;
        invLines[i].amount = paise(q * it.rate);
      }
      renderLines();
    });

    // Warn on a bad customer GSTIN as it is typed, not after the invoice ships.
    form.elements.customerGstin.addEventListener("blur", (e) => {
      const p = gstinProblem(e.target.value);
      const err = $("invoiceErr");
      if (p) { err.textContent = p; err.hidden = false; } else if (/GSTIN/i.test(err.textContent || "")) { err.hidden = true; }
    });

    document.querySelectorAll('[data-tab="invoices"]').forEach((b) =>
      b.addEventListener("click", async () => {
        await Promise.all([loadInvoices(), loadMasters()]);
        if (!form.elements.invoiceNo.value) form.elements.invoiceNo.value = nextInvoiceNo();
      }));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // Exported for the tests and for FleetFin to reuse.
  window.invoiceTax = invoiceTax;
  window.invoiceStateOf = stateOf;
  window.gstinProblem = gstinProblem;
  window.gstinCheckChar = gstinCheckChar;
  window.loadInvoices = loadInvoices;
})();
