/* FleetWorks telemetry demo
   A browser-only reference pipeline for demos and UI testing:
   device packet -> normalized reading -> rules/alerts -> role views.
   Production devices use the telemetry-ingest edge function and the same
   normalized field names. Demo records are always marked simulated. */
(function () {
  "use strict";

  const KEY = "fw_telemetry_demo_v1";
  const VEHICLE = "TN-88-AA-1001";
  const DEVICE = "FW-DASH-FUEL-1001";
  const DRIVER = "Suresh Kumar";
  let timer = null;

  const esc = value => String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const ago = stamp => {
    const seconds = Math.max(0, Math.round((Date.now() - new Date(stamp)) / 1000));
    if (seconds < 60) return seconds + "s ago";
    return Math.round(seconds / 60) + "m ago";
  };

  function initialState() {
    const now = Date.now();
    const packets = [
      { minutes: 5, speed: 54, fuel: 72.4, ignition: true, lat: 11.2189, lng: 78.1677, camera: "online" },
      { minutes: 4, speed: 58, fuel: 72.1, ignition: true, lat: 11.2298, lng: 78.1581, camera: "online" },
      { minutes: 3, speed: 76, fuel: 71.8, ignition: true, lat: 11.2415, lng: 78.1488, camera: "online", event: "overspeed" },
      { minutes: 2, speed: 42, fuel: 71.6, ignition: true, lat: 11.2531, lng: 78.1392, camera: "online", event: "harsh_brake" },
      { minutes: 1, speed: 0, fuel: 71.5, ignition: false, lat: 11.2570, lng: 78.1355, camera: "online" },
      { minutes: 0, speed: 0, fuel: 59.2, ignition: false, lat: 11.2570, lng: 78.1355, camera: "online", event: "fuel_drop" },
    ].map((packet, index) => ({
      id: "raw-" + (index + 1), device_id: DEVICE, vehicle: VEHICLE,
      received_at: new Date(now - packet.minutes * 60000).toISOString(),
      speed_kmph: packet.speed, fuel_level_pct: packet.fuel,
      ignition: packet.ignition, latitude: packet.lat, longitude: packet.lng,
      dashcam_status: packet.camera, event_type: packet.event || null,
      simulated: true,
    }));
    return process({ packets, alerts: [] });
  }

  function process(state) {
    const packets = state.packets || [];
    const latest = packets[packets.length - 1] || null;
    const alerts = [];
    packets.forEach((packet, index) => {
      const previous = packets[index - 1];
      if (packet.speed_kmph > 70) alerts.push(alert(packet, "overspeed", "warning", `Speed ${packet.speed_kmph} km/h`));
      if (packet.event_type === "harsh_brake") alerts.push(alert(packet, "harsh_brake", "warning", "Dashcam detected harsh braking"));
      if (previous && !packet.ignition && previous.fuel_level_pct - packet.fuel_level_pct >= 8) {
        alerts.push(alert(packet, "fuel_drop", "critical", `Fuel dropped ${(previous.fuel_level_pct - packet.fuel_level_pct).toFixed(1)}% while parked`));
      }
    });
    return { packets, latest, alerts, processed_at: new Date().toISOString(), simulated: true };
  }

  function alert(packet, type, severity, message) {
    return { id: packet.id + "-" + type, type, severity, message, occurred_at: packet.received_at, acknowledged: false };
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      return saved && Array.isArray(saved.packets) ? process(saved) : initialState();
    } catch { return initialState(); }
  }

  function save(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
    renderAll(state);
    window.dispatchEvent(new CustomEvent("fw:telemetry-demo", { detail: state }));
  }

  function nextPacket(state) {
    const previous = state.latest || initialState().latest;
    const moving = Math.random() > 0.2;
    const speed = moving ? Math.round(clamp((previous.speed_kmph || 48) + (Math.random() * 14 - 7), 28, 82)) : 0;
    let fuel = clamp(previous.fuel_level_pct - (moving ? 0.15 : 0.02), 4, 100);
    let event = speed > 70 ? "overspeed" : Math.random() < 0.12 ? "harsh_brake" : null;
    if (!moving && Math.random() < 0.12) { fuel = clamp(fuel - 10.5, 0, 100); event = "fuel_drop"; }
    const packet = {
      id: "raw-" + Date.now(), device_id: DEVICE, vehicle: VEHICLE,
      received_at: new Date().toISOString(), speed_kmph: speed,
      fuel_level_pct: +fuel.toFixed(1), ignition: moving,
      latitude: +(previous.latitude + (moving ? 0.0031 : 0)).toFixed(6),
      longitude: +(previous.longitude - (moving ? 0.0024 : 0)).toFixed(6),
      dashcam_status: "online", event_type: event, simulated: true,
    };
    return process({ packets: [...state.packets.slice(-29), packet] });
  }

  function badge(text, tone) {
    const colors = tone === "danger" ? "#b91c1c" : tone === "warn" ? "#a16207" : "#15803d";
    return `<span class="fw-badge" style="color:${colors};border-color:${colors};background:${colors}12">${esc(text)}</span>`;
  }

  function ownerPanel() {
    const host = document.getElementById("fleetContent");
    if (!host || document.getElementById("tab-devices")) return;
    const panel = document.createElement("section");
    panel.className = "tab-panel";
    panel.id = "tab-devices";
    panel.innerHTML = `
      <div class="chart-card" style="border-color:#d97706">
        <div class="chart-head"><div><h2>Sample telemetry pipeline</h2><p class="muted">Truck devices → raw packet intake → validation and alert rules → owner and driver views. All data on this page is simulated.</p></div>
          <span class="fw-badge upcoming">TEST DATA</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" id="tdStart">▶ Start live sample</button>
          <button class="btn btn-outline btn-sm" id="tdStep">Receive one packet</button>
          <button class="btn btn-outline btn-sm" id="tdReset">Load / reset test data</button>
          <a class="btn btn-outline btn-sm" href="driver.html?demo=1&n=${encodeURIComponent(DRIVER)}&v=${encodeURIComponent(VEHICLE)}&vid=demo-v1" target="_blank">Open driver view ↗</a>
          <span class="muted" id="tdStatus" style="margin-left:auto;font-size:.82rem"></span>
        </div>
      </div>
      <section class="stat-row" id="tdStats"></section>
      <div class="chart-card"><div class="chart-head"><div><h2>${VEHICLE} · live state</h2><p class="muted">Dashcam + GPS + fuel-level sensor · Device ${DEVICE}</p></div><span id="tdOnline"></span></div><div id="tdState"></div></div>
      <div class="chart-card"><div class="chart-head"><div><h2>Processed alerts</h2><p class="muted">Rules turn raw readings into actions for the fleet owner.</p></div></div><div class="chart-scroll"><div id="tdAlerts"></div></div></div>
      <div class="chart-card"><div class="chart-head"><div><h2>Raw packet intake</h2><p class="muted">Newest device messages received before processing.</p></div></div><div class="chart-scroll"><div id="tdRaw"></div></div></div>`;
    host.appendChild(panel);
    // The hash router runs earlier in fleet.controller.js. On a direct visit to
    // #devices it can select the sidebar button before this lazy panel exists,
    // leaving every panel inactive. Re-activate once the panel is mounted.
    if (location.hash === "#devices" && typeof window.activateTab === "function") {
      window.activateTab("devices", { replaceHistory: true });
    }
  }

  function renderOwner(state) {
    const latest = state.latest;
    if (!latest || !document.getElementById("tdStats")) return;
    const critical = state.alerts.filter(item => item.severity === "critical").length;
    document.getElementById("tdStats").innerHTML = `
      <div class="stat-tile"><span class="stat-label">Packets received</span><span class="stat-value">${state.packets.length}</span><span class="stat-sub">normalized successfully</span></div>
      <div class="stat-tile"><span class="stat-label">Vehicle speed</span><span class="stat-value">${latest.speed_kmph}</span><span class="stat-sub">km/h</span></div>
      <div class="stat-tile"><span class="stat-label">Fuel level</span><span class="stat-value" style="color:${latest.fuel_level_pct < 20 ? "#b91c1c" : "inherit"}">${latest.fuel_level_pct}%</span><span class="stat-sub">tank sensor</span></div>
      <div class="stat-tile"><span class="stat-label">Open alerts</span><span class="stat-value" style="color:${critical ? "#b91c1c" : "#a16207"}">${state.alerts.length}</span><span class="stat-sub">${critical} critical</span></div>`;
    document.getElementById("tdOnline").innerHTML = badge("● Online · " + ago(latest.received_at), "ok");
    document.getElementById("tdState").innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
      <div><span class="muted">Ignition</span><br><strong>${latest.ignition ? "ON" : "OFF / parked"}</strong></div>
      <div><span class="muted">Dashcam</span><br><strong>● ${esc(latest.dashcam_status)}</strong></div>
      <div><span class="muted">Position</span><br><strong>${latest.latitude}, ${latest.longitude}</strong></div>
      <div><span class="muted">Assigned driver</span><br><strong>${DRIVER}</strong></div></div>`;
    document.getElementById("tdAlerts").innerHTML = state.alerts.length ? `<table class="chart-table-el"><thead><tr><th>Detected</th><th>Rule</th><th>Severity</th><th>Action</th></tr></thead><tbody>${[...state.alerts].reverse().map(item => `<tr><td>${ago(item.occurred_at)}</td><td><strong>${esc(item.message)}</strong></td><td>${badge(item.severity, item.severity === "critical" ? "danger" : "warn")}</td><td>${item.type === "fuel_drop" ? "Call driver · verify fuel" : "Review dashcam clip"}</td></tr>`).join("")}</tbody></table>` : "<p class='muted'>No alerts.</p>";
    document.getElementById("tdRaw").innerHTML = `<table class="chart-table-el"><thead><tr><th>Received</th><th>Device</th><th>Speed</th><th>Fuel</th><th>Ignition</th><th>Camera</th></tr></thead><tbody>${[...state.packets].reverse().slice(0, 8).map(row => `<tr><td>${ago(row.received_at)}</td><td>${esc(row.device_id)}</td><td>${row.speed_kmph} km/h</td><td>${row.fuel_level_pct}%</td><td>${row.ignition ? "on" : "off"}</td><td>${esc(row.dashcam_status)}</td></tr>`).join("")}</tbody></table>`;
    const status = document.getElementById("tdStatus");
    if (status) status.textContent = "Last processed " + new Date(state.processed_at).toLocaleTimeString("en-IN");
  }

  function renderDriver(state) {
    const latest = state.latest;
    const host = document.getElementById("driverTelemetryDemo");
    if (!host || !latest) return;
    const latestAlert = [...state.alerts].reverse()[0];
    host.innerHTML = `
      <div class="chart-card" style="border-color:#d97706"><div class="chart-head"><div><h2>வாகன நேரடி நிலை</h2><p class="muted">${VEHICLE} · மாதிரி சாதனத் தரவு</p></div><span class="fw-badge upcoming">TEST</span></div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
          <div class="stat-tile"><span class="stat-label">வேகம்</span><span class="stat-value">${latest.speed_kmph}</span><span class="stat-sub">km/h</span></div>
          <div class="stat-tile"><span class="stat-label">டீசல் அளவு</span><span class="stat-value">${latest.fuel_level_pct}%</span><span class="stat-sub">fuel sensor</span></div>
          <div class="stat-tile"><span class="stat-label">Dashcam</span><span class="stat-value" style="font-size:1rem;color:#15803d">● Online</span><span class="stat-sub">recording</span></div>
          <div class="stat-tile"><span class="stat-label">Engine</span><span class="stat-value" style="font-size:1rem">${latest.ignition ? "Running" : "Parked"}</span><span class="stat-sub">${ago(latest.received_at)}</span></div>
        </div>
      </div>
      <div class="chart-card"><div class="chart-head"><div><h2>ஓட்டுநர் அறிவிப்பு</h2><p class="muted">உங்களுக்கு தேவையான பாதுகாப்பு தகவல் மட்டும்</p></div></div>
        ${latestAlert ? `<div style="padding:12px;border-left:4px solid ${latestAlert.severity === "critical" ? "#b91c1c" : "#d97706"};background:#fff7ed"><strong>${latestAlert.type === "fuel_drop" ? "வாகனம் நிறுத்தியபோது டீசல் அளவு குறைந்தது" : latestAlert.type === "overspeed" ? "வேகத்தை குறைக்கவும்" : "கடுமையான பிரேக்கிங் கண்டறியப்பட்டது"}</strong><p class="muted" style="margin:4px 0 0">${esc(latestAlert.message)}</p></div>` : "<p class='muted'>புதிய அறிவிப்புகள் இல்லை.</p>"}
      </div>`;
  }

  function renderAll(state) { renderOwner(state); renderDriver(state); }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    const button = document.getElementById("tdStart");
    if (button) button.textContent = "▶ Start live sample";
  }
  function step() { save(nextPacket(load())); }

  ownerPanel();
  let state = load();
  save(state);
  document.getElementById("tdStep")?.addEventListener("click", step);
  document.getElementById("tdReset")?.addEventListener("click", () => {
    stop();
    save(initialState());
    const status = document.getElementById("tdStatus");
    if (status) status.textContent = "Test data loaded: 1 truck, 6 packets, dashcam events and fuel alert.";
  });
  document.getElementById("tdStart")?.addEventListener("click", event => {
    if (timer) { stop(); return; }
    event.currentTarget.textContent = "■ Stop live sample";
    timer = setInterval(step, 2000);
  });
  window.addEventListener("storage", event => { if (event.key === KEY) renderAll(load()); });
  window.FWTelemetryDemo = { load, reset: () => save(initialState()), step };
})();
