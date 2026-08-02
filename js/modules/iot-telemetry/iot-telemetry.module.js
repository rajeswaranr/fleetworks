/* ============ FleetWorks — modules/iot-telemetry ============
   IoT and telemetry contract. This does not ingest live device data yet; it
   establishes the module boundary, table names, capabilities, and adapter
   shape needed for GPS, FASTag, fault codes, and sensor streams. */

(function () {
  "use strict";

  const Telemetry = {
    ingestionModes: {
      http: { id: "http", name: "HTTPS Device Ingestion", live: false },
      mqtt: { id: "mqtt", name: "MQTT Device Ingestion", live: false },
      batch: { id: "batch", name: "Batch Upload / Vendor Sync", live: false },
    },

    expectedTables: [
      "devices",
      "device_credentials",
      "vehicle_device_links",
      "telemetry_events_raw",
      "telemetry_latest",
      "telemetry_alerts",
      "geofence_events",
      "maintenance_predictions",
    ],

    latestForVehicle(vehicleId) {
      let d = window.db || {};
      try { if (typeof db !== "undefined") d = db; } catch { /* lexical global not present */ }
      const rows = Array.isArray(d.telemetryLatest) ? d.telemetryLatest : [];
      return rows.find(row => row.vehicleId === vehicleId || row.vehicle_id === vehicleId) || null;
    },

    normalizeEvent(event) {
      return {
        deviceId: event.deviceId || event.device_id || "",
        vehicleId: event.vehicleId || event.vehicle_id || "",
        lat: Number(event.lat || event.latitude || 0) || null,
        lng: Number(event.lng || event.longitude || 0) || null,
        speedKph: Number(event.speedKph || event.speed_kph || 0) || 0,
        odometer: Number(event.odometer || 0) || null,
        eventAt: event.eventAt || event.event_at || new Date().toISOString(),
        raw: event,
      };
    },
  };

  window.FWTelemetry = window.FWTelemetry || Telemetry;

  if (window.FWPlatform) {
    FWPlatform.registerModule({
      id: "iot_telemetry",
      name: "IoT Telemetry",
      version: "0.1.0",
      layer: "platform",
      order: 70,
      description: "Device registry, telemetry ingestion, latest vehicle state, alert, geofence, and predictive maintenance contract.",
      dependencies: ["fleet_core", "security", "driver_map"],
      permissions: ["telemetry.read", "telemetry.ingest", "telemetry.manage_devices"],
      tables: Telemetry.expectedTables,
      endpoints: ["/iot/ingest", "/iot/devices", "/telemetry/latest", "/telemetry/alerts"],
      capabilities: ["telemetry.ingestion", "telemetry.latest", "telemetry.normalize"],
      adapters: Telemetry.ingestionModes,
      init(ctx) {
        ctx.platform.registerCapability("telemetry.ingestion", Telemetry.ingestionModes);
        ctx.platform.registerCapability("telemetry.latest", { get: Telemetry.latestForVehicle });
        ctx.platform.registerCapability("telemetry.normalize", { event: Telemetry.normalizeEvent });
      },
    });
  }
})();
