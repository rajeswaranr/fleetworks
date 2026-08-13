/* ============ FleetWorks — bulk-import/controllers/bulkimport ============
   Bulk upload of vehicles and drivers via an Excel template. SheetJS is
   loaded lazily (only when a template is downloaded or a file uploaded)
   from jsdelivr, same pattern as the on-device OCR/PDF readers in
   analytics.js. Everything happens client-side against the same db.vehicles
   / db.drivers arrays and saveStore()/renderAll() the single-entry forms
   use — bulk rows end up identical to hand-typed ones. */

"use strict";

let xlsxLoading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  if (!xlsxLoading) xlsxLoading = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = res;
    s.onerror = () => { xlsxLoading = null; rej(new Error("Could not load the Excel engine — check your internet connection and try again.")); };
    document.head.appendChild(s);
  });
  return xlsxLoading;
}

// [header text in the template, db field key, kind] — kind drives both
// example-row generation and value parsing on upload.
const VEH_COLS = [
  ["Registration Number *", "name", "text"],
  ["Vehicle Type * (Truck (HCV) / LCV / Bus / Tipper / Trailer / Tanker)", "type", "text"],
  ["Status (Active / In Shop / Out of Service / Sold)", "status", "text"],
  ["Make", "make", "text"],
  ["Model", "model", "text"],
  ["Year", "year", "text"],
  ["Chassis Number", "chassisNo", "text"],
  ["Engine Number", "engineNo", "text"],
  ["Ownership (Owned / Financed / Loan / Leased / Attached)", "ownership", "text"],
  ["Average Monthly Running km", "kmPerMonth", "text"],
  ["Current Odometer km", "odo", "text"],
  ["Fleet Group", "group", "text"],
  ["Base Depot / City", "depot", "text"],
  ["Emission Norm (BS6 / BS4 / BS3 / EV)", "emission", "text"],
  ["Fuel Type (Diesel / Petrol / CNG / LNG / Electric / Hybrid)", "fuelType", "text"],
  ["Fuel Tank Capacity L", "tankCapacity", "text"],
  ["Colour", "color", "text"],
  ["Gross Vehicle Weight kg", "gvw", "text"],
  ["Payload Capacity kg", "payload", "text"],
  ["Axle Configuration (4x2 / 6x2 / 6x4 / 8x2 / 8x4 / 10x2 / 12x2)", "axleConfig", "text"],
  ["Front Tyre Pressure PSI", "tyreFrontPsi", "text"],
  ["Rear Tyre Pressure PSI", "tyreRearPsi", "text"],
  ["Tyre Size", "tyreSize", "text"],
  ["Insurance Valid Till (YYYY-MM-DD)", "insurance", "date"],
  ["PUC Valid Till (YYYY-MM-DD)", "puc", "date"],
  ["Fitness FC Valid Till (YYYY-MM-DD)", "fitness", "date"],
  ["National Permit Valid Till (YYYY-MM-DD)", "permit", "date"],
  ["Road Tax Valid Till (YYYY-MM-DD)", "roadtax", "date"],
  ["RTO Office", "rto", "text"],
  ["Purchase Date (YYYY-MM-DD)", "purchaseDate", "date"],
  ["Purchase Price ₹", "purchasePrice", "text"],
  ["Purchased From", "purchaseVendor", "text"],
  ["In-Service Date (YYYY-MM-DD)", "inServiceDate", "date"],
  ["Estimated Service Life Months", "serviceLifeMonths", "text"],
  ["Estimated Resale Value ₹", "resaleValue", "text"],
  ["Notes", "notes", "text"],
];
const VEH_EXAMPLE = {
  name: "TN-01-AB-1234", type: "Truck (HCV)", status: "Active", make: "Tata", model: "LPT 3118",
  year: "2021", kmPerMonth: "8000", fuelType: "Diesel", insurance: "2027-03-31", puc: "2026-12-31",
};

