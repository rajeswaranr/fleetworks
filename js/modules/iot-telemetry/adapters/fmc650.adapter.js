/* Teltonika FMC650 -> FleetWorks normalized telemetry adapter.
   Based on Datasheet FMC650 v2.4. A Codec 8/8E decoder maps numeric Teltonika
   AVL I/O IDs into the descriptive `io` names consumed here. Advanced J1939,
   tachograph and peripheral values remain in raw.fmc650 for later analysis. */
(function (root, factory) {
  const adapter = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = adapter;
  root.FWFmc650 = adapter;
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
    const fuel = number(io.fuel_level_pct ?? io.can_fms_fuel_pct ?? io.rs485_lls_fuel_pct ?? io.ultrasonic_fuel_pct);
    const tyreValues = Array.isArray(io.tpms_psi) ? io.tpms_psi.map(number).filter(v => v !== null) : [];
    return {
      recorded_at: packet.recorded_at || new Date().toISOString(),
      latitude: number(packet.latitude), longitude: number(packet.longitude),
      speed_kmph: number(packet.speed_kmph), heading: number(packet.heading),
      ignition: typeof io.ignition === "boolean" ? io.ignition : Boolean(io.digital_input_1),
      odometer_km: number(io.odometer_km), engine_hours: number(io.engine_hours),
      engine_rpm: number(io.j1939_engine_rpm), coolant_temp_c: number(io.j1939_coolant_temp_c),
      battery_voltage: number(io.external_voltage_v),
      fuel_level_pct: fuel === null ? null : clamp(fuel, 0, 100),
      fuel_rate_lph: number(io.j1939_fuel_rate_lph),
      tyre_pressure_min_psi: tyreValues.length ? Math.min(...tyreValues) : number(io.tyre_pressure_min_psi),
      ambient_temp_c: number(io.ble_temperature_c), cargo_temp_c: number(io.cargo_temperature_c),
      raw: {
        vendor: "Teltonika", model: "FMC650", codec: packet.codec || "decoded",
        priority: packet.priority || 0, satellites: number(packet.satellites),
        gnss_band: packet.gnss_band || "L1+L5", gsm_signal: number(io.gsm_signal),
        movement: Boolean(io.movement), fuel_source: io.fuel_source || "CAN FMS (J1939)",
        fmc650: {
          j1939_engine_load_pct: number(io.j1939_engine_load_pct),
          j1939_total_fuel_l: number(io.j1939_total_fuel_l),
          j1708_total_distance_km: number(io.j1708_total_distance_km),
          tacho_driver_card: io.tacho_driver_card || null,
          tacho_driver_state: io.tacho_driver_state || null,
          tacho_speed_kmph: number(io.tacho_speed_kmph),
          tacho_download_ready: Boolean(io.tacho_download_ready),
          tpms_psi: tyreValues,
          rs232_1_mode: io.rs232_1_mode || null, rs232_2_mode: io.rs232_2_mode || null,
          rs485_mode: io.rs485_mode || null, can1_active: Boolean(io.can1_active),
          can2_active: Boolean(io.can2_active), backup_battery_pct: number(io.backup_battery_pct),
          external_gnss_antenna: io.external_gnss_antenna !== false,
          external_cellular_antenna: io.external_cellular_antenna !== false,
        },
        original: packet,
      },
    };
  }

  function deriveEvents(current, previous) {
    const io = current.raw.original.io || {};
    const base = { occurred_at: current.recorded_at, latitude: current.latitude,
      longitude: current.longitude, speed_kmph: current.speed_kmph };
    const events = [];
    if ((current.speed_kmph || 0) > 70) events.push({ ...base, event_type: "overspeed", severity: "warning", source: "FMC650 scenario" });
    if (io.crash_detected) events.push({ ...base, event_type: "harsh_brake", severity: "critical", source: "accelerometer crash" });
    if (io.towing_detected) events.push({ ...base, event_type: "tamper", severity: "warning", source: "towing" });
    if (io.jamming_detected) events.push({ ...base, event_type: "tamper", severity: "critical", source: "GNSS/GSM jamming" });
    if (previous && current.ignition === false && previous.fuel_level_pct != null && current.fuel_level_pct != null) {
      const drop = previous.fuel_level_pct - current.fuel_level_pct;
      if (drop >= 8) events.push({ ...base, event_type: "fuel_drop", severity: "critical",
        fuel_drop_pct: +drop.toFixed(1), source: current.raw.fuel_source });
    }
    const minPsi = current.tyre_pressure_min_psi;
    if (minPsi !== null && minPsi < 85) events.push({ ...base, event_type: "tamper", severity: "warning", source: "Continental TPMS", min_psi: minPsi });
    return events;
  }

  function samplePacket(index = 0, options = {}) {
    const parked = options.parked ?? index >= 5;
    const fuel = options.fuel_level_pct ?? (index >= 6 ? 61.2 : 78.8 - index * 0.22);
    return {
      codec: "Codec8E-decoded", priority: index === 3 ? 1 : 0, gnss_band: "L1+L5",
      recorded_at: options.recorded_at || new Date(Date.now() - Math.max(0, 6 - index) * 60000).toISOString(),
      latitude: +(11.6643 - Math.min(index, 5) * 0.0108).toFixed(6),
      longitude: +(78.1460 - Math.min(index, 5) * 0.0121).toFixed(6),
      speed_kmph: parked ? 0 : [46, 58, 67, 78, 52][index % 5], heading: 226, satellites: 23,
      io: {
        ignition: !parked, digital_input_1: !parked, movement: !parked,
        external_voltage_v: parked ? 24.7 : 28.1, backup_battery_pct: 96,
        gsm_signal: 5, odometer_km: +(428110.4 + index * 0.9).toFixed(1), engine_hours: +(14220.1 + index * 0.03).toFixed(2),
        j1939_engine_rpm: parked ? 0 : 1480 + index * 42, j1939_coolant_temp_c: parked ? 79.5 : 88.6,
        j1939_engine_load_pct: parked ? 0 : 64, j1939_total_fuel_l: +(82640.5 + index * 0.4).toFixed(1),
        j1939_fuel_rate_lph: parked ? 0 : 17.4, can_fms_fuel_pct: +fuel.toFixed(1), fuel_source: "CAN FMS (J1939)",
        j1708_total_distance_km: +(428110.4 + index * 0.9).toFixed(1),
        tacho_driver_card: "DRV-FW-00650", tacho_driver_state: parked ? "rest" : "driving",
        tacho_speed_kmph: parked ? 0 : [46, 58, 67, 78, 52][index % 5], tacho_download_ready: true,
        tpms_psi: index === 4 ? [104, 103, 82, 101, 100, 102] : [104, 103, 102, 101, 100, 102],
        cargo_temperature_c: 3.8, ble_temperature_c: 31.2,
        rs232_1_mode: "Tachograph", rs232_2_mode: "Thermograph", rs485_mode: "LLS",
        can1_active: true, can2_active: true, external_gnss_antenna: true, external_cellular_antenna: true,
        crash_detected: index === 3, towing_detected: false, jamming_detected: false,
      },
    };
  }

  function sampleBatch(count = 7) {
    const readings = [], events = [];
    let previous = null;
    for (let index = 0; index < count; index++) {
      const reading = normalize(samplePacket(index));
      readings.push(reading); events.push(...deriveEvents(reading, previous)); previous = reading;
    }
    return { imei: "861100000000650", readings, events };
  }

  return { model: "FMC650", normalize, deriveEvents, samplePacket, sampleBatch };
});
