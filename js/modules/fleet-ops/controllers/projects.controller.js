/* ============ FleetWorks — fleet-ops/controllers/projects ============
   Projects are the commercial work packages (client, contract, billing terms).
   Sites are the places. A project can run at many sites and a site can host
   many projects (project_sites); vehicles are deployed to a project AT a site
   (site_vehicle_assignments.project_id + site_id).

   Also home of the Income & Expense report, which groups by project, vehicle
   or site. Entries are attributed through the vehicle's deployment on the
   entry's date, so nothing has to be tagged by hand.

   Relies on fleet.controller.js globals: _sites, _siteVeh, _siteStaff, db,
   esc, escAttr, fmtINR, fmtDate, today, openEditModal, closeEditModal,
   dbOrgId, toast, FWIcon, coreDbBacked, fwCloud, loadSites. */

"use strict";

let _projects = [];   // projects rows
let _projSites = {};  // projectId -> [project_sites rows]

// ── Billing types ───────────────────────────────────────────────────────────
// rentalUnit: days one unit spans, used to compute rental income from
// deployment dates. min/extra: labels for the minimum-guarantee terms.
const PROJECT_BILLING_GROUPS = [
  { group: "Per load / quantity", items: [
    { id: "trip",         label: "Per trip",                 unit: "Trip",     rate: "Rate per trip (₹)",          target: "Planned trips",       hint: "A fixed rate for every completed trip or load." },
    { id: "tonnage",      label: "Per tonne (MT)",           unit: "MT",       rate: "Rate per MT (₹)",            target: "Target MT",           hint: "Billed on the weight carried — cement, coal, grain, steel." },
    { id: "tonne_km",     label: "Per tonne-km",             unit: "MT-km",    rate: "Rate per MT-km (₹)",         target: "Target MT-km",        hint: "Weight × distance. Common for long-haul bulk freight." },
    { id: "cubic_metre",  label: "Per cubic metre (m³)",     unit: "m³",       rate: "Rate per m³ (₹)",            target: "Target m³",           hint: "Sand, aggregate, M-sand, soil, ready-mix." },
    { id: "per_unit",     label: "Per unit / bag / piece",   unit: "Unit",     rate: "Rate per unit (₹)",          target: "Target units",        hint: "Bags, cartons, pipes, pieces." },
    { id: "per_delivery", label: "Per delivery / drop",      unit: "Drop",     rate: "Rate per drop (₹)",          target: "Planned drops",       hint: "Multi-drop and last-mile: one rate per stop delivered." },
  ]},
  { group: "Distance / time", items: [
    { id: "km_based",     label: "Per kilometre",            unit: "KM",       rate: "Rate per km (₹)",            target: "Target km",           hint: "Billed on kilometres run.", min: "Minimum billable km", extra: "Rate beyond minimum (₹/km)" },
    { id: "hourly",       label: "Per hour",                 unit: "Hour",     rate: "Rate per hour (₹)",          target: "Target hours",        hint: "Cranes, JCBs, loaders, compactors.", min: "Minimum hours per day", extra: "Overtime rate per hour (₹)" },
    { id: "shift",        label: "Per shift (8 / 12 hr)",    unit: "Shift",    rate: "Rate per shift (₹)",         target: "Target shifts",       hint: "Mining and site work billed by shift.", extra: "Extra-hour rate (₹)" },
  ]},
  { group: "Rental", items: [
    { id: "daily_rental",   label: "Daily rental",           unit: "Day",      rate: "Rate per day (₹)",           target: "Target days",         hint: "Fixed rate per vehicle per day.",   min: "Minimum km per day",   extra: "Extra km rate (₹/km)",   rentalUnit: 1 },
    { id: "weekly_rental",  label: "Weekly rental",          unit: "Week",     rate: "Rate per week (₹)",          target: "Target weeks",        hint: "Fixed rate per vehicle per week.",  min: "Minimum km per week",  extra: "Extra km rate (₹/km)",   rentalUnit: 7 },
    { id: "monthly_rental", label: "Monthly rental",         unit: "Month",    rate: "Rate per month (₹)",         target: "Target months",       hint: "Fixed monthly rate per vehicle.",   min: "Minimum km per month", extra: "Extra km rate (₹/km)",   rentalUnit: 30 },
  ]},
  { group: "Other", items: [
    { id: "lump_sum",     label: "Fixed contract / lump sum", unit: "Contract", rate: "Contract rate (₹)",         target: "Milestones",          hint: "One agreed amount for the whole job." },
    { id: "custom",       label: "Custom terms",             unit: "Unit",     rate: "Rate (₹)",                   target: "Quantity",            hint: "Negotiated or mixed terms — describe in notes." },
  ]},
];
const PROJECT_BILLING = PROJECT_BILLING_GROUPS.flatMap(g => g.items);
function billingMeta(id) { return PROJECT_BILLING.find(b => b.id === id) || PROJECT_BILLING[0]; }

const PROJECT_WORK_TYPES = [
  ["construction", "Construction / infrastructure"], ["road_building", "Road building"],
  ["mining", "Mining / quarry"], ["coal_ash", "Coal / fly-ash"], ["cement_bulk", "Cement / bulk cargo"],
  ["steel_metal", "Steel / metals"], ["agriculture", "Agriculture / produce"],
  ["port_container", "Port / container"], ["fmcg_distribution", "FMCG / distribution"],
  ["ecommerce_lastmile", "E-commerce / last-mile"], ["cold_chain", "Cold chain"],
  ["oil_gas_tanker", "Oil / gas / liquid tanker"], ["staff_passenger", "Staff / passenger transport"],
  ["intercity", "Intercity movement"], ["local_movement", "Local movement"], ["long_haul", "Long haul"],
  ["logistics_hub", "Logistics / warehousing"], ["other", "Other"],
];
const PROJECT_STATUS = ["planned", "active", "paused", "completed", "cancelled"];
const POLICY_LABEL = { owner: "Owner pays", client: "Client pays", shared: "Shared" };
const SITE_ROLE_LABEL = { operating: "Operating", loading: "Loading point", unloading: "Unloading point", both: "Loading & unloading" };

function workTypeLabel(id) {
  return (PROJECT_WORK_TYPES.find(w => w[0] === id) || [])[1]
    || (typeof SITE_TYPE_LABELS !== "undefined" && SITE_TYPE_LABELS[id]) || id || "Other";
}

// ── Data ────────────────────────────────────────────────────────────────────
async function loadProjects() {
  if (!coreDbBacked()) { _projects = []; _projSites = {}; return; }
  _projects = (await fwCloud.authGet("projects", "select=*&order=created_at.desc")) || [];
  _projSites = {};
  if (_projects.length) {
    const links = (await fwCloud.authGet("project_sites", "select=*")) || [];
    links.forEach(r => { (_projSites[r.project_id] = _projSites[r.project_id] || []).push(r); });
  }
}
function projectById(id) { return _projects.find(p => p.id === id); }
function projectsForSite(siteId) {
  return Object.entries(_projSites).filter(([, l]) => l.some(x => x.site_id === siteId))
    .map(([pid]) => projectById(pid)).filter(Boolean);
}
function sitesForProject(projectId) {
  return (_projSites[projectId] || []).map(l => ({ link: l, site: _sites.find(s => s.id === l.site_id) })).filter(x => x.site);
}
function projectDeployments(projectId) {
  return Object.values(_siteVeh).flat().filter(r => r.project_id === projectId && !r.removed_date);
}
function refreshProjectViews() {
  if (typeof renderSites === "function") renderSites();
  renderProjects();
  if (typeof renderSiteHistory === "function") renderSiteHistory();
  if (typeof renderHubSites === "function") renderHubSites();
  if (typeof renderVehicleStatusBoard === "function") renderVehicleStatusBoard();
  if (typeof populateFilterDropdowns === "function") populateFilterDropdowns();
}

