/* AI Vision scenes.
   Draws the four camera views a truck carries (front road, cabin driver-monitor,
   360° surround, fuel-tank cam) on a canvas, with the AI layer on top: detection
   boxes with class, confidence and distance, the ego-lane mesh, the face-landmark
   mesh, and a warning banner when a scenario fires.

   These are SIMULATED scenes: no footage is involved, and every caller labels them
   as such. They exist so an owner can see what the AI layer does before cameras
   are fitted, and so a test incident has a picture to go with it. Once a real
   stream is linked, the camera viewer plays that instead.

   FWVision.draw(ctx, W, H, cam, scenarioKey, tSeconds, { boxes, mesh, heatmap, minConf, seed })
   FWVision.SCENARIOS  scenario metadata (label, camera, severity, device event type, text) */
(function () {
  "use strict";

  const SCENARIOS = {
    nominal: {
      label: "Nominal (all clear)", cam: "front", sev: "ok", icon: "checkCircle",
      cls: "Nominal", text: "All zones clear. Driver attentive, eyes on the road.", event: null,
    },
    forward_collision: {
      label: "Forward collision (TTC 1.4 s)", cam: "front", sev: "critical", icon: "shieldAlert",
      cls: "Forward collision", text: "Closing fast on the vehicle ahead: 15.3 m, 1.4 s to impact at 64 km/h. The model is locked on the lead vehicle.",
      event: "forward_collision", speed: 64, raw: { ttc_s: 1.4, distance_m: 15.3, lead_class: "truck", confidence: 0.94 },
    },
    fatigue: {
      label: "Driver drowsiness (PERCLOS 84%)", cam: "cabin", sev: "critical", icon: "eye",
      cls: "Drowsiness", text: "Eyes closed for 3.2 s (eye aspect ratio 0.11, PERCLOS 84%). Head nodding. The driver needs to rest now.",
      event: "fatigue", speed: 58, raw: { perclos_pct: 84, ear: 0.11, eyes_closed_s: 3.2, confidence: 0.91 },
    },
    phone_use: {
      label: "Phone in hand", cam: "cabin", sev: "warning", icon: "phone",
      cls: "Phone use", text: "A phone is held at the driver's ear while moving. Gaze off the road for 4.6 s.",
      event: "phone_use", speed: 47, raw: { object: "cell_phone", gaze_off_road_s: 4.6, confidence: 0.89 },
    },
    lane_departure: {
      label: "Lane drift (−0.62 m)", cam: "front", sev: "warning", icon: "map",
      cls: "Lane departure", text: "Drifted 0.62 m over the left lane marking with no indicator.",
      event: "lane_departure", speed: 71, raw: { offset_m: -0.62, side: "left", indicator: false, confidence: 0.87 },
    },
    fuel_tamper: {
      label: "Fuel siphoning (−24 L)", cam: "tank", sev: "critical", icon: "fuel",
      cls: "Fuel siphoning", text: "A hose and canister at the tank cap while parked, engine off. The tank sensor shows a 24 L drop in 3 minutes.",
      event: "tamper", speed: 0, raw: { kind: "fuel_siphon", litres_lost: 24, minutes: 3, rpm: 0, ignition: false, confidence: 0.96 },
    },
  };
  const CAMS = {
    front: "Front road camera (collision / lane)",
    cabin: "Cabin driver monitor (DMS)",
    surround: "360° surround view",
    tank: "Fuel tank camera",
  };

  const GREEN = "#10b981", RED = "#ef4444", AMBER = "#f59e0b", CYAN = "#22d3ee";

  // ── helpers ──────────────────────────────────────────────────────────
  function box(g, x, y, w, h, color, label, conf, opts) {
    if (!opts.boxes || conf < opts.minConf) return;
    g.save();
    g.strokeStyle = color; g.lineWidth = Math.max(1.5, w / 90);
    g.shadowColor = color; g.shadowBlur = 8;
    g.strokeRect(x, y, w, h);
    g.shadowBlur = 0;
    // corner brackets read as "tracking lock"
    const c = Math.min(w, h) * 0.18; g.lineWidth += 1.5;
    [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([px, py, sx, sy]) => {
      g.beginPath(); g.moveTo(px, py + sy * c); g.lineTo(px, py); g.lineTo(px + sx * c, py); g.stroke();
    });
    if (label) {
      const fs = Math.max(9, Math.round(g.canvas.width / 70));
      g.font = `700 ${fs}px ui-monospace, Consolas, monospace`;
      const text = `${label} ${Math.round(conf * 100)}%`, tw = g.measureText(text).width + 10;
      g.fillStyle = color; g.fillRect(x - g.lineWidth / 2, y - fs - 6, tw, fs + 6);
      g.fillStyle = "#04130d"; g.fillText(text, x + 4, y - 5);
    }
    g.restore();
  }
  function banner(g, W, H, color, title, sub, t, top = 0.1) {
    const pulse = 0.82 + 0.18 * Math.sin(t * 8);
    const bw = W * 0.62, bh = H * 0.13, bx = (W - bw) / 2, by = H * top;
    g.save();
    g.globalAlpha = pulse; g.fillStyle = color; g.fillRect(bx, by, bw, bh);
    g.globalAlpha = 1; g.fillStyle = "#fff"; g.textAlign = "center";
    g.font = `800 ${Math.round(bh * 0.34)}px system-ui, sans-serif`;
    g.fillText("⚠ " + title, W / 2, by + bh * 0.46);
    g.font = `600 ${Math.round(bh * 0.22)}px ui-monospace, Consolas, monospace`;
    g.fillText(sub, W / 2, by + bh * 0.8);
    g.restore();
  }
  function grain(g, W, H, t, amount) {
    g.save(); g.globalAlpha = amount;
    for (let y = (t * 40) % 4; y < H; y += 4) { g.fillStyle = "rgba(255,255,255,.035)"; g.fillRect(0, y, W, 1); }
    g.restore();
  }
  function vignette(g, W, H) {
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.55)");
    g.fillStyle = v; g.fillRect(0, 0, W, H);
  }
  function heat(g, x, y, r, color) {
    const h = g.createRadialGradient(x, y, 0, x, y, r);
    h.addColorStop(0, color); h.addColorStop(1, "rgba(0,0,0,0)");
    g.save(); g.globalCompositeOperation = "lighter"; g.fillStyle = h; g.fillRect(x - r, y - r, r * 2, r * 2); g.restore();
  }

  // ── front road ───────────────────────────────────────────────────────
  function front(g, W, H, key, t, o) {
    const hz = H * 0.46, drift = key === "lane_departure" ? Math.sin(t * 0.6) * 0.04 + 0.1 : 0;
    const cx = W * (0.5 + drift);
    const sky = g.createLinearGradient(0, 0, 0, hz); sky.addColorStop(0, "#050a18"); sky.addColorStop(1, "#1d2c4d");
    g.fillStyle = sky; g.fillRect(0, 0, W, hz);
    // hills
    g.fillStyle = "#0c1426"; g.beginPath(); g.moveTo(0, hz);
    for (let x = 0; x <= W; x += W / 12) g.lineTo(x, hz - H * (0.04 + 0.05 * Math.abs(Math.sin(x / W * 5.3 + 1))));
    g.lineTo(W, hz); g.fill();
    // ground and road
    g.fillStyle = "#0d1a14"; g.fillRect(0, hz, W, H - hz);
    g.fillStyle = "#1a1f2b"; g.beginPath();
    g.moveTo(cx - W * 0.03, hz); g.lineTo(cx + W * 0.03, hz); g.lineTo(cx + W * 0.62, H); g.lineTo(cx - W * 0.62, H); g.fill();
    // headlight pool
    const hl = g.createRadialGradient(W / 2, H * 1.05, 0, W / 2, H * 1.05, H * 0.75);
    hl.addColorStop(0, "rgba(255,240,200,.22)"); hl.addColorStop(1, "rgba(255,240,200,0)"); g.fillStyle = hl; g.fillRect(0, hz, W, H - hz);
    // lane edges
    const leftHot = key === "lane_departure";
    g.lineWidth = Math.max(2, W / 260);
    g.strokeStyle = "rgba(240,240,240,.85)";
    g.beginPath(); g.moveTo(cx + W * 0.02, hz); g.lineTo(cx + W * 0.5, H); g.stroke();
    g.strokeStyle = leftHot && o.boxes ? RED : "rgba(240,240,240,.85)";
    if (leftHot && o.boxes) { g.shadowColor = RED; g.shadowBlur = 12; g.lineWidth *= 2; }
    g.beginPath(); g.moveTo(cx - W * 0.02, hz); g.lineTo(cx - W * 0.5, H); g.stroke();
    g.shadowBlur = 0; g.lineWidth = Math.max(2, W / 260);
    // centre dashes moving toward the camera
    g.fillStyle = "#f5c518";
    for (let i = 0; i < 8; i++) {
      const p = (t * 0.9 + i / 8) % 1, y = hz + p * p * (H - hz), w = 1 + p * p * W * 0.012, h = 2 + p * p * H * 0.07;
      g.fillRect(cx - w / 2, y, w, h);
    }
    // ego-lane mesh
    if (o.mesh) {
      g.fillStyle = leftHot ? "rgba(239,68,68,.13)" : "rgba(16,185,129,.12)";
      g.beginPath(); g.moveTo(cx - W * 0.018, hz + 2); g.lineTo(cx + W * 0.018, hz + 2); g.lineTo(cx + W * 0.46, H); g.lineTo(cx - W * 0.46, H); g.fill();
      g.strokeStyle = leftHot ? "rgba(239,68,68,.35)" : "rgba(16,185,129,.3)"; g.lineWidth = 1;
      for (let i = 1; i < 7; i++) { const p = i / 7, y = hz + p * p * (H - hz), hw = 0.018 * W + p * p * 0.44 * W; g.beginPath(); g.moveTo(cx - hw, y); g.lineTo(cx + hw, y); g.stroke(); }
    }
    // lead vehicle (box truck rear)
    const close = key === "forward_collision" ? 0.78 + 0.06 * Math.sin(t * 3) : 0.34 + 0.02 * Math.sin(t * 0.7);
    const vw = W * 0.08 + close * W * 0.3, vh = vw * 0.95, vx = cx - vw / 2 + W * 0.01 * Math.sin(t * 0.4), vy = hz + close * (H - hz) * 0.62 - vh * 0.55;
    g.fillStyle = "#2a3140"; g.fillRect(vx, vy, vw, vh);
    g.fillStyle = "#353d4f"; g.fillRect(vx + vw * 0.06, vy + vh * 0.06, vw * 0.88, vh * 0.72);
    g.strokeStyle = "#1c2230"; g.lineWidth = 1; g.beginPath(); g.moveTo(vx + vw / 2, vy + vh * 0.06); g.lineTo(vx + vw / 2, vy + vh * 0.78); g.stroke();
    g.fillStyle = "#11151f"; g.fillRect(vx - vw * 0.02, vy + vh * 0.86, vw * 1.04, vh * 0.1);
    const brake = key === "forward_collision";
    g.fillStyle = brake ? "#ff2d2d" : "#7a1a1a";
    if (brake) { g.shadowColor = "#ff2d2d"; g.shadowBlur = 18; }
    g.fillRect(vx + vw * 0.04, vy + vh * 0.8, vw * 0.14, vh * 0.06); g.fillRect(vx + vw * 0.82, vy + vh * 0.8, vw * 0.14, vh * 0.06);
    g.shadowBlur = 0;
    g.fillStyle = "#e5e7eb"; g.fillRect(vx + vw * 0.38, vy + vh * 0.8, vw * 0.24, vh * 0.05);
    if (o.heatmap) heat(g, vx + vw / 2, vy + vh / 2, vw * 0.9, brake ? "rgba(239,68,68,.45)" : "rgba(245,158,11,.25)");
    // oncoming car far away on the right
    const oc = (t * 0.25) % 1, ow = W * (0.02 + oc * 0.08), ox = cx + W * 0.05 + oc * W * 0.4, oy = hz + oc * oc * (H - hz) * 0.5;
    g.fillStyle = "#222a38"; g.fillRect(ox, oy, ow, ow * 0.6);
    g.fillStyle = "#fff8d6"; g.fillRect(ox + ow * 0.05, oy + ow * 0.35, ow * 0.18, ow * 0.1); g.fillRect(ox + ow * 0.77, oy + ow * 0.35, ow * 0.18, ow * 0.1);
    box(g, ox - 3, oy - 3, ow + 6, ow * 0.6 + 6, CYAN, "CAR", 0.81, o);

    const dist = key === "forward_collision" ? 15.3 : 42.0 + 3 * Math.sin(t * 0.7);
    const ttc = key === "forward_collision" ? 1.4 : 4.1;
    box(g, vx - 6, vy - 6, vw + 12, vh + 12, brake ? RED : GREEN, `TRUCK ${dist.toFixed(1)}m TTC ${ttc}s`, 0.94, o);
    if (key === "forward_collision") banner(g, W, H, "rgba(220,38,38,.92)", "FORWARD COLLISION WARNING", "TTC 1.4 s · BRAKE NOW · 15.3 m", t);
    if (key === "lane_departure") banner(g, W, H, "rgba(217,119,6,.92)", "LANE DEPARTURE", "LEFT −0.62 m · NO INDICATOR", t);
    vignette(g, W, H); grain(g, W, H, t, 1);
  }

  // ── sensor noise ─────────────────────────────────────────────────────
  // One pre-rendered noise tile, laid over the frame at a random offset every
  // frame: real camera sensors, and IR ones especially, are never clean.
  let _noise = null;
  function noiseTile() {
    if (_noise) return _noise;
    const c = document.createElement("canvas"); c.width = c.height = 192;
    const x = c.getContext("2d"), d = x.createImageData(192, 192), r = rngFrom(99);
    for (let i = 0; i < d.data.length; i += 4) { const v = r() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0); _noise = c; return c;
  }
  function sensorNoise(g, W, H, alpha) {
    const p = g.createPattern(noiseTile(), "repeat"), ox = (Math.random() * 192) | 0, oy = (Math.random() * 192) | 0;
    g.save(); g.globalAlpha = alpha; g.globalCompositeOperation = "overlay";
    g.translate(-ox, -oy); g.fillStyle = p; g.fillRect(ox, oy, W, H); g.restore();
  }
  // asphalt texture that can scroll under a moving vehicle
  let _asphalt = null;
  function asphaltTile() {
    if (_asphalt) return _asphalt;
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const x = c.getContext("2d"), r = rngFrom(5);
    x.fillStyle = "#3a3d42"; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1400; i++) { const v = 40 + r() * 50 | 0; x.fillStyle = `rgba(${v},${v},${v + 3},.7)`; x.fillRect(r() * 128, r() * 128, 1 + r() * 1.5, 1 + r() * 1.5); }
    for (let i = 0; i < 6; i++) { x.strokeStyle = "rgba(20,20,22,.35)"; x.lineWidth = 0.6; x.beginPath(); let px = r() * 128, py = r() * 128; x.moveTo(px, py); for (let k = 0; k < 5; k++) { px += (r() - 0.5) * 18; py += r() * 14; x.lineTo(px, py); } x.stroke(); }
    _asphalt = c; return c;
  }
  const gray = v => `rgb(${v | 0},${v | 0},${v | 0})`;

  // ── cabin driver monitor ────────────────────────────────────────────
  // A near-infrared (940 nm) driver-monitoring camera on the dashboard, looking back
  // at the driver: monochrome, lit from the camera so the face is brightest and the
  // cab falls off to dark, with the bright corneal glints IR cameras are known for.
  function cabin(g, W, H, key, t, o) {
    const sleepy = key === "fatigue", phone = key === "phone_use";

    // ── behaviour: head pose, eyes, mouth ──
    const sway = Math.sin(t * 0.9) * 0.025 + Math.sin(t * 0.37) * 0.02;
    let yaw = sway, pitch = Math.sin(t * 0.55) * 0.02, roll = Math.sin(t * 0.47) * 0.025;
    let gazeX = 0, gazeY = 0;
    const mc = t % 9;                                   // a mirror check every 9 s
    if (!sleepy && !phone && mc > 7.3 && mc < 8.5) { const k = Math.sin((mc - 7.3) / 1.2 * Math.PI); yaw += k * 0.42; gazeX = k * 0.7; }
    let nod = 0;
    if (sleepy) {                                       // slow droop, then a jerk back up
      const c = (t % 5.2) / 5.2;
      nod = c < 0.82 ? Math.pow(c / 0.82, 1.7) : 1 - (c - 0.82) / 0.18;
      pitch = 0.04 + nod * 0.34; roll = nod * 0.1; gazeY = 0.5;
    }
    if (phone) { yaw = -0.3 + sway * 0.5; roll = -0.13; pitch = 0.05; gazeX = -0.55; gazeY = 0.2; }
    let eye = 1;
    const bt = (t + 0.7) % 3.6; if (bt < 0.16) eye = Math.abs(bt - 0.08) / 0.08;      // blink
    if (sleepy) eye = nod > 0.12 ? 0 : 0.28 + 0.05 * Math.sin(t * 3);
    let mouth = 0;
    if (sleepy) { const y = t % 13; if (y > 9 && y < 11.4) mouth = Math.sin((y - 9) / 2.4 * Math.PI); }  // yawn
    if (phone) mouth = 0.18 + 0.12 * Math.abs(Math.sin(t * 5));                       // talking

    // ── cab ──
    g.fillStyle = gray(34); g.fillRect(0, 0, W, H);
    // sleeper curtain behind the seat, with folds
    const folds = 26;
    for (let i = 0; i < folds; i++) {
      const x = W * 0.12 + i * (W * 0.66 / folds), v = 50 + 16 * Math.sin(i * 1.9) + 8 * Math.sin(i * 0.7);
      const cg = g.createLinearGradient(x, 0, x + W * 0.66 / folds, 0);
      cg.addColorStop(0, gray(v - 10)); cg.addColorStop(0.5, gray(v + 6)); cg.addColorStop(1, gray(v - 12));
      g.fillStyle = cg; g.fillRect(x, H * 0.04, W * 0.66 / folds + 1, H * 0.8);
    }
    g.fillStyle = gray(24); g.fillRect(W * 0.12, H * 0.02, W * 0.66, H * 0.035);          // curtain rail
    // roof liner and B-pillar with the door window beyond it (dark: night outside)
    const roof = g.createLinearGradient(0, 0, 0, H * 0.06); roof.addColorStop(0, gray(20)); roof.addColorStop(1, gray(44));
    g.fillStyle = roof; g.fillRect(0, 0, W, H * 0.05);
    g.fillStyle = gray(10); g.beginPath(); g.moveTo(W * 0.8, H * 0.06); g.lineTo(W, H * 0.03); g.lineTo(W, H * 0.62); g.lineTo(W * 0.83, H * 0.66); g.fill();
    const sl = (t * 0.35) % 1.6;                                                          // a streetlight sweeping past
    if (sl < 1) { const lx = W * (1.02 - sl * 0.25), lg = g.createRadialGradient(lx, H * 0.2, 0, lx, H * 0.2, W * 0.07); lg.addColorStop(0, "rgba(235,235,235,.75)"); lg.addColorStop(1, "rgba(235,235,235,0)"); g.save(); g.beginPath(); g.moveTo(W * 0.8, H * 0.06); g.lineTo(W, H * 0.03); g.lineTo(W, H * 0.62); g.lineTo(W * 0.83, H * 0.66); g.clip(); g.fillStyle = lg; g.fillRect(W * 0.7, 0, W * 0.3, H * 0.5); g.restore(); }
    g.fillStyle = gray(46); g.fillRect(W * 0.775, H * 0.04, W * 0.03, H * 0.7);
    g.fillStyle = gray(30); g.fillRect(0, H * 0.04, W * 0.12, H * 0.75);

    const hx = W * 0.47, hy = H * 0.4, hr = H * 0.19;           // head centre and size
    // seat back and headrest
    g.fillStyle = gray(26); g.beginPath(); g.roundRect(hx - W * 0.2, H * 0.36, W * 0.4, H * 0.8, W * 0.05); g.fill();
    const hrg = g.createLinearGradient(hx - hr * 1.1, 0, hx + hr * 1.1, 0); hrg.addColorStop(0, gray(22)); hrg.addColorStop(0.5, gray(42)); hrg.addColorStop(1, gray(20));
    g.fillStyle = hrg; g.beginPath(); g.roundRect(hx - hr * 1.05, hy - hr * 1.25, hr * 2.1, hr * 1.35, hr * 0.35); g.fill();

    // torso: shirt, collar, seatbelt
    const sx = hx + roll * hr * 0.5;
    const shirt = g.createLinearGradient(0, H * 0.62, 0, H); shirt.addColorStop(0, gray(118)); shirt.addColorStop(1, gray(70));
    g.fillStyle = shirt; g.beginPath(); g.moveTo(sx - W * 0.2, H); g.bezierCurveTo(sx - W * 0.21, H * 0.72, sx - W * 0.12, H * 0.64, sx - hr * 0.35, H * 0.63); g.lineTo(sx + hr * 0.35, H * 0.63); g.bezierCurveTo(sx + W * 0.12, H * 0.64, sx + W * 0.21, H * 0.72, sx + W * 0.2, H); g.fill();
    g.strokeStyle = gray(80); g.lineWidth = 1.2;                                          // fabric creases
    [[-0.12, 0.78, -0.06, 0.95], [0.1, 0.8, 0.05, 0.97], [-0.02, 0.74, 0.01, 0.9]].forEach(([a, b, c, d]) => { g.beginPath(); g.moveTo(sx + W * a, H * b); g.quadraticCurveTo(sx + W * (a + c) / 2 + 6, H * (b + d) / 2, sx + W * c, H * d); g.stroke(); });
    g.fillStyle = gray(150); g.beginPath(); g.moveTo(sx - hr * 0.42, H * 0.625); g.lineTo(sx, H * 0.76); g.lineTo(sx - hr * 0.1, H * 0.625); g.fill();   // collar
    g.beginPath(); g.moveTo(sx + hr * 0.42, H * 0.625); g.lineTo(sx, H * 0.76); g.lineTo(sx + hr * 0.1, H * 0.625); g.fill();
    g.fillStyle = gray(96); g.beginPath(); g.moveTo(sx - hr * 0.1, H * 0.63); g.lineTo(sx, H * 0.76); g.lineTo(sx + hr * 0.1, H * 0.63); g.fill();
    g.save(); g.translate(sx - W * 0.13, H * 0.64); g.rotate(0.62);                      // seatbelt, driver's right shoulder to left hip
    const belt = g.createLinearGradient(0, -hr * 0.17, 0, hr * 0.17); belt.addColorStop(0, gray(120)); belt.addColorStop(0.5, gray(168)); belt.addColorStop(1, gray(112));
    g.fillStyle = belt; g.fillRect(0, -hr * 0.16, W * 0.42, hr * 0.32);
    g.strokeStyle = gray(90); g.lineWidth = 1; g.setLineDash([3, 3]); g.strokeRect(2, -hr * 0.12, W * 0.42, hr * 0.24); g.setLineDash([]); g.restore();

    // neck
    const neck = g.createLinearGradient(hx - hr * 0.3, 0, hx + hr * 0.3, 0); neck.addColorStop(0, gray(95)); neck.addColorStop(0.5, gray(150)); neck.addColorStop(1, gray(92));
    g.fillStyle = neck; g.fillRect(hx - hr * 0.3 + roll * hr * 0.3, hy + hr * 0.55, hr * 0.6, hr * 0.62);
    g.fillStyle = "rgba(0,0,0,.28)"; g.beginPath(); g.ellipse(hx, hy + hr * 0.78 + pitch * hr * 0.3, hr * 0.34, hr * 0.12, 0, 0, Math.PI * 2); g.fill();

    // ── head (everything below moves with roll) ──
    const cy = Math.cos(yaw);
    const P = (bx, by) => [hx + yaw * hr * 0.42 + bx * hr * 0.78 * cy, hy + pitch * hr * 0.55 + by * hr * (1 - pitch * 0.2)];
    g.save(); g.translate(hx, hy + hr * 0.9); g.rotate(roll); g.translate(-hx, -(hy + hr * 0.9));

    // ears (the one on the side the head turns away from shows more)
    [-1, 1].forEach(s => {
      const vis = 1 + s * yaw * 1.6; if (vis < 0.25) return;
      const [ex, ey] = P(s * 1.0, 0.02);
      g.fillStyle = gray(128); g.beginPath(); g.ellipse(ex + s * hr * 0.04 * vis, ey, hr * 0.1 * vis, hr * 0.2, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = gray(90); g.lineWidth = 1.2; g.beginPath(); g.ellipse(ex + s * hr * 0.04 * vis, ey, hr * 0.05 * vis, hr * 0.12, 0, -1.2, 1.2); g.stroke();
    });
    // skull and skin: brightest at the centre, where the IR LED hits
    const [fcx, fcy] = P(0, 0);
    const skin = g.createRadialGradient(fcx - hr * 0.1, fcy - hr * 0.15, hr * 0.08, fcx, fcy, hr * 1.05);
    skin.addColorStop(0, gray(212)); skin.addColorStop(0.55, gray(172)); skin.addColorStop(1, gray(108));
    g.fillStyle = skin; g.beginPath(); g.ellipse(hx + yaw * hr * 0.14, hy + pitch * hr * 0.2, hr * 0.8, hr * 1.02, 0, 0, Math.PI * 2); g.fill();
    // jaw shadow and cheekbones
    const jaw = g.createLinearGradient(0, fcy + hr * 0.3, 0, fcy + hr * 1.05); jaw.addColorStop(0, "rgba(0,0,0,0)"); jaw.addColorStop(1, "rgba(0,0,0,.35)");
    g.fillStyle = jaw; g.beginPath(); g.ellipse(hx + yaw * hr * 0.14, hy + pitch * hr * 0.2, hr * 0.8, hr * 1.02, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = `rgba(0,0,0,${0.12 + Math.abs(yaw) * 0.25})`;                      // the side turning away falls into shadow
    g.beginPath(); g.ellipse(hx + yaw * hr * 0.14 - Math.sign(yaw || 1) * hr * 0.5, hy + pitch * hr * 0.2, hr * 0.32, hr * 0.95, 0, 0, Math.PI * 2); g.fill();
    // stubble on the jaw
    { const r = rngFrom(11); g.fillStyle = "rgba(40,40,40,.35)"; for (let i = 0; i < 220; i++) { const a = r() * Math.PI, d = 0.55 + r() * 0.42, [px, py] = P(Math.cos(a) * d * 0.9, 0.35 + Math.sin(a) * d * 0.6); g.fillRect(px, py, 1.2, 1.2); } }
    // hair: short, dark, with a side parting
    const [hcx, hcy] = P(0, -0.62);
    g.fillStyle = gray(24); g.beginPath(); g.ellipse(hx + yaw * hr * 0.1, hy - hr * 0.5 + pitch * hr * 0.15, hr * 0.86, hr * 0.62, 0, Math.PI * 1.02, Math.PI * 1.98); g.fill();
    g.beginPath(); g.moveTo(hx - hr * 0.84, hy - hr * 0.35); g.quadraticCurveTo(hcx - hr * 0.3, hcy + hr * 0.02, hcx + hr * 0.1, hcy - hr * 0.05); g.quadraticCurveTo(hcx + hr * 0.5, hcy + hr * 0.06, hx + hr * 0.84, hy - hr * 0.35); g.lineTo(hx + hr * 0.8, hy - hr * 0.7); g.lineTo(hx - hr * 0.8, hy - hr * 0.7); g.fill();
    { const r = rngFrom(3); g.strokeStyle = "rgba(90,90,90,.35)"; g.lineWidth = 0.8; for (let i = 0; i < 60; i++) { const a = Math.PI * (1.08 + r() * 0.84), x0 = hx + Math.cos(a) * hr * 0.7, y0 = hy - hr * 0.45 + Math.sin(a) * hr * 0.5; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + (r() - 0.5) * 6, y0 + 4 + r() * 5); g.stroke(); } }

    // brows
    const browLift = sleepy ? 0.03 : 0;
    [-1, 1].forEach(s => {
      const [a1, b1] = P(s * 0.12, -0.25 - browLift), [a2, b2] = P(s * 0.34, -0.33 - browLift), [a3, b3] = P(s * 0.55, -0.26 - browLift);
      g.strokeStyle = gray(40); g.lineWidth = hr * 0.075; g.lineCap = "round"; g.beginPath(); g.moveTo(a1, b1); g.quadraticCurveTo(a2, b2, a3, b3); g.stroke();
    });
    // eyes: socket shadow, white, iris, pupil, IR glint, eyelids and lashes
    const eyePts = {};
    [-1, 1].forEach(s => {
      const [ex, ey] = P(s * 0.33, -0.08);
      const ew = hr * 0.18 * (1 - s * yaw * 0.6), eh = hr * 0.085;
      const sock = g.createRadialGradient(ex, ey, 0, ex, ey, ew * 1.6); sock.addColorStop(0, "rgba(0,0,0,.22)"); sock.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = sock; g.beginPath(); g.ellipse(ex, ey, ew * 1.6, eh * 2.2, 0, 0, Math.PI * 2); g.fill();
      const open = Math.max(0, Math.min(1, eye)), top = ey - eh * open, bot = ey + eh * 0.55;
      eyePts[s] = { ex, ey, ew, eh, open };
      if (open > 0.08) {
        g.save(); g.beginPath(); g.moveTo(ex - ew, ey); g.quadraticCurveTo(ex, top - eh * 0.5 * open, ex + ew, ey); g.quadraticCurveTo(ex, bot + eh * 0.3, ex - ew, ey); g.closePath();
        g.fillStyle = gray(222); g.fill(); g.clip();
        const ix = ex + gazeX * ew * 0.45, iy = ey + gazeY * eh * 0.5, ir = eh * 1.05;
        g.fillStyle = gray(70); g.beginPath(); g.arc(ix, iy, ir, 0, Math.PI * 2); g.fill();
        g.fillStyle = gray(12); g.beginPath(); g.arc(ix, iy, ir * 0.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#fff"; g.beginPath(); g.arc(ix - ir * 0.28, iy - ir * 0.3, Math.max(1.2, ir * 0.22), 0, Math.PI * 2); g.fill();   // corneal glint
        g.restore();
        g.strokeStyle = gray(30); g.lineWidth = Math.max(1.4, hr * 0.03);
        g.beginPath(); g.moveTo(ex - ew * 1.05, ey + 1); g.quadraticCurveTo(ex, top - eh * 0.55 * open, ex + ew * 1.05, ey + 1); g.stroke();
        g.strokeStyle = gray(120); g.lineWidth = 1; g.beginPath(); g.moveTo(ex - ew * 0.9, ey - eh * 0.1 - eh * 1.25 * open); g.quadraticCurveTo(ex, top - eh * 1.2, ex + ew * 0.9, ey - eh * 0.1 - eh * 1.25 * open); g.stroke();   // lid crease
      } else {
        g.strokeStyle = gray(34); g.lineWidth = Math.max(1.6, hr * 0.035);
        g.beginPath(); g.moveTo(ex - ew, ey); g.quadraticCurveTo(ex, ey + eh * 0.45, ex + ew, ey); g.stroke();
        g.lineWidth = 1; for (let k = -3; k <= 3; k++) { const lx = ex + k * ew * 0.26; g.beginPath(); g.moveTo(lx, ey + eh * 0.25); g.lineTo(lx + k * 0.6, ey + eh * 0.6); g.stroke(); }
      }
    });
    // nose
    const [nb1, nb2] = P(0.02, -0.02), [nt1, nt2] = P(0.05, 0.27);
    g.strokeStyle = "rgba(60,60,60,.45)"; g.lineWidth = 1.4; g.beginPath(); g.moveTo(nb1 - yaw * hr * 0.1, nb2); g.quadraticCurveTo(nt1 - hr * 0.08 * Math.sign(yaw || 1), (nb2 + nt2) / 2, nt1 - hr * 0.05, nt2); g.stroke();
    g.fillStyle = "rgba(255,255,255,.35)"; g.beginPath(); g.ellipse(nt1, nt2 - hr * 0.03, hr * 0.06, hr * 0.04, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = gray(40); [-1, 1].forEach(s => { const [nx, ny] = P(s * 0.1, 0.33); g.beginPath(); g.ellipse(nx, ny, hr * 0.045, hr * 0.025, s * 0.4, 0, Math.PI * 2); g.fill(); });
    // moustache and mouth
    const [mx, my] = P(0.03, 0.5);
    g.fillStyle = gray(30); g.beginPath(); g.moveTo(mx - hr * 0.3 * cy, my - hr * 0.02); g.quadraticCurveTo(mx, my - hr * 0.16, mx + hr * 0.3 * cy, my - hr * 0.02); g.quadraticCurveTo(mx, my - hr * 0.06, mx - hr * 0.3 * cy, my - hr * 0.02); g.fill();
    const mo = mouth * hr * 0.24;
    if (mo > 1.5) {
      g.fillStyle = gray(22); g.beginPath(); g.ellipse(mx, my + hr * 0.06 + mo * 0.35, hr * 0.17 * cy, mo * 0.55 + 1, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = gray(190); g.fillRect(mx - hr * 0.1 * cy, my + hr * 0.06 + mo * 0.35 - mo * 0.5, hr * 0.2 * cy, Math.max(1, mo * 0.12));
    } else { g.strokeStyle = gray(70); g.lineWidth = 2; g.beginPath(); g.moveTo(mx - hr * 0.17 * cy, my + hr * 0.07); g.quadraticCurveTo(mx, my + hr * 0.1, mx + hr * 0.17 * cy, my + hr * 0.07); g.stroke(); }

    // landmark mesh, head-pose axes and gaze rays: the DMS model's view of the face
    const alarm = sleepy || phone, meshCol = alarm ? "rgba(248,113,113,.9)" : "rgba(34,211,238,.9)";
    if (o.mesh) {
      const pts = [];
      for (let i = 0; i <= 16; i++) { const a = Math.PI * (0.02 + 0.96 * i / 16); pts.push(P(-Math.cos(a) * 0.95, 0.05 + Math.sin(a) * 0.95)); }       // jaw
      const jawN = pts.length;
      [-1, 1].forEach(s => { for (let i = 0; i < 5; i++) pts.push(P(s * (0.12 + i * 0.11), -0.26 - Math.sin(i / 4 * Math.PI) * 0.07)); });   // brows
      for (let i = 0; i < 4; i++) pts.push(P(0.02 + i * 0.01, -0.02 + i * 0.09));      // nose bridge
      for (let i = -2; i <= 2; i++) pts.push(P(i * 0.06, 0.34));                          // nostrils
      [-1, 1].forEach(s => { const e = eyePts[s]; for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; pts.push([e.ex + Math.cos(a) * e.ew, e.ey + Math.sin(a) * e.eh * (Math.sin(a) < 0 ? Math.max(0.1, e.open) : 0.55)]); } });
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; pts.push([mx + Math.cos(a) * hr * 0.17 * cy, my + hr * 0.07 + Math.sin(a) * (hr * 0.04 + mo * 0.4)]); }  // lips
      g.strokeStyle = alarm ? "rgba(248,113,113,.55)" : "rgba(34,211,238,.5)"; g.lineWidth = 1;
      const seg = (a, b) => { g.beginPath(); for (let i = a; i < b; i++) { const [x, y] = pts[i]; i === a ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); };
      seg(0, jawN); seg(jawN, jawN + 5); seg(jawN + 5, jawN + 10); seg(jawN + 10, jawN + 14); seg(jawN + 14, jawN + 19);
      // triangulate a light web between jaw and features, as face-mesh models draw it
      for (let i = 0; i < jawN; i += 2) { const j = jawN + (i % 19); if (pts[j]) { g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[j][0], pts[j][1]); g.stroke(); } }
      g.fillStyle = meshCol; const ds = Math.max(2.2, hr * 0.022); pts.forEach(([x, y]) => g.fillRect(x - ds / 2, y - ds / 2, ds, ds));
      // head-pose axes from the nose tip
      const L = hr * 0.55;
      [[Math.cos(yaw) * L, Math.sin(roll) * L * 0.3, "#ef4444"], [Math.sin(roll) * L * 0.3, L * (0.7 + pitch), "#22c55e"], [-Math.sin(yaw) * L * 1.2, -L * 0.25 + pitch * L, "#3b82f6"]].forEach(([dx, dy, c]) => {
        g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); g.moveTo(nt1, nt2); g.lineTo(nt1 + dx, nt2 + dy); g.stroke();
      });
      // gaze rays
      [-1, 1].forEach(s => { const e = eyePts[s]; if (e.open < 0.08) return; g.strokeStyle = "rgba(250,204,21,.9)"; g.lineWidth = 1.6; g.beginPath(); g.moveTo(e.ex, e.ey); g.lineTo(e.ex + (gazeX - yaw * 0.8) * hr * 0.9, e.ey + (gazeY + pitch) * hr * 0.7 + hr * 0.05); g.stroke(); });
    }
    g.restore();   // end head roll

    // phone held to the ear with the right hand (image left)
    if (phone) {
      const [ex, ey] = P(-1.02, 0.05);
      const arm = g.createLinearGradient(W * 0.2, H, ex, ey); arm.addColorStop(0, gray(88)); arm.addColorStop(1, gray(120));
      g.fillStyle = arm; g.beginPath(); g.moveTo(W * 0.2, H); g.quadraticCurveTo(W * 0.22, H * 0.66, ex - hr * 0.12, ey + hr * 0.4); g.lineTo(ex + hr * 0.1, ey + hr * 0.46); g.quadraticCurveTo(W * 0.28, H * 0.72, W * 0.27, H); g.fill();
      g.save(); g.translate(ex - hr * 0.06, ey - hr * 0.02); g.rotate(-0.28);
      g.fillStyle = gray(140); g.beginPath(); g.ellipse(hr * 0.02, hr * 0.2, hr * 0.13, hr * 0.17, 0, 0, Math.PI * 2); g.fill();          // palm, behind the phone
      g.fillStyle = gray(22); g.beginPath(); g.roundRect(-hr * 0.12, -hr * 0.36, hr * 0.22, hr * 0.56, hr * 0.035); g.fill();   // phone
      g.strokeStyle = gray(120); g.lineWidth = 1.2; g.stroke();
      g.fillStyle = gray(60); g.fillRect(-hr * 0.09, -hr * 0.31, hr * 0.16, hr * 0.44);                                        // dim screen
      g.fillStyle = gray(150); for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(-hr * 0.13, -hr * 0.12 + k * hr * 0.1, hr * 0.045, hr * 0.035, 0, 0, Math.PI * 2); g.fill(); }   // fingertips over the edge
      g.beginPath(); g.ellipse(hr * 0.1, hr * 0.02, hr * 0.04, hr * 0.07, 0.3, 0, Math.PI * 2); g.fill();                    // thumb
      g.restore();
      box(g, ex - hr * 0.3, ey - hr * 0.5, hr * 0.55, hr * 1.0, RED, "PHONE", 0.89, o);
      if (o.heatmap) heat(g, ex, ey, hr * 0.8, "rgba(239,68,68,.4)");
    }

    // steering wheel and hands, close to the lens and out of focus
    g.save(); if ("filter" in g) g.filter = "blur(3px)";
    g.strokeStyle = gray(18); g.lineWidth = H * 0.06; g.beginPath(); g.ellipse(W * 0.47, H * 1.08, W * 0.25, H * 0.24, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
    g.fillStyle = gray(14); g.beginPath(); g.ellipse(W * 0.47, H * 1.05, W * 0.06, H * 0.08, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = gray(108);
    if (!phone) { g.beginPath(); g.ellipse(W * 0.3, H * 0.9, W * 0.024, H * 0.035, -0.6, 0, Math.PI * 2); g.fill(); }
    g.beginPath(); g.ellipse(W * 0.64, H * 0.9, W * 0.024, H * 0.035, 0.6, 0, Math.PI * 2); g.fill();
    g.restore();

    // IR illuminator: a bright pool on the face, dark corners; then sensor noise
    const ir = g.createRadialGradient(hx, hy, hr * 0.2, hx, hy, W * 0.62);
    ir.addColorStop(0, "rgba(255,255,255,.07)"); ir.addColorStop(0.45, "rgba(0,0,0,0)"); ir.addColorStop(1, "rgba(0,0,0,.7)");
    g.fillStyle = ir; g.fillRect(0, 0, W, H);
    sensorNoise(g, W, H, 0.16);

    // detections and the DMS read-out
    const ear = sleepy ? (eye > 0 ? 0.14 : 0.08) : (0.27 + 0.03 * eye);
    box(g, hx - hr * 1.0, hy - hr * 1.15, hr * 2.0, hr * 2.35, sleepy ? RED : phone ? AMBER : GREEN,
      sleepy ? "EYES CLOSED" : phone ? "GAZE OFF ROAD" : "DRIVER", 0.93, o);
    if (o.boxes) [-1, 1].forEach(s => { const e = eyePts[s]; if (!e) return; g.save(); g.translate(hx, hy + hr * 0.9); g.rotate(roll); g.translate(-hx, -(hy + hr * 0.9)); g.strokeStyle = sleepy ? RED : "rgba(16,185,129,.9)"; g.lineWidth = 1.2; g.strokeRect(e.ex - e.ew * 1.2, e.ey - e.eh * 1.6, e.ew * 2.4, e.eh * 3); g.restore(); });
    if (o.heatmap && sleepy) heat(g, hx, hy, hr * 1.4, "rgba(239,68,68,.35)");
    const fs = Math.max(9, Math.round(W / 64));
    g.font = `600 ${fs}px ui-monospace, Consolas, monospace`;
    const lines = [`EAR ${ear.toFixed(2)}   PERCLOS ${sleepy ? 84 : phone ? 12 : 4}%`, `HEAD P${(pitch * 57).toFixed(0).padStart(3, " ")}°  Y${(yaw * 57).toFixed(0).padStart(3, " ")}°  R${(roll * 57).toFixed(0).padStart(3, " ")}°`, `GAZE ${sleepy ? "EYES CLOSED" : phone ? "OFF ROAD" : Math.abs(yaw) > 0.25 ? "MIRROR" : "ROAD"}   IR 940nm`];
    const rx = W - fs * 18.5;
    g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(rx - fs * 0.5, H - fs * 4.6, fs * 18.2, fs * 4.1);
    lines.forEach((l, i) => { g.fillStyle = i === 0 && sleepy ? "#fca5a5" : "#cbd5e1"; g.fillText(l, rx, H - fs * 3.3 + i * fs * 1.25); });
    // PERCLOS bar
    const pb = sleepy ? 0.84 : phone ? 0.12 : 0.04;
    g.fillStyle = "rgba(255,255,255,.15)"; g.fillRect(rx, H - fs * 0.85, fs * 16, 3);
    g.fillStyle = pb > 0.3 ? RED : GREEN; g.fillRect(rx, H - fs * 0.85, fs * 16 * pb, 3);

    if (sleepy) banner(g, W, H, "rgba(220,38,38,.92)", "DRIVER DROWSINESS", "PERCLOS 84% · EYES CLOSED 3.2 s", t, 0.015);
    if (phone) banner(g, W, H, "rgba(217,119,6,.92)", "PHONE IN HAND", "GAZE OFF ROAD 4.6 s", t, 0.015);
  }

  // ── 360° surround: top view + rear camera, as AVM head units show it ──
  function surround(g, W, H, key, t, o) {
    const split = Math.round(W * 0.44);
    g.save(); g.beginPath(); g.rect(0, 0, split, H); g.clip(); topView(g, split, H, key, t, o); g.restore();
    g.save(); g.translate(split, 0); g.beginPath(); g.rect(0, 0, W - split, H); g.clip(); rearCam(g, W - split, H, key, t, o); g.restore();
    g.fillStyle = "#000"; g.fillRect(split - 1.5, 0, 3, H);
    const fs = Math.max(9, Math.round(W / 70));
    g.font = `700 ${fs}px ui-monospace, Consolas, monospace`;
    [["TOP VIEW · 4-CAM STITCH", -1], ["REAR · 190°", split + 8]].forEach(([s, x]) => { const tw = g.measureText(s).width + 10; if (x < 0) x = split - tw - 8; g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(x, H - fs - 12, tw, fs + 8); g.fillStyle = "#e2e8f0"; g.fillText(s, x + 5, H - 9); });
    // the warning sits over the rear pane so the danger zone in the top view stays visible
    g.save(); g.translate(split, 0);
    if (key === "forward_collision") banner(g, W - split, H, "rgba(220,38,38,.92)", "GAP CLOSING AHEAD", "FRONT ZONE BREACH · 4.2 m", t, 0.06);
    if (key === "lane_departure") banner(g, W - split, H, "rgba(217,119,6,.92)", "LANE DRIFT LEFT", "−0.62 m · NO INDICATOR", t, 0.06);
    g.restore();
  }

  // top-down vehicle, as the AVM stitching sees it: body, glass, roof, lamps, shadow
  function topVehicle(g, x, y, w, l, col, kind, t) {
    g.save(); g.translate(x, y);
    g.fillStyle = "rgba(0,0,0,.45)"; g.beginPath(); g.roundRect(-w / 2 + 3, -l / 2 + 5, w, l, w * 0.25); g.fill();   // shadow
    if (kind === "bike") {
      g.fillStyle = gray(20); g.fillRect(-w * 0.12, -l / 2, w * 0.24, l);
      g.fillStyle = col; g.beginPath(); g.ellipse(0, 0, w * 0.32, l * 0.28, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = gray(30); g.beginPath(); g.arc(0, -l * 0.05, w * 0.22, 0, Math.PI * 2); g.fill();          // helmet
      g.fillStyle = "#fef3c7"; g.fillRect(-w * 0.08, -l / 2, w * 0.16, 2); g.restore(); return;
    }
    const body = g.createLinearGradient(-w / 2, 0, w / 2, 0); body.addColorStop(0, shade(col, -40)); body.addColorStop(0.5, shade(col, 25)); body.addColorStop(1, shade(col, -40));
    g.fillStyle = body; g.beginPath(); g.roundRect(-w / 2, -l / 2, w, l, kind === "car" ? w * 0.3 : w * 0.12); g.fill();
    g.fillStyle = "rgba(10,14,22,.85)";
    if (kind === "car") {
      g.beginPath(); g.moveTo(-w * 0.4, -l * 0.2); g.lineTo(w * 0.4, -l * 0.2); g.lineTo(w * 0.33, -l * 0.02); g.lineTo(-w * 0.33, -l * 0.02); g.fill();   // windscreen
      g.beginPath(); g.moveTo(-w * 0.36, l * 0.3); g.lineTo(w * 0.36, l * 0.3); g.lineTo(w * 0.3, l * 0.2); g.lineTo(-w * 0.3, l * 0.2); g.fill();         // rear glass
      g.fillStyle = shade(col, 35); g.fillRect(-w * 0.32, -l * 0.02, w * 0.64, l * 0.22);                                                                      // roof
      g.fillStyle = shade(col, -30); g.fillRect(-w * 0.62, -l * 0.17, w * 0.14, l * 0.06); g.fillRect(w * 0.48, -l * 0.17, w * 0.14, l * 0.06);            // mirrors
    } else {
      g.fillRect(-w * 0.44, -l * 0.47, w * 0.88, l * 0.06);                                                                                                    // bus/truck windscreen
      g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = 1; for (let k = 1; k < 8; k++) { g.beginPath(); g.moveTo(-w * 0.45, -l / 2 + k * l / 8); g.lineTo(w * 0.45, -l / 2 + k * l / 8); g.stroke(); }
      g.fillStyle = "rgba(255,255,255,.15)"; g.fillRect(-w * 0.2, -l * 0.3, w * 0.4, l * 0.12);                                                            // roof hatch / AC
    }
    // lamps: headlights ahead (up), tail lights glowing red at night
    g.fillStyle = "#fef9c3"; g.fillRect(-w * 0.42, -l / 2, w * 0.18, 2.5); g.fillRect(w * 0.24, -l / 2, w * 0.18, 2.5);
    g.shadowColor = "#ef4444"; g.shadowBlur = 8; g.fillStyle = "#ef4444"; g.fillRect(-w * 0.44, l / 2 - 3, w * 0.2, 3); g.fillRect(w * 0.24, l / 2 - 3, w * 0.2, 3);
    g.restore();
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16), c = v => Math.max(0, Math.min(255, v + amt));
    return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
  }

  function topView(g, w, h, key, t, o) {
    const cx = w / 2, L = w * 0.3;                        // lane width in px
    const speed = key === "forward_collision" ? 0.5 : 1;  // ground scroll speed (slower when braking)
    const scroll = (t * h * 0.9 * speed);
    // ground: asphalt texture scrolling toward the rear
    g.save(); const pat = g.createPattern(asphaltTile(), "repeat"); g.translate(0, scroll % 128); g.fillStyle = pat; g.fillRect(0, -128, w, h + 256); g.restore();
    // shoulders beyond the edge lines
    g.fillStyle = "rgba(60,52,40,.55)"; g.fillRect(0, 0, cx - 1.5 * L, h); g.fillRect(cx + 1.5 * L, 0, w, h);
    const egoOff = key === "lane_departure" ? -L * (0.3 + 0.05 * Math.sin(t)) : Math.sin(t * 0.4) * L * 0.03;
    const ex = cx + egoOff;
    // lane lines: solid edges, dashed dividers moving with the ground
    g.fillStyle = "#e8e8e0"; g.fillRect(cx - 1.5 * L - 2, 0, 4, h); g.fillRect(cx + 1.5 * L - 2, 0, 4, h);
    const dash = h * 0.16, gap = h * 0.22, off = scroll % (dash + gap);
    [-0.5, 0.5].forEach(k => {
      const hot = key === "lane_departure" && k === -0.5 && o.boxes;
      g.fillStyle = hot ? RED : "#f1f1ea"; if (hot) { g.shadowColor = RED; g.shadowBlur = 10; }
      for (let y = -dash + off - (dash + gap); y < h; y += dash + gap) g.fillRect(cx + k * L - 2.5, y, 5, dash);
      g.shadowBlur = 0;
    });
    // other traffic (top of frame = ahead)
    const truckGap = key === "forward_collision" ? h * 0.07 : h * 0.2;
    const egoLen = h * 0.6, egoW = L * 0.7, egoTop = h / 2 - egoLen / 2;
    const others = [
      { x: cx - L, y: h * 1.25 - ((t * 0.075) % 1.7) * h, w: L * 0.55, l: h * 0.17, c: "#2563eb", k: "car", lbl: "CAR" },
      { x: cx + L, y: ((t * 0.045 + 0.2) % 1.6) * h - h * 0.3, w: L * 0.2, l: h * 0.07, c: "#d97706", k: "bike", lbl: "MOTORBIKE" },
      { x: cx, y: egoTop - truckGap - h * 0.14, w: L * 0.72, l: h * 0.28, c: "#cbd5e1", k: "truck", lbl: "TRUCK" },
      { x: cx + L, y: h * 1.4 - ((t * 0.05 + 0.6) % 1.9) * h, w: L * 0.62, l: h * 0.34, c: "#16a34a", k: "bus", lbl: "BUS" },
    ];
    others.forEach(v => {
      // wide-angle stitching stretches things the further they are from the car
      const d = Math.hypot(v.x - cx, v.y - h / 2) / (h * 0.6), s = 1 + 0.3 * d * d;
      g.save(); g.translate(v.x, v.y); g.scale(1 + 0.08 * d, s); if (d > 0.9 && "filter" in g) g.filter = `blur(${Math.min(2, (d - 0.9) * 3).toFixed(1)}px)`;
      topVehicle(g, 0, 0, v.w, v.l, v.c, v.k, t); g.restore();
      // gap to the truck in metres (a lane is ~3.5 m): sideways if alongside, else ahead/behind
      const along = Math.abs(v.y - h / 2) - egoLen / 2 - v.l * s / 2, beside = Math.abs(v.x - ex) - egoW / 2 - v.w / 2;
      const m = Math.max(0.4, (along > 0 ? Math.hypot(along, Math.max(0, beside)) : Math.max(0, beside)) / L * 3.5);
      const hot = key === "forward_collision" && v.k === "truck";
      box(g, v.x - v.w * 0.6, v.y - v.l * s / 2 - 3, v.w * 1.2, v.l * s + 6, hot ? RED : CYAN, `${v.lbl} ${m.toFixed(1)}m`, 0.9, o);
    });
    // danger zone ahead in a collision
    if (key === "forward_collision") { g.fillStyle = "rgba(239,68,68,.28)"; g.fillRect(ex - egoW * 0.7, egoTop - truckGap, egoW * 1.4, truckGap); }
    // night: only the area lit by the truck's own lamps is bright
    const lit = g.createRadialGradient(ex, h / 2, h * 0.2, ex, h / 2, h * 0.85);
    lit.addColorStop(0, "rgba(0,0,0,0)"); lit.addColorStop(1, "rgba(0,0,8,.62)"); g.fillStyle = lit; g.fillRect(0, 0, w, h);
    // stitch seams: the four cameras meet on the diagonals, each with its own exposure
    const c1 = [ex - egoW / 2, egoTop], c2 = [ex + egoW / 2, egoTop], c3 = [ex + egoW / 2, egoTop + egoLen], c4 = [ex - egoW / 2, egoTop + egoLen];
    [[c1, [0, 0], [w, 0], c2, "rgba(255,255,255,.035)"], [c4, [0, h], [w, h], c3, "rgba(0,0,30,.08)"], [c1, [0, 0], [0, h], c4, "rgba(255,200,120,.03)"]].forEach(([a, b, c, d, f]) => { g.fillStyle = f; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.lineTo(...c); g.lineTo(...d); g.fill(); });
    g.strokeStyle = "rgba(255,255,255,.1)"; g.lineWidth = 1; [[c1, [0, 0]], [c2, [w, 0]], [c3, [w, h]], [c4, [0, h]]].forEach(([a, b]) => { g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); });
    // distance guides around the truck
    if (o.mesh) [[0.3, "rgba(239,68,68,.8)"], [1, "rgba(250,204,21,.7)"], [2, "rgba(34,197,94,.55)"]].forEach(([m, c]) => {
      const p = m * h * 0.05, x0 = ex - egoW / 2 - p, y0 = egoTop - p, x1 = ex + egoW / 2 + p, y1 = egoTop + egoLen + p, k = egoW * 0.35;
      g.strokeStyle = c; g.lineWidth = 2;
      [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]].forEach(([px, py, sx, sy]) => { g.beginPath(); g.moveTo(px, py + sy * k); g.lineTo(px, py); g.lineTo(px + sx * k, py); g.stroke(); });
    });
    // ego truck overlay: cab ahead, 32 ft container behind
    g.save(); g.translate(ex, h / 2);
    g.fillStyle = "rgba(0,0,0,.5)"; g.beginPath(); g.roundRect(-egoW / 2 + 4, -egoLen / 2 + 6, egoW, egoLen, 6); g.fill();
    const cabL = egoLen * 0.2, cabG = g.createLinearGradient(-egoW / 2, 0, egoW / 2, 0);
    cabG.addColorStop(0, "#b8bec8"); cabG.addColorStop(0.5, "#f1f5f9"); cabG.addColorStop(1, "#b8bec8");
    g.fillStyle = cabG; g.beginPath(); g.roundRect(-egoW * 0.46, -egoLen / 2, egoW * 0.92, cabL, [egoW * 0.18, egoW * 0.18, 3, 3]); g.fill();
    g.fillStyle = "#0f172a"; g.beginPath(); g.moveTo(-egoW * 0.4, -egoLen / 2 + cabL * 0.12); g.lineTo(egoW * 0.4, -egoLen / 2 + cabL * 0.12); g.lineTo(egoW * 0.36, -egoLen / 2 + cabL * 0.36); g.lineTo(-egoW * 0.36, -egoLen / 2 + cabL * 0.36); g.fill();
    g.fillStyle = "#94a3b8"; g.fillRect(-egoW * 0.22, -egoLen / 2 + cabL * 0.5, egoW * 0.44, cabL * 0.3);          // roof deflector
    g.fillStyle = "#334155"; g.fillRect(-egoW * 0.62, -egoLen / 2 + cabL * 0.2, egoW * 0.14, cabL * 0.14); g.fillRect(egoW * 0.48, -egoLen / 2 + cabL * 0.2, egoW * 0.14, cabL * 0.14);   // mirrors
    const boxG = g.createLinearGradient(-egoW / 2, 0, egoW / 2, 0); boxG.addColorStop(0, "#8b95a5"); boxG.addColorStop(0.5, "#d9dee6"); boxG.addColorStop(1, "#8b95a5");
    g.fillStyle = boxG; g.fillRect(-egoW / 2, -egoLen / 2 + cabL + egoLen * 0.02, egoW, egoLen - cabL - egoLen * 0.02);
    g.strokeStyle = "rgba(51,65,85,.55)"; g.lineWidth = 1; for (let k = 1; k < 14; k++) { const y = -egoLen / 2 + cabL + egoLen * 0.02 + k * (egoLen - cabL) / 14; g.beginPath(); g.moveTo(-egoW / 2 + 2, y); g.lineTo(egoW / 2 - 2, y); g.stroke(); }
    g.fillStyle = "#ef4444"; g.fillRect(-egoW / 2, egoLen / 2 - 3, egoW * 0.18, 3); g.fillRect(egoW / 2 - egoW * 0.18, egoLen / 2 - 3, egoW * 0.18, 3);
    g.restore();
    sensorNoise(g, w, h, 0.1);
  }

  function rearCam(g, w, h, key, t, o) {
    const hz = h * 0.4, vx = w / 2;
    // night sky with a faint horizon glow, dark verges
    const sky = g.createLinearGradient(0, 0, 0, hz); sky.addColorStop(0, "#04060c"); sky.addColorStop(1, "#1a2235");
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    // barrel distortion: the horizon bows upward in the middle
    g.fillStyle = "#0b0f0c"; g.beginPath(); g.moveTo(0, hz + h * 0.06); g.quadraticCurveTo(vx, hz - h * 0.05, w, hz + h * 0.06); g.lineTo(w, h); g.lineTo(0, h); g.fill();
    // road, bowed outward near the lens
    const road = g.createLinearGradient(0, hz, 0, h); road.addColorStop(0, "#1c1f26"); road.addColorStop(1, "#4b3a3a");   // lit red by the tail lamps
    g.fillStyle = road; g.beginPath(); g.moveTo(vx - w * 0.04, hz); g.lineTo(vx + w * 0.04, hz); g.quadraticCurveTo(vx + w * 0.62, h * 0.72, w * 1.1, h); g.lineTo(-w * 0.1, h); g.quadraticCurveTo(vx - w * 0.62, h * 0.72, vx - w * 0.04, hz); g.fill();
    // lane dashes receding toward the horizon (we are driving away from them)
    const lane = (s, p) => { const k = p * p; return [vx + s * (w * 0.04 + k * w * 0.62) + s * Math.sin(p * Math.PI) * w * 0.05, hz + k * (h - hz)]; };
    [-0.55, 0.55].forEach(s => {
      g.strokeStyle = "rgba(235,235,225,.85)"; g.lineWidth = 3;
      for (let i = 0; i < 7; i++) {
        const p0 = 1 - ((t * 0.5 + i / 7) % 1), p1 = Math.max(0, p0 - 0.06);
        const [x0, y0] = lane(s, p0), [x1, y1] = lane(s, p1);
        g.lineWidth = 1 + p0 * 4; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
    });
    // following car: headlights with bloom
    const fp = 0.3 + 0.04 * Math.sin(t * 0.5), [fx, fy] = lane(0, fp), fw = w * (0.04 + fp * 0.3);
    g.fillStyle = "#11141b"; g.beginPath(); g.roundRect(fx - fw / 2, fy - fw * 0.55, fw, fw * 0.6, fw * 0.1); g.fill();
    [-0.33, 0.33].forEach(s => { const lx = fx + s * fw, ly = fy - fw * 0.2, b = g.createRadialGradient(lx, ly, 0, lx, ly, fw * 0.9); b.addColorStop(0, "rgba(255,255,240,.95)"); b.addColorStop(0.15, "rgba(255,250,220,.55)"); b.addColorStop(1, "rgba(255,250,220,0)"); g.save(); g.globalCompositeOperation = "lighter"; g.fillStyle = b; g.fillRect(lx - fw, ly - fw, fw * 2, fw * 2); g.restore(); });
    box(g, fx - fw * 0.65, fy - fw * 0.75, fw * 1.3, fw * 0.9, CYAN, `CAR ${(8 + (1 - fp) * 30).toFixed(0)}m`, 0.88, o);
    // parking / reversing guide lines, bowed with the lens
    if (o.mesh) [[0.93, "rgba(239,68,68,.85)"], [0.8, "rgba(250,204,21,.8)"], [0.68, "rgba(34,197,94,.7)"]].forEach(([p, c], i, arr) => {
      const [ax, ay] = lane(-0.42, p), [bx, by] = lane(0.42, p);
      g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(vx, ay + h * 0.03, bx, by); g.stroke();
      const nx = arr[i + 1] ? arr[i + 1][0] : 0.56, [cx2, cy2] = lane(-0.42, nx), [dx2, dy2] = lane(0.42, nx);
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(cx2, cy2); g.moveTo(bx, by); g.lineTo(dx2, dy2); g.stroke();
    });
    // our own rear under-run guard with red/white reflective tape, at the bottom edge
    g.fillStyle = "#161616"; g.beginPath(); g.moveTo(0, h * 0.9); g.quadraticCurveTo(vx, h * 0.84, w, h * 0.9); g.lineTo(w, h); g.lineTo(0, h); g.fill();
    const n = 14; for (let i = 0; i < n; i++) { const x = i * w / n; g.fillStyle = i % 2 ? "#e5e7eb" : "#dc2626"; g.beginPath(); g.moveTo(x, h * 0.915 - Math.sin(i / n * Math.PI) * h * 0.035); g.lineTo(x + w / n, h * 0.915 - Math.sin((i + 1) / n * Math.PI) * h * 0.035); g.lineTo(x + w / n - 6, h * 0.95 - Math.sin((i + 1) / n * Math.PI) * h * 0.035); g.lineTo(x - 6, h * 0.95 - Math.sin(i / n * Math.PI) * h * 0.035); g.fill(); }
    // fisheye: dark rounded corners from the lens circle
    const fe = g.createRadialGradient(vx, h * 0.5, h * 0.45, vx, h * 0.5, w * 0.72);
    fe.addColorStop(0, "rgba(0,0,0,0)"); fe.addColorStop(0.75, "rgba(0,0,0,.35)"); fe.addColorStop(1, "rgba(0,0,0,.95)");
    g.fillStyle = fe; g.fillRect(0, 0, w, h);
    sensorNoise(g, w, h, 0.14);
  }

  // ── fuel tank cam ────────────────────────────────────────────────────
  function tank(g, W, H, key, t, o) {
    const night = g.createLinearGradient(0, 0, 0, H); night.addColorStop(0, "#070b14"); night.addColorStop(1, "#141b26");
    g.fillStyle = night; g.fillRect(0, 0, W, H);
    g.fillStyle = "#1f2633"; g.fillRect(0, H * 0.8, W, H * 0.2);
    // chassis rail and tank
    g.fillStyle = "#0f141d"; g.fillRect(0, H * 0.22, W, H * 0.08);
    const tx = W * 0.18, ty = H * 0.34, tw = W * 0.58, th = H * 0.36;
    const metal = g.createLinearGradient(0, ty, 0, ty + th);
    metal.addColorStop(0, "#9aa4b2"); metal.addColorStop(0.35, "#dfe4ea"); metal.addColorStop(1, "#4b5563");
    g.fillStyle = metal; g.beginPath(); g.roundRect(tx, ty, tw, th, th * 0.45); g.fill();
    g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = 3;
    [0.3, 0.7].forEach(p => { g.beginPath(); g.moveTo(tx + tw * p, ty - 4); g.lineTo(tx + tw * p, ty + th + 4); g.stroke(); });
    // filler cap
    const cx = tx + tw * 0.82, cy = ty + th * 0.08;
    g.fillStyle = "#374151"; g.beginPath(); g.arc(cx, cy, th * 0.12, 0, Math.PI * 2); g.fill();
    g.fillStyle = key === "fuel_tamper" ? "#6b7280" : "#111827"; g.beginPath(); g.arc(cx, cy, th * 0.08, 0, Math.PI * 2); g.fill();
    // level sensor readout
    const base = 68, level = key === "fuel_tamper" ? base - Math.min(12, (t % 20) * 0.9) : base;
    g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(tx + tw * 0.05, ty + th * 0.25, tw * 0.26, th * 0.5);
    g.fillStyle = key === "fuel_tamper" ? "#f87171" : "#34d399"; g.font = `700 ${Math.round(th * 0.16)}px ui-monospace, Consolas, monospace`;
    g.fillText(level.toFixed(1) + "%", tx + tw * 0.07, ty + th * 0.52);
    g.fillStyle = "#94a3b8"; g.font = `600 ${Math.round(th * 0.08)}px ui-monospace, Consolas, monospace`; g.fillText("LEVEL SENSOR", tx + tw * 0.07, ty + th * 0.66);
    if (key === "fuel_tamper") {
      // hose from the cap down to a canister, and a crouched figure
      g.strokeStyle = "#16a34a"; g.lineWidth = th * 0.05; g.lineCap = "round";
      g.beginPath(); g.moveTo(cx, cy); g.bezierCurveTo(cx + W * 0.08, cy - H * 0.05, cx + W * 0.1, H * 0.62, W * 0.88, H * 0.7); g.stroke();
      g.fillStyle = "#b91c1c"; g.fillRect(W * 0.84, H * 0.66, W * 0.1, H * 0.16);
      g.fillStyle = "#7f1d1d"; g.fillRect(W * 0.86, H * 0.62, W * 0.04, H * 0.05);
      g.fillStyle = "#0b0f16"; g.beginPath(); g.ellipse(W * 0.93, H * 0.46, W * 0.035, H * 0.06, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(W * 0.92, H * 0.64, W * 0.05, H * 0.15, 0.2, 0, Math.PI * 2); g.fill();
      box(g, cx - W * 0.03, cy - H * 0.06, W * 0.2, H * 0.84 - cy, RED, "SIPHON HOSE + CANISTER", 0.96, o);
      if (o.heatmap) heat(g, W * 0.88, H * 0.64, W * 0.14, "rgba(239,68,68,.45)");
      banner(g, W, H, "rgba(220,38,38,.92)", "FUEL SIPHONING", "−24 L IN 3 MIN · ENGINE OFF", t);
    } else {
      box(g, cx - th * 0.16, cy - th * 0.16, th * 0.32, th * 0.32, GREEN, "CAP SEALED", 0.93, o);
    }
    vignette(g, W, H); grain(g, W, H, t, 1.2);
  }

  function rngFrom(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

  const DRAW = { front, cabin, surround, tank };
  function draw(g, W, H, cam, key, t, opts) {
    const o = Object.assign({ boxes: true, mesh: true, heatmap: false, minConf: 0.5 }, opts || {});
    // a scenario shows on its own camera; the other cameras stay nominal, except the
    // surround view, which also shows road events
    const k = SCENARIOS[key] ? key : "nominal";
    const shown = SCENARIOS[k].cam === cam || (cam === "surround" && (k === "forward_collision" || k === "lane_departure")) ? k : "nominal";
    g.save(); (DRAW[cam] || front)(g, W, H, shown, t, o); g.restore();
    return shown !== "nominal";
  }

  window.FWVision = { draw, SCENARIOS, CAMS };
})();
