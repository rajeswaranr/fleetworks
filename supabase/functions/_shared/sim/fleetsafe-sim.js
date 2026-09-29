/* FleetSafe simulator: one scripted, realistic fleet day, used two ways.
 *
 *   plan()        what a real fleet's hardware would send in the last 24 hours (devices,
 *                 camera channels, sensor mappings, geofences, readings, camera alarms).
 *                 The fleetsafe-simulate edge function pushes it through the LIVE ingest
 *                 pipeline, so everything downstream (rules, geofences, cold chain,
 *                 alerts) is computed by the real backend. Every row is flagged simulated.
 *   demoTables()  the same day as ready-made table rows, for demo mode in the browser
 *                 (signed out), where nothing may be written to the database.
 *
 * Plain JavaScript with no imports or exports: loaded as a classic <script> by the app
 * (served from this path; the repo has .nojekyll) and imported for its side effect by
 * the edge function. It sets globalThis.FleetSafeSim.
 *
 * The story it tells, on real Tamil Nadu corridors:
 *   truck 1  fuel siphoned while parked overnight at the depot (−14%), refuelled at 18:00
 *   truck 2  drives through a restricted quarry road at ~14:00; harsh braking
 *   truck 3  slow tyre leak from 14:00, engine overheating at ~15:30
 *   truck 4  night runs: drowsiness and phone use on camera
 *   truck 5  reefer carrying vaccines: cargo warms to 12.8 °C at ~13:00
 *   all      7 days of ADAS / DMS camera alarms, most older ones already reviewed */
