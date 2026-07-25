/* ============ FleetWorks — dbcore.js ============
   DB-direct data layer for vehicles, drivers, expenses, and fuel logs.
   When signed in, these 4 entities are read and written straight to
   Supabase — never through the localStorage blob. saveStore() (fleet.js)
   excludes them from what gets persisted to ff_fleet/pushed to the fleets
   blob once signed in, and sync_fleet_from_blob() (Supabase side) no
   longer touches these 4 tables at all, so nothing can silently overwrite
   a direct write with stale blob content.

   Local object shape is UNCHANGED from the blob era on purpose — every
   existing render function, dropdown populator, and search/filter in
   fleet.js/analytics.js/account.js keeps working untouched, because
   db.vehicles/db.drivers/db.expenses/db.fuelLogs are still plain in-memory
   arrays of the same shape; only WHERE they're populated from and WHERE
   writes go changed.

   id convention:
     vehicles/drivers — local .id stays the blob-stable ext_id (Payroll and
       Team & Access already key driver_payout_details/vehicle_assignments
       on this exact value — changing it would break those live features).
       .dbId holds the real Postgres uuid, needed for FK columns and for
       authPatch/authDelete calls.
     expenses/fuel_logs — nothing else references these by id (no other
       table points at them), so local .id is just the real Postgres uuid
       directly. No separate .dbId needed. */

"use strict";

function coreDbBacked() { return !!(window.fwCloud && fwCloud.user()); }

let _dbOrgId = null;
async function dbOrgId() {
  if (_dbOrgId) return _dbOrgId;
  if (!coreDbBacked()) return null;
  const rows = await fwCloud.authGet("memberships", "select=org_id&limit=1").catch(() => null);
  _dbOrgId = rows && rows[0] ? rows[0].org_id : null;
  return _dbOrgId;
}
// Team & Access / Payroll invalidate nothing here — org id doesn't change
// for a signed-in owner mid-session, so a simple module-level cache is safe.

function dbVehicleUuid(extId) {
  const v = db.vehicles.find(x => x.id === extId);
  return v ? v.dbId : null;
}

// ---------- Vehicles ----------
function dbRowToVehicle(row) {
  return {
    id: row.ext_id, dbId: row.id,
    name: row.name, type: row.type, kmPerMonth: row.km_per_month || 0,
    status: row.status || "Active",
    make: row.make || undefined, model: row.model || undefined, year: row.year || undefined,
    chassisNo: row.chassis_no || undefined, engineNo: row.engine_no || undefined, ownership: row.ownership || undefined,
    group: row.fleet_group || undefined, depot: row.depot || undefined, emission: row.emission || undefined,
    fuelType: row.fuel_type || undefined, tankCapacity: row.tank_capacity || undefined, color: row.color || undefined,
    gvw: row.gvw || undefined, payload: row.payload || undefined, axleConfig: row.axle_config || undefined,
    tyreFrontPsi: row.tyre_front_psi || undefined, tyreRearPsi: row.tyre_rear_psi || undefined, tyreSize: row.tyre_size || undefined,
    rto: row.rto || undefined,
    purchaseDate: row.purchase_date || undefined, purchasePrice: row.purchase_price || undefined, purchaseVendor: row.purchase_vendor || undefined,
    inServiceDate: row.in_service_date || undefined, serviceLifeMonths: row.service_life_months || undefined, resaleValue: row.resale_value || undefined,
    notes: row.notes || undefined,
    compliance: {
      insurance: row.insurance_till || "", puc: row.puc_till || "", fitness: row.fitness_till || "",
      permit: row.permit_till || "", roadtax: row.roadtax_till || "",
    },
  };
}
function vehicleToDbRow(v, orgId) {
  return {
    org_id: orgId, ext_id: v.id, name: v.name, type: v.type, km_per_month: v.kmPerMonth || 0,
    status: v.status || "Active", make: v.make || null, model: v.model || null, year: v.year || null,
    chassis_no: v.chassisNo || null, engine_no: v.engineNo || null, ownership: v.ownership || null,
    fleet_group: v.group || null, depot: v.depot || null, emission: v.emission || null,
    fuel_type: v.fuelType || null, tank_capacity: v.tankCapacity || null, color: v.color || null,
    gvw: v.gvw || null, payload: v.payload || null, axle_config: v.axleConfig || null,
    tyre_front_psi: v.tyreFrontPsi || null, tyre_rear_psi: v.tyreRearPsi || null, tyre_size: v.tyreSize || null,
    rto: v.rto || null,
    purchase_date: v.purchaseDate || null, purchase_price: v.purchasePrice || null, purchase_vendor: v.purchaseVendor || null,
    in_service_date: v.inServiceDate || null, service_life_months: v.serviceLifeMonths || null, resale_value: v.resaleValue || null,
    notes: v.notes || null,
    insurance_till: (v.compliance && v.compliance.insurance) || null,
    puc_till: (v.compliance && v.compliance.puc) || null,
    fitness_till: (v.compliance && v.compliance.fitness) || null,
    permit_till: (v.compliance && v.compliance.permit) || null,
    roadtax_till: (v.compliance && v.compliance.roadtax) || null,
  };
}
async function dbCreateVehicle(v) {
  const org = await dbOrgId(); if (!org) return null;
  const row = await fwCloud.authInsertRet("vehicles", vehicleToDbRow(v, org));
  return row ? dbRowToVehicle(row) : null;
}
const COMPLIANCE_COL = { insurance: "insurance_till", puc: "puc_till", fitness: "fitness_till", permit: "permit_till", roadtax: "roadtax_till" };
async function dbUpdateVehicleCompliance(extId, doc, value) {
  const dbId = dbVehicleUuid(extId); const col = COMPLIANCE_COL[doc];
  if (!dbId || !col) return false;
  return fwCloud.authPatch(`vehicles?id=eq.${dbId}`, { [col]: value || null });
}

