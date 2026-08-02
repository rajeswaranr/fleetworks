/* ============ FleetWorks — fleet-core/domain ============
   Pure-ish domain helpers for the fleet core module. Keep browser APIs,
   DOM access, and Supabase calls out of this file. */

(function () {
  "use strict";

  function normalizeVehicle(vehicle) {
    const v = vehicle || {};
    return {
      id: v.id || v.ext_id || "",
      dbId: v.dbId || v.db_id || null,
      name: v.name || "Unnamed vehicle",
      type: v.type || "",
      status: v.status || "Active",
      depot: v.depot || v.fleet_group || "",
      kmPerMonth: Number(v.kmPerMonth || v.km_per_month || 0) || 0,
      compliance: v.compliance || {
        insurance: v.insurance_till || "",
        puc: v.puc_till || "",
        fitness: v.fitness_till || "",
        permit: v.permit_till || "",
        roadtax: v.roadtax_till || "",
      },
    };
  }

  function normalizeDriver(driver) {
    const d = driver || {};
    return {
      id: d.id || d.ext_id || "",
      dbId: d.dbId || d.db_id || null,
      name: d.name || "Unnamed driver",
      phone: d.phone || "",
      vehicleId: d.vehicleId || d.vehicle_id || "",
      dlNo: d.dlNo || d.dl_no || "",
      dlExpiry: d.dlExpiry || d.dl_expiry || "",
      upiId: d.upiId || d.upi_id || "",
      bankAccount: d.bankAccount || d.bank_account || "",
      bankIfsc: d.bankIfsc || d.bank_ifsc || "",
    };
  }

  function assignment(vehicle, drivers) {
    const v = normalizeVehicle(vehicle);
    const driver = (drivers || []).map(normalizeDriver).find(d => d.vehicleId === v.id) || null;
    return { vehicle: v, driver };
  }

  function complianceCounts(vehicles) {
    const now = Date.now();
    const result = { overdue: 0, dueSoon: 0, ok: 0, missing: 0 };
    (vehicles || []).map(normalizeVehicle).forEach(vehicle => {
      Object.values(vehicle.compliance || {}).forEach(date => {
        if (!date) { result.missing += 1; return; }
        const days = Math.round((new Date(date).getTime() - now) / 86400000);
        if (Number.isNaN(days)) result.missing += 1;
        else if (days < 0) result.overdue += 1;
        else if (days <= 30) result.dueSoon += 1;
        else result.ok += 1;
      });
    });
    return result;
  }

  function summary(input) {
    const vehicles = (input.vehicles || []).map(normalizeVehicle);
    const drivers = (input.drivers || []).map(normalizeDriver);
    return {
      vehicleCount: vehicles.length,
      driverCount: drivers.length,
      assignedVehicleCount: vehicles.filter(v => drivers.some(d => d.vehicleId === v.id)).length,
      activeVehicleCount: vehicles.filter(v => v.status !== "Inactive").length,
      compliance: complianceCounts(vehicles),
    };
  }

  window.FWFleetCoreDomain = window.FWFleetCoreDomain || {
    normalizeVehicle,
    normalizeDriver,
    assignment,
    complianceCounts,
    summary,
  };
})();
