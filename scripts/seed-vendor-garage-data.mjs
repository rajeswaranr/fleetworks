#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_COUNT = 200;
const DEFAULT_OUT = ".tmp/vendor-garage-seed.json";
const DEFAULT_STORAGE_STATE = ".tmp/vendor-garage-storage-state.json";

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

function hasArg(name) {
  return process.argv.includes(name);
}

function ensureDir(filePath) {
  mkdirSync(dirname(resolve(root, filePath)), { recursive: true });
}

function createRng(seedText = "fleetworks-vendor-seed") {
  let h = 2166136261;
  for (const ch of String(seedText)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, values) {
  return values[Math.floor(rng() * values.length)];
}

function randint(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateInRange(rng, minDays, maxDays) {
  return daysFromNow(randint(rng, minDays, maxDays));
}

function uid(prefix, rng, index) {
  return `${prefix}${String(index + 1).padStart(4, "0")}_${Math.floor(rng() * 1e8).toString(36)}`;
}

function plate(rng, index) {
  const states = ["TN", "KA", "KL", "AP", "TS", "MH", "GJ", "RJ", "UP", "HR", "PB", "WB"];
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `${pick(rng, states)}-${String(randint(rng, 1, 99)).padStart(2, "0")}-${letters[randint(rng, 0, letters.length - 1)]}${letters[randint(rng, 0, letters.length - 1)]}-${String(1000 + index * 23 + randint(rng, 0, 899)).slice(-4)}`;
}

function weightedStatus(rng) {
  const roll = rng();
  if (roll < 0.14) return "Planned";
  if (roll < 0.27) return "Estimate Sent";
  if (roll < 0.40) return "Approved";
  if (roll < 0.56) return "In Progress";
  if (roll < 0.78) return "Completed";
  if (roll < 0.93) return "Delivered";
  return "Planned-Rejected";
}

function estimateFor(rng, issue, status) {
  const parts = {
    "PM service": [["Engine oil 15W-40", 2, 6400], ["Oil filter", 1, 420], ["Greasing", 1, 900], ["Labour", 1, 1600]],
    "Brake": [["Brake liner set", 1, 5200], ["Drum skimming", 2, 800], ["Brake fluid", 1, 650], ["Labour", 1, 2200]],
    "Clutch": [["Clutch plate", 1, 14500], ["Pressure plate", 1, 9800], ["Release bearing", 1, 2600], ["Gearbox labour", 1, 4200]],
    "Electrical": [["Alternator refurb", 1, 5400], ["Belt", 1, 750], ["Battery terminal kit", 1, 450], ["Labour", 1, 1100]],
    "Tyre": [["10.00R20 tyre", 2, 17800], ["Valve set", 2, 120], ["Balancing", 1, 900]],
    "Suspension": [["Leaf spring pack", 1, 14800], ["Bush kit", 1, 1800], ["U-bolt set", 1, 2200], ["Labour", 1, 3000]],
    "Cooling": [["Radiator cleaning", 1, 2600], ["Coolant 5L", 2, 720], ["Hose clamp set", 1, 380], ["Labour", 1, 1500]],
  };
  const key = Object.keys(parts).find(k => issue.includes(k)) || pick(rng, Object.keys(parts));
  const items = parts[key].map(([desc, qty, base]) => ({
    desc,
    qty,
    rate: Math.round(base * (0.9 + rng() * 0.25)),
  }));
  const total = items.reduce((sum, item) => sum + item.qty * item.rate, 0);
  return { items, total, status };
}

function inspectionFor(rng, issue) {
  const checks = ["Body & cabin condition", "Fuel level & seals", "Tyres & stepney", "Battery & electricals", "Fluid levels", "Dashboard warning lamps", "Tools & documents in cabin", "Underbody / leaks"];
  const failedWords = issue.includes("Brake") ? ["Tyres & stepney", "Dashboard warning lamps"] :
    issue.includes("Electrical") ? ["Battery & electricals"] :
      issue.includes("Cooling") ? ["Fluid levels", "Underbody / leaks"] : [];
  const items = checks.map(item => ({
    item,
    ok: failedWords.includes(item) ? rng() > 0.65 : rng() > 0.12,
  }));
  return {
    items,
    notes: items.some(x => !x.ok)
      ? "Findings recorded. Customer approval required before extra work."
      : "All standard intake checks passed.",
  };
}

function photosFor(rng, jobId) {
  const count = randint(rng, 1, 4);
  return Array.from({ length: count }, (_, i) => ({
    src: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='360' height='240'%3E%3Crect width='360' height='240' fill='%23f4f7fb'/%3E%3Ctext x='24' y='122' font-family='Arial' font-size='18' fill='%230f1e33'%3E${encodeURIComponent(jobId)} photo ${i + 1}%3C/text%3E%3C/svg%3E`,
    at: dateInRange(rng, -20, 0),
  }));
}

export function buildGarageSeed(options = {}) {
  const count = Number(options.count || DEFAULT_COUNT);
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error("count must be between 1 and 1000.");
  const rng = createRng(options.seed || `vendor-garage-${count}`);
  const cities = ["Chennai", "Salem", "Coimbatore", "Bengaluru", "Hyderabad", "Mumbai", "Pune", "Madurai", "Kochi", "Vijayawada", "Nagpur", "Jaipur"];
  const owners = ["SR Transports", "Kovai Cargo Movers", "Malabar Freight Lines", "Nandi Logistics", "Deccan Roadlines", "Western Haulage", "Pearl City Carriers", "Metro Cold Chain"];
  const drivers = ["Suresh Kumar", "Manoj Yadav", "Ravi Shankar", "Peter D'Souza", "Sathish", "Noushad", "Karthik R", "Balamurugan", "Irfan Khan", "Mahesh Pawar"];
  const issues = [
    "PM service — oil, filters, greasing",
    "Brake liner wear and pedal vibration",
    "Clutch slipping under load",
    "Electrical alternator not charging",
    "Tyre rotation and rear axle replacement",
    "Suspension leaf spring noise",
    "Cooling temperature climbing on ghats",
    "Air leak in brake system",
    "Battery weak during morning start",
    "Body welding and silencer bracket repair",
  ];

  const jobs = Array.from({ length: count }, (_, index) => {
    const rawStatus = weightedStatus(rng);
    const status = rawStatus === "Planned-Rejected" ? "Planned" : rawStatus;
    const issue = pick(rng, issues);
    const job = {
      id: uid("job", rng, index),
      vehicle: plate(rng, index),
      owner: pick(rng, owners),
      driver: pick(rng, drivers),
      issue,
      scheduledDate: status === "Planned" ? dateInRange(rng, -2, 10) : dateInRange(rng, -25, 2),
      status,
      estimate: null,
      photos: [],
      inspection: null,
      completedAt: null,
      finalAmount: null,
      rating: null,
    };

    if (["Estimate Sent", "Approved", "In Progress", "Completed", "Delivered"].includes(status)) {
      job.estimate = estimateFor(rng, issue, status === "Estimate Sent" ? "Sent" : "Approved");
    }
    if (rawStatus === "Planned-Rejected") {
      job.estimate = estimateFor(rng, issue, "Rejected");
    }
    if (["In Progress", "Completed", "Delivered"].includes(status)) {
      job.inspection = inspectionFor(rng, issue);
      job.photos = photosFor(rng, job.id);
    }
    if (["Completed", "Delivered"].includes(status)) {
      const base = job.estimate ? job.estimate.total : randint(rng, 2500, 85000);
      job.completedAt = dateInRange(rng, -60, 0);
      job.finalAmount = Math.round(base * (0.92 + rng() * 0.18));
      job.rating = status === "Delivered" || rng() > 0.30 ? pick(rng, [3, 4, 4, 4, 5, 5, 5]) : null;
    }
    return job;
  });

  const stockNames = [
    ["Brake Liner Set — HCV", "BL-HCV"], ["Engine Oil 15W-40 (20L)", "OIL-15W40"], ["Oil Filter — Tata/AL", "OF-TA"],
    ["Air Filter — BS6 HCV", "AF-BS6"], ["Clutch Plate — 380mm", "CP-380"], ["10.00R20 Tyre", "TY-1020"],
    ["Coolant (5L)", "CL-5L"], ["Alternator Belt B62", "BLT-B62"], ["Battery 12V 150Ah", "BAT-150"], ["Leaf Spring Bush Kit", "LSB-KIT"],
    ["Radiator Hose", "RAD-HOSE"], ["Wheel Bearing Kit", "WB-KIT"], ["Grease Cartridge", "GRS-CTG"], ["Headlamp Assembly", "HL-ASSY"],
  ];
  const stock = stockNames.map(([name, part], index) => {
    const minQty = randint(rng, 2, 8);
    const qty = index % 4 === 0 ? randint(rng, 0, minQty) : randint(rng, minQty + 1, minQty + 14);
    return {
      id: uid("part", rng, index),
      name,
      partNo: `${part}-${randint(rng, 100, 999)}`,
      qty,
      minQty,
      unitCost: randint(rng, 250, 22000),
    };
  });

  const payouts = Array.from({ length: 8 }, (_, index) => {
    const periodStart = daysFromNow(-15 * (index + 2));
    const periodEnd = daysFromNow(-15 * (index + 1) - 1);
    const gross = randint(rng, 28000, 260000);
    return {
      id: uid("pay", rng, index),
      periodStart,
      periodEnd,
      gross,
      commission: Math.round(gross * 0.10),
      net: Math.round(gross * 0.90),
      status: "Paid",
      paidOn: daysFromNow(-15 * (index + 1)),
    };
  });

  const complaintJobs = jobs.filter(j => ["Completed", "Delivered"].includes(j.status)).slice(0, Math.max(8, Math.round(count * 0.08)));
  const complaints = complaintJobs.map((job, index) => ({
    id: uid("cmp", rng, index),
    job: `${job.issue} — ${job.vehicle}`,
    text: pick(rng, [
      "Noise returned after delivery.",
      "Bill item clarification requested.",
      "Vehicle pickup delayed by one day.",
      "Customer says cabin was not cleaned.",
      "Part warranty proof requested.",
    ]),
    status: index % 3 === 0 ? "Open" : "Resolved",
    date: dateInRange(rng, -30, -1),
  }));

  return {
    profile: {
      name: options.workshopName || "Mithriesh FleetWorks Partner Garage",
      city: options.city || "Chennai",
      phone: options.phone || "9500123456",
      gstin: options.gstin || "33AAPCM8888F1Z6",
      advisor: {
        name: "Karthikeyan R",
        role: "FleetWorks Service Advisor — South cluster",
        phone: "9740799722",
        email: "partners@fleetworks.in",
      },
    },
    jobs,
    stock,
    payouts,
    complaints,
    demo: false,
  };
}

export function buildStorageState({ origin, garageData }) {
  const localStorage = [{ name: "fw_garage", value: JSON.stringify(garageData) }];
  return {
    cookies: [],
    origins: [{ origin, localStorage }],
  };
}

export function summarizeGarageSeed(data) {
  const statusCounts = data.jobs.reduce((map, job) => {
    map[job.status] = (map[job.status] || 0) + 1;
    return map;
  }, {});
  return {
    jobs: data.jobs.length,
    statusCounts,
    estimates: data.jobs.filter(j => j.estimate).length,
    inspections: data.jobs.filter(j => j.inspection).length,
    completedOrDelivered: data.jobs.filter(j => ["Completed", "Delivered"].includes(j.status)).length,
    stock: data.stock.length,
    lowStock: data.stock.filter(p => p.qty <= p.minQty).length,
    payouts: data.payouts.length,
    complaints: data.complaints.length,
    openComplaints: data.complaints.filter(c => c.status !== "Resolved").length,
  };
}

async function jsonFetch(baseUrl, path, options = {}) {
  const response = await fetch(baseUrl + path, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message || data?.msg || data?.error_description || data?.error || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function loginVendor({ email, password, cfg }) {
  const session = await jsonFetch(cfg.url, "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": cfg.anonKey },
    body: JSON.stringify({ email, password }),
  });
  const apps = await jsonFetch(
    cfg.url,
    "/rest/v1/vendor_applications?owner_id=eq." + encodeURIComponent(session.user?.id || "") + "&select=id,business_name,status&limit=1",
    {
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg.anonKey,
        "Authorization": "Bearer " + session.access_token,
      },
    }
  ).catch(() => []);
  const metadata = session.user?.user_metadata || {};
  const isPartner = metadata.fleetworks_role === "partner" || metadata.role === "partner" || apps.length > 0;
  if (!isPartner) throw new Error("Login succeeded, but this account was not detected as a vendor/partner account.");
  return {
    ...session,
    user: {
      ...(session.user || {}),
      email,
      user_metadata: { ...metadata, fleetworks_role: "partner", role: "partner" },
    },
  };
}

async function main() {
  const email = argValue("--email", process.env.FLEETWORKS_VENDOR_EMAIL || "");
  const password = argValue("--password", process.env.FLEETWORKS_VENDOR_PASSWORD || "");
  const count = Number(argValue("--count", process.env.FLEETWORKS_VENDOR_SEED_COUNT || String(DEFAULT_COUNT)));
  const out = argValue("--out", DEFAULT_OUT);
  const storageStatePath = argValue("--storage-state", DEFAULT_STORAGE_STATE);
  const origin = argValue("--origin", "http://localhost:8090");
  const seed = argValue("--seed", "vendor-garage-seed");
  const skipLogin = hasArg("--skip-login");

  if (!skipLogin && (!email || !password)) {
    console.error("Usage: node scripts/seed-vendor-garage-data.mjs --email=<vendor-email> --password=<vendor-password>");
    console.error("Optional: --email=<vendor-email> --count=200 --origin=http://localhost:8090 --skip-login");
    process.exit(1);
  }

  const garageData = buildGarageSeed({ count, seed });
  if (!skipLogin) await loginVendor({ email, password, cfg: readBackendConfig() });

  ensureDir(out);
  writeFileSync(resolve(root, out), JSON.stringify(garageData, null, 2));

  ensureDir(storageStatePath);
  writeFileSync(resolve(root, storageStatePath), JSON.stringify(buildStorageState({ origin, garageData }), null, 2));

  const summary = summarizeGarageSeed(garageData);
  console.log(`Generated ${summary.jobs} vendor garage jobs.`);
  console.table(summary.statusCounts);
  console.log(`Seed data: ${out}`);
  console.log(`Playwright storage state: ${storageStatePath}`);
  console.log(`Low-stock items: ${summary.lowStock}/${summary.stock}, complaints: ${summary.openComplaints}/${summary.complaints}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
  });
}
