/* ============ FleetWorks — communications/WhatsApp controller ============
   Consent management and sending, for the schema and the two edge functions
   that carry driver allotments, wages, khata statements and attendance.

   CONSENT IS THE FIRST-CLASS OBJECT HERE, not a checkbox bolted on. A driver
   must opt in before FleetWorks may message them and can opt out at any time;
   both are recorded with a timestamp because under the DPDP Act 2023 consent
   has to be demonstrable, and under WhatsApp's Business Policy an un-opted-in
   send risks the business number itself. The send function re-checks all of
   this server-side — this UI is the honest path, not the enforcement.

   WHY IT LOOKS EMPTY UNTIL META CLEARS. The send function returns 503 until the
   business number is verified. Rather than hide the feature, the page says so
   and still lets owners record opt-in, so the consent list is ready on day one
   instead of being collected in a panic afterwards. */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const _esc = (v) => (typeof esc === "function" ? esc(v) : String(v == null ? "" : v));
  const money = (n) => (typeof fmtINR === "function" ? fmtINR(n) : "₹" + Math.round(n).toLocaleString("en-IN"));

  let waContacts = [];
  let waLoaded = false;

  /* Phones are stored E.164 because that is what Meta expects and what makes a
     number comparable across fleets. Indian mobiles are entered ten-digit. */
  function toE164(phone) {
    const d = String(phone || "").replace(/\D/g, "");
    if (!d) return null;
    if (d.length === 10) return "+91" + d;
    if (d.length === 12 && d.startsWith("91")) return "+" + d;
    if (d.length === 11 && d.startsWith("0")) return "+91" + d.slice(1);
    return "+" + d;
  }

  function windowOpen(c) {
    return c.window_expires_at && new Date(c.window_expires_at) > new Date();
  }

  async function loadContacts() {
    const org = await dbOrgId();
    if (!org) return [];
    const rows = await fwCloud.authGet(
      "whatsapp_contacts", `select=*&org_id=eq.${org}&order=name.asc`,
    ).catch(() => null);
    return rows || [];
  }

  /* Drivers who have a phone number but no WhatsApp contact row yet. Offering
     them for one-click add is the difference between a consent list that gets
     built and one that stays empty. */
  function driversWithoutContact() {
    const have = new Set(waContacts.map((c) => c.phone));
    return (db.drivers || [])
      .filter((d) => d.phone && !have.has(toE164(d.phone)))
      .map((d) => ({ ...d, e164: toE164(d.phone) }));
  }

  function renderStatus() {
    const optedIn = waContacts.filter((c) => c.opted_in_at && !c.opted_out_at).length;
    $("waStatus").innerHTML = `
      <div class="stat-row">
        <div class="stat-card"><span class="stat-value">${waContacts.length}</span><span class="stat-label">contacts</span></div>
        <div class="stat-card"><span class="stat-value">${optedIn}</span><span class="stat-label">opted in</span></div>
        <div class="stat-card"><span class="stat-value">${waContacts.filter(windowOpen).length}</span><span class="stat-label">free window open</span></div>
      </div>`;
  }

  const TEMPLATE_ACTIONS = [
    { name: "welcome_message", label: "Send welcome" },
    { name: "attendance_check", label: "Ask attendance" },
    { name: "driver_allotment", label: "Send allotment" },
    { name: "wages_paid", label: "Wages paid" },
    { name: "khata_statement", label: "Send statement" },
  ];

  function renderContacts() {
    const pending = driversWithoutContact();
    const rows = waContacts.map((c) => {
      const active = c.opted_in_at && !c.opted_out_at;
      const chip = active
        ? `<span class="fw-chip is-success"><span class="dot"></span>Opted in</span>`
        : c.opted_out_at
          ? `<span class="fw-chip is-danger"><span class="dot"></span>Opted out</span>`
          : `<span class="fw-chip is-pending"><span class="dot"></span>No consent</span>`;
      return `
        <tr>
          <td><strong>${_esc(c.name || "—")}</strong><br /><span class="muted">${_esc(c.phone)}</span></td>
          <td>${chip}${windowOpen(c) ? ` <span class="muted" style="font-size:.8rem">free window open</span>` : ""}</td>
          <td style="text-align:right">
            ${active
              ? TEMPLATE_ACTIONS.map((t) => `<button class="link-btn" data-wa-send="${c.id}" data-wa-tpl="${t.name}">${t.label}</button>`).join(" ")
              : `<button class="link-btn" data-wa-optin="${c.id}">Record opt-in</button>`}
            ${active ? `<button class="link-btn" data-wa-optout="${c.id}">Opt out</button>` : ""}
          </td>
        </tr>`;
    }).join("");

    $("waContacts").innerHTML = `
      ${waContacts.length ? `<div class="chart-table" style="overflow-x:auto"><table style="width:100%;min-width:560px">
        <thead><tr><th>Driver</th><th>Consent</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : `<p class="muted">No WhatsApp contacts yet.</p>`}
      ${pending.length ? `<div style="margin-top:16px">
        <p class="muted">Drivers with a phone number but no WhatsApp contact yet:</p>
        ${pending.map((d) => `<button class="link-btn" data-wa-add="${_esc(d.id)}">+ ${_esc(d.name)} (${_esc(d.phone)})</button>`).join(" ")}
      </div>` : ""}`;
  }

  async function renderMessages() {
    const org = await dbOrgId();
    if (!org) return;
    const rows = await fwCloud.authGet(
      "whatsapp_messages", `select=*&org_id=eq.${org}&order=created_at.desc&limit=30`,
    ).catch(() => null);
    if (!rows || !rows.length) { $("waMessages").innerHTML = "<p class='muted'>No messages yet.</p>"; return; }
    const chip = { sent: "is-info", delivered: "is-info", read: "is-success", failed: "is-danger", received: "is-success", queued: "is-pending" };
    $("waMessages").innerHTML = rows.map((m) => `
      <div class="pred-row">
        <div class="pred-main">
          <span class="fw-chip ${chip[m.status] || "is-info"}"><span class="dot"></span>${_esc(m.status)}</span>
          <strong>${m.direction === "in" ? "Received" : _esc(m.template_name || "Reply")}</strong>
        </div>
        <div class="pred-detail"><span>${_esc((m.body || "").slice(0, 160))}</span>
          <span class="muted">${m.cost_category === "free" ? "free" : _esc(m.cost_category || "")}</span></div>
      </div>`).join("");
  }

  async function addContact(driverId) {
    const d = (db.drivers || []).find((x) => String(x.id) === String(driverId));
    if (!d) return;
    const org = await dbOrgId();
    const ok = await fwCloud.authInsert("whatsapp_contacts", {
      org_id: org, phone: toE164(d.phone), name: d.name,
      role: "driver", driver_id: d.dbId || null,
    });
    if (typeof toast === "function") toast(ok ? "Contact added." : "Could not add that contact.", ok ? "ok" : "err");
    if (ok) await refresh();
  }

  /* Opt-in recorded by the owner, who is confirming the driver agreed. Logged
     as 'verbal_logged' rather than a self-service tick, because that is what
     actually happened and a consent record that overstates itself is worse than
     none. */
  async function setConsent(id, optIn) {
    const patch = optIn
      ? { opted_in_at: new Date().toISOString(), opted_in_via: "verbal_logged", opted_out_at: null }
      : { opted_out_at: new Date().toISOString() };
    const ok = await fwCloud.authPatch(`whatsapp_contacts?id=eq.${id}`, patch);
    if (typeof toast === "function") toast(ok ? (optIn ? "Opt-in recorded." : "Opted out.") : "Could not save that.", ok ? "ok" : "err");
    if (ok) await refresh();
  }

  const fleetName = () => (db.settings && db.settings.transportName) || "FleetWorks";
  const today = () => new Date().toISOString().slice(0, 10);

  /* Variables are built here, from real records, and never typed by the model
     or guessed. An unknown value is left for the owner to fill rather than
     invented — a wage figure in a WhatsApp message is a promise. */
  function variablesFor(tpl, contact) {
    const name = contact.name || "Driver";
    if (tpl === "welcome_message") return { driver_name: name, fleet_name: fleetName() };
    if (tpl === "attendance_check") return { driver_name: name, date: today(), fleet_name: fleetName() };
    if (tpl === "driver_allotment") {
      const veh = prompt("Vehicle for this allotment (registration):", "");
      if (veh === null) return null;
      const route = prompt("Route (optional):", "") ?? "";
      return { driver_name: name, vehicle: veh, from_date: today(), route, fleet_name: fleetName() };
    }
    if (tpl === "wages_paid") {
      const amt = prompt("Amount paid (₹):", "");
      if (amt === null || !+amt) return null;
      const period = prompt("For which period?", today()) ?? today();
      const method = prompt("Payment mode (UPI / Cash / Bank):", "UPI") ?? "UPI";
      const reference = prompt("Reference (optional):", "") ?? "";
      return { driver_name: name, amount: money(+amt), period, method, reference, fleet_name: fleetName() };
    }
    if (tpl === "khata_statement") {
      // Computed from the ledger, not asked for — the whole point of sending a
      // statement is that it agrees with the books.
      //
      // The ledger keys on the driver's LOCAL ext_id while the contact stores
      // the Postgres uuid, so the two have to be bridged. Comparing them
      // directly matches nothing and would send the driver a balance of zero —
      // a wrong number in a wage message is worse than no message, so an
      // unlinked contact refuses instead.
      const drv = (db.drivers || []).find((d) => d.dbId && d.dbId === contact.driver_id);
      if (!drv) {
        alert("This contact isn't linked to a driver record yet, so the statement can't be calculated. Link the driver first.");
        return null;
      }
      const led = (db.driverLedger || []).filter((l) => l.driverId === drv.id);
      const sum = (t) => led.filter((l) => l.type === t).reduce((s, l) => s + (+l.amount || 0), 0);
      const adv = sum("advance"), exp = sum("expense"), set = sum("settlement");
      return {
        driver_name: name, as_of_date: today(),
        advances: money(adv), expenses: money(exp), settled: money(set),
        balance: money(adv - exp - set), fleet_name: fleetName(),
      };
    }
    return { driver_name: name, fleet_name: fleetName() };
  }

  async function send(contactId, tpl) {
    const contact = waContacts.find((c) => c.id === contactId);
    if (!contact) return;
    const variables = variablesFor(tpl, contact);
    if (variables === null) return;   // cancelled
    try {
      const r = await fwCloud.authFn("whatsapp-send", {
        contactId, template: tpl, variables, refType: tpl,
      });
      if (typeof toast === "function") {
        toast(r && r.ok ? `Sent (${r.cost === "free" ? "free — window open" : r.cost}).` : "Could not send.", r && r.ok ? "ok" : "err");
      }
      await renderMessages();
    } catch (ex) {
      if (typeof toast === "function") toast(ex.message || "Could not send.", "err");
    }
  }

  /* Sends one template to every opted-in contact, one at a time with a short
     gap. Returns a summary string. */
  async function sendToAll(tpl) {
    const targets = waContacts.filter((c) => c.opted_in_at && !c.opted_out_at);
    if (!targets.length) { if (typeof toast === "function") toast("No opted-in drivers.", "err"); return; }
    if (!confirm(`Send "${tpl.replace(/_/g, " ")}" to ${targets.length} driver(s)?`)) return;
    let ok = 0, fail = 0;
    for (const c of targets) {
      const variables = variablesFor(tpl, c);
      if (!variables) continue;
      try {
        const r = await fwCloud.authFn("whatsapp-send", { contactId: c.id, template: tpl, variables, refType: tpl });
        if (r && r.ok) ok++; else fail++;
      } catch { fail++; }
      await new Promise((res) => setTimeout(res, 300));  // avoid rate-limiting
    }
    if (typeof toast === "function") toast(`Sent ${ok}, failed ${fail}.`, fail ? "err" : "ok");
    await renderMessages();
  }

  async function refresh() {
    waContacts = await loadContacts();
    renderStatus();
    renderContacts();
    await renderMessages();
  }

  // Loaded on first visit to the tab rather than on page load: most sessions
  // never open it, and it costs three queries.
  async function openWhatsApp() {
    if (!(typeof coreDbBacked === "function" && coreDbBacked())) {
      $("waStatus").innerHTML = "<p class='muted'>Sign in to use WhatsApp messaging — it needs your fleet's cloud account.</p>";
      $("waContacts").innerHTML = ""; $("waMessages").innerHTML = "";
      return;
    }
    if (!waLoaded) { waLoaded = true; }
    await refresh();
  }

  function init() {
    const host = $("waContacts");
    if (!host) return;
    const btnWelcomeAll = $("waBtnWelcomeAll");
    if (btnWelcomeAll) btnWelcomeAll.addEventListener("click", () => sendToAll("welcome_message"));
    host.addEventListener("click", (e) => {
      const add = e.target.getAttribute("data-wa-add");
      const inId = e.target.getAttribute("data-wa-optin");
      const outId = e.target.getAttribute("data-wa-optout");
      const sendId = e.target.getAttribute("data-wa-send");
      if (add) return addContact(add);
      if (inId) return setConsent(inId, true);
      if (outId) { if (confirm("Stop sending WhatsApp messages to this driver?")) setConsent(outId, false); return; }
      if (sendId) return send(sendId, e.target.getAttribute("data-wa-tpl"));
    });
    document.querySelectorAll('[data-tab="whatsapp"]').forEach((b) =>
      b.addEventListener("click", () => { openWhatsApp(); }));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.openWhatsApp = openWhatsApp;
})();
