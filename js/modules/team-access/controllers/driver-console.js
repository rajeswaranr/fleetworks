/* Driver console for the team portal: start / end a trip, ask the owner for diesel,
   advance or toll, the vehicle document vault, and a khata book with filters —
   in English or Tamil (தமிழ்).

   It builds on team.controller.js (same page, loaded after it) and only ever acts
   for the signed-in driver: every read and write goes through the database's
   role rules, so a driver can touch only their own khata and their assigned
   vehicle whatever this page does. Strings are written in English and translated
   by dcTranslate() from one dictionary. */
"use strict";

// ---------- language ----------
const DC_TA = {
  "My Khata": "என் கணக்கு (கத்தா)", "Advances": "முன்பணம்", "Expenses": "செலவுகள்", "Returned": "திருப்பியது", "With me": "என்னிடம்",
  "Only your own entries. Cash with you = advances − expenses − amounts returned.": "உங்கள் பதிவுகள் மட்டும். உங்களிடம் உள்ள பணம் = முன்பணம் − செலவு − திருப்பியது.",
  "Date": "தேதி", "Type": "வகை", "Amount": "தொகை", "Note": "குறிப்பு", "No entries yet.": "பதிவுகள் இல்லை.",
  "Advance received": "முன்பணம் பெற்றது", "Expense": "செலவு", "Returned / settled": "திருப்பியது / தீர்வு",
  "All": "அனைத்தும்", "This month": "இந்த மாதம்", "Last 30 days": "கடந்த 30 நாட்கள்", "All time": "எல்லா நாட்களும்",
  "From": "இருந்து", "To": "வரை", "Search note": "குறிப்பில் தேடு", "Download CSV": "CSV பதிவிறக்கு", "entries shown": "பதிவுகள் காட்டப்படுகின்றன",
  "Change Password": "கடவுச்சொல் மாற்று", "Sign Out": "வெளியேறு", "Driver": "ஓட்டுநர்",
  "Trip": "பயணம்", "Start a trip": "பயணம் தொடங்கு", "Start trip": "பயணம் தொடங்கு", "End trip": "பயணம் முடி", "Trip in progress": "பயணம் நடக்கிறது",
  "Starting km": "தொடக்க கி.மீ", "Ending km": "முடிவு கி.மீ", "Cargo (optional)": "சரக்கு (விருப்பம்)", "Started": "தொடங்கியது", "Planned trip from your owner": "உரிமையாளர் திட்டமிட்ட பயணம்",
  "Trip started. Safe journey!": "பயணம் தொடங்கியது. பாதுகாப்பான பயணம்!", "Trip ended.": "பயணம் முடிந்தது.",
  "Ask the owner": "உரிமையாளரிடம் கேளுங்கள்", "Need diesel": "டீசல் தேவை", "Need advance": "முன்பணம் தேவை", "Need toll money": "டோல் பணம் தேவை",
  "Diesel": "டீசல்", "Advance": "முன்பணம்", "Toll": "டோல்", "Request": "கோரிக்கை", "Send request": "கோரிக்கை அனுப்பு", "Reason (optional)": "காரணம் (விருப்பம்)",
  "Request sent to your owner.": "உரிமையாளருக்கு கோரிக்கை அனுப்பப்பட்டது.", "Start a trip first, then you can ask for diesel, advance or toll.": "முதலில் பயணம் தொடங்குங்கள்; பிறகு டீசல், முன்பணம் அல்லது டோல் கேட்கலாம்.",
  "My requests": "என் கோரிக்கைகள்", "No requests yet.": "கோரிக்கைகள் இல்லை.", "pending": "காத்திருக்கிறது", "approved": "அனுமதிக்கப்பட்டது", "paid": "பணம் வழங்கப்பட்டது", "rejected": "நிராகரிக்கப்பட்டது",
  "Recent trips": "சமீபத்திய பயணங்கள்", "No trips yet.": "பயணங்கள் இல்லை.",
  "Vehicle document vault": "வாகன ஆவணங்கள்", "No documents recorded for this vehicle yet.": "இந்த வாகனத்திற்கு ஆவணங்கள் பதிவு செய்யப்படவில்லை.", "Expires": "காலாவதி", "Number": "எண்",
  "Vehicle details": "வாகன விவரங்கள்", "Maintenance & service": "பராமரிப்பு & சேவை", "Recent Fuel": "சமீபத்திய டீசல்", "Recent Expenses": "சமீபத்திய செலவுகள்", "Issues": "பிரச்சினைகள்", "Inspections": "பரிசோதனைகள்",
  "Log diesel": "டீசல் பதிவு", "Litres": "லிட்டர்", "₹ amount": "₹ தொகை", "Odometer": "ஓடோமீட்டர்", "Save Diesel Entry": "டீசல் பதிவைச் சேமி",
  "Petty expense": "சிறு செலவு", "Save Expense": "செலவைச் சேமி", "Report a problem": "பிரச்சினை தெரிவி", "Report Problem": "பிரச்சினை தெரிவி", "What's wrong?": "என்ன பிரச்சினை?",
  "Inspection": "பரிசோதனை", "Save Inspection": "பரிசோதனையைச் சேமி", "All checks passed": "எல்லாம் சரி", "Pre-trip": "பயணத்திற்கு முன்", "Post-trip": "பயணத்திற்கு பின்", "Weekly": "வாராந்திர",
  "Advance received — recorded against your khata": "முன்பணம் பெற்றது — உங்கள் கணக்கில் பதியப்படும்", "Record Advance": "முன்பணத்தைப் பதி",
  "Low": "குறைவு", "Medium": "நடுத்தரம்", "High": "அதிகம்", "Close": "மூடு", "Loading…": "ஏற்றுகிறது…",
  "Diesel entry saved.": "டீசல் பதிவு சேமிக்கப்பட்டது.", "Advance recorded in your khata.": "உங்கள் கணக்கில் முன்பணம் பதியப்பட்டது.",
  "Enter the amount.": "தொகையை உள்ளிடவும்.", "Enter both the starting and ending kilometres.": "தொடக்க மற்றும் முடிவு கி.மீ இரண்டையும் உள்ளிடவும்.",
  "Ending km is below starting km — check the readings.": "முடிவு கி.மீ, தொடக்க கி.மீ-ஐ விடக் குறைவு — சரிபார்க்கவும்.",
  "Could not save — check your access for this vehicle.": "சேமிக்க முடியவில்லை — இந்த வாகனத்திற்கான அனுமதியைச் சரிபார்க்கவும்.",
  "Could not save. Check your connection and try again.": "சேமிக்க முடியவில்லை. இணைப்பைச் சரிபார்த்து மீண்டும் முயலவும்.",
  "Assigned vehicles": "ஒதுக்கப்பட்ட வாகனங்கள்", "Insurance": "காப்பீடு", "PUC": "PUC", "Fitness": "தகுதிச் சான்று", "Permit": "பெர்மிட்", "Road Tax": "சாலை வரி",
  "Make": "தயாரிப்பு", "Model": "மாடல்", "Year": "ஆண்டு", "Fuel": "எரிபொருள்", "Depot": "டிப்போ", "Colour": "நிறம்", "Axle": "ஆக்சில்", "Tyre size": "டயர் அளவு",
  "No service reminders.": "சேவை நினைவூட்டல்கள் இல்லை.", "No repair jobs on record.": "பழுதுபார்ப்பு பதிவுகள் இல்லை.", "No fuel logs yet.": "டீசல் பதிவுகள் இல்லை.",
  "No expenses yet.": "செலவுகள் இல்லை.", "No issues reported.": "பிரச்சினைகள் இல்லை.", "No inspections yet.": "பரிசோதனைகள் இல்லை.", "Pending approval": "அனுமதிக்காக காத்திருக்கிறது",
  "Petty expense — goes to the owner for approval": "சிறு செலவு — உரிமையாளர் அனுமதிக்கு செல்லும்", "Inspection — pre-trip / post-trip / weekly check": "பரிசோதனை — பயணத்திற்கு முன் / பின் / வாராந்திர",
  "Salary / payroll": "சம்பளம் / பேரோல்", "Paid to me (payroll)": "எனக்கு வழங்கப்பட்டது (பேரோல்)", "In progress": "நடக்கிறது", "Completed": "முடிந்தது", "Planned": "திட்டமிட்டது", "Cancelled": "ரத்து",
  "My trips": "என் பயணங்கள்", "Vehicle": "வாகனம்", "Route": "வழித்தடம்", "Status": "நிலை", "Search route": "வழித்தடத்தில் தேடு", "All vehicles": "அனைத்து வாகனங்கள்", "View": "பார்", "All types": "அனைத்து வகைகள்", "Search document": "ஆவணத்தில் தேடு", "documents shown": "ஆவணங்கள் காட்டப்படுகின்றன", "trips shown": "பயணங்கள் காட்டப்படுகின்றன", "Expired": "காலாவதியானது", "No trips match.": "பொருந்தும் பயணங்கள் இல்லை.", "No documents match.": "பொருந்தும் ஆவணங்கள் இல்லை.",
  "Change password": "கடவுச்சொல் மாற்று", "New password": "புதிய கடவுச்சொல்", "Confirm new password": "புதிய கடவுச்சொல்லை உறுதிசெய்", "Save password": "கடவுச்சொல்லைச் சேமி",
  "Password changed. Use it next time you sign in.": "கடவுச்சொல் மாற்றப்பட்டது. அடுத்த முறை இதைப் பயன்படுத்தவும்."
};
const DC_LANG_KEY = "fw_team_lang";
const dcLang = () => { try { return localStorage.getItem(DC_LANG_KEY) === "ta" ? "ta" : "en"; } catch { return "en"; } };
const dcT = s => (dcLang() === "ta" && DC_TA[s]) || s;

