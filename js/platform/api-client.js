/* ============ FleetWorks — platform/api-client.js ============
   Stable client facade for current browser modules and future web/mobile
   SDK extraction. Existing code may keep using fwCloud directly; new modules
   should prefer FWApi so the backing implementation can move from direct
   Supabase calls to a BFF/API service later without changing feature code. */

(function () {
  "use strict";

  function cloud() { return window.fwCloud || null; }
  function configured() { return typeof window.fwConfigured === "function" && window.fwConfigured(); }
  function localDb() {
    try { if (typeof db !== "undefined") return db; } catch { /* lexical global not present */ }
    return window.db || null;
  }
  function signedIn() { const c = cloud(); return !!(c && c.user && c.user()); }

  async function requireCloud() {
    const c = cloud();
    if (!c) throw new Error("FleetWorks cloud client is not loaded.");
    return c;
  }

  const FWApi = {
    runtime: {
      mode() {
        if (signedIn()) return "cloud";
        if (configured()) return "public";
        return "local";
      },
      signedIn,
      configured,
    },

    auth: {
      user() { const c = cloud(); return c && c.user ? c.user() : null; },
      uid() { const c = cloud(); return c && c.uid ? c.uid() : null; },
      profile() { const c = cloud(); return c && c.profile ? c.profile() : {}; },
    },

    db: {
      local: localDb,
      async orgId() {
        if (typeof window.dbOrgId === "function") return window.dbOrgId();
        if (typeof window.getMyOrgId === "function") return window.getMyOrgId();
        return null;
      },
    },

    rest: {
      async get(table, query) {
        return (await requireCloud()).authGet(table, query);
      },
      async insert(table, row) {
        return (await requireCloud()).authInsert(table, row);
      },
      async insertReturning(table, row) {
        return (await requireCloud()).authInsertRet(table, row);
      },
      async patch(path, body) {
        return (await requireCloud()).authPatch(path, body);
      },
      async delete(table, query) {
        return (await requireCloud()).authDelete(table, query);
      },
      async rpc(fn, args) {
        return (await requireCloud()).authRpc(fn, args);
      },
      async publicInsert(table, row) {
        if (!window.fwInsert) return false;
        return window.fwInsert(table, row);
      },
      async publicRpc(fn, args) {
        if (!window.fwRpc) return null;
        return window.fwRpc(fn, args);
      },
    },

    functions: {
      async call(name, body) {
        return (await requireCloud()).callFunction(name, body);
      },
    },

    storage: {
      async uploadFile(bucket, path, file) {
        return (await requireCloud()).uploadFile(bucket, path, file);
      },
      async signUrl(bucket, path, expiresIn) {
        return (await requireCloud()).signUrl(bucket, path, expiresIn);
      },
    },

    domains: {
      fleet: {
        vehicles() {
          const d = localDb();
          return d && Array.isArray(d.vehicles) ? d.vehicles : [];
        },
        drivers() {
          const d = localDb();
          return d && Array.isArray(d.drivers) ? d.drivers : [];
        },
        vehicleById(id) {
          return FWApi.domains.fleet.vehicles().find(v => v.id === id || v.dbId === id) || null;
        },
        driverById(id) {
          return FWApi.domains.fleet.drivers().find(d => d.id === id || d.dbId === id) || null;
        },
      },

      payments: {
        buildUpiLink(vpa, name, amount, note) {
          const params = new URLSearchParams({ pa: vpa || "", pn: name || "", am: String(amount || 0), cu: "INR" });
          if (note) params.set("tn", String(note).slice(0, 50));
          return "upi://pay?" + params.toString();
        },
        async pendingRequests(orgId) {
          if (!orgId) return [];
          return FWApi.rest.get("payment_requests", `select=*&org_id=eq.${orgId}&status=eq.pending&order=created_at.asc`);
        },
      },

      maps: {
        assignedDriver(vehicleId) {
          return FWApi.domains.fleet.drivers().find(d => d.vehicleId === vehicleId) || null;
        },
      },
    },
  };

  window.FWApi = window.FWApi || FWApi;
})();
