/* Driver launch page: three tiles — Trip management, Khata book, Maintenance —
   and nothing else. Each tile opens its own panel with the matching data; a Back
   button returns to the launch page. Only drivers get this; supervisors keep the
   full vehicle list. Loaded after the other driver scripts and started from
   loadMyKhata() once the driver's data is in place. */
"use strict";

const DC_TILES = [
  { id: "trip",  icon: "truck",  title: "Trip management", text: "Start and end trips, log loading and unloading, ask for diesel, advance or toll." },
  { id: "khata", icon: "rupee",  title: "Khata book",      text: "Your advances, expenses and payroll, with filters." },
  { id: "maint", icon: "wrench", title: "Maintenance",     text: "Vehicle details, service, problems, inspections and documents." },
];
Object.assign(DC_TA, {
  "Trip management": "பயண மேலாண்மை", "Khata book": "கணக்கு புத்தகம்", "Maintenance": "பராமரிப்பு", "← Back": "← பின்", "Open →": "திற →", "Start trip": "பயணம் தொடங்கு", "Update trip": "பயணத்தைப் புதுப்பி", "Close trip": "பயணம் முடி", "In progress": "நடக்கிறது",
  "Start and end trips, log loading and unloading, ask for diesel, advance or toll.": "பயணம் தொடங்கு/முடி, ஏற்றம்/இறக்கம் பதிவு, டீசல், முன்பணம் அல்லது டோல் கேள்.",
  "Your advances, expenses and payroll, with filters.": "உங்கள் முன்பணம், செலவுகள் மற்றும் சம்பளம் — வடிகட்டிகளுடன்.",
  "Vehicle details, service, problems, inspections and documents.": "வாகன விவரங்கள், சேவை, பிரச்சினைகள், பரிசோதனைகள் மற்றும் ஆவணங்கள்.",
});

let _dcMode = "trip";   // which panel the vehicle modal was opened from
let _dcLauncherReady = false;

function dcPanel(id) { return document.getElementById("dcPanel-" + id); }

function dcShowPanel(id) {
  const launch = document.getElementById("dcLaunch");
  launch.hidden = id !== "";
  launch.style.display = id !== "" ? "none" : "";   // .role-grid sets display, which beats [hidden]
  DC_TILES.forEach(t => { const p = dcPanel(t.id); if (p) p.hidden = t.id !== id; });
  if (id === "trip" || id === "maint") {
    _dcMode = id;
    dcPanel(id).querySelector(".dc-slot").prepend(document.getElementById("teamVehicleList"));
    if (id === "trip") dcRenderCardActions();
  }
  window.scrollTo(0, 0);
}
window.dcShowPanel = dcShowPanel;

// Trip management: each vehicle card shows the action that fits its trip: Start trip,
// or Update trip and Close trip once a trip is running.
async function dcRenderCardActions() {
  if (ROLE !== "driver" || _dcMode !== "trip") return;
  const cards = [...document.querySelectorAll("#teamVehicleList .dc-veh")];
  if (!cards.length) return;
  const rows = await fwCloud.authGet("trips", `select=id,vehicle_id,status,from_loc,to_loc&org_id=eq.${ORG}&status=in.(planned,assigned,acknowledged,started)&odo_end=is.null&order=created_at.desc`).catch(() => null) || [];
  const byVeh = {};
  rows.forEach(t => { if (!byVeh[t.vehicle_id]) byVeh[t.vehicle_id] = t; });
  cards.forEach(c => {
    const box = c.querySelector(".dc-actions"), t = byVeh[c.dataset.veh], canWrite = c.dataset.access === "update";
    if (!box || !canWrite) return;
    const btn = (a, label, cls) => `<button type="button" class="btn ${cls} btn-block" onclick="event.stopPropagation(); dcTripAction('${a}', this)">${label}</button>`;
    box.innerHTML = t && t.status === "started"
      ? `<p class="muted"><span class="fw-badge soon">In progress</span> ${esc(t.from_loc || "—")} → ${esc(t.to_loc || "—")}</p>${btn("update", "Update trip", "btn-primary")}<p></p>${btn("close", "Close trip", "dc-chip")}`
      : btn("start", "Start trip", "btn-primary");
    dcTranslate(box);
  });
}
window.dcRenderCardActions = dcRenderCardActions;

// Opens the vehicle and takes the driver straight to the part of the form for the chosen action.
window.dcTripAction = async function (act, el) {
  const c = el.closest(".dc-veh");
  await openVehicle(c.dataset.veh, c.dataset.ext, c.dataset.name, c.dataset.access);
  const t = document.getElementById({ start: "dcStartKm", update: "dcStopKind", close: "dcEndKm" }[act]);
  if (t) { t.scrollIntoView({ block: "center" }); if (act !== "update") t.focus(); }
};

function dcStartLauncher() {
  if (ROLE !== "driver" || _dcLauncherReady) return;
  const main = document.querySelector(".drv-main");
  if (!main) return;
  _dcLauncherReady = true;

  // the launch page shows the tiles and nothing else
  const note = document.getElementById("teamAccessNote"); if (note) note.hidden = true;

  const launch = document.createElement("div");
  launch.id = "dcLaunch";
  launch.className = "role-grid";
  launch.innerHTML = DC_TILES.map(t => `
    <a href="#" class="role-card" role="button" onclick="dcShowPanel('${t.id}'); return false;">
      <span class="role-icon ic-tile brand"><i data-icon="${t.icon}" data-icon-size="28"></i></span>
      <h2>${t.title}</h2>
      <p>${t.text}</p>
      <span class="role-cta">Open →</span>
    </a>`).join("");
  main.prepend(launch);

  const parts = { trip: ["teamTrips"], khata: ["teamKhata"], maint: ["teamVault"] };
  DC_TILES.forEach(t => {
    const panel = document.createElement("div");
    panel.id = "dcPanel-" + t.id; panel.hidden = true;
    panel.innerHTML = `<div class="chart-head"><div><button type="button" class="btn btn-primary btn-sm" onclick="dcShowPanel('')">← Back</button></div>
      <h2 class="head-ic"><span class="ic-tile brand"><i data-icon="${t.icon}" data-icon-size="20"></i></span> ${t.title}</h2></div><div class="dc-slot"></div>`;
    main.appendChild(panel);
    const slot = panel.querySelector(".dc-slot");
    parts[t.id].forEach(id => { const el = document.getElementById(id); if (el) slot.appendChild(el); });
  });

  // park the vehicle list inside a panel so the launch page stays clean
  dcPanel("trip").querySelector(".dc-slot").prepend(document.getElementById("teamVehicleList"));

  if (window.FWIcons) FWIcons.hydrate(main);
  dcTranslate(main);
}