(function (root) {
  "use strict";

  const IST = 5.5 * 3600e3, STEP_MIN = 10, HOURS = 24;
  const ROUTES = [
    { name: "Namakkal – Salem", pts: [[11.2189, 78.1677], [11.341, 78.135], [11.455, 78.156], [11.58, 78.142], [11.6643, 78.146]] },
    { name: "Salem – Sankari – Erode", pts: [[11.6643, 78.146], [11.57, 78.01], [11.474, 77.87], [11.39, 77.78], [11.341, 77.7172]] },
    { name: "Erode – Tiruppur – Coimbatore", pts: [[11.341, 77.7172], [11.23, 77.55], [11.1085, 77.3411], [11.05, 77.15], [11.0168, 76.9558]] },
    { name: "Namakkal – Karur – Trichy", pts: [[11.2189, 78.1677], [11.06, 78.08], [10.9601, 78.0766], [10.88, 78.4], [10.805, 78.6856]] },
    { name: "Salem – Krishnagiri – Hosur", pts: [[11.6643, 78.146], [11.94, 78.13], [12.1277, 78.158], [12.5186, 78.2137], [12.7409, 77.8253]] },
    { name: "Coimbatore – Pollachi", pts: [[11.0168, 76.9558], [10.9, 76.98], [10.78, 77.0], [10.6589, 77.0085]] },
  ];
  const TANK_CAL = [[0, 0], [800, 70], [1600, 150], [2400, 235], [3200, 320], [4095, 400]];   // LLS raw → litres, 400 L tank
  const SCEN = ["forward_collision", "fatigue", "phone_use", "lane_departure"];
  const EVENT_MIX = [["harsh_brake", 5], ["lane_departure", 4], ["headway_warning", 4], ["phone_use", 2], ["distraction", 2],
    ["forward_collision", 1], ["fatigue", 1], ["no_seatbelt", 1], ["smoking", 1], ["harsh_corner", 2]];
  const SEV = { forward_collision: "critical", fatigue: "critical", pedestrian_warning: "critical", harsh_brake: "warning", lane_departure: "warning",
    headway_warning: "warning", phone_use: "warning", distraction: "warning", no_seatbelt: "warning", smoking: "warning", harsh_corner: "warning", overspeed: "warning" };
  const WEIGHT = { forward_collision: 5, fatigue: 5, phone_use: 3, distraction: 2, lane_departure: 2, headway_warning: 2, harsh_brake: 2,
    harsh_corner: 1, overspeed: 2, no_seatbelt: 1, smoking: 1 };

  // ── helpers ──
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const hav = (a, b) => { const R = 6371, dLa = (b[0] - a[0]) * Math.PI / 180, dLo = (b[1] - a[1]) * Math.PI / 180;
    const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  function route(r) { const seg = []; let tot = 0; for (let i = 1; i < r.pts.length; i++) { const d = hav(r.pts[i - 1], r.pts[i]); seg.push(d); tot += d; } return { ...r, seg, tot }; }
  function along(rt, km) {   // ping-pong along the route; returns position and heading
    const cyc = km % (2 * rt.tot), back = cyc > rt.tot; let d = back ? 2 * rt.tot - cyc : cyc;
    for (let i = 0; i < rt.seg.length; i++) {
      if (d <= rt.seg[i] || i === rt.seg.length - 1) {
        const f = Math.min(1, d / rt.seg[i]), a = rt.pts[i], b = rt.pts[i + 1];
        const lat = a[0] + (b[0] - a[0]) * f, lng = a[1] + (b[1] - a[1]) * f;
        let hd = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; if (back) hd += 180;
        return { lat: +lat.toFixed(5), lng: +lng.toFixed(5), heading: Math.round((hd + 360) % 360) };
      }
      d -= rt.seg[i];
    }
    return { lat: rt.pts[0][0], lng: rt.pts[0][1], heading: 0 };
  }
  const istHour = t => { const d = new Date(t + IST); return d.getUTCHours() + d.getUTCMinutes() / 60; };
  const iso = t => new Date(t).toISOString();
  const r1 = v => Math.round(v * 10) / 10;
  const lls = litres => { for (let i = 1; i < TANK_CAL.length; i++) if (litres <= TANK_CAL[i][1]) { const [x0, y0] = TANK_CAL[i - 1], [x1, y1] = TANK_CAL[i]; return Math.round(x0 + (x1 - x0) * (litres - y0) / (y1 - y0)); } return 4095; };
  let _uid = 0; const uid = (r) => "00000000-0000-4000-8000-" + (++_uid).toString(16).padStart(12, "0").slice(-12).replace(/^/, "").padStart(12, "0");

  // ── the plan ──
  function plan(opts) {
    const vehicles = (opts.vehicles || []).slice(0, 6);
    const drivers = opts.drivers || [];
    const now = Math.floor((opts.now || Date.now()) / 60000) * 60000;
    const rand = rng(opts.seed || 7);
    const out = { devices: [], channels: [], sensors: [], geofences: [], coldChain: [], assets: [], readings: {}, events: {}, lastPositions: [], script: [] };

    vehicles.forEach((v, i) => {
      const role = ["fuel_theft", "restricted_zone", "tyre_engine", "night_driver", "reefer", "normal"][i];
      const rt = route(ROUTES[i % ROUTES.length]);
      const ref = "D" + (i + 1);
      const imei = "SIM" + String(8620950 + i * 1117).padStart(7, "0") + String(i + 1).padStart(5, "0");
      out.devices.push({ ref, vehicle_id: v.id, imei, kind: "mdvr", protocol: "jt808", integration: "flespi", vendor: "Simulated", model: "4-ch AI MDVR", role, route: rt.name });
      out.channels.push({ device_ref: ref, channel_no: 1, role: "front_road", label: "Road ADAS" }, { device_ref: ref, channel_no: 2, role: "cabin_dms", label: "Driver DMS" });
      if (i === 1) out.channels.push({ device_ref: ref, channel_no: 3, role: "surround_avm", label: "360° stitch" });
      if (role === "reefer") out.channels.push({ device_ref: ref, channel_no: 3, role: "cargo", label: "Reefer cargo" });
      out.sensors.push({ device_ref: ref, source_key: "escort_lls_1", signal_path: "Vehicle.Powertrain.FuelSystem.AbsoluteLevel", transform: "table", calibration: TANK_CAL, label: "Escort LLS fuel sensor" });
      if (role === "reefer") {
        out.sensors.push({ device_ref: ref, source_key: "io_72", signal_path: "Vehicle.Cargo.Temperature", transform: "linear", scale: 0.1, offset: 0, label: "Reefer probe (0.1 °C)" });
        out.coldChain.push({ vehicle_id: v.id, product_type: "vaccines", min_temp: 2, max_temp: 8, sensor_id: "SIM-REEFER-" + imei });
      }
      if (i === 0) out.geofences.push({ ref: "G-DEPOT", name: "Namakkal depot", purpose: "depot", centre_lat: 11.2189, centre_lng: 78.1677, radius_m: 900, alert_on: "none" });

      // ── 24 h of readings, every 10 minutes ──
      const cruise = 46 + (i * 5) % 20, rows = [];
      let km = rand() * rt.tot * 0.3, fuelL = 250 + rand() * 80, odo = 180000 + i * 41234, psi = 104 + rand() * 4, prevDrive = false;
      const t0 = now - HOURS * 3600e3, once = new Set();
      const first = k => (once.has(k) ? false : (once.add(k), true));      // the window's two ends share a time of day
      for (let t = t0; t <= now; t += STEP_MIN * 60000) {
        const h = istHour(t);
        let parked = role === "night_driver" ? (h >= 9 && h < 16) : (h >= 22 || h < 5.5);
        const lunch = !parked && h >= 13 && h < 13.5 && role !== "reefer";                              // lunch: standing, engine and AC on
        if (lunch) parked = true;
        if (role === "fuel_theft" && h >= 18 && h < 18.34) parked = true;                                // at the pump
        const ign = !parked || lunch;
        const speed = parked ? 0 : Math.max(8, Math.round(cruise + (rand() - 0.5) * 22 + (i === 2 && h > 11 && h < 11.3 ? 26 : 0)));
        if (!parked) km += speed * STEP_MIN / 60;
        const pos = parked && role !== "night_driver" && (h >= 22 || h < 5.5) && i === 0 ? { lat: 11.2192, lng: 78.1681, heading: 0 } : along(rt, km);
        // fuel: burn, the overnight theft, the evening refill
        if (ign) fuelL -= speed * STEP_MIN / 60 / 3.4 + 0.2;                                             // ~3.4 km/l loaded
        if (role === "fuel_theft" && h >= 1.5 && h < 1.5 + STEP_MIN / 60 && first("theft")) { const before = fuelL; fuelL -= 56; out.script.push({ kind: "fuel_theft", vehicle_id: v.id, device_ref: ref, at: t, from_l: before, to_l: fuelL }); }
        if (role === "fuel_theft" && h >= 18.17 && h < 18.17 + STEP_MIN / 60 && first("refill")) { fuelL = 380; out.script.push({ kind: "refuel", vehicle_id: v.id, at: t }); }
        // drivers fill up when the tank drops below a quarter, like real ones do
        if (ign && fuelL < 100 && role !== "fuel_theft") { fuelL = 360 + rand() * 30; out.script.push({ kind: "refuel", vehicle_id: v.id, at: t }); }
        fuelL = Math.max(20, Math.min(398, fuelL));
        // tyres: slow leak on truck 3
        if (role === "tyre_engine" && h >= 14 && h < 14.7 && psi > 85) { psi -= 5.5; if (h < 14 + STEP_MIN / 60 && first("tyre")) out.script.push({ kind: "tyre_leak", vehicle_id: v.id, at: t }); }
        let ect = ign ? 84 + rand() * 6 : 38 + rand() * 4;
        if (role === "tyre_engine" && h >= 15.5 && h < 15.84) { ect = 107 + (h - 15.5) * 18; if (h < 15.5 + STEP_MIN / 60 && first("heat")) out.script.push({ kind: "overheat", vehicle_id: v.id, at: t }); }
        const rpm = ign ? (speed ? 1300 + speed * 9 + Math.round(rand() * 120) : 720) : 0;
        odo += ign ? speed * STEP_MIN / 60 : 0;
        const row = {
          recorded_at: iso(t), latitude: pos.lat, longitude: pos.lng, heading: pos.heading, speed_kmph: speed, ignition: ign,
          engine_rpm: rpm, coolant_temp_c: r1(ect), battery_voltage: r1(ign ? 27.6 + rand() * 0.4 : 25.2 + rand() * 0.3),
          fuel_level_pct: r1(fuelL / 400 * 100), escort_lls_1: lls(fuelL), fuel_rate_lph: ign ? r1(speed ? 14 + speed / 8 + rand() * 2 : 2.4) : 0,
          odometer_km: r1(odo), tyre_pressure_min_psi: r1(psi + (rand() - 0.5)),
        };
        if (role === "reefer") {
          let c = 4.2 + (rand() - 0.5) * 0.8;
          if (h >= 13 && h < 13.7) { c = 6 + (h - 13) * 10; if (h < 13 + STEP_MIN / 60 && first("cargo")) out.script.push({ kind: "cargo_breach", vehicle_id: v.id, at: t }); }
          row.io_72 = Math.round(c * 10);
        }
        if (role === "restricted_zone" && !parked && h >= 14 && h < 14 + STEP_MIN / 60 && !out.geofences.some(g => g.ref === "G-QUARRY")) {
          out.geofences.push({ ref: "G-QUARRY", name: "Restricted: Sankari quarry road", purpose: "restricted", centre_lat: pos.lat, centre_lng: pos.lng, radius_m: 450, alert_on: "both" });
        }
        if (role === "restricted_zone" && !out.geofences.some(g => g.ref === "G-PLANT") && h >= 10 && h < 10 + STEP_MIN / 60 && !parked) {
          out.geofences.push({ ref: "G-PLANT", name: "Customer: Salem steel plant", purpose: "customer", centre_lat: pos.lat, centre_lng: pos.lng, radius_m: 600, alert_on: "enter" });
        }
        prevDrive = ign;
        rows.push(row);
      }
      out.readings[ref] = rows;
      const last = rows[rows.length - 1];
      const drv = drivers.find(d => d.vehicle_id === v.id);
      out.lastPositions.push({ vehicle_id: v.id, driver_id: drv ? drv.id : null, latitude: last.latitude, longitude: last.longitude, speed_kmph: last.speed_kmph, recorded_at: last.recorded_at });

      // ── 7 days of camera alarms during driving hours ──
      const evs = [];
      const count = role === "night_driver" ? 12 : 5 + Math.floor(rand() * 5);
      const pool = []; EVENT_MIX.forEach(([t, w]) => { for (let k = 0; k < w; k++) pool.push(t); });
      for (let k = 0; k < count; k++) {
        let type = pool[Math.floor(rand() * pool.length)];
        if (role === "night_driver" && k < 4) type = k % 2 ? "phone_use" : "fatigue";
        const day = Math.floor(rand() * 7), hr = role === "night_driver" ? (rand() < 0.6 ? 1 + rand() * 4 : 17 + rand() * 4) : 7 + rand() * 13;
        let t = now - day * 864e5;
        t = t - ((istHour(t) - hr + 24) % 24) * 3600e3;
        if (t > now - 5 * 60000) t -= 864e5;
        const p = along(rt, Math.abs((t - t0) / 3600e3 * cruise) + km * 0.2);
        evs.push({ event_type: type, severity: SEV[type] || "warning", occurred_at: iso(t), latitude: p.lat, longitude: p.lng, speed_kmph: 30 + Math.round(rand() * 35),
          video_url: SCEN.includes(type) ? "simulated:" + type : null, raw: { scenario: SCEN.includes(type) ? type : null, camera: /fatigue|phone|distraction|smoking|seatbelt/.test(type) ? "cabin_dms" : "front_road", confidence: +(0.82 + rand() * 0.15).toFixed(2), simulated: true } });
      }
      evs.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
      out.events[ref] = evs;
    });
    if (vehicles.length) {
      out.assets.push({ name: "SIM Trailer 40ft-01", asset_type: "trailer", make: "Simulated", model: "40 ft flatbed", towed_by_vehicle_id: vehicles[0].id, status: "active", base_location: "Namakkal depot" },
        { name: "SIM Reefer genset", asset_type: "genset", make: "Simulated", model: "Carrier 10 kVA", towed_by_vehicle_id: vehicles[Math.min(4, vehicles.length - 1)].id, status: "active", base_location: "Salem" },
        { name: "SIM Container 20ft-07", asset_type: "container", make: "Simulated", model: "20 ft dry", towed_by_vehicle_id: null, status: "idle", base_location: "Namakkal depot" });
    }
    return out;
  }

  // ── demo mode: the same day as table rows ─────────────────────────────
  function demoTables(opts) {
    _uid = 0;
    const p = plan(opts), now = opts.now || Date.now(), org = "demo-org";
    const veh = new Map((opts.vehicles || []).map(v => [v.id, v]));
    const drvFor = vid => (opts.drivers || []).find(d => d.vehicle_id === vid);
    const T = { devices: [], device_channels: [], device_sensors: [], telemetry: [], device_events: [], v_safety_events: [], ai_events: [], geofences: [],
      geofence_events: [], fleet_alerts: [], vehicle_twin: [], driver_locations: [], assets: [], integration_keys: [], ingest_log: [], fleetsafe_settings: [],
      v_driver_safety_score: [], coaching_sessions: [], incident_analyses: [], cold_chain_vehicles: [], device_media: [], vehicle_signals: SIGNALS };
    const devId = {};
    p.devices.forEach(d => { const id = uid(); devId[d.ref] = id; T.devices.push({ id, org_id: org, vehicle_id: d.vehicle_id, imei: d.imei, kind: d.kind, protocol: d.protocol, integration: d.integration, vendor: d.vendor, model: d.model, status: "active", simulated: true, last_seen_at: iso(now - 40000), created_at: iso(now - 20 * 864e5), capabilities: ["gps", "adas", "dms", "fuel_level"] }); });
    p.channels.forEach(c => T.device_channels.push({ id: uid(), org_id: org, device_id: devId[c.device_ref], vehicle_id: p.devices.find(d => d.ref === c.device_ref).vehicle_id, channel_no: c.channel_no, role: c.role, label: c.label, live_url: null, enabled: true }));
    p.sensors.forEach(s => T.device_sensors.push({ id: uid(), org_id: org, device_id: devId[s.device_ref], source_key: s.source_key, signal_path: s.signal_path, transform: s.transform, scale: s.scale ?? null, offset: s.offset ?? null, calibration: s.calibration ?? null, label: s.label, enabled: true }));
    const gid = {};
    p.geofences.forEach(g => { const id = uid(); gid[g.ref] = id; T.geofences.push({ id, org_id: org, name: g.name, purpose: g.purpose, centre_lat: g.centre_lat, centre_lng: g.centre_lng, radius_m: g.radius_m, alert_on: g.alert_on, is_active: true, simulated: true }); });
    p.coldChain.forEach(c => T.cold_chain_vehicles.push({ id: uid(), org_id: org, ...c, is_active: true, current_temperature_celsius: 4.4, last_reading_at: iso(now) }));
    p.assets.forEach(a => T.assets.push({ id: uid(), org_id: org, ...a, simulated: true }));

    const alert = (a) => T.fleet_alerts.push({ id: uid(), org_id: org, simulated: true, delivery: "in_app", read_at: null, ...a });
    p.devices.forEach(d => {
      const id = devId[d.ref], rows = p.readings[d.ref], drv = drvFor(d.vehicle_id), v = veh.get(d.vehicle_id);
      const cargoMap = p.sensors.find(s => s.device_ref === d.ref && s.source_key === "io_72");
      rows.forEach((r, k) => {
        const { escort_lls_1, io_72, ...cols } = r;
        T.telemetry.push({ id: k + 1, device_id: id, org_id: org, ...cols, cargo_temp_c: cargoMap && io_72 != null ? io_72 / 10 : null, raw: r, simulated: true });
      });
      // geofence edges, exactly as the database trigger computes them
      const inside = {};
      rows.forEach(r => T.geofences.forEach(g => {
        const now_in = hav([r.latitude, r.longitude], [g.centre_lat, g.centre_lng]) * 1000 <= g.radius_m;
        if (inside[g.id] === undefined) { inside[g.id] = { in: now_in, since: r.recorded_at }; if (!now_in) return; }
        else if (inside[g.id].in === now_in) return;
        const dwell = !now_in ? Math.round((Date.parse(r.recorded_at) - Date.parse(inside[g.id].since)) / 1000) : null;
        const ev = { id: uid(), org_id: org, geofence_id: g.id, vehicle_id: d.vehicle_id, driver_id: drv ? drv.id : null, direction: now_in ? "enter" : "exit", occurred_at: r.recorded_at, latitude: r.latitude, longitude: r.longitude, dwell_seconds: dwell };
        T.geofence_events.push(ev);
        inside[g.id] = { in: now_in, since: r.recorded_at };
        if (g.alert_on === "both" || g.alert_on === ev.direction || (g.purpose === "restricted" && now_in)) {
          const crit = g.purpose === "restricted" && now_in;
          alert({ vehicle_id: d.vehicle_id, kind: "geofence", source: "geofence_events", source_id: ev.id, severity: crit ? "critical" : "info", title: `${v ? v.name : "Vehicle"} ${now_in ? "entered" : "left"} ${g.name}`, body: dwell ? `Was inside for ${Math.round(dwell / 60)} min.` : crit ? "This is a restricted zone." : null, created_at: r.recorded_at });
        }
      }));
      // camera alarms
      p.events[d.ref].forEach(e => {
        const eid = uid(), old = Date.parse(e.occurred_at) < now - 2 * 864e5;
        const ack = old && (e.severity !== "critical" || Math.random() < 0.7) ? iso(Date.parse(e.occurred_at) + 3 * 3600e3) : null;
        const row = { id: eid, device_id: id, org_id: org, ...e, acknowledged_at: ack, simulated: true, created_at: e.occurred_at };
        T.device_events.push(row);
        T.v_safety_events.push({ ...row, vehicle_id: d.vehicle_id, driver_id: drv ? drv.id : null, attribution: "assignment", weight: WEIGHT[e.event_type] || 1, is_coachable: true });
        alert({ vehicle_id: d.vehicle_id, kind: "incident", source: "device_events", source_id: eid, severity: e.severity, title: `${LABEL[e.event_type] || e.event_type}: ${v ? v.name : "vehicle"}`, body: `${e.speed_kmph} km/h${e.video_url ? " · clip recorded" : ""}`, created_at: e.occurred_at, read_at: ack });
      });
      // live twin
      const last = rows[rows.length - 1], cc = cargoMap && last.io_72 != null ? last.io_72 / 10 : null, st = {};
      const put = (k, val) => { if (val != null) st[k] = { v: val, ts: last.recorded_at }; };
      put("Vehicle.CurrentLocation.Latitude", last.latitude); put("Vehicle.CurrentLocation.Longitude", last.longitude); put("Vehicle.Speed", last.speed_kmph);
      put("Vehicle.Powertrain.FuelSystem.RelativeLevel", last.fuel_level_pct); put("Vehicle.Powertrain.FuelSystem.AbsoluteLevel", Math.round(last.fuel_level_pct * 4));
      put("Vehicle.Powertrain.CombustionEngine.IsRunning", last.ignition); put("Vehicle.Chassis.Tyre.MinPressure", last.tyre_pressure_min_psi); put("Vehicle.Cargo.Temperature", cc);
      T.vehicle_twin.push({ device_id: id, org_id: org, vehicle_id: d.vehicle_id, state: st, health: { fuel: 100, tyres: 100, engine: 100, driver: 100 }, last_reading_at: last.recorded_at, simulated: true });
      T.ingest_log.push({ id: T.ingest_log.length + 1, org_id: org, endpoint: "device-ingest", format: "flespi", ident: d.imei, status: "ok", readings: 6, events: 0, media: 0, received_at: iso(now - 40000 - T.ingest_log.length * 9000) });
    });
    // scripted vehicle-sensor detections, as the rules engine writes them
    p.script.forEach(s => {
      const d = p.devices.find(x => x.vehicle_id === s.vehicle_id), id = devId[d.ref], v = veh.get(s.vehicle_id);
      const mk = (event_type, severity, confidence, summary, evidence, signal_path) => {
        const aid = uid();
        T.ai_events.push({ id: aid, org_id: org, device_id: id, vehicle_id: s.vehicle_id, occurred_at: iso(s.at), event_type, signal_path, severity, confidence, summary, evidence, model: "rules-v1", simulated: true, acknowledged_at: null });
        alert({ vehicle_id: s.vehicle_id, kind: event_type === "cargo_temp_breach" ? "cold_chain" : "incident", source: "ai_events", source_id: aid, severity, title: `${LABEL[event_type]}: ${v ? v.name : "vehicle"}`, body: summary, created_at: iso(s.at) });
        return aid;
      };
      if (s.kind === "fuel_theft") {
        const drop = +((s.from_l - s.to_l) / 4).toFixed(1);
        const aid = mk("fuel_theft", "critical", 0.9, `Fuel fell ${drop}% while the vehicle was stationary.`, { from_pct: +(s.from_l / 4).toFixed(1), to_pct: +(s.to_l / 4).toFixed(1), drop_pct: drop, minutes: 10, ignition: false, speed_kmph: 0 }, "Vehicle.AI.Fuel.FuelTheftProbability");
        T.incident_analyses.push({ id: uid(), org_id: org, source: "ai", event_id: aid, vehicle_id: s.vehicle_id, confidence: "high", est_loss_inr: 5152, model: "claude-opus-5", created_at: iso(s.at + 20 * 60000),
          root_cause: `About 56 L left the tank in 10 minutes at 01:30 while ${v ? v.name : "the truck"} was parked at the depot with the engine off. A parked engine cannot burn that; this is siphoning or a punctured tank.`,
          risk: "About ₹5,152 of diesel lost, and a damaged cap or sender invites repeat theft.", action: "Call the driver and the depot watchman now, check the tank cap seal and CCTV for 01:20–01:40, and compare with the last diesel bill. If the seal is broken, file a police complaint with this curve.",
          compliance: "Keep the sensor curve, time and location as evidence for the police complaint and any insurance claim.", facts: { readings_around_event: new Array(12) } });
      }
      if (s.kind === "tyre_leak") mk("tyre_pressure_loss", "critical", 0.82, "Tyre pressure fell 11.0 psi in 20 minutes (now 93 psi): likely puncture or slow leak.", { from_psi: 104, to_psi: 93, lost_psi: 11, minutes: 20 }, "Vehicle.AI.Tyre.PunctureProbability");
      if (s.kind === "overheat") mk("engine_overheat", "critical", 0.68, "Coolant temperature is 112 °C.", { coolant_temp_c: 112, warn_at: 105, critical_at: 112 }, "Vehicle.AI.Maintenance.EngineFailureProbability");
      if (s.kind === "cargo_breach") mk("cargo_temp_breach", "critical", 0.95, "Cargo is at 12.8 °C; vaccines must stay between 2.0 and 8.0 °C.", { temp_c: 12.8, min_c: 2, max_c: 8, deviation_c: 4.8, product: "vaccines" }, "Vehicle.Cargo.Temperature");
    });
    // one tracker that has gone quiet, so the health check has something to show
    if (T.devices[5]) { T.devices[5].last_seen_at = iso(now - 95 * 60000); alert({ vehicle_id: T.devices[5].vehicle_id, kind: "device_offline", source: "devices", severity: "warning", title: `Tracker offline: ${(veh.get(T.devices[5].vehicle_id) || {}).name || T.devices[5].imei}`, body: "No data for 95 min. It may be switched off, out of coverage or removed.", created_at: iso(now - 65 * 60000) }); }
    p.lastPositions.forEach(l => T.driver_locations.push({ id: T.driver_locations.length + 1, org_id: org, ...l, source: "device", simulated: true }));
    // driver scores, by the view's formula (penalty per 1000 km over 30 days)
    (opts.drivers || []).forEach(dr => {
      const evs = T.v_safety_events.filter(e => e.driver_id === dr.id), km = 5200 + ((dr.name || "").length * 173) % 2400;
      const pen = evs.reduce((s, e) => s + e.weight, 0), per = pen * 1000 / km;
      T.v_driver_safety_score.push({ driver_id: dr.id, org_id: org, driver_name: dr.name, vehicle_id: dr.vehicle_id, events_30d: evs.length, critical_30d: evs.filter(e => e.severity === "critical").length,
        unreviewed_30d: evs.filter(e => !e.acknowledged_at).length, km_30d: km, penalty_per_1000km: +per.toFixed(2), safety_score: Math.max(0, Math.min(100, Math.round(100 - per * 2.5 * 4))),
        band: per <= 1 ? "excellent" : per <= 2.5 ? "good" : per <= 5 ? "needs_coaching" : "at_risk" });
    });
    const fat = T.v_safety_events.find(e => e.event_type === "fatigue" && e.driver_id);
    if (fat) T.coaching_sessions.push({ id: uid(), org_id: org, driver_id: fat.driver_id, event_id: fat.id, vehicle_id: fat.vehicle_id, event_type: "fatigue", severity: "critical", status: "assigned", assigned_at: iso(Date.parse(fat.occurred_at) + 5 * 3600e3), simulated: true });
    T.integration_keys.push({ id: uid(), org_id: org, name: "flespi stream (demo)", key_prefix: "fwk_demo0000", created_at: iso(now - 12 * 864e5), last_used_at: iso(now - 40000), revoked_at: null });
    T.ingest_log.push({ id: 99, org_id: org, endpoint: "device-ingest", format: "traccar", ident: "869727079043551", status: "unknown_device", detail: "No device registered with IMEI or ID 869727079043551 in this fleet. Add it under Devices & Telemetry.", readings: 0, events: 0, media: 0, received_at: iso(now - 17 * 60000) });
    T.fleet_alerts.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return T;
  }

  const LABEL = { fuel_theft: "Fuel theft", tyre_pressure_loss: "Tyre pressure loss", engine_overheat: "Engine overheating", cargo_temp_breach: "Cargo temperature out of range",
    forward_collision: "Forward collision warning", fatigue: "Driver drowsiness", phone_use: "Phone use while driving", lane_departure: "Lane departure",
    headway_warning: "Following too close", harsh_brake: "Harsh braking", harsh_corner: "Harsh cornering", distraction: "Driver distraction",
    no_seatbelt: "No seatbelt", smoking: "Smoking in cab", overspeed: "Overspeeding" };
  const SIGNALS = [
    { path: "Vehicle.Powertrain.FuelSystem.AbsoluteLevel", unit: "l", description: "Fuel in the tank, litres" },
    { path: "Vehicle.Powertrain.FuelSystem.RelativeLevel", unit: "percent", description: "Fuel tank level" },
    { path: "Vehicle.Cargo.Temperature", unit: "celsius", description: "Cargo or reefer temperature" },
    { path: "Vehicle.Chassis.Tyre.MinPressure", unit: "psi", description: "Lowest tyre pressure" },
    { path: "Vehicle.Cargo.Door.IsOpen", unit: null, description: "Cargo door switch" },
    { path: "Vehicle.Driver.Identifier.Subject", unit: null, description: "Driver ID from an RFID card or iButton" },
    { path: "Vehicle.Powertrain.CombustionEngine.ECT", unit: "celsius", description: "Engine coolant temperature" },
  ];

  root.FleetSafeSim = { plan, demoTables, TANK_CAL };
})(typeof globalThis !== "undefined" ? globalThis : this);
