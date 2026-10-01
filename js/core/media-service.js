/* FleetWorks — MediaService (portable live-video seam).
 *
 * The whole app talks to window.MediaService; the streaming provider (LiveKit Cloud today,
 * a self-hosted LiveKit or another SFU later) lives ONLY behind it. Swapping providers means
 * changing this file and the livekit-token edge function — no page or controller changes.
 *
 *   MediaService.publish(vehicleId, stream, opts)  driver phone broadcasts a MediaStream
 *   MediaService.view(vehicleId, videoEl, opts)    owner/supervisor watches a vehicle live
 *   MediaService.available()                       true when a signed-in session can mint tokens
 *
 * Each returns a handle with stop(). Tokens come from the livekit-token edge function, scoped
 * to the vehicle and the caller's role; this file never sees the LiveKit API secret. The
 * LiveKit browser SDK is loaded from a CDN on first use so pages that never go live pay nothing.
 */
(function () {
  "use strict";

  const LK_SDK = "https://cdn.jsdelivr.net/npm/livekit-client@2.5.9/dist/livekit-client.umd.min.js";
  let sdkP = null;
  function loadSDK() {
    if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
    return sdkP = sdkP || new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = LK_SDK;
      s.onload = () => window.LivekitClient ? res(window.LivekitClient) : rej(new Error("LiveKit SDK did not load."));
      s.onerror = () => rej(new Error("Could not load the live-video player."));
      document.head.appendChild(s);
    });
  }

  // read the stored Supabase session this page keeps (used by pages without fwCloud, e.g. live.html)
  function sessionToken() {
    try {
      const k = localStorage.getItem("fw_session:active");
      const raw = k ? localStorage.getItem(k) : localStorage.getItem("fw_session");
      const s = raw ? JSON.parse(raw) : null;
      return (s && s.access_token) || null;
    } catch { return null; }
  }
  // Call the livekit-token edge function with whatever signed-in session this page has.
  async function mintToken(vehicleId, role) {
    const body = { vehicleId, role };
    if (window.FSData && FSData.enabled && FSData.enabled()) return FSData.fn("livekit-token", body);
    if (window.fwCloud && fwCloud.callFunction) return fwCloud.callFunction("livekit-token", body);
    const tok = sessionToken();
    if (tok && window.FW_BACKEND) {
      const r = await fetch(FW_BACKEND.url + "/functions/v1/livekit-token", {
        method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + tok, apikey: FW_BACKEND.anonKey }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("Live token error (" + r.status + ").");
      return r.json();
    }
    throw new Error("Live video needs a signed-in session.");
  }
  function available() {
    return !!((window.FSData && FSData.enabled && FSData.enabled()) || (window.fwCloud && fwCloud.callFunction) || (sessionToken() && window.FW_BACKEND));
  }

  async function publish(vehicleId, stream, opts = {}) {
    const state = opts.onState || (() => {});
    const track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
    if (!track) throw new Error("No camera track to share.");
    state("connecting");
    const LK = await loadSDK();
    const t = await mintToken(vehicleId, "publish");
    console.info("[MediaService] publish token ok, room", t.room, "→", t.url);
    const room = new LK.Room({ adaptiveStream: true, dynacast: true });
    room.on(LK.RoomEvent.Disconnected, () => state("stopped"));
    await room.connect(t.url, t.token);
    await room.localParticipant.publishTrack(track, { name: "cabin", source: LK.Track.Source.Camera, simulcast: true });
    console.info("[MediaService] cabin track published to", t.room);
    state("live");
    return { stop() { try { room.disconnect(); } catch {} } };
  }

  async function view(vehicleId, videoEl, opts = {}) {
    const state = opts.onState || (() => {});
    state("connecting");
    const LK = await loadSDK();
    const t = await mintToken(vehicleId, "view");
    console.info("[MediaService] view token ok, room", t.room, "→", t.url);
    const room = new LK.Room({ adaptiveStream: true });
    let gotVideo = false;
    const attach = (tr) => { if (tr.kind === "video") { tr.attach(videoEl); gotVideo = true; console.info("[MediaService] driver video attached"); state("live"); } };
    room.on(LK.RoomEvent.TrackSubscribed, attach);
    room.on(LK.RoomEvent.TrackUnsubscribed, (tr) => { try { tr.detach(videoEl); } catch {} });
    room.on(LK.RoomEvent.ParticipantConnected, () => console.info("[MediaService] driver joined the room"));
    room.on(LK.RoomEvent.Disconnected, () => state("stopped"));
    await room.connect(t.url, t.token);
    // any already-published tracks (driver was live before we opened)
    room.remoteParticipants.forEach((p) => p.trackPublications.forEach((pub) => { if (pub.track) attach(pub.track); }));
    // nobody publishing yet: keep the room open and keep listening — the moment the driver
    // starts Safe Drive, TrackSubscribed fires and the video appears without re-clicking.
    setTimeout(() => { if (!gotVideo) { console.info("[MediaService] no publisher yet in", t.room); state("offline"); } }, 4000);
    return { stop() { try { room.disconnect(); } catch {} }, get gotVideo() { return gotVideo; } };
  }

  window.MediaService = { publish, view, available };
})();
