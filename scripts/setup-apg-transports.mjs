#!/usr/bin/env node
/**
 * One-shot setup: create APG Transports account + seed all FleetWorks tables.
 * Usage:
 *   SUPABASE_SERVICE_KEY=<service_role_key> node scripts/setup-apg-transports.mjs
 */
import { readFileSync } from "node:fs";
import { resolve }      from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function readBackend() {
  const src = readFileSync(resolve(root, "js/backend.js"), "utf8");
  const url     = src.match(/url:\s*"([^"]+)"/)?.[1] || "";
  const anonKey = src.match(/anonKey:\s*"([^"]+)"/)?.[1] || "";
  if (!url || !anonKey) throw new Error("Cannot read Supabase config from js/backend.js");
  return { url, anonKey };
}

const cfg        = readBackend();
const SVC_KEY    = process.env.SUPABASE_SERVICE_KEY || "";
if (!SVC_KEY) { console.error("Set SUPABASE_SERVICE_KEY env var."); process.exit(1); }

const EMAIL    = "apgtransports@gmail.com";
const PASSWORD = "Fleetworks@123";
const ORG_NAME = "APG Transports";
const VEHICLES = 15;

// ── helpers ───────────────────────────────────────────────────────────────────

async function apiAdmin(path, opts = {}) {
  const r = await fetch(cfg.url + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "apikey": SVC_KEY,
      "Authorization": "Bearer " + SVC_KEY,
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(data?.message || data?.error || `HTTP ${r.status}`);
  return data;
}

async function restInsert(tok, table, rows, returning = false) {
  if (!rows.length) return [];
  const r = await fetch(`${cfg.url}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": cfg.anonKey,
      "Authorization": "Bearer " + tok,
      "Prefer": returning ? "return=representation" : "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : [];
  if (!r.ok) throw new Error(data?.message || data?.hint || JSON.stringify(data).slice(0,200));
  return returning ? (Array.isArray(data) ? data : [data]) : [];
}

// ── random helpers ─────────────────────────────────────────────────────────────

const c  = arr => arr[Math.floor(Math.random() * arr.length)];
const ri = (a,b) => Math.floor(Math.random() * (b-a+1)) + a;
const ago = (a,b) => { const d = new Date(); d.setDate(d.getDate()-ri(a,b)); return d.toISOString().slice(0,10); };
const fwd = (a,b) => { const d = new Date(); d.setDate(d.getDate()+ri(a,b)); return d.toISOString().slice(0,10); };
const plate = i => {
  const s=["AP","TS","KA","TN","MH"]; const L="ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `${c(s)}-${String(ri(1,99)).padStart(2,"0")}-${L[ri(0,L.length-1)]}${L[ri(0,L.length-1)]}-${String(1000+i*43+ri(0,899)).slice(-4)}`;
};

// ── data builders ─────────────────────────────────────────────────────────────

function mkVehicles(orgId) {
  const makes=["Tata","Ashok Leyland","BharatBenz","Eicher","Mahindra"];
  const models=["Prima","Boss","Blazo","Signa","Dost","Furio"];
  const types=["Truck","Tipper","Trailer","LCV","Tanker","Container"];
  const batch=Date.now().toString(36);
  return Array.from({length:VEHICLES},(_,i)=>({
    org_id:orgId, ext_id:`apg_${batch}_${String(i+1).padStart(2,"0")}`,
    name:plate(i+1), type:c(types), km_per_month:ri(4000,14000),
    status:c(["Active","Active","Active","Service Due","Idle"]),
    make:c(makes), model:c(models), year:ri(2018,2026),
    chassis_no:`CHS${batch.toUpperCase()}${String(i+1).padStart(3,"0")}`,
    engine_no:`ENG${ri(1000000,9999999)}`,
    ownership:c(["Owned","Leased","Financed"]),
    fleet_group:c(["Long Haul","City","Regional","Construction"]),
    depot:c(["Hyderabad","Vijayawada","Bengaluru","Chennai","Pune"]),
    emission:c(["BS-IV","BS-VI"]), fuel_type:c(["Diesel","Diesel","Diesel","CNG"]),
    tank_capacity:ri(200,400), color:c(["White","Blue","Red","Silver","Yellow"]),
    gvw:ri(7500,42000), payload:ri(3000,35000),
    axle_config:c(["4x2","6x2","6x4","8x2"]),
    tyre_front_psi:ri(85,115), tyre_rear_psi:ri(90,125),
    tyre_size:c(["295/80R22.5","10.00R20","11R22.5"]),
    rto:c(["AP-09","TS-08","TS-09","KA-01","TN-22"]),
    purchase_date:ago(90,2500), purchase_price:ri(800000,5500000),
    purchase_vendor:c(["Dealer Direct","FleetWorks Partner","OEM Finance"]),
    in_service_date:ago(60,2400), service_life_months:c([60,72,84,96,120]),
    resale_value:ri(200000,2000000),
    insurance_till:fwd(20,365), puc_till:fwd(10,180),
    fitness_till:fwd(25,420), permit_till:fwd(30,480), roadtax_till:fwd(40,720),
    notes:"APG Transports seeded vehicle.",
  }));
}

function mkDrivers(orgId, vehicles, batch) {
  const fn=["Ravi","Suresh","Praveen","Sanjay","Anil","Vijay","Ramesh","Naresh","Sunil","Ganesh"];
  const ln=["Rao","Reddy","Kumar","Sharma","Naidu","Verma","Gupta","Singh","Patel","Babu"];
  return vehicles.map((v,i)=>({
    org_id:orgId, ext_id:`apgdrv_${batch}_${String(i+1).padStart(2,"0")}`,
    name:`${c(fn)} ${c(ln)}`, phone:"9"+String(ri(600000000,999999999)),
    dl_no:`AP${batch.toUpperCase()}${String(i+1).padStart(3,"0")}`,
    dl_expiry:i%6===0?fwd(8,30):fwd(120,1000), vehicle_id:v.id,
    upi_id:`apgdriver${i+1}@ybl`,
    bank_account:String(ri(1000000000,9999999999)),
    bank_ifsc:"SBIN000"+String(ri(1000,9999)),
    pay_basis:c(["trip","monthly","daily","tonnage"]),
  }));
}

function mkFuelLogs(orgId, vehicles) {
  const rows=[];
  vehicles.forEach((v,i)=>{
    let odo=ri(30000,220000);
    rows.push({org_id:orgId,vehicle_id:v.id,log_date:ago(95,110),litres:0,amount:0,odometer:odo,opening:true});
    for(let j=0;j<6;j++){
      odo+=ri(700,2400); const L=ri(100,320);
      rows.push({org_id:orgId,vehicle_id:v.id,log_date:ago(88-j*14,92-j*14),litres:L,amount:L*ri(88,98),odometer:odo,opening:false});
    }
  });
  return rows;
}

function mkExpenses(orgId, vehicles) {
  const cats=[["Oil Change",8000,22000],["Tyres",20000,90000],["Brake Service",8000,35000],
    ["Clutch Work",18000,80000],["Battery",7000,24000],["Toll",1500,12000],
    ["Engine Repair",30000,150000],["General Service",6000,25000],["Permit Fee",3000,18000]];
  const vendors=["Highway Motors","AP Auto Service","Quick Fix Trucks","FleetWorks Partner"];
  const rows=[];
  vehicles.forEach((v,i)=>{ for(let j=0;j<3;j++){
    const [cat,min,max]=c(cats);
    rows.push({org_id:orgId,vehicle_id:v.id,expense_date:ago(1,85),category:cat,
      amount:ri(min,max),title:`${cat} – ${v.name}`,vendor:c(vendors),
      bill_no:`APG-${Date.now().toString(36).toUpperCase()}-${i+1}-${j+1}`});
  }});
  return rows;
}

function mkReminders(orgId, vehicles) {
  const tasks=["Oil Change","Brake Inspection","Wheel Alignment","General Service (PMS)","Greasing","Air Filter","Coolant Flush"];
  return vehicles.flatMap((v,i)=>[
    {org_id:orgId,vehicle_id:v.id,task:c(tasks),every_months:c([1,2,3,6]),last_date:i%4===0?ago(140,200):ago(10,100)},
    {org_id:orgId,vehicle_id:v.id,task:c(tasks),every_months:c([3,6,12]),last_date:i%5===0?ago(200,360):ago(30,160)},
  ]);
}

function mkInspections(orgId, vehicles) {
  const checks=["Brakes","Lights","Tyres","Oil level","Horn","Mirrors","Wipers","Steering","Battery","Fire extinguisher"];
  return vehicles.map((v,i)=>{
    const failN=i%4===0?ri(1,2):0; const failed=new Set();
    while(failed.size<failN) failed.add(c(checks));
    return {org_id:orgId,vehicle_id:v.id,inspection_date:ago(1,35),passed:failN===0,
      results:checks.map(item=>({item,ok:!failed.has(item)})),notes:failN?"Defects found.":"All clear."};
  });
}

function mkIssues(orgId, vehicles, batch) {
  const titles=["Brake pedal soft","Engine knocking","Oil leak near engine","Battery not charging",
    "AC not working","Tyre sidewall crack","Steering play excessive","Coolant dropping"];
  return vehicles.map((v,i)=>({
    org_id:orgId,vehicle_id:v.id,ext_id:`apgiss_${batch}_${String(i+1).padStart(2,"0")}`,
    title:c(titles),severity:i%5===0?"High":i%3===0?"Medium":"Low",
    status:i%4===0?"In Progress":"Open",reported_at:ago(1,30),
    source:c(["Driver","Inspection","Foresight","Garage"]),
  }));
}

function mkWorkOrders(orgId, issues) {
  const vendors=["Highway Motors","AP Road Service","Quick Fix Trucks","FleetWorks Partner"];
  return issues.filter((_,i)=>i%2===0).map((iss,i)=>({
    org_id:orgId,vehicle_id:iss.vehicle_id,issue_id:iss.id,
    title:`Job: ${iss.title}`,vendor:c(vendors),est_cost:ri(10000,90000),
    final_cost:i%3===0?ri(9000,85000):null,
    status:i%3===0?"Completed":"Open",
    opened_at:new Date(Date.now()-ri(3,30)*86400000).toISOString(),
    completed_at:i%3===0?new Date(Date.now()-ri(1,8)*86400000).toISOString():null,
  }));
}

function mkDocuments(orgId, vehicles) {
  const docTypes=["Insurance","PUC","Fitness Certificate (FC)","National Permit","Road Tax","Goods Permit"];
  return vehicles.flatMap((v,i)=>docTypes.map((doc_type,j)=>({
    org_id:orgId,entity_type:"vehicle",vehicle_id:v.id,doc_type,
    number:`${doc_type.replace(/[^A-Z]/gi,"").slice(0,3).toUpperCase()}-${v.name.replace(/\s/g,"")}-${j+1}`,
    issue_date:ago(60,600),
    expiry_date:i%8===0&&j===1?fwd(3,15):fwd(30,600),
    note:"APG Transports compliance document.",
  })));
}

function mkTyreReadings(orgId, vehicles) {
  const positions=["FL","FR","RL","RR"];
  return vehicles.flatMap((v,i)=>positions.map(pos=>({
    org_id:orgId,vehicle_id:v.id,position:pos,
    tread_depth_mm:i%5===0?+(ri(15,25)/10).toFixed(1):+(ri(40,100)/10).toFixed(1),
    pressure_psi:ri(85,120),odometer:ri(30000,250000),reading_date:ago(1,20),
  })));
}

function mkTrips(orgId, vehicles) {
  const routes=[["Hyderabad","Vijayawada"],["Pune","Mumbai"],["Bengaluru","Chennai"],
    ["Hyderabad","Pune"],["Vijayawada","Kochi"],["Chennai","Coimbatore"],
    ["Hyderabad","Bengaluru"],["Pune","Hyderabad"]];
  return vehicles.flatMap(v=>Array.from({length:3},()=>{
    const [from,to]=c(routes); const km=ri(250,1100);
    return {org_id:orgId,vehicle_id:v.id,trip_date:ago(2,75),from_loc:from,to_loc:to,
      freight:km*ri(55,105),km,status:c(["completed","completed","completed","started"])};
  }));
}

function mkParts(orgId, batch) {
  return [["Engine Oil 15W40","Lubricants",11500,10,4],["Air Filter","Filters",1900,20,8],
    ["Brake Lining","Brakes",7200,12,5],["Fuel Filter","Filters",2400,6,4],
    ["Clutch Plate","Transmission",15000,4,2],["Coolant 5L","Lubricants",950,25,10],
    ["Wiper Blades","Body",480,15,6],["LED Headlight","Electrical",620,10,4],
  ].map(([name,category,unitCost,qty,min_qty],i)=>({
    org_id:orgId,name,part_number:`APG-${batch.toUpperCase()}-${String(i+1).padStart(2,"0")}`,
    make:c(["Tata Genuine","Bosch","TVS","BharatBenz Genuine","MRF"]),
    category,sourcing:c(["OEM","Aftermarket","FleetWorks Partner"]),
    vendor:c(["Metro Auto Parts","AP Auto Spares","FleetWorks Partner"]),
    unit_cost:unitCost,qty,min_qty,
    location:c(["Hyderabad Depot","Vijayawada Store","Main Store"]),
    purchase_date:ago(10,120),warranty_expiry:fwd(60,540),
  }));
}

function mkConsignments(orgId, vehicles, trips) {
  const customers=["Ramaiah Traders","Krishna Logistics","Sai Enterprises","Venkat Exports","AP Steel Co"];
  const goods=["Steel Rods","Cement Bags","Cotton Bales","Electronics","FMCG","Auto Parts"];
  return trips.filter((_,i)=>i%3===0).slice(0,20).map((t,i)=>({
    org_id:orgId,vehicle_id:t.vehicle_id,trip_id:t.id,
    lr_no:`LR-APG-${Date.now().toString(36).toUpperCase()}-${i+1}`,
    customer:c(customers),from_loc:t.from_loc,to_loc:t.to_loc,
    goods:c(goods),weight_kg:ri(2000,22000),
    freight_amount:ri(18000,95000),advance_amount:ri(5000,30000),
    status:c(["delivered","delivered","dispatched","billed"]),
    delivered_at:null,
  }));
}

function mkFleetAlerts(orgId, vehicles) {
  const kinds=["incident","geofence","device_offline","device_back","cold_chain"];
  const titles=["Harsh Braking Detected","Geofence Exit","Device Offline","Device Back Online","Fatigue Alert"];
  return vehicles.filter((_,i)=>i%3===0).map((v,i)=>({
    org_id:orgId,vehicle_id:v.id,
    kind:c(kinds),severity:c(["critical","warning","info"]),
    title:titles[i%titles.length],
    body:`Alert triggered for vehicle ${v.name} — review required`,
    simulated:true,
    created_at:new Date(Date.now()-ri(1,15)*86400000).toISOString(),
  }));
}

function mkDevices(orgId, vehicles) {
  return vehicles.map((v,i)=>({
    org_id:orgId,vehicle_id:v.id,
    imei:`8640${String(23000000+i).padStart(8,"0")}`,
    kind:"tracker",integration:"manual",
    vendor:"Teltonika",model:"FMB140",protocol:"teltonika",
    status:"active",simulated:true,
    installed_at:new Date(Date.now()-ri(30,180)*86400000).toISOString(),
    last_seen_at:new Date(Date.now()-ri(1,120)*60000).toISOString(),
  }));
}

function mkDeviceEvents(orgId, devices) {
  const types=["harsh_brake","harsh_accel","overspeed","fatigue","fuel_drop","route_deviation","prolonged_idle"];
  return devices.flatMap(d=>Array.from({length:3},()=>({
    org_id:orgId,device_id:d.id,vehicle_id:d.vehicle_id,
    event_type:c(types),severity:c(["warning","critical","info"]),
    occurred_at:new Date(Date.now()-ri(1,30)*86400000).toISOString(),
    latitude:17.385+(Math.random()-0.5), longitude:78.486+(Math.random()-0.5),
    speed_kmph:ri(60,120),simulated:true,
  })));
}

// ── main ──────────────────────────────────────────────────────────────────────

console.log("⏳ Creating APG Transports account…");

// 1. Find existing auth user (already created) or create
let userId;
try {
  const list = await apiAdmin(`/auth/v1/admin/users?page=1&per_page=50`);
  const existing = list?.users?.find(u => u.email === EMAIL);
  if (existing) { userId = existing.id; console.log(`  ✓ Auth user: ${userId}`); }
} catch (_) {}

if (!userId) {
  const u = await apiAdmin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email:EMAIL, password:PASSWORD, email_confirm:true,
      user_metadata:{ full_name:"APG Transports", role:"owner" } }),
  });
  userId = u.id;
  console.log(`  ✓ Auth user created: ${userId}`);
}

// 2. Find existing org (created via SQL) or create
let orgId;
const existingOrgs = await apiAdmin(`/rest/v1/memberships?select=org_id,organizations(name)&user_id=eq.${userId}&role=eq.owner`);
if (existingOrgs?.length) {
  orgId = existingOrgs[0].org_id;
  console.log(`  ✓ Org found: ${orgId}`);
} else {
  const orgRow = await apiAdmin("/rest/v1/organizations", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{ name:ORG_NAME, city:"Hyderabad" }]),
  });
  orgId = orgRow[0].id;
  await apiAdmin("/rest/v1/memberships", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([{ org_id:orgId, user_id:userId, role:"owner" }]),
  });
  console.log(`  ✓ Org + membership created: ${orgId}`);
}

// 4. Login as new user (for RLS-safe inserts)
const sess = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { "Content-Type":"application/json", "apikey":cfg.anonKey },
  body: JSON.stringify({ email:EMAIL, password:PASSWORD }),
}).then(r=>r.json());
const tok = sess.access_token;
if (!tok) throw new Error("Login failed: " + JSON.stringify(sess));
console.log(`  ✓ Signed in as ${EMAIL}\n`);

// 5. Seed tables
const batch = Date.now().toString(36);
console.log(`⏳ Seeding ${VEHICLES} vehicles + all operational tables…`);

const vehicles   = await restInsert(tok, "vehicles",      mkVehicles(orgId),              true);  console.log(`  ✓ ${vehicles.length} vehicles`);
const drivers    = await restInsert(tok, "drivers",       mkDrivers(orgId,vehicles,batch), true);  console.log(`  ✓ ${drivers.length} drivers`);
                   await restInsert(tok, "fuel_logs",      mkFuelLogs(orgId,vehicles));             console.log(`  ✓ fuel_logs`);
                   await restInsert(tok, "expenses",       mkExpenses(orgId,vehicles));             console.log(`  ✓ expenses`);
                   await restInsert(tok, "reminders",      mkReminders(orgId,vehicles));            console.log(`  ✓ reminders`);
                   await restInsert(tok, "inspections",    mkInspections(orgId,vehicles));          console.log(`  ✓ inspections`);
const issues     = await restInsert(tok, "issues",        mkIssues(orgId,vehicles,batch),  true);  console.log(`  ✓ ${issues.length} issues`);
const workOrders = await restInsert(tok, "work_orders",   mkWorkOrders(orgId,issues),      true);  console.log(`  ✓ ${workOrders.length} work orders`);
                   await restInsert(tok, "documents",      mkDocuments(orgId,vehicles));            console.log(`  ✓ documents`);
                   await restInsert(tok, "tyre_readings",  mkTyreReadings(orgId,vehicles));         console.log(`  ✓ tyre readings`);
const trips      = await restInsert(tok, "trips",         mkTrips(orgId,vehicles),         true);  console.log(`  ✓ ${trips.length} trips`);
                   await restInsert(tok, "parts",          mkParts(orgId,batch));                   console.log(`  ✓ parts/spares`);
const conns      = await restInsert(tok, "consignments",  mkConsignments(orgId,vehicles,trips), true); console.log(`  ✓ ${conns.length} consignments`);
                   await restInsert(tok, "fleet_alerts",   mkFleetAlerts(orgId,vehicles));          console.log(`  ✓ fleet alerts`);
const devices    = await restInsert(tok, "devices",        mkDevices(orgId,vehicles),        true);  console.log(`  ✓ ${devices.length} devices`);
                   await restInsert(tok, "device_events",  mkDeviceEvents(orgId,devices));          console.log(`  ✓ device events`);

console.log(`
╔═══════════════════════════════════════════════════════╗
║  APG Transports — Account Ready ✓                     ║
╠═══════════════════════════════════════════════════════╣
║  URL      : https://fleetworks.in                     ║
║  Email    : apgtransports@gmail.com                   ║
║  Password : Fleetworks@123                            ║
╠═══════════════════════════════════════════════════════╣
║  Vehicles   : ${String(vehicles.length).padEnd(38)}   ║
║  Drivers    : ${String(drivers.length).padEnd(38)}   ║
║  Trips      : ${String(trips.length).padEnd(38)}   ║
║  Issues     : ${String(issues.length).padEnd(38)}   ║
║  Work Orders: ${String(workOrders.length).padEnd(38)}   ║
║  Consignmts : ${String(conns.length).padEnd(38)}   ║
╚═══════════════════════════════════════════════════════╝
`);