// ── Project cards ───────────────────────────────────────────────────────────
function billingSummaryHtml(p) {
  const b = billingMeta(p.billing_basis);
  const bits = [`<strong>${esc(b.label)}</strong>`];
  if (p.rate_per_unit) bits.push(`${fmtINR(p.rate_per_unit)} / ${esc(p.unit_label || b.unit)}`);
  if (p.min_guarantee_qty) bits.push(`min ${p.min_guarantee_qty}${p.extra_rate ? `, extra ${fmtINR(p.extra_rate)}` : ""}`);
  if (p.target_quantity) bits.push(`target ${p.target_quantity} ${esc(b.unit)}`);
  return bits.join(" · ");
}

function projectCard(p, historyMode) {
  const stMeta = { planned: "upcoming", active: "ok", paused: "soon", completed: "upcoming", cancelled: "overdue" }[p.status] || "upcoming";
  const sites = sitesForProject(p.id);
  const deps = projectDeployments(p.id);
  const vehNames = deps.map(r => (db.vehicles.find(v => v.dbId === r.vehicle_id) || {}).name || "?");
  const staff = Object.values(_siteStaff).flat().filter(r => r.project_id === p.id && !r.left_date).length;
  return `<div class="pred-row site-card" style="border-left:3px solid #a855f7">
    <div class="pred-main">
      <span class="fw-badge ${stMeta}" style="font-size:0.7rem">${esc(p.status)}</span>
      <strong style="margin-left:8px">${esc(p.name)}</strong>
      ${p.code ? `<span class="muted" style="font-size:0.78rem"> · ${esc(p.code)}</span>` : ""}
      <span class="fw-chip is-pending" style="margin-left:8px;font-size:0.75rem">${esc(workTypeLabel(p.work_type))}</span>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;font-size:0.8rem">
      ${p.client_name ? `<span>${FWIcon("document", { size: 12 })} Client: <strong>${esc(p.client_name)}</strong>${p.client_contact ? ` · ${esc(p.client_contact)}` : ""}</span>` : ""}
      ${p.manager_name ? `<span>${FWIcon("driver", { size: 12 })} Manager: <strong>${esc(p.manager_name)}</strong></span>` : ""}
      ${p.supervisor_name ? `<span>${FWIcon("eye", { size: 12 })} Supervisor: <strong>${esc(p.supervisor_name)}</strong></span>` : ""}
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;font-size:0.8rem">
      <span>${FWIcon("receipt", { size: 12 })} ${billingSummaryHtml(p)}</span>
      ${p.contract_value ? `<span>${FWIcon("rupee", { size: 12 })} Contract: <strong>${fmtINR(p.contract_value)}</strong></span>` : ""}
      ${p.fuel_policy && p.fuel_policy !== "owner" ? `<span class="muted">Fuel: ${esc(POLICY_LABEL[p.fuel_policy])}</span>` : ""}
      ${p.toll_policy && p.toll_policy !== "owner" ? `<span class="muted">Toll: ${esc(POLICY_LABEL[p.toll_policy])}</span>` : ""}
      ${p.payment_terms_days ? `<span class="muted">Pay in ${p.payment_terms_days} days</span>` : ""}
      ${p.contract_start ? `<span class="muted">From ${fmtDate(p.contract_start)}${p.contract_end ? " to " + fmtDate(p.contract_end) : ""}</span>` : ""}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center;font-size:0.8rem">
      <span class="muted">${FWIcon("mapPin", { size: 12 })} Sites:</span>
      ${sites.length ? sites.map(x => `<span class="fw-chip is-pending" style="font-size:0.75rem">${esc(x.site.name)} · ${esc(SITE_ROLE_LABEL[x.link.site_role] || "Operating")}</span>`).join("") : `<span class="muted">none linked yet</span>`}
    </div>
    <div style="margin-top:8px;font-size:0.8rem">
      <span>${FWIcon("truck", { size: 12 })} <strong>${deps.length}</strong> truck${deps.length === 1 ? "" : "s"} deployed${staff ? ` · ${FWIcon("driver", { size: 12 })} ${staff} staff` : ""}</span>
      ${deploymentRowsHtml(deps)}
    </div>
    <div class="pred-detail" style="margin-top:8px;display:flex;gap:6px 14px;flex-wrap:wrap;align-items:center">
      <button class="btn btn-outline btn-sm" onclick="openEditProject('${p.id}')">${FWIcon("document", { size: 13 })} Edit</button>
      ${historyMode ? `<button class="btn btn-outline btn-sm" onclick="reopenProject('${p.id}')">${FWIcon("check", { size: 13 })} Reopen</button>` : `<button class="btn btn-outline btn-sm" onclick="openDeployVehicles('${p.id}')">${FWIcon("truck", { size: 13 })} Vehicles</button>`}
      <button class="link-btn" onclick="openProjectReport('${p.id}')">${FWIcon("chartBar", { size: 13 })} Income &amp; expenses</button>
      ${historyMode ? "" : `<button class="link-btn" onclick="archiveProject('${p.id}')">${FWIcon("document", { size: 13 })} Archive</button>`}
      <button class="link-btn" style="color:#ef4444;margin-left:auto" onclick="deleteProject('${p.id}')">${FWIcon("trash", { size: 13 })} Delete</button>
    </div>
  </div>`;
}

let _projFilter = "active";
window.setProjectFilter = function (v) { _projFilter = v; renderProjects(); };

function renderProjects() {
  const box = document.getElementById("activeProjectsList");
  if (!box) return;
  if (!coreDbBacked()) { box.innerHTML = "<p class='muted'>Sign in to manage projects.</p>"; return; }
  const counts = { all: _projects.length };
  PROJECT_STATUS.forEach(s => { counts[s] = _projects.filter(p => p.status === s).length; });
  const filters = [["active", "Active"], ["planned", "Planned"], ["paused", "Paused"], ["completed", "Completed"], ["cancelled", "Archived"], ["all", "All"]];
  const list = _projFilter === "all" ? _projects : _projects.filter(p => p.status === _projFilter);
  box.innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">` +
    filters.map(([k, l]) => `<button type="button" class="tab-btn${_projFilter === k ? " active" : ""}" style="padding:6px 12px" onclick="setProjectFilter('${k}')">${l} <span class="muted" style="font-weight:400">${counts[k] || 0}</span></button>`).join("") +
    `</div>` +
    (list.length ? list.map(p => projectCard(p, p.status === "completed" || p.status === "cancelled")).join("")
      : `<p class='muted' style='text-align:center;padding:32px'>No ${_projFilter === "all" ? "" : _projFilter + " "}projects. Click <strong>New Project</strong> to create one.</p>`);
  if (window.FWIcons) FWIcons.hydrate(box);
}
window.renderProjects = renderProjects;
window.renderActiveProjects = renderProjects;

// ── Project form ────────────────────────────────────────────────────────────
function sectionLabel(t) {
  return `<p style="font-size:0.78rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin:0 0 8px">${t}</p>`;
}
const HR = `<hr style="margin:12px 0;border:none;border-top:1px solid var(--line)" />`;

