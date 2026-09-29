/* Fleet Graph (FleetIQ → Fleet Graph).
   Every record linked to a vehicle, a driver or a device, drawn as a graph you can walk:
   click a driver or a device to make it the centre and see its own links.

   Signed in, the links come from GraphQL (pg_graphql, /graphql/v1): one query follows
   the foreign keys (vehicle → drivers, trips, devices → camera events, alerts, job
   cards...) with row-level security applied, as for every other read. In the demo the
   same shape is assembled from the demo fleet and the simulated FleetSafe day. */
(function () {
  "use strict";

  const G = { focus: null, trail: [], data: null, sel: null, busy: false, err: null, lastQuery: "" };
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const icon = (n, s = 16) => (window.FWIcon ? FWIcon(n, { size: s }) : "");
  const d = () => window.db || {};
  const live = () => !!(window.fwCloud && fwCloud.user && fwCloud.user());
  const demo = () => !!(window.FSData && FSData.demo());
  const fmtDate = s => s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "";
  const inr = n => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
  const edges = c => (c && c.edges ? c.edges.map(e => e.node) : []);

  // group styling: colour, icon, the page it opens
  const KIND = {
    vehicle: ["#22d3ee", "truck", "vehicles"], driver: ["#a78bfa", "driver", "drivers"], trip: ["#34d399", "mapPin", "trips"],
    device: ["#38bdf8", "zap", "devicehub"], incident: ["#f87171", "shieldAlert", "triage"], alert: ["#fbbf24", "bell", "safehome"],
    document: ["#94a3b8", "document", "documents"], workorder: ["#fb923c", "wrench", "workorders"], issue: ["#f472b6", "alert", "issues"],
    fuel: ["#2dd4bf", "fuel", "fuel"], geofence: ["#60a5fa", "map", "geofences"], asset: ["#c4b5fd", "boxes", "assets"],
    ledger: ["#86efac", "rupee", "khata"], coaching: ["#fca5a5", "eye", "safety"], channel: ["#67e8f9", "camera", "devicehub"], sensor: ["#5eead4", "fuel", "devicehub"],
  };

  // ── GraphQL ─────────────────────────────────────────────────────────
  async function gql(query, variables) {
    G.lastQuery = query.trim();
    const token = await fwCloud.accessToken();
    const r = await fetch(FW_BACKEND.url + "/graphql/v1", {
      method: "POST",
      headers: { apikey: FW_BACKEND.anonKey, Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.errors) throw new Error((j.errors && j.errors[0] && j.errors[0].message) || `GraphQL answered ${r.status}`);
    return j.data;
  }
  const Q = {
    vehicle: `query Vehicle($id: UUID!) {
  vehiclesCollection(filter: { id: { eq: $id } }) { edges { node {
    id name type
    driversCollection { edges { node { id name phone } } }
    tripsCollection(first: 8, orderBy: [{ tripDate: DescNullsLast }]) { edges { node { id tripDate fromLoc toLoc km status } } }
    devicesCollection { edges { node { id imei kind simulated lastSeenAt } } }
    aiEventsCollection(first: 8, orderBy: [{ occurredAt: DescNullsLast }]) { edges { node { id eventType severity occurredAt summary } } }
    fleetAlertsCollection(first: 8, orderBy: [{ createdAt: DescNullsLast }]) { edges { node { id title severity createdAt } } }
    documentsCollection(first: 8) { edges { node { id docType number expiryDate } } }
    workOrdersCollection(first: 8, orderBy: [{ createdAt: DescNullsLast }]) { edges { node { id title status vendor } } }
    issuesCollection(first: 8, orderBy: [{ createdAt: DescNullsLast }]) { edges { node { id title severity status } } }
    fuelLogsCollection(first: 200, orderBy: [{ logDate: DescNullsLast }]) { edges { node { logDate litres amount } } }
    geofenceEventsCollection(first: 8, orderBy: [{ occurredAt: DescNullsLast }]) { edges { node { id direction occurredAt geofence { name purpose } } } }
    assetsCollection { edges { node { id name assetType } } }
  } } }
}`,
    driver: `query Driver($id: UUID!) {
  driversCollection(filter: { id: { eq: $id } }) { edges { node {
    id name phone dlNo dlExpiry
    vehicle { id name type }
    tripsCollection(first: 8, orderBy: [{ tripDate: DescNullsLast }]) { edges { node { id tripDate fromLoc toLoc km status } } }
    documentsCollection(first: 8) { edges { node { id docType number expiryDate } } }
    driverLedgerCollection(first: 200, orderBy: [{ entryDate: DescNullsLast }]) { edges { node { type amount entryDate } } }
    coachingSessionsCollection(first: 8, orderBy: [{ assignedAt: DescNullsLast }]) { edges { node { id eventType status assignedAt } } }
  } } }
}`,
    device: `query Device($id: UUID!) {
  devicesCollection(filter: { id: { eq: $id } }) { edges { node {
    id imei kind protocol integration simulated lastSeenAt
    vehicle { id name type }
    deviceChannelsCollection { edges { node { id channelNo role label } } }
    deviceSensorsCollection { edges { node { id sourceKey signalPath transform } } }
    deviceEventsCollection(first: 8, orderBy: [{ occurredAt: DescNullsLast }]) { edges { node { id eventType severity occurredAt } } }
    aiEventsCollection(first: 8, orderBy: [{ occurredAt: DescNullsLast }]) { edges { node { id eventType severity occurredAt summary } } }
  } } }
}`,
  };

  // ── one shape for both sources ──────────────────────────────────────
  // { focus: {type,id,label,sub}, groups: [{kind,label,nodes:[{id,type,label,sub,sev,focus}], extra}] }
  const node = (type, id, label, sub, extra = {}) => ({ type, id, label: String(label || "—"), sub: sub || "", ...extra });
  const label = t => (window.FSData && ({ fuel_theft: "Fuel theft", tyre_pressure_loss: "Tyre loss", engine_overheat: "Overheating", cargo_temp_breach: "Cargo warm", fatigue: "Drowsiness", phone_use: "Phone use", forward_collision: "Collision warning", lane_departure: "Lane departure", harsh_brake: "Harsh braking" })[t]) || String(t || "").replace(/_/g, " ");

  function fromVehicleGql(v) {
    const fuel = edges(v.fuelLogsCollection);
    return {
      focus: node("vehicle", v.id, v.name, v.type),
      groups: [
        { kind: "driver", label: "Drivers", nodes: edges(v.driversCollection).map(x => node("driver", x.id, x.name, x.phone, { focus: true })) },
        { kind: "device", label: "Devices", nodes: edges(v.devicesCollection).map(x => node("device", x.id, x.imei, `${x.kind}${x.simulated ? " · simulated" : ""}`, { focus: true })) },
        { kind: "trip", label: "Trips", nodes: edges(v.tripsCollection).map(x => node("trip", x.id, `${x.fromLoc || "?"} → ${x.toLoc || "?"}`, `${fmtDate(x.tripDate)}${x.km ? " · " + x.km + " km" : ""}`)) },
        { kind: "incident", label: "AI detections", nodes: edges(v.aiEventsCollection).map(x => node("incident", x.id, label(x.eventType), fmtDate(x.occurredAt), { sev: x.severity, detail: x.summary })) },
        { kind: "alert", label: "Alerts", nodes: edges(v.fleetAlertsCollection).map(x => node("alert", x.id, x.title, fmtDate(x.createdAt), { sev: x.severity })) },
        { kind: "workorder", label: "Job cards", nodes: edges(v.workOrdersCollection).map(x => node("workorder", x.id, x.title, `${x.status || ""}${x.vendor ? " · " + x.vendor : ""}`)) },
        { kind: "issue", label: "Issues", nodes: edges(v.issuesCollection).map(x => node("issue", x.id, x.title, `${x.severity || ""} · ${x.status || ""}`)) },
        { kind: "document", label: "Documents", nodes: edges(v.documentsCollection).map(x => node("document", x.id, x.docType, x.expiryDate ? "expires " + fmtDate(x.expiryDate) : x.number)) },
        { kind: "geofence", label: "Geofence crossings", nodes: edges(v.geofenceEventsCollection).map(x => node("geofence", x.id, `${x.direction === "enter" ? "Entered" : "Left"} ${x.geofence ? x.geofence.name : "fence"}`, fmtDate(x.occurredAt), { sev: x.geofence && x.geofence.purpose === "restricted" && x.direction === "enter" ? "critical" : null })) },
        { kind: "asset", label: "Towing", nodes: edges(v.assetsCollection).map(x => node("asset", x.id, x.name, x.assetType)) },
        { kind: "fuel", label: "Fuel", nodes: fuel.length ? [node("fuel", "fuel-" + v.id, `${fuel.length} diesel fills`, `${Math.round(fuel.reduce((s, f) => s + Number(f.litres || 0), 0)).toLocaleString("en-IN")} L · ${inr(fuel.reduce((s, f) => s + Number(f.amount || 0), 0))}`)] : [] },
      ],
    };
  }
  function fromDriverGql(x) {
    const led = edges(x.driverLedgerCollection);
    const bal = led.reduce((s, l) => s + (l.type === "advance" ? 1 : -1) * Number(l.amount || 0), 0);
    return {
      focus: node("driver", x.id, x.name, [x.phone, x.dlNo].filter(Boolean).join(" · ")),
      groups: [
        { kind: "vehicle", label: "Vehicle", nodes: x.vehicle ? [node("vehicle", x.vehicle.id, x.vehicle.name, x.vehicle.type, { focus: true })] : [] },
        { kind: "trip", label: "Trips", nodes: edges(x.tripsCollection).map(t => node("trip", t.id, `${t.fromLoc || "?"} → ${t.toLoc || "?"}`, fmtDate(t.tripDate))) },
        { kind: "document", label: "Documents", nodes: edges(x.documentsCollection).map(t => node("document", t.id, t.docType, t.expiryDate ? "expires " + fmtDate(t.expiryDate) : t.number)) },
        { kind: "coaching", label: "Coaching", nodes: edges(x.coachingSessionsCollection).map(t => node("coaching", t.id, label(t.eventType), `${t.status} · ${fmtDate(t.assignedAt)}`)) },
        { kind: "ledger", label: "Khata", nodes: led.length ? [node("ledger", "ledger-" + x.id, `${led.length} entries`, `balance ${inr(bal)}`)] : [] },
      ],
    };
  }
  function fromDeviceGql(x) {
    return {
      focus: node("device", x.id, x.imei, `${x.kind} · ${x.protocol || ""} · ${x.integration || ""}${x.simulated ? " · simulated" : ""}`),
      groups: [
        { kind: "vehicle", label: "Fitted to", nodes: x.vehicle ? [node("vehicle", x.vehicle.id, x.vehicle.name, x.vehicle.type, { focus: true })] : [] },
        { kind: "channel", label: "Camera channels", nodes: edges(x.deviceChannelsCollection).map(c => node("channel", c.id, `Ch ${c.channelNo} · ${c.role.replace(/_/g, " ")}`, c.label || "")) },
        { kind: "sensor", label: "Sensor mappings", nodes: edges(x.deviceSensorsCollection).map(s => node("sensor", s.id, s.sourceKey, `${s.signalPath.split(".").slice(-2).join(".")} · ${s.transform}`)) },
        { kind: "incident", label: "Camera alarms", nodes: edges(x.deviceEventsCollection).map(e => node("incident", e.id, label(e.eventType), fmtDate(e.occurredAt), { sev: e.severity })) },
        { kind: "alert", label: "AI detections", nodes: edges(x.aiEventsCollection).map(e => node("alert", e.id, label(e.eventType), fmtDate(e.occurredAt), { sev: e.severity, detail: e.summary })) },
      ],
    };
  }

  // demo: the same shapes from the demo fleet and the simulated FleetSafe day
  async function fromDemo(type, id) {
    const T = t => FSData.get(t, "select=*");
    const [devices, ai, alerts, gev, fences, assets, dev_ev, chans, sens, coach] = await Promise.all(
      ["devices", "ai_events", "fleet_alerts", "geofence_events", "geofences", "assets", "device_events", "device_channels", "device_sensors", "coaching_sessions"].map(T));
    const V = d().vehicles || [], D = d().drivers || [];
    const recent = (arr, key) => [...arr].sort((a, b) => String(b[key]).localeCompare(String(a[key]))).slice(0, 8);
    if (type === "vehicle") {
      const v = V.find(x => x.id === id) || V[0];
      const fuel = (d().fuelLogs || []).filter(f => f.vehicleId === v.id);
      return fromVehicleGql({ id: v.id, name: v.name, type: v.type,
        driversCollection: { edges: D.filter(x => x.vehicleId === v.id).map(n => ({ node: { id: n.id, name: n.name, phone: n.phone } })) },
        tripsCollection: { edges: recent((d().trips || []).filter(t => t.vehicleId === v.id), "date").map(t => ({ node: { id: t.id, tripDate: t.date, fromLoc: t.from, toLoc: t.to, km: t.km } })) },
        devicesCollection: { edges: devices.filter(x => x.vehicle_id === v.id).map(x => ({ node: { id: x.id, imei: x.imei, kind: x.kind, simulated: x.simulated } })) },
        aiEventsCollection: { edges: recent(ai.filter(x => x.vehicle_id === v.id), "occurred_at").map(x => ({ node: { id: x.id, eventType: x.event_type, severity: x.severity, occurredAt: x.occurred_at, summary: x.summary } })) },
        fleetAlertsCollection: { edges: recent(alerts.filter(x => x.vehicle_id === v.id), "created_at").map(x => ({ node: { id: x.id, title: x.title, severity: x.severity, createdAt: x.created_at } })) },
        documentsCollection: { edges: (d().documents || []).filter(x => x.entityType === "vehicle" && x.entityId === v.id).slice(0, 8).map(x => ({ node: { id: x.id, docType: x.docType, number: x.number, expiryDate: x.expiryDate } })) },
        workOrdersCollection: { edges: (d().workOrders || []).filter(x => x.vehicleId === v.id).slice(-8).reverse().map(x => ({ node: { id: x.id, title: x.title, status: x.status, vendor: x.vendor } })) },
        issuesCollection: { edges: (d().issues || []).filter(x => x.vehicleId === v.id).slice(-8).reverse().map(x => ({ node: { id: x.id, title: x.title, severity: x.severity, status: x.status } })) },
        fuelLogsCollection: { edges: fuel.map(f => ({ node: { logDate: f.date, litres: f.litres, amount: f.amount } })) },
        geofenceEventsCollection: { edges: recent(gev.filter(x => x.vehicle_id === v.id), "occurred_at").map(x => ({ node: { id: x.id, direction: x.direction, occurredAt: x.occurred_at, geofence: fences.find(f => f.id === x.geofence_id) } })) },
        assetsCollection: { edges: assets.filter(a => a.towed_by_vehicle_id === v.id).map(a => ({ node: { id: a.id, name: a.name, assetType: a.asset_type } })) },
      });
    }
    if (type === "driver") {
      const x = D.find(r => r.id === id); const v = V.find(r => r.id === x.vehicleId);
      return fromDriverGql({ id: x.id, name: x.name, phone: x.phone, dlNo: x.dlNo,
        vehicle: v ? { id: v.id, name: v.name, type: v.type } : null,
        tripsCollection: { edges: recent((d().trips || []).filter(t => t.vehicleId === x.vehicleId), "date").map(t => ({ node: { id: t.id, tripDate: t.date, fromLoc: t.from, toLoc: t.to } })) },
        documentsCollection: { edges: (d().documents || []).filter(r => r.entityType === "driver" && r.entityId === x.id).map(r => ({ node: { id: r.id, docType: r.docType, number: r.number, expiryDate: r.expiryDate } })) },
        driverLedgerCollection: { edges: (d().driverLedger || []).filter(l => l.driverId === x.id).map(l => ({ node: { type: l.type, amount: l.amount, entryDate: l.date } })) },
        coachingSessionsCollection: { edges: coach.filter(c => c.driver_id === x.id).map(c => ({ node: { id: c.id, eventType: c.event_type, status: c.status, assignedAt: c.assigned_at } })) },
      });
    }
    const x = devices.find(r => r.id === id); const v = V.find(r => r.id === x.vehicle_id);
    return fromDeviceGql({ ...x, lastSeenAt: x.last_seen_at, vehicle: v ? { id: v.id, name: v.name, type: v.type } : null,
      deviceChannelsCollection: { edges: chans.filter(c => c.device_id === x.id).map(c => ({ node: { id: c.id, channelNo: c.channel_no, role: c.role, label: c.label } })) },
      deviceSensorsCollection: { edges: sens.filter(s => s.device_id === x.id).map(s => ({ node: { id: s.id, sourceKey: s.source_key, signalPath: s.signal_path, transform: s.transform } })) },
      deviceEventsCollection: { edges: recent(dev_ev.filter(e => e.device_id === x.id), "occurred_at").map(e => ({ node: { id: e.id, eventType: e.event_type, severity: e.severity, occurredAt: e.occurred_at } })) },
      aiEventsCollection: { edges: recent(ai.filter(e => e.device_id === x.id), "occurred_at").map(e => ({ node: { id: e.id, eventType: e.event_type, severity: e.severity, occurredAt: e.occurred_at, summary: e.summary } })) },
    });
  }

  async function load(focus) {
    G.busy = true; G.err = null; render();
    try {
      if (live()) {
        const data = await gql(Q[focus.type], { id: focus.id });
        const root = { vehicle: "vehiclesCollection", driver: "driversCollection", device: "devicesCollection" }[focus.type];
        const n = edges(data[root])[0];
        if (!n) throw new Error("Not found, or not visible to you.");
        G.data = { vehicle: fromVehicleGql, driver: fromDriverGql, device: fromDeviceGql }[focus.type](n);
      } else {
        G.lastQuery = Q[focus.type].trim();
        G.data = await fromDemo(focus.type, focus.id);
      }
      G.sel = null;
    } catch (e) { G.err = e.message; G.data = null; }
    G.busy = false; render();
  }

  // ── drawing ─────────────────────────────────────────────────────────
  function graphSvg(data) {
    const W = 1000, H = 620, cx = W / 2, cy = H / 2;
    const groups = data.groups.filter(g => g.nodes.length);
    const per = (Math.PI * 2) / Math.max(1, groups.length);
    let lines = "", dots = "", labels = "";
    groups.forEach((g, gi) => {
      const [col] = KIND[g.kind] || ["#94a3b8"];
      const shown = g.nodes.slice(0, 6), more = g.nodes.length - shown.length;
      const a0 = -Math.PI / 2 + gi * per;
      const hx = cx + Math.cos(a0) * 150, hy = cy + Math.sin(a0) * 118;       // group hub
      lines += `<line x1="${cx}" y1="${cy}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="${col}" stroke-opacity=".55" stroke-width="2"/>`;
      dots += `<g class="fg-hub"><circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="18" fill="#0f1a2e" stroke="${col}" stroke-width="2"/><text x="${hx.toFixed(1)}" y="${(hy + 4).toFixed(1)}" text-anchor="middle" class="fg-n">${g.nodes.length}</text></g>`;
      const lx = cx + Math.cos(a0) * 118, ly = cy + Math.sin(a0) * 92;
      labels += `<text x="${lx.toFixed(1)}" y="${(ly - 24).toFixed(1)}" text-anchor="middle" class="fg-g" fill="${col}">${esc(g.label)}</text>`;
      const spread = Math.min(per * 0.8, 1.1);
      [...shown, ...(more > 0 ? [{ type: g.kind, id: "more-" + g.kind, label: `+${more} more`, sub: "", more: true }] : [])].forEach((n, i, arr) => {
        const a = a0 + (arr.length > 1 ? (i / (arr.length - 1) - 0.5) * spread : 0);
        const nx = cx + Math.cos(a) * 330, ny = cy + Math.sin(a) * 250;
        const bad = n.sev === "critical", warn = n.sev === "warning";
        lines += `<line x1="${hx.toFixed(1)}" y1="${hy.toFixed(1)}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${col}" stroke-opacity=".28" stroke-width="1.2"/>`;
        const anchor = Math.cos(a) < -0.25 ? "end" : Math.cos(a) > 0.25 ? "start" : "middle", off = anchor === "end" ? -14 : anchor === "start" ? 14 : 0;
        const ty = anchor === "middle" ? (Math.sin(a) < 0 ? ny - 16 : ny + 24) : ny + 4;
        dots += `<g class="fg-node${n.focus ? " is-focusable" : ""}${G.sel && G.sel.id === n.id ? " is-sel" : ""}" data-node="${esc(n.id)}" data-gk="${esc(g.kind)}" tabindex="0" role="button" aria-label="${esc(n.label)}">
          <circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${n.more ? 7 : 10}" fill="${bad ? "#ef4444" : warn ? "#f59e0b" : col}" ${n.focus ? `stroke="#fff" stroke-width="2"` : ""}/>
          <text x="${(nx + off).toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}" class="fg-l">${esc(n.label.length > 26 ? n.label.slice(0, 25) + "…" : n.label)}</text></g>`;
      });
    });
    const f = data.focus, [fc] = KIND[f.type] || ["#22d3ee"];
    return `<svg class="fg-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Records linked to ${esc(f.label)}">
      ${lines}${dots}${labels}
      <g class="fg-focus"><circle cx="${cx}" cy="${cy}" r="46" fill="#0a1120" stroke="${fc}" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="56" fill="none" stroke="${fc}" stroke-opacity=".25" stroke-width="8"/>
        <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="fg-fl">${esc(f.label.length > 16 ? f.label.slice(0, 15) + "…" : f.label)}</text>
        <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="fg-fs">${esc(f.type)}</text></g>
    </svg>`;
  }

  function render() {
    const r = $("fleetGraphRoot"); if (!r) return;
    const V = d().vehicles || [];
    if (!V.length) { r.innerHTML = `<div class="oc"><div class="oc-empty">${icon("network", 22)}<br><b>Add a vehicle, or open the live demo, to see its links.</b></div></div>`; return; }
    const f = G.focus;
    const source = live() ? `<span class="oc-live">GraphQL · live</span>` : `<span class="oc-live warn">Demo data</span>`;
    const total = G.data ? G.data.groups.reduce((s, g) => s + g.nodes.length, 0) : 0;
    r.innerHTML = `<div class="oc">
      <div class="oc-head"><h2>${icon("network", 20)} Fleet Graph</h2>${source}<span class="oc-spacer"></span>
        <select id="fgVeh" aria-label="Start from a vehicle">${V.map(v => { const id = v.dbId || v.id; return `<option value="${esc(id)}" ${f && f.type === "vehicle" && f.id === id ? "selected" : ""}>${esc(v.name)}</option>`; }).join("")}</select>
        <p class="oc-sub">Everything linked to one vehicle, driver or device, followed through the database's own relationships. Click a white-ringed node to make it the centre.</p></div>
      ${G.trail.length > 1 ? `<nav class="fg-trail" aria-label="Path">${G.trail.map((t, i) => `<button type="button" class="oc-chip" data-trail="${i}" aria-pressed="${i === G.trail.length - 1}">${icon((KIND[t.type] || [])[1] || "zap", 13)} ${esc(t.label)}</button>`).join(`<span class="muted">›</span>`)}</nav>` : ""}
      <div class="oc-cols">
        <div class="oc-card fg-canvas">${G.busy ? `<div class="oc-skel fg-skel"></div>` : G.err ? `<div class="oc-empty"><b>Could not load the links.</b><br>${esc(G.err)}</div>` : G.data ? graphSvg(G.data) : ""}</div>
        <div class="oc-stack">
          <div class="oc-card" id="fgSide">${sidePanel()}</div>
          <div class="oc-card"><h3>${icon("filter", 14)} Link types <span class="oc-spacer"></span><span class="muted">${total} records</span></h3>
            <ul class="fg-legend">${(G.data ? G.data.groups : []).filter(g => g.nodes.length).map(g => `<li><i style="--c:${(KIND[g.kind] || ["#94a3b8"])[0]}"></i>${esc(g.label)}<b>${g.nodes.length}</b></li>`).join("")}</ul></div>
          <details class="oc-card fg-query"><summary>${icon("document", 14)} The GraphQL query</summary><pre class="dh-pre">${esc(G.lastQuery)}</pre>
            <p class="muted dh-note">Endpoint: <code>${esc((window.FW_BACKEND && FW_BACKEND.url) || "")}/graphql/v1</code>, with the anon key and the signed-in user's token. Row-level security applies.</p></details>
        </div>
      </div></div>`;
    wire();
  }
  function sidePanel() {
    if (!G.data) return `<h3>Details</h3><p class="muted">Loading…</p>`;
    const n = G.sel || G.data.focus, [col, ic, tab] = KIND[n.type] || ["#94a3b8", "zap", null];
    return `<h3>${icon(ic, 14)} ${esc(n.type)}${n === G.data.focus ? " · centre" : ""}</h3>
      <div class="vz-diag"><b style="color:${col}">${esc(n.label)}</b><p>${esc(n.sub)}</p>${n.detail ? `<p>${esc(n.detail)}</p>` : ""}${n.sev ? `<span class="oc-tag ${esc(n.sev)}">${esc(n.sev)}</span>` : ""}</div>
      <div class="dh-actions">${n.focus && n !== G.data.focus ? `<button type="button" class="btn btn-primary btn-sm" id="fgGo">${icon("network", 14)} Explore its links</button>` : ""}
        ${tab ? `<button type="button" class="btn btn-outline btn-sm" id="fgOpen">Open ${esc(n.type)} page</button>` : ""}</div>`;
  }
  function wire() {
    const r = $("fleetGraphRoot");
    const vs = $("fgVeh"); if (vs) vs.onchange = () => go({ type: "vehicle", id: vs.value, label: vs.options[vs.selectedIndex].text }, true);
    r.querySelectorAll("[data-trail]").forEach(b => b.onclick = () => { const i = +b.dataset.trail; G.trail = G.trail.slice(0, i + 1); G.focus = G.trail[i]; load(G.focus); });
    r.querySelectorAll("[data-node]").forEach(el => {
      const pick = () => {
        const g = G.data.groups.find(x => x.kind === el.dataset.gk), n = g && g.nodes.find(x => x.id === el.dataset.node);
        if (!n) return;
        if (G.sel && G.sel.id === n.id && n.focus) return go({ type: n.type, id: n.id, label: n.label });
        G.sel = n; render();
      };
      el.addEventListener("click", pick);
      el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    });
    const goBtn = $("fgGo"); if (goBtn) goBtn.onclick = () => go({ type: G.sel.type, id: G.sel.id, label: G.sel.label });
    const open = $("fgOpen"); if (open) open.onclick = () => { const n = G.sel || G.data.focus; const tab = (KIND[n.type] || [])[2]; if (tab && window.activateTab) activateTab(tab); };
  }
  function go(focus, reset) {
    G.focus = focus;
    if (reset) G.trail = [focus];
    else { const i = G.trail.findIndex(t => t.type === focus.type && t.id === focus.id); G.trail = i >= 0 ? G.trail.slice(0, i + 1) : [...G.trail, focus]; }
    load(focus);
  }

  window.FleetGraph = {
    open() {
      const V = d().vehicles || [];
      if (!V.length) return render();
      if (!G.focus) { const v = V[0]; return go({ type: "vehicle", id: v.dbId || v.id, label: v.name }, true); }
      render();
    },
  };
})();