// Replace exact English strings in text nodes and placeholders under `root`.
function dcTranslate(root) {
  if (dcLang() !== "ta" || !root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const raw = n.nodeValue, key = raw.trim();
    if (key && DC_TA[key]) n.nodeValue = raw.replace(key, DC_TA[key]);
  }
  root.querySelectorAll("[placeholder]").forEach(el => { const p = el.getAttribute("placeholder"); if (DC_TA[p]) el.setAttribute("placeholder", DC_TA[p]); });
}

// Messages raised by the base controller are translated too.
(function () {
  const baseToast = window.toast, baseErr = window.tvErr;
  if (baseToast) window.toast = (msg, tone) => baseToast(dcT(msg), tone);
  if (baseErr) window.tvErr = msg => baseErr(dcT(msg));
})();

function dcMountLangToggle() {
  const bar = document.getElementById("teamPwBtn");
  if (!bar || document.getElementById("teamLangBtn")) return;
  const b = document.createElement("button");
  b.className = "btn btn-outline btn-sm"; b.id = "teamLangBtn"; b.style.marginLeft = "12px";
  b.textContent = dcLang() === "ta" ? "English" : "தமிழ்";
  b.addEventListener("click", () => { try { localStorage.setItem(DC_LANG_KEY, dcLang() === "ta" ? "en" : "ta"); } catch {} location.reload(); });
  bar.before(b);
  dcTranslate(document.querySelector(".drv-head"));
  dcTranslate(document.getElementById("teamPwCard"));
}