function projectFormHtml(p, linked) {
  p = p || {};
  const cur = p.billing_basis || "trip";
  const vtypes = p.vehicle_types || [];
  const siteRows = _sites.filter(s => s.status !== "cancelled").map(s => {
    const l = linked[s.id];
    return `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid var(--line)">
      <label style="display:flex;align-items:center;gap:8px;flex:1;min-width:180px;cursor:pointer">
        <input type="checkbox" name="site_${s.id}" value="1" ${l ? "checked" : ""} style="margin:0" />
        <span><strong>${esc(s.name)}</strong>${s.location ? ` <span class="muted" style="font-size:0.78rem">· ${esc(s.location)}</span>` : ""}</span>
      </label>
      <select name="siterole_${s.id}" style="height:32px;font-size:0.82rem">
        ${Object.entries(SITE_ROLE_LABEL).map(([k, v]) => `<option value="${k}"${(l ? l.site_role : "operating") === k ? " selected" : ""}>${v}</option>`).join("")}
      </select>
    </div>`;
  }).join("");
  return `
    <div class="form-row">
      <label>Project name *<input type="text" name="name" value="${escAttr(p.name || "")}" required placeholder="e.g. Metro Phase 2 — earthwork" /></label>
      <label>Project code / PO no.<input type="text" name="code" value="${escAttr(p.code || "")}" placeholder="optional" /></label>
    </div>
    <div class="form-row">
      <label>Type of work
        <select name="workType">${PROJECT_WORK_TYPES.map(([v, l]) => `<option value="${v}"${(p.work_type || "other") === v ? " selected" : ""}>${l}</option>`).join("")}</select>
      </label>
      <label>Status
        <select name="status">${PROJECT_STATUS.map(s => `<option value="${s}"${(p.status || "active") === s ? " selected" : ""}>${s}</option>`).join("")}</select>
      </label>
    </div>

    ${HR}${sectionLabel("Client")}
    <div class="form-row">
      <label>Client / company<input type="text" name="clientName" value="${escAttr(p.client_name || "")}" placeholder="Who is the work for?" /></label>
      <label>Client contact<input type="text" name="clientContact" value="${escAttr(p.client_contact || "")}" placeholder="Phone / email" /></label>
    </div>

    ${HR}${sectionLabel("Sites this project runs at")}
    <p class="muted" style="font-size:0.8rem;margin:0 0 6px">A project can run at several sites, and a site can serve several projects. Mark a site as a loading or unloading point when material moves between sites.</p>
    ${siteRows || `<p class="muted" style="margin:0 0 6px">No sites yet — add the first one below.</p>`}
    <div id="projNewSites"></div>
    <button type="button" class="btn btn-outline btn-sm" style="margin-top:8px" onclick="projectAddNewSiteRow()">${FWIcon("plus", { size: 13 })} New site</button>
    <span class="muted" style="font-size:0.78rem;margin-left:8px">Create a site here and it is added and linked when you save.</span>

    ${HR}${sectionLabel("Commercial terms")}
    <div class="form-row">
      <label>Billing basis
        <select name="billingBasis" id="projBilling" onchange="projectFormBillingChange()">
          ${PROJECT_BILLING_GROUPS.map(g => `<optgroup label="${g.group}">${g.items.map(b => `<option value="${b.id}"${cur === b.id ? " selected" : ""}>${b.label}</option>`).join("")}</optgroup>`).join("")}
        </select>
      </label>
      <label><span id="projRateLabel">Rate (₹)</span>
        <input type="number" name="ratePerUnit" min="0" step="0.01" value="${p.rate_per_unit || ""}" placeholder="0.00" />
      </label>
    </div>
    <p class="muted" id="projBillingHint" style="font-size:0.8rem;margin:-4px 0 8px"></p>
    <div class="form-row" id="projMinRow">
      <label><span id="projMinLabel">Minimum</span>
        <input type="number" name="minGuarantee" min="0" step="any" value="${p.min_guarantee_qty || ""}" placeholder="optional" />
      </label>
      <label><span id="projExtraLabel">Extra rate (₹)</span>
        <input type="number" name="extraRate" min="0" step="0.01" value="${p.extra_rate || ""}" placeholder="optional" />
      </label>
    </div>
    <div class="form-row">
      <label><span id="projTargetLabel">Target quantity</span>
        <input type="number" name="targetQty" min="0" step="any" value="${p.target_quantity || ""}" placeholder="optional" />
      </label>
      <label>Total contract value (₹)
        <input type="number" name="contractValue" min="0" step="0.01" value="${p.contract_value || ""}" placeholder="Total ₹ amount" />
      </label>
    </div>
    <div class="form-row">
      <label>Fuel
        <select name="fuelPolicy">${Object.entries(POLICY_LABEL).map(([k, v]) => `<option value="${k}"${(p.fuel_policy || "owner") === k ? " selected" : ""}>${v}</option>`).join("")}</select>
      </label>
      <label>Toll
        <select name="tollPolicy">${Object.entries(POLICY_LABEL).map(([k, v]) => `<option value="${k}"${(p.toll_policy || "owner") === k ? " selected" : ""}>${v}</option>`).join("")}</select>
      </label>
    </div>
    <div class="form-row">
      <label>GST on billing (%)<input type="number" name="gstPercent" min="0" max="100" step="0.01" value="${p.gst_percent ?? ""}" placeholder="e.g. 5 or 12" /></label>
      <label>Payment terms (days)<input type="number" name="paymentTerms" min="0" step="1" value="${p.payment_terms_days ?? ""}" placeholder="e.g. 30" /></label>
    </div>

    <p style="font-size:0.78rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin:8px 0 6px">Vehicle types needed</p>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
      ${VEHICLE_TYPE_OPTIONS.map(t => `<label style="display:flex;align-items:center;gap:4px;font-size:0.8rem;padding:4px 8px;border:1px solid var(--line);border-radius:8px;cursor:pointer">
        <input type="checkbox" name="vt_${t.replace(/[^a-zA-Z]/g, "_")}" value="${escAttr(t)}" ${vtypes.includes(t) ? "checked" : ""} style="margin:0" />${esc(t)}
      </label>`).join("")}
    </div>

    ${HR}${sectionLabel("People &amp; schedule")}
    <div class="form-row">
      <label>Manager<input type="text" name="managerName" value="${escAttr(p.manager_name || "")}" placeholder="Responsible for the project" /></label>
      <label>Supervisor<input type="text" name="supervisorName" value="${escAttr(p.supervisor_name || "")}" placeholder="Daily coordinator" /></label>
    </div>
    <div class="form-row">
      <label>Starts<input type="date" name="contractStart" value="${p.contract_start || ""}" /></label>
      <label>Ends<input type="date" name="contractEnd" value="${p.contract_end || ""}" /></label>
    </div>
    <label>Notes<textarea name="notes" rows="2" style="width:100%">${esc(p.notes || "")}</textarea></label>`;
}

let _newSiteSeq = 0;
window.projectAddNewSiteRow = function () {
  const box = document.getElementById("projNewSites"); if (!box) return;
  const i = ++_newSiteSeq;
  const row = document.createElement("div");
  row.className = "proj-newsite";
  row.style.cssText = "display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;padding:8px 0;border-bottom:1px dashed var(--line)";
  row.innerHTML = `
    <label style="flex:2;min-width:160px;font-size:0.8rem">New site name *<input type="text" name="newSiteName_${i}" placeholder="e.g. Kandla terminal" /></label>
    <label style="flex:2;min-width:140px;font-size:0.8rem">Location<input type="text" name="newSiteLoc_${i}" placeholder="City / district" /></label>
    <label style="flex:1;min-width:150px;font-size:0.8rem">Role
      <select name="newSiteRole_${i}">${Object.entries(SITE_ROLE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
    </label>
    <button type="button" class="link-btn" style="color:#ef4444;margin-bottom:10px" onclick="this.closest('.proj-newsite').remove()">Remove</button>`;
  box.appendChild(row);
  row.querySelector("input").focus();
};

window.projectFormBillingChange = function () {
  const sel = document.getElementById("projBilling");
  if (!sel) return;
  const b = billingMeta(sel.value);
  const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  set("projRateLabel", b.rate);
  set("projTargetLabel", b.target + " (optional)");
  set("projBillingHint", b.hint);
  const hasMin = !!(b.min || b.extra);
  const row = document.getElementById("projMinRow");
  if (row) row.style.display = hasMin ? "" : "none";
  set("projMinLabel", b.min || "Minimum");
  set("projExtraLabel", b.extra || "Extra rate (₹)");
};

function projectRowFromForm(fd, orgId, extra) {
  const vtypes = VEHICLE_TYPE_OPTIONS.filter(t => document.querySelector(`input[name="vt_${t.replace(/[^a-zA-Z]/g, "_")}"]`)?.checked);
  const b = billingMeta(fd.billingBasis);
  const num = v => (v === "" || v == null ? null : +v);
  return {
    org_id: orgId, name: (fd.name || "").trim(), code: (fd.code || "").trim() || null,
    work_type: fd.workType || "other", status: fd.status || "active",
    client_name: (fd.clientName || "").trim() || null, client_contact: (fd.clientContact || "").trim() || null,
    billing_basis: fd.billingBasis || "trip", unit_label: b.unit,
    rate_per_unit: num(fd.ratePerUnit), target_quantity: num(fd.targetQty),
    min_guarantee_qty: num(fd.minGuarantee), extra_rate: num(fd.extraRate),
    fuel_policy: fd.fuelPolicy || "owner", toll_policy: fd.tollPolicy || "owner",
    gst_percent: num(fd.gstPercent), payment_terms_days: num(fd.paymentTerms),
    contract_value: num(fd.contractValue),
    contract_start: fd.contractStart || null, contract_end: fd.contractEnd || null,
    manager_name: (fd.managerName || "").trim() || null, supervisor_name: (fd.supervisorName || "").trim() || null,
    vehicle_types: vtypes, notes: (fd.notes || "").trim() || null,
    ...(extra || {}),
  };
}

