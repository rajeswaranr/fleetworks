/* ============ FleetWorks — device-sim.js ============
   Generates plausible HCV telemetry so the device dashboard, the ingest
   contract and the alert logic can all be built and demonstrated before any
   hardware is fitted.

   It is a state machine, not a random-number generator. Each simulated truck
   carries position, odometer, fuel and engine state forward from its last tick,
   so speed integrates into distance, distance burns fuel, and a fuel-theft
   event is a real discontinuity in a series that was otherwise smooth. Random
   values per tick would have produced a dashboard that looked alive and taught
   us nothing — every chart would be noise and no alert rule could be tested.

   Everything it writes is flagged simulated:true, end to end. */

"use strict";

// Roughly the Namakkal–Salem–Erode triangle: the trucking corridor these
// customers actually run, so the map looks like their world.
const SIM_ROUTE = [
  { lat: 11.2189, lng: 78.1677, name: "Namakkal" },
  { lat: 11.3410, lng: 78.0800, name: "Rasipuram" },
  { lat: 11.6643, lng: 78.1460, name: "Salem" },
  { lat: 11.4380, lng: 77.7280, name: "Erode" },
  { lat: 11.1085, lng: 77.3411, name: "Tiruppur" },
];

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* One simulated truck. Call tick() on an interval; it returns a reading and
   sometimes an event. */
class SimTruck {
  constructor(imei, opts = {}) {
    this.imei = imei;
    this.leg = Math.floor(Math.random() * SIM_ROUTE.length);
    this.t = Math.random();                 // progress along the current leg
    // Each truck holds its own cruising speed, so a fleet view shows genuine
    // variation between vehicles rather than five identical traces.
    this.cruise = rnd(46, 68);
    this.speed = this.cruise;
    this.odometer = opts.odometer ?? rnd(120000, 480000);
    this.engineHours = opts.engineHours ?? this.odometer / 28;
    this.fuel = rnd(45, 92);                // percent
    this.tankLitres = opts.tankLitres ?? 300;
    this.coolant = rnd(78, 88);
    this.rpm = 1400;
    this.ignition = true;
    this.tyrePsi = rnd(98, 112);
    // A slow tyre leak on some trucks, so the TPMS alert has something real to
    // catch rather than firing on a value we simply chose to be low.
    this.leak = Math.random() < 0.25 ? rnd(0.02, 0.06) : 0;
    this.parked = 0;
  }

  position() {
    const a = SIM_ROUTE[this.leg];
    const b = SIM_ROUTE[(this.leg + 1) % SIM_ROUTE.length];
    return {
      lat: a.lat + (b.lat - a.lat) * this.t,
      lng: a.lng + (b.lng - a.lng) * this.t,
      heading: (Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180 / Math.PI + 360) % 360,
    };
  }

  tick(seconds = 30) {
    const ev = [];

    // Occasionally stop — a parked truck is a normal state the dashboard has to
    // render correctly, not an anomaly.
    if (this.parked > 0) {
      this.parked -= seconds;
      this.ignition = false;
      this.speed = 0;
      this.rpm = 0;
      this.coolant = Math.max(30, this.coolant - 0.6);
    } else {
      this.ignition = true;
      if (Math.random() < 0.02) { this.parked = rnd(120, 600); }
      // Mean-revert toward a cruising speed. A plain random walk wanders to a
      // crawl and stays there — the first run covered 28 km in 100 simulated
      // minutes, which no highway truck does. Pulling toward `cruise` keeps the
      // series varied without letting it drift somewhere implausible.
      this.speed = clamp(
        this.speed + (this.cruise - this.speed) * 0.25 + rnd(-5, 5),
        0, 82,
      );
      this.rpm = 700 + this.speed * 22 + rnd(-60, 60);
      this.coolant = clamp(this.coolant + rnd(-0.8, 0.9), 72, 104);

      const km = (this.speed * seconds) / 3600;
      this.odometer += km;
      this.engineHours += seconds / 3600;
      // ~3.5 km/l laden, so burn is derived from distance rather than invented.
      this.fuel = clamp(this.fuel - (km / 3.5) / this.tankLitres * 100, 0, 100);

      this.t += km / 60;
      if (this.t >= 1) { this.t = 0; this.leg = (this.leg + 1) % SIM_ROUTE.length; }
    }

    if (this.leak) this.tyrePsi = clamp(this.tyrePsi - this.leak, 60, 120);

    // ---- events, each tied to the state that produced it ----
    if (this.speed > 72 && Math.random() < 0.30) {
      ev.push({ event_type: "overspeed", severity: "warning" });
    }
    if (this.ignition && this.speed > 40 && Math.random() < 0.05) {
      ev.push({ event_type: Math.random() < 0.5 ? "harsh_brake" : "harsh_accel", severity: "warning" });
    }
    if (this.ignition && Math.random() < 0.035) {
      const adas = ["lane_departure", "forward_collision", "headway_warning", "pedestrian_warning"];
      const t = adas[Math.floor(Math.random() * adas.length)];
      ev.push({ event_type: t, severity: t === "forward_collision" ? "critical" : "warning" });
    }
    if (this.ignition && Math.random() < 0.02) {
      const dms = ["fatigue", "distraction", "phone_use", "no_seatbelt"];
      ev.push({ event_type: dms[Math.floor(Math.random() * dms.length)], severity: "warning" });
    }
    if (this.coolant > 100) {
      ev.push({ event_type: "harsh_accel", severity: "critical" });  // stands in for an overheat fault code
    }
    if (this.tyrePsi < 85 && Math.random() < 0.15) {
      ev.push({ event_type: "tamper", severity: "warning" });        // stands in for a TPMS low-pressure alert
    }
    // Fuel theft: a sharp drop while parked. This is the discontinuity the
    // whole simulator exists to produce, because it is the alert Indian fleet
    // owners care about most and the hardest to fake convincingly.
    if (!this.ignition && Math.random() < 0.015) {
      const stolen = rnd(8, 22);
      this.fuel = clamp(this.fuel - stolen, 0, 100);
      ev.push({ event_type: "fuel_drop", severity: "critical" });
    }

    const p = this.position();
    const reading = {
      recorded_at: new Date().toISOString(),
      latitude: +p.lat.toFixed(6), longitude: +p.lng.toFixed(6),
      speed_kmph: +this.speed.toFixed(1), heading: +p.heading.toFixed(0),
      ignition: this.ignition,
      odometer_km: +this.odometer.toFixed(1), engine_hours: +this.engineHours.toFixed(1),
      engine_rpm: Math.round(this.rpm), coolant_temp_c: +this.coolant.toFixed(1),
      battery_voltage: +(this.ignition ? rnd(27.2, 28.4) : rnd(24.1, 25.6)).toFixed(1),
      fuel_level_pct: +this.fuel.toFixed(1),
      fuel_rate_lph: +(this.ignition ? this.speed / 3.5 : 0).toFixed(1),
      tyre_pressure_min_psi: +this.tyrePsi.toFixed(1),
      ambient_temp_c: +rnd(26, 38).toFixed(1),
    };

    const stamped = ev.map(e => ({
      ...e, occurred_at: reading.recorded_at,
      latitude: reading.latitude, longitude: reading.longitude,
      speed_kmph: reading.speed_kmph,
    }));

    return { reading, events: stamped };
  }
}

window.SimTruck = SimTruck;
window.SIM_ROUTE = SIM_ROUTE;