// ---------- who am I ----------
let _dcDriverId = null;
let _dcDriverExt = null;
async function dcDriverId() {
  if (_dcDriverId) return _dcDriverId;
  const me = await fwCloud.authGet("drivers", `select=id,ext_id&org_id=eq.${ORG}&user_id=eq.${fwCloud.uid()}&limit=1`).catch(() => null);
  _dcDriverExt = me && me[0] ? me[0].ext_id : null;
  return (_dcDriverId = me && me[0] ? me[0].id : null);
}

// ---------- trips & requests ----------
const DC_REQ = { diesel: "Diesel", advance: "Advance", toll: "Toll" };
const DC_ACTIVE = "planned,assigned,acknowledged,started";

async function dcActiveTrip(vehId) {
  const rows = await fwCloud.authGet("trips", `select=*&vehicle_id=eq.${vehId}&status=in.(${DC_ACTIVE})&odo_end=is.null&order=created_at.desc&limit=1`).catch(() => null);
  return rows && rows[0] || null;
}

function dcTripCard(trip, lastKm) {
  const inp = "padding:9px;border:1.5px solid #e2e8f0;border-radius:9px;font-family:inherit";
  if (!trip) return `
    <p class="muted" style="font-size:0.8rem;margin-bottom:6px"><strong>Start a trip</strong></p>
    <div class="form-row"><input type="text" id="dcFrom" placeholder="From" /><input type="text" id="dcTo" placeholder="To" /></div>
    <div class="form-row" style="margin-top:6px"><input type="number" id="dcStartKm" placeholder="Starting km" min="0" value="${lastKm || ""}" /><input type="text" id="dcCargo" placeholder="Cargo (optional)" /></div>
    <button class="btn btn-primary btn-sm" style="margin-top:6px" onclick="dcStartTrip()">Start trip</button>`;
  const route = `${esc(trip.from_loc || "—")} → ${esc(trip.to_loc || "—")}`;
  if (trip.status === "started") return `
    <p class="muted" style="font-size:0.8rem;margin-bottom:6px"><strong>Trip in progress</strong></p>
    <p style="margin:0 0 8px;font-size:0.9rem"><span class="fw-badge soon">Started</span> ${route}${trip.actual_start ? " · " + fmtDate(trip.actual_start) : ""}${trip.odo_start ? " · " + Math.round(trip.odo_start) + " km" : ""}</p>
    <div class="form-row"><input type="number" id="dcEndKm" placeholder="Ending km" min="0" /></div>
    <button class="btn btn-primary btn-sm" style="margin-top:6px" onclick="dcEndTrip('${trip.id}', ${+trip.odo_start || 0})">End trip</button>`;
  return `
    <p class="muted" style="font-size:0.8rem;margin-bottom:6px"><strong>Planned trip from your owner</strong></p>
    <p style="margin:0 0 8px;font-size:0.9rem">${route}${trip.cargo_description ? " · " + esc(trip.cargo_description) : ""}</p>
    <div class="form-row"><input type="number" id="dcStartKm" placeholder="Starting km" min="0" value="${trip.odo_start || lastKm || ""}" /></div>
    <button class="btn btn-primary btn-sm" style="margin-top:6px" onclick="dcBeginPlanned('${trip.id}')">Start trip</button>`;
}