// Brings project_sites in line with what was ticked in the form.
async function syncProjectSites(projectId, orgId, fd) {
  const existing = _projSites[projectId] || [];
  const wanted = {};
  _sites.forEach(s => { if (fd["site_" + s.id]) wanted[s.id] = fd["siterole_" + s.id] || "operating"; });
  const toAdd = Object.keys(wanted).filter(id => !existing.some(l => l.site_id === id));
  const toRemove = existing.filter(l => !(l.site_id in wanted));
  const toUpdate = existing.filter(l => l.site_id in wanted && l.site_role !== wanted[l.site_id]);
  if (toAdd.length) {
    const ok = await fwCloud.authInsert("project_sites", toAdd.map(id => ({ project_id: projectId, site_id: id, org_id: orgId, site_role: wanted[id] })));
    if (!ok) throw new Error("Project saved, but linking its sites failed.");
  }
  for (const l of toRemove) await fwCloud.authDelete("project_sites", `id=eq.${l.id}`);
  for (const l of toUpdate) await fwCloud.authPatch(`project_sites?id=eq.${l.id}`, { site_role: wanted[l.site_id] });

  // Sites typed into the form: create each one, then link it to this project.
  for (const key of Object.keys(fd).filter(k => k.startsWith("newSiteName_"))) {
    const n = key.slice("newSiteName_".length);
    const name = (fd[key] || "").trim();
    if (!name) continue;
    const site = await fwCloud.authInsertRet("sites", {
      org_id: orgId, name, site_type: "site", project_type: "other", status: "active",
      location: (fd["newSiteLoc_" + n] || "").trim() || null, created_by: fwCloud.uid(),
    });
    if (!site) throw new Error(`Project saved, but the site "${name}" could not be created.`);
    const ok = await fwCloud.authInsert("project_sites", { project_id: projectId, site_id: site.id, org_id: orgId, site_role: fd["newSiteRole_" + n] || "operating" });
    if (!ok) throw new Error(`Site "${name}" was created, but linking it to the project failed.`);
  }
}

function openProjectModal(title, project, onSave) {
  const linked = {};
  if (project) (_projSites[project.id] || []).forEach(l => { linked[l.site_id] = l; });
  openEditModal(title, projectFormHtml(project, linked), onSave);
  setTimeout(() => window.projectFormBillingChange(), 0);
}

window.openNewProject = function () {
  openProjectModal("New Project", null, async fd => {
    const orgId = await dbOrgId(); if (!orgId) throw new Error("Not signed in.");
    if (!(fd.name || "").trim()) throw new Error("Enter a project name.");
    const row = await fwCloud.authInsertRet("projects", projectRowFromForm(fd, orgId, { created_by: fwCloud.uid() }));
    if (!row) throw new Error("Could not save — check your connection.");
    await syncProjectSites(row.id, orgId, fd);
    toast(`Project "${(fd.name || "").trim()}" created.`);
    closeEditModal();
    await loadSites(); refreshProjectViews();
  });
};

window.openEditProject = function (id) {
  const p = projectById(id); if (!p) return;
  openProjectModal("Edit Project", p, async fd => {
    const orgId = await dbOrgId(); if (!orgId) throw new Error("Not signed in.");
    const ok = await fwCloud.authPatch(`projects?id=eq.${id}`, projectRowFromForm(fd, orgId));
    if (!ok) throw new Error("Could not save — check your connection.");
    await syncProjectSites(id, orgId, fd);
    toast("Project updated.");
    closeEditModal();
    await loadSites(); refreshProjectViews();
  });
};

window.archiveProject = async function (id) {
  const p = projectById(id); if (!p) return;
  if (!(await FWDialog.confirm(`Archive "${p.name}"? It moves to history; deployments and financials are kept.`))) return;
  await fwCloud.authPatch(`projects?id=eq.${id}`, { status: "cancelled" });
  for (const r of projectDeployments(id)) await fwCloud.authPatch(`site_vehicle_assignments?id=eq.${r.id}`, { removed_date: today() });
  toast("Project archived.");
  await loadSites(); refreshProjectViews();
};

window.reopenProject = async function (id) {
  const p = projectById(id); if (!p) return;
  const ok = await fwCloud.authPatch(`projects?id=eq.${id}`, { status: "active" });
  if (!ok) { toast("Could not reopen — check your connection.", "err"); return; }
  toast(`"${p.name}" reopened.`);
  _projFilter = "active";
  await loadSites(); refreshProjectViews();
};

// Permanent. Sites, vehicles and financial entries are untouched; what goes is
// the project record, its site links and the project tag on truck deployments.
window.deleteProject = async function (id) {
  const p = projectById(id); if (!p) return;
  const sites = sitesForProject(id).length;
  const trucks = projectDeployments(id).length;
  const history = Object.values(_siteVeh).flat().filter(r => r.project_id === id).length;
  const msg = `Permanently delete project "${p.name}"?

` +
    `• Its billing terms and ${sites} site link${sites === 1 ? "" : "s"} are removed.
` +
    `• ${trucks} truck${trucks === 1 ? " currently on it stays" : "s currently on it stay"} at ${trucks === 1 ? "its" : "their"} site but ${trucks === 1 ? "loses" : "lose"} the project.
` +
    (history > trucks ? `• ${history - trucks} past deployment record${history - trucks === 1 ? " loses" : "s lose"} the project tag, so their income and expenses will show as unassigned in reports.
` : "") +
    `
Sites, vehicles, trips and expenses are not deleted. This cannot be undone.` +
    `

To just hide it, use Archive instead. Delete anyway?`;
  if (!(await FWDialog.confirm(msg))) return;
  const ok = await fwCloud.authDelete("projects", `id=eq.${id}`);
  if (!ok) { toast("Could not delete the project — check your connection.", "err"); return; }
  toast(`Project "${p.name}" deleted.`);
  await loadSites(); refreshProjectViews();
};

