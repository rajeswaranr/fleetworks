/* Live dashcam wall.
   A grid of camera tiles you can lay out as 1x1, 1x2 (one row, two columns), 2x1, 2x2,
   2x3 or 3x3, one vehicle and camera per tile.

   What plays in a tile:
     - a real stream or clip: an https .mp4 or .m3u8 link, or a file opened on this device;
     - otherwise a SIMULATED feed drawn in the browser, stamped SIMULATED so it can never
       be mistaken for footage. No cameras are fitted to the fleet yet, so every tile
       starts on a simulated feed and switches to a real one the moment a link is set.
   The layout and tile assignments are remembered per browser. */
(function () {
  "use strict";

  const LAYOUTS = [[1, 1], [1, 2], [2, 1], [2, 2], [2, 3], [3, 3]];
  const CAMS = { front: "Front (road)", cabin: "Cabin (driver)", rear: "Rear", surround: "360° view" };
  const KEY = "fw_live_wall_v1";
  const TWIN_SPEED = "Vehicle.Speed";

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ── simulated feed ─────────────────────────────────────────────────────
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  function drawRoad(g, W, H, ph, r, rear, lead) {
    const hz = H * 0.44;
    const sky = g.createLinearGradient(0, 0, 0, hz); sky.addColorStop(0, "#1b2a4a"); sky.addColorStop(1, "#4b6491");
    g.fillStyle = sky; g.fillRect(0, 0, W, hz);
    g.fillStyle = "#1f2536"; g.fillRect(0, hz, W, H - hz);
    // roadside posts moving toward the camera
    for (let i = 0; i < 6; i++) {
      const p = ((ph * 0.6 + i / 6) % 1), y = hz + p * p * (H - hz), s = 2 + p * p * 16;
      g.fillStyle = "#3a4560"; g.fillRect(W * 0.5 - (W * 0.06 + p * p * W * 0.5) - s, y - s * 4, s, s * 4);
      g.fillRect(W * 0.5 + (W * 0.06 + p * p * W * 0.5), y - s * 4, s, s * 4);
    }
    g.strokeStyle = "rgba(255,255,255,.6)"; g.lineWidth = 2;
    for (const side of [-1, 1]) { g.beginPath(); g.moveTo(W / 2 + side * W * 0.05, hz); g.lineTo(W / 2 + side * W * 0.55, H); g.stroke(); }
    g.fillStyle = "rgba(255,255,255,.7)";
    for (let i = 0; i < 9; i++) {
      const p = ((rear ? 1 - ph : ph) * 1.0 + i / 9) % 1, y = hz + p * p * (H - hz), w = 2 + p * p * 12, h = 3 + p * p * 20;
      g.fillRect(W / 2 - w / 2, y, w, h);
    }
    if (lead) {   // a vehicle ahead (or behind)
      const w = W * (0.16 + 0.03 * Math.sin(ph * 6.28)), x = W / 2 - w / 2 + Math.sin(ph * 3) * W * 0.02, y = hz + (H - hz) * 0.16;
      g.fillStyle = rear ? "#dbe4f5" : "#7b1f2b"; g.fillRect(x, y, w, w * 0.55);
      g.fillStyle = "#111827"; g.fillRect(x + w * 0.1, y + w * 0.06, w * 0.8, w * 0.22);
      g.fillStyle = rear ? "#fde68a" : "#ef4444"; g.fillRect(x + w * 0.04, y + w * 0.38, w * 0.14, w * 0.08); g.fillRect(x + w * 0.82, y + w * 0.38, w * 0.14, w * 0.08);
    }
  }
  function drawCabin(g, W, H, ph) {
    g.fillStyle = "#10151f"; g.fillRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#1a2233"); gr.addColorStop(1, "#0b0f18"); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = "#2b3550"; g.beginPath(); g.ellipse(W / 2, H * 0.98, W * 0.34, H * 0.42, 0, Math.PI, 0); g.fill();       // shoulders
    g.fillStyle = "#3b4766"; g.beginPath(); g.arc(W / 2 + Math.sin(ph * 2) * W * 0.01, H * 0.42, H * 0.17, 0, 6.29); g.fill(); // head
    g.strokeStyle = "#4ade80"; g.lineWidth = 2; g.strokeRect(W / 2 - H * 0.2, H * 0.22, H * 0.4, H * 0.4);
    g.fillStyle = "#4ade80"; g.font = `${Math.max(10, H * 0.05)}px sans-serif`; g.fillText("DMS  attentive", W / 2 - H * 0.2, H * 0.2);
    g.fillStyle = "#0b0f18"; g.fillRect(0, H * 0.88, W, H * 0.12);
  }
  function drawSurround(g, W, H, ph) {
    g.fillStyle = "#1c2233"; g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 2; g.setLineDash([H * 0.06, H * 0.05]); g.lineDashOffset = -ph * H * 0.5;
    for (const x of [0.28, 0.72]) { g.beginPath(); g.moveTo(W * x, 0); g.lineTo(W * x, H); g.stroke(); }
    g.setLineDash([]);
    const bw = W * 0.16, bh = H * 0.5, bx = W / 2 - bw / 2, by = H / 2 - bh / 2;
    g.fillStyle = "rgba(96,165,250,.16)";
    [[bx + bw / 2, by, -1.2, -0.5], [bx + bw / 2, by + bh, 0.5, 1.2], [bx, by + bh / 2, 2.2, 3.6], [bx + bw, by + bh / 2, -0.7, 0.7]].forEach(([x, y, a, b]) => { g.beginPath(); g.moveTo(x, y); g.arc(x, y, H * 0.3, a, b); g.closePath(); g.fill(); });
    g.fillStyle = "#e5e7eb"; g.fillRect(bx, by, bw, bh); g.fillStyle = "#94a3b8"; g.fillRect(bx + bw * 0.12, by + bh * 0.05, bw * 0.76, bh * 0.18);
    g.fillStyle = "#60a5fa"; for (const [x, y] of [[bx + bw / 2, by], [bx + bw / 2, by + bh], [bx, by + bh / 2], [bx + bw, by + bh / 2]]) { g.beginPath(); g.arc(x, y, 4, 0, 6.29); g.fill(); }
  }

  function startSim(container, cfg) {
    const canvas = document.createElement("canvas"); container.appendChild(canvas);
    const g = canvas.getContext("2d"), r = rng(hash(cfg.seed));
    const offset = r() * 10, lead = r() > 0.35;
    let raf = 0, visible = true, last = 0;
    const fit = () => { const d = Math.min(window.devicePixelRatio || 1, 2), w = container.clientWidth || 320, h = container.clientHeight || 180; canvas.width = w * d; canvas.height = h * d; g.setTransform(d, 0, 0, d, 0, 0); };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(container);
    const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0.05 }); io.observe(container);
    function frame(ts) {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden || ts - last < 40) return;     // ~25 fps, and idle when off-screen
      last = ts;
      const W = canvas.width / Math.min(window.devicePixelRatio || 1, 2), H = canvas.height / Math.min(window.devicePixelRatio || 1, 2);
      const spd = cfg.speed(), ph = ((ts / 1000 + offset) * (0.1 + spd / 250)) % 1;
      g.clearRect(0, 0, W, H);
      if (cfg.cam === "cabin") drawCabin(g, W, H, ph);
      else if (cfg.cam === "surround") drawSurround(g, W, H, ph);
      else drawRoad(g, W, H, ph, r, cfg.cam === "rear", lead);
      g.fillStyle = "#fff"; g.font = `600 ${Math.max(10, H * 0.045)}px monospace`;
      g.fillText(new Date().toLocaleTimeString("en-IN"), 10, H - 10);
      g.textAlign = "right"; g.fillText(Math.round(spd) + " km/h", W - 10, H - 10); g.textAlign = "left";
    }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); canvas.remove(); };
  }

  // ── real sources ───────────────────────────────────────────────────────
  let hlsP = null;
  const loadHls = () => window.Hls ? Promise.resolve(window.Hls) : (hlsP = hlsP || new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js";
    s.onload = () => res(window.Hls); s.onerror = () => rej(new Error("Could not load the HLS player.")); document.head.appendChild(s);
  }));
  async function startVideo(container, src, onError) {
    const v = document.createElement("video"); v.muted = true; v.autoplay = true; v.playsInline = true; v.loop = src.type === "file"; v.controls = false;
    container.appendChild(v);
    let hls = null;
    if (/\.m3u8(\?|$)/i.test(src.url) && !v.canPlayType("application/vnd.apple.mpegurl")) {
      try { const H = await loadHls(); if (H.isSupported()) { hls = new H({ lowLatencyMode: true }); hls.loadSource(src.url); hls.attachMedia(v); } } catch (e) { onError(e.message); }
    } else v.src = src.url;
    v.addEventListener("error", () => onError("That video could not be played."), { once: true });
    v.play().catch(() => {});
    return { stop() { if (hls) hls.destroy(); v.pause(); v.removeAttribute("src"); v.load(); v.remove(); }, video: v };
  }

  // ── state ──────────────────────────────────────────────────────────────
  const state = { layout: [2, 2], tiles: [], vehicles: [], twin: {} };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ layout: state.layout, tiles: state.tiles.map(t => t && { vehicleId: t.vehicleId, cam: t.cam, src: t.src && t.src.type === "url" ? t.src : null }) })); } catch { /* private mode */ } };
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
  const vehName = id => (state.vehicles.find(v => v.id === id) || {}).name || "Unassigned";
  const speedOf = id => { const t = state.twin[id]; const v = t && t.state && t.state[TWIN_SPEED]; return v && Number.isFinite(+v.v) ? +v.v : null; };

  // ── tiles ──────────────────────────────────────────────────────────────
  const live = [];   // per-tile runtime: { stop, el }
  function stopTile(i) { if (live[i] && live[i].stop) live[i].stop(); live[i] = null; }

  async function paintTile(i) {
    const cell = $("lwWall").children[i]; if (!cell) return;
    stopTile(i);
    const a = state.tiles[i];
    const media = cell.querySelector(".lw-media"), empty = cell.querySelector(".lw-empty"), badge = cell.querySelector(".lw-badge"), sim = cell.querySelector(".lw-sim");
    media.innerHTML = "";
    cell.querySelector(".lw-name").textContent = a ? vehName(a.vehicleId) : "";
    cell.querySelector(".lw-cam").textContent = a ? CAMS[a.cam] : "";
    if (!a) { empty.hidden = false; badge.hidden = true; sim.hidden = true; return; }
    empty.hidden = true; badge.hidden = false;
    if (a.src && a.src.url) {
      badge.textContent = a.src.type === "file" ? "FILE" : "LIVE"; badge.className = "lw-badge " + (a.src.type === "file" ? "file" : ""); sim.hidden = true;
      const r = await startVideo(media, a.src, msg => { if (window.toast) toast(msg); a.src = null; paintTile(i); });
      live[i] = { stop: r.stop, video: r.video };
    } else {
      badge.textContent = "SIMULATED"; badge.className = "lw-badge sim"; sim.hidden = false;
      const stop = startSim(media, { seed: (a.vehicleId || "x") + a.cam, cam: a.cam, speed: () => { const s = speedOf(a.vehicleId); return s == null ? 45 + (hash(a.vehicleId) % 20) : s; } });
      live[i] = { stop };
    }
  }

  function buildWall(skipFill) {
    const [rows, cols] = state.layout, n = rows * cols, wall = $("lwWall");
    live.forEach((_, i) => stopTile(i));
    wall.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    wall.innerHTML = Array.from({ length: n }, (_, i) => `
      <div class="lw-tile" data-i="${i}">
        <div class="lw-media"></div>
        <span class="lw-sim" hidden>Simulated</span>
        <div class="lw-top"><span class="lw-name"></span><span class="lw-cam"></span><span class="lw-badge" hidden></span></div>
        <div class="lw-empty"><span>No camera in this tile</span><button type="button" class="btn btn-sm btn-primary" data-act="assign">Choose a vehicle</button></div>
        <div class="lw-bot"><span class="lw-spd"></span><span></span></div>
        <div class="lw-acts"><button type="button" class="lw-btn" data-act="assign">Change</button><button type="button" class="lw-btn" data-act="mute">Sound</button><button type="button" class="lw-btn" data-act="fs">Full screen</button></div>
      </div>`).join("");
    while (state.tiles.length < n) state.tiles.push(null);
    state.tiles.length = n;
    if (!skipFill) fillEmpty(n);
    for (let i = 0; i < n; i++) paintTile(i);
    updateSpeeds();
    document.querySelectorAll(".lw-lay").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lay === rows + "x" + cols)));
  }

  // every tile gets a picture: empty ones take the next vehicle, and once the vehicles run
  // out the same vehicles come round again on a different camera (cabin, rear, 360°)
  function fillEmpty(n) {
    if (!state.vehicles.length) return;
    const camOrder = ["front", "cabin", "rear", "surround"];
    const taken = new Set(state.tiles.filter(Boolean).map(t => t.vehicleId + "|" + t.cam));
    // candidates: every vehicle on its front camera first, then again on cabin, rear and 360°
    const queue = [];
    for (const cam of camOrder) for (const v of state.vehicles) if (!taken.has(v.id + "|" + cam)) queue.push({ vehicleId: v.id, cam, src: null });
    for (let i = 0; i < n; i++) if (!state.tiles[i]) state.tiles[i] = queue.shift() || null;
    save();
  }
  function autoFill() {
    state.tiles = [];
    buildWall();
  }

  function updateSpeeds() {
    document.querySelectorAll(".lw-tile").forEach((cell, i) => {
      const a = state.tiles[i]; const s = a ? speedOf(a.vehicleId) : null;
      cell.querySelector(".lw-spd").textContent = a && s != null ? Math.round(s) + " km/h" : "";
    });
  }

  // ── assign dialog ──────────────────────────────────────────────────────
  let dlgFor = -1, dlgSrc = "sim", dlgFile = null;
  function openDialog(i) {
    dlgFor = i; const a = state.tiles[i] || { vehicleId: (state.vehicles[0] || {}).id, cam: "front", src: null };
    dlgSrc = a.src && a.src.url ? "url" : "sim"; dlgFile = null;
    $("lwVeh").innerHTML = state.vehicles.map(v => `<option value="${esc(v.id)}" ${v.id === a.vehicleId ? "selected" : ""}>${esc(v.name)}</option>`).join("") || "<option value=''>No vehicles yet</option>";
    $("lwCam").innerHTML = Object.entries(CAMS).map(([k, l]) => `<option value="${k}" ${k === a.cam ? "selected" : ""}>${l}</option>`).join("");
    $("lwUrl").value = a.src && a.src.type === "url" ? a.src.url : "";
    syncSrc(); $("lwDlg").hidden = false; $("lwVeh").focus();
  }
  function syncSrc() {
    document.querySelectorAll("#lwSrc button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.src === dlgSrc)));
    $("lwUrlRow").hidden = dlgSrc !== "url"; $("lwFileRow").hidden = dlgSrc !== "file";
  }
  function applyDialog() {
    const vehicleId = $("lwVeh").value, cam = $("lwCam").value; let src = null;
    if (dlgSrc === "url") {
      const u = $("lwUrl").value.trim();
      if (!/^https:\/\//i.test(u)) { alert("Paste a link that starts with https://"); return; }
      src = { type: "url", url: u };
    } else if (dlgSrc === "file") {
      if (!dlgFile) { alert("Choose a video file first."); return; }
      src = { type: "file", url: URL.createObjectURL(dlgFile), name: dlgFile.name };
    }
    if (!vehicleId) { alert("Add a vehicle first."); return; }
    state.tiles[dlgFor] = { vehicleId, cam, src }; save(); $("lwDlg").hidden = true; paintTile(dlgFor); updateSpeeds();
  }

  // ── boot ───────────────────────────────────────────────────────────────
  function session() { try { const k = localStorage.getItem("fw_session:active"); const raw = k ? localStorage.getItem(k) : localStorage.getItem("fw_session"); return raw ? JSON.parse(raw) : null; } catch { return null; } }
  async function api(path) {
    const s = session();
    const r = await fetch(FW_BACKEND.url + "/rest/v1/" + path, { headers: { apikey: FW_BACKEND.anonKey, Authorization: "Bearer " + s.access_token } });
    if (!r.ok) throw new Error("Request failed (" + r.status + ")"); return r.json();
  }
  async function refreshTwin() {
    try { const rows = await api("vehicle_twin?select=vehicle_id,state,last_reading_at&limit=500"); state.twin = Object.fromEntries(rows.filter(r => r.vehicle_id).map(r => [r.vehicle_id, r])); updateSpeeds(); } catch { /* the wall works without it */ }
  }

  function wire() {
    $("lwLayouts").innerHTML = LAYOUTS.map(([r, c]) => `<button type="button" class="lw-lay" data-lay="${r}x${c}" aria-pressed="false" aria-label="${r} row${r > 1 ? "s" : ""} by ${c} column${c > 1 ? "s" : ""}">
      <span class="lw-glyph" style="grid-template-columns:repeat(${c},1fr);grid-template-rows:repeat(${r},1fr)">${"<i></i>".repeat(r * c)}</span>${r} × ${c}</button>`).join("");
    $("lwLayouts").onclick = e => { const b = e.target.closest("[data-lay]"); if (!b) return; state.layout = b.dataset.lay.split("x").map(Number); save(); buildWall(); };
    $("lwWall").onclick = e => {
      const btn = e.target.closest("[data-act]"), cell = e.target.closest(".lw-tile"); if (!btn || !cell) return;
      const i = +cell.dataset.i, act = btn.dataset.act;
      if (act === "assign") openDialog(i);
      else if (act === "mute") { const v = live[i] && live[i].video; if (v) { v.muted = !v.muted; btn.textContent = v.muted ? "Sound" : "Mute"; } else if (window.toast) toast("Simulated feeds have no sound."); }
      else if (act === "fs") toggleFs(cell);
    };
    $("lwFill").onclick = autoFill;
    $("lwClear").onclick = () => { state.tiles = []; save(); buildWall(true); };
    $("lwSrc").onclick = e => { const b = e.target.closest("[data-src]"); if (b) { dlgSrc = b.dataset.src; syncSrc(); } };
    $("lwFile").onchange = e => { dlgFile = e.target.files[0] || null; $("lwFileName").textContent = dlgFile ? dlgFile.name : "No file chosen"; };
    $("lwCancel").onclick = () => { $("lwDlg").hidden = true; };
    $("lwApply").onclick = applyDialog;
    $("lwDlg").onclick = e => { if (e.target === $("lwDlg")) $("lwDlg").hidden = true; };
    document.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      if (!$("lwDlg").hidden) $("lwDlg").hidden = true; else { const fs = document.querySelector(".lw-tile.is-fs"); if (fs) toggleFs(fs); }
    });
  }
  function toggleFs(cell) {
    const on = !cell.classList.contains("is-fs"); cell.classList.toggle("is-fs", on);
    const btn = cell.querySelector('[data-act="fs"]'); if (btn) btn.textContent = on ? "Exit full screen" : "Full screen";
  }

  async function boot() {
    wire();
    const s = session(); if (!s || !s.access_token) return;
    try {
      state.vehicles = (await api("vehicles?select=id,name&order=name.asc&limit=500")).map(v => ({ id: v.id, name: v.name }));
    } catch (e) { $("gate").querySelector("p").textContent = e.message; return; }
    $("gate").hidden = true; $("app").hidden = false;
    const saved = load();
    if (saved && Array.isArray(saved.layout)) {
      state.layout = saved.layout;
      state.tiles = (saved.tiles || []).map(t => t && state.vehicles.some(v => v.id === t.vehicleId) ? t : null);
      buildWall();
    } else autoFill();
    await refreshTwin();
    setInterval(refreshTwin, 15000);
  }
  window.FWLiveWall = { boot };
})();
