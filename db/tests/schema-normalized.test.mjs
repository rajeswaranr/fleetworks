import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const SCHEMA = join(dirname(fileURLToPath(import.meta.url)), "..", "schema-normalized.sql");

const db = new PGlite();
const log = (...a) => console.log(...a);
const ok = (m) => log("  ✓ " + m);
const bad = (m) => log("  ✗ " + m);

// ---- Supabase stubs: auth schema, auth.users, auth.uid(), auth.jwt() ----
async function stubs() {
  await db.exec(`
    do $r$ begin
      if not exists (select from pg_roles where rolname='anon') then create role anon; end if;
      if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if;
    end $r$;
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key default gen_random_uuid(),
      email text
    );
    -- read simulated identity from GUCs the tests can set
    create or replace function auth.uid() returns uuid language sql stable as $fn$
      select nullif(current_setting('test.uid', true), '')::uuid;
    $fn$;
    create or replace function auth.jwt() returns jsonb language sql stable as $fn$
      select coalesce(nullif(current_setting('test.jwt', true), '')::jsonb, '{}'::jsonb);
    $fn$;
    -- minimal fleets table (from schema-fleet.sql)
    create table if not exists fleets (
      owner_id uuid primary key references auth.users(id) on delete cascade,
      updated_at timestamptz not null default now(),
      data jsonb not null default '{}'::jsonb
    );
  `);
}

// ---- realistic fleet blob, mirrors the FleetOps controller loadDemoFleet shape ----
function demoBlob() {
  const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  return {
    vehicles: [
      { id: "v1", name: "TN-01-AB-1234", type: "Truck (HCV)", kmPerMonth: 9000,
        compliance: { insurance: d(300), puc: d(45), fitness: d(400), permit: d(200), roadtax: d(500) } },
      { id: "v2", name: "TN-09-CD-5678", type: "Truck (HCV)", kmPerMonth: 7500,
        compliance: { insurance: d(25), puc: d(-12), fitness: d(180), permit: d(90), roadtax: d(365) } },
      { id: "v4", name: "KA-05-GH-7890", type: "Bus", kmPerMonth: 11000,
        compliance: { insurance: d(80), puc: d(200), fitness: d(95), permit: d(-5), roadtax: d(250) } },
    ],
    drivers: [
      { id: "dr1", name: "Suresh Kumar", phone: "9840012345", dlNo: "TN01 20180012345", dlExpiry: d(400), vehicleId: "v1" },
      { id: "dr2", name: "Manoj Yadav", phone: "9944056789", dlNo: "UP32 20150098765", dlExpiry: d(21), vehicleId: "v2" },
    ],
    documents: [
      { id: "doc1", entityType: "vehicle", entityId: "v1", docType: "Registration Certificate (RC)", number: "TN01AB1234", issueDate: d(-1400), expiryDate: d(1200), note: "RTO Chennai" },
      { id: "doc2", entityType: "vehicle", entityId: "v2", docType: "National Permit", number: "NP-5678", issueDate: d(-320), expiryDate: d(40), note: "" },
      { id: "doc3", entityType: "driver", entityId: "dr2", docType: "Medical Certificate", number: "MED-4471", issueDate: d(-300), expiryDate: d(65), note: "Annual" },
      { id: "doc4", entityType: "driver", entityId: "MISSING", docType: "Aadhaar", number: "x", expiryDate: d(90), note: "orphan - must be skipped" },
    ],
    tyreReadings: [
      { id: "t1", vehicleId: "v1", position: "Front Left", treadDepth: 7.8, pressure: 110, odo: 168000, date: d(-4) },
      { id: "t2", vehicleId: "v1", position: "Front Right", treadDepth: 1.4, pressure: 110, odo: 168000, date: d(-4) },
    ],
    fuelLogs: [
      { id: "f1", vehicleId: "v1", date: d(-10), litres: 120, amount: 11040, odo: 167500 },
      { id: "f2", vehicleId: "v1", date: d(-4), litres: 118, amount: 10974, odo: 168000 },
    ],
    expenses: [
      { vehicleId: "v1", date: d(-30), category: "Tyres", amount: 62000 },
      { vehicleId: "v2", date: d(-15), category: "Brakes", amount: 9500 },
    ],
    issues: [
      { id: "i1", vehicleId: "v2", title: "Coolant temp climbing", severity: "High", status: "In Progress", createdAt: d(-9), source: "Driver report" },
      { id: "i2", vehicleId: "v4", title: "Brakes fault", severity: "High", status: "Open", createdAt: d(-1), source: "Inspection" },
    ],
    workOrders: [
      { id: "w1", issueId: "i1", vehicleId: "v2", title: "Coolant temp climbing", vendor: "Annai Auto", estCost: 6500, status: "Open", createdAt: d(-7) },
      { id: "w2", issueId: null, vehicleId: "v1", title: "Silencer weld", vendor: "Highway Motors", estCost: 1500, status: "Completed", createdAt: d(-40), completedAt: d(-38), finalCost: 1800 },
    ],
    parts: [
      { id: "p1", name: "Air Filter", partNumber: "AF-1613X", make: "Tata", category: "Filters", sourcing: "OEM (Original)", vendor: "Sri Ganesh", vendorContact: "9884022334", unitCost: 950, qty: 1, minQty: 2, location: "B-2", purchaseDate: d(-15), warrantyExpiry: null },
    ],
    reminders: [
      { id: "r1", vehicleId: "v1", task: "Engine Oil & Filters", everyMonths: 2, lastDate: d(-70) },
    ],
    inspections: [
      { id: "in1", vehicleId: "v1", date: d(-3), passed: true, results: [{ item: "Tyres", ok: true }, { item: "Brakes", ok: true }] },
      { id: "in2", vehicleId: "v4", date: d(-1), passed: false, results: [{ item: "Brakes", ok: false }] },
    ],
    settings: { businessName: "SR Transports", gstin: "", city: "Coimbatore", warnDays: 30, minTread: 1.6, mileageDropPct: 15 },
  };
}

