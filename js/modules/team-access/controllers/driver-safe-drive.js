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

  // ── DriveBuddy core thresholds (Normal). Settings scale the durations. ──
  const BASE = { OPEN_EYE: 0.70, LONG: 1500, MID: 500, WINDOW: 10000, HEADTILT: 5000, PITCH_DOWN: -5, PITCH_UP: 15 };
  const SENS = { high: { k: 0.75 }, normal: { k: 1 }, low: { k: 1.3 } };   // scales all durations
  const MP_VERSION = "0.10.14";
  const MODEL_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" + MP_VERSION + "/wasm";
  const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
  const SET_KEY = "fw_safedrive_settings_v1";
  const defaults = { sensitivity: "normal", sound: true, voice: true, record: true, live: true, aiScene: false, motion: true, speedLimit: 80, restType: "fuel", radiusKm: 5 };
  function settings() { try { return { ...defaults, ...JSON.parse(localStorage.getItem(SET_KEY) || "{}") }; } catch { return { ...defaults }; } }
  function saveSettings(s) { try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch {} }
  function thresholds() { const k = (SENS[settings().sensitivity] || SENS.normal).k; return { ...BASE, LONG: Math.round(BASE.LONG * k), MID: Math.round(BASE.MID * k), HEADTILT: Math.round(BASE.HEADTILT * k), k }; }

  // ── the states the camera rates, and the level each reaches ──
  // Each condition scores 0 none / 1 minor / 2 major / 3 critical. Drunk/alcohol level
  // CANNOT be measured from a face; "impairment" flags behavioural signs of being unfit
  // to drive (erratic head, very slow eye response), never a blood-alcohol reading.
  const SEV = ["none", "minor", "major", "critical"];
  const COND = {
    drowsiness:  { label: "Drowsiness", icon: "eye" },
    sleepiness:  { label: "Sleepiness (micro-sleep)", icon: "eye" },
    fatigue:     { label: "Tiredness / fatigue", icon: "clock" },
    yawning:     { label: "Yawning", icon: "user" },
    distraction: { label: "Distraction", icon: "eye" },
    impairment:  { label: "Impairment signs", icon: "shieldAlert" },
  };
  const MSG = {
    drowsiness:  ["", "Eyes getting heavy — stay alert", "Your eyes are closing — focus on the road", "Wake up! Your eyes are closing"],
    sleepiness:  ["", "Signs of sleepiness — take a break soon", "You keep closing your eyes — pull over soon", "Micro-sleep detected! Stop and rest now"],
    fatigue:     ["", "You seem a little tired", "You look tired — plan a break", "You are very tired — rest before you drive on"],
    yawning:     ["", "Yawning — a sign of tiredness", "Frequent yawning — take a break soon", "Constant yawning — please rest now"],
    distraction: ["", "Eyes back on the road", "You're looking away — watch the road", "Stop looking away — eyes on the road!"],
    impairment:  ["", "Drive steady — you seem unsettled", "Unsteady driving signs — slow down and focus", "You may be unfit to drive — pull over safely"],
  };
  const COOLDOWN = { minor: 20000, major: 10000, critical: 5000 };   // per condition, by the level being fired

  const E = {
    landmarker: null, stream: null, raf: 0, running: false, video: null, canvas: null, ctx: null, T: BASE,
    onEvent: null, onStatus: null, onTick: null, startedAt: 0, faceSeen: false, alerting: false,
    // eye state
    startClosed: null, closedNow: false,
    // rolling windows
    perclos: [],          // {t, closed} samples over 60s (for sleepiness)
    blinks: [], yawns: [], // timestamps over their windows
    yawing: false, yawStart: null,
    poses: [],            // {t, pitch, yaw} over 8s (for impairment steadiness)
    // per-condition episode tracking
    cond: {}, live: {},
    counts: { alerts: 0, minor: 0, major: 0, critical: 0, byCond: {} },
  };
  const now = () => Date.now();
  const emitStatus = m => E.onStatus && E.onStatus(m);
  const blend = (s, n) => { const c = s && s.categories && s.categories.find(x => x.categoryName === n); return c ? c.score : 0; };
  function poseFromMatrix(m) { if (!m || m.length < 16) return { pitch: 0, yaw: 0, roll: 0 }; return { pitch: Math.atan2(-m[9], m[10]) * 180 / Math.PI, yaw: Math.asin(Math.max(-1, Math.min(1, m[8]))) * 180 / Math.PI, roll: Math.atan2(-m[4], m[0]) * 180 / Math.PI }; }

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

  const trim = (arr, ms) => { const t = now(); while (arr.length && t - (arr[0].t ?? arr[0]) > ms) arr.shift(); };
  const stddev = a => { if (a.length < 2) return 0; const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };

  // ── ML features from the face-mesh landmarks ──
  // The MediaPipe FaceLandmarker neural net gives 478 3D landmarks. From them we compute
  // the Eye Aspect Ratio (EAR) and Mouth Aspect Ratio (MAR) — the standard, robust
  // drowsiness features — rather than the noisy eyeBlink blendshape, which did not cross
  // threshold on sustained eye closure. EAR ~0.30 open, ~0.10 shut; MAR high on a yawn.
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // MediaPipe eye landmark rings: [outerCorner, top1, top2, innerCorner, bottom2, bottom1]
  const L_EYE = [33, 160, 158, 133, 153, 144], R_EYE = [362, 385, 387, 263, 373, 380];
  function ear(lm, e) { const p = e.map(i => lm[i]); if (p.some(x => !x)) return null; const h = dist(p[0], p[3]); if (h < 1e-6) return null; return (dist(p[1], p[5]) + dist(p[2], p[4])) / (2 * h); }
  // mouth: verticals (upper/lower lip) over horizontal (corners)
  function mar(lm) { const t1 = lm[13], b1 = lm[14], l = lm[78], r = lm[308]; if (!t1 || !b1 || !l || !r) return 0; const h = dist(l, r); return h < 1e-6 ? 0 : dist(t1, b1) / h; }
  // Eye-closure threshold. The literature uses a fixed EAR ~0.25 (tyrerodr / imprvhub /
  // Soukupová-Čech), but a fixed cut misses drivers with naturally narrow eyes and false-fires
  // on wide ones — so we auto-calibrate to each driver's own open-eye baseline and fall back to
  // 0.25 until the baseline settles. earThreshold(E, earAvg) updates the baseline and returns
  // the live cut for this frame.
  const EAR_FIXED = 0.25, EAR_MIN = 0.16, EAR_MAX = 0.28;
  function earThreshold(E, earAvg) {
    if (earAvg != null) {
      // baseline tracks the open eye: jump up fast toward higher readings, decay very slowly
      if (E.earOpen == null) E.earOpen = earAvg;
      else if (earAvg > E.earOpen) E.earOpen = E.earOpen * 0.9 + earAvg * 0.1;
      else E.earOpen = E.earOpen * 0.999 + earAvg * 0.001;
    }
    if (E.earOpen == null || E.earOpen < 0.20) return EAR_FIXED;  // not enough signal yet
    return Math.min(EAR_MAX, Math.max(EAR_MIN, E.earOpen * 0.6)); // ~60% of open = eyes shut
  }

  // ── the analyser: run every frame, rate each condition 0..3, emit on rise ──
  function analyse(face, pose) {
    const T = E.T, t = now(), lm = E._lm;
    // primary signal: EAR from landmarks; fall back to the blendshape only if no mesh
    const earL = lm ? ear(lm, L_EYE) : null, earR = lm ? ear(lm, R_EYE) : null;
    const earAvg = (earL != null && earR != null) ? (earL + earR) / 2 : null;
    const earCut = earThreshold(E, earAvg);
    E.earCut = earCut; E.earAvg = earAvg;   // surfaced for the debug readout
    const blinkOpen = Math.min(1 - blend(face, "eyeBlinkLeft"), 1 - blend(face, "eyeBlinkRight"));
    const closed = earAvg != null ? earAvg < earCut : blinkOpen < T.OPEN_EYE;
    const leftOpen = earL != null ? earL : blinkOpen, rightOpen = earR != null ? earR : blinkOpen;
    const marVal = lm ? mar(lm) : 0, jaw = Math.max(blend(face, "jawOpen"), marVal > 0.6 ? 0.6 : 0);
    const gaze = Math.max(blend(face, "eyeLookOutLeft"), blend(face, "eyeLookOutRight"), blend(face, "eyeLookInLeft"), blend(face, "eyeLookInRight"));
    E.closedNow = closed;

    // rolling windows
    E.perclos.push({ t, c: closed ? 1 : 0 }); trim(E.perclos, 60000);
    E.poses.push({ t, pitch: pose.pitch, yaw: pose.yaw }); trim(E.poses, 8000);

    // eye-closure duration → blinks + closure length
    if (closed) { if (E.startClosed === null) E.startClosed = t; }
    else { if (E.startClosed !== null && t - E.startClosed >= 120) { E.blinks.push({ t }); trim(E.blinks, 60000); } E.startClosed = null; }
    const closedFor = E.startClosed ? t - E.startClosed : 0;

    // yawn: mouth aspect ratio high (mouth wide open), sustained
    if (marVal > 0.6 || jaw > 0.55) { if (!E.yawing) { E.yawing = true; E.yawStart = t; } else if (t - E.yawStart >= 1100) { E.yawns.push({ t }); trim(E.yawns, 600000); E.yawing = false; } }
    else E.yawing = false;

    // head nod (chin dropping) — a classic micro-sleep sign
    const nodding = pose.pitch < -12;
    if (nodding) { if (E.nodSince == null) E.nodSince = t; } else E.nodSince = null;
    const noddingFor = E.nodSince ? t - E.nodSince : 0;

    const T_away = Math.abs(pose.pitch) > 12 || Math.abs(pose.yaw) > 20 || gaze > 0.6;
    if (T_away) { if (E.awaySince == null) E.awaySince = t; } else E.awaySince = null;
    const awayFor = E.awaySince ? t - E.awaySince : 0;

    // ── rate each condition ──
    const lvl = {};
    // drowsiness: how long the eyes have been shut right now (scaled by sensitivity)
    lvl.drowsiness = closedFor >= T.LONG * 2 ? 3 : closedFor >= T.LONG ? 2 : closedFor >= T.MID ? 1 : 0;
    // sleepiness / micro-sleep: the worst of a long closure, a head nod, and PERCLOS (the
    // % of the last 60 s with eyes closed). Fires within a few seconds — eyes shut ~2 s, or
    // eyes drooping while the head nods, is a micro-sleep, not just a blink.
    const perc = E.perclos.length > 20 ? E.perclos.reduce((s, x) => s + x.c, 0) / E.perclos.length : 0;
    const byClosure = closedFor >= 3000 ? 3 : closedFor >= 2000 ? 2 : 0;
    const drooping = closed || (earAvg != null && earAvg < earCut * 1.15);  // lids low, not fully shut
    const byNod = noddingFor >= 1500 && drooping ? (noddingFor >= 2500 ? 3 : 2) : (noddingFor >= 1500 ? 1 : 0);
    const byPerc = perc >= 0.50 ? 3 : perc >= 0.30 ? 2 : perc >= 0.15 ? 1 : 0;
    lvl.sleepiness = Math.max(byClosure, byNod, byPerc);
    // fatigue: blink rate per minute (scaled to window) + yawns in 10 min
    const blinkRate = E.blinks.length * (60000 / Math.min(60000, Math.max(10000, t - E.startedAt)));
    const yawns10 = E.yawns.length;
    const fatScore = (blinkRate >= 30 ? 2 : blinkRate >= 22 ? 1 : 0) + (yawns10 >= 4 ? 2 : yawns10 >= 2 ? 1 : 0);
    lvl.fatigue = fatScore >= 3 ? 3 : fatScore === 2 ? 2 : fatScore === 1 ? 1 : 0;
    // yawning: escalates with frequency; each yawn is at least minor
    lvl.yawning = yawns10 >= 5 ? 3 : yawns10 >= 3 ? 2 : yawns10 >= 1 ? 1 : 0;
    // distraction: head/eyes away, held
    lvl.distraction = awayFor >= T.HEADTILT ? 3 : awayFor >= T.HEADTILT * 0.7 ? 2 : awayFor >= T.HEADTILT * 0.4 ? 1 : 0;
    // impairment SIGNS (not alcohol): erratic head motion + poor eye control
    const steadiness = stddev(E.poses.map(p => p.pitch)) + stddev(E.poses.map(p => p.yaw));
    const impScore = (steadiness >= 14 ? 2 : steadiness >= 8 ? 1 : 0) + (lvl.sleepiness >= 2 ? 1 : 0) + (lvl.distraction >= 2 ? 1 : 0);
    lvl.impairment = E.poses.length > 30 ? (impScore >= 4 ? 3 : impScore >= 3 ? 2 : impScore >= 2 ? 1 : 0) : 0;

    // emit on a rising edge within an episode (episode ends after 3 s at level 0)
    for (const key of Object.keys(COND)) {
      const c = E.cond[key] || (E.cond[key] = { level: 0, episodeMax: 0, zeroSince: null });
      const l = lvl[key];
      c.level = l;
      if (l === 0) { if (c.zeroSince == null) c.zeroSince = t; else if (t - c.zeroSince > 3000) c.episodeMax = 0; }
      else {
        c.zeroSince = null;
        if (l > c.episodeMax) { c.episodeMax = l; fire(key, l); }
      }
    }
    E.live = lvl;
    draw(face, closed, lvl);
    return { leftOpen, rightOpen, pose, closed, lvl, perclos: perc, blinkRate: Math.round(blinkRate), yawns: yawns10, ear: earAvg, earCut };
  }

  let _audio = null;
  function beep(level) {
    if (!settings().sound) return;
    try {
      _audio = _audio || new (window.AudioContext || window.webkitAudioContext)();
      if (_audio.state === "suspended") _audio.resume();
      const n = level, freq = level >= 3 ? 1100 : level >= 2 ? 950 : 800, vol = level >= 3 ? 0.6 : level >= 2 ? 0.45 : 0.3;
      for (let i = 0; i < n; i++) { const o = _audio.createOscillator(), g = _audio.createGain(), t = _audio.currentTime + i * 0.26; o.type = "square"; o.frequency.setValueAtTime(freq, t); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.connect(g); g.connect(_audio.destination); o.start(t); o.stop(t + 0.22); }
    } catch {}
  }
  function speak(text) { if (!settings().voice) return; try { if (!window.speechSynthesis) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); speechSynthesis.speak(u); } catch {} }
  function fire(condition, level) {
    const sev = SEV[level], t = now(), c = E.cond[condition];
    if (c.lastAt && t - c.lastAt < COOLDOWN[sev]) return;
    c.lastAt = t;
    E.counts.alerts++; E.counts[sev] = (E.counts[sev] || 0) + 1; E.counts.byCond[condition] = (E.counts.byCond[condition] || 0) + 1;
    E.alerting = true; setTimeout(() => { E.alerting = false; }, 3000);
    const message = MSG[condition][level];
    if (level >= 2 || condition === "drowsiness" || condition === "sleepiness") { beep(level); speak(message); }
    else beep(level);
    if (E.onEvent) E.onEvent({ condition, kind: condition, severity: sev, level, message, at: new Date().toISOString(), counts: JSON.parse(JSON.stringify(E.counts)) });
  }

  function loop() {
    if (!E.running) return;
    const v = E.video;
    if (v && v.readyState >= 2) {
      let res = null; try { res = E.landmarker.detectForVideo(v, performance.now()); } catch {}
      const face = res && res.faceBlendshapes && res.faceBlendshapes[0];
      if (face) {
        if (!E.faceSeen) { E.faceSeen = true; emitStatus("Watching — drive safe."); }
        const pose = poseFromMatrix(res.facialTransformationMatrixes && res.facialTransformationMatrixes[0] && res.facialTransformationMatrixes[0].data);
        E._lm = res.faceLandmarks && res.faceLandmarks[0];
        const tick = analyse(face, pose);
        if (E.onTick) E.onTick(tick);
      } else { if (E.faceSeen) emitStatus("No face — point the camera at yourself."); E.faceSeen = false; E.startClosed = null; E.awaySince = null; E.nodSince = null; if (E.ctx) E.ctx.clearRect(0, 0, E.canvas.width, E.canvas.height); }
    }
    E.raf = requestAnimationFrame(loop);
  }
  function draw(face, closed, lvl) {
    const c = E.canvas, g = E.ctx, lm = E._lm; if (!c || !g || !lm) return;
    if (c.width !== E.video.videoWidth && E.video.videoWidth) { c.width = E.video.videoWidth; c.height = E.video.videoHeight; }
    g.clearRect(0, 0, c.width, c.height);
    let minx = 1, miny = 1, maxx = 0, maxy = 0; lm.forEach(p => { minx = Math.min(minx, p.x); miny = Math.min(miny, p.y); maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y); });
    const worst = Math.max(...Object.values(lvl));
    const col = worst >= 3 ? "#ef4444" : worst === 2 ? "#f97316" : worst === 1 ? "#f59e0b" : closed ? "#f59e0b" : "#22d3ee";
    g.strokeStyle = col; g.lineWidth = 3; g.strokeRect(minx * c.width, miny * c.height, (maxx - minx) * c.width, (maxy - miny) * c.height);
    g.fillStyle = col; [33, 133, 159, 145, 362, 263, 386, 374].forEach(i => { const p = lm[i]; if (p) { g.beginPath(); g.arc(p.x * c.width, p.y * c.height, 3, 0, 7); g.fill(); } });
  }
  async function startEngine(video, canvas, opts) {
    E.video = video; E.canvas = canvas; E.ctx = canvas.getContext("2d"); E.T = thresholds();
    E.onEvent = opts.onEvent; E.onStatus = opts.onStatus; E.onTick = opts.onTick;
    Object.assign(E, { startClosed: null, closedNow: false, earOpen: null, earCut: EAR_FIXED, earAvg: null, perclos: [], blinks: [], yawns: [], yawing: false, yawStart: null, awaySince: null, nodSince: null, poses: [], cond: {}, live: {}, alerting: false, startedAt: now(), faceSeen: false, counts: { alerts: 0, minor: 0, major: 0, critical: 0, byCond: {} } });
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
    return { counts: JSON.parse(JSON.stringify(E.counts)), startedAt: E.startedAt, endedAt: now() };
  }
  window.SafeDriveEngine = { start: startEngine, stop: stopEngine, get counts() { return JSON.parse(JSON.stringify(E.counts)); }, get live() { return { ...E.live }; }, COND, SEV, thresholds };

  // ══════════════════════════ panel UI ══════════════════════════
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const icon = (n, s = 16) => (window.FWIcon ? FWIcon(n, { size: s }) : "");
  const KIND = { long_blink: "Eyes closing", blink_rate: "Heavy eyelids", head_tilt: "Head tilting", fatigue: "Drowsiness", distraction: "Distraction", no_seatbelt: "No seatbelt", phone_use: "Phone use", smoking: "Smoking", harsh_brake: "Harsh braking", harsh_accel: "Harsh acceleration", harsh_corner: "Harsh cornering", overspeed: "Overspeeding" };
  const P = { tab: "monitor", running: false, log: [], vehicles: [], vehId: null, session: null, map: null, stops: [], geo: null };

  // Each surface supplies its own driver context so Safe Drive runs in both the team
  // portal (team.html, signed in) and the no-login link page (driver.html):
  //   window.SafeDriveVehicles       [{id,name}]  (else read from the team portal DOM)
  //   window.SafeDriveMarkAttendance (status)      mark today's attendance; returns truthy on success
  //   window.SafeDriveDrivingSince   ()            ISO time the current drive began (trip start), or null
  const HOURS_BEFORE_ATTENDANCE = 6;
  function driverVehicles() {
    if (Array.isArray(window.SafeDriveVehicles)) return window.SafeDriveVehicles.filter(v => v && v.id);
    return [...document.querySelectorAll("#teamVehicleList .dc-veh")].map(c => ({ id: c.dataset.veh, name: c.dataset.name || c.dataset.ext || "Vehicle" })).filter(v => v.id);
  }
  const canAttend = () => typeof window.SafeDriveMarkAttendance === "function";

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
    b.innerHTML = `${attendanceStrip()}<div class="sd-intro">
      <div class="sd-hero">${icon("eye", 40)}</div>
      <h3>Stay awake at the wheel</h3>
      <p>Mount your phone facing you. The front camera watches your eyes and head and rates drowsiness, tiredness, yawning, distraction and impairment signs, warning you the moment you start to nod off.</p>
      ${V.length ? `<label class="sd-veh">Vehicle<select id="sdVeh">${V.map(v => `<option value="${esc(v.id)}" ${v.id === P.vehId ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></label>` : ""}
      <button type="button" class="btn btn-primary btn-block" id="sdStart">${icon("eye", 16)} Start monitoring</button>
      <p class="sd-note">${recordingOn() ? "When a drowsiness or impairment alert happens, the 2-minute clip is saved and shared with your fleet owner. " : "Detection runs on your phone. "}Alerts reach your owner's safety dashboard. Keep the app open and the screen on while driving.</p></div>`;
    const veh = document.getElementById("sdVeh"); if (veh) veh.onchange = () => { P.vehId = veh.value; };
    document.getElementById("sdStart").onclick = beginMonitor;
    wireAttendance();
  }

  // ── attendance: mark on duty, and a 6-hour driving rule ──
  function attendanceStrip() {
    if (!canAttend()) return "";
    const done = P.attendanceMarked;
    return `<div class="sd-att ${done ? "is-done" : ""}" id="sdAtt">
      <span class="sd-att-ic">${icon(done ? "checkCircle" : "user", 18)}</span>
      <div class="sd-att-txt"><b>${done ? "Attendance marked for today" : "Mark your attendance"}</b>
        <span class="muted">${done ? "You're on duty." : "Tap when you start your duty."}</span></div>
      ${done ? "" : `<button type="button" class="btn btn-primary btn-sm" id="sdAttBtn">I'm on duty</button>`}</div>`;
  }
  function wireAttendance() {
    const btn = document.getElementById("sdAttBtn");
    if (btn) btn.onclick = () => markAttendance("present", "Attendance marked. Have a safe drive.");
  }
  async function markAttendance(status, okMsg) {
    if (!canAttend()) return false;
    try {
      const ok = await window.SafeDriveMarkAttendance(status);
      if (ok !== false) { P.attendanceMarked = true; if (window.toast) toast(okMsg || "Attendance marked."); if (P.tab === "monitor" && !P.running) render(); return true; }
    } catch {}
    if (window.toast) toast("Could not mark attendance. Try again.", "err");
    return false;
  }
  // called each session tick; fires once when driving crosses the 6-hour rest rule
  function checkDrivingHours() {
    if (P.restPrompted || !canAttend()) return;
    let sinceMs = P.session0;
    try { const s = window.SafeDriveDrivingSince && window.SafeDriveDrivingSince(); if (s && !Number.isNaN(Date.parse(s))) sinceMs = Date.parse(s); } catch {}
    if (sinceMs && Date.now() - sinceMs >= HOURS_BEFORE_ATTENDANCE * 3600e3) {
      P.restPrompted = true;
      restBanner();
      try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance("You have driven over six hours. Please pull over, take a rest, and mark your attendance.")); } catch {}
    }
  }
  function restBanner() {
    const cam = document.querySelector(".sd-cam"); if (!cam) return;
    const el = document.createElement("div"); el.className = "sd-rest"; el.id = "sdRest";
    el.innerHTML = `<div>${icon("shieldAlert", 34)}<b>Over 6 hours driving</b><span>Pull over, rest, and mark your attendance.</span>
      <button type="button" class="btn btn-primary btn-sm" id="sdRestBtn">Rest &amp; mark attendance</button></div>`;
    cam.appendChild(el);
    const rb = document.getElementById("sdRestBtn");
    if (rb) rb.onclick = async () => { const ok = await markAttendance("rest", "Rest logged. Please take a proper break."); if (ok) el.remove(); };
  }
  const SEV_LABEL = ["OK", "Minor", "Major", "Critical"];
  const CONDS = SafeDriveEngine.COND;
  const liveHtml = () => `<div class="sd-live">
      <div class="sd-cam"><video id="sdVideo" playsinline muted></video><canvas id="sdCanvas"></canvas>
        <div class="sd-livebadge" id="sdLiveBadge" hidden></div>
        <div class="sd-status" id="sdStatus">Starting…</div>
        <div class="sd-flash" id="sdFlash" hidden><span>${icon("alert", 40)}</span><b id="sdFlashMsg"></b></div></div>
      <div class="sd-state" id="sdState">${Object.keys(CONDS).map(k => `<div class="sd-cond lvl0" data-cond="${k}"><span class="sd-cond-dot"></span><small>${esc(CONDS[k].label)}</small><b>OK</b></div>`).join("")}</div>
      <ul class="sd-log" id="sdLog"></ul>
      ${typeof window.SafeDriveClipUpload === "function" ? `<button type="button" class="btn btn-primary btn-block" id="sdRecNow">${icon("camera", 16)} Record 2-min clip</button>
      <p class="sd-note" id="sdRecNote">Saves a 2-minute clip with your location to your owner's dashboard.</p>` : ""}
      <button type="button" class="btn btn-outline btn-block" id="sdStop">End drive &amp; see summary</button></div>`;
  function wireLive() {
    const s = document.getElementById("sdStop"); if (s) s.onclick = stopMonitor;
    const r = document.getElementById("sdRecNow"); if (r) r.onclick = () => P.manualRec ? stopManualRecording() : startManualRecording();
  }
  function paintState(lvl) {
    const wrap = document.getElementById("sdState"); if (!wrap || !lvl) return;
    wrap.querySelectorAll("[data-cond]").forEach(el => { const l = lvl[el.dataset.cond] || 0; el.className = "sd-cond lvl" + l; el.querySelector("b").textContent = SEV_LABEL[l]; });
  }
  async function beginMonitor() {
    P.running = true; P.log = []; P.restPrompted = false; P.session0 = Date.now(); P.segEvent = null; render();
    let lastHrCheck = 0, lastPaint = 0;
    try {
      await SafeDriveEngine.start(document.getElementById("sdVideo"), document.getElementById("sdCanvas"), {
        onStatus: m => { const s = document.getElementById("sdStatus"); if (s) s.textContent = m; },
        onEvent: async ev => { flash(ev.message, ev.severity); P.log.unshift(ev); renderLog(); const id = await logToFleet(ev); if (id && (ev.severity === "major" || ev.severity === "critical")) P.segEvent = id; },
        onTick: tick => {
          const t = Date.now();
          if (t - lastPaint > 300) {
            lastPaint = t; paintState(tick.lvl);
            const s = document.getElementById("sdStatus");
            if (s && tick.ear != null) s.textContent = `${tick.closed ? "Eyes closed" : "Watching"} · eye ${tick.ear.toFixed(2)} (shut<${tick.earCut.toFixed(2)})`;
          }
          if (t - lastHrCheck > 30000) { lastHrCheck = t; checkDrivingHours(); }
        },
      });
      startRecording();
      startLive();
      startAiScene();
      startMotion();
    } catch (e) {
      P.running = false; render();
      const msg = /denied|NotAllowed/i.test(String(e)) ? "Camera permission was declined. Allow the camera to use Safe Drive." : "Could not start the camera: " + (e.message || e);
      if (window.toast) toast(msg, "err"); else alert(msg);
    }
  }
  function stopMonitor() {
    P.running = false;   // set first so the recorder's onstop does not start a new segment
    stopRecording();
    stopManualRecording();
    stopAiScene();
    stopMotion();
    stopLive();          // disconnect LiveKit before the engine stops the camera track
    const res = SafeDriveEngine.stop();
    const mins = Math.max(1, Math.round((res.endedAt - res.startedAt) / 60000));
    P.session = { ...res.counts, minutes: mins, at: new Date().toISOString() };
    if (P.tab === "monitor") render();
  }

  // ── true live view (LiveKit, through the portable MediaService seam) ──
  // While monitoring, the phone also broadcasts the cabin camera so the owner/supervisor
  // can watch it live from AI Vision. Needs a signed-in session (the no-login driver page
  // has none, so live is off there) and the LiveKit secrets on the server.
  let liveHandle = null;
  function liveOn() { return settings().live !== false && window.MediaService && MediaService.available() && P.vehId; }
  function setLiveBadge(s) {
    const b = document.getElementById("sdLiveBadge"); if (!b) return;
    if (s === "live") { b.hidden = false; b.textContent = "● LIVE"; b.className = "sd-livebadge on"; }
    else if (s === "connecting") { b.hidden = false; b.textContent = "○ going live…"; b.className = "sd-livebadge"; }
    else b.hidden = true;
  }
  async function startLive() {
    // Say plainly why live is off, instead of failing silently, so problems are diagnosable.
    if (settings().live === false) return;                       // driver turned it off
    if (!(window.MediaService && MediaService.available())) {     // no-login page / no session
      console.warn("[SafeDrive] live view unavailable: needs the team driver login."); return;
    }
    if (!P.vehId) { console.warn("[SafeDrive] live view: no vehicle selected."); return; }
    const stream = document.getElementById("sdVideo") && document.getElementById("sdVideo").srcObject;
    if (!stream) { console.warn("[SafeDrive] live view: camera stream not ready."); return; }
    setLiveBadge("connecting");
    try {
      liveHandle = await MediaService.publish(P.vehId, stream, { onState: setLiveBadge });
      console.info("[SafeDrive] publishing live to the owner dashboard.");
    } catch (e) {
      setLiveBadge("stopped");
      console.error("[SafeDrive] could not go live:", e);
      if (window.toast) toast("Live view could not start: " + (e && e.message || e), "err");
    }
  }
  function stopLive() { if (liveHandle) { try { liveHandle.stop(); } catch {} liveHandle = null; } setLiveBadge("stopped"); }

  // ── AI scene check (hosted vision on sampled frames — the infra-free "intelligence on the
  // stream"). Every ~20s a frame goes to the vision-analyze edge fn → Claude vision → events
  // for seatbelt/phone/smoking/distraction the on-device engine doesn't cover. Off by default.
  function captureFrame(video, maxW) {
    return new Promise(res => {
      try {
        const w = video.videoWidth || 480, h = video.videoHeight || 640, scale = Math.min(1, (maxW || 480) / w);
        const c = document.createElement("canvas"); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
        c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
        c.toBlob(b => res(b), "image/jpeg", 0.6);
      } catch { res(null); }
    });
  }
  function aiSceneOn() { return settings().aiScene === true && typeof window.SafeDriveVisionAnalyze === "function" && P.vehId; }
  async function aiTick() {
    if (!P.running || !aiSceneOn() || P.aiBusy) return;
    const v = document.getElementById("sdVideo"); if (!v) return;
    P.aiBusy = true;
    try {
      const blob = await captureFrame(v, 480); if (!blob) return;
      const geo = P.geo ? { latitude: P.geo[0], longitude: P.geo[1] } : {};
      const res = await window.SafeDriveVisionAnalyze(blob, { vehicleId: P.vehId, view: "cabin", ...geo });
      if (res && res.logged && res.logged.length) { flash("AI noticed: " + res.logged.map(k => KIND[k] || k).join(", "), "major"); }
    } catch (e) { console.warn("[SafeDrive] AI scene check failed:", e); }
    finally { P.aiBusy = false; }
  }
  function startAiScene() { if (!aiSceneOn()) return; clearInterval(P.aiTimer); P.aiTimer = setInterval(aiTick, 20000); setTimeout(aiTick, 5000); }
  function stopAiScene() { clearInterval(P.aiTimer); P.aiBusy = false; }

  // ── 2-minute clip recording (uploaded so the owner/supervisor can review) ──
  // Records the front camera in 2-minute segments and uploads each one; if a major or
  // critical alert occurred during a segment, the clip is linked to that incident so it
  // shows on the alert in Incident Triage. Only when a signed-in uploader is available.
  const SEGMENT_MS = 120000;
  function recordingOn() { return settings().record !== false && typeof window.SafeDriveClipUpload === "function" && "MediaRecorder" in window; }
  function pickMime() { for (const m of ["video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {} } return ""; }
  function startRecording() {
    if (!recordingOn()) return;
    const stream = document.getElementById("sdVideo") && document.getElementById("sdVideo").srcObject;
    if (!stream) return;
    P.recMime = pickMime();
    const begin = () => {
      if (!P.running) return;
      let chunks = [], startedAt = new Date().toISOString(), segEvtAtStart = P.segEvent;
      let rec; try { rec = new MediaRecorder(stream, P.recMime ? { mimeType: P.recMime, videoBitsPerSecond: 800000 } : undefined); } catch { return; }
      P.rec = rec;
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: P.recMime || "video/webm" });
        const evId = P.segEvent || segEvtAtStart;   // a major/critical alert in this segment
        P.segEvent = null;
        // save the 2-minute segment when it caught a serious alert (evidence for the owner);
        // calm segments are discarded so the drive doesn't burn the driver's mobile data
        if (blob.size > 1000 && P.vehId && evId) uploadClip(blob, evId, startedAt);
        if (P.running) begin();   // keep recording the next 2-minute segment
      };
      rec.start();
      P.segTimer = setTimeout(() => { try { rec.state !== "inactive" && rec.stop(); } catch {} }, SEGMENT_MS);
    };
    begin();
    setRecBadge(true);
  }
  function stopRecording() {
    clearTimeout(P.segTimer);
    // P.running is already false, so the recorder's onstop uploads the last segment and
    // does not begin a new one.
    if (P.rec && P.rec.state !== "inactive") { try { P.rec.stop(); } catch {} }
    P.rec = null; setRecBadge(false);
  }
  async function uploadClip(blob, eventId, startedAt) {
    try { await window.SafeDriveClipUpload(blob, { vehicleId: P.vehId, eventId: eventId || null, capturedAt: startedAt }); } catch {}
  }

  // ── manual "Record 2-min clip": capture the GPS location, then record for 2 minutes ──
  // Driver-initiated (not event-triggered): grabs latitude/longitude, records the camera for
  // two minutes (or until tapped again), and uploads the clip with the location so the owner
  // sees it on the map and in Incident Triage.
  function currentGeo() {
    return new Promise(res => {
      if (!navigator.geolocation) return res(P.geo ? { lat: P.geo[0], lng: P.geo[1] } : null);
      navigator.geolocation.getCurrentPosition(
        p => { P.geo = [p.coords.latitude, p.coords.longitude]; res({ lat: p.coords.latitude, lng: p.coords.longitude }); },
        () => res(P.geo ? { lat: P.geo[0], lng: P.geo[1] } : null),
        { timeout: 8000, enableHighAccuracy: true });
    });
  }
  function manualBtn(recording, secs) {
    const btn = document.getElementById("sdRecNow"); if (!btn) return;
    if (recording) { const m = Math.floor(secs / 60), s = String(secs % 60).padStart(2, "0"); btn.innerHTML = `● Recording ${m}:${s} — tap to stop`; btn.classList.add("btn-danger"); btn.classList.remove("btn-primary"); }
    else { btn.innerHTML = `${icon("camera", 16)} Record 2-min clip`; btn.classList.add("btn-primary"); btn.classList.remove("btn-danger"); }
  }
  async function startManualRecording() {
    if (P.manualRec) return;
    if (typeof window.SafeDriveClipUpload !== "function") { if (window.toast) toast("Recording needs the team driver login.", "err"); return; }
    if (!("MediaRecorder" in window)) { if (window.toast) toast("This phone can't record video.", "err"); return; }
    const stream = document.getElementById("sdVideo") && document.getElementById("sdVideo").srcObject;
    if (!stream) { if (window.toast) toast("Start monitoring first so the camera is on.", "err"); return; }
    if (!P.vehId) { if (window.toast) toast("Pick a vehicle first.", "err"); return; }
    const note = document.getElementById("sdRecNote"); if (note) note.textContent = "Getting your location…";
    const geo = await currentGeo();
    if (note) note.textContent = geo ? `Location captured (${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}). Recording 2 minutes…` : "Location unavailable — recording anyway.";
    const mime = pickMime();
    let chunks = [], startedAt = new Date().toISOString();
    let rec; try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 800000 } : undefined); } catch { if (window.toast) toast("Could not start recording.", "err"); return; }
    P.manualRec = rec;
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      clearInterval(P.manualCd); clearTimeout(P.manualTimer); P.manualRec = null; manualBtn(false, 0);
      const n = document.getElementById("sdRecNote"); if (n) n.textContent = "Uploading…";
      const blob = new Blob(chunks, { type: mime || "video/webm" });
      if (blob.size > 1000 && P.vehId) {
        try {
          await window.SafeDriveClipUpload(blob, { vehicleId: P.vehId, capturedAt: startedAt, manual: true, latitude: geo && geo.lat, longitude: geo && geo.lng });
          if (window.toast) toast("2-minute clip saved to your owner.", "ok");
          if (n) n.textContent = "Clip saved to your owner's dashboard.";
        } catch { if (window.toast) toast("Could not upload the clip.", "err"); if (n) n.textContent = "Upload failed — check your connection."; }
      }
    };
    rec.start();
    let left = 120; manualBtn(true, left);
    P.manualCd = setInterval(() => { left--; manualBtn(true, Math.max(0, left)); if (left <= 0) clearInterval(P.manualCd); }, 1000);
    P.manualTimer = setTimeout(() => { try { rec.state !== "inactive" && rec.stop(); } catch {} }, SEGMENT_MS);
  }
  function stopManualRecording() {
    clearTimeout(P.manualTimer); clearInterval(P.manualCd);
    if (P.manualRec && P.manualRec.state !== "inactive") { try { P.manualRec.stop(); } catch {} }
  }
  function setRecBadge(on) {
    const cam = document.querySelector(".sd-cam"); if (!cam) return;
    let b = document.getElementById("sdRec");
    if (on && !b) { b = document.createElement("div"); b.id = "sdRec"; b.className = "sd-rec"; b.innerHTML = `<i></i> REC`; cam.appendChild(b); }
    else if (!on && b) b.remove();
  }
  const summaryHtml = s => {
    const crit = s.critical || 0, maj = s.major || 0, min = s.minor || 0, worst = crit ? "critical" : maj ? "major" : min ? "minor" : "ok";
    return `<div class="sd-summary">
      <div class="sd-hero ${worst === "ok" ? "ok" : "warn"}">${icon(worst === "ok" ? "checkCircle" : "shieldAlert", 40)}</div>
      <h3>${worst === "critical" ? "Unsafe drive — please rest" : worst === "ok" ? "Great drive!" : "Drive over — stay alert"}</h3>
      <p>${s.minutes} min monitored · <b>${s.alerts}</b> alert${s.alerts === 1 ? "" : "s"}.</p>
      <div class="sd-stats">
        <div class="sd-stat sev-critical"><small>Critical</small><b>${crit}</b></div>
        <div class="sd-stat sev-major"><small>Major</small><b>${maj}</b></div>
        <div class="sd-stat sev-minor"><small>Minor</small><b>${min}</b></div>
        <div class="sd-stat"><small>Minutes</small><b>${s.minutes}</b></div></div>
      ${Object.keys(s.byCond || {}).length ? `<ul class="sd-log" style="max-height:none">${Object.entries(s.byCond).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<li><span class="sd-cond-dot lvl2"></span><b>${esc((CONDS[k] || {}).label || k)}</b><span class="muted">${n}×</span></li>`).join("")}</ul>` : ""}
      ${crit ? `<p class="sd-note" style="color:#b91c1c">Critical drowsiness/impairment signs this drive. Please rest properly before driving again — see the Rest stops tab.</p>` : ""}
      <button type="button" class="btn btn-primary btn-block" id="sdAgain">Done</button></div>`;
  };
  const SEV_COL = { minor: "#f59e0b", major: "#f97316", critical: "#ef4444" };
  function flash(message, severity) {
    const f = document.getElementById("sdFlash"), m = document.getElementById("sdFlashMsg"); if (!f) return;
    m.textContent = message; f.style.background = (SEV_COL[severity] || "#dc2626"); f.hidden = false;
    clearTimeout(f._t); f._t = setTimeout(() => { f.hidden = true; }, severity === "critical" ? 3200 : 2400);
  }
  function renderLog() {
    const el = document.getElementById("sdLog"); if (!el) return;
    el.innerHTML = P.log.slice(0, 14).map(e => `<li><span class="sd-cond-dot lvl${e.level}"></span><b>${esc((CONDS[e.condition] || {}).label || e.condition)}</b><span class="sd-sevchip sev-${e.severity}">${e.severity}</span><span class="muted">${new Date(e.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></li>`).join("");
  }
  // log an alert to FleetSafe. Each surface can supply its own logger (driver.html posts
  // through its anon link); the team portal falls back to the signed-in edge function.
  async function logToFleet(ev) {
    const payload = { vehicleId: P.vehId, kind: ev.condition, severity: ev.severity, occurredAt: ev.at };
    if (ev.latitude != null) payload.latitude = ev.latitude;
    if (ev.longitude != null) payload.longitude = ev.longitude;
    if (ev.speedKmph != null) payload.speedKmph = ev.speedKmph;
    if (typeof window.SafeDriveLog === "function") { try { await window.SafeDriveLog(payload); } catch {} return null; }
    if (!P.vehId || !(window.fwCloud && fwCloud.callFunction)) return null;
    try { const r = await fwCloud.callFunction("driver-safety-event", payload); return r && r.eventId ? r.eventId : null; } catch { return null; }
  }

  // ── phone motion telematics: harsh braking / acceleration / cornering + overspeed ──
  // The phone is already mounted and permitted for the camera; its GPS speed and accelerometer
  // turn it into a tracker too (Samsara/Motive-style) with no hardware. GPS speed drives the
  // reliable brake/accel/overspeed calls; the accelerometer adds cornering. Events feed the
  // same device_events pipeline (harsh_brake/harsh_accel/harsh_corner/overspeed).
  const MOTION = { BRAKE: -3.5, BRAKE_CRIT: -5.5, ACCEL: 3.2, ACCEL_CRIT: 5.0, CORNER: 3.8, CORNER_CRIT: 5.5, MOVING_MS: 5 };
  function motionOn() { return settings().motion !== false && "geolocation" in navigator && P.vehId; }
  function speedLimit() { const n = Number(settings().speedLimit); return Number.isFinite(n) && n > 0 ? n : 80; }
  const MOTION_MSG = { harsh_brake: "Harsh braking — ease off", harsh_accel: "Harsh acceleration — go smooth", harsh_corner: "Sharp turn — slow down", overspeed: "Over the speed limit — slow down" };
  function fireMotion(kind, severity) {
    const M = P.motion, now = Date.now(), gap = kind === "overspeed" ? 30000 : 12000;
    if (M.last[kind] && now - M.last[kind] < gap) return;
    M.last[kind] = now;
    const ev = { condition: kind, severity, at: new Date().toISOString(), message: MOTION_MSG[kind] || kind, latitude: P.geo && P.geo[0], longitude: P.geo && P.geo[1], speedKmph: M.lastKmh != null ? Math.round(M.lastKmh) : null };
    flash(ev.message, severity); if (severity === "critical") beep(3);
    P.log.unshift(ev); renderLog(); logToFleet(ev);
  }
  function onMotionPos(p) {
    const M = P.motion, c = p.coords;
    P.geo = [c.latitude, c.longitude];
    const t = p.timestamp || Date.now();
    let v = typeof c.speed === "number" && c.speed >= 0 ? c.speed : null;   // m/s from GPS
    if (v == null && M.lastLatLng) { const d = haversine(M.lastLatLng, [c.latitude, c.longitude]) * 1000, dt = (t - M.lastT) / 1000; if (dt > 0.3) v = d / dt; }
    M.lastLatLng = [c.latitude, c.longitude];
    if (v == null) { M.lastT = t; return; }
    const kmh = v * 3.6; M.lastKmh = kmh;
    // stream position to the vehicle twin every ~15s so phone-only vehicles show live
    if (typeof window.SafeDrivePosition === "function" && (!M.lastPos || t - M.lastPos > 15000)) {
      M.lastPos = t;
      window.SafeDrivePosition({ vehicleId: P.vehId, lat: c.latitude, lng: c.longitude, speed: Math.round(kmh), heading: typeof c.heading === "number" ? c.heading : undefined });
    }
    if (M.lastV != null) {
      const dt = (t - M.lastT) / 1000;
      if (dt >= 0.3 && dt <= 5) {
        const a = (v - M.lastV) / dt;   // m/s²
        if (kmh > MOTION.MOVING_MS * 3.6) {
          if (a <= MOTION.BRAKE) fireMotion("harsh_brake", a <= MOTION.BRAKE_CRIT ? "critical" : "major");
          else if (a >= MOTION.ACCEL) fireMotion("harsh_accel", a >= MOTION.ACCEL_CRIT ? "critical" : "major");
        }
      }
    }
    const lim = speedLimit();
    if (kmh > lim) fireMotion("overspeed", kmh > lim + 20 ? "critical" : "major");
    M.lastV = v; M.lastT = t;
  }
  function onMotionAccel(e) {
    const M = P.motion; if (M.lastKmh == null || M.lastKmh < MOTION.MOVING_MS * 3.6) return;   // only while moving
    const a = e.acceleration || {};   // gravity-free; may be null on some devices
    if (a.x == null) return;
    const lateral = Math.hypot(a.x || 0, a.y || 0);
    if (lateral >= MOTION.CORNER) fireMotion("harsh_corner", lateral >= MOTION.CORNER_CRIT ? "critical" : "major");
  }
  async function startMotion() {
    if (!motionOn()) return;
    P.motion = { last: {}, lastV: null, lastT: 0, lastKmh: null, lastLatLng: null, lastPos: 0, watchId: null };
    try { P.motion.watchId = navigator.geolocation.watchPosition(onMotionPos, () => {}, { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }); } catch {}
    try {
      if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === "function") { try { await DeviceMotionEvent.requestPermission(); } catch {} }
      if (window.DeviceMotionEvent) window.addEventListener("devicemotion", onMotionAccel);
    } catch {}
  }
  function stopMotion() {
    if (P.motion) { if (P.motion.watchId != null) { try { navigator.geolocation.clearWatch(P.motion.watchId); } catch {} } }
    try { window.removeEventListener("devicemotion", onMotionAccel); } catch {}
    P.motion = null;
  }

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
      <section><h4 class="sd-h4">Recording</h4>
        <label class="sd-switch"><span>Record 2-minute clips for my owner</span><input type="checkbox" id="sdRecord" ${s.record !== false ? "checked" : ""}></label>
        <p class="sd-note" style="margin-top:2px">${typeof window.SafeDriveClipUpload === "function" ? "Recorded during monitoring; when a serious alert happens, that 2-minute clip is saved to your owner's dashboard." : "Recording needs a signed-in driver account (team login)."}</p></section>
      <section><h4 class="sd-h4">Live view</h4>
        <label class="sd-switch"><span>Stream the cabin live to my owner</span><input type="checkbox" id="sdLive" ${s.live !== false ? "checked" : ""}></label>
        <p class="sd-note" style="margin-top:2px">${window.MediaService && MediaService.available() ? "While monitoring, your owner and supervisor can watch the cabin live from their dashboard." : "Live view needs a signed-in driver account (team login)."}</p></section>
      <section><h4 class="sd-h4">AI scene check</h4>
        <label class="sd-switch"><span>Watch for seatbelt, phone &amp; smoking (AI)</span><input type="checkbox" id="sdAiScene" ${s.aiScene === true ? "checked" : ""}></label>
        <p class="sd-note" style="margin-top:2px">${typeof window.SafeDriveVisionAnalyze === "function" ? "Every ~20s the camera frame is checked by AI; anything it spots reaches your owner's dashboard." : "AI scene check needs the team driver login."}</p></section>
      <section><h4 class="sd-h4">Driving behaviour</h4>
        <label class="sd-switch"><span>Detect harsh braking, acceleration &amp; overspeed</span><input type="checkbox" id="sdMotion" ${s.motion !== false ? "checked" : ""}></label>
        <label class="sd-veh">Speed limit<select id="sdSpeedLimit">${[40, 50, 60, 70, 80, 90, 100].map(v => `<option value="${v}" ${s.speedLimit === v ? "selected" : ""}>${v} km/h</option>`).join("")}</select></label>
        <p class="sd-note" style="margin-top:2px">Uses the phone's GPS and motion sensors — harsh driving and overspeed reach your owner's safety dashboard.</p></section>
      <section><h4 class="sd-h4">Rest stops</h4>
        <label class="sd-veh">Show by default<select id="sdRestType">${Object.entries(STOP_KINDS).map(([k, v]) => `<option value="${k}" ${s.restType === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
        <label class="sd-veh">Search radius<select id="sdRadius">${[2, 5, 10, 20].map(r => `<option value="${r}" ${s.radiusKm === r ? "selected" : ""}>${r} km</option>`).join("")}</select></label></section>
      <p class="sd-note">Settings are kept on this phone. Detection thresholds follow DriveBuddy's tested defaults.</p></div>`;
    b.querySelectorAll("[data-sens]").forEach(btn => btn.onclick = () => { const st = settings(); st.sensitivity = btn.dataset.sens; saveSettings(st); renderSettings(); });
    const set = (id, key, val) => { const el = document.getElementById(id); if (el) el.onchange = () => { const st = settings(); st[key] = val(el); saveSettings(st); }; };
    set("sdSound", "sound", el => el.checked); set("sdVoice", "voice", el => el.checked); set("sdRecord", "record", el => el.checked); set("sdLive", "live", el => el.checked); set("sdAiScene", "aiScene", el => el.checked); set("sdMotion", "motion", el => el.checked); set("sdSpeedLimit", "speedLimit", el => +el.value);
    set("sdRestType", "restType", el => el.value); set("sdRadius", "radiusKm", el => +el.value);
  }

  window.SafeDrive = { mount, stop: () => { if (P.running) stopMonitor(); }, isRunning: () => P.running };
})();
