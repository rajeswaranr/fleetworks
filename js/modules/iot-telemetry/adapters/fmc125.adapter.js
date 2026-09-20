/* Teltonika FMC125 -> FleetWorks normalized telemetry adapter.
   Values reflect capabilities documented in DS-FMC125 v2.1. The device's
   Teltonika AVL Codec 8/8E decoder should map its I/O element IDs into the
   descriptive `io` names accepted here before calling normalize(). */
(function (root, factory) {
  const adapter = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = adapter;
  root.FWFmc125 = adapter;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const number = value => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function normalize(packet) {
    const io = packet.io || {};
    const fuelPct = number(io.fuel_level_pct ?? io.rs485_lls_fuel_pct ?? io.analog_lls_fuel_pct);
    return {
      recorded_at: packet.recorded_at || new Date().toISOString(),
      latitude: number(packet.latitude),
      longitude: number(packet.longitude),
      speed_kmph: number(packet.speed_kmph),
      heading: number(packet.heading),
      ignition: typeof io.ignition === "boolean" ? io.ignition : Boolean(io.digital_input_1),
      odometer_km: number(io.odometer_km),
      engine_hours: number(io.engine_hours),
      engine_rpm: number(io.engine_rpm),
      coolant_temp_c: number(io.coolant_temp_c),
      battery_voltage: number(io.external_voltage_v),
      fuel_level_pct: fuelPct === null ? null : clamp(fuelPct, 0, 100),
      fuel_rate_lph: number(io.impulse_fuel_rate_lph),
      ambient_temp_c: number(io.ble_temperature_c),
      raw: {
        vendor: "Teltonika", model: "FMC125", codec: packet.codec || "decoded",
        priority: packet.priority || 0, satellites: number(packet.satellites),
        gsm_signal: number(io.gsm_signal), movement: Boolean(io.movement),
        rs232_mode: io.rs232_mode || null, rs485_mode: io.rs485_mode || null,
        fuel_source: io.fuel_source || (io.rs485_lls_fuel_pct != null ? "RS485 digital LLS" : "unknown"),
        original: packet,
      },
    };
  }

  function deriveEvents(current, previous) {
    const events = [];
    const base = {
      occurred_at: current.recorded_at, latitude: current.latitude,
      longitude: current.longitude, speed_kmph: current.speed_kmph,
    };
    if ((current.speed_kmph || 0) > 70) events.push({ ...base, event_type: "overspeed", severity: "warning" });
    if (current.raw.original.io?.crash_detected) events.push({ ...base, event_type: "harsh_brake", severity: "critical", source: "accelerometer_crash" });
    if (current.raw.original.io?.towing_detected) events.push({ ...base, event_type: "tamper", severity: "warning", source: "towing" });
    if (current.raw.original.io?.unplug_detected) events.push({ ...base, event_type: "power_cut", severity: "critical", source: "unplug" });
    if (previous && current.ignition === false && previous.fuel_level_pct != null && current.fuel_level_pct != null) {
      const drop = previous.fuel_level_pct - current.fuel_level_pct;
      if (drop >= 8) events.push({ ...base, event_type: "fuel_drop", severity: "critical", fuel_drop_pct: +drop.toFixed(1), source: "RS485 digital LLS" });
    }
    return events;
  }

  function samplePacket(index = 0, options = {}) {
    const parked = options.parked ?? index >= 4;
    const fuel = options.fuel_level_pct ?? (parked && index >= 5 ? 58.6 : 72.5 - index * 0.18);
    return {
      codec: "Codec8E-decoded", priority: index === 3 ? 1 : 0,
      recorded_at: options.recorded_at || new Date(Date.now() - Math.max(0, 5 - index) * 60000).toISOString(),
      latitude: +(11.2189 + Math.min(index, 4) * 0.0092).toFixed(6),
      longitude: +(78.1677 - Math.min(index, 4) * 0.0078).toFixed(6),
      speed_kmph: parked ? 0 : [48, 56, 64, 76][index % 4],
      heading: 318, satellites: 15,
      io: {
        ignition: !parked, digital_input_1: !parked, movement: !parked,
        external_voltage_v: parked ? 24.8 : 27.9,
        gsm_signal: 4, odometer_km: +(184220.2 + index * 0.7).toFixed(1),
        engine_hours: +(6250.1 + index * 0.02).toFixed(2),
        engine_rpm: parked ? 0 : 1560 + index * 35,
        coolant_temp_c: parked ? 82.1 : 87.4,
        rs485_lls_fuel_pct: +fuel.toFixed(1), fuel_source: "RS485 digital LLS",
        impulse_fuel_rate_lph: parked ? 0 : 15.8,
        ble_temperature_c: 31.4, rs485_mode: "LLS",
        crash_detected: index === 3, unplug_detected: false, towing_detected: false,
      },
    };
  }

  function sampleBatch(count = 6) {
    const readings = [], events = [];
    let previous = null;
    for (let index = 0; index < count; index++) {
      const reading = normalize(samplePacket(index));
      readings.push(reading);
      events.push(...deriveEvents(reading, previous));
      previous = reading;
    }
    return { imei: "861100000000125", readings, events };
  }

  return { model: "FMC125", normalize, deriveEvents, samplePacket, sampleBatch };
});