// ---------- Drivers ----------
function dbRowToDriver(row, vehicleExtId) {
  return {
    id: row.ext_id, dbId: row.id,
    name: row.name, phone: row.phone || "", dlNo: row.dl_no, dlExpiry: row.dl_expiry,
    vehicleId: vehicleExtId !== undefined ? vehicleExtId : (row.vehicles ? row.vehicles.ext_id : "") || "",
    upiId: row.upi_id || undefined, bankAccount: row.bank_account || undefined, bankIfsc: row.bank_ifsc || undefined,
  };
}
function driverToDbRow(d, orgId) {
  return {
    org_id: orgId, ext_id: d.id, name: d.name, phone: d.phone || null, dl_no: d.dlNo, dl_expiry: d.dlExpiry || null,
    vehicle_id: d.vehicleId ? dbVehicleUuid(d.vehicleId) : null,
    upi_id: d.upiId || null, bank_account: d.bankAccount || null, bank_ifsc: d.bankIfsc || null,
  };
}
async function dbCreateDriver(d) {
  const org = await dbOrgId(); if (!org) return null;
  const row = await fwCloud.authInsertRet("drivers", driverToDbRow(d, org));
  return row ? dbRowToDriver(row, d.vehicleId || "") : null;
}
async function dbUpdateDriver(extId, patch) {
  const d = db.drivers.find(x => x.id === extId);
  if (!d || !d.dbId) return false;
  const dbPatch = {};
  if ("name" in patch) dbPatch.name = patch.name;
  if ("phone" in patch) dbPatch.phone = patch.phone || null;
  if ("dlExpiry" in patch) dbPatch.dl_expiry = patch.dlExpiry || null;
  if ("vehicleId" in patch) dbPatch.vehicle_id = patch.vehicleId ? dbVehicleUuid(patch.vehicleId) : null;
  if ("upiId" in patch) dbPatch.upi_id = patch.upiId || null;
  if ("bankAccount" in patch) dbPatch.bank_account = patch.bankAccount || null;
  if ("bankIfsc" in patch) dbPatch.bank_ifsc = patch.bankIfsc || null;
  return fwCloud.authPatch(`drivers?id=eq.${d.dbId}`, dbPatch);
}
// Used when a vehicle is created with a driver pre-assigned — patches the
// OTHER side (the driver row) by its own dbId, not by vehicle lookup.
async function dbAssignVehicleToDriver(driverDbId, vehicleDbId) {
  return fwCloud.authPatch(`drivers?id=eq.${driverDbId}`, { vehicle_id: vehicleDbId });
}

