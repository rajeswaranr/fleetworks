/* ============ FleetWorks — garage.js ============
   Partner workshop dashboard: job cards with the full estimate →
   owner-approval → repair (photos + inspection) → completion flow,
   spares stock, ratings & complaints, service advisor, and the
   fortnightly FleetWorks payout ledger.
   Store: localStorage "fw_garage" (local-first, like the owner app). */

"use strict";

// ---------- Store ----------
const G_KEY = "fw_garage";
function loadG() {
  try {
    const d = JSON.parse(localStorage.getItem(G_KEY) || "{}");
    return {
      profile: d.profile || {}, jobs: d.jobs || [], stock: d.stock || [],
      payouts: d.payouts || [], complaints: d.complaints || [], demo: !!d.demo
    };
  } catch { return { profile: {}, jobs: [], stock: [], payouts: [], complaints: [], demo: false }; }
}
function saveG() { localStorage.setItem(G_KEY, JSON.stringify(G)); }
let G = loadG();

// ---------- Utils ----------
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const uid = () => "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmtINR = v => v >= 100000 ? "₹" + (v / 100000).toFixed(1) + "L" : v >= 1000 ? "₹" + (v / 1000).toFixed(1) + "K" : "₹" + Math.round(v);
const fmtFull = v => "₹" + Math.round(v).toLocaleString("en-IN");
const fmtDate = d => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const iso = d => d.toISOString().slice(0, 10);
const daysFromNow = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const COMMISSION = 0.10;

const STATUS_CHIP = {
  "Planned": "is-open", "Estimate Sent": "is-pending", "Approved": "is-pending",
  "In Progress": "is-pending", "Completed": "is-done", "Delivered": "is-done"
};
const stars = n => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));

// Fortnight boundaries: 1–15 and 16–end of month. Payout lands on cycle end + 1.
function fortnightOf(dateStr) {
  const d = new Date(dateStr);
  const y = d.getFullYear(), m = d.getMonth();
  if (d.getDate() <= 15) return { start: iso(new Date(y, m, 1)), end: iso(new Date(y, m, 15)) };
  return { start: iso(new Date(y, m, 16)), end: iso(new Date(y, m + 1, 0)) };
}
function currentFortnight() { return fortnightOf(iso(new Date())); }

