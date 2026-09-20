/**
 * Driver Khata — reporting tool
 * Filter panel + summary cards + per-driver balance table + transaction table,
 * with CSV / Excel / PDF (print) export. Reads db.drivers and db.driverLedger,
 * the same in-memory data the rest of FleetOps uses (loaded from Supabase when
 * signed in), so driver ids always match ledger entries.
 */

const DriverKhataController = {
  filter: { driverId: "", from: "", to: "", types: { advance: true, expense: true, settlement: true } },
  rows: [],
  summary: null,

  TYPE_LABEL: { advance: "Advance given", expense: "Expense by driver", settlement: "Settled / returned" },

  container() { return document.getElementById("khataContainer"); },

  esc(v) { return typeof esc === "function" ? esc(v) : String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); },
  inr(n) { return "₹" + (Number(n) || 0).toLocaleString("en-IN"); },
  fmtDate(d) { return d ? new Date(d).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }) : "—"; },
  driverName(id) { const d = (db.drivers || []).find(x => x.id === id); return d ? d.name : "Unknown driver"; },

  init() {
    const c = this.container();
    if (!c) return;
    const iso = d => d.toISOString().slice(0, 10);
    if (!this.filter.to) this.filter.to = iso(new Date());
    if (!this.filter.from) this.filter.from = iso(new Date(Date.now() - 30 * 864e5));
    this.build(c);
  },

  // Called by fleet.controller whenever data changes; keeps the report live.
  refresh() {
    const c = this.container();
    if (!c) return;
    if (!c.querySelector("#khDriver")) this.init();
    else { this.syncDriverOptions(c); this.generate(); }
  },

  build(c) {
    const f = this.filter, t = f.types;
    c.innerHTML = `
      <style>
        .kh-wrap { padding: 4px 0 24px; }
        .kh-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
        .kh-head h2 { margin: 0 0 2px; }
        .kh-panel { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 16px; }
        .kh-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; align-items: end; }
        .kh-filters label { font-size: 0.8rem; font-weight: 600; color: var(--muted); display: flex; flex-direction: column; gap: 5px; }
        .kh-types { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; margin-top: 12px; font-size: 0.88rem; }
        .kh-types label { flex-direction: row; align-items: center; gap: 6px; font-weight: 500; color: var(--ink); }
        .kh-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 16px; }
        .kh-card { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
        .kh-card small { color: var(--muted); font-weight: 600; font-size: 0.78rem; }
        .kh-card b { display: block; font-size: 1.4rem; margin-top: 4px; }
        .kh-table-wrap { overflow-x: auto; }
        .kh-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
        .kh-table th { background: var(--bg-alt); color: var(--ink); font-weight: 700; text-align: left; padding: 10px 12px; border-bottom: 2px solid var(--line); white-space: nowrap; }
        .kh-table td { padding: 10px 12px; border-bottom: 1px solid var(--line); }
        .kh-table .num { text-align: right; font-variant-numeric: tabular-nums; }
        .kh-table tfoot td { font-weight: 700; background: var(--bg-alt); }
        .kh-table tr.kh-click { cursor: pointer; }
        .kh-table tr.kh-click:hover { background: var(--bg-alt); }
        .kh-pill { display: inline-block; padding: 2px 9px; border-radius: 99px; font-size: 0.75rem; font-weight: 700; }
        .kh-pill.advance { background: #dbeafe; color: #1e40af; }
        .kh-pill.expense { background: #fef3c7; color: #92400e; }
        .kh-pill.settlement { background: #dcfce7; color: #166534; }
        .kh-pos { color: #166534; } .kh-neg { color: #dc2626; }
        .kh-h3 { margin: 0 0 10px; font-size: 1rem; }
      </style>
      <div class="kh-wrap">
        <div class="kh-head">
          <div>
            <h2>Driver Khata</h2>
            <p class="muted" style="margin:0">Advances, expenses and settlements per driver &mdash; filter, review and export.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-outline btn-sm" id="khCsv">CSV</button>
            <button type="button" class="btn btn-outline btn-sm" id="khXls">Excel</button>
            <button type="button" class="btn btn-outline btn-sm" id="khPdf">PDF / Print</button>
          </div>
        </div>

        <div class="kh-panel">
          <div class="kh-filters">
            <label>Driver <select id="khDriver"></select></label>
            <label>From <input type="date" id="khFrom" value="${f.from}" /></label>
            <label>To <input type="date" id="khTo" value="${f.to}" /></label>
            <button type="button" class="btn btn-primary" id="khGo">Generate Khata</button>
          </div>
          <div class="kh-types">
            <strong style="font-size:0.8rem;color:var(--muted)">Show</strong>
            <label><input type="checkbox" id="khAdv" ${t.advance ? "checked" : ""} /> Advances</label>
            <label><input type="checkbox" id="khExp" ${t.expense ? "checked" : ""} /> Expenses</label>
            <label><input type="checkbox" id="khSet" ${t.settlement ? "checked" : ""} /> Settlements</label>
          </div>
        </div>

        <div id="khCards" class="kh-cards"></div>
        <div id="khBalances"></div>
        <div id="khTable"></div>
      </div>`;

    this.syncDriverOptions(c);
    const go = () => this.generate();
    c.querySelector("#khGo").addEventListener("click", go);
    c.querySelectorAll("#khDriver,#khFrom,#khTo,#khAdv,#khExp,#khSet").forEach(el => el.addEventListener("change", go));
    c.querySelector("#khCsv").addEventListener("click", () => this.download("csv"));
    c.querySelector("#khXls").addEventListener("click", () => this.download("xls"));
    c.querySelector("#khPdf").addEventListener("click", () => this.print());
    this.generate();
  },

  syncDriverOptions(c) {
    const sel = c.querySelector("#khDriver");
    if (!sel) return;
    const keep = sel.value || this.filter.driverId;
    sel.innerHTML = `<option value="">All drivers</option>` +
      (db.drivers || []).map(d => `<option value="${this.esc(d.id)}">${this.esc(d.name)}</option>`).join("");
    if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
  },

  readControls() {
    const c = this.container();
    const v = id => c.querySelector(id);
    this.filter.driverId = v("#khDriver").value;
    this.filter.from = v("#khFrom").value;
    this.filter.to = v("#khTo").value;
    this.filter.types = { advance: v("#khAdv").checked, expense: v("#khExp").checked, settlement: v("#khSet").checked };
  },

  compute() {
    const { driverId, from, to, types } = this.filter;
    const rows = (db.driverLedger || []).filter(l =>
      types[l.type] &&
      (!driverId || l.driverId === driverId) &&
      (!l.date || ((!from || l.date >= from) && (!to || l.date <= to)))
    ).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    const sum = (list, type) => list.filter(l => l.type === type).reduce((s, l) => s + (l.amount || 0), 0);
    const totals = { advance: sum(rows, "advance"), expense: sum(rows, "expense"), settlement: sum(rows, "settlement") };
    totals.balance = totals.advance - totals.expense - totals.settlement;

    const byDriver = (db.drivers || []).map(d => {
      const mine = rows.filter(l => l.driverId === d.id);
      const t = { id: d.id, name: d.name, advance: sum(mine, "advance"), expense: sum(mine, "expense"), settlement: sum(mine, "settlement"), count: mine.length };
      t.balance = t.advance - t.expense - t.settlement;
      return t;
    }).filter(t => t.count > 0);

    this.rows = rows; this.summary = { totals, byDriver };
  },

  generate() {
    const c = this.container();
    if (!c || !c.querySelector("#khDriver")) return;
    this.readControls();
    this.compute();
    const { totals, byDriver } = this.summary;
    const bal = n => `<span class="${n >= 0 ? "kh-pos" : "kh-neg"}">${this.inr(n)}</span>`;

    c.querySelector("#khCards").innerHTML = `
      <div class="kh-card"><small>Total advances</small><b style="color:#1e40af">${this.inr(totals.advance)}</b></div>
      <div class="kh-card"><small>Total expenses</small><b style="color:#92400e">${this.inr(totals.expense)}</b></div>
      <div class="kh-card"><small>Total settlements</small><b style="color:#166534">${this.inr(totals.settlement)}</b></div>
      <div class="kh-card"><small>Balance with driver</small><b>${bal(totals.balance)}</b></div>`;

    const balBox = c.querySelector("#khBalances");
    if (!this.filter.driverId && byDriver.length) {
      balBox.innerHTML = `<div class="kh-panel"><h3 class="kh-h3">Balance by driver</h3><div class="kh-table-wrap"><table class="kh-table">
        <thead><tr><th>Driver</th><th class="num">Advances</th><th class="num">Expenses</th><th class="num">Settled</th><th class="num">With driver</th></tr></thead><tbody>` +
        byDriver.map(t => `<tr class="kh-click" data-id="${this.esc(t.id)}"><td>${this.esc(t.name)}</td><td class="num">${this.inr(t.advance)}</td><td class="num">${this.inr(t.expense)}</td><td class="num">${this.inr(t.settlement)}</td><td class="num"><b>${bal(t.balance)}</b></td></tr>`).join("") +
        `</tbody></table></div><p class="muted" style="margin:8px 0 0;font-size:0.78rem">Click a driver to see only their entries.</p></div>`;
      balBox.querySelectorAll("tr.kh-click").forEach(tr => tr.addEventListener("click", () => {
        c.querySelector("#khDriver").value = tr.dataset.id; this.generate();
      }));
    } else balBox.innerHTML = "";

    const body = this.rows.length ? this.rows.map(l => `<tr>
        <td>${this.fmtDate(l.date)}</td><td>${this.esc(this.driverName(l.driverId))}</td>
        <td><span class="kh-pill ${this.esc(l.type)}">${this.esc(this.TYPE_LABEL[l.type] || l.type || "Other")}</span></td>
        <td class="num">${this.inr(l.amount)}</td><td>${this.esc(l.note || "—")}</td></tr>`).join("")
      : `<tr><td colspan="5" style="text-align:center;padding:26px;color:var(--muted)">No entries for this selection. Add entries under Fleet &rarr; Drivers &amp; Contacts, or widen the dates.</td></tr>`;

    c.querySelector("#khTable").innerHTML = `<div class="kh-panel"><h3 class="kh-h3">Transactions <span class="muted" style="font-weight:400">(${this.rows.length})</span></h3>
      <div class="kh-table-wrap"><table class="kh-table">
        <thead><tr><th>Date</th><th>Driver</th><th>Type</th><th class="num">Amount</th><th>Notes</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><td colspan="3">Balance with driver (advances − expenses − settled)</td><td class="num">${bal(totals.balance)}</td><td></td></tr></tfoot>
      </table></div></div>`;
  },

  periodText() { return `${this.filter.from || "start"} to ${this.filter.to || "today"}`; },

  download(kind) {
    this.readControls(); this.compute();
    const { totals } = this.summary;
    const stamp = new Date().toISOString().slice(0, 10);
    let blob, name;
    if (kind === "csv") {
      const q = s => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
      const lines = [["Date", "Driver", "Type", "Amount (INR)", "Notes"].join(",")].concat(
        this.rows.map(l => [q(l.date || ""), q(this.driverName(l.driverId)), q(l.type), l.amount || 0, q(l.note || "")].join(",")));
      lines.push("", "Summary", `Total advances,${totals.advance}`, `Total expenses,${totals.expense}`, `Total settlements,${totals.settlement}`, `Balance with driver,${totals.balance}`);
      blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" }); name = `Driver_Khata_${stamp}.csv`;
    } else {
      blob = new Blob(["﻿" + this.reportHtml(false)], { type: "application/vnd.ms-excel;charset=utf-8;" }); name = `Driver_Khata_${stamp}.xls`;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },

  reportHtml(styled) {
    const { totals } = this.summary;
    const rows = this.rows.map(l => `<tr><td>${this.fmtDate(l.date)}</td><td>${this.esc(this.driverName(l.driverId))}</td><td>${this.esc(this.TYPE_LABEL[l.type] || l.type || "")}</td><td style="text-align:right">${l.amount || 0}</td><td>${this.esc(l.note || "")}</td></tr>`).join("");
    const who = this.filter.driverId ? this.driverName(this.filter.driverId) : "All drivers";
    return `${styled ? `<style>body{font-family:Arial,sans-serif;padding:24px;color:#1c2733}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccd3dc;padding:7px 9px;text-align:left}th{background:#eef2f7}h1{margin:0 0 4px}.s{margin:14px 0;font-size:14px}</style>` : ""}
      <h1>Driver Khata</h1><div>${this.esc(who)} &middot; ${this.esc(this.periodText())} &middot; Generated ${new Date().toLocaleDateString("en-IN")}</div>
      <p class="s"><b>Advances:</b> ${this.inr(totals.advance)} &nbsp; <b>Expenses:</b> ${this.inr(totals.expense)} &nbsp; <b>Settled:</b> ${this.inr(totals.settlement)} &nbsp; <b>Balance with driver:</b> ${this.inr(totals.balance)}</p>
      <table><thead><tr><th>Date</th><th>Driver</th><th>Type</th><th>Amount (INR)</th><th>Notes</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No entries</td></tr>'}</tbody></table>`;
  },

  print() {
    this.readControls(); this.compute();
    const w = window.open("", "_blank");
    if (!w) { alert("Allow pop-ups to export the PDF, or use CSV / Excel."); return; }
    w.document.write(`<!doctype html><title>Driver Khata</title>${this.reportHtml(true)}`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  }
};

window.DriverKhataController = DriverKhataController;

document.addEventListener("click", e => {
  if (e.target.closest && e.target.closest('[data-tab="khata"]')) setTimeout(() => DriverKhataController.refresh(), 50);
});
window.addEventListener("hashchange", () => { if (location.hash === "#khata") DriverKhataController.refresh(); });
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => DriverKhataController.refresh());
else DriverKhataController.refresh();
