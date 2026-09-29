/* Safe Drive — the DriveBuddy experience inside the FleetWorks driver app.
 *
 * Ported from DriveBuddy (Langara capstone, cre8-capstone-project/DriverBuddy — built with
 * us). DriveBuddy is a React Native app (ML Kit + Google Maps + Firebase); FleetWorks is a
 * browser app, so every DriveBuddy capability is re-implemented on web equivalents and wired
 * into FleetWorks' own backend:
 *
 *   Monitor    real-time drowsiness detection (DriveBuddy's exact thresholds) on MediaPipe
 *              FaceLandmarker, with sound + spoken alerts and a drive-session summary.
 *   Rest stops nearby fuel, food/dhaba and rest areas on a map, from OpenStreetMap Overpass
 *              (keyless) — DriveBuddy's "nearby rest stop suggestions".
 *   My safety  the driver's own recent drowsiness alerts and a 7-day trend (DriveBuddy's
 *              history/analytics), read from FleetWorks device_events.
 *   Settings   detection sensitivity, sound & voice toggles, rest-stop type & radius
 *              (DriveBuddy's settings), kept per phone.
 *
 * All detection runs on the phone; no video leaves the device. Each alert is logged to
 * FleetSafe (driver-safety-event) so the owner sees it in Incident Triage and the Command
 * Centre — the phone becomes a Driver-Monitoring camera. */