function dcRequestCard(trip) {
  if (!trip || trip.status !== "started") return `<p class="muted" style="font-size:0.85rem">Start a trip first, then you can ask for diesel, advance or toll.</p>`;
  return `
    <p class="muted" style="font-size:0.8rem;margin-bottom:6px"><strong>Ask the owner</strong></p>
    <div class="form-row">
      <select id="dcReqType" style="padding:9px;border:1.5px solid #e2e8f0;border-radius:9px;font-family:inherit">
        <option value="diesel">Need diesel</option><option value="advance">Need advance</option><option value="toll">Need toll money</option>
      </select>
      <input type="number" id="dcReqAmt" placeholder="₹ amount" min="1" />
    </div>
    <input type="text" id="dcReqReason" placeholder="Reason (optional)" style="width:100%;margin-top:6px;box-sizing:border-box" />
    <button class="btn btn-primary btn-sm" style="margin-top:6px" onclick="dcSendRequest('${trip.id}')">Send request</button>`;
}

let _dcVeh = null;   // { vehId, ... } of the vehicle open in the modal

window.dcStartTrip = async function () {
  clearTvErr();
  const start = +document.getElementById("dcStartKm").value || 0;
  if (!start) return tvErr("Enter both the starting and ending kilometres.");
  const drv = await dcDriverId();
  const row = await fwCloud.authInsertRet("trips", {
    org_id: ORG, vehicle_id: _dcVeh.vehId, driver_id: drv, trip_date: today(), status: "started",
    actual_start: new Date().toISOString(), odo_start: start,
    from_loc: (document.getElementById("dcFrom").value || "").trim() || null,
    to_loc: (document.getElementById("dcTo").value || "").trim() || null,
    cargo_description: (document.getElementById("dcCargo").value || "").trim() || null,
  });
  if (!row) return tvErr("Could not save — check your access for this vehicle.");
  toast("Trip started. Safe journey!"); dcRefresh();
};

window.dcBeginPlanned = async function (tripId) {
  clearTvErr();
  const start = +document.getElementById("dcStartKm").value || 0;
  if (!start) return tvErr("Enter both the starting and ending kilometres.");
  const ok = await fwCloud.authPatchChecked(`trips?id=eq.${tripId}`, { status: "started", actual_start: new Date().toISOString(), odo_start: start, driver_id: await dcDriverId() });
  if (!ok) return tvErr("Could not save — check your access for this vehicle.");
  toast("Trip started. Safe journey!"); dcRefresh();
};

