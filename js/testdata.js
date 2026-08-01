/* ============ FleetWorks — testdata.js ============
   Signed-in seed data for validating FleetFin and FleetIQ. Unlike the
   offline demo loader, this writes through the DB-direct business functions
   so the rows persist in Supabase and come back on reload. */

"use strict";

(function () {
  const SEED_PREFIX = "seed-finiq";
  const SEED_VEHICLES = [
    ["01", "TN-88-AA-1001", "Truck (HCV)", 9200, "Tata", "Prima 5530", "Coimbatore"],
    ["02", "TN-88-AA-1002", "Truck (HCV)", 8100, "Ashok Leyland", "AVTR 2820", "Salem"],
    ["03", "TN-88-AA-1003", "Tipper", 5600, "BharatBenz", "2823C", "Erode"],
    ["04", "TN-88-AA-1004", "LCV", 6400, "Eicher", "Pro 2059", "Tiruppur"],
    ["05", "TN-88-AA-1005", "Bus", 10800, "Tata", "Starbus", "Chennai"],
    ["06", "TN-88-AA-1006", "Trailer", 9700, "Mahindra", "Blazo X", "Bengaluru"],
    ["07", "TN-88-AA-1007", "Tanker", 8400, "Ashok Leyland", "Boss Tanker", "Kochi"],
    ["08", "TN-88-AA-1008", "Truck (HCV)", 7600, "Tata", "LPT 4825", "Madurai"],
    ["09", "TN-88-AA-1009", "LCV", 5200, "Mahindra", "Furio 7", "Trichy"],
    ["10", "TN-88-AA-1010", "Tipper", 6100, "Eicher", "Pro 6028T", "Mysuru"],
  ];
  const DRIVER_NAMES = ["Suresh Kumar", "Manoj Yadav", "Ravi Shankar", "Peter D'Souza", "Abdul Rahman", "Karthik R", "Muthu Pandian", "Imran Khan", "Naveen Raj", "Selva Mani"];
  const PARTS = [
    ["Engine Oil 15W-40 Drum", "FW-SEED-OIL-210", "Engine", 18500, 4, 2],
    ["Brake Liner Set HCV", "FW-SEED-BRAKE-450", "Brakes", 4200, 8, 4],
    ["Air Filter BS6", "FW-SEED-AIR-220", "Filters", 980, 3, 6],
    ["Alternator 12V 90A", "FW-SEED-ALT-90", "Electrical", 6800, 1, 2],
    ["Tyre 10.00R20 Highway", "FW-SEED-TYRE-20", "Tyres", 28500, 6, 4],
  ];
  const CATS = ["Engine Oil & Filters", "Brakes", "Tyres", "Battery", "Electrical", "Suspension", "Clutch", "Fitness & PUC", "Permit & Road Tax", "Other"];

  const iso = d => d.toISOString().slice(0, 10);
  const daysFromNow = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
  const monthDate = (monthsAgo, day) => {
    const d = new Date();
    d.setMonth(d.getMonth() - monthsAgo, day);
    return iso(d);
  };
  const seeded = (arr, pred) => (arr || []).some(pred);

  function vehicleSeed(row, i) {
    const [n, name, type, kmPerMonth, make, model, depot] = row;
    return {
      id: `${SEED_PREFIX}-v${n}`, name, type, kmPerMonth, make, model, depot,
      year: 2022 + (i % 4), status: "Active", fuelType: "Diesel", emission: "BS6",
      rto: name.slice(0, 5), purchaseDate: monthDate(28 - i, 10), purchasePrice: 1800000 + i * 140000,
      inServiceDate: monthDate(24 - i, 15), serviceLifeMonths: 96, resaleValue: 650000 + i * 45000,
      notes: "FleetFin/FleetIQ persisted validation seed",
      compliance: {
        insurance: daysFromNow(45 + i * 9),
        puc: daysFromNow(i === 2 ? -8 : 30 + i * 7),
        fitness: daysFromNow(i === 5 ? 18 : 90 + i * 11),
        permit: daysFromNow(i === 3 ? -4 : 75 + i * 8),
        roadtax: daysFromNow(120 + i * 10),
      },
    };
  }

  function driverSeed(vehicle, i) {
    const n = String(i + 1).padStart(2, "0");
    return {
      id: `${SEED_PREFIX}-d${n}`,
      name: DRIVER_NAMES[i],
      phone: "98" + String(40000000 + i * 13579).slice(0, 8),
      dlNo: `TN88 2026${String(10000 + i)}`,
      dlExpiry: daysFromNow(i === 4 ? -3 : 80 + i * 22),
      vehicleId: vehicle.id,
      upiId: `driver${n}@okhdfcbank`,
      bankAccount: `50100200${String(1000 + i)}`,
      bankIfsc: "HDFC0001234",
    };
  }

  async function saveOnce(label, exists, createFn, pushTo, payload) {
    if (exists()) return null;
    const saved = await createFn(payload);
    if (!saved) throw new Error(`Could not save ${label}. ${window.fwCloud && fwCloud.lastError ? fwCloud.lastError() || "" : ""}`.trim());
    pushTo.push(saved);
    return saved;
  }

  async function seedCoreData(status) {
    const vehicles = [];
    for (let i = 0; i < SEED_VEHICLES.length; i++) {
      const v = vehicleSeed(SEED_VEHICLES[i], i);
      const existing = db.vehicles.find(x => x.id === v.id || x.name === v.name);
      if (existing) vehicles.push(existing);
      else vehicles.push(await saveOnce(v.name, () => false, dbCreateVehicle, db.vehicles, v));
      status(`Vehicles ${vehicles.length}/${SEED_VEHICLES.length}`);
    }

    const drivers = [];
    for (let i = 0; i < vehicles.length; i++) {
      const d = driverSeed(vehicles[i], i);
      const existing = db.drivers.find(x => x.id === d.id || x.dlNo === d.dlNo);
      if (existing) drivers.push(existing);
      else drivers.push(await saveOnce(d.name, () => false, dbCreateDriver, db.drivers, d));
    }

    for (const [name, partNumber, category, unitCost, qty, minQty] of PARTS) {
      if (seeded(db.parts, p => p.partNumber === partNumber)) continue;
      await saveOnce(name, () => false, dbCreatePart, db.parts, {
        name, partNumber, category, make: category === "Tyres" ? "MRF" : "Bosch",
        sourcing: "Aftermarket", vendor: "FleetFin Seed Spares", vendorContact: "9840011223",
        unitCost, qty, minQty, location: "Seed Rack", purchaseDate: daysFromNow(-35),
        warrantyExpiry: category === "Electrical" ? daysFromNow(20) : null,
      });
    }

    for (let vi = 0; vi < vehicles.length; vi++) {
      const v = vehicles[vi];
      let odo = 70000 + vi * 8500;
      for (let m = 11; m >= 0; m--) {
        const date = monthDate(m, 4 + (vi % 18));
        const litres = Math.round((v.kmPerMonth / 4.4) * (0.8 + (vi % 3) * 0.08));
        const lowMileage = vi === 2 && m === 0;
        const amount = Math.round(litres * (lowMileage ? 108 : 94 + (vi % 5)));
        odo += Math.round(v.kmPerMonth / 2.8);
        if (!seeded(db.fuelLogs, f => f.vehicleId === v.id && f.date === date && f.odo === odo)) {
          await saveOnce(`fuel ${v.name} ${date}`, () => false, dbCreateFuelLog, db.fuelLogs, {
            vehicleId: v.id, date, litres: lowMileage ? Math.round(litres * 1.45) : litres, amount, odo,
          });
        }
      }

      for (let m = 10; m >= 0; m -= 2) {
        const cat = CATS[(vi + m) % CATS.length];
        const date = monthDate(m, 10 + (vi % 10));
        const billNo = `FW-SEED-${String(vi + 1).padStart(2, "0")}-${String(m).padStart(2, "0")}`;
        const highTyreBill = vi === 6 && m === 0;
        if (!seeded(db.expenses, e => e.billNo === billNo)) {
          await saveOnce(`expense ${billNo}`, () => false, dbCreateExpense, db.expenses, {
            vehicleId: v.id, date, category: cat,
            amount: highTyreBill ? 145000 : 3500 + vi * 900 + (11 - m) * 1200,
            title: `Seed ${cat} bill for ${v.name}`,
            vendor: vi % 2 ? "Annai Auto Works" : "Highway Motors",
            gstin: vi % 3 === 0 ? "33ABCDE1234F1Z5" : undefined,
            billNo,
            items: [{ desc: cat, partNo: `ITEM-${vi + 1}-${m}`, amount: highTyreBill ? 145000 : 3500 + vi * 900 + (11 - m) * 1200 }],
          });
        }
      }

      for (let m = 5; m >= 0; m--) {
        const date = monthDate(m, 15 + (vi % 8));
        if (!seeded(db.trips, t => t.vehicleId === v.id && t.date === date && t.from === "Coimbatore Seed")) {
          await saveOnce(`trip ${v.name} ${date}`, () => false, dbCreateTrip, db.trips, {
            vehicleId: v.id, date, from: "Coimbatore Seed", to: vi % 2 ? "Chennai Seed" : "Bengaluru Seed",
            freight: 42000 + vi * 3500 + m * 1800, km: 420 + vi * 18,
          });
        }
      }

      const inspDate = daysFromNow(-1 - vi);
      if (!seeded(db.inspections, ins => ins.vehicleId === v.id && ins.date === inspDate && /seed/i.test(ins.notes || ""))) {
        const failIdx = vi % 5;
        await saveOnce(`inspection ${v.name}`, () => false, dbCreateInspection, db.inspections, {
          vehicleId: v.id, date: inspDate, odo,
          passed: vi % 3 !== 0,
          results: INSPECTION_ITEMS.map((item, idx) => ({ item, ok: vi % 3 !== 0 || idx !== failIdx })),
          notes: "FleetFin/FleetIQ seed inspection",
        });
      }

      const issueTitle = vi % 2 ? "Seed brake noise recurring" : "Seed coolant temperature alert";
      let issue = db.issues.find(i => i.vehicleId === v.id && i.title === issueTitle);
      if (!issue) {
        issue = await saveOnce(`issue ${v.name}`, () => false, dbCreateIssue, db.issues, {
          vehicleId: v.id, title: issueTitle, severity: vi % 3 === 0 ? "High" : "Medium",
          status: vi % 4 === 0 ? "In Progress" : "Open", createdAt: daysFromNow(-8 - vi), source: "Seed validation",
        });
      }
      if (!seeded(db.workOrders, w => w.vehicleId === v.id && w.title === issueTitle)) {
        const wo = await saveOnce(`work order ${v.name}`, () => false, dbCreateWorkOrder, db.workOrders, {
          vehicleId: v.id, issueId: issue.id, title: issueTitle, vendor: "FleetWorks Seed Workshop",
          estCost: 9000 + vi * 750, status: vi % 4 === 0 ? "Completed" : "Open",
          createdAt: daysFromNow(-7 - vi), completedAt: vi % 4 === 0 ? daysFromNow(-2 - vi) : undefined,
          finalCost: vi % 4 === 0 ? 10200 + vi * 800 : undefined,
        });
        if (wo.status === "Completed") {
          await dbUpdateIssue(issue.id, { status: "Resolved", resolvedAt: wo.completedAt });
          Object.assign(issue, { status: "Resolved", resolvedAt: wo.completedAt });
        }
      }

      const task = vi % 2 ? "Brake Inspection" : "Engine Oil & Filters";
      if (!seeded(db.reminders, r => r.vehicleId === v.id && r.task === task)) {
        await saveOnce(`reminder ${v.name}`, () => false, dbCreateReminder, db.reminders, {
          vehicleId: v.id, task, everyMonths: vi % 2 ? 2 : 3, lastDate: daysFromNow(-40 - vi * 3),
        });
      }

      if (!seeded(db.documents, d => d.entityType === "vehicle" && d.entityId === v.id && d.number === `POL-SEED-${vi + 1}`)) {
        await saveOnce(`document ${v.name}`, () => false, dbCreateDocument, db.documents, {
          entityType: "vehicle", entityId: v.id, docType: "Insurance Policy",
          number: `POL-SEED-${vi + 1}`, issueDate: daysFromNow(-240), expiryDate: v.compliance.insurance,
          note: "Seed policy document",
        });
      }

      const positions = typeof tyrePositions === "function" ? tyrePositions(v.id).slice(0, 4) : ["Front Left"];
      for (let pi = 0; pi < positions.length; pi++) {
        const tyreDate = daysFromNow(-3);
        if (seeded(db.tyreReadings, t => t.vehicleId === v.id && t.position === positions[pi] && t.date === tyreDate)) continue;
        await saveOnce(`tyre ${v.name}`, () => false, dbCreateTyreReading, db.tyreReadings, {
          vehicleId: v.id, position: positions[pi], treadDepth: vi === 1 && pi === 0 ? 1.2 : 4.5 + pi,
          pressure: 92 + pi * 3, odo, date: tyreDate,
        });
      }
    }

    for (let i = 0; i < drivers.length; i++) {
      const d = drivers[i];
      const note = "FleetFin seed trip advance";
      if (!seeded(db.driverLedger, l => l.driverId === d.id && l.note === note)) {
        await saveOnce(`khata ${d.name}`, () => false, dbCreateLedgerEntry, db.driverLedger, {
          driverId: d.id, date: daysFromNow(-18 - i), type: "advance", amount: 12000 + i * 1500, note,
        });
        await saveOnce(`khata expense ${d.name}`, () => false, dbCreateLedgerEntry, db.driverLedger, {
          driverId: d.id, date: daysFromNow(-12 - i), type: "expense", amount: 3500 + i * 400, note: "FleetFin seed route expense",
        });
      }
    }

    return { vehicles: vehicles.length, drivers: drivers.length };
  }

  async function seedPayrollBestEffort(drivers, status) {
    if (!(window.fwCloud && fwCloud.user && fwCloud.user() && typeof getMyOrgId === "function")) return;
    const org = await getMyOrgId().catch(() => null);
    if (!org) return;
    const month = new Date().toISOString().slice(0, 7);
    const existingSalary = await fwCloud.authGet("salary_payments", `select=driver_ext_id,period,transfer_ref&org_id=eq.${org}&period=eq.${month}`).catch(() => null);
    const existingRequests = await fwCloud.authGet("payment_requests", `select=driver_ext_id,period,note&org_id=eq.${org}&period=eq.${month}`).catch(() => null);
    for (const d of drivers.slice(0, 4)) {
      status(`Payroll rows for ${d.name}`);
      const salaryRef = SEED_PREFIX + "-salary-" + d.id.slice(-2);
      if (!Array.isArray(existingSalary) || !existingSalary.some(r => r.driver_ext_id === d.id && r.transfer_ref === salaryRef)) {
        await fwCloud.authInsert("salary_payments", {
          org_id: org, driver_ext_id: d.id, period: month, amount: 24000,
          method: "upi", source: "manual", status: "success", utr: "FWSEED" + d.id.slice(-2),
          notes: "FleetFin seed salary payment", transfer_ref: salaryRef,
          initiated_by: fwCloud.uid(),
        }).catch(() => {});
      }
      if (!Array.isArray(existingRequests) || !existingRequests.some(r => r.driver_ext_id === d.id && r.note === "FleetFin seed trip bonus approval")) {
        await fwCloud.authInsert("payment_requests", {
          org_id: org, driver_ext_id: d.id, amount: 3000, period: month,
          note: "FleetFin seed trip bonus approval", requested_by: fwCloud.uid(),
        }).catch(() => {});
      }
    }
  }

  window.seedFleetFinIqTestData = async function () {
    if (!(typeof coreDbBacked === "function" && coreDbBacked())) {
      throw new Error("Sign in first. Test data must be saved through the DB-backed business layer.");
    }
    const statusEl = document.getElementById("seedFinIqStatus");
    const status = msg => { if (statusEl) statusEl.textContent = msg; };
    status("Saving test data to DB...");
    const result = await seedCoreData(status);
    const seedDrivers = db.drivers.filter(d => String(d.id).startsWith(SEED_PREFIX + "-d"));
    await seedPayrollBestEffort(seedDrivers, status);
    saveStore();
    if (typeof renderAll === "function") renderAll();
    status(`Saved test data: ${result.vehicles} vehicles, ${seedDrivers.length} drivers, ${db.expenses.length} expenses, ${db.fuelLogs.length} fuel logs.`);
    if (typeof toast === "function") toast("FleetFin / FleetIQ test data saved.");
    return result;
  };

  function syncSeedButton() {
    const card = document.getElementById("testDataCard");
    const btn = document.getElementById("seedFinIqBtn");
    if (!card || !btn) return;
    card.hidden = !(window.fwCloud && fwCloud.user && fwCloud.user());
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try { await window.seedFleetFinIqTestData(); }
      catch (ex) {
        const st = document.getElementById("seedFinIqStatus");
        if (st) st.textContent = ex.message || "Could not seed test data.";
        if (typeof toast === "function") toast(ex.message || "Could not seed test data.", "err");
      }
      btn.disabled = false;
    });
  }

  const previousRenderAuthState = window.renderAuthState;
  if (typeof previousRenderAuthState === "function") {
    window.renderAuthState = function () {
      previousRenderAuthState();
      syncSeedButton();
    };
  }
  syncSeedButton();
})();
