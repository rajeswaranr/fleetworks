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
  function banner(g, W, H, color, title, sub, t) {
    const pulse = 0.82 + 0.18 * Math.sin(t * 8);
    const bw = W * 0.62, bh = H * 0.13, bx = (W - bw) / 2, by = H * 0.1;
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

  // ── cabin driver monitor (near-IR look) ─────────────────────────────
  function cabin(g, W, H, key, t, o) {
    g.fillStyle = "#0b120f"; g.fillRect(0, 0, W, H);
    // cab frame, windows, seat
    g.fillStyle = "#101a15"; g.fillRect(0, 0, W, H * 0.1);
    g.fillStyle = "#16241d"; g.beginPath(); g.moveTo(W * 0.05, H * 0.12); g.lineTo(W * 0.3, H * 0.12); g.lineTo(W * 0.24, H * 0.62); g.lineTo(W * 0.02, H * 0.62); g.fill();
    g.beginPath(); g.moveTo(W * 0.95, H * 0.12); g.lineTo(W * 0.7, H * 0.12); g.lineTo(W * 0.76, H * 0.62); g.lineTo(W * 0.98, H * 0.62); g.fill();
    g.fillStyle = "#18251f"; g.fillRect(W * 0.33, H * 0.2, W * 0.34, H * 0.8);
    const nod = key === "fatigue" ? Math.max(0, Math.sin(t * 1.4)) * 0.16 : 0.02 * Math.sin(t * 0.8);
    const turn = key === "phone_use" ? 0.12 : 0;
    const hx = W * (0.5 + turn * 0.25), hy = H * (0.42 + nod * 0.5), hr = H * 0.17;
    // shoulders and torso
    g.fillStyle = "#2b3a33"; g.beginPath(); g.ellipse(W * 0.5, H * 1.02, W * 0.24, H * 0.36, 0, Math.PI, 0); g.fill();
    g.fillStyle = "#3a4b43"; g.fillRect(hx - hr * 0.3, hy + hr * 0.8, hr * 0.6, hr * 0.5);
    // head
    g.save(); g.translate(hx, hy); g.rotate(nod * 1.2 + turn * 0.4);
    const skin = g.createRadialGradient(-hr * 0.2, -hr * 0.3, hr * 0.1, 0, 0, hr * 1.1);
    skin.addColorStop(0, "#9fb3a6"); skin.addColorStop(1, "#4d6158");
    g.fillStyle = skin; g.beginPath(); g.ellipse(0, 0, hr * 0.78, hr, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#1c2722"; g.beginPath(); g.ellipse(0, -hr * 0.62, hr * 0.8, hr * 0.46, 0, Math.PI, 0); g.fill();
    // eyes
    const closed = key === "fatigue" && Math.sin(t * 1.4) > -0.2;
    const blink = !closed && (t % 4) < 0.12;
    g.strokeStyle = "#0e1512"; g.fillStyle = "#0e1512"; g.lineWidth = Math.max(1.5, hr * 0.05);
    [-1, 1].forEach(s => {
      const ex = s * hr * 0.32, ey = -hr * 0.08;
      if (closed || blink) { g.beginPath(); g.moveTo(ex - hr * 0.13, ey); g.quadraticCurveTo(ex, ey + hr * 0.06, ex + hr * 0.13, ey); g.stroke(); }
      else { g.beginPath(); g.ellipse(ex, ey, hr * 0.13, hr * 0.07, 0, 0, Math.PI * 2); g.fillStyle = "#dfe8e2"; g.fill(); g.beginPath(); g.arc(ex + turn * hr * 0.3, ey, hr * 0.05, 0, Math.PI * 2); g.fillStyle = "#0e1512"; g.fill(); }
    });
    g.beginPath(); g.moveTo(0, hr * 0.05); g.lineTo(-hr * 0.06, hr * 0.28); g.lineTo(hr * 0.05, hr * 0.3); g.stroke();
    g.beginPath(); g.moveTo(-hr * 0.2, hr * 0.5); g.quadraticCurveTo(0, hr * (closed ? 0.52 : 0.58), hr * 0.2, hr * 0.5); g.stroke();
    // face mesh landmarks
    if (o.mesh) {
      const alarm = key === "fatigue";
      g.fillStyle = alarm ? "rgba(239,68,68,.9)" : "rgba(34,211,238,.85)";
      const r = rngFrom(7);
      for (let i = 0; i < 70; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r());
        g.fillRect(Math.cos(a) * d * hr * 0.7, Math.sin(a) * d * hr * 0.9, 1.6, 1.6);
      }
      g.strokeStyle = alarm ? "rgba(239,68,68,.35)" : "rgba(34,211,238,.3)"; g.lineWidth = 0.8;
      g.beginPath(); g.ellipse(0, 0, hr * 0.72, hr * 0.94, 0, 0, Math.PI * 2); g.stroke();
      [-1, 1].forEach(s => { g.beginPath(); g.ellipse(s * hr * 0.32, -hr * 0.08, hr * 0.17, hr * 0.1, 0, 0, Math.PI * 2); g.stroke(); });
    }
    g.restore();
    // phone in hand at the ear
    if (key === "phone_use") {
      const px = hx + hr * 0.62, py = hy - hr * 0.05;
      g.fillStyle = "#3a4b43"; g.beginPath(); g.ellipse(px + hr * 0.1, py + hr * 0.55, hr * 0.16, hr * 0.5, -0.3, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#050807"; g.fillRect(px - hr * 0.06, py - hr * 0.28, hr * 0.26, hr * 0.5);
      g.fillStyle = "rgba(125,211,252,.55)"; g.fillRect(px - hr * 0.03, py - hr * 0.24, hr * 0.2, hr * 0.4);
      box(g, px - hr * 0.14, py - hr * 0.36, hr * 0.42, hr * 0.66, RED, "PHONE", 0.89, o);
      if (o.heatmap) heat(g, px, py, hr * 0.8, "rgba(239,68,68,.4)");
    }
    // steering wheel
    g.strokeStyle = "#0a0f0c"; g.lineWidth = H * 0.05; g.beginPath(); g.ellipse(W * 0.5, H * 1.02, W * 0.2, H * 0.2, 0, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
    const alarm = key === "fatigue";
    const ear = key === "fatigue" ? "0.11" : (0.29 + 0.02 * Math.sin(t)).toFixed(2);
    box(g, hx - hr * 0.95, hy - hr * 1.2, hr * 1.9, hr * 2.4, alarm ? RED : key === "phone_use" ? AMBER : GREEN,
      alarm ? "EYES CLOSED EAR 0.11" : key === "phone_use" ? "GAZE OFF ROAD 4.6s" : `DRIVER EAR ${ear}`, 0.92, o);
    if (o.heatmap && alarm) heat(g, hx, hy, hr * 1.4, "rgba(239,68,68,.35)");
    if (key === "fatigue") banner(g, W, H, "rgba(220,38,38,.92)", "DRIVER DROWSINESS", "PERCLOS 84% · EYES CLOSED 3.2 s", t);
    if (key === "phone_use") banner(g, W, H, "rgba(217,119,6,.92)", "PHONE IN HAND", "GAZE OFF ROAD 4.6 s", t);
    // IR tint
    g.fillStyle = "rgba(20,60,40,.18)"; g.fillRect(0, 0, W, H);
    vignette(g, W, H); grain(g, W, H, t, 1.4);
  }

  // ── 360° surround (top-down composite) ──────────────────────────────
  function surround(g, W, H, key, t, o) {
    g.fillStyle = "#11161f"; g.fillRect(0, 0, W, H);
    const laneW = W * 0.16, shift = key === "lane_departure" ? -laneW * 0.35 : 0;
    g.fillStyle = "#1b2130"; g.fillRect(W * 0.18, 0, W * 0.64, H);
    g.fillStyle = "#e5e7eb";
    for (const lx of [W * 0.18 + laneW, W * 0.18 + laneW * 2, W * 0.18 + laneW * 3]) {
      for (let y = -H * 0.2 + ((t * H * 0.6) % (H * 0.2)); y < H; y += H * 0.2) g.fillRect(lx - 1.5, y, 3, H * 0.1);
    }
    g.fillStyle = "#f5c518"; g.fillRect(W * 0.18, 0, 3, H); g.fillRect(W * 0.82 - 3, 0, 3, H);
    // ego truck: cab + trailer
    const tx = W * 0.18 + laneW * 1.5 + shift, tw = laneW * 0.6;
    g.fillStyle = "#e2e8f0"; g.fillRect(tx - tw / 2, H * 0.22, tw, H * 0.12);
    g.fillStyle = "#94a3b8"; g.fillRect(tx - tw / 2, H * 0.35, tw, H * 0.5);
    g.fillStyle = "#1e293b"; g.fillRect(tx - tw * 0.38, H * 0.235, tw * 0.76, H * 0.04);
    // proximity zones
    if (o.mesh) {
      g.strokeStyle = key === "forward_collision" ? RED : "rgba(16,185,129,.7)"; g.lineWidth = 2; g.setLineDash([6, 5]);
      g.strokeRect(tx - tw / 2 - W * 0.04, H * 0.1, tw + W * 0.08, H * 0.82); g.setLineDash([]);
    }
    // other vehicles
    const cars = [
      { x: W * 0.18 + laneW * 0.5, y: ((t * 0.12) % 1.3) * H - H * 0.15, c: "#60a5fa", l: "CAR" },
      { x: W * 0.18 + laneW * 2.5, y: H - ((t * 0.08 + 0.4) % 1.3) * H, c: "#fbbf24", l: "BUS" },
      { x: W * 0.18 + laneW * 1.5, y: key === "forward_collision" ? H * 0.06 : -H * 0.02, c: "#a78bfa", l: "TRUCK" },
    ];
    cars.forEach(v => {
      const vw = laneW * 0.5, vh = v.l === "CAR" ? H * 0.12 : H * 0.2;
      g.fillStyle = v.c; g.fillRect(v.x - vw / 2, v.y, vw, vh);
      g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(v.x - vw * 0.35, v.y + vh * 0.12, vw * 0.7, vh * 0.2);
      const hot = key === "forward_collision" && v.l === "TRUCK";
      box(g, v.x - vw / 2 - 4, v.y - 4, vw + 8, vh + 8, hot ? RED : CYAN, v.l, 0.9, o);
    });
    if (key === "forward_collision") banner(g, W, H, "rgba(220,38,38,.92)", "GAP CLOSING AHEAD", "FRONT ZONE BREACH", t);
    if (key === "lane_departure") banner(g, W, H, "rgba(217,119,6,.92)", "LANE DRIFT LEFT", "−0.62 m", t);
    g.fillStyle = "rgba(34,211,238,.9)"; g.font = `600 ${Math.max(9, W / 60)}px ui-monospace, Consolas, monospace`;
    g.fillText("AVM · 4 CAM STITCH", W * 0.02, H * 0.96);
    vignette(g, W, H);
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