// ---------- Demo garage ----------
function loadDemoGarage() {
  const today = new Date();
  const vehOwners = [
    ["TN-01-AB-1234", "SR Transports", "Suresh Kumar"],
    ["TN-09-CD-5678", "SR Transports", "Manoj Yadav"],
    ["TN-22-EF-3456", "SR Transports", "Ravi Shankar"],
    ["KA-05-GH-7890", "SR Transports", "Peter D'Souza"],
    ["TN-38-QR-9012", "Kovai Cargo Movers", "Sathish"],
    ["TN-66-LM-4455", "Malabar Freight Lines", "Noushad"]
  ];
  const mkJob = (i, status, extra) => ({
    id: "j" + (i + 1),
    vehicle: vehOwners[i % 6][0], owner: vehOwners[i % 6][1], driver: vehOwners[i % 6][2],
    issue: extra.issue, scheduledDate: extra.sched, status,
    estimate: extra.estimate || null, photos: extra.photos || [],
    inspection: extra.inspection || null,
    completedAt: extra.completedAt || null, finalAmount: extra.finalAmount || null,
    rating: extra.rating || null
  });
  const est = (items, status) => ({ items, total: items.reduce((s, it) => s + it.qty * it.rate, 0), status });

  const jobs = [
    mkJob(0, "Planned", { issue: "PM service — oil, filters, greasing", sched: daysFromNow(0) }),
    mkJob(1, "Planned", { issue: "Coolant temperature climbing on ghats", sched: daysFromNow(1) }),
    mkJob(2, "Estimate Sent", {
      issue: "Brake liners worn — replace front axle set", sched: daysFromNow(0),
      estimate: est([{ desc: "Brake liner set (Bosch)", qty: 1, rate: 4200 }, { desc: "Drum skimming", qty: 2, rate: 650 }, { desc: "Labour", qty: 1, rate: 1500 }], "Sent")
    }),
    mkJob(3, "Approved", {
      issue: "Clutch slipping under load", sched: daysFromNow(0),
      estimate: est([{ desc: "Clutch plate + pressure plate", qty: 1, rate: 19500 }, { desc: "Release bearing", qty: 1, rate: 2200 }, { desc: "Labour (gearbox drop)", qty: 1, rate: 3500 }], "Approved")
    }),
    mkJob(4, "In Progress", {
      issue: "Alternator not charging, battery draining", sched: daysFromNow(-1),
      estimate: est([{ desc: "Alternator refurb (Bosch 90A)", qty: 1, rate: 4800 }, { desc: "Belt", qty: 1, rate: 700 }, { desc: "Labour", qty: 1, rate: 800 }], "Approved"),
      inspection: { items: [["Battery terminals", true], ["Charging voltage", false], ["Belt tension", false], ["Wiring harness", true]].map(([item, ok]) => ({ item, ok })), notes: "Alternator diodes gone; belt glazed — both covered in estimate." }
    }),
    mkJob(5, "Completed", {
      issue: "Tyre rotation + 2 new tyres rear axle", sched: daysFromNow(-4),
      estimate: est([{ desc: "10.00R20 tyre (CEAT)", qty: 2, rate: 17500 }, { desc: "Rotation + balancing", qty: 1, rate: 1200 }], "Approved"),
      completedAt: daysFromNow(-3), finalAmount: 36200, rating: 5
    }),
    mkJob(0, "Completed", {
      issue: "AC compressor overhaul", sched: daysFromNow(-6),
      estimate: est([{ desc: "Compressor overhaul kit", qty: 1, rate: 5600 }, { desc: "Gas top-up", qty: 1, rate: 1800 }, { desc: "Labour", qty: 1, rate: 1200 }], "Approved"),
      completedAt: daysFromNow(-5), finalAmount: 8600, rating: 4
    }),
    mkJob(1, "Delivered", {
      issue: "Silencer mounting weld + exhaust leak", sched: daysFromNow(-19),
      estimate: est([{ desc: "Welding + brackets", qty: 1, rate: 1400 }, { desc: "Gasket", qty: 1, rate: 400 }], "Approved"),
      completedAt: daysFromNow(-18), finalAmount: 1800, rating: 5
    }),
    mkJob(3, "Delivered", {
      issue: "Suspension — leaf spring replacement", sched: daysFromNow(-24),
      completedAt: daysFromNow(-22), finalAmount: 16400, rating: 4,
      estimate: est([{ desc: "Leaf spring pack (rear)", qty: 1, rate: 12800 }, { desc: "Bushes + centre bolt", qty: 1, rate: 1600 }, { desc: "Labour", qty: 1, rate: 2000 }], "Approved")
    })
  ];

  const stock = [
    { id: uid(), name: "Brake Liner Set — HCV", partNo: "BL-HCV-450", qty: 5, minQty: 4, unitCost: 4200 },
    { id: uid(), name: "Engine Oil 15W-40 (20L)", partNo: "CAS-15W40-20L", qty: 8, minQty: 4, unitCost: 6400 },
    { id: uid(), name: "Oil Filter — Tata/AL", partNo: "OF-TA-330", qty: 3, minQty: 6, unitCost: 380 },
    { id: uid(), name: "Air Filter — BS6 HCV", partNo: "AF-BS6-710", qty: 6, minQty: 3, unitCost: 950 },
    { id: uid(), name: "Clutch Plate — 380mm", partNo: "CP-380-VAL", qty: 1, minQty: 2, unitCost: 11200 },
    { id: uid(), name: "10.00R20 Tyre (CEAT)", partNo: "TY-CEAT-1020", qty: 4, minQty: 4, unitCost: 17500 },
    { id: uid(), name: "Coolant (5L)", partNo: "CL-5L-GRN", qty: 12, minQty: 6, unitCost: 720 },
    { id: uid(), name: "Alternator Belt B62", partNo: "BLT-B62", qty: 2, minQty: 5, unitCost: 700 }
  ];

  // Past payouts (paid) — current fortnight accrues live from completed jobs
  const payouts = [
    { id: uid(), periodStart: daysFromNow(-45), periodEnd: daysFromNow(-31), gross: 68400, status: "Paid", paidOn: daysFromNow(-30) },
    { id: uid(), periodStart: daysFromNow(-30), periodEnd: daysFromNow(-16), gross: 52800, status: "Paid", paidOn: daysFromNow(-15) },
    { id: uid(), periodStart: daysFromNow(-15), periodEnd: daysFromNow(-1), gross: 18200, status: "Paid", paidOn: daysFromNow(0) }
  ].map(p => ({ ...p, commission: Math.round(p.gross * COMMISSION), net: Math.round(p.gross * (1 - COMMISSION)) }));

  const complaints = [
    { id: uid(), job: "AC compressor overhaul — TN-01-AB-1234", text: "AC cooling dropped again after 3 days.", status: "Open", date: daysFromNow(-2) },
    { id: uid(), job: "Tyre work — KA-05-GH-7890", text: "Wheel cap missing after delivery.", status: "Resolved", date: daysFromNow(-12) }
  ];

  G = {
    profile: {
      name: "Annai Auto Works", city: "Salem", phone: "9500123456", gstin: "33AAPCA1234F1Z6",
      advisor: { name: "Karthikeyan R", role: "FleetWorks Service Advisor — Salem cluster", phone: "9740799722", email: "partners@fleetworks.in" }
    },
    jobs, stock, payouts, complaints, demo: true
  };
  saveG();
  renderAllG();
}

