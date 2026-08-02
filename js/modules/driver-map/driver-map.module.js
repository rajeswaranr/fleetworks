/* ============ FleetWorks — modules/driver-map ============
   Pluggable map integration contract. Today it wraps the existing depot
   Leaflet map. Tomorrow it can accept live GPS / IoT telemetry providers
   without rewriting the Fleet Map tab. */

(function () {
  "use strict";

  function api() { return window.FWApi || null; }
  function localDb() {
    try { if (typeof db !== "undefined") return db; } catch { /* lexical global not present */ }
    return window.db || {};
  }
  function vehicles() { return api() ? FWApi.domains.fleet.vehicles() : localDb().vehicles || []; }
  function drivers() { return api() ? FWApi.domains.fleet.drivers() : localDb().drivers || []; }

  const DriverMap = {
    providers: {
      depot: {
        id: "depot",
        name: "Depot / City Map",
        mode: "static",
        live: false,
      },
      browserLocation: {
        id: "browser_location",
        name: "Browser Location Capture",
        mode: "device-assisted",
        live: !!(window.navigator && navigator.geolocation),
      },
      telemetry: {
        id: "telemetry",
        name: "GPS / IoT Telemetry",
        mode: "future-ingestion",
        live: false,
        expectedTables: ["devices", "vehicle_device_links", "telemetry_latest", "telemetry_alerts"],
      },
    },

    getProviderStatus() {
      return Object.values(DriverMap.providers).map(p => ({ ...p }));
    },

    vehiclesWithDrivers() {
      return vehicles().map(v => ({
        vehicle: v,
        driver: drivers().find(d => d.vehicleId === v.id) || null,
      }));
    },

    mapPoints() {
      return DriverMap.vehiclesWithDrivers().map(row => ({
        vehicleId: row.vehicle.id,
        vehicleName: row.vehicle.name,
        driverId: row.driver ? row.driver.id : null,
        driverName: row.driver ? row.driver.name : null,
        depot: row.vehicle.depot || "",
        status: row.vehicle.status || "Active",
      }));
    },

    renderCurrentMap() {
      if (typeof window.renderFleetMap === "function") return window.renderFleetMap();
      return null;
    },

    captureBrowserLocation() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("Browser geolocation is not available."));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          pos => resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            capturedAt: new Date().toISOString(),
          }),
          err => reject(err),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
        );
      });
    },
  };

  window.FWDriverMap = window.FWDriverMap || DriverMap;

  if (window.FWPlatform) {
    FWPlatform.registerModule({
      id: "driver_map",
      name: "Driver Map Integration",
      version: "0.1.0",
      layer: "feature",
      order: 40,
      description: "Map contract for depot maps now and live driver/GPS telemetry later.",
      dependencies: ["fleet_core"],
      permissions: ["maps.view", "maps.manage", "telemetry.read"],
      tables: ["vehicles", "drivers", "vehicle_device_links", "telemetry_latest", "telemetry_alerts"],
      endpoints: ["/telemetry/latest", "/maps/vehicles"],
      navigation: [{ workspace: "ops", tab: "map", label: "Fleet Map", icon: "mapPin" }],
      capabilities: ["maps.driver", "maps.depot", "telemetry.latest"],
      adapters: DriverMap.providers,
      init(ctx) {
        ctx.platform.registerCapability("maps.driver", DriverMap);
        ctx.platform.registerCapability("maps.depot", DriverMap.providers.depot);
        ctx.platform.registerCapability("telemetry.latest", DriverMap.providers.telemetry);
      },
    });
  }
})();
