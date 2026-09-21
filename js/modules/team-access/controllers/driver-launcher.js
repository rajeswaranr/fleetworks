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
  "Trip management": "பயண மேலாண்மை", "Khata book": "கணக்கு புத்தகம்", "Maintenance": "பராமரிப்பு", "← Back": "← பின்", "Open →": "திற →",
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
  }
  window.scrollTo(0, 0);
}
window.dcShowPanel = dcShowPanel;

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
