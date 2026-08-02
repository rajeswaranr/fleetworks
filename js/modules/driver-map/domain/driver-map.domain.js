/* ============ FleetWorks — driver-map/domain ============ */

(function () {
  "use strict";

  function mapPoint(input) {
    const data = input || {};
    return {
      vehicleId: data.vehicleId || "",
      vehicleName: data.vehicleName || "Vehicle",
      driverId: data.driverId || "",
      driverName: data.driverName || "",
      label: data.label || data.depot || data.vehicleName || "Location",
      lat: Number(data.lat || 0) || null,
      lng: Number(data.lng || 0) || null,
      source: data.source || "unknown",
      capturedAt: data.capturedAt || data.eventAt || "",
      status: data.status || "unknown",
    };
  }

  function hasCoordinates(point) {
    const p = mapPoint(point);
    return Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat !== null && p.lng !== null;
  }

  function mapSummary(points) {
    const list = (points || []).map(mapPoint);
    return {
      total: list.length,
      plotted: list.filter(hasCoordinates).length,
      missing: list.filter(p => !hasCoordinates(p)).length,
      live: list.filter(p => p.source === "telemetry").length,
      staticDepot: list.filter(p => p.source === "depot").length,
    };
  }

  window.FWDriverMapDomain = window.FWDriverMapDomain || {
    mapPoint,
    hasCoordinates,
    mapSummary,
  };
})();
