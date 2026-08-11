/* ============ FleetWorks — bulk-import/domain ============ */
(function () {
  "use strict";
  function excelDateToStr(v) {
    if (v == null || v === "") return "";
    if (v instanceof Date) return isNaN(v) ? "" : v.toISOString().slice(0, 10);
    if (typeof v === "number") { const d = new Date(Math.round((v - 25569) * 86400 * 1000)); return isNaN(d) ? "" : d.toISOString().slice(0, 10); }
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    return isNaN(d) ? "" : d.toISOString().slice(0, 10);
  }
  function buildGetter(row, cols) {
    const normMap = {};
    Object.keys(row || {}).forEach(k => { normMap[k.trim().toLowerCase()] = k; });
    return key => {
      const col = cols.find(c => c[1] === key);
      const actualKey = col ? normMap[col[0].trim().toLowerCase()] : "";
      const raw = actualKey ? row[actualKey] : "";
      return col && col[2] === "date" ? excelDateToStr(raw) : raw;
    };
  }
  function parseVehicleRows(input) {
    const rows = input.rows || [], cols = input.cols || [], vehicles = input.vehicles || [], uidFn = input.uidFn || (() => Math.random().toString(36).slice(2));
    const news = [], dups = [], errors = [], seenInFile = new Set();
    rows.forEach((row, i) => {
      const rowNum = i + 2, get = buildGetter(row, cols);
      const name = String(get("name") || "").trim().toUpperCase(), type = String(get("type") || "").trim();
      if (!name || !type) { if (Object.values(row).some(v => String(v).trim())) errors.push({ row: rowNum, msg: "Registration Number and Vehicle Type are required." }); return; }
      if (seenInFile.has(name)) { errors.push({ row: rowNum, msg: name + " appears more than once in this file — only the first row is used." }); return; }
      seenInFile.add(name);
      const num = key => { const v = get(key); return v !== "" && v != null ? +v : undefined; };
      const txt = key => { const v = String(get(key) || "").trim(); return v || undefined; };
      const fields = {
        type, kmPerMonth: num("kmPerMonth"), status: txt("status"), make: txt("make"), model: txt("model"), year: num("year"),
        chassisNo: get("chassisNo") ? String(get("chassisNo")).trim().toUpperCase() : undefined,
        engineNo: get("engineNo") ? String(get("engineNo")).trim().toUpperCase() : undefined,
        ownership: txt("ownership"), group: txt("group"), depot: txt("depot"), emission: txt("emission"), fuelType: txt("fuelType"),
        tankCapacity: num("tankCapacity"), color: txt("color"), gvw: num("gvw"), payload: num("payload"), axleConfig: txt("axleConfig"),
        tyreFrontPsi: num("tyreFrontPsi"), tyreRearPsi: num("tyreRearPsi"), tyreSize: txt("tyreSize"), rto: txt("rto"),
        purchaseDate: txt("purchaseDate"), purchasePrice: num("purchasePrice"), purchaseVendor: txt("purchaseVendor"),
        inServiceDate: txt("inServiceDate"), serviceLifeMonths: num("serviceLifeMonths"), resaleValue: num("resaleValue"), notes: txt("notes"),
      };
      const patch = {};
      Object.entries(fields).forEach(([k, v]) => { if (v !== undefined) patch[k] = v; });
      const compliancePatch = {};
      ["insurance", "puc", "fitness", "permit", "roadtax"].forEach(doc => { if (get(doc)) compliancePatch[doc] = get(doc); });
      if (Object.keys(compliancePatch).length) patch.compliance = compliancePatch;
      const full = { id: uidFn(), name, ...fields, kmPerMonth: fields.kmPerMonth || 0, status: fields.status || "Active", compliance: { insurance: get("insurance"), puc: get("puc"), fitness: get("fitness"), permit: get("permit"), roadtax: get("roadtax") } };
      const entry = { rowNum, name, full, patch, odo: get("odo") };
      const existing = vehicles.find(x => x.name === name);
      if (existing) dups.push({ ...entry, existing }); else news.push(entry);
    });
    return { news, dups, errors };
  }
  function parseDriverRows(input) {
    const rows = input.rows || [], cols = input.cols || [], vehicles = input.vehicles || [], drivers = input.drivers || [];
    const news = [], dups = [], errors = [], seenInFile = new Set();
    rows.forEach((row, i) => {
      const rowNum = i + 2, get = buildGetter(row, cols);
      const name = String(get("name") || "").trim(), dlNo = String(get("dlNo") || "").trim();
      if (!name || !dlNo) { if (Object.values(row).some(v => String(v).trim())) errors.push({ row: rowNum, msg: "Driver Name and DL Number are required." }); return; }
      if (seenInFile.has(dlNo.toLowerCase())) { errors.push({ row: rowNum, msg: dlNo + " appears more than once in this file — only the first row is used." }); return; }
      seenInFile.add(dlNo.toLowerCase());
      const vehName = String(get("vehicleName") || "").trim().toUpperCase();
      let vehicleId = "";
      if (vehName) {
        const veh = vehicles.find(x => x.name === vehName);
        if (veh) vehicleId = veh.id;
        else errors.push({ row: rowNum, msg: `Vehicle "${vehName}" not found — driver saved without an assignment.` });
      }
      const fields = {
        name, phone: String(get("phone") || "").trim(), dlExpiry: get("dlExpiry"), vehicleId,
        upiId: String(get("upiId") || "").trim() || undefined,
        bankAccount: String(get("bankAccount") || "").replace(/\s+/g, "") || undefined,
        bankIfsc: String(get("bankIfsc") || "").trim().toUpperCase() || undefined,
      };
      const existing = drivers.find(d => d.dlNo.toLowerCase() === dlNo.toLowerCase());
      if (existing) dups.push({ rowNum, name, dlNo, fields, existing }); else news.push({ rowNum, name, dlNo, fields });
    });
    return { news, dups, errors };
  }
  window.FWBulkImportDomain = window.FWBulkImportDomain || { excelDateToStr, buildGetter, parseVehicleRows, parseDriverRows };
})();
