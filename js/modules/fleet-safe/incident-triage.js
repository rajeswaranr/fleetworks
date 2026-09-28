/* Incident Triage (FleetSafe → Incident Triage).
   One queue for every incident that needs a decision, whichever way it was found:
     - camera events (device_events, via v_safety_events for vehicle and driver):
       collision warnings, drowsiness, phone use, lane departure, tamper
     - vehicle-twin detections (ai_events): fuel theft and leaks, tyre loss,
       overheating, low battery
   Pick one to see the evidence and the readings around it, run the AI root-cause
   analysis (incident-analysis edge function, kept in incident_analyses), and close
   it with a note. Simulated incidents are labelled as tests everywhere. */
(function () {
  "use strict";

  const SEV = { critical: { c: "#ef4444", rank: 0, label: "Critical" }, warning: { c: "#f59e0b", rank: 1, label: "Warning" }, info: { c: "#38bdf8", rank: 2, label: "Info" } };
  const LABEL = {
    fuel_theft: "Fuel theft", fuel_leak: "Fuel leak", tyre_pressure_loss: "Tyre pressure loss", tyre_low_pressure: "Low tyre pressure",
    engine_overheat: "Engine overheating", low_battery: "Low battery", forward_collision: "Forward collision", headway_warning: "Following too close",
    pedestrian_warning: "Pedestrian warning", lane_departure: "Lane departure", fatigue: "Drowsiness", distraction: "Distraction",
    phone_use: "Phone use", no_seatbelt: "No seatbelt", smoking: "Smoking", harsh_brake: "Harsh braking", harsh_accel: "Harsh acceleration",
    harsh_corner: "Harsh cornering", overspeed: "Overspeeding", fuel_drop: "Sudden fuel drop", tamper: "Tamper", power_cut: "Power cut", sos: "SOS", panic: "Panic button",
  };
  const ICON = {
    fuel_theft: "fuel", fuel_leak: "droplet", fuel_drop: "fuel", tyre_pressure_loss: "tire", tyre_low_pressure: "tire", engine_overheat: "engine",
    low_battery: "battery", forward_collision: "shieldAlert", headway_warning: "carFront", pedestrian_warning: "shieldAlert", lane_departure: "map",
    fatigue: "eye", distraction: "eye", phone_use: "phone", tamper: "alert", overspeed: "gauge", harsh_brake: "gauge", sos: "sos", panic: "sos",
  };
  const T = { items: [], analyses: {}, sev: "all", status: "open", q: "", sel: null, loaded: false, busy: false, pending: null, timer: 0, at: 0 };

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const icon = (n, s = 16) => (window.FWIcon ? FWIcon(n || "alert", { size: s }) : "");
  const signedIn = () => !!(window.fwCloud && fwCloud.user && fwCloud.user());
  const vehName = id => { const v = ((window.db && db.vehicles) || []).find(x => x.dbId === id || x.id === id); return v ? v.name : null; };
  const drvName = id => { const d = ((window.db && db.drivers) || []).find(x => x.dbId === id || x.id === id); return d ? d.name : null; };
  const drvForVeh = vid => { const v = ((window.db && db.vehicles) || []).find(x => x.dbId === vid); const d = v && ((window.db && db.drivers) || []).find(x => x.vehicleId === v.id); return d ? d.name : null; };
  const ago = ts => { const s = Math.max(0, Math.round((Date.now() - new Date(ts)) / 1000)); return s < 60 ? s + "s ago" : s < 3600 ? Math.round(s / 60) + "m ago" : s < 86400 ? Math.round(s / 3600) + "h ago" : Math.round(s / 86400) + "d ago"; };
  const clock = ts => new Date(ts).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const inr = n => "₹" + Math.round(n).toLocaleString("en-IN");
  const code = it => (it.src === "ai" ? "AI-" : "CAM-") + it.id.slice(0, 6).toUpperCase();

  // ── data ────────────────────────────────────────────────────────────
  function describeDevice(e, raw) {
    const s = raw && raw.scenario && window.FWVision && FWVision.SCENARIOS[raw.scenario];
    if (s) return s.text;
    const bits = [LABEL[e.event_type] || e.event_type];
    if (e.speed_kmph != null) bits.push(`at ${Math.round(e.speed_kmph)} km/h`);
    if (raw && raw.ttc_s) bits.push(`time to collision ${raw.ttc_s} s`);
    if (raw && raw.perclos_pct) bits.push(`PERCLOS ${raw.perclos_pct}%`);
    if (raw && raw.litres_lost) bits.push(`${raw.litres_lost} L lost`);
    return bits.join(", ") + ".";
  }

  async function load() {
    if (!signedIn()) { T.items = []; T.loaded = true; return; }
    const get = (t, q) => fwCloud.authGet(t, q).catch(() => null);
    const [ai, cam, raw, an] = await Promise.all([
      get("ai_events", "select=*&order=occurred_at.desc&limit=200"),
      get("v_safety_events", "select=id,device_id,vehicle_id,driver_id,occurred_at,event_type,severity,latitude,longitude,speed_kmph,video_url,acknowledged_at,simulated&order=occurred_at.desc&limit=300"),
      get("device_events", "select=id,raw,resolution_note&order=occurred_at.desc&limit=300"),
      get("incident_analyses", "select=*&order=created_at.desc&limit=500"),
    ]);
    const rawById = {}; (raw || []).forEach(r => { rawById[r.id] = r; });
    const items = [];
    (ai || []).forEach(e => items.push({
      src: "ai", id: e.id, type: e.event_type, sev: e.severity, at: e.occurred_at, vehicle_id: e.vehicle_id, driver_id: null, device_id: e.device_id,
      summary: e.summary, evidence: e.evidence || {}, confidence: e.confidence, speed: e.evidence && e.evidence.speed_kmph, simulated: e.simulated,
      ack_at: e.acknowledged_at, note: e.resolution_note, model: e.model,
    }));
    (cam || []).forEach(e => {
      const r = rawById[e.id] || {}, rw = r.raw || {};
      items.push({
        src: "device", id: e.id, type: e.event_type, sev: e.severity, at: e.occurred_at, vehicle_id: e.vehicle_id, driver_id: e.driver_id, device_id: e.device_id,
        summary: describeDevice(e, rw), evidence: rw, confidence: rw.confidence, speed: e.speed_kmph, lat: e.latitude, lng: e.longitude,
        video_url: e.video_url, simulated: e.simulated, ack_at: e.acknowledged_at, note: r.resolution_note,
      });
    });
    T.items = items;
    T.analyses = {};
    (an || []).forEach(a => { const k = a.source + ":" + a.event_id; if (!T.analyses[k]) T.analyses[k] = a; });   // newest first, keep the latest
    T.loaded = true; T.at = Date.now();
  }

  function filtered() {
    const q = T.q.trim().toLowerCase();
    return T.items.filter(it => {
      if (T.sev !== "all" && it.sev !== T.sev) return false;
      if (T.status === "open" && it.ack_at) return false;
      if (T.status === "resolved" && !it.ack_at) return false;
      if (q && !`${vehName(it.vehicle_id) || ""} ${drvName(it.driver_id) || drvForVeh(it.vehicle_id) || ""} ${LABEL[it.type] || it.type} ${it.summary || ""}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => (!!a.ack_at - !!b.ack_at) || ((SEV[a.sev] || SEV.info).rank - (SEV[b.sev] || SEV.info).rank) || (new Date(b.at) - new Date(a.at)));
  }

  // ── render ──────────────────────────────────────────────────────────
  function render() {
    const r = $("triageRoot"); if (!r) return;
    const open = T.items.filter(i => !i.ack_at);
    const crit = open.filter(i => i.sev === "critical");
    const analysed = T.items.filter(i => T.analyses[i.src + ":" + i.id]).length;
    const loss = Object.values(T.analyses).reduce((t, a) => t + (Number(a.est_loss_inr) || 0), 0);
    r.innerHTML = `
    <div class="oc">
      <div class="oc-head">
        <h2>${icon("shieldAlert", 20)} Incident Triage</h2>
        <span class="oc-live ${T.at ? "" : "off"}" id="trLive">${T.at ? "Live · updated " + ago(T.at) : "Loading"}</span>
        <span class="oc-spacer"></span>
        <div class="oc-seg" role="group" aria-label="Status">${[["open", "Open"], ["resolved", "Resolved"], ["all", "All"]].map(([k, l]) => `<button type="button" class="oc-seg-btn" data-status="${k}" aria-pressed="${T.status === k}">${l}</button>`).join("")}</div>
        <button type="button" class="btn btn-outline btn-sm" id="trRefresh">Refresh</button>
        <p class="oc-sub">Camera alerts and vehicle-sensor detections in one queue. Open one to see the evidence, get an AI root-cause analysis and close it with a note.</p>
      </div>
      <div class="oc-kpis">
        <div class="oc-kpi k-red"><small>Open critical ${icon("alert", 16)}</small><b>${crit.length}</b><em>${crit.length ? "needs action now" : "none waiting"}</em></div>
        <div class="oc-kpi k-amber"><small>Open incidents ${icon("clock", 16)}</small><b>${open.length}</b><em>${T.items.length} in total</em></div>
        <div class="oc-kpi k-cyan"><small>AI analysed ${icon("brain", 16)}</small><b>${analysed}</b><em>root cause written</em></div>
        <div class="oc-kpi k-green"><small>Fuel value at risk ${icon("rupee", 16)}</small><b>${loss ? inr(loss) : "—"}</b><em>from analysed fuel incidents</em></div>
      </div>
      <div class="oc-cols left">
        <div class="oc-card">
          <h3>${icon("filter", 14)} Queue <span class="oc-spacer"></span><span id="trCount"></span></h3>
          <div class="oc-chips" style="margin-bottom:10px" role="group" aria-label="Severity">
            ${[["all", "All", ""], ["critical", "Critical", "sev-red"], ["warning", "Warning", "sev-amber"]].map(([k, l, c]) => `<button type="button" class="oc-chip ${c}" data-sev="${k}" aria-pressed="${T.sev === k}">${l}</button>`).join("")}
          </div>
          <input type="search" id="trSearch" placeholder="Search vehicle, driver or type" value="${esc(T.q)}" aria-label="Search incidents" style="width:100%;margin-bottom:10px">
          <ul class="tr-queue" id="trQueue" role="listbox" aria-label="Incidents"></ul>
        </div>
        <div class="oc-card" id="trDetail" aria-live="polite"></div>
      </div>
    </div>`;
    wire(); renderQueue(); renderDetail();
  }

  function renderQueue() {
    const ul = $("trQueue"); if (!ul) return;
    if (!T.loaded) { ul.innerHTML = `<li class="oc-skel"></li><li class="oc-skel"></li><li class="oc-skel"></li>`; return; }
    if (!signedIn()) { ul.innerHTML = `<li class="oc-empty">Sign in to see your fleet's incidents.</li>`; $("trCount").textContent = ""; return; }
    const rows = filtered();
    $("trCount").textContent = rows.length + " shown";
    if (!rows.length) {
      ul.innerHTML = T.items.length
        ? `<li class="oc-empty"><span class="ic-tile success">${icon("checkCircle", 22)}</span><b>Nothing here.</b><br>Try another filter.</li>`
        : `<li class="oc-empty"><span class="ic-tile info">${icon("camera", 22)}</span><b>No incidents yet.</b><br>They appear when a camera or tracker flags something.<br><button type="button" class="btn btn-primary btn-sm" data-go="vision" style="margin-top:10px">Try one in AI Vision</button></li>`;
      ul.querySelectorAll("[data-go]").forEach(b => b.onclick = () => activateTab(b.dataset.go));
      return;
    }
    if (!T.sel || !rows.some(i => i.src + ":" + i.id === T.sel)) T.sel = rows[0].src + ":" + rows[0].id;
    ul.innerHTML = rows.slice(0, 80).map((it, i) => {
      const s = SEV[it.sev] || SEV.info, k = it.src + ":" + it.id;
      return `<li class="tr-item ${it.ack_at ? "is-done" : ""}" style="--sev:${s.c}" role="option" tabindex="${k === T.sel ? 0 : -1}" aria-selected="${k === T.sel}" data-k="${esc(k)}">
        <div class="tr-item-top">${esc(vehName(it.vehicle_id) || "Unknown vehicle")}<span class="oc-spacer"></span>${it.simulated ? `<span class="oc-tag sim">Test</span>` : ""}${T.analyses[k] ? `<span class="oc-tag ai">AI</span>` : ""}<span class="oc-tag ${it.ack_at ? "ok" : it.sev}">${it.ack_at ? "Resolved" : s.label}</span></div>
        <h4>${icon(ICON[it.type], 13)} ${esc(LABEL[it.type] || it.type)}</h4>
        <p>${esc(it.summary || "")}</p>
        <footer><span>${esc(drvName(it.driver_id) || drvForVeh(it.vehicle_id) || "Driver not known")}</span><span>${esc(clock(it.at))}</span></footer>
      </li>`;
    }).join("");
  }

  function current() { return T.items.find(i => i.src + ":" + i.id === T.sel); }

  function evidenceFrame(it) {
    const scen = it.evidence && it.evidence.scenario;
    if (scen && window.FWVision && FWVision.SCENARIOS[scen]) {
      return `<figure class="tr-frame"><canvas id="trFrame" data-scen="${esc(scen)}" data-cam="${esc(FWVision.SCENARIOS[scen].cam)}" aria-label="Freeze frame, simulated"></canvas><figcaption>Freeze frame · simulated · ${Math.round((it.confidence || 0.9) * 100)}% confidence</figcaption></figure>`;
    }
    if (it.video_url && /^storage:device-media\//.test(it.video_url)) {
      // private clip: the signed link is filled in after render (see loadMedia)
      return `<figure class="tr-frame"><video controls playsinline preload="metadata" id="trClip" data-path="${esc(it.video_url.slice("storage:device-media/".length))}"></video><figcaption>Camera clip</figcaption></figure>`;
    }
    if (it.video_url && /^https:\/\//i.test(it.video_url)) {
      return `<figure class="tr-frame"><video controls playsinline preload="metadata" src="${esc(it.video_url)}"></video></figure>`;
    }
    const e = it.evidence || {};
    const from = e.from_pct ?? e.from_psi, to = e.to_pct ?? e.to_psi;
    if (from != null && to != null) {
      const unit = e.from_pct != null ? "%" : " psi", max = e.from_pct != null ? 100 : Math.max(130, from);
      const W = 480, H = 270, bar = v => H - 40 - (v / max) * (H - 80);
      return `<figure class="tr-frame is-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Reading fell from ${from}${unit} to ${to}${unit}">
        <line x1="40" x2="${W - 20}" y1="${H - 40}" y2="${H - 40}" stroke="#1f2d4a"/>
        <rect x="110" y="${bar(from)}" width="90" height="${H - 40 - bar(from)}" rx="6" fill="#22d3ee" opacity=".75"/>
        <rect x="290" y="${bar(to)}" width="90" height="${H - 40 - bar(to)}" rx="6" fill="#ef4444"/>
        <text x="155" y="${bar(from) - 8}" text-anchor="middle" fill="#e2e8f0" font-family="ui-monospace,monospace" font-size="16" font-weight="700">${from}${unit}</text>
        <text x="335" y="${bar(to) - 8}" text-anchor="middle" fill="#fca5a5" font-family="ui-monospace,monospace" font-size="16" font-weight="700">${to}${unit}</text>
        <text x="155" y="${H - 18}" text-anchor="middle" fill="#8494b2" font-size="12">Before</text>
        <text x="335" y="${H - 18}" text-anchor="middle" fill="#8494b2" font-size="12">After${e.minutes != null ? ` (${e.minutes} min)` : ""}</text>
      </svg><figcaption>Sensor reading before and after</figcaption></figure>`;
    }
    return `<figure class="tr-frame is-empty"><span class="muted">${icon("camera", 22)}<br>No clip or chart for this incident.<br>Cameras upload a clip when they detect one.</span></figure>`;
  }

  function evidenceKv(it) {
    const e = it.evidence || {}, rows = [
      ["Type", LABEL[it.type] || it.type],
      ["Speed", it.speed != null ? Math.round(it.speed) + " km/h" : "not recorded"],
      ["Confidence", it.confidence != null ? Math.round(it.confidence * 100) + "%" : "—"],
    ];
    const pick = { drop_pct: ["Fuel drop", "%"], litres_lost: ["Fuel lost", " L", 1], ttc_s: ["Time to collision", " s", 1], distance_m: ["Gap", " m"], perclos_pct: ["Eyes closed (PERCLOS)", "%", 1], eyes_closed_s: ["Eyes closed for", " s"], offset_m: ["Lane offset", " m", 1], gaze_off_road_s: ["Gaze off road", " s"], lost_psi: ["Pressure lost", " psi", 1], coolant_temp_c: ["Coolant", " °C", 1], battery_voltage: ["Battery", " V", 1], minutes: ["Over", " min"] };
    Object.entries(pick).forEach(([k, [l, u, hot]]) => { if (e[k] != null) rows.push([l, e[k] + u, hot]); });
    if (e.ignition === false) rows.push(["Ignition", "off"]);
    if (it.lat != null) rows.push(["Location", Number(it.lat).toFixed(4) + ", " + Number(it.lng).toFixed(4)]);
    return `<dl class="oc-kv">${rows.map(([k, v, hot]) => `<dt>${esc(k)}</dt><dd class="${hot ? "hot" : ""}">${esc(v)}</dd>`).join("")}</dl>`;
  }

  function aiPanel(it) {
    const a = T.analyses[it.src + ":" + it.id];
    if (T.busy) return `<div class="tr-ai"><div class="tr-ai-head"><h4>${icon("brain", 16)} AI root-cause analysis</h4></div><p class="muted" style="margin:0"><span class="tr-spin"></span> Reading the incident, the readings around it and this vehicle's history…</p></div>`;
    if (!a) return `<div class="tr-ai"><div class="tr-ai-head"><h4>${icon("brain", 16)} AI root-cause analysis</h4></div>
      <p class="muted" style="margin:0 0 10px;font-size:.84rem">Not analysed yet. The AI reads this incident, the sensor readings 30 minutes either side, how often it has happened on this vehicle, and your diesel rate, then says what happened and what to do.</p>
      <button type="button" class="btn btn-primary btn-sm" data-analyse>${icon("brain", 14)} Run AI root-cause analysis</button></div>`;
    return `<div class="tr-ai">
      <div class="tr-ai-head"><h4>${icon("brain", 16)} AI root-cause analysis</h4><span class="oc-spacer" style="flex:1"></span>
        <span class="oc-tag ${a.confidence === "high" ? "ok" : a.confidence === "low" ? "warning" : "info"}">${esc(a.confidence || "medium")} confidence</span>
        ${a.est_loss_inr ? `<span class="oc-tag critical">${inr(a.est_loss_inr)} at risk</span>` : ""}</div>
      <div class="tr-ai-grid">
        <section><h5>What happened</h5><p>${esc(a.root_cause)}</p></section>
        <section><h5>What is at risk</h5><p>${esc(a.risk)}</p></section>
        <section class="act"><h5>What to do now</h5><p>${esc(a.action)}</p></section>
        <section><h5>Rules &amp; evidence</h5><p>${esc(a.compliance || "Nothing specific applies.")}</p></section>
      </div>
      <p class="muted" style="font-size:.72rem;margin:12px 0 0">${a.model ? "Written by FleetWorks AI" : "Written by the FleetWorks rules (AI unavailable)"} · ${esc(clock(a.created_at))} · based on ${a.facts && a.facts.readings_around_event ? a.facts.readings_around_event.length : 0} sensor readings <button type="button" class="link-btn" data-analyse>Run again</button></p>
    </div>`;
  }

  function renderDetail() {
    const el = $("trDetail"); if (!el) return;
    const it = current();
    if (!it) { el.innerHTML = `<div class="oc-empty">${T.loaded ? "Pick an incident from the queue." : ""}</div>`; return; }
    const s = SEV[it.sev] || SEV.info, a = T.analyses[it.src + ":" + it.id];
    const scen = it.evidence && it.evidence.scenario;
    el.innerHTML = `
      <div class="tr-detail-head">
        <h3>Incident ${esc(code(it))}</h3>
        <span class="oc-tag ${it.sev}">${s.label}</span>
        ${it.simulated ? `<span class="oc-tag sim">Test incident</span>` : ""}
        ${it.ack_at ? `<span class="oc-tag ok">Resolved</span>` : ""}
      </div>
      <p class="tr-meta">${esc(vehName(it.vehicle_id) || "Unknown vehicle")} · ${esc(drvName(it.driver_id) || drvForVeh(it.vehicle_id) || "driver not known")} · ${esc(it.src === "ai" ? "Vehicle sensors" : "Camera")} · ${esc(clock(it.at))} (${ago(it.at)})</p>
      <div class="tr-actions">
        <button type="button" class="btn btn-primary btn-sm" data-analyse ${T.busy ? "disabled" : ""}>${icon("brain", 14)} ${a ? "Run AI analysis again" : "Run AI root-cause analysis"}</button>
        ${it.ack_at ? "" : `<button type="button" class="btn btn-outline btn-sm" id="trResolveBtn">${icon("checkCircle", 14)} Mark resolved</button>`}
        ${scen ? `<button type="button" class="btn btn-outline btn-sm" id="trVision">${icon("camera", 14)} Open in AI Vision</button>` : ""}
        ${it.src === "device" && window.openEventDetail ? `<button type="button" class="btn btn-outline btn-sm" id="trFull">Full review &amp; coaching</button>` : ""}
      </div>
      <div class="tr-resolve" id="trResolve" hidden>
        <textarea id="trNote" placeholder="What did you do? For example: called the driver, he stopped to rest at the next dhaba." aria-label="Resolution note"></textarea>
        <div class="tr-resolve-btns"><button type="button" class="btn btn-primary btn-sm" id="trResolveSave">Save and close incident</button><button type="button" class="btn btn-outline btn-sm" id="trResolveCancel">Cancel</button></div>
      </div>
      <div class="tr-evidence">
        ${evidenceFrame(it)}
        <div class="oc-card is-inset"><h3>Evidence</h3>${evidenceKv(it)}</div>
      </div>
      <div id="trMedia"></div>
      ${aiPanel(it)}
      <div style="margin-top:14px"><h4 style="font-size:.78rem;letter-spacing:.06em;text-transform:uppercase;color:var(--oc-muted);margin:0 0 10px">Timeline</h4>
        <ul class="tr-timeline">
          <li><b>Detected</b> · ${esc(clock(it.at))}</li>
          <li class="${a ? "" : "todo"}"><b>${a ? "AI analysed" : "Not analysed"}</b>${a ? " · " + esc(clock(a.created_at)) : ""}</li>
          <li class="${it.ack_at ? "" : "todo"}"><b>${it.ack_at ? "Resolved" : "Open"}</b>${it.ack_at ? " · " + esc(clock(it.ack_at)) : ""}${it.note ? `<br><span>${esc(it.note)}</span>` : ""}</li>
        </ul></div>`;
    el.querySelectorAll("[data-analyse]").forEach(b => b.onclick = () => analyse(it));
    const rb = $("trResolveBtn"); if (rb) rb.onclick = () => { $("trResolve").hidden = false; rb.hidden = true; $("trNote").focus(); };
    const rc = $("trResolveCancel"); if (rc) rc.onclick = () => { $("trResolve").hidden = true; if (rb) rb.hidden = false; };
    const rs = $("trResolveSave"); if (rs) rs.onclick = () => resolve(it);
    const vb = $("trVision"); if (vb) vb.onclick = () => activateTab("vision");
    const fb = $("trFull"); if (fb) fb.onclick = () => openEventDetail(it.id);
    loadMedia(it);
    const cv = $("trFrame");
    if (cv && window.FWVision) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round((cv.clientWidth || 480) * dpr); cv.height = Math.round((cv.clientHeight || 270) * dpr);
      FWVision.draw(cv.getContext("2d"), cv.width, cv.height, cv.dataset.cam, cv.dataset.scen, 1.2, { heatmap: true, minConf: 0.5 });
    }
  }

  // Every file the cameras sent for this incident (front, cabin, 360°, cargo...), via
  // short-lived signed links: the bucket is private and RLS decides who may read.
  async function loadMedia(it) {
    const key = it.src + ":" + it.id;
    const sign = p => fwCloud.signUrl ? fwCloud.signUrl("device-media", p, 3600) : Promise.resolve(null);
    const clip = $("trClip");
    if (clip && clip.dataset.path) sign(clip.dataset.path).then(u => { if (u && $("trClip") === clip) clip.src = u; });
    if (it.src !== "device" || !signedIn()) return;
    const rows = await fwCloud.authGet("device_media", `select=id,kind,role,channel_no,storage_path,source_url,captured_at&event_id=eq.${it.id}&order=channel_no`).catch(() => null);
    const el = $("trMedia");
    if (!el || T.sel !== key || !rows || !rows.length) return;
    const urls = await Promise.all(rows.map(m => m.storage_path ? sign(m.storage_path) : Promise.resolve(/^https:\/\//i.test(m.source_url || "") ? m.source_url : null)));
    if ($("trMedia") !== el || T.sel !== key) return;
    const ROLE = { front_road: "Front road", cabin_dms: "Cabin", left: "Left", right: "Right", rear: "Rear", cargo: "Cargo", surround_avm: "360°", tank: "Fuel tank" };
    el.innerHTML = `<h4 class="tr-media-h">Camera files (${rows.length})</h4><div class="tr-media">${rows.map((m, i) => {
      const label = ROLE[m.role] || (m.channel_no ? "Channel " + m.channel_no : "Camera");
      if (!urls[i]) return `<figure class="tr-frame is-empty"><span class="muted">${esc(label)}: file not available</span></figure>`;
      return m.kind === "snapshot"
        ? `<figure class="tr-frame"><img src="${esc(urls[i])}" alt="${esc(label)} snapshot" loading="lazy"><figcaption>${esc(label)} · snapshot</figcaption></figure>`
        : `<figure class="tr-frame"><video controls playsinline preload="metadata" src="${esc(urls[i])}"></video><figcaption>${esc(label)} · clip</figcaption></figure>`;
    }).join("")}</div>`;
  }

  // ── actions ─────────────────────────────────────────────────────────
  async function analyse(it) {
    if (T.busy) return;
    T.busy = true; renderDetail();
    try {
      const r = await fwCloud.callFunction("incident-analysis", { source: it.src, eventId: it.id });
      if (r && r.analysis) T.analyses[it.src + ":" + it.id] = r.analysis;
      if (window.toast) toast("AI analysis ready.");
    } catch (e) {
      if (window.toast) toast(e.message || "The AI analysis did not run. Try again.", "err");
    } finally { T.busy = false; render(); }   // full render: the "AI analysed" and "at risk" counts change too
  }

  async function resolve(it) {
    const note = ($("trNote").value || "").trim();
    const btn = $("trResolveSave"); btn.disabled = true;
    const table = it.src === "ai" ? "ai_events" : "device_events";
    const at = new Date().toISOString();
    const ok = await fwCloud.authPatchChecked(`${table}?id=eq.${it.id}`, { acknowledged_at: at, acknowledged_by: fwCloud.uid(), resolution_note: note || null });
    if (ok) {
      it.ack_at = at; it.note = note;
      if (window.toast) toast("Incident closed.");
      render();
    } else { btn.disabled = false; if (window.toast) toast("Could not save. Try again.", "err"); }
  }

  function wire() {
    const r = $("triageRoot");
    r.querySelectorAll("[data-status]").forEach(b => b.onclick = () => { T.status = b.dataset.status; render(); });
    r.querySelectorAll("[data-sev]").forEach(b => b.onclick = () => { T.sev = b.dataset.sev; render(); });
    $("trRefresh").onclick = open;
    $("trSearch").oninput = e => { T.q = e.target.value; renderQueue(); renderDetail(); };
    const ul = $("trQueue");
    ul.onclick = e => { const li = e.target.closest("[data-k]"); if (!li) return; T.sel = li.dataset.k; renderQueue(); renderDetail(); };
    ul.onkeydown = e => {
      const items = [...ul.querySelectorAll("[data-k]")], i = items.findIndex(x => x.dataset.k === T.sel);
      const move = d => { const n = items[Math.max(0, Math.min(items.length - 1, i + d))]; if (n) { T.sel = n.dataset.k; renderQueue(); renderDetail(); const f = ul.querySelector(`[data-k="${CSS.escape(T.sel)}"]`); if (f) f.focus(); } };
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); move(-1); }
    };
  }

  // ── lifecycle ───────────────────────────────────────────────────────
  async function open() {
    if (!$("triageRoot")) return;
    if (!T.loaded) render();
    await load();
    if (T.pending) {
      T.sel = T.pending.key; T.status = "all"; T.sev = "all";
    }
    render();
    if (T.pending) {
      const p = T.pending; T.pending = null;
      const it = current();
      if (it && p.analyse && !T.analyses[p.key]) analyse(it);
    }
    clearInterval(T.timer);
    T.timer = setInterval(() => {
      const p = $("tab-triage");
      if (!p || !p.classList.contains("active")) { clearInterval(T.timer); return; }
      if (document.hidden || T.busy) return;
      load().then(() => { renderQueue(); const l = $("trLive"); if (l) l.textContent = "Live · updated just now"; });
    }, 60000);
  }

  window.IncidentTriage = {
    open,
    /** Select an incident the next time the page opens (and optionally analyse it). */
    focus(src, id, opts = {}) { T.pending = { key: src + ":" + id, analyse: !!opts.analyse }; },
  };
})();