window.dcEndTrip = async function (tripId, startKm) {
  clearTvErr();
  const end = +document.getElementById("dcEndKm").value || 0;
  if (!end) return tvErr("Enter both the starting and ending kilometres.");
  if (end < startKm) return tvErr("Ending km is below starting km — check the readings.");
  if (end - startKm > 3000) return tvErr(`That is ${Math.round(end - startKm)} km in one trip. Check the readings before saving.`);
  const ok = await fwCloud.authPatchChecked(`trips?id=eq.${tripId}`, { status: "completed", actual_end: new Date().toISOString(), odo_end: end, km: end - startKm });
  if (!ok) return tvErr("Could not save — check your access for this vehicle.");
  toast("Trip ended."); dcRefresh();
};

window.dcSendRequest = async function (tripId) {
  clearTvErr();
  const type = document.getElementById("dcReqType").value;
  const amount = +document.getElementById("dcReqAmt").value || 0;
  if (!amount) return tvErr("Enter the amount.");
  const ok = await fwCloud.authInsert("trip_requests", {
    trip_id: tripId, org_id: ORG, request_type: type, amount,
    reason: (document.getElementById("dcReqReason").value || "").trim() || null, status: "pending",
  });
  if (!ok) return tvErr("Could not save — check your access for this vehicle.");
  toast("Request sent to your owner."); dcRefresh();
};

// ---------- vehicle modal: driver sections ----------
async function dcSections(vehId) {
  const [trip, done, reqs, docs] = await Promise.all([
    dcActiveTrip(vehId),
    fwCloud.authGet("trips", `select=id,from_loc,to_loc,km,actual_end,trip_date,odo_end&vehicle_id=eq.${vehId}&status=eq.completed&order=actual_end.desc.nullslast&limit=5`).catch(() => null),
    fwCloud.authGet("trip_requests", `select=id,request_type,amount,reason,status,paid_amount,created_at,trips!inner(vehicle_id)&trips.vehicle_id=eq.${vehId}&order=created_at.desc&limit=8`).catch(() => null),
    fwCloud.authGet("documents", `select=id,doc_type,number,expiry_date,note&vehicle_id=eq.${vehId}&order=expiry_date.asc.nullslast`).catch(() => null),
  ]);
  // the vault lists the recorded documents plus the compliance dates kept on the vehicle itself
  const veh = _vehRows[vehId] || {};
  const vault = [["Insurance", veh.insurance_till], ["PUC", veh.puc_till], ["Fitness", veh.fitness_till], ["Permit", veh.permit_till], ["Road Tax", veh.roadtax_till]]
    .filter(([, d]) => d).map(([k, d]) => ({ doc_type: dcT(k), expiry_date: d })).concat(docs || []);
  const lastKm = done && done[0] && done[0].odo_end ? Math.round(done[0].odo_end) : "";
  const badge = s => `<span class="fw-badge ${s === "paid" || s === "approved" ? "ok" : s === "rejected" ? "overdue" : "soon"}">${dcT(s)}</span>`;
  const box = t => `<div class="wf-form" style="margin:14px 0">${t}</div>`;
  const h3 = t => `<h3 style="font-size:0.85rem;color:var(--navy);margin:16px 0 6px">${t}</h3>`;
  const row = t => `<div class="pred-row" style="padding:8px 4px"><div class="pred-detail" style="font-size:0.85rem">${t}</div></div>`;
  const expBadge = d => { const n = daysUntil(d); return n == null ? "" : `<span class="fw-badge ${n < 0 ? "overdue" : n <= 30 ? "soon" : "ok"}">${n < 0 ? "Expired" : n + " d"}</span>`; };

  return box(dcTripCard(trip, lastKm)) + box(dcRequestCard(trip)) +
    h3("My requests") + (reqs && reqs.length ? reqs.map(r => row(`${badge(r.status)} <strong>${dcT(DC_REQ[r.request_type] || r.request_type)}</strong> ${fmtINR(r.paid_amount || r.amount)}${r.reason ? " · " + esc(r.reason) : ""} · ${fmtDate(r.created_at)}`)).join("") : `<p class="muted" style="font-size:0.85rem">No requests yet.</p>`) +
    h3("Recent trips") + (done && done.length ? done.map(t => row(`${esc(t.from_loc || "—")} → ${esc(t.to_loc || "—")} · ${Math.round(t.km || 0)} km · ${fmtDate(t.actual_end || t.trip_date)}`)).join("") : `<p class="muted" style="font-size:0.85rem">No trips yet.</p>`) +
    h3("Vehicle document vault") + (vault.length ? vault.map(d => row(`<strong>${esc(d.doc_type || "")}</strong>${d.number ? " · " + esc(d.number) : ""}${d.expiry_date ? " · " + dcT("Expires") + " " + fmtDate(d.expiry_date) + " " + expBadge(d.expiry_date) : ""}${d.note ? " · " + esc(d.note) : ""}`)).join("") : `<p class="muted" style="font-size:0.85rem">No documents recorded for this vehicle yet.</p>`);
}

