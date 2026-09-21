/* Driver portal: "My trips" (filter by status, dates, vehicle, route) and the
   vehicle document vault (documents of every vehicle the driver is assigned,
   with the file itself where the owner attached one). Loaded after
   driver-console.js; the database's role rules decide what comes back. */
"use strict";

// ---------- My trips, with filters ----------
const DC_TRIP_STATUS = { started: "In progress", completed: "Completed", planned: "Planned", assigned: "Planned", acknowledged: "Planned", cancelled: "Cancelled" };
const _dcTrips = { rows: [], f: { status: "", range: "30", from: "", to: "", vehicle: "", q: "" } };
const DC_SEL = "padding:9px;border:1.5px solid #e2e8f0;border-radius:9px;font-family:inherit";

function dcTripsFiltered() {
  const { f, rows } = _dcTrips, now = new Date(), iso = d => d.toISOString().slice(0, 10);
  let from = f.from, to = f.to;
  if (f.range === "month") { from = iso(new Date(now.getFullYear(), now.getMonth(), 1)); to = ""; }
  else if (f.range === "30") { from = iso(new Date(now - 30 * 864e5)); to = ""; }
  else if (f.range === "all") { from = ""; to = ""; }
  const q = f.q.trim().toLowerCase();
  return rows.filter(t => {
    const d = (t.actual_start || t.trip_date || t.created_at || "").slice(0, 10);
    return (!f.status || DC_TRIP_STATUS[t.status] === f.status) && (!from || d >= from) && (!to || d <= to) &&
      (!f.vehicle || t.vehicle_id === f.vehicle) && (!q || `${t.from_loc || ""} ${t.to_loc || ""}`.toLowerCase().includes(q));
  });
}

function dcTripsPaint() {
  const box = document.getElementById("teamTrips");
  const { f, rows } = _dcTrips, view = dcTripsFiltered();
  const vname = id => (_vehRows[id] || {}).name || "—";
  const chip = (key, val, label) => `<button type="button" class="btn btn-sm ${f[key] === val ? "btn-primary" : "btn-outline"}" onclick="dcTripsSet('${key}','${val}')">${label}</button>`;
  const km = view.reduce((s, t) => s + (+t.km || 0), 0);
  const badge = t => `<span class="fw-badge ${t.status === "completed" ? "ok" : t.status === "started" ? "soon" : t.status === "cancelled" ? "overdue" : "upcoming"}">${dcT(DC_TRIP_STATUS[t.status] || t.status)}</span>`;
  box.innerHTML = `<div class="chart-card">
    <div class="chart-head"><div><h2 class="head-ic"><span class="ic-tile brand"><i data-icon="truck" data-icon-size="20"></i></span> My trips</h2></div></div>
    <div class="form-row" style="margin-bottom:8px">${chip("status", "", "All")}${chip("status", "In progress", "In progress")}${chip("status", "Planned", "Planned")}${chip("status", "Completed", "Completed")}</div>
    <div class="form-row" style="margin-bottom:8px">${chip("range", "month", "This month")}${chip("range", "30", "Last 30 days")}${chip("range", "all", "All time")}</div>
    <div class="form-row" style="margin-bottom:8px">
      <label>From<input type="date" value="${esc(f.from)}" onchange="dcTripsSet('from',this.value)" /></label>
      <label>To<input type="date" value="${esc(f.to)}" onchange="dcTripsSet('to',this.value)" /></label>
    </div>
    <div class="form-row" style="margin-bottom:10px">
      <select onchange="dcTripsSet('vehicle',this.value)" style="${DC_SEL}"><option value="">All vehicles</option>${[...new Set(rows.map(t => t.vehicle_id))].map(id => `<option value="${id}" ${f.vehicle === id ? "selected" : ""}>${esc(vname(id))}</option>`).join("")}</select>
      <input type="text" id="dcTQ" placeholder="Search route" value="${esc(f.q)}" oninput="dcTripsSet('q',this.value,true)" />
    </div>
    <div style="overflow-x:auto"><table class="chart-table-el" style="width:100%">
      <thead><tr><th>Date</th><th>Vehicle</th><th>Route</th><th style="text-align:right">km</th><th>Status</th></tr></thead>
      <tbody>${view.length ? view.map(t => `<tr><td>${fmtDate(t.actual_start || t.trip_date)}</td><td>${esc(vname(t.vehicle_id))}</td><td>${esc(t.from_loc || "—")} → ${esc(t.to_loc || "—")}</td><td style="text-align:right">${t.km ? Math.round(t.km) : "—"}</td><td>${badge(t)}</td></tr>`).join("") : `<tr><td colspan="5" class="muted" style="text-align:center;padding:16px">No trips match.</td></tr>`}</tbody>
    </table></div>
    <p class="muted" style="margin-top:8px;font-size:0.8rem">${view.length} / ${rows.length} trips shown · ${Math.round(km)} km</p>
  </div>`;
  if (window.FWIcons) FWIcons.hydrate(box);
  dcTranslate(box);
}

