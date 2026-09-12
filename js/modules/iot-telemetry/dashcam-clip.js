/* ============ FleetWorks — synthetic dash-cam clips ============
   These are NOT recordings. There is no camera on any vehicle in this fleet
   yet, and a placeholder that looks like real footage is worse than no
   placeholder at all — someone eventually treats it as evidence.
   So every clip renders a deliberately diagrammatic scene and carries a
   SIMULATED stamp that cannot be turned off.

   The point of building them now is that the whole chain around video — an
   event carrying a clip reference, a player, a review workflow, the storage
   path — can be finished and tested before any hardware exists. When real
   cameras arrive they write an https URL into the same device_events.video_url
   column and the player switches to <video> on the scheme alone.

   Clip references use  sim://clip/<event_type>/<seed>  so they are
   self-describing in the database and impossible to confuse with a real URL.

   Rendering is deterministic in the seed: the same event always produces the
   same clip. A "recording" that looked different each time you opened it would
   make the review queue useless for settling a dispute. */

(function () {
  "use strict";

  const SIM_SCHEME = "sim://clip/";

  function isSimClip(url) { return typeof url === "string" && url.startsWith(SIM_SCHEME); }

  function makeClipRef(eventType, seed) {
    return SIM_SCHEME + encodeURIComponent(eventType) + "/" + (seed >>> 0);
  }

  function parseClipRef(url) {
    if (!isSimClip(url)) return null;
    const rest = url.slice(SIM_SCHEME.length).split("/");
    return { eventType: decodeURIComponent(rest[0] || "unknown"), seed: parseInt(rest[1] || "1", 10) >>> 0 };
  }

  // Mulberry32 — small, fast, and seeded, so a clip is reproducible.
  function rngFrom(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* What each event looks like from the cab. Only the parts that differ are
     described here; the road, horizon and HUD are common to every clip. */
  const SCENES = {
    forward_collision:  { label: "FORWARD COLLISION",   tone: "#ef4444", lead: true,  closing: true },
    pedestrian_warning: { label: "PEDESTRIAN",          tone: "#ef4444", ped: true },
    headway_warning:    { label: "HEADWAY",             tone: "#f59e0b", lead: true },
    lane_departure:     { label: "LANE DEPARTURE",      tone: "#f59e0b", drift: true },
    overspeed:          { label: "OVERSPEED",           tone: "#f59e0b" },
    harsh_brake:        { label: "HARSH BRAKING",       tone: "#f59e0b", lead: true, brake: true },
    harsh_accel:        { label: "HARSH ACCELERATION",  tone: "#f59e0b" },
    harsh_corner:       { label: "HARSH CORNERING",     tone: "#f59e0b", corner: true },
    fatigue:            { label: "DROWSINESS",          tone: "#ef4444", cabin: true },
    distraction:        { label: "DISTRACTION",         tone: "#f59e0b", cabin: true },
    phone_use:          { label: "PHONE USE",           tone: "#f59e0b", cabin: true, phone: true },
    no_seatbelt:        { label: "NO SEATBELT",         tone: "#f59e0b", cabin: true },
    smoking:            { label: "SMOKING",             tone: "#f59e0b", cabin: true },
    fuel_drop:          { label: "FUEL DROP",           tone: "#ef4444", parked: true },
    tamper:             { label: "DEVICE TAMPER",       tone: "#ef4444", parked: true },
    power_cut:          { label: "POWER CUT",           tone: "#ef4444", parked: true },
    sos:                { label: "SOS",                 tone: "#ef4444" },
    panic:              { label: "PANIC",               tone: "#ef4444" },
  };

  function sceneFor(type) {
    return SCENES[type] || { label: String(type || "EVENT").toUpperCase(), tone: "#f59e0b" };
  }

  /* Draws one frame. t runs 0..1 across the clip; the alert fires at ~0.55 so
     there is always context before it, which is the only reason a reviewer can
     tell a real event from a sensor glitch. */
  function drawFrame(ctx, W, H, scene, rand0, t, meta) {
    const fired = t > 0.55;
    const horizon = H * 0.46;

    if (scene.cabin) drawCabin(ctx, W, H, scene, t, fired);
    else if (scene.parked) drawParked(ctx, W, H, scene, t, fired);
    else drawRoad(ctx, W, H, horizon, scene, rand0, t, fired);

    drawHud(ctx, W, H, scene, t, fired, meta);
  }

  function drawRoad(ctx, W, H, horizon, scene, rand0, t, fired) {
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#1b2a4a"); sky.addColorStop(1, "#3b4f78");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, horizon);

    ctx.fillStyle = "#23293a"; ctx.fillRect(0, horizon, W, H - horizon);

    // Lane markings in perspective. A slow lateral drift sells lane departure
    // without needing a real camera model.
    const drift = scene.drift ? Math.sin(t * Math.PI) * W * 0.16 : 0;
    const cx = W / 2 + drift + (scene.corner ? Math.sin(t * Math.PI * 1.2) * W * 0.1 : 0);

    ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 2;
    [-1, 1].forEach(side => {
      ctx.beginPath();
      ctx.moveTo(cx + side * W * 0.06, horizon);
      ctx.lineTo(cx + side * W * 0.55, H);
      ctx.stroke();
    });

    // Dashes running toward the viewer
    ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 3;
    for (let i = 0; i < 7; i++) {
      const p = ((i / 7) + (t * 1.6)) % 1;
      const y = horizon + (H - horizon) * p * p;
      const w = 2 + p * 9;
      ctx.beginPath(); ctx.moveTo(cx - w / 2, y); ctx.lineTo(cx + w / 2, y + p * 12); ctx.stroke();
    }

    if (scene.lead) {
      // Lead vehicle grows as the gap closes.
      const close = scene.closing ? t : Math.min(t, 0.6);
      const s = 0.18 + close * 0.5;
      const vw = W * s * 0.5, vh = vw * 0.62;
      const vy = horizon + (H - horizon) * (0.05 + close * 0.42);
      ctx.fillStyle = "#2b3142";
      roundRect(ctx, cx - vw / 2, vy - vh / 2, vw, vh, 4);
      ctx.fill();
      ctx.strokeStyle = "#4a5a80"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = scene.brake || fired ? "#ff4d4d" : "#7a1f1f";
      ctx.fillRect(cx - vw / 2 + vw * 0.08, vy + vh * 0.12, vw * 0.16, vh * 0.14);
      ctx.fillRect(cx + vw / 2 - vw * 0.24, vy + vh * 0.12, vw * 0.16, vh * 0.14);
      if (fired) boxAround(ctx, cx - vw / 2 - 6, vy - vh / 2 - 6, vw + 12, vh + 12, scene.tone);
    }

    if (scene.ped) {
      const px = W * (0.2 + t * 0.35);
      const py = horizon + (H - horizon) * 0.46;
      const ph = H * 0.17;
      ctx.fillStyle = "#e8d9b5";
      roundRect(ctx, px - ph * 0.13, py - ph, ph * 0.26, ph, 3); ctx.fill();
      ctx.beginPath(); ctx.arc(px, py - ph - ph * 0.12, ph * 0.13, 0, Math.PI * 2); ctx.fill();
      if (fired) boxAround(ctx, px - ph * 0.3, py - ph * 1.35, ph * 0.6, ph * 1.4, scene.tone);
    }
  }

  function drawCabin(ctx, W, H, scene, t, fired) {
    ctx.fillStyle = "#12161f"; ctx.fillRect(0, 0, W, H);
    // Interior IR look: flat, low contrast, no colour.
    const g = ctx.createRadialGradient(W / 2, H * 0.5, 10, W / 2, H * 0.5, W * 0.6);
    g.addColorStop(0, "#2a3040"); g.addColorStop(1, "#12161f");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const hx = W * 0.46, hy = H * 0.46, hr = H * 0.2;
    // Head dips on the drowsiness clip.
    const dip = scene.label === "DROWSINESS" ? Math.max(0, t - 0.35) * H * 0.16 : 0;
    ctx.fillStyle = "#3c4459";
    ctx.beginPath(); ctx.ellipse(hx, hy + dip, hr * 0.72, hr, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#2e3547";
    roundRect(ctx, hx - hr * 1.1, hy + hr * 0.85 + dip, hr * 2.2, hr * 1.3, 8); ctx.fill();

    if (scene.phone) {
      ctx.fillStyle = fired ? "#9fe8ff" : "#54606f";
      roundRect(ctx, hx + hr * 0.72, hy - hr * 0.1, hr * 0.3, hr * 0.52, 3); ctx.fill();
    }
    if (fired) boxAround(ctx, hx - hr * 0.95, hy - hr * 1.25 + dip, hr * 1.9, hr * 1.75, scene.tone);
  }

  function drawParked(ctx, W, H, scene, t, fired) {
    ctx.fillStyle = "#0d1119"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 1;
    for (let y = 0; y < H; y += 14) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.fillStyle = "#6b7fa3";
    ctx.font = "600 " + Math.round(H * 0.075) + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("VEHICLE PARKED", W / 2, H * 0.44);
    ctx.font = Math.round(H * 0.055) + "px system-ui, sans-serif";
    ctx.fillStyle = fired ? scene.tone : "#46506b";
    ctx.fillText(scene.label, W / 2, H * 0.56);
    ctx.textAlign = "left";
  }

  function drawHud(ctx, W, H, scene, t, fired, meta) {
    const pad = Math.round(W * 0.025);

    // Alert banner
    if (fired) {
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin(t * Math.PI * 8));
      ctx.globalAlpha = pulse;
      ctx.fillStyle = scene.tone;
      ctx.fillRect(0, 0, W, Math.round(H * 0.1));
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff";
      ctx.font = "800 " + Math.round(H * 0.055) + "px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(scene.label, W / 2, Math.round(H * 0.072));
      ctx.textAlign = "left";
    }

    // Speed + timestamp, bottom left
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(0, H - Math.round(H * 0.13), W, Math.round(H * 0.13));
    ctx.fillStyle = "#e8edf9";
    ctx.font = "700 " + Math.round(H * 0.055) + "px ui-monospace, monospace";
    ctx.fillText((meta.speed != null ? Math.round(meta.speed) : "--") + " km/h", pad, H - Math.round(H * 0.045));
    ctx.font = Math.round(H * 0.045) + "px ui-monospace, monospace";
    ctx.fillStyle = "#93a0bd";
    ctx.textAlign = "right";
    ctx.fillText(meta.stamp || "", W - pad, H - Math.round(H * 0.045));
    ctx.textAlign = "left";

    // SIMULATED watermark — always drawn, never optional.
    ctx.fillStyle = "rgba(255,255,255,.32)";
    ctx.font = "800 " + Math.round(H * 0.05) + "px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("SIMULATED — NOT A RECORDING", W - pad, Math.round(H * 0.16));
    ctx.textAlign = "left";

    // Progress scrubber
    ctx.fillStyle = "rgba(255,255,255,.2)";
    ctx.fillRect(0, H - 3, W, 3);
    ctx.fillStyle = scene.tone;
    ctx.fillRect(0, H - 3, W * t, 3);
  }

  function boxAround(ctx, x, y, w, h, tone) {
    ctx.strokeStyle = tone; ctx.lineWidth = 2.5;
    ctx.strokeRect(x, y, w, h);
    const c = Math.min(w, h) * 0.22;
    ctx.lineWidth = 4;
    [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([cx2, cy2, sx, sy]) => {
      ctx.beginPath();
      ctx.moveTo(cx2 + sx * c, cy2); ctx.lineTo(cx2, cy2); ctx.lineTo(cx2, cy2 + sy * c);
      ctx.stroke();
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* Mounts a clip into a container. Returns a handle with stop(), because an
     unattended rAF loop behind a closed modal is a battery leak. */
  function mountClip(container, opts) {
    const o = opts || {};
    const ref = parseClipRef(o.url) || { eventType: o.eventType || "unknown", seed: 1 };
    const scene = sceneFor(ref.eventType);
    const rand0 = rngFrom(ref.seed)();
    const DURATION = 6000;

    container.innerHTML = "";
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:100%;display:block;border-radius:10px;background:#0d1119";
    container.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    let raf = null, start = null, stopped = false;

    function size() {
      const w = container.clientWidth || 480;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(w * 0.5625 * dpr);
      canvas.style.height = Math.round(w * 0.5625) + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();

    const meta = { speed: o.speed, stamp: o.stamp || "" };

    function frame(ts) {
      if (stopped) return;
      if (start == null) start = ts;
      const t = ((ts - start) % DURATION) / DURATION;
      const w = canvas.width / (Math.min(window.devicePixelRatio || 1, 2));
      const h = canvas.height / (Math.min(window.devicePixelRatio || 1, 2));
      ctx.clearRect(0, 0, w, h);
      drawFrame(ctx, w, h, scene, rand0, t, meta);
      raf = requestAnimationFrame(frame);
    }

    // Paint one frame synchronously before starting the loop. rAF does not run
    // while the document is hidden — a background tab, a collapsed pane — so
    // without this the player can open showing nothing at all. Drawing at 0.7
    // lands just after the alert fires, which is the frame worth showing if
    // this ends up being the only one.
    const cssW = canvas.width / Math.min(window.devicePixelRatio || 1, 2);
    const cssH = canvas.height / Math.min(window.devicePixelRatio || 1, 2);
    drawFrame(ctx, cssW, cssH, scene, rand0, 0.7, meta);

    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      raf = requestAnimationFrame(frame);
    }

    const onResize = () => { size(); };
    window.addEventListener("resize", onResize);

    return {
      stop() {
        stopped = true;
        if (raf) cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
      }
    };
  }

  /* Real footage arrives as https and plays as video; anything else is one of
     ours. Deciding on the scheme means no flag has to be kept in sync. */
  function renderClip(container, opts) {
    const url = opts && opts.url;
    if (url && /^https?:\/\//i.test(url)) {
      container.innerHTML =
        '<video src="' + url.replace(/"/g, "&quot;") + '" controls playsinline ' +
        'style="width:100%;border-radius:10px;background:#000"></video>';
      return { stop() {} };
    }
    return mountClip(container, opts);
  }

  window.FWDashcam = { isSimClip, makeClipRef, parseClipRef, renderClip, sceneFor, SCENES };
})();