async function dcRefresh() {
  if (!_dcVeh) return;
  const host = document.getElementById("dcSections");
  if (!host) return;
  host.innerHTML = await dcSections(_dcVeh.vehId);
  dcTranslate(host);
}

// Wrap the base vehicle modal for drivers: the trip form is replaced by the console.
(function () {
  const baseOpen = window.openVehicle;
  if (!baseOpen) return;
  window.openVehicle = async function (vehId, extId, name, access) {
    await baseOpen(vehId, extId, name, access);
    const body = document.getElementById("teamVehModalBody");
    if (ROLE === "driver" && body) {
      _dcVeh = { vehId };
      [...body.querySelectorAll(".wf-form")].forEach(f => { if (f.querySelector("#tvOdoStart")) f.remove(); });
      const holder = document.createElement("div"); holder.id = "dcSections";
      const first = body.querySelector("h3");
      (first ? first.parentNode : body).insertBefore(holder, first || null);
      holder.innerHTML = "<p class='muted'>Loading…</p>";
      holder.innerHTML = await dcSections(vehId);
    }
    dcTranslate(body);
  };
})();

// ---------- My Khata book, with filters ----------
const DC_KHATA_LABEL = { advance: "Advance received", expense: "Expense", settlement: "Returned / settled", salary: "Salary / payroll" };
let _dcKhata = { rows: [], f: { range: "month", from: "", to: "", type: "", q: "" } };

function dcKhataFiltered() {
  const { f, rows } = _dcKhata;
  let from = f.from, to = f.to;
  const now = new Date(), iso = d => d.toISOString().slice(0, 10);
  if (f.range === "month") { from = iso(new Date(now.getFullYear(), now.getMonth(), 1)); to = ""; }
  else if (f.range === "30") { from = iso(new Date(now - 30 * 864e5)); to = ""; }
  else if (f.range === "all") { from = ""; to = ""; }
  const q = f.q.trim().toLowerCase();
  return rows.filter(r => (!from || (r.entry_date || "") >= from) && (!to || (r.entry_date || "") <= to) &&
    (!f.type || r.type === f.type) && (!q || String(r.note || "").toLowerCase().includes(q)));
}