// ---------- Photo capture (compressed thumbnails, stored on the job) ----------
let photoJobId = null;
function gAddPhoto(jobId) {
  photoJobId = jobId;
  document.getElementById("gPhotoFile").click();
}
document.getElementById("gPhotoFile").addEventListener("change", e => {
  const f = e.target.files[0];
  if (!f || !photoJobId) return;
  const job = G.jobs.find(j => j.id === photoJobId);
  if (!job) return;
  if ((job.photos || []).length >= 6) { alert("Max 6 photos per job card."); return; }
  const img = new Image();
  img.onload = () => {
    const s = Math.min(1, 360 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    job.photos = job.photos || [];
    job.photos.push({ src: c.toDataURL("image/jpeg", 0.55), at: iso(new Date()) });
    saveG(); renderAllG();
  };
  img.src = URL.createObjectURL(f);
  e.target.value = "";
});

// ---------- Job workflow actions ----------
function gApprove(id) { const j = G.jobs.find(x => x.id === id); if (!j || !j.estimate) return; j.estimate.status = "Approved"; j.status = "Approved"; saveG(); renderAllG(); }
function gReject(id) { const j = G.jobs.find(x => x.id === id); if (!j || !j.estimate) return; j.estimate.status = "Rejected"; j.status = "Planned"; saveG(); renderAllG(); }
function gStart(id) { const j = G.jobs.find(x => x.id === id); if (!j) return; j.status = "In Progress"; saveG(); renderAllG(); }
function gComplete(id) {
  const j = G.jobs.find(x => x.id === id);
  if (!j) return;
  const suggested = j.estimate ? j.estimate.total : 0;
  const amt = prompt("Final bill amount (₹):", suggested || "");
  if (amt === null) return;
  j.finalAmount = +amt || suggested;
  j.status = "Completed";
  j.completedAt = iso(new Date());
  saveG(); renderAllG();
}
function gDeliver(id) { const j = G.jobs.find(x => x.id === id); if (!j) return; j.status = "Delivered"; saveG(); renderAllG(); }
function gEstimateFor(id) {
  document.querySelector('#gTabBar .tab-btn[data-tab="quotes"]')?.click();
  const sel = document.getElementById("gQuoteJob");
  if ([...sel.options].some(o => o.value === id)) sel.value = id;
}
function gResolve(id) { const c = G.complaints.find(x => x.id === id); if (c) { c.status = "Resolved"; saveG(); renderAllG(); } }

// ---------- Renderers ----------
function jobCardHTML(j) {
  const chip = `<span class="fw-chip ${STATUS_CHIP[j.status] || "is-open"}"><span class="dot"></span>${j.status}</span>`;
  const estLine = j.estimate ?
    `Estimate ${fmtFull(j.estimate.total)} · <strong>${j.estimate.status}</strong>` : "No estimate yet";
  let actions = "";
  if (j.status === "Planned") actions = `<button class="link-btn" onclick="gEstimateFor('${j.id}')">${FWIcon("receipt", { size: 14 })} Create estimate</button>`;
  if (j.status === "Estimate Sent") actions = `<button class="link-btn" onclick="gApprove('${j.id}')">${FWIcon("check", { size: 14 })} Owner approved</button> <button class="link-btn" style="color:#b91c1c" onclick="gReject('${j.id}')">Rejected</button>`;
  if (j.status === "Approved") actions = `<button class="link-btn" onclick="gStart('${j.id}')">${FWIcon("wrench", { size: 14 })} Start work</button>`;
  if (j.status === "In Progress") actions =
    `<button class="link-btn" onclick="gAddPhoto('${j.id}')">${FWIcon("plus", { size: 14 })} Photo</button>
     <button class="link-btn" onclick="gComplete('${j.id}')">${FWIcon("check", { size: 14 })} Complete &amp; bill</button>`;
  if (j.status === "Completed") actions = `<button class="link-btn" onclick="gDeliver('${j.id}')">${FWIcon("truck", { size: 14 })} Delivered to owner</button>`;
  const photos = (j.photos || []).length ?
    `<div class="gphotos">${j.photos.map(p => `<img src="${p.src}" alt="repair photo" />`).join("")}</div>` : "";
  const insp = j.inspection ? `<span class="muted">· Inspection ${FWIcon("checkCircle", { size: 13, cls: "ic-success" })} ${j.inspection.items.filter(i => !i.ok).length} finding(s)</span>` : "";
  const rating = j.rating ? `<span style="color:#e2930f;font-weight:700">${stars(j.rating)}</span>` : "";
  return `
    <div class="pred-row" style="padding:13px 16px">
      <div class="pred-main" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        ${chip}<strong>${esc(j.vehicle)}</strong><span class="muted">${esc(j.owner)}</span> — ${esc(j.issue)} ${rating}
      </div>
      <div class="pred-detail">
        <span>${estLine} ${insp}</span>
        <span>${j.status === "Planned" ? "Scheduled " + fmtDate(j.scheduledDate) : j.completedAt ? "Completed " + fmtDate(j.completedAt) : "In shop"}</span>
        <span>${actions}</span>
      </div>
      ${photos}
    </div>`;
}

function renderJobs() {
  const order = ["In Progress", "Approved", "Estimate Sent", "Planned", "Completed", "Delivered"];
  const jobs = [...G.jobs].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  document.getElementById("gJobsList").innerHTML = jobs.length ?
    jobs.map(jobCardHTML).join("") : "<p class='muted' style='padding:14px 16px'>No job cards yet — FleetWorks bookings will appear here.</p>";
}

function renderDashG() {
  const planned = G.jobs.filter(j => ["Planned", "Estimate Sent", "Approved"].includes(j.status));
  const wip = G.jobs.filter(j => j.status === "In Progress");
  const fn = currentFortnight();
  const doneFn = G.jobs.filter(j => j.completedAt && j.completedAt >= fn.start && j.completedAt <= fn.end);
  const grossFn = doneFn.reduce((s, j) => s + (j.finalAmount || 0), 0);
  const paid = G.payouts.filter(p => p.status === "Paid").reduce((s, p) => s + p.net, 0);
  const rated = G.jobs.filter(j => j.rating);
  const avg = rated.length ? rated.reduce((s, j) => s + j.rating, 0) / rated.length : 0;
  const openC = G.complaints.filter(c => c.status !== "Resolved").length;

  document.getElementById("gStats").innerHTML = `
    <div class="stat-tile"><span class="stat-label">Vehicles planned</span><span class="stat-value">${planned.length}</span><span class="stat-sub">incl. awaiting approval</span></div>
    <div class="stat-tile"><span class="stat-label">Work in progress</span><span class="stat-value">${wip.length}</span><span class="stat-sub">on the floor now</span></div>
    <div class="stat-tile"><span class="stat-label">Revenue this fortnight</span><span class="stat-value">${fmtINR(grossFn)}</span><span class="stat-sub">${doneFn.length} job${doneFn.length === 1 ? "" : "s"} completed</span></div>
    <div class="stat-tile"><span class="stat-label">In your account till date</span><span class="stat-value" style="color:#006300">${fmtINR(paid)}</span><span class="stat-sub">payouts received</span></div>
    <div class="stat-tile"><span class="stat-label">Rating</span><span class="stat-value" style="color:#e2930f">${avg ? avg.toFixed(1) : "—"}</span><span class="stat-sub">${rated.length} rated jobs</span></div>
    <div class="stat-tile"><span class="stat-label">Open complaints</span><span class="stat-value" style="color:${openC ? "#d03b3b" : "#0ca30c"}">${openC}</span><span class="stat-sub">resolve fast for ranking</span></div>`;

  const sched = [...planned, ...wip].sort((a, b) => (a.scheduledDate || "").localeCompare(b.scheduledDate || ""));
  document.getElementById("gSchedule").innerHTML = sched.length ?
    sched.slice(0, 6).map(j => `<div class="pred-row" style="padding:10px 16px"><div class="pred-main" style="display:flex;gap:10px;align-items:center;font-size:0.88rem">
      <span class="fw-chip ${STATUS_CHIP[j.status]}"><span class="dot"></span>${j.status}</span>
      <span style="flex:1;min-width:0"><strong>${esc(j.vehicle)}</strong> — ${esc(j.issue)}</span>
      <span class="muted" style="flex:none">${fmtDate(j.scheduledDate)}</span></div></div>`).join("")
    : "<p class='muted' style='padding:12px 16px'>Nothing scheduled — enjoy the chai.</p>";

  const net = Math.round(grossFn * (1 - COMMISSION));
  const payDate = new Date(fn.end); payDate.setDate(payDate.getDate() + 1);
  document.getElementById("gFortnight").innerHTML = `
    <div class="pred-row" style="padding:12px 16px"><div class="pred-detail" style="display:flex;flex-direction:column;gap:8px;font-size:0.9rem">
      <span>Gross completed: <strong>${fmtFull(grossFn)}</strong></span>
      <span>FleetWorks fee (10%): <strong>−${fmtFull(grossFn * COMMISSION)}</strong></span>
      <span>Next payout: <strong style="color:#006300">${fmtFull(net)}</strong> on <strong>${fmtDate(iso(payDate))}</strong></span>
      <span class="muted">Cycle ${fmtDate(fn.start)} – ${fmtDate(fn.end)} · paid directly to your bank</span>
    </div></div>`;
}

function renderQuotes() {
  const sel = document.getElementById("gQuoteJob");
  const eligible = G.jobs.filter(j => j.status === "Planned" || (j.estimate && j.estimate.status === "Rejected"));
  const keep = sel.value;
  sel.innerHTML = eligible.length ?
    eligible.map(j => `<option value="${j.id}">${esc(j.vehicle)} — ${esc(j.issue)}</option>`).join("") :
    "<option value=''>No jobs awaiting estimate</option>";
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep;

  const rows = G.jobs.filter(j => j.estimate);
  document.getElementById("gQuotesTable").innerHTML = rows.length ?
    `<table class="chart-table-el"><thead><tr><th>Vehicle</th><th>Job</th><th>Items</th><th>Total</th><th>Status</th></tr></thead><tbody>` +
    rows.map(j => `<tr><td><strong>${esc(j.vehicle)}</strong></td><td>${esc(j.issue)}</td><td>${j.estimate.items.map(it => esc(it.desc)).join(", ")}</td><td><strong>${fmtFull(j.estimate.total)}</strong></td>
      <td><span class="fw-badge ${j.estimate.status === "Approved" ? "ok" : j.estimate.status === "Rejected" ? "overdue" : "soon"}">${j.estimate.status}</span></td></tr>`).join("") + "</tbody></table>"
    : "<p class='muted'>No estimates yet.</p>";
}

function quoteRow() {
  return `<div class="form-row gq-row">
    <label>Item<input type="text" class="gq-desc" placeholder="e.g. Brake liner set" required /></label>
    <label>Qty<input type="number" class="gq-qty" value="1" min="1" required inputmode="numeric" /></label>
    <label>Rate (₹)<input type="number" class="gq-rate" min="0" required inputmode="numeric" /></label>
  </div>`;
}
function quoteTotal() {
  let t = 0;
  document.querySelectorAll(".gq-row").forEach(r => {
    t += (+r.querySelector(".gq-qty").value || 0) * (+r.querySelector(".gq-rate").value || 0);
  });
  document.getElementById("gQuoteTotal").textContent = fmtFull(t);
  return t;
}

const GARAGE_CHECK = ["Body & cabin condition", "Fuel level & seals", "Tyres & stepney", "Battery & electricals", "Fluid levels", "Dashboard warning lamps", "Tools & documents in cabin", "Underbody / leaks"];
function renderInspG() {
  const sel = document.getElementById("gInspJob");
  const eligible = G.jobs.filter(j => ["Approved", "In Progress"].includes(j.status));
  const keep = sel.value;
  sel.innerHTML = eligible.length ?
    eligible.map(j => `<option value="${j.id}">${esc(j.vehicle)} — ${esc(j.issue)}</option>`).join("") :
    "<option value=''>No jobs in the workshop</option>";
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep;

  const done = G.jobs.filter(j => j.inspection);
  document.getElementById("gInspList").innerHTML = done.length ?
    done.map(j => {
      const bad = j.inspection.items.filter(i => !i.ok);
      return `<div class="pred-row" style="padding:12px 16px"><div class="pred-main" style="font-size:0.9rem"><strong>${esc(j.vehicle)}</strong> — ${esc(j.issue)}</div>
        <div class="pred-detail"><span>${bad.length ? bad.map(b => esc(b.item)).join(", ") + " flagged" : "All points OK"}</span>
        <span class="muted">${esc(j.inspection.notes || "")}</span></div></div>`;
    }).join("")
    : "<p class='muted' style='padding:12px 16px'>No inspection reports yet.</p>";
}

function renderStockG() {
  const rows = [...G.stock].sort((a, b) => (a.qty <= a.minQty ? 0 : 1) - (b.qty <= b.minQty ? 0 : 1));
  document.getElementById("gStockTable").innerHTML = rows.length ?
    `<table class="chart-table-el"><thead><tr><th>Part</th><th>Part No</th><th>In stock</th><th>Re-order at</th><th>Unit cost</th><th>Status</th></tr></thead><tbody>` +
    rows.map(p => `<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.partNo || "—")}</td><td>${p.qty}</td><td>${p.minQty}</td><td>${p.unitCost ? fmtFull(p.unitCost) : "—"}</td>
      <td>${p.qty <= p.minQty ? '<span class="fw-badge overdue">Low — reorder</span>' : '<span class="fw-badge ok">OK</span>'}</td></tr>`).join("") + "</tbody></table>"
    : "<p class='muted'>No parts yet — add your godown above.</p>";
}

function renderPayG() {
  const fn = currentFortnight();
  const doneFn = G.jobs.filter(j => j.completedAt && j.completedAt >= fn.start && j.completedAt <= fn.end);
  const grossFn = doneFn.reduce((s, j) => s + (j.finalAmount || 0), 0);
  const netFn = Math.round(grossFn * (1 - COMMISSION));
  const paid = G.payouts.filter(p => p.status === "Paid").reduce((s, p) => s + p.net, 0);
  const payDate = new Date(fn.end); payDate.setDate(payDate.getDate() + 1);
  document.getElementById("gPayTiles").innerHTML = `
    <div class="stat-tile"><span class="stat-label">In your account till date</span><span class="stat-value" style="color:#006300">${fmtINR(paid)}</span><span class="stat-sub">all payouts received</span></div>
    <div class="stat-tile"><span class="stat-label">Accruing this fortnight</span><span class="stat-value">${fmtINR(netFn)}</span><span class="stat-sub">net of 10% platform fee</span></div>
    <div class="stat-tile"><span class="stat-label">Next payout date</span><span class="stat-value">${fmtDate(iso(payDate))}</span><span class="stat-sub">cycle ends ${fmtDate(fn.end)}</span></div>
    <div class="stat-tile"><span class="stat-label">Jobs this cycle</span><span class="stat-value">${doneFn.length}</span><span class="stat-sub">completed &amp; billed</span></div>`;
  const rows = [
    { periodStart: fn.start, periodEnd: fn.end, gross: grossFn, commission: Math.round(grossFn * COMMISSION), net: netFn, status: "Accruing", paidOn: null },
    ...[...G.payouts].sort((a, b) => b.periodStart.localeCompare(a.periodStart))
  ];
  document.getElementById("gPayTable").innerHTML =
    `<table class="chart-table-el"><thead><tr><th>Cycle</th><th>Gross</th><th>Fee (10%)</th><th>Net payout</th><th>Status</th></tr></thead><tbody>` +
    rows.map(p => `<tr><td>${fmtDate(p.periodStart)} – ${fmtDate(p.periodEnd)}</td><td>${fmtFull(p.gross)}</td><td>−${fmtFull(p.commission)}</td><td><strong>${fmtFull(p.net)}</strong></td>
      <td>${p.status === "Paid" ? `<span class="fw-badge ok">Paid ${fmtDate(p.paidOn)}</span>` : '<span class="fw-badge soon">Accruing</span>'}</td></tr>`).join("") + "</tbody></table>";
}

function renderRateG() {
  const rated = G.jobs.filter(j => j.rating);
  const avg = rated.length ? rated.reduce((s, j) => s + j.rating, 0) / rated.length : 0;
  const openC = G.complaints.filter(c => c.status !== "Resolved");
  document.getElementById("gRateTiles").innerHTML = `
    <div class="stat-tile"><span class="stat-label">Average rating</span><span class="stat-value" style="color:#e2930f">${avg ? avg.toFixed(1) : "—"}</span><span class="stat-sub">${stars(avg || 0)}</span></div>
    <div class="stat-tile"><span class="stat-label">Rated jobs</span><span class="stat-value">${rated.length}</span><span class="stat-sub">owners rate on delivery</span></div>
    <div class="stat-tile"><span class="stat-label">Open complaints</span><span class="stat-value" style="color:${openC.length ? "#d03b3b" : "#0ca30c"}">${openC.length}</span><span class="stat-sub">affects your ranking</span></div>
    <div class="stat-tile"><span class="stat-label">5★ share</span><span class="stat-value">${rated.length ? Math.round(rated.filter(j => j.rating === 5).length / rated.length * 100) : 0}%</span><span class="stat-sub">of rated jobs</span></div>`;
  document.getElementById("gRatingsList").innerHTML = rated.length ?
    rated.map(j => `<div class="pred-row" style="padding:11px 16px"><div class="pred-main" style="display:flex;gap:10px;align-items:center;font-size:0.88rem">
      <span style="color:#e2930f;font-weight:700;flex:none">${stars(j.rating)}</span>
      <span style="flex:1;min-width:0"><strong>${esc(j.vehicle)}</strong> — ${esc(j.issue)}</span>
      <span class="muted" style="flex:none">${esc(j.owner)}</span></div></div>`).join("")
    : "<p class='muted' style='padding:12px 16px'>No ratings yet.</p>";
  document.getElementById("gComplaints").innerHTML = G.complaints.length ?
    G.complaints.map(c => `<div class="pred-row" style="padding:11px 16px"><div class="pred-main" style="font-size:0.88rem"><strong>${esc(c.job)}</strong></div>
      <div class="pred-detail"><span>${esc(c.text)}</span>
      <span>${c.status === "Resolved" ? '<span class="fw-badge ok">Resolved</span>' : `<span class="fw-badge overdue">Open</span> <button class="link-btn" onclick="gResolve('${c.id}')">Mark resolved</button>`}</span></div></div>`).join("")
    : "<p class='muted' style='padding:12px 16px'>No complaints — keep it that way!</p>";
}

function renderAdvG() {
  const a = G.profile.advisor || {};
  document.getElementById("gAdvisorCard").innerHTML = `
    <div style="display:flex;gap:16px;align-items:center;padding:6px 2px 14px">
      <span class="ic-tile brand" style="width:58px;height:58px;flex:none">${FWIcon("driver", { size: 30 })}</span>
      <div>
        <strong style="font-size:1.05rem;color:var(--navy)">${esc(a.name || "Being assigned")}</strong><br />
        <span class="muted">${esc(a.role || "Your dedicated advisor is assigned at onboarding")}</span>
      </div>
    </div>
    <div class="settings-actions">
      ${a.phone ? `<a class="btn btn-primary" href="tel:+91${esc(a.phone)}">${FWIcon("phone", { size: 15 })} Call ${esc(a.name.split(" ")[0])}</a>
      <a class="btn btn-outline" href="https://wa.me/91${esc(a.phone)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
      ${a.email ? `<a class="btn btn-outline" href="mailto:${esc(a.email)}">${FWIcon("mail", { size: 15 })} Email</a>` : ""}
    </div>
    <p class="muted" style="margin-top:14px;font-size:0.84rem">Payout queries, spare sourcing at partner rates, dispute resolution, more jobs for your bays — one call.</p>`;
}

function renderProfileG() {
  const f = document.getElementById("gProfileForm");
  const p = G.profile;
  f.name.value = p.name || ""; f.city.value = p.city || "";
  f.phone.value = p.phone || ""; f.gstin.value = p.gstin || "";
  document.getElementById("gIdName").textContent = p.name || "Workshop";
  document.getElementById("gIdCity").textContent = p.city ? p.city + " · Partner" : "FleetWorks Partner";
  document.getElementById("gTopOrg").textContent = p.name || "";
}

function renderAllG() {
  renderDashG(); renderJobs(); renderQuotes(); renderInspG();
  renderStockG(); renderPayG(); renderRateG(); renderAdvG(); renderProfileG();
}

// ---------- Forms ----------
document.getElementById("gAddItem").addEventListener("click", () => {
  document.getElementById("gQuoteItems").insertAdjacentHTML("beforeend", quoteRow());
});
document.getElementById("gQuoteItems").addEventListener("input", quoteTotal);
document.getElementById("gQuoteForm").addEventListener("submit", e => {
  e.preventDefault();
  const jobId = document.getElementById("gQuoteJob").value;
  const job = G.jobs.find(j => j.id === jobId);
  if (!job) { alert("Pick a job first."); return; }
  const items = [...document.querySelectorAll(".gq-row")].map(r => ({
    desc: r.querySelector(".gq-desc").value.trim(),
    qty: +r.querySelector(".gq-qty").value || 1,
    rate: +r.querySelector(".gq-rate").value || 0
  })).filter(it => it.desc);
  if (!items.length) { alert("Add at least one line item."); return; }
  job.estimate = { items, total: items.reduce((s, it) => s + it.qty * it.rate, 0), status: "Sent" };
  job.status = "Estimate Sent";
  saveG();
  document.getElementById("gQuoteItems").innerHTML = quoteRow();
  quoteTotal();
  renderAllG();
  alert("Estimate sent — the owner sees it in their FleetWorks app and approves with one tap.");
});

document.getElementById("gInspItems").innerHTML = GARAGE_CHECK.map((item, i) => `
  <label class="drv-check-row"><input type="checkbox" name="gchk${i}" checked /><span>${item}</span></label>`).join("");
document.getElementById("gInspForm").addEventListener("submit", e => {
  e.preventDefault();
  const jobId = document.getElementById("gInspJob").value;
  const job = G.jobs.find(j => j.id === jobId);
  if (!job) { alert("Pick a job in the workshop."); return; }
  const fd = new FormData(e.target);
  job.inspection = {
    items: GARAGE_CHECK.map((item, i) => ({ item, ok: fd.get("gchk" + i) === "on" })),
    notes: (fd.get("notes") || "").trim()
  };
  saveG(); e.target.reset();
  document.querySelectorAll("#gInspItems input").forEach(c => { c.checked = true; });
  renderAllG();
});

document.getElementById("gStockForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const existing = G.stock.find(p => p.name.toLowerCase() === fd.name.trim().toLowerCase());
  if (existing) { existing.qty = +fd.qty; existing.minQty = +fd.minQty; if (fd.unitCost) existing.unitCost = +fd.unitCost; }
  else G.stock.push({ id: uid(), name: fd.name.trim(), partNo: (fd.partNo || "").trim(), qty: +fd.qty, minQty: +fd.minQty, unitCost: fd.unitCost ? +fd.unitCost : null });
  saveG(); e.target.reset(); renderAllG();
});

document.getElementById("gProfileForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  G.profile = { ...G.profile, name: fd.name.trim(), city: fd.city.trim(), phone: fd.phone.trim(), gstin: fd.gstin.trim().toUpperCase() };
  saveG(); renderAllG();
});

// ---------- Tabs, gate, boot ----------
document.getElementById("gTabBar").addEventListener("click", e => {
  const btn = e.target.closest(".tab-btn");
  if (!btn || !btn.dataset.tab) return;
  document.querySelectorAll("#gTabBar .tab-btn").forEach(b => b.classList.toggle("active", b === btn));
  document.querySelectorAll("#gContent .tab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + btn.dataset.tab));
  document.getElementById("gPageTitle").textContent = (btn.textContent || "").trim();
  document.getElementById("appSide")?.classList.remove("open");
});
document.getElementById("sideToggle")?.addEventListener("click", () => document.getElementById("appSide")?.classList.toggle("open"));
document.getElementById("sideClose")?.addEventListener("click", () => document.getElementById("appSide")?.classList.remove("open"));

function gUnlock() {
  document.getElementById("gGate").hidden = true;
  document.getElementById("gShell").style.display = "";
  document.body.classList.remove("auth-locked");
  if (!G.jobs.length) loadDemoGarage(); else renderAllG();
  document.getElementById("gQuoteItems").innerHTML = quoteRow();
  quoteTotal();
}
document.getElementById("gDemoBtn").addEventListener("click", () => {
  sessionStorage.setItem("fwGarageDemo", "1");
  gUnlock();
});
document.getElementById("gLoginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const err = document.getElementById("gLoginErr");
  err.hidden = true;
  try { await fwCloud.login(fd.email, fd.password); }
  catch (ex) { err.textContent = ex.message; err.hidden = false; }
});
document.getElementById("gLogout").addEventListener("click", () => {
  sessionStorage.removeItem("fwGarageDemo");
  if (window.fwCloud && fwCloud.user()) fwCloud.logout(); else location.reload();
});
document.getElementById("gDemoReset").addEventListener("click", () => {
  if (confirm("Reload the demo garage? Your local changes will be replaced.")) loadDemoGarage();
});

document.body.classList.add("auth-locked");
if ((window.fwCloud && fwCloud.user()) || sessionStorage.getItem("fwGarageDemo")) gUnlock();
