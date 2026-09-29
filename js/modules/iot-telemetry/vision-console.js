/* AI Vision console (FleetSafe → AI Vision).
   One vehicle's cameras with the AI layer drawn over them: a single large view or
   all four at once, detection boxes, the lane and face meshes, an optional attention
   heatmap and a confidence filter. The scenario chips play what the AI does when
   something goes wrong, and "Log as test incident" writes it to Incident Triage as a
   simulated event, so the whole path from camera to AI root cause can be tried
   before any camera is fitted. Every scene and every logged event is marked as
   simulated. Scenes come from vision-scenes.js. */
(function () {
  "use strict";

  const CAM_ORDER = ["front", "cabin", "surround", "tank"];
  const S = {
    veh: "", view: "single", cam: "front", scen: "nominal",
    boxes: true, mesh: true, heatmap: false, minConf: 0.5, frozen: false,
    t0: performance.now(), tFrozen: 0, raf: 0, busy: false,
  };
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const icon = (n, s = 16) => (window.FWIcon ? FWIcon(n, { size: s }) : "");
  const vehicles = () => (window.db && db.vehicles) || [];
  const driverOf = v => ((window.db && db.drivers) || []).find(d => d.vehicleId === v.id);
  const SC = () => FWVision.SCENARIOS;

  function root() { return $("visionRoot"); }

  function render() {
    const r = root(); if (!r || !window.FWVision) return;
    const vs = vehicles();
    if (!S.veh && vs[0]) S.veh = vs[0].id;
    const v = vs.find(x => x.id === S.veh);
    const d = v && driverOf(v);
    r.innerHTML = `
    <div class="oc" id="vzOc">
      <div class="oc-head">
        <h2>${icon("camera", 20)} AI Vision console</h2>
        <span class="oc-live" id="vzLive">Simulated feed</span>
        <span class="oc-spacer"></span>
        <select id="vzVeh" aria-label="Vehicle">${vs.length ? vs.map(x => `<option value="${esc(x.id)}" ${x.id === S.veh ? "selected" : ""}>${esc(x.name)}${driverOf(x) ? " · " + esc(driverOf(x).name) : ""}</option>`).join("") : `<option value="">Demo truck</option>`}</select>
        <div class="oc-seg" role="group" aria-label="Layout">
          <button type="button" class="oc-seg-btn" data-view="single" aria-pressed="${S.view === "single"}">${icon("camera", 14)} Single camera</button>
          <button type="button" class="oc-seg-btn" data-view="quad" aria-pressed="${S.view === "quad"}">${icon("boxes", 14)} All four</button>
        </div>
        <p class="oc-sub">Front road, cabin driver monitor, 360° surround and fuel tank cameras, with the AI detection layer drawn live. No camera is linked, so these are simulated scenes; linked cameras play in <button type="button" class="link-btn" data-go="livewall">Live dashcam feeds</button>.</p>
      </div>

      <div class="oc-card" style="margin-bottom:14px">
        <h3>${icon("zap", 14)} Try a scenario <span class="oc-spacer"></span><span class="muted" style="text-transform:none;letter-spacing:0">Pick one to see how the AI flags it</span></h3>
        <div class="vz-scen" role="group" aria-label="Scenario">
          ${Object.entries(SC()).map(([k, s]) => `<button type="button" class="oc-chip sev-${s.sev === "critical" ? "red" : s.sev === "warning" ? "amber" : "green"}" data-scen="${k}" aria-pressed="${S.scen === k}">${icon(s.icon, 14)} ${esc(s.label)}</button>`).join("")}
        </div>
      </div>

      <div class="oc-cols">
        <div>
          ${S.view === "single" ? `<div class="oc-seg" role="group" aria-label="Camera" style="margin-bottom:10px">${CAM_ORDER.map(c => `<button type="button" class="oc-seg-btn" data-cam="${c}" aria-pressed="${S.cam === c}">${esc(FWVision.CAMS[c].split(" (")[0])}</button>`).join("")}</div>` : ""}
          <div class="vz-wall ${S.view}" id="vzWall">
            ${(S.view === "single" ? [S.cam] : CAM_ORDER).map(c => `
              <div class="vz-tile" data-tile="${c}">
                <canvas data-cam="${c}" aria-label="${esc(FWVision.CAMS[c])}, simulated"></canvas>
                <div class="vz-cap"><i></i><span>${esc(FWVision.CAMS[c])}</span><span class="oc-spacer"></span><span data-clock></span></div>
                <span class="vz-sim">SIMULATED</span>
                ${S.view === "quad" ? `<button type="button" class="btn btn-outline btn-sm vz-focus" data-focus="${c}">Focus</button>` : ""}
              </div>`).join("")}
          </div>
          <div class="vz-toggles" role="group" aria-label="AI layers">
            <button type="button" class="oc-chip" data-layer="boxes" aria-pressed="${S.boxes}">${icon("search", 14)} Detection boxes</button>
            <button type="button" class="oc-chip" data-layer="mesh" aria-pressed="${S.mesh}">${icon("network", 14)} Lane &amp; face mesh</button>
            <button type="button" class="oc-chip" data-layer="heatmap" aria-pressed="${S.heatmap}">${icon("eye", 14)} Attention heatmap</button>
            <span class="oc-spacer"></span>
            <button type="button" class="oc-chip" id="vzFreeze" aria-pressed="${S.frozen}">${icon("pause", 14)} ${S.frozen ? "Frozen" : "Freeze frame"}</button>
          </div>
        </div>

        <div class="oc-stack">
          <div class="oc-card" id="vzDiagCard">
            <h3>${icon("brain", 14)} Live AI diagnosis <span class="oc-spacer"></span><span class="vz-status" id="vzStatus">CLEAR</span></h3>
            <div class="vz-diag"><small>What the AI sees</small><b id="vzCls"></b><p id="vzTxt"></p></div>
            <label class="vz-conf-lbl" for="vzConf"><span>Hide detections below</span><b class="oc-mono" id="vzConfV" style="color:var(--oc-cyan)">${Math.round(S.minConf * 100)}%</b></label>
            <input type="range" id="vzConf" min="0.3" max="0.97" step="0.01" value="${S.minConf}">
            <div id="vzAct" style="margin-top:12px"></div>
          </div>
          <div class="oc-card">
            <h3>${icon("truck", 14)} Vehicle</h3>
            <dl class="oc-kv">
              <dt>Vehicle</dt><dd>${esc(v ? v.name : "Demo truck")}</dd>
              <dt>Driver</dt><dd>${esc(d ? d.name : "Not assigned")}</dd>
              <dt>Type</dt><dd>${esc(v ? v.type || "—" : "—")}</dd>
              <dt>Cameras</dt><dd class="cool">4 simulated</dd>
            </dl>
          </div>
          <div class="oc-card">
            <h3>${icon("zap", 14)} What runs where</h3>
            <dl class="oc-kv">
              <dt>Road objects &amp; lanes</dt><dd>on the camera</dd>
              <dt>Driver eyes &amp; phone</dt><dd>on the camera</dd>
              <dt>Fuel theft</dt><dd>tank sensor + camera</dd>
              <dt>Root cause</dt><dd class="cool">FleetWorks AI</dd>
            </dl>
            <p class="muted" style="font-size:.74rem;margin:10px 0 0">Detection runs on the camera box in the truck; only the alert and a short clip come to FleetWorks, which then explains it in Incident Triage.</p>
          </div>
        </div>
      </div>
    </div>`;
    wire(); sizeCanvases(); updateDiag(); start();
  }

  function updateDiag() {
    const s = SC()[S.scen] || SC().nominal, alarm = S.scen !== "nominal";
    $("vzCls").textContent = s.cls; $("vzTxt").textContent = s.text;
    const st = $("vzStatus"); st.textContent = alarm ? "ANOMALY" : "CLEAR"; st.classList.toggle("alarm", alarm);
    $("vzDiagCard").classList.toggle("vz-card-alarm", alarm);
    const live = $("vzLive"); live.classList.toggle("warn", alarm); live.textContent = alarm ? "Simulated feed · anomaly" : "Simulated feed";
    const signedIn = !!(window.FSData && FSData.enabled());
    $("vzAct").innerHTML = alarm
      ? (signedIn
        ? `<button type="button" class="btn btn-danger btn-sm" id="vzLog" style="width:100%">${icon("shieldAlert", 14)} Log as test incident &amp; analyse</button>
           <p class="muted" style="font-size:.72rem;margin:6px 0 0">Adds it to Incident Triage marked as a test, so you can try the AI root-cause analysis.</p>`
        : `<p class="muted" style="font-size:.78rem;margin:0">Sign in to log this as a test incident and run the AI root-cause analysis.</p>`)
      : `<p class="muted" style="font-size:.78rem;margin:0">Nothing to act on. Pick a scenario above to see an alert.</p>`;
    const log = $("vzLog"); if (log) log.onclick = logIncident;
  }

  function wire() {
    const r = root();
    r.querySelectorAll("[data-view]").forEach(b => b.onclick = () => { S.view = b.dataset.view; render(); });
    r.querySelectorAll("button[data-cam]").forEach(b => b.onclick = () => { S.cam = b.dataset.cam; render(); });
    r.querySelectorAll("[data-focus]").forEach(b => b.onclick = () => { S.cam = b.dataset.focus; S.view = "single"; render(); });
    r.querySelectorAll("[data-scen]").forEach(b => b.onclick = () => {
      S.scen = b.dataset.scen;
      // jump to the camera that sees it, so the effect is visible straight away
      if (S.view === "single") S.cam = SC()[S.scen].cam;
      render();
    });
    r.querySelectorAll("[data-layer]").forEach(b => b.onclick = () => { S[b.dataset.layer] = !S[b.dataset.layer]; b.setAttribute("aria-pressed", S[b.dataset.layer]); if (S.frozen) paint(); });
    $("vzFreeze").onclick = () => { S.frozen = !S.frozen; if (S.frozen) S.tFrozen = now(); render(); };
    $("vzVeh").onchange = e => { S.veh = e.target.value; render(); };
    $("vzConf").oninput = e => { S.minConf = +e.target.value; $("vzConfV").textContent = Math.round(S.minConf * 100) + "%"; if (S.frozen) paint(); };
    r.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { if (window.activateTab) activateTab(b.dataset.go); });
  }

  function sizeCanvases() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    root().querySelectorAll("canvas[data-cam]").forEach(c => {
      const w = c.clientWidth || 640, h = c.clientHeight || 360;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    });
  }

  const now = () => (performance.now() - S.t0) / 1000;
  function paint() {
    const t = S.frozen ? S.tFrozen : now();
    const clock = new Date().toLocaleTimeString("en-IN", { hour12: false });
    root().querySelectorAll(".vz-tile").forEach(tile => {
      const c = tile.querySelector("canvas"), g = c.getContext("2d");
      const hot = FWVision.draw(g, c.width, c.height, c.dataset.cam, S.scen, t, { boxes: S.boxes, mesh: S.mesh, heatmap: S.heatmap, minConf: S.minConf });
      tile.classList.toggle("alarm", hot);
      const ck = tile.querySelector("[data-clock]"); if (ck && !S.frozen) ck.textContent = "● " + clock;
    });
  }
  function start() {
    cancelAnimationFrame(S.raf);
    const loop = () => {
      const panel = $("tab-vision");
      if (!panel || !panel.classList.contains("active") || !root().querySelector("canvas")) return;   // stop when the page is not showing
      if (!document.hidden && !S.frozen) paint();
      S.raf = requestAnimationFrame(loop);
    };
    paint(); S.raf = requestAnimationFrame(loop);
  }

  // Writes the scenario as a simulated camera event for this vehicle, then opens it
  // in Incident Triage. A vehicle with no device gets a simulated one, flagged as
  // such, because camera events belong to a device.
  async function logIncident() {
    if (S.busy) return;
    const s = SC()[S.scen]; if (!s || !s.event) return;
    const v = vehicles().find(x => x.id === S.veh);
    const vehUuid = v ? (v.dbId || (window.dbVehicleUuid && dbVehicleUuid(v.id)) || (FSData.demo() ? v.id : null)) : null;
    const btn = $("vzLog");
    if (!vehUuid) { if (window.toast) toast("Save this vehicle to your account first, then try again.", "err"); return; }
    S.busy = true; btn.disabled = true; btn.innerHTML = `<span class="tr-spin"></span> Logging…`;
    try {
      const org = await FSData.orgId();
      if (!org) throw new Error("Could not find your fleet account.");
      let dev = await FSData.get("devices", `select=id&vehicle_id=eq.${vehUuid}&order=simulated.asc&limit=1`);
      let deviceId = dev && dev[0] && dev[0].id;
      if (!deviceId) {
        const made = await FSData.insertRet("devices", {
          org_id: org, vehicle_id: vehUuid, imei: "SIM-CAM-" + String(vehUuid).slice(0, 8), vendor: "FleetWorks simulator",
          model: "AI camera (simulated)", protocol: "proprietary", capabilities: ["gps", "adas", "dms", "fuel_level"],
          status: "active", simulated: true, notes: "Created by AI Vision to log test incidents.",
        });
        deviceId = made && made.id;
      }
      if (!deviceId) throw new Error("Could not set up a simulated camera for this vehicle.");
      const ev = await FSData.insertRet("device_events", {
        device_id: deviceId, org_id: org, event_type: s.event,
        severity: s.sev === "critical" ? "critical" : "warning",
        speed_kmph: s.speed, video_url: "simulated:" + S.scen,
        raw: Object.assign({ scenario: S.scen, camera: s.cam, source: "ai_vision_console" }, s.raw), simulated: true,
      });
      if (!ev) throw new Error("Could not save the incident.");
      if (window.toast) toast("Test incident logged. Opening Incident Triage.");
      if (window.IncidentTriage) IncidentTriage.focus("device", ev.id, { analyse: true });
      if (window.activateTab) activateTab("triage");
    } catch (e) {
      if (window.toast) toast(e.message || "Could not log the incident.", "err");
      btn.disabled = false; btn.innerHTML = `${icon("shieldAlert", 14)} Log as test incident &amp; analyse`;
    } finally { S.busy = false; }
  }

  let resizeT;
  window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if ($("tab-vision") && $("tab-vision").classList.contains("active")) { sizeCanvases(); paint(); } }, 150); });

  window.VisionConsole = { open: render };
})();
