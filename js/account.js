/* ============ FleetWorks — account.js ============
   My Account tab inside the Fleet Manager shell: sign in / create
   account (via fwCloud from cloudstore.js), then quick entry of
   diesel fills, expenses, problems and vehicles into the shared
   `db` global from fleet.js. */

"use strict";

let selVehicle = null;
const today = () => new Date().toISOString().slice(0, 10);

// ---------- Auth views ----------
let signupMode = false;
function ownerDisplayName() {
  const p = window.fwCloud && fwCloud.profile();
  const user = window.fwCloud && fwCloud.user();
  return (p && p.full_name) || (user ? user.split("@")[0] : "Owner");
}

// ---------- Auth gate (Fleetio-style: signed out = clean login page, no app chrome) ----------
function authLocked() {
  return !(window.fwCloud && fwCloud.user()) && !sessionStorage.getItem("fwDemo");
}
function applyAuthGate() {
  const locked = authLocked();
  document.getElementById("authGate").hidden = !locked;
  const shell = document.querySelector(".app-shell");
  if (shell) shell.style.display = locked ? "none" : "";
  document.body.classList.toggle("auth-locked", locked);
}
function openGate() {
  sessionStorage.removeItem("fwDemo");
  applyAuthGate();
  window.scrollTo(0, 0);
}

document.getElementById("demoModeBtn").addEventListener("click", () => {
  sessionStorage.setItem("fwDemo", "1");
  applyAuthGate();
  if (!db.vehicles.length) loadDemoFleet();
  renderAuthState();
  window.fwActivateHashTab?.();
});
document.getElementById("openGateBtn").addEventListener("click", openGate);

function updateAuthPill() {
  const pill = document.getElementById("authPill");
  if (!pill) return;
  const user = window.fwCloud && fwCloud.user();
  pill.innerHTML = user
    ? `<span class="side-plan-t">${esc(ownerDisplayName())}</span>
       <button type="button" class="btn btn-outline btn-sm btn-block" id="pillLogout">Sign Out</button>`
    : `<span class="side-plan-t">15-Day Free Trial</span>
       <button type="button" class="btn btn-primary btn-sm btn-block" id="pillSignIn">Sign In / Create Account</button>`;
  document.getElementById("pillSignIn")?.addEventListener("click", openGate);
  document.getElementById("pillLogout")?.addEventListener("click", doLogout);

  // sidebar identity block: transporter name + username
  const idBox = document.getElementById("sideIdentity");
  if (idBox) {
    const p = window.fwCloud && fwCloud.profile();
    const org = (p && p.transport_name) || (db.settings && db.settings.businessName) || "My Fleet";
    idBox.hidden = false;
    document.getElementById("idOrg").textContent = org;
    document.getElementById("idUser").textContent = user ? ownerDisplayName() : "Demo mode";
  }
  const hg = document.getElementById("hubGreeting");
  if (hg) hg.textContent = user ? "Welcome back, " + ownerDisplayName() : "Welcome to FleetWorks";
}

function doLogout() {
  if (confirm("Sign out? Your data stays safely in the cloud.")) fwCloud.logout();
}

function renderAuthState() {
  const user = window.fwCloud && fwCloud.user();
  applyAuthGate();
  // a real account never inherits demo data, and never sees the demo loader
  if (user && window.clearDemoForOwner) clearDemoForOwner();
  if (window.syncDemoButton) syncDemoButton();
  document.getElementById("portalView").hidden = !user;
  document.getElementById("accountSignedOut").hidden = !!user;
  if (user) {
    document.getElementById("ownerName").textContent = ownerDisplayName();
    renderAccountPortal();
  }
  updateAuthPill();
}

const signupFields = document.getElementById("signupOnlyFields");
document.getElementById("authToggle").addEventListener("click", () => {
  signupMode = !signupMode;
  signupFields.hidden = !signupMode;
  signupFields.querySelectorAll("input").forEach(i => { i.required = signupMode; });
  document.getElementById("authTitle").textContent = signupMode ? "Create Owner Account" : "Owner Sign In";
  document.getElementById("authSubmit").textContent = signupMode ? "Create Free Account" : "Sign In";
  document.getElementById("authToggle").textContent = signupMode ? "Already have an account? Sign in" : "New owner? Create free account";
});