window.dcTripsSet = function (key, val, keepFocus) {
  const f = _dcTrips.f; f[key] = val;
  if (key === "from" || key === "to") f.range = "custom";
  dcTripsPaint();
  if (keepFocus) { const el = document.getElementById("dcTQ"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
};

async function dcLoadTrips() {
  const box = document.getElementById("teamTrips");
  if (!box || ROLE !== "driver") return;
  const rows = await fwCloud.authGet("trips", `select=id,vehicle_id,from_loc,to_loc,km,status,trip_date,actual_start,actual_end,created_at&org_id=eq.${ORG}&order=created_at.desc&limit=500`).catch(() => null);
  if (!rows) return;
  _dcTrips.rows = rows;
  box.hidden = false;
  dcTripsPaint();
}

// ---------- Vehicle document vault (all of the driver's vehicles) ----------
const _dcVault = { rows: [], f: { vehicle: "", type: "", q: "" } };

// compliance dates kept on the vehicle itself count as documents too
function dcVaultRows(docs) {
  const out = [];
  Object.values(_vehRows).forEach(v => [["Insurance", v.insurance_till], ["PUC", v.puc_till], ["Fitness", v.fitness_till], ["Permit", v.permit_till], ["Road Tax", v.roadtax_till]]
    .filter(([, d]) => d).forEach(([k, d]) => out.push({ id: `c-${v.id}-${k}`, vehicle_id: v.id, doc_type: k, expiry_date: d, note: "" })));
  return out.concat(docs);
}

function dcVaultPaint() {
  const box = document.getElementById("teamVault");
  const { f, rows } = _dcVault, q = f.q.trim().toLowerCase();
  const view = rows.filter(d => (!f.vehicle || d.vehicle_id === f.vehicle) && (!f.type || d.doc_type === f.type) &&
    (!q || `${d.doc_type} ${d.number || ""} ${d.note || ""}`.toLowerCase().includes(q)));
  const vname = id => (_vehRows[id] || {}).name || "—";
  const badge = d => { const n = daysUntil(d); return n == null ? "" : `<span class="fw-badge ${n < 0 ? "overdue" : n <= 30 ? "soon" : "ok"}">${n < 0 ? dcT("Expired") : n + " d"}</span>`; };
  const types = [...new Set(rows.map(d => d.doc_type))].sort();
  box.innerHTML = `<div class="chart-card">
    <div class="chart-head"><div><h2 class="head-ic"><span class="ic-tile info"><i data-icon="document" data-icon-size="20"></i></span> Vehicle document vault</h2></div></div>
    <div class="form-row" style="margin-bottom:10px">
      <select onchange="dcVaultSet('vehicle',this.value)" style="${DC_SEL}"><option value="">All vehicles</option>${Object.values(_vehRows).map(v => `<option value="${v.id}" ${f.vehicle === v.id ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select>
      <select onchange="dcVaultSet('type',this.value)" style="${DC_SEL}"><option value="">All types</option>${types.map(t => `<option ${f.type === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
      <input type="text" id="dcVQ" placeholder="Search document" value="${esc(f.q)}" oninput="dcVaultSet('q',this.value,true)" />
    </div>
    <div style="overflow-x:auto"><table class="chart-table-el" style="width:100%">
      <thead><tr><th>Vehicle</th><th>Document</th><th>Number</th><th>Expires</th><th></th></tr></thead>
      <tbody>${view.length ? view.map(d => `<tr><td>${esc(vname(d.vehicle_id))}</td><td>${esc(dcT(d.doc_type || ""))}</td><td>${esc(d.number || "—")}</td><td>${d.expiry_date ? fmtDate(d.expiry_date) + " " + badge(d.expiry_date) : "—"}</td><td>${d.file_path ? `<button type="button" class="btn btn-sm btn-outline" data-path="${esc(d.file_path)}" onclick="dcOpenDoc(this.dataset.path)">View</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="5" class="muted" style="text-align:center;padding:16px">No documents match.</td></tr>`}</tbody>
    </table></div>
    <p class="muted" style="margin-top:8px;font-size:0.8rem">${view.length} / ${rows.length} documents shown</p>
  </div>`;
  if (window.FWIcons) FWIcons.hydrate(box);
  dcTranslate(box);
}

window.dcVaultSet = function (key, val, keepFocus) {
  _dcVault.f[key] = val; dcVaultPaint();
  if (keepFocus) { const el = document.getElementById("dcVQ"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
};

window.dcOpenDoc = async function (path) {
  const url = await fwCloud.signUrl("vehicle-docs", path, 300);
  if (url) window.open(url, "_blank", "noopener"); else toast("Could not save. Check your connection and try again.", "err");
};

async function dcLoadVault() {
  const box = document.getElementById("teamVault");
  if (!box || ROLE !== "driver") return;
  const docs = await fwCloud.authGet("documents", `select=id,vehicle_id,doc_type,number,expiry_date,note,file_path&org_id=eq.${ORG}&vehicle_id=not.is.null&order=expiry_date.asc.nullslast&limit=500`).catch(() => null);
  _dcVault.rows = dcVaultRows(docs || []);
  box.hidden = false;
  dcVaultPaint();
}
