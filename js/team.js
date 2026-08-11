/* ============ FleetWorks — team.js ============
   Supervisor / Driver portal. Signs in via fwCloud, then reads and writes
   the NORMALIZED Postgres tables directly (vehicles, fuel_logs, expenses,
   issues, inspections) — never the owner's fleets.data blob, which stays
   owner-only. Row Level Security (db/schema-team-access.sql) is what
   actually restricts a signed-in user to their assigned vehicles; this
   page just renders whatever the database is willing to hand back. */

"use strict";

const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// For values embedded inside a single-quoted JS string literal within an
// HTML attribute (e.g. onclick="fn('...')") — esc() alone doesn't escape
// the ' that delimits that inner string, so a vehicle name containing one
// could break out and inject markup/script into every driver/supervisor
// who opens this portal. JSON.stringify + HTML-escaping the result is safe
// regardless of which characters the value contains.
const escAttr = s => esc(JSON.stringify(s)).replace(/'/g, "&#39;");
const fmtINR = v => "₹" + Math.round(v || 0).toLocaleString("en-IN");
const fmtDate = d => d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
const today = () => new Date().toISOString().slice(0, 10);
const daysUntil = d => d ? Math.round((new Date(d) - new Date()) / 86400000) : null;

let ORG = null, ASSIGN = {}; // ASSIGN[extId] = 'view' | 'update'

function complianceBadge(label, till) {
  if (!till) return "";
  const d = daysUntil(till);
  const cls = d < 0 ? "overdue" : d <= 30 ? "soon" : "ok";
  return `<span class="fw-badge ${cls}" title="${esc(label)}">${esc(label)}: ${d < 0 ? "Expired " + (-d) + "d ago" : d + "d left"}</span>`;
}

async function loadVehicles() {
  // RLS (can_view_vehicle) already restricts this to assigned vehicles —
  // no need to filter client-side; what comes back IS the permission.
  const vehicles = await fwCloud.authGet("vehicles", "select=*&order=name.asc") || [];
  const box = document.getElementById("teamVehicleList");
  box.innerHTML = vehicles.length ? vehicles.map(v => {
    const access = ASSIGN[v.ext_id] || "view";
    return `<div class="chart-card" style="cursor:pointer" onclick="openVehicle(${escAttr(v.id)},${escAttr(v.ext_id)},${escAttr(v.name)},${escAttr(access)})">
      <div class="chart-head" style="margin-bottom:6px"><div>
        <h2 style="font-size:1.05rem"><strong>${esc(v.name)}</strong> <span class="fw-badge ${access === "update" ? "soon" : "upcoming"}">${access === "update" ? "Can update" : "View only"}</span></h2>
        <p class="muted">${esc(v.type || "")}</p>
      </div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${complianceBadge("Insurance", v.insurance_till)}${complianceBadge("PUC", v.puc_till)}${complianceBadge("Fitness", v.fitness_till)}${complianceBadge("Permit", v.permit_till)}${complianceBadge("Road Tax", v.roadtax_till)}
      </div>
    </div>`;
  }).join("") : `<div class="chart-card" style="text-align:center;padding:30px"><p class="muted">No vehicles assigned to you yet — ask your fleet owner to assign one in Team &amp; Access.</p></div>`;
}

window.openVehicle = async function (vehId, extId, name, access) {
  const modal = document.getElementById("teamVehModal");
  const body = document.getElementById("teamVehModalBody");
  body.innerHTML = "<p class='muted'>Loading…</p>";
  modal.style.display = "flex";

  const [fuel, exp, iss, insp, pendingExp] = await Promise.all([
    fwCloud.authGet("fuel_logs", `select=*&vehicle_id=eq.${vehId}&order=log_date.desc&limit=8`),
    fwCloud.authGet("expenses", `select=*&vehicle_id=eq.${vehId}&order=expense_date.desc&limit=8`),
    fwCloud.authGet("issues", `select=*&vehicle_id=eq.${vehId}&order=reported_at.desc.nullslast&limit=8`),
    fwCloud.authGet("inspections", `select=*&vehicle_id=eq.${vehId}&order=inspection_date.desc&limit=5`),
    fwCloud.authGet("expense_change_requests", `select=*&vehicle_id=eq.${vehId}&status=eq.pending&order=created_at.desc&limit=8`),
  ]);

  const listHTML = (rows, empty, fmt) => (rows && rows.length ? rows.map(fmt).join("") : `<p class="muted" style="font-size:0.85rem">${empty}</p>`);

  let html = `<h2 class="head-ic"><span class="ic-tile brand"><i data-icon="truck" data-icon-size="20"></i></span> ${esc(name)}</h2>`;

  if (access === "update") {
    html += `
      <div class="wf-form" style="margin:14px 0">
        <p class="muted" style="font-size:0.8rem;margin-bottom:6px"><strong>Log diesel</strong></p>
        <div class="form-row">
          <input type="number" id="tvLitres" placeholder="Litres" min="0" step="0.01" />
          <input type="number" id="tvFuelAmt" placeholder="₹ amount" min="0" />
          <input type="number" id="tvOdo" placeholder="Odometer" min="0" />
        </div>
        <button class="btn btn-primary btn-sm" style="margin-top:6px" onclick="tvSaveFuel('${vehId}')">${FWIcon("fuel", { size: 14 })} Save Diesel Entry</button>
      </div>
      <div class="wf-form" style="margin:14px 0">
        <p class="muted" style="font-size:0.8rem;margin-bottom:6px"><strong>Log expense</strong></p>
        <div class="form-row">
          <input type="text" id="tvExpCat" placeholder="Category (e.g. Brakes)" />
          <input type="number" id="tvExpAmt" placeholder="₹ amount" min="0" />
        </div>
        <button class="btn btn-primary btn-sm" style="margin-top:6px" onclick="tvSaveExpense('${vehId}')">${FWIcon("receipt", { size: 14 })} Save Expense</button>
      </div>
      <div class="wf-form" style="margin:14px 0">
        <p class="muted" style="font-size:0.8rem;margin-bottom:6px"><strong>Report a problem</strong></p>
        <input type="text" id="tvIssTitle" placeholder="What's wrong?" style="width:100%;margin-bottom:8px" />
        <select id="tvIssSev" style="width:100%;padding:9px;border:1.5px solid #e2e8f0;border-radius:9px;font-family:inherit">
          <option>Low</option><option selected>Medium</option><option>High</option>
        </select>
        <button class="btn btn-primary btn-sm" style="margin-top:6px" onclick="tvSaveIssue('${vehId}')">${FWIcon("alert", { size: 14 })} Report Problem</button>
      </div>
      <p class="field-error" id="tvErr" hidden></p>`;
  }

  html += `<h3 style="font-size:0.85rem;color:var(--navy);margin:14px 0 6px">Recent Fuel</h3>` +
    listHTML(fuel, "No fuel logs yet.", f => `<div class="pred-row" style="padding:8px 4px"><div class="pred-detail" style="font-size:0.85rem">${fmtDate(f.log_date)} · ${f.litres || 0} L · ${fmtINR(f.amount)} · odo ${f.odometer || "—"}</div></div>`) +
    `<h3 style="font-size:0.85rem;color:var(--navy);margin:14px 0 6px">Recent Expenses</h3>` +
    listHTML(pendingExp, "", r => `<div class="pred-row" style="padding:8px 4px"><div class="pred-detail" style="font-size:0.85rem"><span class="fw-badge soon">Pending approval</span> ${fmtDate(r.patch.expense_date)} · ${esc(r.patch.category || "")} · ${fmtINR(r.patch.amount)}</div></div>`) +
    listHTML(exp, "No expenses yet.", e => `<div class="pred-row" style="padding:8px 4px"><div class="pred-detail" style="font-size:0.85rem">${fmtDate(e.expense_date)} · ${esc(e.category || "")} · ${fmtINR(e.amount)}</div></div>`) +
    `<h3 style="font-size:0.85rem;color:var(--navy);margin:14px 0 6px">Issues</h3>` +
    listHTML(iss, "No issues reported.", i => `<div class="pred-row" style="padding:8px 4px"><div class="pred-detail" style="font-size:0.85rem"><span class="fw-badge ${i.status === "Resolved" ? "ok" : "soon"}">${esc(i.status || "Open")}</span> ${esc(i.title || "")}</div></div>`) +
    `<h3 style="font-size:0.85rem;color:var(--navy);margin:14px 0 6px">Inspections</h3>` +
    listHTML(insp, "No inspections yet.", n => `<div class="pred-row" style="padding:8px 4px"><div class="pred-detail" style="font-size:0.85rem">${fmtDate(n.inspection_date)} · ${n.passed ? "Passed ✓" : "Faults found"}</div></div>`);

  body.innerHTML = html;
  if (window.FWIcons) FWIcons.hydrate(body);
};

function tvErr(msg) { const e = document.getElementById("tvErr"); if (e) { e.textContent = msg; e.hidden = false; } }

// team.html doesn't load fleet.js, so this portal needs its own copy of the
// save-confirmation toast (same #fwToast element/CSS, shared via css/style.css).
let toastTimer = null;
function toast(msg, tone) {
  let el = document.getElementById("fwToast");
  if (!el) { el = document.createElement("div"); el.id = "fwToast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = tone || "ok";
  void el.offsetHeight;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

window.tvSaveFuel = async function (vehId) {
  const litres = +document.getElementById("tvLitres").value || 0;
  const amount = +document.getElementById("tvFuelAmt").value || 0;
  const odo = +document.getElementById("tvOdo").value || 0;
  if (!amount) return tvErr("Enter the amount.");
  const ok = await fwCloud.authInsert("fuel_logs", { org_id: ORG, vehicle_id: vehId, log_date: today(), litres, amount, odometer: odo || null });
  if (ok) { toast("Diesel entry saved."); document.getElementById("teamVehModal").style.display = "none"; }
  else tvErr("Could not save — check your access for this vehicle.");
};
// Expenses are never written directly by a supervisor/manager/driver — every
// entry here goes to the owner as a pending request (db/schema-expense-
// approvals.sql). Only the owner's own edits, made in Fleet Manager, write
// straight to the expenses table; this portal never does.
window.tvSaveExpense = async function (vehId) {
  const category = (document.getElementById("tvExpCat").value || "").trim();
  const amount = +document.getElementById("tvExpAmt").value || 0;
  if (!category || !amount) return tvErr("Enter category and amount.");
  const ok = await fwCloud.authInsert("expense_change_requests", {
    org_id: ORG, vehicle_id: vehId, action: "create",
    patch: { expense_date: today(), category, amount },
    requested_by: fwCloud.uid(),
  });
  if (ok) { toast("Submitted — awaiting owner approval."); document.getElementById("teamVehModal").style.display = "none"; }
  else tvErr("Could not submit — check your access for this vehicle.");
};
window.tvSaveIssue = async function (vehId) {
  const title = (document.getElementById("tvIssTitle").value || "").trim();
  const severity = document.getElementById("tvIssSev").value;
  if (!title) return tvErr("Describe the problem.");
  const ok = await fwCloud.authInsert("issues", { org_id: ORG, vehicle_id: vehId, title, severity, status: "Open", reported_at: today(), source: "Team portal" });
  if (ok) { toast("Problem reported."); document.getElementById("teamVehModal").style.display = "none"; }
  else tvErr("Could not save — check your access for this vehicle.");
};

document.getElementById("teamVehModalClose").addEventListener("click", () => { document.getElementById("teamVehModal").style.display = "none"; });

async function unlock() {
  const uid = fwCloud.uid();
  const mem = await fwCloud.authGet("memberships", `select=role,org_id&user_id=eq.${uid}&limit=1`);
  const m = mem && mem[0];
  document.getElementById("teamGate").hidden = true;
  document.getElementById("teamApp").hidden = false;
  if (!m) {
    document.getElementById("teamAccessNote").innerHTML = "No FleetWorks role found for this account yet. Ask your fleet owner to assign you in <strong>Team &amp; Access</strong>.";
    return;
  }
  if (m.role === "owner" || m.role === "manager") {
    document.getElementById("teamAccessNote").innerHTML = `You're an ${esc(m.role)} — use the full <a href="fleet.html">Fleet Manager</a> instead of this portal.`;
    return;
  }
  ORG = m.org_id;
  document.getElementById("teamWhoRole").textContent = m.role === "driver" ? "Driver" : "Supervisor";
  const p = fwCloud.profile && fwCloud.profile();
  document.getElementById("teamWhoName").textContent = (p && p.full_name) || (fwCloud.user() || "").split("@")[0];

  const assigns = await fwCloud.authGet("vehicle_assignments", `select=vehicle_ext_id,access&user_id=eq.${uid}&org_id=eq.${ORG}`) || [];
  ASSIGN = Object.fromEntries(assigns.map(a => [a.vehicle_ext_id, a.access]));
  document.getElementById("teamAccessNote").textContent = m.role === "driver"
    ? "Tap a vehicle to log diesel, expenses or a problem, and see its recent history."
    : "Tap a vehicle to see its recent fuel, expenses, issues and inspections.";
  await loadVehicles();
}

document.getElementById("teamLoginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const err = document.getElementById("teamLoginErr");
  err.hidden = true;
  try { await fwCloud.login(fd.email, fd.password); }
  catch (ex) { err.textContent = ex.message; err.hidden = false; }
});
window.FWAuthReset?.wire({
  buttonId: "teamForgotPasswordBtn",
  panelId: "teamForgotPasswordPanel",
  formId: "teamForgotPasswordForm",
  backId: "teamForgotBackToSignIn",
  errorId: "teamForgotPasswordErr",
  noteId: "teamForgotPasswordNote",
  loginFormId: "teamLoginForm",
  hideOnOpen: ["teamLoginForm", "teamForgotPasswordWrap"],
  showOnClose: ["teamLoginForm", "teamForgotPasswordWrap"]
});
document.getElementById("teamLogoutBtn").addEventListener("click", () => fwCloud.logout());

if (window.fwCloud && fwCloud.user()) unlock();
