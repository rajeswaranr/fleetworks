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

  // Call the livekit-token edge function with whatever signed-in session this page has.
  async function mintToken(vehicleId, role) {
    const body = { vehicleId, role };
    if (window.FSData && FSData.enabled && FSData.enabled()) return FSData.fn("livekit-token", body);
    if (window.fwCloud && fwCloud.callFunction) return fwCloud.callFunction("livekit-token", body);
    throw new Error("Live video needs a signed-in session.");
  }
  function available() {
    return !!((window.FSData && FSData.enabled && FSData.enabled()) || (window.fwCloud && fwCloud.callFunction));
  }

  async function publish(vehicleId, stream, opts = {}) {
    const state = opts.onState || (() => {});
    const track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
    if (!track) throw new Error("No camera track to share.");
    state("connecting");
    const LK = await loadSDK();
    const t = await mintToken(vehicleId, "publish");
    const room = new LK.Room({ adaptiveStream: true, dynacast: true });
    room.on(LK.RoomEvent.Disconnected, () => state("stopped"));
    await room.connect(t.url, t.token);
    await room.localParticipant.publishTrack(track, { name: "cabin", source: LK.Track.Source.Camera, simulcast: true });
    state("live");
    return { stop() { try { room.disconnect(); } catch {} } };
  }

  async function view(vehicleId, videoEl, opts = {}) {
    const state = opts.onState || (() => {});
    state("connecting");
    const LK = await loadSDK();
    const t = await mintToken(vehicleId, "view");
    const room = new LK.Room({ adaptiveStream: true });
    let gotVideo = false;
    const attach = (tr) => { if (tr.kind === "video") { tr.attach(videoEl); gotVideo = true; state("live"); } };
    room.on(LK.RoomEvent.TrackSubscribed, attach);
    room.on(LK.RoomEvent.TrackUnsubscribed, (tr) => { try { tr.detach(videoEl); } catch {} });
    room.on(LK.RoomEvent.Disconnected, () => state("stopped"));
    await room.connect(t.url, t.token);
    // already-published tracks
    room.remoteParticipants.forEach((p) => p.trackPublications.forEach((pub) => { if (pub.track) attach(pub.track); }));
    // if nobody is publishing yet, say so but keep listening for the driver to go live
    setTimeout(() => { if (!gotVideo) state("offline"); }, 4000);
    return { stop() { try { room.disconnect(); } catch {} }, get gotVideo() { return gotVideo; } };
  }

  window.MediaService = { publish, view, available };
})();