const DRV_COLS = [
  ["Driver Name *", "name", "text"],
  ["Mobile Number", "phone", "text"],
  ["DL Number *", "dlNo", "text"],
  ["DL Valid Till (YYYY-MM-DD)", "dlExpiry", "date"],
  ["Assigned Vehicle Registration Number", "vehicleName", "text"],
  ["UPI ID (for one-tap salary pay)", "upiId", "text"],
  ["Bank Account Number", "bankAccount", "text"],
  ["IFSC Code", "bankIfsc", "text"],
];
const DRV_EXAMPLE = { name: "Suresh Kumar", phone: "9840012345", dlNo: "TN01 20230012345", dlExpiry: "2029-06-30", vehicleName: "TN-01-AB-1234", upiId: "suresh@okhdfcbank", bankAccount: "12345678901", bankIfsc: "HDFC0000123" };

function excelDateToStr(v) {
  if (window.FWBulkImport) return FWBulkImport.excelDateToStr(v);
  if (v == null || v === "") return "";
  if (v instanceof Date) return isNaN(v) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "number") { const d = new Date(Math.round((v - 25569) * 86400 * 1000)); return isNaN(d) ? "" : d.toISOString().slice(0, 10); }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
}

async function downloadTemplate(cols, example, sheetName, fileName) {
  try { await loadXlsx(); } catch (e) { alert(e.message); return; }
  const headers = cols.map(c => c[0]);
  const exampleRow = cols.map(c => example[c[1]] || "");
  const ws = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
  ws["!cols"] = headers.map(h => ({ wch: Math.min(Math.max(h.length, 14), 45) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}
document.getElementById("vehTemplateBtn")?.addEventListener("click", () => downloadTemplate(VEH_COLS, VEH_EXAMPLE, "Vehicles", "fleetworks-vehicle-template.xlsx"));
document.getElementById("drvTemplateBtn")?.addEventListener("click", () => downloadTemplate(DRV_COLS, DRV_EXAMPLE, "Drivers", "fleetworks-driver-template.xlsx"));

async function readRows(file) {
  await loadXlsx();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

// Builds a get(key) reader for one uploaded row, matching each column's
// canonical header against the row's actual keys tolerant of trimmed/
// re-cased whitespace (Excel/Sheets sometimes normalise headers slightly),
// and auto-formatting "date"-kind columns to YYYY-MM-DD.
function buildGetter(row, cols) {
  if (window.FWBulkImport) return FWBulkImport.buildGetter(row, cols);
  const normMap = {};
  Object.keys(row).forEach(k => { normMap[k.trim().toLowerCase()] = k; });
  return key => {
    const col = cols.find(c => c[1] === key);
    const actualKey = normMap[col[0].trim().toLowerCase()];
    const raw = actualKey ? row[actualKey] : "";
    return col[2] === "date" ? excelDateToStr(raw) : raw;
  };
}

function resultsHtml(added, updated, untouched, errors) {
  let html = `<p style="margin-top:12px"><strong>${added}</strong> added`;
  if (updated) html += `, <strong>${updated}</strong> updated`;
  if (untouched) html += `, <strong>${untouched}</strong> left untouched`;
  if (errors.length) html += `, <strong>${errors.length}</strong> skipped`;
  html += ".</p>";
  if (errors.length) html += "<ul style='margin:6px 0 0 18px;color:#b91c1c;font-size:0.85rem'>" + errors.map(e => `<li>Row ${e.row}: ${esc(e.msg)}</li>`).join("") + "</ul>";
  return html;
}

// Confirmation panel shown BEFORE anything is written, whenever the file
// contains rows matching records already on file. Three choices: add only
// the new rows (existing untouched), add new + update existing with the
// file's values, or cancel. Imports never delete anything — that promise
// is stated right on the panel.
function confirmImport(resEl, kind, newCount, dupNames, onChoice) {
  const shown = dupNames.slice(0, 6).map(esc).join(", ") + (dupNames.length > 6 ? ` +${dupNames.length - 6} more` : "");
  resEl.innerHTML = `<div class="chart-card" style="padding:14px;margin-top:12px;border:1.5px solid #eda100">
    <p style="font-size:0.9rem"><strong>${newCount}</strong> new ${kind}${newCount === 1 ? "" : "s"} to add ·
      <strong>${dupNames.length}</strong> already in your fleet: <span class="muted">${shown}</span></p>
    <p class="muted" style="font-size:0.8rem;margin:6px 0 10px">How should the existing ${dupNames.length === 1 ? "record" : "records"} be handled?
      Nothing is ever deleted by an import — your expenses, fuel logs and every other record stay as they are.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="btn btn-primary btn-sm" data-mode="add-only">Add new only — leave existing untouched</button>
      <button type="button" class="btn btn-outline btn-sm" data-mode="update">Add new + update existing from file</button>
      <button type="button" class="btn btn-outline btn-sm" data-mode="cancel" style="color:#b91c1c">Cancel import</button>
    </div>
  </div>`;
  resEl.querySelectorAll("button[data-mode]").forEach(b =>
    b.addEventListener("click", () => {
      // replacing existing values needs a second, explicit confirmation
      if (b.dataset.mode === "update"
        && !confirm(`Update ${dupNames.length} existing ${kind}${dupNames.length === 1 ? "" : "s"} with the file's values? Only fields filled in the file overwrite what's on record — empty cells never blank out existing data. This cannot be undone.`)) return;
      onChoice(b.dataset.mode);
    }, { once: true }));
}

// Parse every vehicle row up-front (no writes): returns {news, dups, errors}.
// Each entry carries `full` (complete object for create) and `patch` (only
// the fields actually filled in the file — used in update mode so an empty
// Excel cell can never blank out data already on record).
function parseVehicleRows(rows) {
  if (window.FWBulkImport) return FWBulkImport.parseVehicleRows({ rows, cols: VEH_COLS, uidFn: uid });
  const news = [], dups = [], errors = [];
  const seenInFile = new Set();
  rows.forEach((row, i) => {
    const rowNum = i + 2; // header is row 1
    const get = buildGetter(row, VEH_COLS);
    const name = String(get("name") || "").trim().toUpperCase();
    const type = String(get("type") || "").trim();
    if (!name || !type) { if (Object.values(row).some(v => String(v).trim())) errors.push({ row: rowNum, msg: "Registration Number and Vehicle Type are required." }); return; }
    if (seenInFile.has(name)) { errors.push({ row: rowNum, msg: name + " appears more than once in this file — only the first row is used." }); return; }
    seenInFile.add(name);

    const num = key => { const v = get(key); return v !== "" && v != null ? +v : undefined; };
    const txt = key => { const v = String(get(key) || "").trim(); return v || undefined; };
    const fields = {
      type, kmPerMonth: num("kmPerMonth"), status: txt("status"),
      make: txt("make"), model: txt("model"), year: num("year"),
      chassisNo: get("chassisNo") ? String(get("chassisNo")).trim().toUpperCase() : undefined,
      engineNo: get("engineNo") ? String(get("engineNo")).trim().toUpperCase() : undefined,
      ownership: txt("ownership"), group: txt("group"), depot: txt("depot"),
      emission: txt("emission"), fuelType: txt("fuelType"),
      tankCapacity: num("tankCapacity"), color: txt("color"),
      gvw: num("gvw"), payload: num("payload"), axleConfig: txt("axleConfig"),
      tyreFrontPsi: num("tyreFrontPsi"), tyreRearPsi: num("tyreRearPsi"), tyreSize: txt("tyreSize"),
      rto: txt("rto"),
      purchaseDate: txt("purchaseDate"),
      purchasePrice: num("purchasePrice"), purchaseVendor: txt("purchaseVendor"),
      inServiceDate: txt("inServiceDate"),
      serviceLifeMonths: num("serviceLifeMonths"), resaleValue: num("resaleValue"),
      notes: txt("notes"),
    };
    // patch = only what the file actually filled in
    const patch = {};
    Object.entries(fields).forEach(([k, v]) => { if (v !== undefined) patch[k] = v; });
    const compliancePatch = {};
    ["insurance", "puc", "fitness", "permit", "roadtax"].forEach(doc => { if (get(doc)) compliancePatch[doc] = get(doc); });
    if (Object.keys(compliancePatch).length) patch.compliance = compliancePatch;

    const full = {
      id: uid(), name, ...fields,
      kmPerMonth: fields.kmPerMonth || 0, status: fields.status || "Active",
      compliance: { insurance: get("insurance"), puc: get("puc"), fitness: get("fitness"), permit: get("permit"), roadtax: get("roadtax") },
    };
    const entry = { rowNum, name, full, patch, odo: get("odo") };
    const existing = db.vehicles.find(x => x.name === name);
    if (existing) dups.push({ ...entry, existing }); else news.push(entry);
  });
  return { news, dups, errors };
}

async function applyVehicleImport(news, dups, mode, errors, resEl) {
  const dbBacked = typeof coreDbBacked === "function" && coreDbBacked();
  let added = 0, updated = 0;
  resEl.innerHTML = "<p class='muted' style='margin-top:12px'>Importing…</p>";
  for (const n of news) {
    const v = n.full;
    if (dbBacked) {
      const saved = await dbCreateVehicle(v);
      if (!saved) { errors.push({ row: n.rowNum, msg: "Could not save " + n.name + " — check your connection." }); continue; }
      Object.assign(v, saved);
      db.vehicles.push(v);
      if (n.odo) {
        const savedFl = await dbCreateFuelLog({ vehicleId: v.id, date: new Date().toISOString().slice(0, 10), litres: 0, amount: 0, odo: +n.odo, opening: true });
        if (savedFl) db.fuelLogs.push(savedFl);
      }
    } else {
      db.vehicles.push(v);
      if (n.odo) db.fuelLogs.push({ id: uid(), vehicleId: v.id, date: new Date().toISOString().slice(0, 10), litres: 0, amount: 0, odo: +n.odo, opening: true });
    }
    added++;
  }
  if (mode === "update") {
    for (const d of dups) {
      if (dbBacked) {
        const ok = await dbUpdateVehicleFields(d.existing.id, d.patch);
        if (!ok) { errors.push({ row: d.rowNum, msg: "Could not update " + d.name + " — check your connection." }); continue; }
      }
      const { compliance, ...rest } = d.patch;
      Object.assign(d.existing, rest);
      if (compliance) { d.existing.compliance = d.existing.compliance || {}; Object.assign(d.existing.compliance, compliance); }
      updated++;
    }
  }
  if (added || updated) { saveStore(); renderAll(); }
  resEl.innerHTML = resultsHtml(added, updated, mode === "update" ? 0 : dups.length, errors);
}

document.getElementById("vehUploadFile")?.addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const resEl = document.getElementById("vehUploadResult");
  resEl.innerHTML = "<p class='muted' style='margin-top:12px'>Reading file…</p>";
  let rows;
  try { rows = await readRows(file); } catch (err) { resEl.innerHTML = `<p style="color:#b91c1c;margin-top:12px">${esc(err.message || "Could not read this file.")}</p>`; e.target.value = ""; return; }
  e.target.value = "";

  const { news, dups, errors } = parseVehicleRows(rows);
  if (!news.length && !dups.length) { resEl.innerHTML = resultsHtml(0, 0, 0, errors); return; }
  if (!dups.length) { await applyVehicleImport(news, [], "add-only", errors, resEl); return; }
  confirmImport(resEl, "vehicle", news.length, dups.map(d => d.name), async mode => {
    if (mode === "cancel") { resEl.innerHTML = "<p class='muted' style='margin-top:12px'>Import cancelled — nothing was changed.</p>"; return; }
    await applyVehicleImport(news, dups, mode, errors, resEl);
  });
});

function parseDriverRows(rows) {
  if (window.FWBulkImport) return FWBulkImport.parseDriverRows({ rows, cols: DRV_COLS });
  const news = [], dups = [], errors = [];
  const seenInFile = new Set();
  rows.forEach((row, i) => {
    const rowNum = i + 2;
    const get = buildGetter(row, DRV_COLS);
    const name = String(get("name") || "").trim();
    const dlNo = String(get("dlNo") || "").trim();
    if (!name || !dlNo) { if (Object.values(row).some(v => String(v).trim())) errors.push({ row: rowNum, msg: "Driver Name and DL Number are required." }); return; }
    if (seenInFile.has(dlNo.toLowerCase())) { errors.push({ row: rowNum, msg: dlNo + " appears more than once in this file — only the first row is used." }); return; }
    seenInFile.add(dlNo.toLowerCase());

    const vehName = String(get("vehicleName") || "").trim().toUpperCase();
    let vehicleId = "";
    if (vehName) {
      const veh = db.vehicles.find(x => x.name === vehName);
      if (veh) vehicleId = veh.id;
      else errors.push({ row: rowNum, msg: `Vehicle "${vehName}" not found — driver saved without an assignment.` });
    }
    const fields = {
      name, phone: String(get("phone") || "").trim(), dlExpiry: get("dlExpiry"), vehicleId,
      upiId: String(get("upiId") || "").trim() || undefined,
      bankAccount: String(get("bankAccount") || "").replace(/\s+/g, "") || undefined,
      bankIfsc: String(get("bankIfsc") || "").trim().toUpperCase() || undefined,
    };
    const existing = db.drivers.find(d => d.dlNo.toLowerCase() === dlNo.toLowerCase());
    if (existing) dups.push({ rowNum, name, dlNo, fields, existing });
    else news.push({ rowNum, name, dlNo, fields });
  });
  return { news, dups, errors };
}

async function applyDriverImport(news, dups, mode, errors, resEl) {
  const dbBacked = typeof coreDbBacked === "function" && coreDbBacked();
  let added = 0, updated = 0;
  resEl.innerHTML = "<p class='muted' style='margin-top:12px'>Importing…</p>";
  for (const n of news) {
    const d = { id: uid(), dlNo: n.dlNo, ...n.fields };
    if (dbBacked) {
      const saved = await dbCreateDriver(d);
      if (!saved) { errors.push({ row: n.rowNum, msg: "Could not save " + n.name + " — check your connection." }); continue; }
      Object.assign(d, saved);
    }
    db.drivers.push(d); added++;
  }
  if (mode === "update") {
    for (const du of dups) {
      const f = du.fields;
      // file values win only where actually filled — blanks never erase
      const patch = {
        name: f.name, phone: f.phone || du.existing.phone, dlExpiry: f.dlExpiry || du.existing.dlExpiry,
        vehicleId: f.vehicleId || du.existing.vehicleId,
        upiId: f.upiId || du.existing.upiId, bankAccount: f.bankAccount || du.existing.bankAccount, bankIfsc: f.bankIfsc || du.existing.bankIfsc,
      };
      if (dbBacked) {
        const ok = await dbUpdateDriver(du.existing.id, patch);
        if (!ok) { errors.push({ row: du.rowNum, msg: "Could not update " + du.name + " — check your connection." }); continue; }
      }
      Object.assign(du.existing, patch); updated++;
    }
  }
  if (added || updated) { saveStore(); renderAll(); }
  resEl.innerHTML = resultsHtml(added, updated, mode === "update" ? 0 : dups.length, errors);
}

document.getElementById("drvUploadFile")?.addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const resEl = document.getElementById("drvUploadResult");
  resEl.innerHTML = "<p class='muted' style='margin-top:12px'>Reading file…</p>";
  let rows;
  try { rows = await readRows(file); } catch (err) { resEl.innerHTML = `<p style="color:#b91c1c;margin-top:12px">${esc(err.message || "Could not read this file.")}</p>`; e.target.value = ""; return; }
  e.target.value = "";

  const { news, dups, errors } = parseDriverRows(rows);
  if (!news.length && !dups.length) { resEl.innerHTML = resultsHtml(0, 0, 0, errors); return; }
  if (!dups.length) { await applyDriverImport(news, [], "add-only", errors, resEl); return; }
  confirmImport(resEl, "driver", news.length, dups.map(d => d.name + " (" + d.dlNo + ")"), async mode => {
    if (mode === "cancel") { resEl.innerHTML = "<p class='muted' style='margin-top:12px'>Import cancelled — nothing was changed.</p>"; return; }
    await applyDriverImport(news, dups, mode, errors, resEl);
  });
});
