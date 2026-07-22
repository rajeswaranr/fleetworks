/* ============ FleetWorks — driver.js ============
   No-login driver page. The owner generates a Driver Link
   (fleet.html → Drivers → Copy link) that carries owner id, a
   per-driver token, the driver's name and assigned vehicle.
   Entries are posted to the driver_entries table (anon role);
   the owner's app pulls and merges them on next sign-in. */

"use strict";

const qs = new URLSearchParams(location.search);
const OWNER = qs.get("o"), TOKEN = qs.get("t");
const DNAME = qs.get("n") || "Driver", DVEH = qs.get("v") || "";

document.getElementById("drvName").textContent = DNAME;
document.getElementById("drvVeh").textContent = DVEH ? "Vehicle: " + DVEH : "No vehicle assigned";

if (!OWNER || !TOKEN || !DVEH) {
  document.getElementById("drvApp").hidden = true;
  document.getElementById("drvInvalid").hidden = false;
}

// ---------- Tabs ----------
document.getElementById("drvTabs").addEventListener("click", e => {
  const btn = e.target.closest(".tab-btn");
  if (!btn || !btn.dataset.tab) return;
  document.querySelectorAll("#drvTabs .tab-btn").forEach(b => b.classList.toggle("active", b === btn));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "dtab-" + btn.dataset.tab));
});

// ---------- Daily check list (mirrors fleet.js INSPECTION_ITEMS) ----------
const CHECK_ITEMS = [
  "Tyres & pressure", "Brakes & air system", "Lights & indicators", "Horn",
  "Engine oil leak check", "Coolant level", "Battery & terminals",
  "Documents in cabin (RC/Ins/PUC)", "Load body & tarpaulin", "Cabin & seat belts"
];
document.getElementById("dCheckList").innerHTML = CHECK_ITEMS.map((item, i) => `
  <label class="drv-check-row">
    <input type="checkbox" name="chk${i}" checked />
    <span>${item}</span>
  </label>`).join("");

// default dates to today
document.querySelectorAll('input[name="date"]').forEach(i => { i.value = new Date().toISOString().slice(0, 10); });

// ---------- Send ----------
async function send(kind, payload) {
  const r = await fetch(FW_BACKEND.url + "/rest/v1/driver_entries", {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": FW_BACKEND.anonKey, "Prefer": "return=minimal" },
    body: JSON.stringify({ owner_id: OWNER, token: TOKEN, driver_name: DNAME, vehicle_name: DVEH, kind, payload })
  });
  if (!r.ok) throw new Error();
}

const status = document.getElementById("drvStatus");
function flash(ok, msg) {
  status.hidden = false;
  status.textContent = msg;
  status.style.color = ok ? "#0ca30c" : "#d03b3b";
  setTimeout(() => { status.hidden = true; }, 6000);
}

async function handle(form, kind, payload) {
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    await send(kind, payload);
    form.reset();
    document.querySelectorAll('input[name="date"]').forEach(i => { i.value = new Date().toISOString().slice(0, 10); });
    document.querySelectorAll('#dCheckList input[type=checkbox]').forEach(c => { c.checked = true; });
    flash(true, "Sent ✓ — malik ke dashboard mein pahunch gaya.");
  } catch {
    flash(false, "Could not send — check internet and try again.");
  }
  btn.disabled = false;
}

document.getElementById("dFuelForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  handle(e.target, "fuel", { litres: +fd.litres, amount: +fd.amount, odo: +fd.odo, date: fd.date });
});

document.getElementById("dIssForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  handle(e.target, "issue", { title: fd.title.trim(), severity: fd.severity });
});

document.getElementById("dCheckForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const results = CHECK_ITEMS.map((item, i) => ({ item, ok: fd.get("chk" + i) === "on" }));
  handle(e.target, "inspection", {
    results, passed: results.every(r => r.ok),
    odo: +fd.get("odo") || 0, date: new Date().toISOString().slice(0, 10)
  });
});