// ---------- Expenses (no ext_id needed — nothing else references these by id) ----------
function dbRowToExpense(row, vehicleExtId) {
  return {
    id: row.id, vehicleId: vehicleExtId !== undefined ? vehicleExtId : (row.vehicles ? row.vehicles.ext_id : "") || "",
    date: row.expense_date, category: row.category, amount: row.amount || 0,
    odo: row.odo || undefined, title: row.title || undefined, vendor: row.vendor || undefined,
    gstin: row.gstin || undefined, billNo: row.bill_no || undefined, billPath: row.bill_path || undefined,
    items: row.items || undefined,
  };
}
function expenseToDbRow(e, orgId) {
  return {
    org_id: orgId, vehicle_id: e.vehicleId ? dbVehicleUuid(e.vehicleId) : null,
    expense_date: e.date, category: e.category, amount: e.amount || 0,
    odo: e.odo || null, title: e.title || null, vendor: e.vendor || null,
    gstin: e.gstin || null, bill_no: e.billNo || null, bill_path: e.billPath || null,
    items: e.items && e.items.length ? e.items : null,
  };
}
async function dbCreateExpense(e) {
  const org = await dbOrgId(); if (!org) return null;
  const row = await fwCloud.authInsertRet("expenses", expenseToDbRow(e, org));
  return row ? dbRowToExpense(row, e.vehicleId || "") : null;
}
async function dbUpdateExpense(id, patch) {
  const p = {};
  if ("date" in patch) p.expense_date = patch.date;
  if ("category" in patch) p.category = patch.category;
  if ("amount" in patch) p.amount = patch.amount;
  if ("title" in patch) p.title = patch.title || null;
  if ("vendor" in patch) p.vendor = patch.vendor || null;
  if ("gstin" in patch) p.gstin = patch.gstin || null;
  if ("billNo" in patch) p.bill_no = patch.billNo || null;
  if ("billPath" in patch) p.bill_path = patch.billPath || null;
  if ("items" in patch) p.items = patch.items && patch.items.length ? patch.items : null;
  return fwCloud.authPatch(`expenses?id=eq.${id}`, p);
}
async function dbDeleteExpense(id) { return fwCloud.authDelete("expenses", `id=eq.${id}`); }

// ---------- Fuel logs (no ext_id needed) ----------
function dbRowToFuelLog(row, vehicleExtId) {
  return {
    id: row.id, vehicleId: vehicleExtId !== undefined ? vehicleExtId : (row.vehicles ? row.vehicles.ext_id : "") || "",
    date: row.log_date, litres: row.litres || 0, amount: row.amount || 0, odo: row.odometer || 0,
    opening: !!row.opening,
  };
}
function fuelLogToDbRow(f, orgId) {
  return {
    org_id: orgId, vehicle_id: f.vehicleId ? dbVehicleUuid(f.vehicleId) : null,
    log_date: f.date, litres: f.litres || 0, amount: f.amount || 0, odometer: f.odo || 0,
    opening: !!f.opening,
  };
}
async function dbCreateFuelLog(f) {
  const org = await dbOrgId(); if (!org) return null;
  const row = await fwCloud.authInsertRet("fuel_logs", fuelLogToDbRow(f, org));
  return row ? dbRowToFuelLog(row, f.vehicleId || "") : null;
}

// ---------- Bulk fetch: replaces db.vehicles/drivers/expenses/fuelLogs with
// live DB content. Called on every page load while already signed in, and
// right after sign-in — never trusts whatever was last in localStorage. ----------
async function loadCoreFromDb() {
  if (!coreDbBacked()) return false;
  const org = await dbOrgId();
  if (!org) return false;
  const [vehRows, drvRows, expRows, fuelRows] = await Promise.all([
    fwCloud.authGet("vehicles", `select=*&org_id=eq.${org}&order=name.asc`),
    fwCloud.authGet("drivers", `select=*,vehicles(ext_id)&org_id=eq.${org}&order=name.asc`),
    fwCloud.authGet("expenses", `select=*,vehicles(ext_id)&org_id=eq.${org}&order=expense_date.desc`),
    fwCloud.authGet("fuel_logs", `select=*,vehicles(ext_id)&org_id=eq.${org}&order=log_date.desc`),
  ]);
  if (vehRows) db.vehicles = vehRows.map(dbRowToVehicle);
  if (drvRows) db.drivers = drvRows.map(r => dbRowToDriver(r));
  if (expRows) db.expenses = expRows.map(r => dbRowToExpense(r));
  if (fuelRows) db.fuelLogs = fuelRows.map(r => dbRowToFuelLog(r));
  db.demo = false;
  return true;
}

// Runs once per page load. If signed in, DB is authoritative for these 4
// arrays from the moment this resolves — whatever loadStore() put there
// from localStorage a moment earlier gets replaced outright.
(async function bootCoreFromDb() {
  if (!coreDbBacked()) return;
  const ok = await loadCoreFromDb();
  if (ok && typeof renderAll === "function") renderAll();
})();
