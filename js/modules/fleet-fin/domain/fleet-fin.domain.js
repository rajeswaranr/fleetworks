/* ============ FleetWorks — fleet-fin/domain ============
   Pure finance helpers for expenses, fuel logs, trips and driver ledger.
   No DOM, fetch, Supabase, or localStorage here. */

(function () {
  "use strict";

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function normalizeExpense(input) {
    const e = input || {};
    return {
      ...(e.id ? { id: e.id } : {}),
      vehicleId: e.vehicleId || "",
      date: e.date || today(),
      category: String(e.category || "Other").trim() || "Other",
      amount: Number(e.amount || 0),
      odo: e.odo == null || e.odo === "" ? undefined : Number(e.odo),
      title: String(e.title || "").trim() || undefined,
      vendor: String(e.vendor || "").trim() || undefined,
      gstin: String(e.gstin || "").trim().toUpperCase() || undefined,
      billNo: String(e.billNo || "").trim() || undefined,
      billPath: e.billPath || undefined,
      items: Array.isArray(e.items) && e.items.length ? e.items : undefined,
    };
  }

  function normalizeFuelLog(input) {
    const f = input || {};
    return {
      ...(f.id ? { id: f.id } : {}),
      vehicleId: f.vehicleId || "",
      date: f.date || today(),
      litres: Number(f.litres || 0),
      amount: Number(f.amount || 0),
      odo: Number(f.odo || 0),
      opening: !!f.opening,
    };
  }

  function normalizeTrip(input) {
    const t = input || {};
    return {
      ...(t.id ? { id: t.id } : {}),
      vehicleId: t.vehicleId || "",
      date: t.date || today(),
      from: String(t.from || "").trim(),
      to: String(t.to || "").trim(),
      freight: Number(t.freight || 0),
      km: t.km == null || t.km === "" ? null : Number(t.km),
    };
  }

  function normalizeLedgerEntry(input) {
    const l = input || {};
    return {
      ...(l.id ? { id: l.id } : {}),
      driverId: l.driverId || "",
      date: l.date || today(),
      type: l.type || "expense",
      amount: Number(l.amount || 0),
      note: String(l.note || "").trim() || undefined,
    };
  }

  function totals(state) {
    const expenses = state.expenses || [];
    const fuelLogs = state.fuelLogs || [];
    const trips = state.trips || [];
    const ledger = state.driverLedger || [];
    return {
      expenseSpend: expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0),
      fuelSpend: fuelLogs.reduce((sum, f) => sum + Number(f.amount || 0), 0),
      fuelLitres: fuelLogs.reduce((sum, f) => sum + Number(f.litres || 0), 0),
      freight: trips.reduce((sum, t) => sum + Number(t.freight || 0), 0),
      driverAdvances: ledger.filter(l => l.type === "advance").reduce((sum, l) => sum + Number(l.amount || 0), 0),
      driverSettlements: ledger.filter(l => l.type === "settlement").reduce((sum, l) => sum + Number(l.amount || 0), 0),
    };
  }

  function expensePatch(input) {
    return normalizeExpense(input);
  }

  window.FWFleetFinDomain = window.FWFleetFinDomain || {
    today,
    normalizeExpense,
    normalizeFuelLog,
    normalizeTrip,
    normalizeLedgerEntry,
    totals,
    expensePatch,
  };
})();
