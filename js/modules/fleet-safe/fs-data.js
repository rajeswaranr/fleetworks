/* FleetSafe data access.
   Every FleetSafe page reads and writes through FSData:
     - signed in: straight through to Supabase (fwCloud), RLS decides what is visible;
     - demo mode (signed out, "Open the live demo"): an in-memory simulated fleet day
       from FleetSafeSim.demoTables(), answered with the same PostgREST query syntax the
       pages already send. Nothing is written to the database; edits last until reload.
   The two never mix: a signed-in account never sees the in-memory demo data. */
(function () {
  "use strict";

  let store = null, seq = 1000;
  const realUser = () => !!(window.fwCloud && fwCloud.user && fwCloud.user());
  const demoMode = () => { if (realUser()) return false; try { return sessionStorage.getItem("fwDemo") === "1"; } catch { return false; } };
  const clone = o => JSON.parse(JSON.stringify(o));
  const newId = () => "00000000-0000-4000-9000-" + (++seq).toString(16).padStart(12, "0");

  function tables() {
    if (store) return store;
    const d = window.db || {};
    const vehicles = (d.vehicles || []).map(v => ({ id: v.dbId || v.id, name: v.name, type: v.type }));
    const drivers = (d.drivers || []).map(x => {
      const v = (d.vehicles || []).find(y => y.id === x.vehicleId);
      return { id: x.dbId || x.id, name: x.name, vehicle_id: v ? (v.dbId || v.id) : null };
    });
    const t = window.FleetSafeSim ? FleetSafeSim.demoTables({ vehicles, drivers }) : {};
    if (vehicles.length) store = t;       // the demo fleet may not be loaded yet: build again next time
    return t;
  }

  // ── a small PostgREST query engine over the in-memory tables ──
  function parse(q) {
    const out = { filters: [], order: [], limit: null };
    new URLSearchParams(q || "").forEach((val, key) => {
      if (key === "select") return;
      if (key === "order") { out.order = val.split(",").map(s => { const [col, ...mods] = s.split("."); return { col, desc: mods.includes("desc"), nullsFirst: mods.includes("nullsfirst") }; }); return; }
      if (key === "limit") { out.limit = Number(val); return; }
      if (key === "offset") return;
      out.filters.push({ col: key, expr: val });
    });
    return out;
  }
  function test(row, { col, expr }) {
    let neg = false, e = expr;
    if (e.startsWith("not.")) { neg = true; e = e.slice(4); }
    const i = e.indexOf("."), op = e.slice(0, i), raw = e.slice(i + 1), v = row[col];
    const cmp = x => (typeof v === "number" ? Number(x) : x);
    let r;
    switch (op) {
      case "eq": r = String(v) === raw; break;
      case "neq": r = String(v) !== raw; break;
      case "gt": r = v != null && v > cmp(raw); break;
      case "gte": r = v != null && v >= cmp(raw); break;
      case "lt": r = v != null && v < cmp(raw); break;
      case "lte": r = v != null && v <= cmp(raw); break;
      case "in": r = raw.replace(/^\(|\)$/g, "").split(",").map(s => s.replace(/^"|"$/g, "")).includes(String(v)); break;
      case "is": r = raw === "null" ? v == null : raw === "true" ? v === true : raw === "false" ? v === false : false; break;
      case "like": case "ilike": { const re = new RegExp("^" + raw.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", op === "ilike" ? "i" : ""); r = re.test(String(v ?? "")); break; }
      default: r = true;
    }
    return neg ? !r : r;
  }
  function query(table, q) {
    const rows = (tables()[table] || []);
    const p = parse(q);
    let res = rows.filter(r => p.filters.every(f => test(r, f)));
    if (p.order.length) res = [...res].sort((a, b) => {
      for (const o of p.order) {
        const x = a[o.col], y = b[o.col];
        if (x == null && y == null) continue;
        if (x == null) return o.nullsFirst ? -1 : 1;
        if (y == null) return o.nullsFirst ? 1 : -1;
        if (x < y) return o.desc ? 1 : -1;
        if (x > y) return o.desc ? -1 : 1;
      }
      return 0;
    });
    if (p.limit != null) res = res.slice(0, p.limit);
    return clone(res);
  }
  const splitPath = path => { const i = path.indexOf("?"); return [path.slice(0, i < 0 ? undefined : i), i < 0 ? "" : path.slice(i + 1)]; };

  const FSData = {
    /** true when FleetSafe has data to show: a signed-in fleet, or the demo */
    enabled: () => realUser() || demoMode(),
    demo: demoMode,
    real: realUser,
    orgId: async () => demoMode() ? "demo-org" : (window.dbOrgId ? dbOrgId() : null),
    uid: () => demoMode() ? "demo-user" : (fwCloud.uid ? fwCloud.uid() : null),

    async get(table, q) { return demoMode() ? query(table, q) : fwCloud.authGet(table, q); },
    async insertRet(table, row) {
      if (!demoMode()) return fwCloud.authInsertRet(table, row);
      const r = { id: newId(), created_at: new Date().toISOString(), ...row };
      (tables()[table] = tables()[table] || []).unshift(r);
      if (table === "device_events") {      // keep the joined view the pages read in step
        const dev = (tables().devices || []).find(d => d.id === r.device_id);
        tables().v_safety_events.unshift({ ...r, vehicle_id: dev ? dev.vehicle_id : null, driver_id: null, attribution: "assignment", weight: 2, is_coachable: true });
      }
      return clone(r);
    },
    async patch(path, body) {
      if (!demoMode()) return fwCloud.authPatchChecked(path, body);
      const [table, q] = splitPath(path), p = parse(q);
      const hit = (tables()[table] || []).filter(r => p.filters.every(f => test(r, f)));
      hit.forEach(r => Object.assign(r, body));
      if (table === "device_events") (tables().v_safety_events || []).filter(r => hit.some(h => h.id === r.id)).forEach(r => Object.assign(r, body));
      return hit.length > 0;
    },
    async remove(table, q) {
      if (!demoMode()) return fwCloud.authDelete(table, q);
      const p = parse(q), t = tables()[table] || [];
      tables()[table] = t.filter(r => !p.filters.every(f => test(r, f)));
      return true;
    },
    async rpc(fn, args) {
      if (!demoMode()) return fwCloud.authRpc(fn, args);
      if (fn === "create_integration_key") {
        const key = "fwk_demo" + Math.random().toString(16).slice(2).padEnd(40, "0");
        tables().integration_keys.unshift({ id: newId(), org_id: "demo-org", name: args.p_name || "Integration", key_prefix: key.slice(0, 12), created_at: new Date().toISOString(), last_used_at: null, revoked_at: null });
        return { key, prefix: key.slice(0, 12), demo: true };
      }
      return null;
    },
    async fn(name, body) {
      if (!demoMode()) return fwCloud.callFunction(name, body);
      if (name === "incident-analysis") { const a = demoAnalysis(body); tables().incident_analyses.unshift(a); return { ok: true, analysis: clone(a) }; }
      throw new Error("Not available in the demo. Sign in to use it.");
    },
    async signUrl(bucket, path, exp) { return demoMode() ? null : (fwCloud.signUrl ? fwCloud.signUrl(bucket, path, exp) : null); },
    /** drop the demo day, e.g. after the demo fleet reloads */
    reset() { store = null; },
  };

  // A written-up analysis for the demo, built only from the incident's own facts.
  function demoAnalysis({ source, eventId }) {
    const t = tables();
    const ev = source === "ai" ? (t.ai_events || []).find(e => e.id === eventId) : (t.v_safety_events || []).find(e => e.id === eventId);
    const type = ev ? ev.event_type : "incident";
    const W = {
      fatigue: ["The cabin camera saw the eyes closed for over 3 seconds with the head dropping, at night on a long run.", "Drowsy driving at highway speed is one of the most common causes of truck crashes.", "Call the driver now and tell them to stop at the next safe place and rest for at least 20 minutes. Check hours driven since the last rest.", "Check driving hours against the Motor Transport Workers Act rest limits."],
      phone_use: ["The cabin camera saw a phone held at the ear while the truck was moving.", "Distraction accident and a traffic fine.", "Coach the driver; a hands-free mount removes most of the reason to pick up the phone.", "Handheld phone use while driving is an offence under the Motor Vehicles Act."],
      forward_collision: ["The front camera measured the gap to the vehicle ahead closing faster than the truck could stop.", "Rear-end collision, cargo damage and injury.", "Review the clip with the driver; coach a 3-second gap, more when loaded or downhill.", "Keep the clip: it is evidence if a claim is made later."],
      tyre_pressure_loss: ["Pressure on one tyre fell 11 psi in 20 minutes while driving: a puncture or a failing valve.", "A blow-out at speed, and a ruined casing worth ₹25,000+.", "Ask the driver to stop at the next safe place and check the tyre; send the nearest tyre partner.", ""],
      engine_overheat: ["Coolant reached 112 °C on a climb with the engine working hard.", "Head gasket or engine damage if driven on.", "Stop, idle to cool, check coolant and fan belt before continuing.", "Do not dispatch again until the cause is found."],
      cargo_temp_breach: ["The reefer probe read up to 12.8 °C for about 40 minutes around lunchtime: the unit likely stopped or a door stayed open.", "Vaccines outside 2–8 °C may have to be discarded; the whole consignment's value is at risk.", "Call the driver to check the reefer unit and doors now; inform the customer with the temperature log.", "Keep the temperature log: the customer and a drug inspector will ask for it."],
    }[type] || ["The device reported this incident; the readings around it are consistent with the alert.", "See the evidence for the risk.", "Review the evidence and call the driver.", ""];
    return { id: newId(), source, event_id: eventId, root_cause: W[0], risk: W[1], action: W[2], compliance: W[3], confidence: "medium", est_loss_inr: null, model: "claude-opus-5", created_at: new Date().toISOString(), facts: { readings_around_event: new Array(9) } };
  }

  window.FSData = FSData;

  // The page controller loads before this file, so a deep link straight to a FleetSafe
  // page rendered without data. Open it again once every script has loaded.
  const FS_TABS = ["safehome", "triage", "vision", "fleetview", "safety", "opscentre", "geofences", "assets", "devicehub", "fuelsensor", "fleetgraph"];
  document.addEventListener("DOMContentLoaded", () => {
    const h = (location.hash || "").slice(1);
    if (FS_TABS.includes(h) && window.activateTab && FSData.enabled()) activateTab(h, { replaceHistory: true });
  });
})();