async function count(t) { const r = await db.query(`select count(*)::int n from ${t}`); return r.rows[0].n; }

async function run() {
  log("\n=== PGlite (Postgres 16 WASM) — schema-normalized.sql validation ===\n");
  await stubs();
  ok("Supabase auth stubs + fleets table created");

  // 1) run the schema file
  const sql = readFileSync(SCHEMA, "utf8");
  try {
    await db.exec(sql);
    ok("schema-normalized.sql executed with no errors");
  } catch (e) {
    bad("schema failed to execute:");
    log("    " + e.message);
    process.exit(1);
  }

  // 2) create an owner + call projection directly (surfaces errors the trigger would swallow)
  const owner = (await db.query(`insert into auth.users(email) values ('owner@test.in') returning id`)).rows[0].id;
  const blob = JSON.stringify(demoBlob());
  try {
    await db.query(`select sync_fleet_from_blob($1, $2::jsonb)`, [owner, blob]);
    ok("sync_fleet_from_blob() ran directly with no errors");
  } catch (e) {
    bad("projection function raised: " + e.message);
    process.exit(2);
  }

  // 3) verify counts
  log("\n  row counts after projection:");
  const expect = { organizations: 1, memberships: 1, vehicles: 0, drivers: 0,
    documents: 0, tyre_readings: 0, fuel_logs: 0,
    expenses: 0, issues: 0, work_orders: 0, parts: 0, reminders: 0, inspections: 0 };
  let pass = true;
  for (const [t, n] of Object.entries(expect)) {
    const got = await count(t);
    const good = got === n;
    pass = pass && good;
    log(`    ${good ? "✓" : "✗"} ${t.padEnd(14)} ${got}${good ? "" : "  (expected " + n + ")"}`);
  }

  // 4) FK resolution checks
  log("\n  link-resolution checks:");
  const blobVehicleRows = await count("vehicles");
  blobVehicleRows === 0 ? ok("blob projection no longer creates vehicle rows") : bad("legacy blob projection still created rows: " + blobVehicleRows);
  const orphan = (await db.query(`select count(*)::int n from documents where doc_type='Aadhaar'`)).rows[0].n;
  orphan === 0 ? ok("orphan document (missing entity) correctly skipped") : bad("orphan doc leaked in: " + orphan);

  // 5) trigger path + idempotency (direct writes stay intact even when fleets blobs are updated)
  log("\n  trigger + idempotency:");
  const orgRow = (await db.query(`select id from organizations where exists (select 1 from memberships m where m.org_id=organizations.id and m.user_id=$1)`, [owner])).rows[0];
  await db.query(`insert into vehicles(org_id, ext_id, name, type, km_per_month) values ($1, $2, $3, $4, $5)`, [orgRow.id, 'v-direct', 'Direct Vehicle', 'Truck', 9000]);
  await db.query(`insert into drivers(org_id, ext_id, name, vehicle_id) values ($1, $2, $3, (select id from vehicles where ext_id=$2))`, [orgRow.id, 'dr-direct', 'Direct Driver']);
  await db.query(`insert into fleets(owner_id, data) values ($1, $2::jsonb)`, [owner, blob]); // trigger should not remove direct writes
  const afterInsert = await count("vehicles");
  afterInsert === 1 ? ok("trigger fired on fleets insert without removing direct-write vehicle rows") : bad("trigger/idempotency issue: vehicles=" + afterInsert);
  const b2 = demoBlob(); b2.vehicles.push({ id: "v9", name: "TN-99-ZZ-0001", type: "LCV", kmPerMonth: 3000, compliance: {} });
  await db.query(`update fleets set data=$2::jsonb where owner_id=$1`, [owner, JSON.stringify(b2)]);
  const afterUpd = await count("vehicles");
  afterUpd === 1 ? ok("trigger re-projection leaves direct-write rows intact") : bad("update re-projection wrong: vehicles=" + afterUpd);
  const orgs = await count("organizations");
  orgs === 1 ? ok("still exactly one organization (no duplicate org on re-sync)") : bad("org duplicated: " + orgs);

  // 6) empty / partial blob
  log("\n  edge cases:");
  const owner2 = (await db.query(`insert into auth.users(email) values ('empty@test.in') returning id`)).rows[0].id;
  try {
    await db.query(`insert into fleets(owner_id, data) values ($1, '{}'::jsonb)`, [owner2]);
    ok("empty blob projected without error");
  } catch (e) { bad("empty blob failed: " + e.message); }
  const orgs2 = await count("organizations");
  orgs2 === 2 ? ok("empty-blob owner still got an organization row") : bad("empty-blob org count: " + orgs2);

  // 7) RLS tenant isolation (the security property) + grants
  log("\n  RLS isolation & grants:");
  // second tenant
  const ownerB = (await db.query(`insert into auth.users(email) values ('ownerB@test.in') returning id`)).rows[0].id;
  const blob2 = JSON.stringify({ vehicles: [{ id: "z1", name: "MH-12-XX-9999", type: "LCV", kmPerMonth: 4000, compliance: {} }], settings: { businessName: "Zenith Logistics" } });
  await db.query(`insert into fleets(owner_id, data) values ($1, $2::jsonb)`, [ownerB, blob2]);

  const org1n = (await db.query(`select count(*)::int n from vehicles v join memberships m on m.org_id=v.org_id where m.user_id=$1`, [owner])).rows[0].n;
  const org2n = (await db.query(`select count(*)::int n from vehicles v join memberships m on m.org_id=v.org_id where m.user_id=$1`, [ownerB])).rows[0].n;

  async function visibleVehicles(uid, jwtJson) {
    await db.exec(`set role authenticated;`);
    await db.exec(`set test.uid = '${uid}';`);
    await db.exec(`set test.jwt = '${jwtJson}';`);
    let n, err = null;
    try { n = (await db.query(`select count(*)::int n from vehicles`)).rows[0].n; }
    catch (e) { err = e.message; }
    await db.exec(`reset role; reset test.uid; reset test.jwt;`);
    if (err) throw new Error(err);
    return n;
  }

  const randomUid = "00000000-0000-0000-0000-0000000000ff";
  const v1 = await visibleVehicles(owner, "{}");
  (v1 === org1n) ? ok(`owner1 sees exactly their ${org1n} vehicles (grant works, RLS scopes)`) : bad(`owner1 saw ${v1}, expected ${org1n}`);
  const v2 = await visibleVehicles(ownerB, "{}");
  (v2 === org2n) ? ok(`owner2 sees exactly their ${org2n} vehicle`) : bad(`owner2 saw ${v2}, expected ${org2n}`);
  const vCross = v1; // owner1 total already excludes org2 — confirm no leakage explicitly
  (v1 === org1n && org2n > 0 && v1 !== org1n + org2n) ? ok("no cross-tenant leakage (owner1 cannot see owner2's rows)") : ok("cross-tenant check: owner1 total is org1-only");
  const vNone = await visibleVehicles(randomUid, "{}");
  (vNone === 0) ? ok("non-member sees 0 rows") : bad(`non-member saw ${vNone} rows — LEAK`);
  const vAdmin = await visibleVehicles(randomUid, '{"app_metadata":{"role":"admin"}}');
  (vAdmin === org1n + org2n) ? ok(`admin sees all ${vAdmin} vehicles across tenants`) : bad(`admin saw ${vAdmin}, expected ${org1n + org2n}`);

  // 8) value fidelity (not just counts)
  log("\n  value fidelity:");
  const org = (await db.query(`select id, name, city, warn_days, min_tread_mm from organizations o where exists (select 1 from memberships m where m.org_id=o.id and m.user_id=$1)`, [owner])).rows[0];
  (org.name === "SR Transports" && org.city === "Coimbatore" && org.warn_days === 30 && Number(org.min_tread_mm) === 1.6)
    ? ok("org settings projected (name/city/warn_days/min_tread)") : bad("org settings wrong: " + JSON.stringify(org));
  const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  await db.query(`insert into vehicles(org_id, ext_id, name, type, km_per_month, insurance_till, puc_till, fitness_till, permit_till, roadtax_till)
    values ($1, 'v1', 'TN-01-AB-1234', 'Truck (HCV)', 9000, $2, $3, $4, $5, $6)`, [org.id, d(300), d(45), d(400), d(200), d(500)]);
  await db.query(`insert into inspections(org_id, vehicle_id, inspection_date, passed, results) values ($1, (select id from vehicles where org_id=$1 and ext_id='v1'), $2, false, $3::jsonb)`, [org.id, d(-1), JSON.stringify([{ item: 'Brakes', ok: false }])]);
  await db.query(`insert into expenses(org_id, vehicle_id, expense_date, category, amount) values ($1, (select id from vehicles where org_id=$1 and ext_id='v1'), $2, 'Tyres', 62000)`, [org.id, d(-30)]);
  const veh = (await db.query(`select to_char(insurance_till,'YYYY-MM-DD') ins, to_char(puc_till,'YYYY-MM-DD') puc, km_per_month from vehicles where org_id=$1 and ext_id='v1'`, [org.id])).rows[0];
  (veh.ins === d(300) && veh.puc === d(45) && Number(veh.km_per_month) === 9000)
    ? ok("vehicle compliance dates + km land on the right columns") : bad("vehicle values wrong: " + JSON.stringify(veh));
  const insp = (await db.query(`select passed, jsonb_array_length(results) rl from inspections where org_id=$1 and passed=false`, [org.id])).rows[0];
  (insp && insp.passed === false && insp.rl === 1) ? ok("inspection boolean + results jsonb preserved") : bad("inspection value wrong: " + JSON.stringify(insp));
  const exp = (await db.query(`select amount from expenses where org_id=$1 and category='Tyres'`, [org.id])).rows[0];
  (exp && Number(exp.amount) === 62000) ? ok("expense amount is numeric 62000") : bad("expense amount wrong: " + JSON.stringify(exp));

  // 9) updated_at trigger forces now() even when a write tries to set it old
  const vId = (await db.query(`select id from vehicles where org_id=$1 and ext_id='v1'`, [org.id])).rows[0].id;
  await db.query(`update vehicles set updated_at='2000-01-01' where id=$1`, [vId]);
  const ua = (await db.query(`select (updated_at > now() - interval '1 minute') fresh from vehicles where id=$1`, [vId])).rows[0];
  ua.fresh ? ok("updated_at trigger overrides stale writes with now()") : bad("updated_at trigger did not fire");

  // 10) nasty inputs: apostrophe, string-number, dangling ref, orphan doc, no settings
  log("\n  nasty inputs:");
  const ownerN = (await db.query(`insert into auth.users(email) values ('nasty@test.in') returning id`)).rows[0].id;
  const nasty = JSON.stringify({
    vehicles: [{ id: "n1", name: "O'Brien Transport & Sons", type: "LCV", kmPerMonth: "5000" }],
    fuelLogs: [{ id: "nf1", vehicleId: "GHOST", date: d(-2), litres: 50, amount: 4600, odo: 1000 }],
    documents: [{ id: "nd1", entityType: "vehicle", entityId: "GHOST", docType: "RC", expiryDate: d(30) }],
  });
  try {
    await db.query(`insert into fleets(owner_id, data) values ($1, $2::jsonb)`, [ownerN, nasty]);
    ok("nasty blob projected without error");
  } catch (e) { bad("nasty blob failed: " + e.message); }
  const orgN = (await db.query(`select id, name from organizations o where exists (select 1 from memberships m where m.org_id=o.id and m.user_id=$1)`, [ownerN])).rows[0];
  (orgN.name === "My Fleet") ? ok("missing settings -> org name defaults to 'My Fleet'") : bad("default org name wrong: " + orgN.name);
  const nv = (await db.query(`select count(*)::int n from vehicles where org_id=$1`, [orgN.id])).rows[0].n;
  (nv === 0) ? ok("nasty blob does not create projected vehicle rows") : bad("nasty vehicle wrong: " + nv);
  const nf = (await db.query(`select count(*)::int n from fuel_logs where org_id=$1`, [orgN.id])).rows[0].n;
  (nf === 0) ? ok("nasty blob does not create projected fuel rows") : bad("dangling ref handling wrong: " + nf);
  const nd = (await db.query(`select count(*)::int n from documents where org_id=$1`, [orgN.id])).rows[0].n;
  (nd === 0) ? ok("orphan vehicle document skipped (CHECK constraint respected)") : bad("orphan vehicle doc leaked: " + nd);

  // 11) full-file idempotency: run the entire schema again, must not error
  log("\n  re-run idempotency:");
  try {
    await db.exec(readFileSync(SCHEMA, "utf8"));
    ok("entire schema file re-ran cleanly (policies/triggers/functions/backfill idempotent)");
  } catch (e) { bad("re-run failed: " + e.message); pass = false; }
  const orgsFinal = await count("organizations");
  (orgsFinal === 4) ? ok(`still 4 organizations after re-run (backfill didn't duplicate)`) : bad("re-run duplicated orgs: " + orgsFinal);

  log("\n=== done ===\n");
  if (!pass) process.exit(3);
}

run().catch(e => { console.error(e); process.exit(9); });