const mobileInput = document.querySelector('#signupOnlyFields input[name="mobile"]');
mobileInput.addEventListener("input", () => { mobileInput.value = mobileInput.value.replace(/\D/g, "").slice(0, 10); });

document.getElementById("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const err = document.getElementById("authErr"), note = document.getElementById("authNote");
  err.hidden = true; note.hidden = true;
  try {
    if (signupMode) {
      if (!fd.fullName || !fd.fullName.trim()) { err.textContent = "Please enter your name."; err.hidden = false; return; }
      if (!fd.transportName || !fd.transportName.trim()) { err.textContent = "Please enter your transport / company name."; err.hidden = false; return; }
      const gstPan = (fd.gstPan || "").trim().toUpperCase();
      const isGst = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gstPan);
      const isPan = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(gstPan);
      if (!isGst && !isPan) { err.textContent = "Enter a valid 15-digit GSTIN or 10-character PAN to start your trial."; err.hidden = false; return; }
      if (!/^[6-9]\d{9}$/.test(fd.mobile || "")) { err.textContent = "Enter a valid 10-digit mobile number."; err.hidden = false; return; }
      const profile = {
        full_name: fd.fullName.trim(),
        transport_name: fd.transportName.trim(),
        gst_pan: gstPan,
        gst_pan_type: isGst ? "GSTIN" : "PAN",
        mobile: fd.mobile,
        fleet_size: fd.fleetSize ? +fd.fleetSize : null,
        trial_started: new Date().toISOString().slice(0, 10)
      };
      const res = await fwCloud.signup(fd.email, fd.password, profile);
      if (res === "ready") { await fwCloud.pull(); location.reload(); }
      else { showEmailConfirm(fd.email); }
    } else {
      await fwCloud.login(fd.email, fd.password);
      location.reload();
    }
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});

// ---------- Email-confirmation panel ----------
function showEmailConfirm(email) {
  document.getElementById("confirmEmail").textContent = email;
  document.getElementById("authForm").hidden = true;
  document.getElementById("authTitle").hidden = true;
  const sub = document.getElementById("authTitle").nextElementSibling;
  if (sub) sub.hidden = true;
  document.getElementById("authConfirm").hidden = false;
}
document.getElementById("backToSignIn").addEventListener("click", () => location.reload());
document.getElementById("resendConfirm").addEventListener("click", async () => {
  const email = document.getElementById("confirmEmail").textContent;
  const rn = document.getElementById("resendNote");
  rn.hidden = false; rn.textContent = "Sending…";
  try { await fwCloud.resend(email); rn.textContent = "Link re-sent — check your inbox (and spam)."; }
  catch (ex) { rn.textContent = ex.message; }
});

document.getElementById("accLogoutBtn").addEventListener("click", doLogout);

// ---------- Vehicle chips ----------
function renderChips() {
  const chips = db.vehicles.map(v =>
    `<button type="button" class="vchip ${selVehicle === v.id ? "sel" : ""}" data-vid="${v.id}">${FWIcon("truck", { size: 14 })} ${esc(v.name)}</button>`).join("") +
    (db.vehicles.length ? "" : `<p class="muted">No vehicles yet — add one in the Vehicle tab first.</p>`);
  ["qeFuelChips", "qeExpChips", "qeIssChips"].forEach(id => document.getElementById(id).innerHTML = chips);
  document.querySelectorAll("#tab-account .vchip").forEach(b => b.addEventListener("click", () => {
    selVehicle = b.dataset.vid;
    renderChips();
  }));
}

function needVehicle() {
  if (!selVehicle) { alert("Select a vehicle first — tap a vehicle chip above the form."); return true; }
  return false;
}

function markSynced() {
  const el = document.getElementById("syncState");
  if (el) el.textContent = "Last saved " + new Date().toLocaleTimeString("en-IN") + " ✓";
}

