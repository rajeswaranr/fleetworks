/* ============ FleetWorks — bulkimport.js ============
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
];
const DRV_EXAMPLE = { name: "Suresh Kumar", phone: "9840012345", dlNo: "TN01 20230012345", dlExpiry: "2029-06-30", vehicleName: "TN-01-AB-1234" };

function excelDateToStr(v) {
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
  const normMap = {};
  Object.keys(row).forEach(k => { normMap[k.trim().toLowerCase()] = k; });
  return key => {
    const col = cols.find(c => c[1] === key);
    const actualKey = normMap[col[0].trim().toLowerCase()];
    const raw = actualKey ? row[actualKey] : "";
    return col[2] === "date" ? excelDateToStr(raw) : raw;
  };
}

function resultsHtml(added, updated, errors) {
  let html = `<p style="margin-top:12px"><strong>${added}</strong> added`;
  if (updated) html += `, <strong>${updated}</strong> updated`;
  if (errors.length) html += `, <strong>${errors.length}</strong> skipped`;
  html += ".</p>";
  if (errors.length) html += "<ul style='margin:6px 0 0 18px;color:#b91c1c;font-size:0.85rem'>" + errors.map(e => `<li>Row ${e.row}: ${esc(e.msg)}</li>`).join("") + "</ul>";
  return html;
}

document.getElementById("vehUploadFile")?.addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const resEl = document.getElementById("vehUploadResult");
  resEl.innerHTML = "<p class='muted' style='margin-top:12px'>Reading file…</p>";
  let rows;
  try { rows = await readRows(file); } catch (err) { resEl.innerHTML = `<p style="color:#b91c1c;margin-top:12px">${esc(err.message || "Could not read this file.")}</p>`; e.target.value = ""; return; }

  let added = 0;
  const errors = [];
  rows.forEach((row, i) => {
    const rowNum = i + 2; // header is row 1
    const get = buildGetter(row, VEH_COLS);
    const name = String(get("name") || "").trim().toUpperCase();
    const type = String(get("type") || "").trim();
    if (!name || !type) { if (Object.values(row).some(v => String(v).trim())) errors.push({ row: rowNum, msg: "Registration Number and Vehicle Type are required." }); return; }
    if (db.vehicles.some(x => x.name === name)) { errors.push({ row: rowNum, msg: name + " is already in your fleet." }); return; }

    const num = key => { const v = get(key); return v !== "" && v != null ? +v : undefined; };
    const txt = key => { const v = String(get(key) || "").trim(); return v || undefined; };
    const v = {
      id: "v" + Date.now() + i, name, type,
      kmPerMonth: num("kmPerMonth") || 0,
      status: txt("status") || "Active",
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
      compliance: {
        insurance: get("insurance"), puc: get("puc"),
        fitness: get("fitness"), permit: get("permit"),
        roadtax: get("roadtax"),
      },
    };
    db.vehicles.push(v);
    const odo = get("odo");
    if (odo) db.fuelLogs.push({ id: uid(), vehicleId: v.id, date: new Date().toISOString().slice(0, 10), litres: 0, amount: 0, odo: +odo, opening: true });
    added++;
  });

  if (added) { saveStore(); renderAll(); }
  resEl.innerHTML = resultsHtml(added, 0, errors);
  e.target.value = "";
});

document.getElementById("drvUploadFile")?.addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const resEl = document.getElementById("drvUploadResult");
  resEl.innerHTML = "<p class='muted' style='margin-top:12px'>Reading file…</p>";
  let rows;
  try { rows = await readRows(file); } catch (err) { resEl.innerHTML = `<p style="color:#b91c1c;margin-top:12px">${esc(err.message || "Could not read this file.")}</p>`; e.target.value = ""; return; }

  let added = 0, updated = 0;
  const errors = [];
  rows.forEach((row, i) => {
    const rowNum = i + 2;
    const get = buildGetter(row, DRV_COLS);
    const name = String(get("name") || "").trim();
    const dlNo = String(get("dlNo") || "").trim();
    if (!name || !dlNo) { if (Object.values(row).some(v => String(v).trim())) errors.push({ row: rowNum, msg: "Driver Name and DL Number are required." }); return; }

    const vehName = String(get("vehicleName") || "").trim().toUpperCase();
    let vehicleId = "";
    if (vehName) {
      const veh = db.vehicles.find(x => x.name === vehName);
      if (veh) vehicleId = veh.id;
      else errors.push({ row: rowNum, msg: `Vehicle "${vehName}" not found — driver saved without an assignment.` });
    }

    const phone = String(get("phone") || "").trim();
    const dlExpiry = get("dlExpiry");
    const existing = db.drivers.find(d => d.dlNo.toLowerCase() === dlNo.toLowerCase());
    if (existing) { Object.assign(existing, { name, phone, dlExpiry, vehicleId: vehicleId || existing.vehicleId }); updated++; }
    else { db.drivers.push({ id: uid(), name, phone, dlNo, dlExpiry, vehicleId }); added++; }
  });

  if (added || updated) { saveStore(); renderAll(); }
  resEl.innerHTML = resultsHtml(added, updated, errors);
  e.target.value = "";
});