(function () {
  "use strict";

  // ── DriveBuddy thresholds (Normal sensitivity). Settings scale the durations. ──
  const BASE = {
    OPEN_EYE_PROBABILITY_THRESHOLD: 0.70,
    BLINK_DURATION_LONG_THRESHOLD: 1500,
    BLINK_DURATION_MID_THRESHOLD: 500,
    BLINK_MONITORING_DURATION_WINDOW: 10000,
    BLINK_COUNT_THRESHOLD_HIGH: 8,
    BLINK_COUNT_THRESHOLD: 3,
    PITCH_DOWN_ANGLE_THRESHOLD: -5,
    PITCH_UP_ANGLE_THRESHOLD: 15,
    HEADTILT_DURATION_THRESHOLD: 5000,
  };
  const SENS = {   // High reacts sooner, Low needs longer eye-closure
    high: { long: 1100, mid: 400, tilt: 4000, high: 7, mid2: 2 },
    normal: { long: 1500, mid: 500, tilt: 5000, high: 8, mid2: 3 },
    low: { long: 2000, mid: 650, tilt: 6500, high: 10, mid2: 4 },
  };
  const ALERT_COOLDOWN = 4000;
  const MP_VERSION = "0.10.14";
  const MODEL_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" + MP_VERSION + "/wasm";
  const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
  const SET_KEY = "fw_safedrive_settings_v1";

  const defaults = { sensitivity: "normal", sound: true, voice: true, restType: "fuel", radiusKm: 5 };
  function settings() { try { return { ...defaults, ...JSON.parse(localStorage.getItem(SET_KEY) || "{}") }; } catch { return { ...defaults }; } }
  function saveSettings(s) { try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch {} }
  function thresholds() {
    const s = SENS[settings().sensitivity] || SENS.normal;
    return { ...BASE, BLINK_DURATION_LONG_THRESHOLD: s.long, BLINK_DURATION_MID_THRESHOLD: s.mid, HEADTILT_DURATION_THRESHOLD: s.tilt, BLINK_COUNT_THRESHOLD_HIGH: s.high, BLINK_COUNT_THRESHOLD: s.mid2 };
  }

  // ══════════════════════════ detection engine ══════════════════════════
  const E = {
    landmarker: null, stream: null, raf: 0, running: false, video: null, canvas: null, ctx: null, T: BASE,
    onEvent: null, onStatus: null, onTick: null,
    blinkStatus: "open", startClosed: null, blinkRegistered: false, midRegistered: false,
    blinks: [], midBlinks: [], lastRate: null, pitchStatus: "center", pitchStart: null,
    alerting: false, lastAlertAt: {}, counts: { alerts: 0, longBlink: 0, blinkRate: 0, headTilt: 0 }, startedAt: 0, faceSeen: false,
  };
  const now = () => Date.now();
  const emitStatus = m => E.onStatus && E.onStatus(m);

  async function ensureLandmarker() {
    if (E.landmarker) return E.landmarker;
    emitStatus("Loading the detector…");
    const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" + MP_VERSION + "/vision_bundle.mjs");
    const fileset = await vision.FilesetResolver.forVisionTasks(MODEL_WASM);
    E.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
      runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
    });
    return E.landmarker;
  }
  function pitchFromMatrix(m) { if (!m || m.length < 16) return 0; return Math.atan2(-m[9], m[10]) * 180 / Math.PI; }
  const blend = (s, n) => { const c = s && s.categories && s.categories.find(x => x.categoryName === n); return c ? c.score : 0; };

  function checkLookingAway(pitch) {
    const T = E.T, down = pitch < T.PITCH_DOWN_ANGLE_THRESHOLD, up = pitch > T.PITCH_UP_ANGLE_THRESHOLD;
    E.pitchStatus = up ? "up" : down ? "down" : "center";
    if (E.pitchStatus !== "center") {
      if (E.pitchStart === null) E.pitchStart = now();
      else if (now() - E.pitchStart > T.HEADTILT_DURATION_THRESHOLD) { if (!E.alerting) { E.counts.headTilt++; fire("head_tilt", "Head tilt — eyes on the road"); } E.pitchStart = null; }
    } else E.pitchStart = null;
  }
  const recordBlink = () => { const t = now(); E.blinks = E.blinks.filter(x => t - x <= 60000); E.blinks.push(t); };
  const recordMid = () => { const t = now(); E.midBlinks = E.midBlinks.filter(x => t - x <= 60000); E.midBlinks.push(t); };
  function calculateBlinkRate() {
    const T = E.T, t = now();
    if (E.lastRate === null) { E.lastRate = t; return; }
    if (t - E.lastRate < 100) return; E.lastRate = t;
    const suppressed = E.pitchStatus !== "center" || E.alerting;
    if (E.blinks.filter(x => t - x <= T.BLINK_MONITORING_DURATION_WINDOW).length >= T.BLINK_COUNT_THRESHOLD_HIGH) {
      if (!suppressed) { E.counts.blinkRate++; fire("blink_rate", "You're blinking a lot — take a break soon"); }
      E.blinks = []; E.midBlinks = []; E.startClosed = null; return;
    }
    if (E.midBlinks.filter(x => t - x <= T.BLINK_MONITORING_DURATION_WINDOW).length >= T.BLINK_COUNT_THRESHOLD) {
      if (!suppressed) { E.counts.blinkRate++; fire("blink_rate", "Heavy eyelids detected — please rest"); }
      E.blinks = []; E.midBlinks = []; E.startClosed = null;
    }
  }
  function checkDrowsiness(leftOpen, rightOpen) {
    const T = E.T, closed = leftOpen < T.OPEN_EYE_PROBABILITY_THRESHOLD && rightOpen < T.OPEN_EYE_PROBABILITY_THRESHOLD;
    if (closed) {
      if (E.blinkStatus !== "closed") { E.blinkStatus = "closed"; E.blinkRegistered = false; E.midRegistered = false; }
      if (E.startClosed === null) E.startClosed = now();
      else {
        const held = now() - E.startClosed, suppressed = E.pitchStatus !== "center" || E.alerting;
        if (held >= T.BLINK_DURATION_LONG_THRESHOLD) { if (!suppressed) { E.counts.longBlink++; fire("long_blink", "Wake up! Your eyes are closing"); } E.blinks = []; E.midBlinks = []; E.startClosed = null; }
        else if (held >= T.BLINK_DURATION_MID_THRESHOLD && !suppressed && E.blinkStatus === "closed" && !E.midRegistered) { recordMid(); E.midRegistered = true; }
      }
    } else { E.blinkStatus = "open"; E.blinkRegistered = true; E.startClosed = null; }
    if (E.blinkStatus === "closed" && !E.blinkRegistered && !E.alerting) { recordBlink(); E.blinkRegistered = true; }
    calculateBlinkRate();
  }

  let _audio = null;
  function beep() {
    if (!settings().sound) return;
    try {
      _audio = _audio || new (window.AudioContext || window.webkitAudioContext)();
      if (_audio.state === "suspended") _audio.resume();
      [0, 0.28].forEach(d => { const o = _audio.createOscillator(), g = _audio.createGain(), t = _audio.currentTime + d; o.type = "square"; o.frequency.setValueAtTime(880, t); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22); o.connect(g); g.connect(_audio.destination); o.start(t); o.stop(t + 0.24); });
    } catch {}
  }
  function speak(text) { if (!settings().voice) return; try { if (!window.speechSynthesis) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); speechSynthesis.speak(u); } catch {} }
  function fire(kind, message) {
    const t = now();
    if (E.lastAlertAt[kind] && t - E.lastAlertAt[kind] < ALERT_COOLDOWN) return;
    E.lastAlertAt[kind] = t; E.counts.alerts++; E.alerting = true;
    beep(); speak(message);
    if (E.onEvent) E.onEvent({ kind, message, at: new Date().toISOString(), counts: { ...E.counts } });
    setTimeout(() => { E.alerting = false; }, 3000);
  }
  function loop() {
    if (!E.running) return;
    const v = E.video;
    if (v && v.readyState >= 2) {
      let res = null; try { res = E.landmarker.detectForVideo(v, performance.now()); } catch {}
      const face = res && res.faceBlendshapes && res.faceBlendshapes[0];
      if (face) {
        if (!E.faceSeen) { E.faceSeen = true; emitStatus("Watching — drive safe."); }
        const leftOpen = 1 - blend(face, "eyeBlinkLeft"), rightOpen = 1 - blend(face, "eyeBlinkRight");
        const pitch = pitchFromMatrix(res.facialTransformationMatrixes && res.facialTransformationMatrixes[0] && res.facialTransformationMatrixes[0].data);
        checkLookingAway(pitch); checkDrowsiness(leftOpen, rightOpen); draw(res, leftOpen, rightOpen);
        if (E.onTick) E.onTick({ leftOpen, rightOpen, pitch, closed: leftOpen < E.T.OPEN_EYE_PROBABILITY_THRESHOLD && rightOpen < E.T.OPEN_EYE_PROBABILITY_THRESHOLD, alerting: E.alerting });
      } else { if (E.faceSeen) emitStatus("No face — point the camera at yourself."); E.faceSeen = false; E.startClosed = null; E.pitchStart = null; if (E.ctx) E.ctx.clearRect(0, 0, E.canvas.width, E.canvas.height); }
    }
    E.raf = requestAnimationFrame(loop);
  }
  function draw(res, leftOpen, rightOpen) {
    const c = E.canvas, g = E.ctx; if (!c || !g) return;
    if (c.width !== E.video.videoWidth && E.video.videoWidth) { c.width = E.video.videoWidth; c.height = E.video.videoHeight; }
    g.clearRect(0, 0, c.width, c.height);
    const lm = res.faceLandmarks && res.faceLandmarks[0]; if (!lm) return;
    let minx = 1, miny = 1, maxx = 0, maxy = 0; lm.forEach(p => { minx = Math.min(minx, p.x); miny = Math.min(miny, p.y); maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y); });
    const closed = leftOpen < E.T.OPEN_EYE_PROBABILITY_THRESHOLD && rightOpen < E.T.OPEN_EYE_PROBABILITY_THRESHOLD;
    const col = E.alerting ? "#ef4444" : closed ? "#f59e0b" : "#22d3ee";
    g.strokeStyle = col; g.lineWidth = 3; g.strokeRect(minx * c.width, miny * c.height, (maxx - minx) * c.width, (maxy - miny) * c.height);
    g.fillStyle = col; [33, 133, 159, 145, 362, 263, 386, 374].forEach(i => { const p = lm[i]; if (p) { g.beginPath(); g.arc(p.x * c.width, p.y * c.height, 3, 0, 7); g.fill(); } });
  }
  async function startEngine(video, canvas, opts) {
    E.video = video; E.canvas = canvas; E.ctx = canvas.getContext("2d"); E.T = thresholds();
    E.onEvent = opts.onEvent; E.onStatus = opts.onStatus; E.onTick = opts.onTick;
    Object.assign(E, { blinkStatus: "open", startClosed: null, blinks: [], midBlinks: [], lastRate: null, pitchStatus: "center", pitchStart: null, alerting: false, lastAlertAt: {}, counts: { alerts: 0, longBlink: 0, blinkRate: 0, headTilt: 0 }, startedAt: now(), faceSeen: false });
    await ensureLandmarker();
    emitStatus("Starting the camera…");
    E.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 640 } }, audio: false });
    video.srcObject = E.stream; await video.play(); E.running = true; emitStatus("Watching for drowsiness…"); E.raf = requestAnimationFrame(loop);
  }
  function stopEngine() {
    E.running = false; cancelAnimationFrame(E.raf);
    if (E.stream) { E.stream.getTracks().forEach(t => t.stop()); E.stream = null; }
    if (E.video) { try { E.video.pause(); } catch {} E.video.srcObject = null; }
    try { speechSynthesis && speechSynthesis.cancel(); } catch {}
    return { counts: { ...E.counts }, startedAt: E.startedAt, endedAt: now() };
  }
  window.SafeDriveEngine = { start: startEngine, stop: stopEngine, get counts() { return { ...E.counts }; }, thresholds };

  // ══════════════════════════ panel UI ══════════════════════════
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const icon = (n, s = 16) => (window.FWIcon ? FWIcon(n, { size: s }) : "");
  const KIND = { long_blink: "Eyes closing", blink_rate: "Heavy eyelids", head_tilt: "Head tilting", fatigue: "Drowsiness", distraction: "Distraction" };
  const P = { tab: "monitor", running: false, log: [], vehicles: [], vehId: null, session: null, map: null, stops: [], geo: null };

  function driverVehicles() { return [...document.querySelectorAll("#teamVehicleList .dc-veh")].map(c => ({ id: c.dataset.veh, name: c.dataset.name || c.dataset.ext || "Vehicle" })).filter(v => v.id); }

  function mount(slot) {
    P.vehicles = driverVehicles(); P.vehId = P.vehId || (P.vehicles[0] && P.vehicles[0].id) || null; P.slot = slot;
    render();
  }
  function render() {
    const slot = P.slot; if (!slot) return;
    const tabs = [["monitor", "Monitor", "eye"], ["stops", "Rest stops", "mapPin"], ["safety", "My safety", "shieldCheck"], ["settings", "Settings", "settings"]];
    slot.innerHTML = `<div class="sd">
      <div class="sd-tabs">${tabs.map(([k, l, ic]) => `<button type="button" class="btn-plain sd-tab ${P.tab === k ? "is-on" : ""}" data-sdtab="${k}">${icon(ic, 16)}<span>${l}</span></button>`).join("")}</div>
      <div class="sd-body" id="sdBody"></div></div>`;
    slot.querySelectorAll("[data-sdtab]").forEach(b => b.onclick = () => {
      if (b.dataset.sdtab !== "monitor" && P.running) stopMonitor();
      P.tab = b.dataset.sdtab; render();
    });
    ({ monitor: renderMonitor, stops: renderStops, safety: renderSafety, settings: renderSettings })[P.tab]();
    if (window.FWIcon) slot.querySelectorAll("[data-icon]").forEach(i => { const n = i.getAttribute("data-icon"); i.outerHTML = FWIcon(n, { size: +(i.getAttribute("data-icon-size") || 16) }); });
  }

  // ── Monitor ──
  function renderMonitor() {
    const b = document.getElementById("sdBody"); const V = P.vehicles;
    if (P.running) { b.innerHTML = liveHtml(); wireLive(); return; }
    if (P.session) { b.innerHTML = summaryHtml(P.session); document.getElementById("sdAgain").onclick = () => { P.session = null; render(); }; return; }
    b.innerHTML = `<div class="sd-intro">
      <div class="sd-hero">${icon("eye", 40)}</div>
      <h3>Stay awake at the wheel</h3>
      <p>Mount your phone facing you. The front camera watches your eyes and head and sounds an alert the moment you start to nod off. Everything runs on your phone — no video is sent anywhere.</p>
      ${V.length ? `<label class="sd-veh">Vehicle<select id="sdVeh">${V.map(v => `<option value="${esc(v.id)}" ${v.id === P.vehId ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></label>` : ""}
      <button type="button" class="btn btn-primary btn-block" id="sdStart">${icon("eye", 16)} Start monitoring</button>
      <p class="sd-note">Keep the app open and the screen on while driving. Alerts also reach your owner's safety dashboard.</p></div>`;
    const veh = document.getElementById("sdVeh"); if (veh) veh.onchange = () => { P.vehId = veh.value; };
    document.getElementById("sdStart").onclick = beginMonitor;
  }
  const liveHtml = () => `<div class="sd-live">
      <div class="sd-cam"><video id="sdVideo" playsinline muted></video><canvas id="sdCanvas"></canvas>
        <div class="sd-status" id="sdStatus">Starting…</div>
        <div class="sd-flash" id="sdFlash" hidden><span>${icon("alert", 40)}</span><b id="sdFlashMsg"></b></div></div>
      <div class="sd-stats">
        <div class="sd-stat"><small>Alerts</small><b id="sdCount">0</b></div>
        <div class="sd-stat"><small>Eyes closing</small><b id="sdLong">0</b></div>
        <div class="sd-stat"><small>Heavy eyelids</small><b id="sdRate">0</b></div>
        <div class="sd-stat"><small>Head tilt</small><b id="sdHead">0</b></div></div>
      <ul class="sd-log" id="sdLog"></ul>
      <button type="button" class="btn btn-outline btn-block" id="sdStop">End drive &amp; see summary</button></div>`;
  function wireLive() { const s = document.getElementById("sdStop"); if (s) s.onclick = stopMonitor; }
  async function beginMonitor() {
    P.running = true; P.log = []; render();
    const setStat = () => { const c = SafeDriveEngine.counts; const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; }; set("sdCount", c.alerts); set("sdLong", c.longBlink); set("sdRate", c.blinkRate); set("sdHead", c.headTilt); };
    try {
      await SafeDriveEngine.start(document.getElementById("sdVideo"), document.getElementById("sdCanvas"), {
        onStatus: m => { const s = document.getElementById("sdStatus"); if (s) s.textContent = m; },
        onEvent: ev => { setStat(); flash(ev.message); P.log.unshift(ev); renderLog(); logToFleet(ev); },
      });
    } catch (e) {
      P.running = false; render();
      const msg = /denied|NotAllowed/i.test(String(e)) ? "Camera permission was declined. Allow the camera to use Safe Drive." : "Could not start the camera: " + (e.message || e);
      if (window.toast) toast(msg, "err"); else alert(msg);
    }
  }
  function stopMonitor() {
    const res = SafeDriveEngine.stop(); P.running = false;
    const mins = Math.max(1, Math.round((res.endedAt - res.startedAt) / 60000));
    P.session = { ...res.counts, minutes: mins, at: new Date().toISOString() };
    if (P.tab === "monitor") render();
  }
  const summaryHtml = s => `<div class="sd-summary">
      <div class="sd-hero ${s.alerts ? "warn" : "ok"}">${icon(s.alerts ? "shieldAlert" : "checkCircle", 40)}</div>
      <h3>${s.alerts ? "Drive over — stay rested" : "Great drive!"}</h3>
      <p>${s.minutes} min monitored · <b>${s.alerts}</b> drowsiness alert${s.alerts === 1 ? "" : "s"}.</p>
      <div class="sd-stats">
        <div class="sd-stat"><small>Eyes closing</small><b>${s.longBlink}</b></div>
        <div class="sd-stat"><small>Heavy eyelids</small><b>${s.blinkRate}</b></div>
        <div class="sd-stat"><small>Head tilt</small><b>${s.headTilt}</b></div>
        <div class="sd-stat"><small>Minutes</small><b>${s.minutes}</b></div></div>
      ${s.alerts >= 3 ? `<p class="sd-note" style="color:#b91c1c">You were drowsy several times. Please rest before driving again — check the Rest stops tab.</p>` : ""}
      <button type="button" class="btn btn-primary btn-block" id="sdAgain">Done</button></div>`;
  function flash(message) { const f = document.getElementById("sdFlash"), m = document.getElementById("sdFlashMsg"); if (!f) return; m.textContent = message; f.hidden = false; clearTimeout(f._t); f._t = setTimeout(() => { f.hidden = true; }, 2600); }
  function renderLog() { const el = document.getElementById("sdLog"); if (!el) return; el.innerHTML = P.log.slice(0, 12).map(e => `<li><span class="sd-dot"></span><b>${esc(KIND[e.kind] || e.kind)}</b><span class="muted">${new Date(e.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></li>`).join(""); }
  async function logToFleet(ev) { if (!P.vehId || !(window.fwCloud && fwCloud.callFunction)) return; try { await fwCloud.callFunction("driver-safety-event", { vehicleId: P.vehId, kind: ev.kind, occurredAt: ev.at }); } catch {} }

  // ── Rest stops (OpenStreetMap Overpass, keyless) ──
  const OVERPASS = "https://overpass-api.de/api/interpreter";
  const STOP_KINDS = {
    fuel: { label: "Fuel / petrol pump", q: 'node["amenity"="fuel"]', icon: "fuel", color: "#0891b2" },
    food: { label: "Food / dhaba", q: 'node["amenity"~"restaurant|fast_food|cafe"]', icon: "boxes", color: "#d97706" },
    rest: { label: "Rest area / parking", q: 'node["highway"="rest_area"];node["amenity"="parking"]["access"!="private"]', icon: "mapPin", color: "#16a34a" },
  };
  const haversine = (a, b) => { const R = 6371, dLa = (b[0] - a[0]) * Math.PI / 180, dLo = (b[1] - a[1]) * Math.PI / 180; const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  function renderStops() {
    const b = document.getElementById("sdBody"); const s = settings();
    b.innerHTML = `<div class="sd-stops">
      <div class="sd-stops-head">
        <div class="sd-seg">${Object.entries(STOP_KINDS).map(([k, v]) => `<button type="button" class="btn-plain sd-seg-btn ${s.restType === k ? "is-on" : ""}" data-stopkind="${k}">${v.label.split(" /")[0]}</button>`).join("")}</div>
        <button type="button" class="btn btn-primary btn-sm" id="sdFind">${icon("mapPin", 14)} Find nearby</button>
      </div>
      <div id="sdMap" class="sd-map"></div>
      <ul class="sd-stoplist" id="sdStopList"><li class="muted" style="padding:12px">Press “Find nearby” to see fuel, food and rest stops around you (within ${s.radiusKm} km).</li></ul></div>`;
    b.querySelectorAll("[data-stopkind]").forEach(btn => btn.onclick = () => { const st = settings(); st.restType = btn.dataset.stopkind; saveSettings(st); renderStops(); });
    document.getElementById("sdFind").onclick = findStops;
    ensureLeaflet().then(() => initStopMap()).catch(() => {});
  }
  function ensureLeaflet() {
    if (window.L) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-leaflet]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css"; l.setAttribute("data-leaflet", "1"); document.head.appendChild(l); }
      const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
    });
  }
  function initStopMap() {
    const el = document.getElementById("sdMap"); if (!el || !window.L || P.map) { if (P.map) P.map.invalidateSize(); return; }
    P.map = L.map(el, { zoomControl: true, attributionControl: false }).setView([11.2189, 78.1677], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(P.map);
    setTimeout(() => P.map.invalidateSize(), 200);
    locateDriver();
  }
  function locateDriver() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
      P.geo = [pos.coords.latitude, pos.coords.longitude];
      if (P.map) { P.map.setView(P.geo, 14); if (P._me) P._me.remove(); P._me = L.circleMarker(P.geo, { radius: 8, color: "#2563eb", fillColor: "#2563eb", fillOpacity: 1 }).addTo(P.map).bindPopup("You are here"); }
    }, () => {}, { enableHighAccuracy: true, timeout: 8000 });
  }
  async function findStops() {
    const btn = document.getElementById("sdFind"), list = document.getElementById("sdStopList"), s = settings();
    if (!P.geo) { await new Promise(r => { navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => { P.geo = [p.coords.latitude, p.coords.longitude]; r(); }, () => r(), { timeout: 8000 }) : r(); }); }
    if (!P.geo) { list.innerHTML = `<li class="muted" style="padding:12px">Turn on location to find nearby stops.</li>`; return; }
    btn.disabled = true; btn.innerHTML = `<span class="sd-spin"></span> Searching…`;
    const kind = STOP_KINDS[s.restType] || STOP_KINDS.fuel, r = Math.min(25000, Math.max(1000, s.radiusKm * 1000));
    const parts = kind.q.split(";").map(q => `${q}(around:${r},${P.geo[0]},${P.geo[1]});`).join("");
    const query = `[out:json][timeout:20];(${parts});out center 40;`;
    try {
      const res = await fetch(OVERPASS, { method: "POST", body: "data=" + encodeURIComponent(query) });
      const j = await res.json();
      const stops = (j.elements || []).map(e => { const lat = e.lat || (e.center && e.center.lat), lon = e.lon || (e.center && e.center.lon); if (lat == null) return null; return { name: (e.tags && (e.tags.name || e.tags.brand)) || kind.label.split(" /")[0], lat, lon, dist: haversine(P.geo, [lat, lon]), tags: e.tags || {} }; }).filter(Boolean).sort((a, b) => a.dist - b.dist).slice(0, 20);
      P.stops = stops; renderStopList(kind); plotStops(kind);
    } catch { list.innerHTML = `<li class="muted" style="padding:12px">Could not reach the map service. Check your connection and try again.</li>`; }
    btn.disabled = false; btn.innerHTML = `${icon("mapPin", 14)} Find nearby`;
  }
  function renderStopList(kind) {
    const list = document.getElementById("sdStopList"); if (!list) return;
    if (!P.stops.length) { list.innerHTML = `<li class="muted" style="padding:12px">No ${kind.label.toLowerCase()} found within range. Try a wider radius in Settings.</li>`; return; }
    list.innerHTML = P.stops.map((st, i) => `<li class="sd-stopitem" data-si="${i}">
      <span class="sd-stopic" style="background:${kind.color}">${icon(kind.icon, 15)}</span>
      <div><b>${esc(st.name)}</b><span class="muted">${st.dist < 1 ? Math.round(st.dist * 1000) + " m" : st.dist.toFixed(1) + " km"} away${st.tags.brand && st.tags.brand !== st.name ? " · " + esc(st.tags.brand) : ""}</span></div>
      <a href="https://www.google.com/maps/dir/?api=1&destination=${st.lat},${st.lon}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">Directions</a></li>`).join("");
    list.querySelectorAll("[data-si]").forEach(li => li.onclick = e => { if (e.target.closest("a")) return; const st = P.stops[+li.dataset.si]; if (P.map) P.map.setView([st.lat, st.lon], 16); });
  }
  function plotStops(kind) {
    if (!P.map) return;
    (P._stopMarkers || []).forEach(m => m.remove()); P._stopMarkers = [];
    P.stops.forEach(st => { const m = L.circleMarker([st.lat, st.lon], { radius: 7, color: kind.color, fillColor: kind.color, fillOpacity: .85 }).addTo(P.map).bindPopup(`<b>${esc(st.name)}</b><br>${st.dist < 1 ? Math.round(st.dist * 1000) + " m" : st.dist.toFixed(1) + " km"}`); P._stopMarkers.push(m); });
    if (P.stops.length && P.geo) { const b = L.latLngBounds([P.geo, ...P.stops.map(s => [s.lat, s.lon])]); P.map.fitBounds(b, { padding: [30, 30], maxZoom: 15 }); }
  }

  // ── My safety (driver's own alerts + 7-day trend, from FleetSafe) ──
  async function renderSafety() {
    const b = document.getElementById("sdBody");
    b.innerHTML = `<div class="sd-safety"><div class="oc-skel" style="height:70px;border-radius:12px"></div></div>`;
    let events = [];
    if (window.fwCloud && fwCloud.user && fwCloud.user() && P.vehId) {
      const since = new Date(Date.now() - 7 * 864e5).toISOString();
      events = await fwCloud.authGet("v_safety_events", `select=event_type,severity,occurred_at&vehicle_id=eq.${P.vehId}&event_type=in.(fatigue,distraction)&occurred_at=gte.${since}&order=occurred_at.desc&limit=200`).catch(() => []) || [];
    }
    const days = []; for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); days.push({ key: d.toISOString().slice(0, 10), label: d.toLocaleDateString("en-IN", { weekday: "short" }), n: 0 }); }
    events.forEach(e => { const k = String(e.occurred_at).slice(0, 10); const d = days.find(x => x.key === k); if (d) d.n++; });
    const max = Math.max(1, ...days.map(d => d.n)), total = events.length;
    b.innerHTML = `<div class="sd-safety">
      <div class="sd-safety-top"><div class="sd-hero ${total ? "warn" : "ok"}" style="width:64px;height:64px;border-radius:18px">${icon("shieldCheck", 30)}</div>
        <div><h3>${total} drowsiness alert${total === 1 ? "" : "s"}</h3><p class="muted">on this vehicle in the last 7 days</p></div></div>
      <div class="sd-chart">${days.map(d => `<div class="sd-bar"><i style="height:${Math.round(d.n / max * 100)}%;background:${d.n ? "#f59e0b" : "#cbd5e1"}"></i><small>${d.label}</small><b>${d.n}</b></div>`).join("")}</div>
      <h4 class="sd-h4">Recent alerts</h4>
      <ul class="sd-log">${events.slice(0, 15).map(e => `<li><span class="sd-dot" style="background:${e.severity === "critical" ? "#ef4444" : "#f59e0b"}"></span><b>${esc(KIND[e.event_type] || e.event_type)}</b><span class="muted">${new Date(e.occurred_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span></li>`).join("") || `<li class="muted" style="padding:12px">No alerts recorded. Keep it up!</li>`}</ul>
      <p class="sd-note">${window.fwCloud && fwCloud.user && fwCloud.user() ? "Your owner sees these too, on the safety dashboard." : "Sign in to keep a safety history."}</p></div>`;
  }

  // ── Settings ──
  function renderSettings() {
    const b = document.getElementById("sdBody"), s = settings();
    b.innerHTML = `<div class="sd-settings">
      <section><h4 class="sd-h4">Detection sensitivity</h4><p class="muted sd-note" style="margin-top:0">Higher reacts to shorter eye-closures; lower waits longer before it alerts.</p>
        <div class="sd-seg">${[["high", "High"], ["normal", "Normal"], ["low", "Low"]].map(([k, l]) => `<button type="button" class="btn-plain sd-seg-btn ${s.sensitivity === k ? "is-on" : ""}" data-sens="${k}">${l}</button>`).join("")}</div></section>
      <section><h4 class="sd-h4">Alerts</h4>
        <label class="sd-switch"><span>Alert sound</span><input type="checkbox" id="sdSound" ${s.sound ? "checked" : ""}></label>
        <label class="sd-switch"><span>Spoken warning</span><input type="checkbox" id="sdVoice" ${s.voice ? "checked" : ""}></label></section>
      <section><h4 class="sd-h4">Rest stops</h4>
        <label class="sd-veh">Show by default<select id="sdRestType">${Object.entries(STOP_KINDS).map(([k, v]) => `<option value="${k}" ${s.restType === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
        <label class="sd-veh">Search radius<select id="sdRadius">${[2, 5, 10, 20].map(r => `<option value="${r}" ${s.radiusKm === r ? "selected" : ""}>${r} km</option>`).join("")}</select></label></section>
      <p class="sd-note">Settings are kept on this phone. Detection thresholds follow DriveBuddy's tested defaults.</p></div>`;
    b.querySelectorAll("[data-sens]").forEach(btn => btn.onclick = () => { const st = settings(); st.sensitivity = btn.dataset.sens; saveSettings(st); renderSettings(); });
    const set = (id, key, val) => { const el = document.getElementById(id); if (el) el.onchange = () => { const st = settings(); st[key] = val(el); saveSettings(st); }; };
    set("sdSound", "sound", el => el.checked); set("sdVoice", "voice", el => el.checked);
    set("sdRestType", "restType", el => el.value); set("sdRadius", "radiusKm", el => +el.value);
  }

  window.SafeDrive = { mount, stop: () => { if (P.running) stopMonitor(); }, isRunning: () => P.running };
})();