// ---------- Stats + recent ----------
function renderAccountPortal() {
  const nowM = today().slice(0, 7);
  const monthSpend = db.expenses.filter(e => e.date.slice(0, 7) === nowM).reduce((s, e) => s + e.amount, 0) +
    db.fuelLogs.filter(f => f.date.slice(0, 7) === nowM).reduce((s, f) => s + f.amount, 0);
  const openIss = db.issues.filter(i => i.status !== "Resolved").length;
  document.getElementById("ownerStats").innerHTML = `
    <div class="stat-tile"><span class="stat-label">My vehicles</span><span class="stat-value">${db.vehicles.length}</span></div>
    <div class="stat-tile"><span class="stat-label">This month (all-in)</span><span class="stat-value">${fmtINR(monthSpend)}</span><span class="stat-sub">diesel + expenses</span></div>
    <div class="stat-tile"><span class="stat-label">Open problems</span><span class="stat-value" style="color:${openIss ? "#d03b3b" : "#0ca30c"}">${openIss}</span></div>
    <div class="stat-tile"><span class="stat-label">Total entries</span><span class="stat-value">${db.expenses.length + db.fuelLogs.length}</span><span class="stat-sub">feeding your AI</span></div>`;
  if (!selVehicle && db.vehicles.length) selVehicle = db.vehicles[0].id;
  renderChips();
  renderRecent();
  document.querySelectorAll('#tab-account input[name="date"]').forEach(i => { if (!i.value) i.value = today(); });
}

function renderRecent() {
  const items = [
    ...db.fuelLogs.map(f => ({ date: f.date, ic: "fuel", tone: "info", txt: `${vName(f.vehicleId)} — ${f.litres}L diesel, ${fmtINR(f.amount)}` })),
    ...db.expenses.map(e => ({ date: e.date, ic: "receipt", tone: "brand", txt: `${vName(e.vehicleId)} — ${e.category}, ${fmtINR(e.amount)}` })),
    ...db.issues.map(i => ({ date: i.createdAt, ic: i.status === "Resolved" ? "checkCircle" : "alert", tone: i.status === "Resolved" ? "success" : "warning", txt: `${vName(i.vehicleId)} — ${i.title} (${i.status})` }))
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  document.getElementById("recentList").innerHTML = items.length ?
    items.map(i => `<div class="pred-row" style="padding:10px 16px"><div class="pred-main" style="font-size:0.88rem;display:flex;align-items:center;gap:9px"><span class="ic-tile ${i.tone}" style="width:28px;height:28px;flex:none">${FWIcon(i.ic, { size: 15 })}</span><span style="flex:1;min-width:0">${esc(i.txt)}</span><span class="muted" style="font-size:0.78rem;flex:none">${fmtDate(i.date)}</span></div></div>`).join("")
    : "<p class='muted'>No entries yet. Add your first diesel fill or expense above — takes 10 seconds.</p>";
}

// ---------- Entry forms ----------
document.getElementById("entryTabs").addEventListener("click", e => {
  // closest() so clicks on the inner SVG icon still resolve to the tab button
  const btn = e.target.closest(".tab-btn");
  if (!btn || !btn.dataset.tab) return;
  document.querySelectorAll("#entryTabs .tab-btn").forEach(b => b.classList.toggle("active", b === btn));
  document.querySelectorAll("#tab-account .tab-panel").forEach(p => p.classList.toggle("active", p.id === "qe-" + btn.dataset.tab));
});

function afterQuickSave(form) {
  saveStore();
  markSynced();
  form.reset();
  renderAll();
}

// Vehicles are added on the FleetOps → Add Vehicle page, not here.

document.getElementById("qeFuelForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (needVehicle()) return;
  const fd = Object.fromEntries(new FormData(e.target));
  const f = { vehicleId: selVehicle, date: fd.date, litres: +fd.litres, amount: +fd.amount, odo: +fd.odo };
  if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const saved = await dbCreateFuelLog(f);
    if (!saved) { alert("Could not save — check your connection and try again."); return; }
    db.fuelLogs.push(saved);
  } else {
    db.fuelLogs = db.fuelLogs || [];
    db.fuelLogs.push({ id: uid(), ...f });
  }
  afterQuickSave(e.target);
});

