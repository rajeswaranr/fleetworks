/* Device Hub (FleetSafe → Device Hub).
   Where a fleet connects hardware, whatever the brand:
     Connect   the ingest endpoints, this fleet's keys, and setup steps for direct JSON,
               flespi and Traccar (which carry Teltonika, GT06, JT/T 808/1078, AIS-140...)
     Devices   register trackers, dashcams/MDVRs, 360° and cargo cameras, fuel and
               temperature sensors; set camera channels and map any sensor parameter to
               a signal, with a calibration table for fuel tanks
     Ingest log  every POST the endpoints received, including devices not registered yet
     Alerts    who gets told, by SMS, and the thresholds; the recent alert inbox
   Backend: supabase/functions/device-ingest, device-media, fleetsafe-dispatch and the
   migrations 20260928105000 / 110000 / 120000. Guide: docs/device-integration.md. */
(function () {
  "use strict";

  const BASE = () => ((window.FW_BACKEND && FW_BACKEND.url) || "") + "/functions/v1";
  const KINDS = {
    tracker: ["GPS tracker / AIS-140", "mapPin"], dashcam: ["AI dashcam", "camera"], mdvr: ["MDVR (multi-camera recorder)", "camera"],
    avm_360: ["360° camera (AVM)", "eye"], cargo_camera: ["Cargo camera", "boxes"], fuel_sensor: ["Fuel level sensor", "fuel"],
    temp_sensor: ["Temperature sensor", "zap"], tpms: ["Tyre pressure (TPMS)", "tire"], obd: ["OBD / CAN reader", "engine"], other: ["Other", "zap"],
  };
  const PROTOCOLS = { teltonika: "Teltonika (Codec 8/8E)", gt06: "Concox GT06", jt808: "JT/T 808", jt1078: "JT/T 1078 (video)", ais140: "AIS-140",
    queclink: "Queclink", fms: "FMS / J1939", obd2: "OBD-II", onvif: "ONVIF", rtsp: "RTSP", http: "HTTP JSON", mqtt: "MQTT", proprietary: "Other / proprietary" };
  const INTEGRATIONS = { native: "Posts to FleetWorks directly", flespi: "Through flespi", traccar: "Through Traccar", vendor_api: "Vendor cloud", manual: "Manual / none" };
  const ROLES = { front_road: "Front road", cabin_dms: "Cabin (driver monitor)", left: "Left side", right: "Right side", rear: "Rear",
    cargo: "Cargo", surround_avm: "360° composite", tank: "Fuel tank", other: "Other" };
  const H = { tab: "connect", keys: [], devices: [], channels: [], sensors: [], signals: [], log: [], settings: null, alerts: [], open: null, newKey: null, lastParams: {}, loaded: false };

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const icon = (n, s = 16) => (window.FWIcon ? FWIcon(n, { size: s }) : "");
  const signedIn = () => !!(window.fwCloud && fwCloud.user && fwCloud.user());
  const ago = ts => { if (!ts) return "never"; const s = Math.max(0, Math.round((Date.now() - new Date(ts)) / 1000)); return s < 60 ? s + "s ago" : s < 3600 ? Math.round(s / 60) + "m ago" : s < 86400 ? Math.round(s / 3600) + "h ago" : Math.round(s / 86400) + "d ago"; };
  const vehicles = () => ((window.db && db.vehicles) || []).filter(v => v.dbId);
  const vehName = id => { const v = vehicles().find(x => x.dbId === id); return v ? v.name : "—"; };
  const toast = (m, k) => window.toast && window.toast(m, k);
  const copyBtn = (text, label = "Copy") => `<button type="button" class="btn btn-outline btn-sm" data-copy="${esc(text)}">${icon("document", 13)} ${label}</button>`;

  // ── data ────────────────────────────────────────────────────────────
  async function load() {
    const get = (t, q) => fwCloud.authGet(t, q).catch(() => null);
    const [keys, devices, channels, sensors, signals, log, settings, alerts] = await Promise.all([
      get("integration_keys", "select=id,name,key_prefix,created_at,last_used_at,revoked_at&order=created_at.desc"),
      get("devices", "select=*&order=created_at.desc&limit=500"),
      get("device_channels", "select=*&order=channel_no"),
      get("device_sensors", "select=*&order=created_at"),
      get("vehicle_signals", "select=path,unit,description,datatype&is_ai=eq.false&order=path"),
      get("ingest_log", "select=*&order=received_at.desc&limit=100"),
      get("fleetsafe_settings", "select=*&limit=1"),
      get("fleet_alerts", "select=*&order=created_at.desc&limit=50"),
    ]);
    Object.assign(H, { keys: keys || [], devices: devices || [], channels: channels || [], sensors: sensors || [], signals: signals || [],
      log: log || [], settings: (settings || [])[0] || null, alerts: alerts || [], loaded: true });
  }
  async function loadLastParams(deviceId) {
    const rows = await fwCloud.authGet("telemetry", `select=raw,recorded_at&device_id=eq.${deviceId}&order=recorded_at.desc&limit=1`).catch(() => null);
    H.lastParams[deviceId] = rows && rows[0] ? { raw: rows[0].raw || {}, at: rows[0].recorded_at } : { raw: {}, at: null };
  }

  // ── render ──────────────────────────────────────────────────────────
  function render() {
    const r = $("deviceHubRoot"); if (!r) return;
    if (!signedIn()) { r.innerHTML = `<div class="oc"><div class="oc-empty">${icon("zap", 22)}<br><b>Sign in to connect your devices.</b></div></div>`; return; }
    if (!H.loaded) { r.innerHTML = `<div class="oc"><div class="oc-skel"></div><div class="oc-skel"></div><div class="oc-skel"></div></div>`; return; }
    const online = H.devices.filter(d => d.last_seen_at && Date.now() - new Date(d.last_seen_at) < 10 * 60000).length;
    const unknown = H.log.filter(l => l.status === "unknown_device").length;
    r.innerHTML = `
    <div class="oc">
      <div class="oc-head">
        <h2>${icon("zap", 20)} Device Hub</h2>
        <span class="oc-live ${online ? "" : "off"}">${online} of ${H.devices.length} reporting</span>
        <span class="oc-spacer"></span>
        <div class="oc-seg" role="tablist" aria-label="Device Hub sections">
          ${[["connect", "Connect"], ["devices", "Devices"], ["log", `Ingest log${unknown ? ` (${unknown} unknown)` : ""}`], ["alerts", "Alerts"]].map(([k, l]) =>
            `<button type="button" class="oc-seg-btn" role="tab" data-tab-dh="${k}" aria-pressed="${H.tab === k}">${l}</button>`).join("")}
        </div>
        <p class="oc-sub">Connect any GPS tracker, dashcam, 360° or cargo camera, fuel or temperature sensor. Devices post to one endpoint, directly or through a protocol gateway, and every feature in FleetSafe works from the same data.</p>
      </div>
      <div id="dhBody"></div>
    </div>`;
    r.querySelectorAll("[data-tab-dh]").forEach(b => b.onclick = () => { H.tab = b.dataset.tabDh; render(); });
    ({ connect: renderConnect, devices: renderDevices, log: renderLog, alerts: renderAlerts })[H.tab]();
    r.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(b.dataset.copy).then(() => toast("Copied.")); });
  }

  function renderConnect() {
    const key = H.newKey ? H.newKey.key : "fwk_YOUR_KEY";
    const eps = [
      ["FleetWorks JSON (direct: AI dashcams, vendor clouds, scripts)", `${BASE()}/device-ingest?format=fleetworks`],
      ["flespi stream (Teltonika, GT06, JT/T 808, AIS-140 and 700+ protocols)", `${BASE()}/device-ingest?format=flespi`],
      ["Traccar forwarding (200+ protocols, self-hosted or Traccar cloud)", `${BASE()}/device-ingest?format=traccar`],
      ["Camera clips & snapshots (multipart upload or a download URL)", `${BASE()}/device-media`],
    ];
    const active = H.keys.filter(k => !k.revoked_at);
    $("dhBody").innerHTML = `
      <div class="oc-cols">
        <div class="oc-stack">
          <div class="oc-card"><h3>${icon("link", 14)} Endpoints</h3>
            <ul class="dh-list">${eps.map(([l, u]) => `<li><div><b>${esc(l)}</b><code class="dh-code">${esc(u)}</code></div>${copyBtn(u)}</li>`).join("")}</ul>
            <p class="muted dh-note">Authenticate with the header <code>x-ingest-key</code>. Gateways that cannot set headers may add <code>&amp;key=…</code> to the URL instead.</p>
          </div>
          <div class="oc-card"><h3>${icon("document", 14)} Set-up by path</h3>
            <div class="dh-guide">
              <details open><summary>Direct JSON: a device or vendor cloud that can POST</summary>
<pre class="dh-pre">curl -X POST '${esc(eps[0][1])}' \\
  -H 'x-ingest-key: ${esc(key)}' -H 'content-type: application/json' \\
  -d '{"imei":"862095050000001",
       "readings":[{"recorded_at":"2026-09-28T10:00:00Z","latitude":11.66,"longitude":78.15,
                    "speed_kmph":48,"ignition":true,"fuel_level_pct":62,"cargo_temp_c":4.1}],
       "events":[{"event_type":"FCW","occurred_at":"2026-09-28T10:00:05Z","speed_kmph":64,
                  "media":[{"channel":1,"url":"https://vendor.example/clip.mp4"}]}]}'</pre></details>
              <details><summary>flespi: for binary trackers and JT/T 808 dashcams</summary>
<ol class="dh-steps"><li>In flespi, create a <b>channel</b> for your device protocol (Teltonika, Concox, JT808, AIS-140…) and point the devices at it.</li>
<li>Create a <b>stream</b> of type <b>http</b> with URI:<code class="dh-code">${esc(eps[1][1])}&amp;key=${esc(key)}</code></li>
<li>Subscribe the stream to the channel. Unknown parameters (fuel sensors, temperature probes) arrive too; map them under Devices.</li></ol></details>
              <details><summary>Traccar: open-source gateway</summary>
<pre class="dh-pre">&lt;entry key='forward.enable'&gt;true&lt;/entry&gt;
&lt;entry key='forward.type'&gt;json&lt;/entry&gt;
&lt;entry key='forward.url'&gt;${esc(eps[2][1])}&lt;/entry&gt;
&lt;entry key='forward.header'&gt;x-ingest-key: ${esc(key)}&lt;/entry&gt;
&lt;entry key='event.forward.enable'&gt;true&lt;/entry&gt;
&lt;entry key='event.forward.url'&gt;${esc(eps[2][1])}&lt;/entry&gt;
&lt;entry key='event.forward.header'&gt;x-ingest-key: ${esc(key)}&lt;/entry&gt;</pre></details>
              <details><summary>Camera clips: dashcam, MDVR, 360°, cargo</summary>
<pre class="dh-pre">curl -X POST '${esc(eps[3][1])}' -H 'x-ingest-key: ${esc(key)}' \\
  -F ident=862095050000001 -F channel=1 -F kind=clip \\
  -F event_type=fatigue -F captured_at=2026-09-28T10:00:05Z -F file=@clip.mp4</pre></details>
            </div>
          </div>
        </div>
        <div class="oc-stack">
          <div class="oc-card"><h3>${icon("shieldCheck", 14)} Ingest keys</h3>
            ${H.newKey ? `<div class="dh-newkey"><b>Copy this key now. It will not be shown again.</b><code class="dh-code">${esc(H.newKey.key)}</code>${copyBtn(H.newKey.key, "Copy key")}</div>` : ""}
            <div class="dh-row"><input type="text" id="dhKeyName" placeholder="Name, e.g. flespi stream" maxlength="60" aria-label="Key name"><button type="button" class="btn btn-primary btn-sm" id="dhKeyNew">Create key</button></div>
            <ul class="dh-list">${H.keys.length ? H.keys.map(k => `<li class="${k.revoked_at ? "is-off" : ""}"><div><b>${esc(k.name)}</b><span class="muted dh-sub">${esc(k.key_prefix)}… · created ${ago(k.created_at)} · used ${ago(k.last_used_at)}</span></div>
              ${k.revoked_at ? `<span class="oc-tag warning">revoked</span>` : `<button type="button" class="link-btn danger" data-revoke="${esc(k.id)}">Revoke</button>`}</li>`).join("") : `<li class="muted">No keys yet. Create one per gateway or vendor, so you can revoke one without touching the others.</li>`}</ul>
            <p class="muted dh-note">${active.length} active. A key only reaches devices registered in this fleet.</p>
          </div>
          <div class="oc-card"><h3>${icon("boxes", 14)} What plugs in where</h3>
            <dl class="oc-kv dh-kv">
              <dt>GPS tracker, AIS-140</dt><dd>gateway → device-ingest</dd>
              <dt>AI dashcam / MDVR</dt><dd>alarms → device-ingest, clips → device-media</dd>
              <dt>360° camera</dt><dd>channel role "360° composite"</dd>
              <dt>Cargo camera</dt><dd>channel role "Cargo"</dd>
              <dt>Fuel level sensor</dt><dd>via tracker → sensor mapping + tank table</dd>
              <dt>Temperature probe</dt><dd>via tracker → Cargo temperature</dd>
              <dt>TPMS</dt><dd>via tracker → Tyre min pressure</dd>
              <dt>Live video</dt><dd>HLS / WebRTC link per channel</dd>
            </dl>
          </div>
        </div>
      </div>`;
    $("dhKeyNew").onclick = createKey;
    $("dhBody").querySelectorAll("[data-revoke]").forEach(b => b.onclick = () => revokeKey(b.dataset.revoke));
  }

  function renderDevices() {
    const vs = vehicles();
    $("dhBody").innerHTML = `
      <div class="oc-card dh-add"><h3>${icon("plus", 14)} Register a device</h3>
        <div class="dh-form">
          <label>IMEI / serial<input type="text" id="dhImei" maxlength="64" placeholder="862095050000001"></label>
          <label>Type<select id="dhKind">${Object.entries(KINDS).map(([k, [l]]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></label>
          <label>Protocol<select id="dhProto">${Object.entries(PROTOCOLS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></label>
          <label>Connected<select id="dhInteg">${Object.entries(INTEGRATIONS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select></label>
          <label>Vehicle<select id="dhVeh"><option value="">Not fitted yet</option>${vs.map(v => `<option value="${esc(v.dbId)}">${esc(v.name)}</option>`).join("")}</select></label>
          <label>Attached to<select id="dhParent"><option value="">Nothing (reports itself)</option>${H.devices.map(d => `<option value="${esc(d.id)}">${esc(d.imei)} · ${esc(KINDS[d.kind] ? KINDS[d.kind][0] : d.kind)}</option>`).join("")}</select></label>
          <label>Gateway ID <span class="muted">(if different)</span><input type="text" id="dhExt" maxlength="64" placeholder="optional"></label>
          <button type="button" class="btn btn-primary btn-sm" id="dhAdd">Register</button>
        </div>
      </div>
      <div class="oc-card"><h3>${icon("zap", 14)} Devices <span class="oc-spacer"></span><span class="muted">${H.devices.length}</span></h3>
        ${H.devices.length ? `<ul class="dh-devs">${H.devices.map(deviceRow).join("")}</ul>` : `<div class="oc-empty">No devices yet. Register one above; readings from an unregistered device show up in the ingest log.</div>`}
      </div>`;
    $("dhAdd").onclick = addDevice;
    $("dhBody").querySelectorAll("[data-open]").forEach(b => b.onclick = async () => {
      H.open = H.open === b.dataset.open ? null : b.dataset.open;
      if (H.open && !H.lastParams[H.open]) await loadLastParams(H.open);
      renderDevices();
    });
    wireDeviceDetail();
    const pre = sessionStorage.getItem("dhPrefillImei"); if (pre) { $("dhImei").value = pre; sessionStorage.removeItem("dhPrefillImei"); $("dhImei").focus(); }
  }

  function deviceRow(d) {
    const on = d.last_seen_at && Date.now() - new Date(d.last_seen_at) < 10 * 60000;
    const [label, ic] = KINDS[d.kind] || [d.kind, "zap"];
    const open = H.open === d.id;
    return `<li class="dh-dev ${open ? "is-open" : ""}">
      <button type="button" class="dh-dev-head dh-toggle" data-open="${esc(d.id)}" aria-expanded="${open}">
        <span class="dh-ic">${icon(ic, 16)}</span>
        <span class="dh-dev-main"><b>${esc(d.imei)}</b><span class="muted dh-sub">${esc(label)} · ${esc(vehName(d.vehicle_id))} · ${esc(INTEGRATIONS[d.integration] || d.integration)}${d.simulated ? " · simulated" : ""}</span></span>
        <span class="oc-tag ${on ? "ok" : d.last_seen_at ? "warning" : "info"}">${on ? "reporting" : d.last_seen_at ? "quiet " + ago(d.last_seen_at) : "not yet seen"}</span>
      </button>
      ${open ? deviceDetail(d) : ""}
    </li>`;
  }

  function deviceDetail(d) {
    const chans = H.channels.filter(c => c.device_id === d.id);
    const sens = H.sensors.filter(s => s.device_id === d.id);
    const lp = H.lastParams[d.id] || { raw: {} };
    const keys = Object.keys(lp.raw || {}).filter(k => !/^(recorded_at|ident|device\.|channel\.|protocol\.|server\.|timestamp)/.test(k)).sort();
    const camera = ["dashcam", "mdvr", "avm_360", "cargo_camera"].includes(d.kind);
    return `<div class="dh-detail">
      ${camera || chans.length ? `<section><h4>Camera channels</h4>
        <table class="dh-table"><thead><tr><th>Ch</th><th>Role</th><th>Label</th><th>Live link (HLS / WebRTC / MP4)</th><th></th></tr></thead><tbody>
        ${chans.map(c => `<tr><td>${c.channel_no}</td><td>${esc(ROLES[c.role] || c.role)}</td><td>${esc(c.label || "")}</td><td class="dh-url">${c.live_url ? esc(c.live_url) : `<span class="muted">none</span>`}</td><td><button type="button" class="link-btn danger" data-del-ch="${esc(c.id)}">Remove</button></td></tr>`).join("")}
        <tr class="dh-new"><td><input type="number" min="1" max="32" id="chNo-${d.id}" value="${(chans.reduce((m, c) => Math.max(m, c.channel_no), 0) || 0) + 1}" aria-label="Channel number"></td>
          <td><select id="chRole-${d.id}" aria-label="Role">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${k === (d.kind === "avm_360" ? "surround_avm" : d.kind === "cargo_camera" ? "cargo" : chans.length ? "cabin_dms" : "front_road") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></td>
          <td><input type="text" id="chLabel-${d.id}" maxlength="40" placeholder="optional" aria-label="Label"></td>
          <td><input type="text" id="chUrl-${d.id}" placeholder="https://…/stream.m3u8" aria-label="Live link"></td>
          <td><button type="button" class="btn btn-outline btn-sm" data-add-ch="${esc(d.id)}">Add</button></td></tr>
        </tbody></table></section>` : ""}
      <section><h4>Sensor mappings</h4>
        <p class="muted dh-note">Map any parameter this device sends to a FleetWorks signal. Fuel sensors usually send raw counts: use a calibration table (raw, litres) from your tank calibration sheet.</p>
        <table class="dh-table"><thead><tr><th>Parameter from device</th><th>Becomes</th><th>Conversion</th><th></th></tr></thead><tbody>
        ${sens.map(s => `<tr><td><code>${esc(s.source_key)}</code></td><td>${esc(sigLabel(s.signal_path))}</td><td>${s.transform === "table" ? `table, ${(s.calibration || []).length} points` : s.transform === "linear" ? `× ${s.scale ?? 1} + ${s.offset ?? 0}` : "as sent"}</td><td><button type="button" class="link-btn danger" data-del-sn="${esc(s.id)}">Remove</button></td></tr>`).join("") || `<tr><td colspan="4" class="muted">None yet.</td></tr>`}
        </tbody></table>
        <div class="dh-form dh-sensor">
          <label>Parameter<input type="text" id="snKey-${d.id}" list="snKeys-${d.id}" placeholder="e.g. escort.lls.value.1, io.270, temp1"><datalist id="snKeys-${d.id}">${keys.map(k => `<option value="${esc(k)}">${esc(String(lp.raw[k]).slice(0, 20))}</option>`).join("")}</datalist></label>
          <label>Becomes<select id="snSig-${d.id}">${H.signals.map(s => `<option value="${esc(s.path)}" ${s.path === "Vehicle.Powertrain.FuelSystem.AbsoluteLevel" ? "selected" : ""}>${esc(sigLabel(s.path))}${s.unit ? " (" + esc(s.unit) + ")" : ""}</option>`).join("")}</select></label>
          <label>Conversion<select id="snTr-${d.id}"><option value="table">Calibration table</option><option value="linear">Scale and offset</option><option value="none">As sent</option></select></label>
          <label class="dh-lin">Scale<input type="number" step="any" id="snScale-${d.id}" value="1"></label>
          <label class="dh-lin">Offset<input type="number" step="any" id="snOff-${d.id}" value="0"></label>
          <label class="dh-tab">Calibration: one "raw, value" pair per line<textarea id="snCal-${d.id}" rows="4" placeholder="0, 0&#10;1024, 95&#10;2048, 210&#10;4095, 400"></textarea></label>
          <button type="button" class="btn btn-primary btn-sm" data-add-sn="${esc(d.id)}">Add mapping</button>
        </div>
      </section>
      <section><h4>Last parameters received ${lp.at ? `<span class="muted">· ${ago(lp.at)}</span>` : ""}</h4>
        ${keys.length ? `<div class="dh-params">${keys.slice(0, 60).map(k => `<button type="button" class="oc-chip" data-pick="${esc(k)}" data-dev="${esc(d.id)}"><code>${esc(k)}</code> = ${esc(String(lp.raw[k]).slice(0, 18))}</button>`).join("")}</div>`
          : `<p class="muted dh-note">Nothing received yet. Once the device reports, its parameter names appear here; click one to map it.</p>`}
      </section>
      <div class="dh-actions">
        <select id="devVeh-${d.id}" aria-label="Fitted to vehicle"><option value="">Not fitted</option>${vehicles().map(v => `<option value="${esc(v.dbId)}" ${v.dbId === d.vehicle_id ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select>
        <button type="button" class="btn btn-outline btn-sm" data-save-veh="${esc(d.id)}">Save vehicle</button>
        <span class="oc-spacer"></span>
        <button type="button" class="btn btn-outline btn-sm" data-status="${esc(d.id)}">${d.status === "active" ? "Deactivate" : "Activate"}</button>
      </div>
    </div>`;
  }
  const sigLabel = p => { const s = H.signals.find(x => x.path === p); return s ? s.description : p; };

  function wireDeviceDetail() {
    const body = $("dhBody");
    body.querySelectorAll("[data-add-ch]").forEach(b => b.onclick = () => addChannel(b.dataset.addCh));
    body.querySelectorAll("[data-del-ch]").forEach(b => b.onclick = () => removeRow("device_channels", b.dataset.delCh, "channels"));
    body.querySelectorAll("[data-add-sn]").forEach(b => b.onclick = () => addSensor(b.dataset.addSn));
    body.querySelectorAll("[data-del-sn]").forEach(b => b.onclick = () => removeRow("device_sensors", b.dataset.delSn, "sensors"));
    body.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { const i = $("snKey-" + b.dataset.dev); if (i) { i.value = b.dataset.pick; i.focus(); } });
    body.querySelectorAll("[data-save-veh]").forEach(b => b.onclick = async () => {
      const id = b.dataset.saveVeh, v = $("devVeh-" + id).value || null;
      if (await fwCloud.authPatchChecked(`devices?id=eq.${id}`, { vehicle_id: v })) { H.devices.find(d => d.id === id).vehicle_id = v; toast("Saved."); renderDevices(); }
      else toast("Could not save.", "err");
    });
    body.querySelectorAll("[data-status]").forEach(b => b.onclick = async () => {
      const d = H.devices.find(x => x.id === b.dataset.status), next = d.status === "active" ? "inactive" : "active";
      if (await fwCloud.authPatchChecked(`devices?id=eq.${d.id}`, { status: next })) { d.status = next; renderDevices(); }
    });
    body.querySelectorAll("[id^='snTr-']").forEach(sel => { const upd = () => { const wrap = sel.closest(".dh-sensor"); wrap.dataset.tr = sel.value; }; sel.onchange = upd; upd(); });
  }

  function renderLog() {
    $("dhBody").innerHTML = `<div class="oc-card"><h3>${icon("filter", 14)} Last 100 posts <span class="oc-spacer"></span><button type="button" class="btn btn-outline btn-sm" id="dhLogRefresh">Refresh</button></h3>
      ${H.log.length ? `<table class="dh-table"><thead><tr><th>When</th><th>Endpoint</th><th>Device</th><th>Result</th><th>Rows</th><th>Detail</th></tr></thead><tbody>
      ${H.log.map(l => `<tr><td>${ago(l.received_at)}</td><td>${esc(l.endpoint)}${l.format ? ` <span class="muted">${esc(l.format)}</span>` : ""}</td><td><code>${esc(l.ident || "—")}</code></td>
        <td><span class="oc-tag ${l.status === "ok" ? "ok" : l.status === "partial" ? "warning" : "critical"}">${esc(l.status.replace("_", " "))}</span></td>
        <td class="oc-mono">${l.readings}/${l.events}/${l.media}</td>
        <td>${esc(l.detail || "")}${l.status === "unknown_device" && l.ident ? ` <button type="button" class="link-btn" data-register="${esc(l.ident)}">Register it</button>` : ""}</td></tr>`).join("")}
      </tbody></table><p class="muted dh-note">Rows = readings / events / media files stored.</p>` : `<div class="oc-empty">Nothing received yet. Point a device or gateway at an endpoint on the Connect tab.</div>`}</div>`;
    $("dhLogRefresh").onclick = async () => { await load(); render(); };
    $("dhBody").querySelectorAll("[data-register]").forEach(b => b.onclick = () => { sessionStorage.setItem("dhPrefillImei", b.dataset.register); H.tab = "devices"; render(); });
  }

  function renderAlerts() {
    const s = H.settings || { notify_sms: false, alert_phones: [], sms_min_severity: "critical", offline_after_min: 30, telemetry_retention_days: 180 };
    $("dhBody").innerHTML = `<div class="oc-cols">
      <div class="oc-card"><h3>${icon("bell", 14)} Recent alerts</h3>
        ${H.alerts.length ? `<ul class="dh-list">${H.alerts.map(a => `<li class="${a.read_at ? "is-off" : ""}"><div><b>${esc(a.title)}</b><span class="muted dh-sub">${esc(a.body || "")} · ${ago(a.created_at)} · ${esc(a.delivery === "sent" ? "SMS sent" : a.delivery === "pending" ? "SMS queued" : a.delivery === "failed" ? "SMS failed" : a.delivery === "skipped" ? "in-app (" + (a.delivery_detail || "SMS skipped") + ")" : "in-app")}${a.simulated ? " · test" : ""}</span></div>
          <span class="oc-tag ${a.severity}">${esc(a.severity)}</span>${a.read_at ? "" : `<button type="button" class="link-btn" data-read="${esc(a.id)}">Mark read</button>`}</li>`).join("")}</ul>`
          : `<div class="oc-empty">No alerts yet. Incidents, geofence entries into restricted zones, cold-chain breaches and trackers going offline appear here.</div>`}
      </div>
      <div class="oc-card"><h3>${icon("settings", 14)} Alert settings</h3>
        <div class="dh-form dh-settings">
          <label class="dh-check"><input type="checkbox" id="asSms" ${s.notify_sms ? "checked" : ""}> Send SMS alerts</label>
          <label>Phone numbers <span class="muted">(comma separated, up to 5)</span><input type="text" id="asPhones" value="${esc((s.alert_phones || []).join(", "))}" placeholder="98400 12345, 99440 56789"></label>
          <label>Send SMS for<select id="asMin"><option value="critical" ${s.sms_min_severity === "critical" ? "selected" : ""}>Critical only</option><option value="warning" ${s.sms_min_severity === "warning" ? "selected" : ""}>Warnings and critical</option></select></label>
          <label>Tracker offline after (minutes)<input type="number" id="asOff" min="5" max="1440" value="${s.offline_after_min}"></label>
          <label>Keep raw readings for (days)<input type="number" id="asRet" min="30" max="730" value="${s.telemetry_retention_days}"></label>
          <button type="button" class="btn btn-primary btn-sm" id="asSave">Save settings</button>
          <p class="muted dh-note">Everything always reaches this inbox. Test (simulated) incidents never go out by SMS.</p>
        </div>
      </div></div>`;
    $("asSave").onclick = saveSettings;
    $("dhBody").querySelectorAll("[data-read]").forEach(b => b.onclick = async () => {
      if (await fwCloud.authPatchChecked(`fleet_alerts?id=eq.${b.dataset.read}`, { read_at: new Date().toISOString(), read_by: fwCloud.uid() })) {
        H.alerts.find(a => a.id === b.dataset.read).read_at = new Date().toISOString(); renderAlerts();
      }
    });
  }

  // ── actions ─────────────────────────────────────────────────────────
  async function createKey() {
    const name = ($("dhKeyName").value || "").trim() || "Integration";
    const r = await fwCloud.authRpc("create_integration_key", { p_name: name });
    if (!r || !r.key) { toast("Could not create a key. Only the fleet owner or a manager can.", "err"); return; }
    H.newKey = r; await load(); render();
  }
  async function revokeKey(id) {
    const ok = window.FWDialog ? await FWDialog.confirm("Revoke this key? Anything using it stops sending data immediately.", { title: "Revoke key", confirmText: "Revoke", danger: true }) : true;
    if (!ok) return;
    if (await fwCloud.authPatchChecked(`integration_keys?id=eq.${id}`, { revoked_at: new Date().toISOString() })) { await load(); render(); toast("Key revoked."); }
    else toast("Could not revoke.", "err");
  }
  async function addDevice() {
    const imei = ($("dhImei").value || "").trim();
    if (!/^[A-Za-z0-9._:-]{3,64}$/.test(imei)) { toast("Enter the device IMEI or serial (letters, digits, . _ : -).", "err"); return; }
    const org = window.dbOrgId ? await dbOrgId() : null;
    if (!org) { toast("Could not find your fleet account.", "err"); return; }
    const kind = $("dhKind").value;
    const row = await fwCloud.authInsertRet("devices", {
      org_id: org, imei, kind, protocol: $("dhProto").value, integration: $("dhInteg").value,
      vehicle_id: $("dhVeh").value || null, parent_device_id: $("dhParent").value || null, external_id: ($("dhExt").value || "").trim() || null,
      capabilities: { tracker: ["gps"], dashcam: ["gps", "adas", "dms"], mdvr: ["gps", "adas", "dms"], avm_360: ["video"], cargo_camera: ["video"],
        fuel_sensor: ["fuel_level"], temp_sensor: ["temp"], tpms: ["tpms"], obd: ["can"], other: [] }[kind],
      status: "active",
    });
    if (!row) { toast("Could not register it. Is that IMEI already in your fleet?", "err"); return; }
    toast("Device registered."); H.open = row.id; await load(); render();
  }
  async function addChannel(devId) {
    const d = H.devices.find(x => x.id === devId), url = ($("chUrl-" + devId).value || "").trim();
    if (url && !/^https:\/\//i.test(url)) { toast("Live links must start with https://", "err"); return; }
    const kind = /\.m3u8(\?|$)/i.test(url) ? "hls" : /\.mp4(\?|$)/i.test(url) ? "mp4" : /whep|webrtc/i.test(url) ? "webrtc" : url ? "hls" : null;
    const row = await fwCloud.authInsertRet("device_channels", {
      org_id: d.org_id, device_id: d.id, vehicle_id: d.vehicle_id, channel_no: Number($("chNo-" + devId).value) || 1,
      role: $("chRole-" + devId).value, label: ($("chLabel-" + devId).value || "").trim() || null, live_url: url || null, live_kind: kind,
    });
    if (row) { H.channels.push(row); renderDevices(); } else toast("Could not add the channel. Is that number already used?", "err");
  }
  async function addSensor(devId) {
    const d = H.devices.find(x => x.id === devId), key = ($("snKey-" + devId).value || "").trim(), tr = $("snTr-" + devId).value;
    if (!key) { toast("Enter the parameter name the device sends.", "err"); return; }
    const row = { org_id: d.org_id, device_id: d.id, source_key: key, signal_path: $("snSig-" + devId).value, transform: tr };
    if (tr === "linear") { row.scale = Number($("snScale-" + devId).value); row.offset = Number($("snOff-" + devId).value); }
    if (tr === "table") {
      const pts = ($("snCal-" + devId).value || "").split(/\n+/).map(l => l.split(/[,\t;]+/).map(Number)).filter(p => p.length >= 2 && p.every(Number.isFinite)).map(p => [p[0], p[1]]);
      if (pts.length < 2) { toast("A calibration table needs at least two raw, value lines.", "err"); return; }
      row.calibration = pts.sort((a, b) => a[0] - b[0]);
    }
    const saved = await fwCloud.authInsertRet("device_sensors", row);
    if (saved) { H.sensors.push(saved); toast("Mapping added. It applies from the next reading."); renderDevices(); }
    else toast("Could not add. That parameter may already be mapped on this device.", "err");
  }
  async function removeRow(table, id, list) {
    if (await fwCloud.authDelete(table, `id=eq.${id}`)) { H[list] = H[list].filter(x => x.id !== id); renderDevices(); }
    else toast("Could not remove.", "err");
  }
  async function saveSettings() {
    const phones = ($("asPhones").value || "").split(/[,;\n]+/).map(s => s.replace(/[^\d+]/g, "")).filter(s => s.replace(/\D/g, "").length >= 10).slice(0, 5);
    const org = window.dbOrgId ? await dbOrgId() : null;
    if (!org) { toast("Could not find your fleet account.", "err"); return; }
    const row = { org_id: org, notify_sms: $("asSms").checked, alert_phones: phones, sms_min_severity: $("asMin").value,
      offline_after_min: Math.min(1440, Math.max(5, Number($("asOff").value) || 30)),
      telemetry_retention_days: Math.min(730, Math.max(30, Number($("asRet").value) || 180)), updated_at: new Date().toISOString() };
    if (row.notify_sms && !phones.length) { toast("Add at least one phone number for SMS.", "err"); return; }
    const ok = H.settings ? await fwCloud.authPatchChecked(`fleetsafe_settings?org_id=eq.${org}`, row) : !!(await fwCloud.authInsertRet("fleetsafe_settings", row));
    if (ok) { H.settings = row; toast("Alert settings saved."); renderAlerts(); } else toast("Could not save.", "err");
  }

  async function open() {
    if (!$("deviceHubRoot")) return;
    render();
    if (!signedIn()) return;
    await load(); render();
  }
  window.DeviceHub = { open };
})();
