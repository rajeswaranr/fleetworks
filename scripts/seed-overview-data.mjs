#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function readBackendConfig() {
  const source = readFileSync(resolve(root, "js/backend.js"), "utf8");
  const url = source.match(/url:\s*"([^"]+)"/)?.[1] || "";
  const anonKey = source.match(/anonKey:\s*"([^"]+)"/)?.[1] || "";
  if (!url || !anonKey) throw new Error("Could not read Supabase config from js/backend.js.");
  return { url, anonKey };
}

function argValue(name, fallback = "") {
  const arg = process.argv.find(x => x.startsWith(name + "="));
  return arg ? arg.slice(name.length + 1) : fallback;
}

const email = argValue("--email", process.env.FLEETWORKS_EMAIL || "");
const password = argValue("--password", process.env.FLEETWORKS_PASSWORD || "");
const count = Number(argValue("--count", process.env.FLEETWORKS_VEHICLE_COUNT || "20"));

if (!email || !password) {
  console.error("Usage: FLEETWORKS_EMAIL=<email> FLEETWORKS_PASSWORD=<password> node scripts/seed-overview-data.mjs");
  process.exit(1);
}
if (!Number.isInteger(count) || count < 1 || count > 50) {
  console.error("Vehicle count must be a whole number between 1 and 50.");
  process.exit(1);
}

const cfg = readBackendConfig();

async function jsonFetch(path, options = {}) {
  const response = await fetch(cfg.url + path, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message || data?.msg || data?.error_description || data?.error || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function authHeaders(session, extra = {}) {
  return {
    "Content-Type": "application/json",
    "apikey": cfg.anonKey,
    "Authorization": "Bearer " + session.access_token,
    ...extra,
  };
}

async function login() {
  return jsonFetch("/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": cfg.anonKey },
    body: JSON.stringify({ email, password }),
  });
}

async function getOwnerOrgId(session) {
  const ownerMemberships = await jsonFetch("/rest/v1/memberships?select=org_id&role=eq.owner&limit=1", {
    headers: authHeaders(session),
  });
  if (ownerMemberships?.[0]?.org_id) return ownerMemberships[0].org_id;

  const anyMemberships = await jsonFetch("/rest/v1/memberships?select=org_id&limit=1", {
    headers: authHeaders(session),
  });
  if (anyMemberships?.[0]?.org_id) return anyMemberships[0].org_id;

  const orgId = await jsonFetch("/rest/v1/rpc/sync_fleet_from_blob", {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ p_owner: session.user?.id, p_data: { settings: {} } }),
  });
  if (!orgId) throw new Error("Could not find or create an organization for this user.");
  return orgId;
}