document.getElementById("qeExpForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (needVehicle()) return;
  const fd = Object.fromEntries(new FormData(e.target));
  const ex = { vehicleId: selVehicle, date: fd.date, category: fd.category, amount: +fd.amount, odo: fd.odo ? +fd.odo : undefined };
  if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const saved = await dbCreateExpense(ex);
    if (!saved) { alert("Could not save — check your connection and try again."); return; }
    db.expenses.push(saved);
  } else {
    db.expenses.push(ex);
  }
  afterQuickSave(e.target);
});

document.getElementById("qeIssForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (needVehicle()) return;
  const fd = Object.fromEntries(new FormData(e.target));
  const iss = { vehicleId: selVehicle, title: fd.title.trim(), severity: fd.severity, status: "Open", createdAt: today(), source: "Owner portal" };
  if (typeof coreDbBacked === "function" && coreDbBacked()) {
    const saved = await dbCreateIssue(iss);
    if (!saved) { alert("Could not save — check your connection and try again."); return; }
    db.issues.push(saved);
  } else {
    db.issues.push({ id: uid(), ...iss });
  }
  afterQuickSave(e.target);
});

// ---------- Driver Link ingestion ----------
// Pull unconsumed driver_entries (posted from driver.html) into the fleet,
// then mark them consumed. Silently no-ops if signed out or table missing.
async function syncDriverEntries() {
  if (!(window.fwCloud && fwCloud.user())) return;
  let rows;
  try { rows = await fwCloud.authGet("driver_entries", "select=*&consumed=eq.false&order=created_at.asc&limit=100"); }
  catch { return; }
  if (!Array.isArray(rows) || !rows.length) return;
  const findVehicle = name => db.vehicles.find(v => v.name.toLowerCase() === String(name || "").trim().toLowerCase());
  let merged = 0;
  for (const r of rows) {
    const v = findVehicle(r.vehicle_name);
    if (!v) continue; // unknown vehicle name: leave pending so the owner can fix the assignment
    const p = r.payload || {};
    const day = (p.date || r.created_at || "").slice(0, 10);
    if (r.kind === "fuel") {
      const f = { vehicleId: v.id, date: day, litres: +p.litres || 0, amount: +p.amount || 0, odo: +p.odo || 0 };
      const saved = await dbCreateFuelLog(f); // syncDriverEntries only runs signed-in, so this is always DB-backed
      if (saved) db.fuelLogs.push(saved); else continue; // couldn't save — leave the entry pending, don't mark consumed
    }
    else if (r.kind === "issue") {
      const iss = { vehicleId: v.id, title: String(p.title || "Reported by driver"), severity: p.severity || "Medium", status: "Open", createdAt: day, source: "Driver: " + (r.driver_name || "link") };
      const saved = await dbCreateIssue(iss); // syncDriverEntries only runs signed-in, so always DB-backed
      if (saved) db.issues.push(saved); else continue;
    }
    else if (r.kind === "inspection") {
      const ins = { vehicleId: v.id, date: day, odo: +p.odo || 0, results: Array.isArray(p.results) ? p.results : [], passed: !!p.passed, notes: "Driver check — " + (r.driver_name || "link") };
      const saved = await dbCreateInspection(ins);
      if (saved) db.inspections.push(saved); else continue;
    }
    else continue;
    merged++;
    await fwCloud.authPatch("driver_entries?id=eq." + r.id, { consumed: true });
  }
  if (merged) { saveStore(); renderAll(); markSynced(); }
}

// ---------- Team & Access (supervisors / drivers, DB-enforced) ----------
let myOrgId = null;
async function getMyOrgId() {
  if (myOrgId) return myOrgId;
  if (!(window.fwCloud && fwCloud.user())) return null;
  const rows = await fwCloud.authGet("memberships", "select=org_id&role=in.(owner,manager)&limit=1").catch(() => null);
  myOrgId = rows && rows[0] ? rows[0].org_id : null;
  return myOrgId;
}