// ── Single-truck deployment: assign, edit, remove ──────────────────────────
// One row per active deployment, with Edit and Remove. Used on project cards
// and site cards.
function deploymentRowsHtml(list) {
  if (!list || !list.length) return "";
  return `<div style="margin-top:4px">` + list.map(r => {
    const v = db.vehicles.find(x => x.dbId === r.vehicle_id);
    const site = _sites.find(x => x.id === r.site_id);
    const p = projectById(r.project_id);
    const basis = r.billing_basis && r.billing_basis !== "site_default" ? billingMeta(r.billing_basis).label : "";
    return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:5px 0;border-top:1px dashed var(--line)">
      <span><strong>${esc(v ? v.name : "Vehicle")}</strong>
        <span class="muted">${site ? "@ " + esc(site.name) : ""}${p ? " · " + esc(p.name) : ""}${basis ? " · " + esc(basis) : ""}${r.rate_per_unit ? " " + fmtINR(r.rate_per_unit) : ""} · since ${fmtDate(r.assigned_date)}</span></span>
      <span style="margin-left:auto;display:flex;gap:10px">
        <button class="link-btn" onclick="openDeploymentModal('${v ? v.id : ""}','${r.id}')">Edit</button>
        <button class="link-btn" style="color:#ef4444" onclick="removeDeployment('${r.id}')">Remove</button>
      </span></div>`;
  }).join("") + `</div>`;
}
window.deploymentRowsHtml = deploymentRowsHtml;

// A project running at a site needs a project_sites link; create it on demand
// so assigning a truck never requires a separate "link the site first" step.
async function ensureSiteLink(projectId, siteId, orgId) {
  if (!projectId || !siteId) return;
  if ((_projSites[projectId] || []).some(l => l.site_id === siteId)) return;
  await fwCloud.authInsert("project_sites", { project_id: projectId, site_id: siteId, org_id: orgId, site_role: "operating" });
}

// Assign a truck to a site (and optionally a project), or edit an existing
// deployment. Changing the site or project closes the old deployment and starts
// a new one today, so history — and the report's attribution — stays correct.
window.openDeploymentModal = function (vehLocalId, svaId) {
  const v = db.vehicles.find(x => x.id === vehLocalId); if (!v) return;
  const all = Object.values(_siteVeh).flat();
  const cur = svaId ? all.find(r => r.id === svaId) : (_vehSiteMap[v.dbId] || {}).sva;
  const sites = _sites.filter(x => x.status !== "cancelled");
  if (!sites.length) { alert("Add a site first (Settings → Sites), then assign vehicles to it."); return; }
  const projects = _projects.filter(x => x.status === "active" || x.status === "planned" || x.id === cur?.project_id);
  const linkedTo = pid => new Set((_projSites[pid] || []).map(l => l.site_id));
  const billingOpts = PROJECT_BILLING.map(b => `<option value="${b.id}"${cur?.billing_basis === b.id ? " selected" : ""}>${b.label}</option>`).join("");
  openEditModal(`${cur ? "Edit deployment" : "Assign"} — ${v.name}`, `
    <p class="muted" style="font-size:0.82rem;margin:0 0 10px">${cur ? "Change where this truck works or its billing terms." : "Choose where this truck works."} A truck is on one site and project at a time; changing the site or project moves it and keeps the old deployment in history.</p>
    <div class="form-row">
      <label>Site *
        <select name="siteId" id="depSite" required>
          <option value="">— pick a site —</option>
          ${sites.map(x => `<option value="${x.id}"${cur?.site_id === x.id ? " selected" : ""}>${esc(x.name)}${x.location ? " · " + esc(x.location) : ""}</option>`).join("")}
        </select>
      </label>
      <label>Project <span class="muted">(optional)</span>
        <select name="projectId" id="depProject">
          <option value="">— none (site only) —</option>
          ${projects.map(x => `<option value="${x.id}"${cur?.project_id === x.id ? " selected" : ""}>${esc(x.name)}${x.client_name ? " · " + esc(x.client_name) : ""}</option>`).join("")}
        </select>
      </label>
    </div>
    <p class="muted" id="depLinkNote" style="font-size:0.78rem;margin:-4px 0 8px"></p>
    <div class="form-row">
      <label>Billing
        <select name="billing"><option value="site_default">Use project default</option>${billingOpts}</select>
      </label>
      <label>Rate (₹) <span class="muted">(blank = project rate)</span>
        <input type="number" name="rate" min="0" step="0.01" value="${cur?.rate_per_unit || ""}" placeholder="0" />
      </label>
    </div>
    <div class="form-row">
      <label>${cur ? "Deployed since" : "From date"}<input type="date" name="fromDate" value="${cur?.assigned_date || today()}" /></label>
      <label>Notes<input type="text" name="notes" value="${escAttr(cur?.notes || "")}" placeholder="optional" /></label>
    </div>
    ${cur ? `<p style="margin:10px 0 0"><button type="button" class="link-btn" style="color:#ef4444" onclick="closeEditModal();removeDeployment('${cur.id}')">Remove from site / project</button></p>` : ""}`,
    async fd => {
      const orgId = await dbOrgId(); if (!orgId) throw new Error("Not signed in.");
      if (!fd.siteId) throw new Error("Pick a site.");
      const projectId = fd.projectId || null;
      const terms = { billing_basis: fd.billing || "site_default", rate_per_unit: fd.rate ? +fd.rate : null, notes: (fd.notes || "").trim() || null };
      const moved = !cur || cur.site_id !== fd.siteId || (cur.project_id || null) !== projectId;
      if (cur && !moved) {
        const ok = await fwCloud.authPatch(`site_vehicle_assignments?id=eq.${cur.id}`, { ...terms, assigned_date: fd.fromDate || cur.assigned_date });
        if (!ok) throw new Error("Could not save — check your connection.");
      } else {
        const open = cur || (_vehSiteMap[v.dbId] || {}).sva;
        // Moving an existing deployment starts the new one on the move date (today,
        // unless a different date was entered), never on the old start date.
        const start = cur && (!fd.fromDate || fd.fromDate === cur.assigned_date) ? today() : (fd.fromDate || today());
        if (open) await fwCloud.authPatch(`site_vehicle_assignments?id=eq.${open.id}`, { removed_date: start < open.assigned_date ? open.assigned_date : start });
        const ok = await fwCloud.authInsert("site_vehicle_assignments", { site_id: fd.siteId, project_id: projectId, vehicle_id: v.dbId, org_id: orgId, assigned_date: start, ...terms });
        if (!ok) throw new Error("Could not assign — check your connection.");
      }
      await ensureSiteLink(projectId, fd.siteId, orgId);
      const site = _sites.find(x => x.id === fd.siteId);
      toast(`${v.name} → ${site ? site.name : "site"}${projectId ? " · " + (projectById(projectId)?.name || "project") : ""}.`);
      closeEditModal();
      await loadSites(); refreshProjectViews();
      if (typeof renderVehicles === "function") renderVehicles();
    });
  setTimeout(() => {
    const note = () => {
      const pid = document.getElementById("depProject")?.value, sid = document.getElementById("depSite")?.value, el = document.getElementById("depLinkNote");
      if (!el) return;
      el.textContent = pid && sid && !linkedTo(pid).has(sid) ? "This site isn't linked to the project yet — it will be linked automatically." : "";
    };
    document.getElementById("depSite")?.addEventListener("change", note);
    document.getElementById("depProject")?.addEventListener("change", note);
    note();
  }, 0);
};

window.openAssignVehicleToSite = function (vehLocalId) { openDeploymentModal(vehLocalId); };

window.removeDeployment = async function (svaId) {
  const r = Object.values(_siteVeh).flat().find(x => x.id === svaId); if (!r) return;
  const v = db.vehicles.find(x => x.dbId === r.vehicle_id);
  const site = _sites.find(x => x.id === r.site_id), p = projectById(r.project_id);
  if (!(await FWDialog.confirm(`Remove ${v ? v.name : "this truck"} from ${site ? site.name : "the site"}${p ? " / " + p.name : ""}?\n\nThe deployment is closed as of today and kept in history, so past income and expenses stay attributed to it.`))) return;
  const ok = await fwCloud.authPatch(`site_vehicle_assignments?id=eq.${svaId}`, { removed_date: today() });
  if (!ok) { toast("Could not remove — check your connection.", "err"); return; }
  toast(`${v ? v.name : "Truck"} removed.`);
  await loadSites(); refreshProjectViews();
  if (typeof renderVehicles === "function") renderVehicles();
};

// ── Deploy vehicles to a project (at one of its sites) ─────────────────────
window.openDeployVehicles = function (projectId) {
  const p = projectById(projectId); if (!p) return;
  const linkedIds = new Set((_projSites[projectId] || []).map(l => l.site_id));
  const linked = [..._sites.filter(x => x.status !== "cancelled")].sort((a, b) => (linkedIds.has(b.id) ? 1 : 0) - (linkedIds.has(a.id) ? 1 : 0)).map(site => ({ site }));
  if (!linked.length) { alert("Add a site first (Settings → Sites), then deploy trucks to this project."); return; }
  const active = projectDeployments(projectId);
  const byVeh = Object.fromEntries(active.map(r => [r.vehicle_id, r]));
  const billingOpts = PROJECT_BILLING.map(b => `<option value="${b.id}">${b.label}</option>`).join("");
  const rows = db.vehicles.map(v => {
    const cur = byVeh[v.dbId];
    const other = !cur && v.dbId ? _vehSiteMap[v.dbId] : null;
    const otherNote = other ? `<span class="muted" style="font-size:0.73rem">(now at ${esc(other.site?.name || "?")}${other.project ? " · " + esc(other.project.name) : ""} — will be moved)</span>` : "";
    return `<div class="sva-row" style="border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:8px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600">
        <input type="checkbox" class="sva-chk" data-dbid="${v.dbId}" ${cur ? "checked" : ""} />
        ${esc(v.name)} <span class="muted" style="font-weight:400;font-size:0.8rem">${esc(v.type || "")}</span> ${otherNote}
      </label>
      <div class="sva-detail" style="display:${cur ? "flex" : "none"};gap:10px;margin-top:8px;flex-wrap:wrap">
        <label style="font-size:0.8rem">Site
          <select class="sva-site" style="height:28px;font-size:0.8rem">${linked.map(x => `<option value="${x.site.id}"${cur?.site_id === x.site.id ? " selected" : ""}>${esc(x.site.name)}${linkedIds.has(x.site.id) ? "" : " (will be linked)"}</option>`).join("")}</select>
        </label>
        <label style="font-size:0.8rem">Billing
          <select class="sva-billing" style="height:28px;font-size:0.8rem">
            <option value="site_default">Project default (${esc(billingMeta(p.billing_basis).label)})</option>
            ${billingOpts.replace(`value="${cur?.billing_basis}"`, `value="${cur?.billing_basis}" selected`)}
          </select>
        </label>
        <label style="font-size:0.8rem">Rate (₹) <span class="muted">(blank = project rate)</span>
          <input type="number" class="sva-rate" min="0" step="0.01" value="${cur?.rate_per_unit || ""}" placeholder="${p.rate_per_unit || "0"}" style="width:90px;height:28px;font-size:0.8rem" />
        </label>
        <label style="font-size:0.8rem">From
          <input type="date" class="sva-date" value="${cur?.assigned_date || today()}" style="height:28px;font-size:0.8rem" />
        </label>
      </div>
    </div>`;
  }).join("");

  openEditModal(`Vehicles — ${p.name}`,
    `<p class="muted" style="font-size:0.82rem;margin-bottom:10px">Tick the trucks working on this project and pick the site each one is at (any site — it is linked to the project automatically). A truck is on one project and site at a time, so ticking one moves it from wherever it is now. Billing can differ per truck.</p><div id="svaList">${rows}</div>`,
    async () => {
      const orgId = await dbOrgId(); if (!orgId) throw new Error("Not signed in.");
      const checked = new Map();
      document.querySelectorAll("#svaList .sva-row").forEach(row => {
        const chk = row.querySelector(".sva-chk");
        if (chk && chk.checked) checked.set(chk.dataset.dbid, {
          site: row.querySelector(".sva-site")?.value, billing: row.querySelector(".sva-billing")?.value || "site_default",
          rate: row.querySelector(".sva-rate")?.value || null, date: row.querySelector(".sva-date")?.value || today(),
        });
      });
      for (const r of active) if (!checked.has(r.vehicle_id)) await fwCloud.authPatch(`site_vehicle_assignments?id=eq.${r.id}`, { removed_date: today() });
      for (const [dbId, c] of checked) {
        const cur = byVeh[dbId];
        const terms = { billing_basis: c.billing, rate_per_unit: c.rate ? +c.rate : null };
        if (cur && cur.site_id === c.site) { await fwCloud.authPatch(`site_vehicle_assignments?id=eq.${cur.id}`, terms); continue; }
        if (cur) await fwCloud.authPatch(`site_vehicle_assignments?id=eq.${cur.id}`, { removed_date: today() });
        else { const prev = _vehSiteMap[dbId]; if (prev) await fwCloud.authPatch(`site_vehicle_assignments?id=eq.${prev.sva.id}`, { removed_date: today() }); }
        const ok = await fwCloud.authInsert("site_vehicle_assignments", { site_id: c.site, project_id: projectId, vehicle_id: dbId, org_id: orgId, assigned_date: c.date, ...terms });
        if (!ok) throw new Error("Could not assign a vehicle — check your connection.");
        await ensureSiteLink(projectId, c.site, orgId);
        (_projSites[projectId] = _projSites[projectId] || []).push({ project_id: projectId, site_id: c.site });
      }
      toast("Vehicle deployments saved.");
      closeEditModal();
      await loadSites(); refreshProjectViews();
    });
  setTimeout(() => {
    document.querySelectorAll("#svaList .sva-chk").forEach(chk => chk.addEventListener("change", () => {
      const d = chk.closest(".sva-row")?.querySelector(".sva-detail"); if (d) d.style.display = chk.checked ? "flex" : "none";
    }));
   }, 0);
};

// ── Income & expense report ─────────────────────────────────────────────────
const PL = { group: "project", from: "", to: "", project: "", site: "", vehicle: "", salary: [], salaryAt: 0, rows: [], entries: [], totals: null };
const PL_COLS = [["fuel", "Fuel"], ["driver", "Driver pay"], ["maint", "Maintenance"], ["toll", "Toll"], ["other", "Other"]];

function plExpenseBucket(category) {
  const c = String(category || "").toLowerCase();
  if (/fuel|diesel|petrol|cng|def\b|adblue/.test(c)) return "fuel";
  if (/toll|fastag/.test(c)) return "toll";
  if (/salary|wage|driver|bata|allowance|payroll/.test(c)) return "driver";
  if (/repair|service|maint|spare|part|labou?r|workshop|tyre|tire|battery|oil|denting|paint/.test(c)) return "maint";
  return "other";
}

async function plLoadSalary(force) {
  if (!(window.fwCloud && fwCloud.user() && typeof getMyOrgId === "function")) return;
  if (!force && Date.now() - PL.salaryAt < 30000) return;
  PL.salaryAt = Date.now();
  const org = await getMyOrgId().catch(() => null); if (!org) return;
  const rows = await fwCloud.authGet("salary_payments", `select=*&org_id=eq.${org}&status=eq.success&limit=2000`).catch(() => null);
  if (rows) PL.salary = rows;
}

function plDeploymentOn(vehDbId, dateStr) {
  if (!vehDbId || !dateStr) return null;
  const list = Object.values(_siteVeh).flat().filter(r => r.vehicle_id === vehDbId && r.assigned_date <= dateStr && (!r.removed_date || dateStr <= r.removed_date));
  list.sort((a, b) => String(b.assigned_date).localeCompare(String(a.assigned_date)));
  return list[0] || null;
}

function plCompute() {
  const { from, to } = PL;
  const inRange = d => d && (!from || d >= from) && (!to || d <= to);
  const vehByExt = Object.fromEntries(db.vehicles.map(v => [v.id, v]));
  const entries = [];
  const push = (kind, bucket, vehExt, date, amount, label) => {
    if (!amount || !inRange(date)) return;
    const v = vehByExt[vehExt];
    const dep = v ? plDeploymentOn(v.dbId, date) : null;
    entries.push({ kind, bucket, date, amount, label, vehicleId: vehExt, vehicleName: v ? v.name : "—", projectId: dep?.project_id || "", siteId: dep?.site_id || "" });
  };
  (db.trips || []).forEach(t => push("freight", "freight", t.vehicleId, t.date, t.freight, `Trip ${t.from || ""}${t.to ? " → " + t.to : ""}`.trim()));
  (db.expenses || []).forEach(e => push("expense", plExpenseBucket(e.category), e.vehicleId, e.date, e.amount, [e.category, e.title, e.vendor].filter(Boolean).join(" · ")));
  (db.fuelLogs || []).forEach(f => { if (!f.opening) push("expense", "fuel", f.vehicleId, f.date, f.amount, `Diesel ${f.litres || 0} L`); });
  PL.salary.forEach(s => {
    const d = db.drivers.find(x => x.id === s.driver_ext_id);
    push("expense", "driver", d ? d.vehicleId : "", String(s.paid_date || s.initiated_at || "").slice(0, 10), Number(s.amount), `${d ? d.name : "Driver"} · ${(window.FW_PAY_CATEGORIES || []).find(c => c.id === s.category)?.label || "Salary"}`);
  });

  // Rental / contract income computed from deployment dates and project terms.
  const rentalDays = { daily_rental: 1, weekly_rental: 7, monthly_rental: 30 };
  Object.values(_siteVeh).flat().forEach(r => {
    const p = projectById(r.project_id); if (!p) return;
    const basis = r.billing_basis && r.billing_basis !== "site_default" ? r.billing_basis : p.billing_basis;
    const per = rentalDays[basis]; if (!per) return;
    const rate = Number(r.rate_per_unit != null && r.rate_per_unit !== "" ? r.rate_per_unit : p.rate_per_unit) || 0; if (!rate) return;
    const s = [r.assigned_date, from].filter(Boolean).sort().pop();
    const e = [r.removed_date || to || today(), to || today()].sort()[0];
    if (!s || !e || s > e) return;
    const days = Math.round((new Date(e) - new Date(s)) / 864e5) + 1;
    const v = db.vehicles.find(x => x.dbId === r.vehicle_id);
    entries.push({ kind: "rental", bucket: "rental", date: e, amount: Math.round(rate * days / per), label: `${billingMeta(basis).label}: ${days} day${days === 1 ? "" : "s"} @ ${fmtINR(rate)}/${billingMeta(basis).unit}`,
      vehicleId: v ? v.id : "", vehicleName: v ? v.name : "—", projectId: r.project_id || "", siteId: r.site_id || "" });
  });
  PL.entries = entries;

  const keyOf = e => PL.group === "vehicle" ? (e.vehicleId || "") : PL.group === "site" ? e.siteId : e.projectId;
  const labelOf = k => {
    if (!k) return PL.group === "vehicle" ? "No vehicle" : "Unassigned (no deployment)";
    if (PL.group === "vehicle") return (vehByExt[k] || {}).name || k;
    if (PL.group === "site") return (_sites.find(s => s.id === k) || {}).name || "Site";
    return (projectById(k) || {}).name || "Project";
  };
  const pass = e => (!PL.project || e.projectId === PL.project) && (!PL.site || e.siteId === PL.site) && (!PL.vehicle || e.vehicleId === PL.vehicle);
  const groups = {};
  entries.filter(pass).forEach(e => {
    const k = keyOf(e);
    const g = groups[k] = groups[k] || { key: k, name: labelOf(k), trips: 0, freight: 0, rental: 0, fuel: 0, driver: 0, maint: 0, toll: 0, other: 0 };
    if (e.kind === "freight") { g.freight += e.amount; g.trips++; }
    else if (e.kind === "rental") g.rental += e.amount;
    else g[e.bucket] += e.amount;
  });
  const rows = Object.values(groups).map(g => {
    g.income = g.freight + g.rental; g.expense = g.fuel + g.driver + g.maint + g.toll + g.other; g.net = g.income - g.expense;
    g.margin = g.income ? Math.round(g.net / g.income * 100) : null; return g;
  }).sort((a, b) => b.income - a.income || b.expense - a.expense);
  const totals = rows.reduce((t, g) => { ["trips", "freight", "rental", "income", "fuel", "driver", "maint", "toll", "other", "expense", "net"].forEach(k => { t[k] = (t[k] || 0) + g[k]; }); return t; }, {});
  totals.margin = totals.income ? Math.round(totals.net / totals.income * 100) : null;
  PL.rows = rows; PL.totals = totals; PL.pass = pass;
}

function plOptions(list, cur, allLabel) {
  return `<option value="">${allLabel}</option>` + list.map(([v, l]) => `<option value="${escAttr(v)}"${cur === v ? " selected" : ""}>${esc(l)}</option>`).join("");
}

function ensurePlPanel() {
  if (document.getElementById("tab-plreport")) return true;
  const host = document.getElementById("fleetContent"); if (!host) return false;
  const s = document.createElement("section"); s.className = "tab-panel"; s.id = "tab-plreport";
  s.innerHTML = `<div class="chart-card">
    <div class="chart-head" style="flex-wrap:wrap;gap:10px">
      <div><h2 class="head-ic"><span class="ic-tile success"><i data-icon="chartBar" data-icon-size="22"></i></span> Income &amp; Expense Report</h2>
      <p class="muted">Profit and loss by project, vehicle or site. Each entry is credited to the project and site its vehicle was deployed to on that date.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-outline btn-sm" id="plCsv">CSV</button>
        <button type="button" class="btn btn-outline btn-sm" id="plXls">Excel</button>
        <button type="button" class="btn btn-outline btn-sm" id="plPdf">PDF / Print</button>
      </div>
    </div>
    <div class="kh-panel" style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px">
      <div id="plControls" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;align-items:end"></div>
    </div>
    <p id="plNote" class="muted" style="font-size:0.82rem;margin:0 0 12px"></p>
    <div id="plCards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px"></div>
    <div id="plTable" style="overflow-x:auto"></div>
    <div id="plDetail"></div>
  </div>`;
  host.appendChild(s);
  if (window.FWIcons) FWIcons.hydrate(s);
  s.querySelector("#plCsv").addEventListener("click", () => plDownload("csv"));
  s.querySelector("#plXls").addEventListener("click", () => plDownload("xls"));
  s.querySelector("#plPdf").addEventListener("click", plPrint);
  return true;
}

function plRenderControls() {
  const iso = d => d.toISOString().slice(0, 10);
  if (!PL.to) PL.to = iso(new Date());
  if (!PL.from) { const d = new Date(); PL.from = iso(new Date(d.getFullYear(), d.getMonth(), 1)); }
  const ctl = document.getElementById("plControls");
  const lab = (t, inner) => `<label style="font-size:0.8rem;font-weight:600;color:var(--muted);display:flex;flex-direction:column;gap:5px">${t}${inner}</label>`;
  ctl.innerHTML =
    lab("Group by", `<select id="plGroup">${[["project", "Project"], ["vehicle", "Vehicle"], ["site", "Site"]].map(([v, l]) => `<option value="${v}"${PL.group === v ? " selected" : ""}>${l}</option>`).join("")}</select>`) +
    lab("From", `<input type="date" id="plFrom" value="${PL.from}" />`) +
    lab("To", `<input type="date" id="plTo" value="${PL.to}" />`) +
    lab("Project", `<select id="plProject">${plOptions(_projects.map(p => [p.id, p.name]), PL.project, "All projects")}</select>`) +
    lab("Site", `<select id="plSite">${plOptions(_sites.map(s => [s.id, s.name]), PL.site, "All sites")}</select>`) +
    lab("Vehicle", `<select id="plVehicle">${plOptions(db.vehicles.map(v => [v.id, v.name]), PL.vehicle, "All vehicles")}</select>`) +
    `<button type="button" class="btn btn-primary" id="plGo">Generate report</button>`;
  const go = () => { plRead(); plRender(); };
  ctl.querySelectorAll("select,input").forEach(el => el.addEventListener("change", go));
  ctl.querySelector("#plGo").addEventListener("click", go);
}
function plRead() {
  const v = id => document.getElementById(id).value;
  PL.group = v("plGroup"); PL.from = v("plFrom"); PL.to = v("plTo"); PL.project = v("plProject"); PL.site = v("plSite"); PL.vehicle = v("plVehicle");
}

function plRender() {
  plCompute();
  const T = PL.totals, rows = PL.rows;
  const money = n => `<span class="${n < 0 ? "kh-neg" : ""}" style="${n < 0 ? "color:#dc2626" : ""}">${fmtINR(n)}</span>`;
  const gLabel = { project: "Project", vehicle: "Vehicle", site: "Site" }[PL.group];
  document.getElementById("plNote").innerHTML =
    `${(db.trips || []).length} trips, ${(db.expenses || []).length} expenses, ${(db.fuelLogs || []).length} fuel entries and ${PL.salary.length} payroll payments loaded. ` +
    `Income is freight logged in Trip Log plus rental billing computed from deployment days × project rate. Entries on days a vehicle wasn't deployed appear under "Unassigned".`;
  document.getElementById("plCards").innerHTML = [
    ["Total income", T.income || 0, "#166534"], ["Total expenses", T.expense || 0, "#92400e"],
    ["Net profit", T.net || 0, (T.net || 0) >= 0 ? "#166534" : "#dc2626"],
  ].map(([l, v, c]) => `<div class="kh-card" style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px"><small style="color:var(--muted);font-weight:600;font-size:0.78rem">${l}</small><b style="display:block;font-size:1.4rem;margin-top:4px;color:${c}">${fmtINR(v)}</b></div>`).join("") +
    `<div class="kh-card" style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px"><small style="color:var(--muted);font-weight:600;font-size:0.78rem">Margin</small><b style="display:block;font-size:1.4rem;margin-top:4px">${T.margin == null ? "—" : T.margin + "%"}</b></div>`;
  const th = "style=\"background:var(--bg-alt);color:var(--ink);text-align:left;padding:10px 12px;border-bottom:2px solid var(--line);white-space:nowrap\"";
  const thn = "style=\"background:var(--bg-alt);color:var(--ink);text-align:right;padding:10px 12px;border-bottom:2px solid var(--line);white-space:nowrap\"";
  const td = "style=\"padding:10px 12px;border-bottom:1px solid var(--line)\"";
  const tdn = "style=\"padding:10px 12px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums\"";
  document.getElementById("plTable").innerHTML = rows.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:0.9rem"><thead><tr>
        <th ${th}>${gLabel}</th><th ${thn}>Trips</th><th ${thn}>Freight</th><th ${thn}>Rental billing</th><th ${thn}>Income</th>
        ${PL_COLS.map(([, l]) => `<th ${thn}>${l}</th>`).join("")}<th ${thn}>Expenses</th><th ${thn}>Net</th><th ${thn}>Margin</th></tr></thead><tbody>` +
      rows.map(g => `<tr style="cursor:pointer" data-key="${escAttr(g.key)}"><td ${td}><strong>${esc(g.name)}</strong></td><td ${tdn}>${g.trips}</td><td ${tdn}>${fmtINR(g.freight)}</td><td ${tdn}>${fmtINR(g.rental)}</td><td ${tdn}><b>${fmtINR(g.income)}</b></td>
        ${PL_COLS.map(([k]) => `<td ${tdn}>${fmtINR(g[k])}</td>`).join("")}<td ${tdn}><b>${fmtINR(g.expense)}</b></td><td ${tdn}><b>${money(g.net)}</b></td><td ${tdn}>${g.margin == null ? "—" : g.margin + "%"}</td></tr>`).join("") +
      `</tbody><tfoot><tr style="font-weight:700"><td ${td} style="background:var(--bg-alt);padding:10px 12px">Total</td><td ${tdn}>${T.trips}</td><td ${tdn}>${fmtINR(T.freight)}</td><td ${tdn}>${fmtINR(T.rental)}</td><td ${tdn}>${fmtINR(T.income)}</td>
        ${PL_COLS.map(([k]) => `<td ${tdn}>${fmtINR(T[k])}</td>`).join("")}<td ${tdn}>${fmtINR(T.expense)}</td><td ${tdn}>${money(T.net)}</td><td ${tdn}>${T.margin == null ? "—" : T.margin + "%"}</td></tr></tfoot></table>
        <p class="muted" style="font-size:0.78rem;margin:8px 0 0">Click a row to see the entries behind it.</p>`
    : `<p class="muted" style="text-align:center;padding:28px">No income or expense entries in this period for the selected filters.</p>`;
  document.getElementById("plDetail").innerHTML = "";
  document.querySelectorAll("#plTable tbody tr").forEach(tr => tr.addEventListener("click", () => plDrill(tr.dataset.key)));
}

function plDrill(key) {
  const keyOf = e => PL.group === "vehicle" ? (e.vehicleId || "") : PL.group === "site" ? e.siteId : e.projectId;
  const list = PL.entries.filter(e => PL.pass(e) && keyOf(e) === key).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const name = (PL.rows.find(r => r.key === key) || {}).name || "";
  const kindLabel = { freight: "Freight", rental: "Rental billing", fuel: "Fuel", driver: "Driver pay", maint: "Maintenance", toll: "Toll", other: "Other" };
  document.getElementById("plDetail").innerHTML = `<h3 style="margin:18px 0 8px">${esc(name)} — entries (${list.length})</h3><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.88rem">
    <thead><tr>${["Date", "Vehicle", "Type", "Details", "Amount"].map((h, i) => `<th style="background:var(--bg-alt);color:var(--ink);text-align:${i === 4 ? "right" : "left"};padding:8px 12px;border-bottom:2px solid var(--line)">${h}</th>`).join("")}</tr></thead><tbody>` +
    list.map(e => `<tr><td style="padding:8px 12px;border-bottom:1px solid var(--line)">${fmtDate(e.date)}</td><td style="padding:8px 12px;border-bottom:1px solid var(--line)">${esc(e.vehicleName)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid var(--line)">${esc(kindLabel[e.bucket] || e.bucket)}</td><td style="padding:8px 12px;border-bottom:1px solid var(--line)">${esc(e.label || "")}</td>
      <td style="padding:8px 12px;border-bottom:1px solid var(--line);text-align:right;color:${e.kind === "expense" ? "#92400e" : "#166534"}">${e.kind === "expense" ? "−" : "+"}${fmtINR(e.amount)}</td></tr>`).join("") + `</tbody></table></div>`;
  document.getElementById("plDetail").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function plReportHtml(styled) {
  const T = PL.totals, gLabel = { project: "Project", vehicle: "Vehicle", site: "Site" }[PL.group];
  const cols = ["Trips", "Freight", "Rental billing", "Income", ...PL_COLS.map(c => c[1]), "Expenses", "Net", "Margin %"];
  const row = g => `<tr><td>${esc(g.name)}</td><td>${g.trips}</td><td>${g.freight}</td><td>${g.rental}</td><td>${g.income}</td>${PL_COLS.map(([k]) => `<td>${g[k]}</td>`).join("")}<td>${g.expense}</td><td>${g.net}</td><td>${g.margin == null ? "" : g.margin}</td></tr>`;
  return `${styled ? `<style>body{font-family:Arial,sans-serif;padding:24px;color:#1c2733}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccd3dc;padding:6px 8px;text-align:right}th:first-child,td:first-child{text-align:left}th{background:#eef2f7}h1{margin:0 0 4px}</style>` : ""}
    <h1>Income &amp; Expense Report — by ${gLabel.toLowerCase()}</h1><div>${esc(PL.from)} to ${esc(PL.to)} &middot; Generated ${new Date().toLocaleDateString("en-IN")}</div><br/>
    <table><thead><tr><th>${gLabel}</th>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${PL.rows.map(row).join("")}
    ${T ? row({ name: "Total", ...T }) : ""}</tbody></table>`;
}
function plDownload(kind) {
  plRead(); plCompute();
  const stamp = new Date().toISOString().slice(0, 10);
  let blob, name;
  if (kind === "csv") {
    const q = s => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
    const head = [{ project: "Project", vehicle: "Vehicle", site: "Site" }[PL.group], "Trips", "Freight", "Rental billing", "Income", ...PL_COLS.map(c => c[1]), "Expenses", "Net", "Margin %"];
    const line = g => [q(g.name), g.trips, g.freight, g.rental, g.income, ...PL_COLS.map(([k]) => g[k]), g.expense, g.net, g.margin == null ? "" : g.margin].join(",");
    blob = new Blob(["﻿" + [head.join(",")].concat(PL.rows.map(line), PL.totals ? [line({ name: "Total", ...PL.totals })] : []).join("\n")], { type: "text/csv;charset=utf-8;" });
    name = `Income_Expense_${PL.group}_${stamp}.csv`;
  } else { blob = new Blob(["﻿" + plReportHtml(false)], { type: "application/vnd.ms-excel;charset=utf-8;" }); name = `Income_Expense_${PL.group}_${stamp}.xls`; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function plPrint() {
  plRead(); plCompute();
  const w = window.open("", "_blank"); if (!w) { alert("Allow pop-ups to export the PDF, or use CSV / Excel."); return; }
  w.document.write(`<!doctype html><title>Income &amp; Expense Report</title>${plReportHtml(true)}`); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

async function renderPlReport() {
  if (!ensurePlPanel()) return;
  await Promise.all([loadSites(), plLoadSalary(true)]);
  plRenderControls();
  plRender();
}
window.renderPlReport = renderPlReport;
window.openProjectReport = function (projectId) {
  PL.group = "vehicle"; PL.project = projectId; PL.site = ""; PL.vehicle = "";
  ensurePlPanel();
  activateTab("plreport");
};
window.PL_REPORT = PL;

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensurePlPanel);
else ensurePlPanel();
