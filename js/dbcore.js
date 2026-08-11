/* ============ FleetWorks — dbcore.js ============
   DB-direct data layer for all 12 core entities: vehicles, drivers,
   expenses, fuel logs, issues, work orders, reminders, inspections, parts,
   documents, tyre readings, trips, and driver ledger (khata). When signed
   in, every one of these is read and written straight to Supabase — never
   through the localStorage blob. saveStore() (fleet.js) excludes all of
   them from what gets persisted to ff_fleet/pushed to the fleets blob once
   signed in, and sync_fleet_from_blob() (Supabase side) no longer touches
   any of these tables at all, so nothing can silently overwrite a direct
   write with stale blob content. Settings remains blob-based (projected
   into the organizations table by sync_fleet_from_blob(), as before).

   Local object shape is UNCHANGED from the blob era on purpose — every
   existing render function, dropdown populator, and search/filter in
   fleet.js/analytics.js/account.js keeps working untouched, because
   db.vehicles/db.drivers/... are still plain in-memory arrays of the same
   shape; only WHERE they're populated from and WHERE writes go changed.

   id convention:
     vehicles/drivers/issues — local .id stays the blob-stable ext_id.
       Vehicles/drivers because Payroll and Team & Access already key
       driver_payout_details/vehicle_assignments on this exact value
       (changing it would break those live features); issues because
       work_orders reference an issue by its local id. .dbId holds the real
       Postgres uuid on all three, needed for FK columns and for
       authPatch/authDelete calls.
     everything else (expenses, fuel_logs, work_orders, reminders,
       inspections, parts, documents, tyre_readings, trips, driver_ledger)
       — nothing else references these by id, so local .id is just the real
       Postgres uuid directly. No separate .dbId needed. */

"use strict";

function coreDbBacked() { return !!(window.fwCloud && fwCloud.user()); }