function renderTeamPicker() {
  const box = document.getElementById("teamVehiclePicker");
  if (!box) return;
  const roleSel = document.getElementById("teamRole");
  const defAccess = roleSel && roleSel.value === "driver" ? "update" : "view";
  box.innerHTML = db.vehicles.length ? db.vehicles.map(v => `
    <label class="drv-check-row" style="justify-content:space-between">
      <span style="display:flex;align-items:center;gap:10px"><input type="checkbox" class="tv-chk" value="${esc(v.id)}" /><span>${esc(v.name)}</span></span>
      <select class="tv-access" data-veh="${esc(v.id)}">
        <option value="view" ${defAccess === "view" ? "selected" : ""}>View only</option>
        <option value="update" ${defAccess === "update" ? "selected" : ""}>Can update</option>
      </select>
    </label>`).join("") : "<p class='muted'>Add vehicles first — FleetOps → Add Vehicle.</p>";
}
document.getElementById("teamRole")?.addEventListener("change", renderTeamPicker);

async function renderTeamRoster() {
  const el = document.getElementById("teamRosterTable");
  if (!el) return;
  const url = location.origin + location.pathname.replace(/[^/]*$/, "team.html");
  const urlEl = document.getElementById("teamPortalUrl");
  if (urlEl) urlEl.textContent = url;
  if (!(window.fwCloud && fwCloud.user())) { el.innerHTML = "<p class='muted'>Sign in to manage your team.</p>"; return; }
  const org = await getMyOrgId();
  if (!org) { el.innerHTML = "<p class='muted'>No organization found yet — save something once while signed in, then reload this tab.</p>"; return; }
  const rows = await fwCloud.authRpc("team_roster", { p_org: org });
  if (!rows) { el.innerHTML = "<p class='muted'>Team roster needs <code>db/schema-team-access.sql</code> run once in Supabase.</p>"; return; }
  el.innerHTML = rows.length ?
    `<table class="chart-table-el"><thead><tr><th>Name / Email</th><th>Role</th><th>Vehicles</th><th></th></tr></thead><tbody>` +
    rows.map(r => `<tr><td>${esc(r.email)}</td><td><span class="fw-badge upcoming">${esc(r.role)}</span></td>
      <td>${(r.assigned_vehicles || []).map(id => { const v = db.vehicles.find(x => x.id === id); return esc(v ? v.name : id); }).join(", ") || "<span class='muted'>none</span>"}</td>
      <td>${r.role === "owner" ? "" : `<button class="link-btn" style="color:#b91c1c" onclick="teamRevoke('${r.membership_id}')">Revoke</button>`}</td></tr>`).join("") + "</tbody></table>"
    : "<p class='muted'>No team members yet — invite a supervisor or driver above.</p>";
}

window.teamRevoke = async function (membershipId) {
  if (!confirm("Revoke this person's FleetWorks access? They will no longer be able to sign in to your fleet.")) return;
  const ok = await fwCloud.authDelete("memberships", "id=eq." + membershipId);
  if (ok) renderTeamRoster(); else alert("Could not revoke — check your connection and try again.");
};

document.getElementById("teamInviteForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const errEl = document.getElementById("teamInviteErr");
  errEl.hidden = true;
  if (!(window.fwCloud && fwCloud.user())) { errEl.textContent = "Sign in first."; errEl.hidden = false; return; }
  const fd = Object.fromEntries(new FormData(e.target));
  const vehicles = [...document.querySelectorAll("#teamVehiclePicker .tv-chk:checked")].map(c => ({
    extId: c.value,
    access: document.querySelector(`.tv-access[data-veh="${CSS.escape(c.value)}"]`).value
  }));
  if (!vehicles.length) { errEl.textContent = "Tick at least one vehicle to assign."; errEl.hidden = false; return; }
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    const res = await fwCloud.callFunction("team-invite", { email: fd.email, password: fd.password, name: fd.name, role: fd.role, vehicles });
    const url = location.origin + location.pathname.replace(/[^/]*$/, "team.html");
    alert(`${fd.name} can now sign in at:\n${url}\n\nEmail: ${res.email}\n\nShare the password with them directly (call/in person) — not over WhatsApp or SMS.`);
    e.target.reset();
    renderTeamPicker();
    renderTeamRoster();
  } catch (ex) {
    errEl.textContent = ex.message || "Could not create the login.";
    errEl.hidden = false;
  }
  btn.disabled = false;
});

const _origRenderAuthStateForTeam = renderAuthState;
renderAuthState = function () {
  _origRenderAuthStateForTeam();
  renderTeamPicker();
  renderTeamRoster();
};

renderAuthState();
syncDriverEntries();
