/* ============ FleetWorks — my.js ============
   Owner portal: sign in / create account (via fwCloud from
   cloudstore.js), then quick entry of diesel fills, expenses,
   problems and vehicles into the shared ff_fleet store. */

"use strict";

const STORE_KEY = "ff_fleet";
function loadStore() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return { ...d, vehicles: d.vehicles || [], expenses: d.expenses || [], fuelLogs: d.fuelLogs || [], issues: d.issues || [] };
  } catch { return { vehicles: [], expenses: [], fuelLogs: [], issues: [] }; }
}
function saveStore() {
  localStorage.setItem(STORE_KEY, JSON.stringify(db));
  if (window.fwCloud) window.fwCloud.push(db);
  document.getElementById("syncState").textContent = "Last saved " + new Date().toLocaleTimeString("en-IN") + " ✓";
}
let db = loadStore();
let selVehicle = null;

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtINR = v => v >= 100000 ? "₹" + (v / 100000).toFixed(1) + "L" : v >= 1000 ? "₹" + (v / 1000).toFixed(1) + "K" : "₹" + Math.round(v);
const fmtDate = d => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const vName = id => (db.vehicles.find(v => v.id === id) || { name: "?" }).name;
const uid = () => "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => new Date().toISOString().slice(0, 10);

// ---------- Auth views ----------
let signupMode = false;
function ownerDisplayName() {
  const p = window.fwCloud && fwCloud.profile();
  const user = window.fwCloud && fwCloud.user();
  return (p && p.full_name) || (user ? user.split("@")[0] : "Owner");
}
function renderAuthState() {
  const user = window.fwCloud && fwCloud.user();
  document.getElementById("authView").hidden = !!user;
  document.getElementById("portalView").hidden = !user;
  document.getElementById("authTopBtn").textContent = user ? ownerDisplayName() : "Sign In";
  if (user) {
    document.getElementById("ownerName").textContent = ownerDisplayName();
    renderPortal();
  }
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

document.getElementById("authTopBtn").addEventListener("click", () => {
  if (fwCloud.user()) window.scrollTo({ top: 0, behavior: "smooth" });
  else document.querySelector("#authForm input").focus();
});
document.getElementById("logoutBtn").addEventListener("click", () => {
  if (confirm("Sign out? Your data stays safely in the cloud.")) fwCloud.logout();
});

// ---------- Vehicle chips ----------
function renderChips() {
  const chips = db.vehicles.map(v =>
    `<button type="button" class="vchip ${selVehicle === v.id ? "sel" : ""}" data-vid="${v.id}">🚛 ${esc(v.name)}</button>`).join("") +
    (db.vehicles.length ? "" : `<p class="muted">No vehicles yet — add one in the 🚛 Vehicle tab first.</p>`);
  ["fuelChips", "expChips", "issChips"].forEach(id => document.getElementById(id).innerHTML = chips);
  document.querySelectorAll(".vchip").forEach(b => b.addEventListener("click", () => {
    selVehicle = b.dataset.vid;
    renderChips();
  }));
}

function needVehicle() {
  if (!selVehicle) { alert("Select a vehicle first — tap a vehicle chip above the form."); return true; }
  return false;
}

// ---------- Stats + recent ----------
function renderPortal() {
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
  document.querySelectorAll('input[name="date"]').forEach(i => { if (!i.value) i.value = today(); });
}

function renderRecent() {
  const items = [
    ...db.fuelLogs.map(f => ({ date: f.date, icon: "⛽", txt: `${vName(f.vehicleId)} — ${f.litres}L diesel, ${fmtINR(f.amount)}` })),
    ...db.expenses.map(e => ({ date: e.date, icon: "🧾", txt: `${vName(e.vehicleId)} — ${e.category}, ${fmtINR(e.amount)}` })),
    ...db.issues.map(i => ({ date: i.createdAt, icon: i.status === "Resolved" ? "✅" : "⚠️", txt: `${vName(i.vehicleId)} — ${i.title} (${i.status})` }))
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  document.getElementById("recentList").innerHTML = items.length ?
    items.map(i => `<div class="pred-row" style="padding:10px 16px"><div class="pred-main" style="font-size:0.88rem">${i.icon} ${esc(i.txt)}<span class="muted" style="font-size:0.78rem">${fmtDate(i.date)}</span></div></div>`).join("")
    : "<p class='muted'>No entries yet. Add your first diesel fill or expense above — takes 10 seconds.</p>";
}

// ---------- Entry forms ----------
document.getElementById("entryTabs").addEventListener("click", e => {
  if (!e.target.dataset.tab) return;
  document.querySelectorAll("#entryTabs .tab-btn").forEach(b => b.classList.toggle("active", b === e.target));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + e.target.dataset.tab));
});

document.getElementById("vehForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const v = { id: "v" + Date.now(), name: fd.name.trim().toUpperCase(), type: fd.type, kmPerMonth: +fd.kmPerMonth };
  db.vehicles.push(v);
  selVehicle = v.id;
  saveStore(); e.target.reset(); renderPortal();
  alert(`${v.name} added! Now add its diesel and expense entries — FleetWorks AI starts learning immediately.`);
});

document.getElementById("fuelForm").addEventListener("submit", e => {
  e.preventDefault();
  if (needVehicle()) return;
  const fd = Object.fromEntries(new FormData(e.target));
  db.fuelLogs = db.fuelLogs || [];
  db.fuelLogs.push({ id: uid(), vehicleId: selVehicle, date: fd.date, litres: +fd.litres, amount: +fd.amount, odo: +fd.odo });
  saveStore(); e.target.reset(); renderPortal();
});

document.getElementById("expForm").addEventListener("submit", e => {
  e.preventDefault();
  if (needVehicle()) return;
  const fd = Object.fromEntries(new FormData(e.target));
  db.expenses.push({ vehicleId: selVehicle, date: fd.date, category: fd.category, amount: +fd.amount, odo: fd.odo ? +fd.odo : undefined });
  saveStore(); e.target.reset(); renderPortal();
});

document.getElementById("issForm").addEventListener("submit", e => {
  e.preventDefault();
  if (needVehicle()) return;
  const fd = Object.fromEntries(new FormData(e.target));
  db.issues.push({ id: uid(), vehicleId: selVehicle, title: fd.title.trim(), severity: fd.severity, status: "Open", createdAt: today(), source: "Owner portal" });
  saveStore(); e.target.reset(); renderPortal();
});

// ---------- Navbar ----------
const navbar = document.getElementById("navbar");
window.addEventListener("scroll", () => navbar.classList.toggle("scrolled", window.scrollY > 10));
document.getElementById("hamburger").addEventListener("click", () =>
  document.getElementById("navLinks").classList.toggle("open"));

renderAuthState();
