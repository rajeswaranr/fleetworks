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
  console.error("Usage: FLEETWORKS_EMAIL=<email> FLEETWORKS_PASSWORD=<password> node scripts/seed-vehicles.mjs");
  process.exit(1);
}
if (!Number.isInteger(count) || count < 1 || count > 200) {
  console.error("Vehicle count must be a whole number between 1 and 200.");
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
    body: JSON.stringify({
      p_owner: session.user?.id,
      p_data: { settings: {} },
    }),
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

function futureDate(monthsFromNowMin, monthsFromNowMax) {
  const d = new Date();
  d.setMonth(d.getMonth() + randint(monthsFromNowMin, monthsFromNowMax));
  d.setDate(randint(1, 26));
  return d.toISOString().slice(0, 10);
}

function pastDate(monthsBackMin, monthsBackMax) {
  const d = new Date();
  d.setMonth(d.getMonth() - randint(monthsBackMin, monthsBackMax));
  d.setDate(randint(1, 26));
  return d.toISOString().slice(0, 10);
}

function plate(index) {
  const states = ["TN", "KA", "KL", "AP", "TS", "MH", "GJ", "RJ"];
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return [
    choice(states),
    String(randint(1, 99)).padStart(2, "0"),
    letters[randint(0, letters.length - 1)] + letters[randint(0, letters.length - 1)],
    String(1000 + index * 37 + randint(0, 899)).slice(-4),
  ].join(" ");
}

function vehicleRows(orgId, total) {
  const makes = ["Tata", "Ashok Leyland", "BharatBenz", "Eicher", "Mahindra", "SML Isuzu"];
  const models = ["Prima", "Boss", "Pro", "Blazo", "Signa", "Dost", "Furio", "Partner"];
  const types = ["Truck", "Tipper", "Trailer", "LCV", "Tanker", "Container"];
  const depots = ["Chennai", "Bengaluru", "Coimbatore", "Hyderabad", "Mumbai", "Pune", "Madurai"];
  const colors = ["White", "Blue", "Red", "Silver", "Yellow", "Green"];
  const fuelTypes = ["Diesel", "CNG", "EV"];
  const ownerships = ["Owned", "Leased", "Financed"];
  const batch = Date.now().toString(36);

  return Array.from({ length: total }, (_, i) => {
    const make = choice(makes);
    const type = choice(types);
    const fuelType = choice(fuelTypes);
    const gvw = randint(3500, 42000);
    return {
      org_id: orgId,
      ext_id: `seed_${batch}_${String(i + 1).padStart(2, "0")}_${Math.random().toString(36).slice(2, 7)}`,
      name: plate(i + 1),
      type,
      km_per_month: randint(2500, 14000),
      status: choice(["Active", "Active", "Active", "Service Due", "Idle"]),
      make,
      model: choice(models),
      year: randint(2016, 2026),
      chassis_no: "CHS" + batch.toUpperCase() + String(i + 1).padStart(3, "0"),
      engine_no: "ENG" + randint(1000000, 9999999),
      ownership: choice(ownerships),
      fleet_group: choice(["Long Haul", "City", "Regional", "Cold Chain", "Construction"]),
      depot: choice(depots),
      emission: choice(["BS-IV", "BS-VI"]),
      fuel_type: fuelType,
      tank_capacity: fuelType === "EV" ? null : randint(80, 420),
      color: choice(colors),
      gvw,
      payload: Math.max(1000, gvw - randint(1800, 9000)),
      axle_config: choice(["4x2", "6x2", "6x4", "8x2", "10x2"]),
      tyre_front_psi: randint(85, 115),
      tyre_rear_psi: randint(90, 125),
      tyre_size: choice(["295/80R22.5", "10.00R20", "11R22.5", "7.00R16", "8.25R16"]),
      rto: choice(["TN-09", "TN-22", "KA-01", "KA-05", "MH-12", "TS-08", "AP-31"]),
      purchase_date: pastDate(4, 96),
      purchase_price: randint(650000, 5800000),
      purchase_vendor: choice(["Dealer Direct", "FleetWorks Partner", "Used Vehicle Market", "OEM Finance"]),
      in_service_date: pastDate(2, 90),
      service_life_months: choice([60, 72, 84, 96, 120]),
      resale_value: randint(180000, 2200000),
      notes: "Seed test vehicle generated without UI.",
      insurance_till: futureDate(2, 18),
      puc_till: futureDate(1, 12),
      fitness_till: futureDate(3, 24),
      permit_till: futureDate(4, 24),
      roadtax_till: futureDate(6, 36),
    };
  });
}

async function insertVehicles(session, rows) {
  return jsonFetch("/rest/v1/vehicles", {
    method: "POST",
    headers: authHeaders(session, { "Prefer": "return=representation" }),
    body: JSON.stringify(rows),
  });
}

const session = await login();
const orgId = await getOwnerOrgId(session);
const rows = vehicleRows(orgId, count);
const inserted = await insertVehicles(session, rows);

console.log(`Inserted ${inserted.length} vehicles for ${email}.`);
console.table(inserted.map(row => ({
  name: row.name,
  type: row.type,
  make: row.make,
  model: row.model,
  status: row.status,
})));