function dcKhataPaint() {
  const box = document.getElementById("teamKhata");
  const all = _dcKhata.rows, view = dcKhataFiltered(), f = _dcKhata.f;
  const sum = (rs, t) => rs.filter(r => r.type === t).reduce((s, r) => s + (+r.amount || 0), 0);
  const withMe = sum(all, "advance") - sum(all, "expense") - sum(all, "settlement");
  const chip = (id, label) => `<button type="button" class="btn btn-sm ${f.range === id ? "btn-primary" : "btn-outline"}" onclick="dcKhataSet('range','${id}')">${label}</button>`;
  const stat = (label, v, extra) => `<div><small class="muted">${label}</small><div style="font-weight:700;font-size:1.1rem;${extra || ""}">${v}</div></div>`;
  box.innerHTML = `<div class="chart-card">
    <div class="chart-head"><div>
      <h2 class="head-ic"><span class="ic-tile success"><i data-icon="rupee" data-icon-size="20"></i></span> My Khata</h2>
      <p class="muted">Only your own entries. Cash with you = advances − expenses − amounts returned.</p>
    </div></div>
    <div class="fw-stat-grid" style="margin-bottom:12px">
      ${stat("Advances", fmtINR(sum(view, "advance")))}${stat("Expenses", fmtINR(sum(view, "expense")))}${stat("Returned", fmtINR(sum(view, "settlement")))}
      ${stat("With me", fmtINR(withMe), `color:${withMe >= 0 ? "#166534" : "#dc2626"}`)}${stat("Paid to me (payroll)", fmtINR(sum(view, "salary")))}
    </div>
    <div class="form-row" style="margin-bottom:8px">${chip("month", "This month")}${chip("30", "Last 30 days")}${chip("all", "All time")}</div>
    <div class="form-row" style="margin-bottom:8px">
      <label>From<input type="date" id="dcKFrom" value="${esc(f.from)}" onchange="dcKhataSet('from',this.value)" /></label>
      <label>To<input type="date" id="dcKTo" value="${esc(f.to)}" onchange="dcKhataSet('to',this.value)" /></label>
    </div>
    <div class="form-row" style="margin-bottom:10px">
      <select id="dcKType" onchange="dcKhataSet('type',this.value)" style="padding:9px;border:1.5px solid #e2e8f0;border-radius:9px;font-family:inherit">
        <option value="">All</option><option value="advance">Advance received</option><option value="expense">Expense</option><option value="settlement">Returned / settled</option><option value="salary">Salary / payroll</option>
      </select>
      <input type="text" id="dcKQ" placeholder="Search note" value="${esc(f.q)}" oninput="dcKhataSet('q',this.value,true)" />
    </div>
    <div style="overflow-x:auto"><table class="chart-table-el" style="width:100%">
      <thead><tr><th>Date</th><th>Type</th><th style="text-align:right">Amount</th><th>Note</th></tr></thead>
      <tbody>${view.length ? view.map(r => `<tr><td>${fmtDate(r.entry_date)}</td><td>${esc(DC_KHATA_LABEL[r.type] || r.type || "")}</td><td style="text-align:right">${fmtINR(r.amount)}</td><td>${esc(r.note || "—")}</td></tr>`).join("") : `<tr><td colspan="4" class="muted" style="text-align:center;padding:16px">No entries yet.</td></tr>`}</tbody>
    </table></div>
    <p class="muted" style="margin-top:8px;font-size:0.8rem">${view.length} / ${all.length} entries shown · <button type="button" class="link-btn" onclick="dcKhataCsv()">Download CSV</button></p>
  </div>`;
  document.getElementById("dcKType").value = f.type;
  if (window.FWIcons) FWIcons.hydrate(box);
  dcTranslate(box);
}

window.dcKhataSet = function (key, val, keepFocus) {
  const f = _dcKhata.f; f[key] = val;
  if (key === "from" || key === "to") f.range = "custom";
  const active = keepFocus ? document.activeElement && document.activeElement.id : null;
  dcKhataPaint();
  if (active) { const el = document.getElementById(active); if (el) { el.focus(); el.setSelectionRange && el.setSelectionRange(el.value.length, el.value.length); } }
};

window.dcKhataCsv = function () {
  const q = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const lines = [["Date", "Type", "Amount", "Note"].map(q).join(",")].concat(dcKhataFiltered().map(r => [r.entry_date, DC_KHATA_LABEL[r.type] || r.type, r.amount, r.note].map(q).join(",")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  a.download = "my-khata.csv"; a.click(); URL.revokeObjectURL(a.href);
};

async function loadMyKhata() {
  const box = document.getElementById("teamKhata");
  if (!box) return;
  if (ROLE !== "driver") { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  const drv = await dcDriverId();
  if (!drv) {
    box.innerHTML = `<div class="chart-card"><h2>My Khata</h2><p class="muted">Your login isn't linked to a driver record yet, so there is no khata to show. Ask your fleet owner to link it in Team &amp; Access.</p></div>`;
    return;
  }
  const rows = await fwCloud.authGet("driver_ledger", `select=*&org_id=eq.${ORG}&driver_id=eq.${drv}&order=entry_date.desc.nullslast&limit=1000`) || [];
  // payroll paid to this driver (own rows only, enforced by the database) sits in the same book
  const pay = _dcDriverExt ? await fwCloud.authGet("salary_payments", `select=*&org_id=eq.${ORG}&driver_ext_id=eq.${encodeURIComponent(_dcDriverExt)}&order=paid_date.desc.nullslast&limit=1000`).catch(() => null) : null;
  const payRows = (pay || []).map(p => ({
    id: p.id, type: "salary", entry_date: p.paid_date || p.payable_date || (p.initiated_at || "").slice(0, 10), amount: p.amount,
    note: [p.category, p.period, p.notes, p.status && p.status !== "success" ? p.status : ""].filter(Boolean).join(" · "),
  }));
  _dcKhata.rows = rows.filter(r => r.driver_id === drv).concat(payRows).sort((a, b) => String(b.entry_date || "").localeCompare(String(a.entry_date || "")));
  dcKhataPaint();
  dcMountLangToggle();
  dcLoadTrips();
  dcLoadVault();
}