let _dbOrgId = null;
async function dbOrgId() {
  if (_dbOrgId) return _dbOrgId;
  if (!coreDbBacked()) return null;
  // Must match sync_fleet_from_blob()'s own org lookup (role = 'owner') —
  // an unfiltered query here can pick a DIFFERENT membership row (e.g. a
  // supervisor/driver membership picked up via Team & Access) and silently
  // point every fetch at the wrong org, making a real fleet look empty.
  let rows = await fwCloud.authGet("memberships", "select=org_id&role=eq.owner&limit=1").catch(() => null);
  if (!rows || !rows[0]) rows = await fwCloud.authGet("memberships", "select=org_id&limit=1").catch(() => null);
  if (rows && rows[0]) {
    _dbOrgId = rows[0].org_id;
    return _dbOrgId;
  }
  // First-time owners may have an auth user but no organization row yet.
  // Create the tenant via the same definer function the blob sync path uses.
  const ownerId = fwCloud.uid ? fwCloud.uid() : null;
  if (ownerId) {
    const orgId = await fwCloud.authRpc("sync_fleet_from_blob", {
      p_owner: ownerId,
      p_data: { settings: {} }
    }).catch(() => null);
    if (orgId) {
      _dbOrgId = orgId;
      return _dbOrgId;
    }
  }
  return null;
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
// Partial update of any vehicle fields (bulk-import "update existing" mode).
// patch uses local field names; only the keys present are written.
const VEHICLE_COL = {
  type: "type", kmPerMonth: "km_per_month", status: "status", make: "make", model: "model", year: "year",
  chassisNo: "chassis_no", engineNo: "engine_no", ownership: "ownership", group: "fleet_group", depot: "depot",
  emission: "emission", fuelType: "fuel_type", tankCapacity: "tank_capacity", color: "color",
  gvw: "gvw", payload: "payload", axleConfig: "axle_config",
  tyreFrontPsi: "tyre_front_psi", tyreRearPsi: "tyre_rear_psi", tyreSize: "tyre_size", rto: "rto",
  purchaseDate: "purchase_date", purchasePrice: "purchase_price", purchaseVendor: "purchase_vendor",
  inServiceDate: "in_service_date", serviceLifeMonths: "service_life_months", resaleValue: "resale_value",
  notes: "notes",
};
async function dbUpdateVehicleFields(extId, patch) {
  const dbId = dbVehicleUuid(extId);
  if (!dbId) return false;
  const p = {};
  Object.entries(patch).forEach(([k, v]) => {
    if (k === "compliance") { Object.entries(v || {}).forEach(([doc, d]) => { if (COMPLIANCE_COL[doc]) p[COMPLIANCE_COL[doc]] = d || null; }); }
    else if (VEHICLE_COL[k]) p[VEHICLE_COL[k]] = v === undefined ? null : v;
  });
  if (!Object.keys(p).length) return true;
  return fwCloud.authPatch(`vehicles?id=eq.${dbId}`, p);
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
async function dbUpdateFuelLog(id, patch) {
  const p = {};
  if ("vehicleId" in patch) p.vehicle_id = patch.vehicleId ? dbVehicleUuid(patch.vehicleId) : null;
  if ("date" in patch) p.log_date = patch.date;
  if ("litres" in patch) p.litres = patch.litres;
  if ("amount" in patch) p.amount = patch.amount;
  if ("odo" in patch) p.odometer = patch.odo;
  return fwCloud.authPatch(`fuel_logs?id=eq.${id}`, p);
}
async function dbDeleteFuelLog(id) { return fwCloud.authDelete("fuel_logs", `id=eq.${id}`); }

// ---------- Driver uuid lookup (mirrors dbVehicleUuid) ----------
function dbDriverUuid(extId) {
  const d = db.drivers.find(x => x.id === extId);
  return d ? d.dbId : null;
}
function dbIssueUuid(extId) {
  const i = db.issues.find(x => x.id === extId);
  return i ? i.dbId : null;
}

// ---------- Issues (ext_id needed — work_orders reference an issue by id) ----------
function dbRowToIssue(row, vehicleExtId) {
  return {
    id: row.ext_id, dbId: row.id,
    vehicleId: vehicleExtId !== undefined ? vehicleExtId : (row.vehicles ? row.vehicles.ext_id : "") || "",
    title: row.title, severity: row.severity, status: row.status,
    createdAt: row.reported_at || undefined, resolvedAt: row.resolved_at || undefined, source: row.source || undefined,
  };
}
function issueToDbRow(i, orgId) {
  return {
    org_id: orgId, ext_id: i.id, vehicle_id: i.vehicleId ? dbVehicleUuid(i.vehicleId) : null,
    title: i.title, severity: i.severity, status: i.status,
    reported_at: i.createdAt || null, resolved_at: i.resolvedAt || null, source: i.source || null,
  };
}
async function dbCreateIssue(i) {
  const org = await dbOrgId(); if (!org) return null;
  if (!i.id) i.id = uid(); // local id IS the ext_id — must exist before insert (work_orders reference it)
  const row = await fwCloud.authInsertRet("issues", issueToDbRow(i, org));
  return row ? dbRowToIssue(row, i.vehicleId || "") : null;
}
async function dbUpdateIssue(extId, patch) {
  const i = db.issues.find(x => x.id === extId);
  if (!i || !i.dbId) return false;
  const p = {};
  if ("status" in patch) p.status = patch.status;
  if ("resolvedAt" in patch) p.resolved_at = patch.resolvedAt || null;
  if ("vehicleId" in patch) p.vehicle_id = patch.vehicleId ? dbVehicleUuid(patch.vehicleId) : null;
  if ("title" in patch) p.title = patch.title;
  if ("severity" in patch) p.severity = patch.severity;
  return fwCloud.authPatch(`issues?id=eq.${i.dbId}`, p);
}

// ---------- Work orders (no ext_id needed — nothing else references these by id) ----------
function dbRowToWorkOrder(row, vehicleExtId, issueExtId) {
  return {
    id: row.id,
    issueId: issueExtId !== undefined ? issueExtId : (row.issues ? row.issues.ext_id : "") || "",
    vehicleId: vehicleExtId !== undefined ? vehicleExtId : (row.vehicles ? row.vehicles.ext_id : "") || "",
    title: row.title, vendor: row.vendor || undefined,
    estCost: row.est_cost || undefined, finalCost: row.final_cost || undefined,
    status: row.status, createdAt: row.opened_at || undefined, completedAt: row.completed_at || undefined,
  };
}
function workOrderToDbRow(w, orgId) {
  return {
    org_id: orgId, vehicle_id: w.vehicleId ? dbVehicleUuid(w.vehicleId) : null,
    issue_id: w.issueId ? dbIssueUuid(w.issueId) : null,
    title: w.title, vendor: w.vendor || null,
    est_cost: w.estCost || null, final_cost: w.finalCost || null,
    status: w.status, opened_at: w.createdAt || null, completed_at: w.completedAt || null,
  };
}
async function dbCreateWorkOrder(w) {
  const org = await dbOrgId(); if (!org) return null;
  const row = await fwCloud.authInsertRet("work_orders", workOrderToDbRow(w, org));
  return row ? dbRowToWorkOrder(row, w.vehicleId || "", w.issueId || "") : null;
}
async function dbUpdateWorkOrder(id, patch) {
  const p = {};
  if ("status" in patch) p.status = patch.status;
  if ("completedAt" in patch) p.completed_at = patch.completedAt || null;
  if ("finalCost" in patch) p.final_cost = patch.finalCost;
  if ("vehicleId" in patch) p.vehicle_id = patch.vehicleId ? dbVehicleUuid(patch.vehicleId) : null;
  if ("title" in patch) p.title = patch.title;
  if ("vendor" in patch) p.vendor = patch.vendor || null;
  if ("estCost" in patch) p.est_cost = patch.estCost;
  return fwCloud.authPatch(`work_orders?id=eq.${id}`, p);
}

// ---------- Reminders (no ext_id needed) ----------
function dbRowToReminder(row, vehicleExtId) {
  return {
    id: row.id, vehicleId: vehicleExtId !== undefined ? vehicleExtId : (row.vehicles ? row.vehicles.ext_id : "") || "",
    task: row.task, everyMonths: row.every_months || 0, lastDate: row.last_date || undefined,
  };
}
function reminderToDbRow(r, orgId) {
  return {
    org_id: orgId, vehicle_id: r.vehicleId ? dbVehicleUuid(r.vehicleId) : null,
    task: r.task, every_months: r.everyMonths || null, last_date: r.lastDate || null,
  };
}
async function dbCreateReminder(r) {
  const org = await dbOrgId(); if (!org) return null;
  const row = await fwCloud.authInsertRet("reminders", reminderToDbRow(r, org));
  return row ? dbRowToReminder(row, r.vehicleId || "") : null;
}
async function dbUpdateReminder(id, patch) {
  const p = {};
  if ("vehicleId" in patch) p.vehicle_id = patch.vehicleId ? dbVehicleUuid(patch.vehicleId) : null;
  if ("task" in patch) p.task = patch.task;
  if ("everyMonths" in patch) p.every_months = patch.everyMonths;
  if ("lastDate" in patch) p.last_date = patch.lastDate || null;
  return fwCloud.authPatch(`reminders?id=eq.${id}`, p);
}
async function dbDeleteReminder(id) { return fwCloud.authDelete("reminders", `id=eq.${id}`); }

// ---------- Inspections (no ext_id needed) ----------
function dbRowToInspection(row, vehicleExtId) {
  return {
    id: row.id, vehicleId: vehicleExtId !== undefined ? vehicleExtId : (row.vehicles ? row.vehicles.ext_id : "") || "",
    date: row.inspection_date || undefined, passed: !!row.passed, results: row.results || [],
    odo: row.odo || undefined, notes: row.notes || undefined,
  };
}
function inspectionToDbRow(ins, orgId) {
  return {
    org_id: orgId, vehicle_id: ins.vehicleId ? dbVehicleUuid(ins.vehicleId) : null,
    inspection_date: ins.date || null, passed: !!ins.passed,
    results: ins.results && ins.results.length ? ins.results : null,
    odo: ins.odo || null, notes: ins.notes || null,
  };
}
async function dbCreateInspection(ins) {
  const org = await dbOrgId(); if (!org) return null;
  const row = await fwCloud.authInsertRet("inspections", inspectionToDbRow(ins, org));
  return row ? dbRowToInspection(row, ins.vehicleId || "") : null;
}

// ---------- Parts (no vehicle reference — plain inventory) ----------
function dbRowToPart(row) {
  return {
    id: row.id, name: row.name, partNumber: row.part_number || undefined, make: row.make || undefined,
    category: row.category || undefined, sourcing: row.sourcing || undefined,
    vendor: row.vendor || undefined, vendorContact: row.vendor_contact || undefined,
    unitCost: row.unit_cost || undefined, qty: row.qty || 0, minQty: row.min_qty || 0,
    location: row.location || undefined, purchaseDate: row.purchase_date || undefined, warrantyExpiry: row.warranty_expiry || undefined,
  };
}
function partToDbRow(p, orgId) {
  return {
    org_id: orgId, name: p.name, part_number: p.partNumber || null, make: p.make || null,
    category: p.category || null, sourcing: p.sourcing || null,
    vendor: p.vendor || null, vendor_contact: p.vendorContact || null,
    unit_cost: p.unitCost || null, qty: p.qty || 0, min_qty: p.minQty || 0,
    location: p.location || null, purchase_date: p.purchaseDate || null, warranty_expiry: p.warrantyExpiry || null,
  };
}
async function dbCreatePart(p) {
  const org = await dbOrgId(); if (!org) return null;
  const row = await fwCloud.authInsertRet("parts", partToDbRow(p, org));
  return row ? dbRowToPart(row) : null;
}
async function dbUpdatePart(id, patch) {
  const p = {};
  if ("name" in patch) p.name = patch.name;
  if ("partNumber" in patch) p.part_number = patch.partNumber || null;
  if ("make" in patch) p.make = patch.make || null;
  if ("category" in patch) p.category = patch.category || null;
  if ("sourcing" in patch) p.sourcing = patch.sourcing || null;
  if ("vendor" in patch) p.vendor = patch.vendor || null;
  if ("vendorContact" in patch) p.vendor_contact = patch.vendorContact || null;
  if ("unitCost" in patch) p.unit_cost = patch.unitCost;
  if ("qty" in patch) p.qty = patch.qty;
  if ("minQty" in patch) p.min_qty = patch.minQty;
  if ("location" in patch) p.location = patch.location || null;
  if ("purchaseDate" in patch) p.purchase_date = patch.purchaseDate || null;
  if ("warrantyExpiry" in patch) p.warranty_expiry = patch.warrantyExpiry || null;
  return fwCloud.authPatch(`parts?id=eq.${id}`, p);
}

// ---------- Documents (polymorphic: vehicle or driver) ----------
function dbRowToDocument(row, entityExtId) {
  const entityType = row.entity_type;
  return {
    id: row.id, entityType,
    entityId: entityExtId !== undefined ? entityExtId :
      ((entityType === "vehicle" ? (row.vehicles ? row.vehicles.ext_id : "") : (row.drivers ? row.drivers.ext_id : "")) || ""),
    docType: row.doc_type, number: row.number || undefined,
    issueDate: row.issue_date || undefined, expiryDate: row.expiry_date || undefined, note: row.note || undefined,
  };
}
function documentToDbRow(d, orgId) {
  return {
    org_id: orgId, entity_type: d.entityType,
    vehicle_id: d.entityType === "vehicle" ? dbVehicleUuid(d.entityId) : null,
    driver_id: d.entityType === "driver" ? dbDriverUuid(d.entityId) : null,
    doc_type: d.docType, number: d.number || null,
    issue_date: d.issueDate || null, expiry_date: d.expiryDate || null, note: d.note || null,
  };
}
async function dbCreateDocument(d) {
  const org = await dbOrgId(); if (!org) return null;
  const row = await fwCloud.authInsertRet("documents", documentToDbRow(d, org));
  return row ? dbRowToDocument(row, d.entityId || "") : null;
}
async function dbUpdateDocument(id, patch) {
  const p = {};
  if ("entityType" in patch) p.entity_type = patch.entityType;
  if ("entityType" in patch || "entityId" in patch) {
    // vehicle_id/driver_id must be set together, matching whichever entityType applies
    const type = patch.entityType, entityId = patch.entityId;
    p.vehicle_id = type === "vehicle" ? dbVehicleUuid(entityId) : null;
    p.driver_id = type === "driver" ? dbDriverUuid(entityId) : null;
  }
  if ("docType" in patch) p.doc_type = patch.docType;
  if ("number" in patch) p.number = patch.number || null;
  if ("issueDate" in patch) p.issue_date = patch.issueDate || null;
  if ("expiryDate" in patch) p.expiry_date = patch.expiryDate || null;
  if ("note" in patch) p.note = patch.note || null;
  return fwCloud.authPatch(`documents?id=eq.${id}`, p);
}
async function dbDeleteDocument(id) { return fwCloud.authDelete("documents", `id=eq.${id}`); }

// ---------- Tyre readings (no ext_id needed) ----------
function dbRowToTyreReading(row, vehicleExtId) {
  return {
    id: row.id, vehicleId: vehicleExtId !== undefined ? vehicleExtId : (row.vehicles ? row.vehicles.ext_id : "") || "",
    position: row.position, treadDepth: row.tread_depth_mm || undefined, pressure: row.pressure_psi || undefined,
    odo: row.odometer || undefined, date: row.reading_date || undefined,
  };
}
function tyreReadingToDbRow(t, orgId) {
  return {
    org_id: orgId, vehicle_id: t.vehicleId ? dbVehicleUuid(t.vehicleId) : null,
    position: t.position, tread_depth_mm: t.treadDepth || null, pressure_psi: t.pressure || null,
    odometer: t.odo || null, reading_date: t.date || null,
  };
}
async function dbCreateTyreReading(t) {
  const org = await dbOrgId(); if (!org) return null;
  const row = await fwCloud.authInsertRet("tyre_readings", tyreReadingToDbRow(t, org));
  return row ? dbRowToTyreReading(row, t.vehicleId || "") : null;
}
async function dbUpdateTyreReading(id, patch) {
  const p = {};
  if ("vehicleId" in patch) p.vehicle_id = patch.vehicleId ? dbVehicleUuid(patch.vehicleId) : null;
  if ("position" in patch) p.position = patch.position;
  if ("treadDepth" in patch) p.tread_depth_mm = patch.treadDepth;
  if ("pressure" in patch) p.pressure_psi = patch.pressure;
  if ("odo" in patch) p.odometer = patch.odo;
  if ("date" in patch) p.reading_date = patch.date || null;
  return fwCloud.authPatch(`tyre_readings?id=eq.${id}`, p);
}
async function dbDeleteTyreReading(id) { return fwCloud.authDelete("tyre_readings", `id=eq.${id}`); }

if (typeof window !== "undefined") {
  Object.assign(window, {
    coreDbBacked,
    dbCreateExpense,
    dbUpdateExpense,
    dbCreateFuelLog,
    dbUpdateFuelLog,
    dbCreateIssue,
    dbUpdateIssue,
    dbCreateWorkOrder,
    dbUpdateWorkOrder,
    dbCreateReminder,
    dbUpdateReminder,
    dbCreateInspection,
    dbCreatePart,
    dbUpdatePart,
    dbCreateDocument,
    dbUpdateDocument,
    dbCreateTyreReading,
    dbUpdateTyreReading,
    dbCreateTrip,
    dbUpdateTrip,
    dbCreateLedgerEntry,
    dbUpdateLedgerEntry,
  });
}

// ---------- Trips (no ext_id needed) ----------
function dbRowToTrip(row, vehicleExtId) {
  return {
    id: row.id, vehicleId: vehicleExtId !== undefined ? vehicleExtId : (row.vehicles ? row.vehicles.ext_id : "") || "",
    date: row.trip_date || undefined, from: row.from_loc || "", to: row.to_loc || "",
    freight: row.freight || 0, km: row.km || undefined,
  };
}
function tripToDbRow(t, orgId) {
  return {
    org_id: orgId, vehicle_id: t.vehicleId ? dbVehicleUuid(t.vehicleId) : null,
    trip_date: t.date || null, from_loc: t.from || null, to_loc: t.to || null,
    freight: t.freight || 0, km: t.km || null,
  };
}
async function dbCreateTrip(t) {
  const org = await dbOrgId(); if (!org) return null;
  const row = await fwCloud.authInsertRet("trips", tripToDbRow(t, org));
  return row ? dbRowToTrip(row, t.vehicleId || "") : null;
}
async function dbUpdateTrip(id, patch) {
  const p = {};
  if ("vehicleId" in patch) p.vehicle_id = patch.vehicleId ? dbVehicleUuid(patch.vehicleId) : null;
  if ("date" in patch) p.trip_date = patch.date || null;
  if ("from" in patch) p.from_loc = patch.from || null;
  if ("to" in patch) p.to_loc = patch.to || null;
  if ("freight" in patch) p.freight = patch.freight;
  if ("km" in patch) p.km = patch.km;
  return fwCloud.authPatch(`trips?id=eq.${id}`, p);
}
async function dbDeleteTrip(id) { return fwCloud.authDelete("trips", `id=eq.${id}`); }

// ---------- Driver ledger / khata (no ext_id needed) ----------
function dbRowToLedgerEntry(row, driverExtId) {
  return {
    id: row.id, driverId: driverExtId !== undefined ? driverExtId : (row.drivers ? row.drivers.ext_id : "") || "",
    date: row.entry_date || undefined, type: row.type, amount: row.amount || 0, note: row.note || undefined,
  };
}
function ledgerEntryToDbRow(l, orgId) {
  return {
    org_id: orgId, driver_id: l.driverId ? dbDriverUuid(l.driverId) : null,
    entry_date: l.date || null, type: l.type, amount: l.amount || 0, note: l.note || null,
  };
}
async function dbCreateLedgerEntry(l) {
  const org = await dbOrgId(); if (!org) return null;
  const row = await fwCloud.authInsertRet("driver_ledger", ledgerEntryToDbRow(l, org));
  return row ? dbRowToLedgerEntry(row, l.driverId || "") : null;
}
async function dbUpdateLedgerEntry(id, patch) {
  const p = {};
  if ("driverId" in patch) p.driver_id = patch.driverId ? dbDriverUuid(patch.driverId) : null;
  if ("date" in patch) p.entry_date = patch.date || null;
  if ("type" in patch) p.type = patch.type;
  if ("amount" in patch) p.amount = patch.amount;
  if ("note" in patch) p.note = patch.note || null;
  return fwCloud.authPatch(`driver_ledger?id=eq.${id}`, p);
}
async function dbDeleteLedgerEntry(id) { return fwCloud.authDelete("driver_ledger", `id=eq.${id}`); }

// ---------- Bulk fetch: replaces all 12 DB-direct arrays with live DB
// content. Called on every page load while already signed in, and right
// after sign-in — never trusts whatever was last in localStorage. ----------
async function loadCoreFromDb() {
  if (!coreDbBacked()) return false;
  const org = await dbOrgId();
  if (!org) return false;
  const [vehRows, drvRows, expRows, fuelRows, issRows, woRows, remRows, insRows, partRows, docRows, tyreRows, tripRows, ledgerRows] = await Promise.all([
    fwCloud.authGet("vehicles", `select=*&org_id=eq.${org}&order=name.asc`),
    fwCloud.authGet("drivers", `select=*,vehicles(ext_id)&org_id=eq.${org}&order=name.asc`),
    fwCloud.authGet("expenses", `select=*,vehicles(ext_id)&org_id=eq.${org}&order=expense_date.desc`),
    fwCloud.authGet("fuel_logs", `select=*,vehicles(ext_id)&org_id=eq.${org}&order=log_date.desc`),
    fwCloud.authGet("issues", `select=*,vehicles(ext_id)&org_id=eq.${org}&order=reported_at.desc`),
    fwCloud.authGet("work_orders", `select=*,vehicles(ext_id),issues(ext_id)&org_id=eq.${org}&order=opened_at.desc`),
    fwCloud.authGet("reminders", `select=*,vehicles(ext_id)&org_id=eq.${org}`),
    fwCloud.authGet("inspections", `select=*,vehicles(ext_id)&org_id=eq.${org}&order=inspection_date.desc`),
    fwCloud.authGet("parts", `select=*&org_id=eq.${org}&order=name.asc`),
    fwCloud.authGet("documents", `select=*,vehicles(ext_id),drivers(ext_id)&org_id=eq.${org}`),
    fwCloud.authGet("tyre_readings", `select=*,vehicles(ext_id)&org_id=eq.${org}&order=reading_date.desc`),
    fwCloud.authGet("trips", `select=*,vehicles(ext_id)&org_id=eq.${org}&order=trip_date.desc`),
    fwCloud.authGet("driver_ledger", `select=*,drivers(ext_id)&org_id=eq.${org}&order=entry_date.desc`),
  ]);
  if (vehRows) db.vehicles = vehRows.map(dbRowToVehicle);
  if (drvRows) db.drivers = drvRows.map(r => dbRowToDriver(r));
  if (expRows) db.expenses = expRows.map(r => dbRowToExpense(r));
  if (fuelRows) db.fuelLogs = fuelRows.map(r => dbRowToFuelLog(r));
  if (issRows) db.issues = issRows.map(r => dbRowToIssue(r));
  if (woRows) db.workOrders = woRows.map(r => dbRowToWorkOrder(r));
  if (remRows) db.reminders = remRows.map(r => dbRowToReminder(r));
  if (insRows) db.inspections = insRows.map(r => dbRowToInspection(r));
  if (partRows) db.parts = partRows.map(dbRowToPart);
  if (docRows) db.documents = docRows.map(r => dbRowToDocument(r));
  if (tyreRows) db.tyreReadings = tyreRows.map(r => dbRowToTyreReading(r));
  if (tripRows) db.trips = tripRows.map(r => dbRowToTrip(r));
  if (ledgerRows) db.driverLedger = ledgerRows.map(r => dbRowToLedgerEntry(r));
  db.demo = false;
  return true;
}

// ---------- Demo purge: a signed-in account must never contain demo data.
// Demo rows are precisely identifiable (fixed vehicle ext_ids, fixed driver
// DL numbers, fixed part numbers — real rows always get random uids), so
// every sign-in/page load deletes any that exist before fetching. RLS
// scopes the deletes to this account's own org.
//
// Every table linked to a demo vehicle/driver is deleted EXPLICITLY by the
// real vehicle/driver uuid — maintenance data (issues, work orders,
// reminders, inspections, tyre readings, documents, trips) is not left to
// an ON DELETE CASCADE to clean up, since that depends on the exact FK
// definition being live in this account's database, which this code has no
// way to verify. Explicit deletes are correct regardless. Idempotent and
// cheap once clean (the two lookups return nothing, so nothing else runs). ----------
const DEMO_DRIVER_DL_NOS = ["TN01 20180012345", "UP32 20150098765", "TN22 20190045678", "KA05 20170034567", "TN45 20200056789"];
const DEMO_PART_NUMBERS = ["CAS-15W40-210L", "TML-AF-1613X", "BL-HCV-450", "FF-BS6-220", "WN-M22-100", "ALT-12V90-BL"];
const VEHICLE_LINKED_TABLES = ["tyre_readings", "fuel_logs", "expenses", "issues", "work_orders", "reminders", "inspections", "documents", "trips"];
async function dbPurgeDemoRows() {
  if (!coreDbBacked()) return;
  try {
    const dlQuoted = DEMO_DRIVER_DL_NOS.map(s => encodeURIComponent('"' + s + '"')).join(",");
    const partQuoted = DEMO_PART_NUMBERS.map(s => encodeURIComponent('"' + s + '"')).join(",");

    const [demoVehicles, demoDrivers] = await Promise.all([
      fwCloud.authGet("vehicles", "select=id&ext_id=in.(v1,v2,v3,v4,v5)"),
      fwCloud.authGet("drivers", "select=id&dl_no=in.(" + dlQuoted + ")"),
    ]);
    const vehIds = (demoVehicles || []).map(v => v.id);
    const drvIds = (demoDrivers || []).map(d => d.id);

    if (vehIds.length) {
      const vFilter = "vehicle_id=in.(" + vehIds.join(",") + ")";
      await Promise.all(VEHICLE_LINKED_TABLES.map(t => fwCloud.authDelete(t, vFilter)));
    }
    if (drvIds.length) {
      const dFilter = "driver_id=in.(" + drvIds.join(",") + ")";
      await Promise.all(["documents", "driver_ledger"].map(t => fwCloud.authDelete(t, dFilter)));
    }
    await fwCloud.authDelete("vehicles", "ext_id=in.(v1,v2,v3,v4,v5)");
    await fwCloud.authDelete("drivers", "dl_no=in.(" + dlQuoted + ")");
    await fwCloud.authDelete("parts", "part_number=in.(" + partQuoted + ")");
  } catch { /* purge is best-effort — next load retries */ }
}

// Runs once per page load. If signed in, DB is authoritative for all 12
// arrays from the moment this resolves — whatever loadStore() put there
// from localStorage a moment earlier gets replaced outright. Demo rows are
// purged BEFORE fetching so they can never be shown, even once.
(async function bootCoreFromDb() {
  if (!coreDbBacked()) return;
  await dbPurgeDemoRows();
  const ok = await loadCoreFromDb();
  if (ok && typeof renderAll === "function") renderAll();
})();
