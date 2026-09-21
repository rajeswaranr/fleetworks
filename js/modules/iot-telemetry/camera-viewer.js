/* FleetWorks camera viewer: plays dashcam and 360° footage in the browser.

   How the big fleet platforms do this (Motive, Samsara):
     - The camera records to its own SD card all the time.
     - When something happens (harsh brake, collision, a manager asks) the device
       cuts a short clip and uploads it over 4G to cloud storage; a service turns it
       into HLS/MP4 so any browser can play it, and the web app streams it through
       a CDN with a short-lived signed link.
     - "Live view" is different: the browser asks the vehicle to start sending, and
       the video comes back over WebRTC or low-latency HLS for as long as you watch.
   FleetWorks has none of that plumbing yet, so this viewer covers the front half: the
   player, the multi-camera 360° layout and the review controls, working on any video
   the user opens. A file picked here is played straight from the user's device and is
   never uploaded. When cameras exist, their clip URLs go into the same slots
   (mp4 or .m3u8), and nothing else in the viewer changes. */
(function () {
  "use strict";

  const SLOTS = [
    { id: "front", label: "Front (road)" },
    { id: "cabin", label: "Cabin (driver)" },
    { id: "rear",  label: "Rear" },
    { id: "left",  label: "Left" },
    { id: "right", label: "Right" },
  ];
  const LAYOUTS = {
    dashcam: { label: "Dashcam", slots: ["front", "cabin"], cls: "cv-dash" },
    surround: { label: "360° view", slots: ["front", "left", "right", "rear"], cls: "cv-360" },
    all: { label: "All cameras", slots: ["front", "cabin", "rear", "left", "right"], cls: "cv-all" },
  };

  const css = `
  .dc-chip{background:#fff;color:var(--navy,#0f1e33);border:1.5px solid #cbd5e1}
  .cv-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
  .cv-stage{display:grid;gap:8px;background:#0b1626;border-radius:12px;padding:8px}
  .cv-dash{grid-template-columns:2fr 1fr}
  .cv-360{grid-template-columns:1fr 1fr}
  .cv-all{grid-template-columns:repeat(3,1fr)}
  .cv-tile{position:relative;background:#000;border-radius:8px;overflow:hidden;min-height:150px;aspect-ratio:16/9}
  .cv-tile video{width:100%;height:100%;object-fit:cover;display:block;background:#000}
  .cv-tag{position:absolute;top:8px;left:8px;background:rgba(0,0,0,.6);color:#fff;font-size:.72rem;padding:3px 8px;border-radius:6px;pointer-events:none}
  .cv-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#94a3b8;font-size:.85rem;text-align:center;padding:10px}
  .cv-empty[hidden]{display:none}
  .cv-ctl{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:10px}
  .cv-ctl input[type=range]{flex:1;min-width:160px}
  .cv-time{font-variant-numeric:tabular-nums;font-size:.85rem;color:var(--muted,#64748b);min-width:96px}
  .cv-url{flex:1;min-width:200px}
  @media (max-width:640px){.cv-dash,.cv-360,.cv-all{grid-template-columns:1fr}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  let hlsLib = null;
  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsLib) return hlsLib;
    hlsLib = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js";
      s.onload = () => res(window.Hls); s.onerror = () => rej(new Error("Could not load the HLS player."));
      document.head.appendChild(s);
    });
    return hlsLib;
  }

  const fmt = s => isFinite(s) ? Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0") : "0:00";

  function CameraViewer(root) {
    const state = { layout: "dashcam", sources: {}, hls: {}, speed: 1 };
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const vid = id => root.querySelector(`video[data-cam="${id}"]`);
    const videos = () => [...root.querySelectorAll("video")].filter(v => v.src || v.srcObject);

    function render() {
      const L = LAYOUTS[state.layout];
      root.innerHTML = `
        <div class="cv-bar">
          ${Object.entries(LAYOUTS).map(([k, l]) => `<button type="button" class="btn btn-sm ${state.layout === k ? "btn-primary" : "dc-chip"}" data-layout="${k}">${l.label}</button>`).join("")}
          <input class="cv-url" type="text" id="cvUrl" placeholder="Or paste a clip link (.mp4 or .m3u8) and pick the camera →" />
          <select id="cvUrlCam">${SLOTS.map(s => `<option value="${s.id}">${s.label}</option>`).join("")}</select>
          <button type="button" class="btn btn-sm btn-primary" id="cvUrlGo">Load link</button>
        </div>
        <div class="cv-stage ${L.cls}">
          ${L.slots.map(id => {
            const s = SLOTS.find(x => x.id === id);
            return `<div class="cv-tile" data-slot="${id}">
              <video data-cam="${id}" playsinline muted preload="auto"></video>
              <span class="cv-tag">${s.label}</span>
              <div class="cv-empty" data-empty="${id}"><span>No video for this camera</span>
                <label class="btn btn-sm btn-primary">Open a video file<input type="file" accept="video/*" data-file="${id}" hidden></label></div>
            </div>`;
          }).join("")}
        </div>
        <div class="cv-ctl">
          <button type="button" class="btn btn-sm btn-primary" id="cvPlay">Play</button>
          <span class="cv-time" id="cvTime">0:00 / 0:00</span>
          <input type="range" id="cvSeek" min="0" max="1000" value="0" aria-label="Seek">
          <select id="cvSpeed" aria-label="Speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select>
          <button type="button" class="btn btn-sm dc-chip" id="cvSnap">Snapshot</button>
        </div>
        <p class="muted" style="font-size:0.8rem;margin:8px 0 0">Videos open on this device only and are not uploaded. All cameras play and seek together.</p>`;
      // restore sources into the fresh elements
      for (const id of L.slots) if (state.sources[id]) attach(id, state.sources[id], false);
      wire();
      updateTime();
    }

    function setEmpty(id, on) { const e = root.querySelector(`[data-empty="${id}"]`); if (e) e.hidden = !on; }

    async function attach(id, src, remember = true) {
      const v = vid(id); if (!v) { if (remember) state.sources[id] = src; return; }
      if (remember) state.sources[id] = src;
      if (state.hls[id]) { state.hls[id].destroy(); delete state.hls[id]; }
      if (/\.m3u8(\?|$)/i.test(src.url) && !v.canPlayType("application/vnd.apple.mpegurl")) {
        try {
          const Hls = await loadHls();
          if (Hls.isSupported()) { const h = new Hls(); h.loadSource(src.url); h.attachMedia(v); state.hls[id] = h; }
        } catch (e) { alert(e.message); return; }
      } else v.src = src.url;
      v.playbackRate = state.speed;
      setEmpty(id, false);
      v.addEventListener("loadedmetadata", updateTime, { once: true });
      v.addEventListener("timeupdate", updateTime);
      ["play", "pause", "ended"].forEach(ev => v.addEventListener(ev, syncButton));
      v.addEventListener("error", () => { setEmpty(id, true); alert("That video could not be played. Use an MP4 (H.264) file or an .m3u8 link."); }, { once: true });
    }

    function master() { const vs = videos(); return vs.sort((a, b) => (b.duration || 0) - (a.duration || 0))[0]; }
    function updateTime() {
      const m = master(); if (!m) return;
      const t = root.querySelector("#cvTime"), seek = root.querySelector("#cvSeek");
      if (t) t.textContent = fmt(m.currentTime) + " / " + fmt(m.duration);
      if (seek && m.duration && document.activeElement !== seek) seek.value = String(Math.round((m.currentTime / m.duration) * 1000));
    }

    // the button always reflects what the videos are really doing
    function syncButton() {
      const b = root.querySelector("#cvPlay"); if (!b) return;
      b.textContent = videos().some(v => !v.paused && !v.ended) ? "Pause" : "Play";
    }
    function playAll() {
      const m = master();
      if (m && m.ended) videos().forEach(v => { v.currentTime = 0; });      // replay from the start
      // start every camera only once it has data, so they begin together
      const ready = v => v.readyState >= 3 ? Promise.resolve() : new Promise(res => v.addEventListener("canplay", res, { once: true }));
      Promise.all(videos().map(ready)).then(() => videos().forEach(v => v.play().catch(() => {})));
    }
    function pauseAll() { videos().forEach(v => v.pause()); }

    function wire() {
      root.querySelectorAll("[data-layout]").forEach(b => b.addEventListener("click", () => { state.layout = b.dataset.layout; render(); }));
      root.querySelectorAll("[data-file]").forEach(inp => inp.addEventListener("change", () => {
        const f = inp.files[0]; if (!f) return;
        attach(inp.dataset.file, { url: URL.createObjectURL(f), name: f.name });
      }));
      root.querySelector("#cvUrlGo").addEventListener("click", () => {
        const url = root.querySelector("#cvUrl").value.trim();
        if (!/^https:\/\//i.test(url)) { alert("Paste a link that starts with https://"); return; }
        attach(root.querySelector("#cvUrlCam").value, { url, name: url });
      });
      root.querySelector("#cvPlay").addEventListener("click", () => {
        const vs = videos(); if (!vs.length) { alert("Open a video first."); return; }
        vs.some(v => !v.paused && !v.ended) ? pauseAll() : playAll();
      });
      root.querySelector("#cvSeek").addEventListener("input", e => {
        const m = master(); if (!m || !m.duration) return;
        const t = (e.target.value / 1000) * m.duration;
        videos().forEach(v => { v.currentTime = Math.min(t, v.duration || t); });
        updateTime();
      });
      root.querySelector("#cvSpeed").addEventListener("change", e => {
        state.speed = +e.target.value; videos().forEach(v => { v.playbackRate = state.speed; });
      });
      root.querySelector("#cvSnap").addEventListener("click", snapshot);
    }

    // A still of what is on screen: one PNG of the whole layout, tiles side by side as laid out.
    function snapshot() {
      const tiles = [...root.querySelectorAll(".cv-tile video")].filter(v => v.videoWidth);
      if (!tiles.length) { alert("Open a video first."); return; }
      const cols = LAYOUTS[state.layout].slots.length > 2 && state.layout !== "all" ? 2 : Math.min(tiles.length, state.layout === "all" ? 3 : 2);
      const w = 640, h = 360, rows = Math.ceil(tiles.length / cols);
      const c = document.createElement("canvas"); c.width = w * cols; c.height = h * rows;
      const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
      tiles.forEach((v, i) => { try { g.drawImage(v, (i % cols) * w, Math.floor(i / cols) * h, w, h); } catch { /* cross-origin video cannot be drawn */ } });
      c.toBlob(b => {
        if (!b) { alert("This video's host does not allow snapshots."); return; }
        const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "fleetworks-snapshot.png"; a.click();
      }, "image/png");
    }

    render();
    return { state, attach, render };
  }

  window.FWCameraViewer = { mount: root => CameraViewer(root) };
})();