function choice(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function randint(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateAgo(minDays, maxDays) {
  return daysFromNow(-randint(minDays, maxDays));
}

function dateFuture(minDays, maxDays) {
  return daysFromNow(randint(minDays, maxDays));
}

function plate(index) {
  const states = ["TN", "KA", "KL", "AP", "TS", "MH", "GJ", "RJ"];
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `${choice(states)} ${String(randint(1, 99)).padStart(2, "0")} ${letters[randint(0, letters.length - 1)]}${letters[randint(0, letters.length - 1)]} ${String(1000 + index * 41 + randint(0, 899)).slice(-4)}`;
}

function newVehicleRows(orgId, total) {
  const makes = ["Tata", "Ashok Leyland", "BharatBenz", "Eicher", "Mahindra", "SML Isuzu"];
  const models = ["Prima", "Boss", "Pro", "Blazo", "Signa", "Dost", "Furio", "Partner"];
  const types = ["Truck", "Tipper", "Trailer", "LCV", "Tanker", "Container"];
  const batch = Date.now().toString(36);
  return Array.from({ length: total }, (_, i) => {
    const fuel = choice(["Diesel", "Diesel", "Diesel", "CNG", "EV"]);
    const gvw = randint(3500, 42000);
    return {
      org_id: orgId,
      ext_id: `overview_${batch}_${String(i + 1).padStart(2, "0")}_${Math.random().toString(36).slice(2, 7)}`,
      name: plate(i + 1),
      type: choice(types),
      km_per_month: randint(3500, 15000),
      status: choice(["Active", "Active", "Active", "Service Due", "Idle"]),
      make: choice(makes),
      model: choice(models),
      year: randint(2017, 2026),
      chassis_no: "CHS" + batch.toUpperCase() + String(i + 1).padStart(3, "0"),
      engine_no: "ENG" + randint(1000000, 9999999),
      ownership: choice(["Owned", "Leased", "Financed"]),
      fleet_group: choice(["Long Haul", "City", "Regional", "Cold Chain", "Construction"]),
      depot: choice(["Chennai", "Bengaluru", "Coimbatore", "Hyderabad", "Mumbai", "Pune", "Madurai"]),
      emission: choice(["BS-IV", "BS-VI"]),
      fuel_type: fuel,
      tank_capacity: fuel === "EV" ? null : randint(90, 420),
      color: choice(["White", "Blue", "Red", "Silver", "Yellow", "Green"]),
      gvw,
      payload: Math.max(1000, gvw - randint(1800, 9000)),
      axle_config: choice(["4x2", "6x2", "6x4", "8x2", "10x2"]),
      tyre_front_psi: randint(85, 115),
      tyre_rear_psi: randint(90, 125),
      tyre_size: choice(["295/80R22.5", "10.00R20", "11R22.5", "7.00R16", "8.25R16"]),
      rto: choice(["TN-09", "TN-22", "KA-01", "KA-05", "MH-12", "TS-08", "AP-31"]),
      purchase_date: dateAgo(180, 2600),
      purchase_price: randint(650000, 5800000),
      purchase_vendor: choice(["Dealer Direct", "FleetWorks Partner", "Used Vehicle Market", "OEM Finance"]),
      in_service_date: dateAgo(120, 2500),
      service_life_months: choice([60, 72, 84, 96, 120]),
      resale_value: randint(180000, 2200000),
      notes: "Overview seed vehicle generated without UI.",
      insurance_till: dateFuture(15, 360),
      puc_till: dateFuture(10, 180),
      fitness_till: dateFuture(20, 420),
      permit_till: dateFuture(25, 480),
      roadtax_till: dateFuture(40, 720),
    };
  });
}

async function insertRows(session, table, rows, returning = false) {
  if (!rows.length) return [];
  return jsonFetch(`/rest/v1/${table}`, {
    method: "POST",
    headers: authHeaders(session, { "Prefer": returning ? "return=representation" : "return=minimal" }),
    body: JSON.stringify(rows),
  });
}

async function fetchVehicles(session, orgId, total) {
  return jsonFetch(`/rest/v1/vehicles?select=*&org_id=eq.${orgId}&order=created_at.desc&limit=${total}`, {
    headers: authHeaders(session),
  });
}

async function ensureVehicles(session, orgId) {
  let vehicles = await fetchVehicles(session, orgId, count);
  if (vehicles.length >= count) return vehicles.slice(0, count);
  const missing = count - vehicles.length;
  const created = await insertRows(session, "vehicles", newVehicleRows(orgId, missing), true);
  vehicles = [...created, ...vehicles];
  return vehicles.slice(0, count);
}

function driverRows(orgId, vehicles, batch) {
  const first = ["Arun", "Prakash", "Suresh", "Karthik", "Mani", "Ravi", "Vijay", "Dinesh", "Naveen", "Muthu"];
  const last = ["Kumar", "Rajan", "Babu", "Selvam", "Kannan", "Murugan", "Naidu", "Shetty", "Pillai", "Reddy"];
  return vehicles.map((v, i) => ({
    org_id: orgId,
    ext_id: `drv_${batch}_${String(i + 1).padStart(2, "0")}`,
    name: `${choice(first)} ${choice(last)}`,
    phone: "9" + String(randint(100000000, 999999999)),
    dl_no: `DL-${batch.toUpperCase()}-${String(i + 1).padStart(3, "0")}`,
    dl_expiry: i % 7 === 0 ? dateFuture(5, 25) : dateFuture(90, 1200),
    vehicle_id: v.id,
    upi_id: `driver${i + 1}@upi`,
    bank_account: String(randint(1000000000, 9999999999)),
    bank_ifsc: "HDFC000" + String(randint(1000, 9999)),
  }));
}

function fuelRows(orgId, vehicles) {
  const rows = [];
  vehicles.forEach((v, i) => {
    const startOdo = randint(25000, 240000);
    rows.push({ org_id: orgId, vehicle_id: v.id, log_date: dateAgo(95, 110), litres: 0, amount: 0, odometer: startOdo, opening: true });
    let odo = startOdo;
    for (let j = 0; j < 5; j++) {
      odo += randint(650, 2200);
      const litres = randint(90, 310);
      const price = randint(88, 99);
      rows.push({
        org_id: orgId,
        vehicle_id: v.id,
        log_date: daysFromNow(-(80 - j * 16 + randint(-3, 3))),
        litres,
        amount: litres * price,
        odometer: odo,
        opening: false,
      });
    }
    if (i % 8 === 0) {
      rows.push({
        org_id: orgId,
        vehicle_id: v.id,
        log_date: dateAgo(4, 12),
        litres: randint(160, 260),
        amount: randint(15000, 26000),
        odometer: odo + randint(80, 180),
        opening: false,
      });
    }
  });
  return rows;
}

function expenseRows(orgId, vehicles) {
  const categories = [
    ["Oil Change", 8500, 24000],
    ["Tyres", 18000, 95000],
    ["Brake Service", 9000, 38000],
    ["Clutch Work", 22000, 85000],
    ["Battery", 7000, 26000],
    ["Toll", 1800, 12500],
    ["Engine Repair", 32000, 160000],
    ["General Service", 6500, 28000],
  ];
  const vendors = ["FleetWorks Partner", "Sri Balaji Motors", "Highway Diesel Care", "A1 Truck Service", "Metro Auto Parts"];
  const rows = [];
  vehicles.forEach((v, i) => {
    for (let j = 0; j < 3; j++) {
      const [category, min, max] = choice(categories);
      rows.push({
        org_id: orgId,
        vehicle_id: v.id,
        expense_date: daysFromNow(-(randint(1, 90))),
        category,
        amount: randint(min, max),
        odo: randint(30000, 260000),
        title: `${category} - ${v.name}`,
        vendor: choice(vendors),
        gstin: j % 2 === 0 ? "33ABCDE1234F1Z5" : null,
        bill_no: `BILL-${Date.now().toString(36).toUpperCase()}-${i + 1}-${j + 1}`,
        items: [{ name: category, qty: 1, amount: randint(min, max) }],
      });
    }
  });
  return rows;
}

function reminderRows(orgId, vehicles) {
  const tasks = ["Oil Change", "Greasing", "Brake Inspection", "Wheel Alignment", "General Service"];
  return vehicles.flatMap((v, i) => [
    {
      org_id: orgId,
      vehicle_id: v.id,
      task: choice(tasks),
      every_months: choice([1, 2, 3, 6]),
      last_date: i % 5 === 0 ? dateAgo(150, 220) : dateAgo(10, 110),
    },
    {
      org_id: orgId,
      vehicle_id: v.id,
      task: choice(tasks),
      every_months: choice([3, 6, 12]),
      last_date: i % 6 === 0 ? dateAgo(220, 380) : dateAgo(30, 180),
    },
  ]);
}

function inspectionRows(orgId, vehicles) {
  const checks = ["Brake", "Lights", "Tyres", "Oil leak", "Horn", "Mirrors", "Wipers", "Steering", "Battery", "Emergency kit"];
  return vehicles.map((v, i) => {
    const failCount = i % 4 === 0 ? randint(1, 3) : 0;
    const failed = new Set();
    while (failed.size < failCount) failed.add(choice(checks));
    const results = checks.map(item => ({ item, ok: !failed.has(item) }));
    return {
      org_id: orgId,
      vehicle_id: v.id,
      inspection_date: dateAgo(1, 40),
      passed: failCount === 0,
      results,
      odo: randint(30000, 260000),
      notes: failCount ? "Seed inspection: defects found for Overview alerts." : "Seed inspection: passed.",
    };
  });
}

function issueRows(orgId, vehicles, batch) {
  const titles = ["Brake pedal spongy", "Engine overheating", "Low mileage reported", "Tyre vibration", "Battery weak", "Oil leak near sump", "Air pressure drop"];
  return vehicles.map((v, i) => ({
    org_id: orgId,
    ext_id: `iss_${batch}_${String(i + 1).padStart(2, "0")}`,
    vehicle_id: v.id,
    title: choice(titles),
    severity: i % 5 === 0 ? "High" : i % 3 === 0 ? "Medium" : "Low",
    status: i % 4 === 0 ? "In Progress" : "Open",
    reported_at: dateAgo(1, 28),
    source: choice(["Driver", "Inspection", "Foresight", "Garage"]),
  }));
}

function workOrderRows(orgId, issues) {
  const vendors = ["FleetWorks Partner", "Sri Balaji Motors", "A1 Truck Service", "Metro Auto Parts"];
  return issues.filter((_, i) => i % 3 === 0).map((issue, i) => ({
    org_id: orgId,
    vehicle_id: issue.vehicle_id,
    issue_id: issue.id,
    title: `Job card: ${issue.title}`,
    vendor: choice(vendors),
    est_cost: randint(12000, 95000),
    final_cost: i % 4 === 0 ? randint(10000, 90000) : null,
    status: i % 4 === 0 ? "Completed" : "Open",
    opened_at: dateAgo(2, 35),
    completed_at: i % 4 === 0 ? dateAgo(1, 10) : null,
  }));
}

function documentRows(orgId, vehicles) {
  const docTypes = ["Insurance", "PUC", "Fitness Certificate (FC)", "National Permit", "Road Tax"];
  return vehicles.flatMap((v, i) => docTypes.map((docType, j) => ({
    org_id: orgId,
    entity_type: "vehicle",
    vehicle_id: v.id,
    doc_type: docType,
    number: `${docType.replace(/[^A-Z]/gi, "").slice(0, 3).toUpperCase()}-${v.name.replace(/\s/g, "")}-${j + 1}`,
    issue_date: dateAgo(60, 700),
    expiry_date: i % 9 === 0 && j === 1 ? dateFuture(3, 20) : dateFuture(35, 720),
    note: "Seed document for Compliance Radar.",
  })));
}

function tyreRows(orgId, vehicles) {
  const positions = ["FL", "FR", "RL", "RR"];
  return vehicles.flatMap((v, i) => positions.map(pos => ({
    org_id: orgId,
    vehicle_id: v.id,
    position: pos,
    tread_depth_mm: i % 6 === 0 ? Number((randint(18, 28) / 10).toFixed(1)) : Number((randint(45, 105) / 10).toFixed(1)),
    pressure_psi: randint(82, 124),
    odometer: randint(30000, 260000),
    reading_date: dateAgo(1, 24),
  })));
}

function tripRows(orgId, vehicles) {
  const routes = [
    ["Chennai", "Bengaluru"],
    ["Coimbatore", "Hyderabad"],
    ["Pune", "Mumbai"],
    ["Madurai", "Chennai"],
    ["Bengaluru", "Kochi"],
    ["Hyderabad", "Vijayawada"],
  ];
  return vehicles.flatMap(v => Array.from({ length: 2 }, () => {
    const [from, to] = choice(routes);
    const km = randint(280, 1150);
    return {
      org_id: orgId,
      vehicle_id: v.id,
      trip_date: dateAgo(2, 80),
      from_loc: from,
      to_loc: to,
      freight: km * randint(58, 110),
      km,
    };
  }));
}

function partRows(orgId, batch) {
  const parts = [
    ["Engine Oil 15W40", "Lubricants", 12000, 8, 3],
    ["Air Filter", "Filters", 1800, 18, 8],
    ["Brake Lining", "Brakes", 6500, 10, 5],
    ["Fuel Filter", "Filters", 2200, 4, 6],
    ["Clutch Plate", "Transmission", 14500, 3, 3],
    ["Wiper Motor", "Electrical", 3800, 5, 2],
  ];
  return parts.map(([name, category, unitCost, qty, minQty], i) => ({
    org_id: orgId,
    name,
    part_number: `OVR-${batch.toUpperCase()}-${String(i + 1).padStart(2, "0")}`,
    make: choice(["Tata Genuine", "Bosch", "FleetWorks Approved", "TVS", "BharatBenz"]),
    category,
    sourcing: choice(["OEM", "Aftermarket", "FleetWorks Partner"]),
    vendor: choice(["Metro Auto Parts", "Sri Balaji Motors", "FleetWorks Partner"]),
    vendor_contact: "9" + String(randint(100000000, 999999999)),
    unit_cost: unitCost,
    qty,
    min_qty: minQty,
    location: choice(["Main Store", "Chennai Depot", "Bengaluru Depot"]),
    purchase_date: dateAgo(5, 160),
    warranty_expiry: dateFuture(80, 720),
  }));
}

const session = await login();
const orgId = await getOwnerOrgId(session);
const batch = Date.now().toString(36);
const vehicles = await ensureVehicles(session, orgId);

const drivers = await insertRows(session, "drivers", driverRows(orgId, vehicles, batch), true);
await insertRows(session, "fuel_logs", fuelRows(orgId, vehicles));
await insertRows(session, "expenses", expenseRows(orgId, vehicles));
await insertRows(session, "reminders", reminderRows(orgId, vehicles));
await insertRows(session, "inspections", inspectionRows(orgId, vehicles));
const issues = await insertRows(session, "issues", issueRows(orgId, vehicles, batch), true);
await insertRows(session, "work_orders", workOrderRows(orgId, issues));
await insertRows(session, "documents", documentRows(orgId, vehicles));
await insertRows(session, "tyre_readings", tyreRows(orgId, vehicles));
await insertRows(session, "trips", tripRows(orgId, vehicles));
await insertRows(session, "parts", partRows(orgId, batch));

console.log(`Seeded Overview data for ${vehicles.length} vehicles on ${email}.`);
console.table([
  { table: "vehicles targeted", rows: vehicles.length },
  { table: "drivers", rows: drivers.length },
  { table: "fuel_logs", rows: fuelRows(orgId, vehicles).length },
  { table: "expenses", rows: expenseRows(orgId, vehicles).length },
  { table: "issues", rows: issues.length },
  { table: "work_orders", rows: workOrderRows(orgId, issues).length },
  { table: "reminders", rows: reminderRows(orgId, vehicles).length },
  { table: "inspections", rows: inspectionRows(orgId, vehicles).length },
  { table: "documents", rows: documentRows(orgId, vehicles).length },
  { table: "tyre_readings", rows: tyreRows(orgId, vehicles).length },
  { table: "trips", rows: tripRows(orgId, vehicles).length },
  { table: "parts", rows: partRows(orgId, batch).length },
]);
