/* ============ FleetWorks — copilot.js ============
   Copilot — the FleetWorks AI: a floating chat assistant that answers
   questions from the fleet data in localStorage ("ff_fleet").
   Runs fully client-side; understands plain English fleet questions. */

(function () {
  "use strict";

  function data() {
    try {
      const d = JSON.parse(localStorage.getItem("ff_fleet") || "{}");
      return { vehicles: d.vehicles || [], expenses: d.expenses || [], fuelLogs: d.fuelLogs || [], issues: d.issues || [], reminders: d.reminders || [], drivers: d.drivers || [], workOrders: d.workOrders || [] };
    } catch { return { vehicles: [], expenses: [], fuelLogs: [], issues: [], reminders: [], drivers: [], workOrders: [] }; }
  }
  const inr = v => v >= 100000 ? "₹" + (v / 100000).toFixed(1) + "L" : v >= 1000 ? "₹" + (v / 1000).toFixed(1) + "K" : "₹" + Math.round(v);
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const monthKey = d => d.slice(0, 7);
  const nowKey = () => new Date().toISOString().slice(0, 7);

  const DOC_LABELS = { insurance: "Insurance", puc: "PUC", fitness: "Fitness (FC)", permit: "Permit", roadtax: "Road Tax" };

  // ---------- Intents ----------
  function answer(qRaw) {
    const q = qRaw.toLowerCase();
    const db = data();

    // ---------- How-to: Copilot knows the tool itself ----------
    const hasQ = (...w) => w.some(x => q.includes(x));
    const HOWTO = [
      { p: ["add vehicle", "add a vehicle", "new vehicle", "register vehicle", "create vehicle"], t: "Add a vehicle", go: "account",
        s: "Sidebar → <strong>My Account</strong> → <strong>Vehicle</strong> tab → enter number, type & monthly km → <em>Add Vehicle</em>. It appears everywhere instantly — compliance, health score, analytics." },
      { p: ["add driver", "add a driver", "new driver"], t: "Add a driver", go: "drivers",
        s: "FleetOps → <strong>Fleet → Drivers & Contacts</strong> → fill name, DL number, validity & assigned vehicle → save. Use <em>Copy link</em> on his row to give him a no-login phone entry page." },
      { p: ["add expense", "add bill", "upload bill", "scan bill", "add an expense", "enter bill", "upload invoice", "scan a bill"], t: "Add an expense / bill", go: "gstbills",
        s: "FleetFin → <strong>Bills — GST / Non-GST</strong> → <em>Scan with Camera</em>, <em>Upload Bill File</em> (image/PDF) or <em>Enter Manually</em> → check the auto-read items (edit item, part no, price; untick wrong ones) → <em>Confirm & Save Bill</em>. The bill itself is stored too." },
      { p: ["delete bill", "delete expense", "edit bill", "edit expense", "remove expense", "delete a non gst", "delete non-gst", "non gst bill"], t: "Edit / delete an expense", go: "expensehistory",
        s: "FleetFin → <strong>Expenses</strong> (or Bills — GST/Non-GST) → every row has <em>Edit</em> and <em>Delete</em>. Click a bill row first to see its itemised table; Delete asks for confirmation." },
      { p: ["add diesel", "add fuel", "diesel entry", "fuel entry", "log diesel"], t: "Log a diesel fill", go: "account",
        s: "Sidebar → <strong>My Account</strong> → <strong>Diesel</strong> tab → litres + amount + odometer. Mileage, Diesel Watch and cost-per-km update automatically." },
      { p: ["book service", "raise complaint", "service request", "raise a complaint", "book a service"], t: "Book service / raise a complaint", go: "servicereq",
        s: "FleetOps → <strong>Book Service — Live Status</strong> → pick vehicle, describe the problem → FleetWorks matches a rated mechanic and you track all 12 stages (assessment → your approval → repair → invoice → feedback) on one pipeline. Roadside breakdown? Hit the red <strong>SOS</strong> button in the top bar." },
      { p: ["add trip", "log trip", "freight", "trip entry"], t: "Log a trip & freight", go: "trips",
        s: "FleetOps → <strong>Fleet → Trips & Loads</strong> → vehicle, route, freight received → save. Profit-per-vehicle updates on the same page." },
      { p: ["khata", "advance", "settlement"], t: "Driver khata", go: "khata",
        s: "FleetFin → <strong>Driver Khata</strong> → record advances given, trip expenses and cash returned — the balance with each driver updates live." },
      { p: ["tally", "gst filing", "export accounts"], t: "Export to Tally", go: "accounts",
        s: "FleetFin → <strong>Accounts & Tally</strong> → <em>Export to Tally (GST)</em> downloads payment vouchers with per-category ledgers. Import in Tally via Gateway of Tally → Import Data → Vouchers." },
      { p: ["driver link", "driver page", "driver app"], t: "Driver Link", go: "drivers",
        s: "FleetOps → <strong>Fleet → Drivers</strong> → <em>Copy link</em> on the driver's row → send on WhatsApp. He logs diesel, problems and the daily 10-point check from his phone — no app, no login." },
      { p: ["health score", "vehicle health"], t: "Vehicle health scores", go: "home",
        s: "<strong>Home</strong> shows the Fleet Health strip (0–100 per vehicle, weakest first); the Vehicles & RTO table has a Health column too." },
      { p: ["what if", "whatif", "simulate"], t: "What-if simulator", go: "whatif",
        s: "FleetIQ → <strong>What-if Analysis</strong> → drag the diesel-price / monthly-running / extra-vehicle sliders and monthly & yearly costs reproject live from your own numbers." },
      { p: ["reminder", "pm due", "service due"], t: "Service reminders", go: "reminders",
        s: "FleetOps → <strong>Reminders & Compliance → Service Reminders</strong> → set task + interval per vehicle. Overdue ones surface in Home's Action Inbox automatically." }
    ];
    const goBtn = tab => document.querySelector(`#tabBar .tab-btn[data-tab=${tab}]`)
      ? ` <button class="link-btn" onclick="document.querySelector('#tabBar .tab-btn[data-tab=${tab}]').click()">Take me there →</button>` : "";
    const hit = HOWTO.find(h => h.p.some(p => q.includes(p)));
    if (hit && hasQ("how", "where", "add", "delete", "edit", "upload", "scan", "log", "book", "raise", "export", "copy", "guide", "what", "khata", "tally", "link", "simulate")) {
      return `<strong>${hit.t}:</strong><br>${hit.s}${goBtn(hit.go)}`;
    }
    if (hasQ("how do i", "how to", "help me", "what can you", "guide me")) {
      return "I can guide you through FleetWorks — try: <em>add a vehicle · add a driver · upload a bill · delete an expense · log diesel · book service · driver link · export to Tally · what-if</em>. Or ask about your data: spend, mileage, RTO documents, DLs, job cards.";
    }

    if (!db.vehicles.length) return "I don't see any fleet data yet. Load the demo fleet or add your vehicles first — then ask me anything about your spend, mileage, compliance or maintenance.";

    const findVehicle = () => db.vehicles.find(v => q.includes(v.name.toLowerCase()) || q.includes(v.name.toLowerCase().replace(/-/g, "")));
    const has = (...words) => words.some(w => q.includes(w));

    // Compliance / documents
    if (has("insurance", "puc", "permit", "fitness", "road tax", "roadtax", "expir", "document", "rc ", "compliance", "papers")) {
      const rows = [];
      db.vehicles.forEach(v => Object.entries(v.compliance || {}).forEach(([doc, till]) => {
        if (!till) return;
        const d = Math.round((new Date(till) - new Date()) / 86400000);
        if (d < 60) rows.push({ v: v.name, doc: DOC_LABELS[doc], d, till });
      }));
      if (!rows.length) return "All RTO documents (Insurance, PUC, Fitness, Permit, Road Tax) are valid for at least 60 days.";
      rows.sort((a, b) => a.d - b.d);
      return "Documents needing attention:<br>" + rows.map(r =>
        `• <strong>${esc(r.v)}</strong> — ${r.doc}: ${r.d < 0 ? "<span style='color:#d03b3b'>EXPIRED " + (-r.d) + " days ago</span>" : r.d + " days left"}`).join("<br>");
    }

    // Mileage / fuel
    if (has("mileage", "km/l", "kmpl", "fuel", "diesel", "average")) {
      const v = findVehicle();
      const perVehicle = db.vehicles.map(vv => {
        const fills = db.fuelLogs.filter(f => f.vehicleId === vv.id).sort((a, b) => a.odo - b.odo);
        let dist = 0, litres = 0;
        for (let i = 1; i < fills.length; i++) { const dd = fills[i].odo - fills[i - 1].odo; if (dd > 0) { dist += dd; litres += fills[i].litres; } }
        return { name: vv.name, kmpl: litres ? dist / litres : null };
      }).filter(x => x.kmpl);
      if (!perVehicle.length) return "No fuel logs yet — add fuel entries (litres + odometer) in the Fleet Manager's Fuel tab and I'll compute mileage for every vehicle.";
      if (v) { const m = perVehicle.find(x => x.name === v.name); return m ? `<strong>${esc(v.name)}</strong> is averaging <strong>${m.kmpl.toFixed(2)} km/l</strong>.` : `No fuel data for ${esc(v.name)} yet.`; }
      return "Fleet mileage:<br>" + perVehicle.map(x => `• ${esc(x.name)}: <strong>${x.kmpl.toFixed(2)} km/l</strong>`).join("<br>");
    }

    // Cost per km / most expensive
    if (has("cost per km", "costliest", "most expensive", "expensive vehicle", "worst vehicle")) {
      const stats = db.vehicles.map(v => {
        const spend = db.expenses.filter(e => e.vehicleId === v.id).reduce((s, e) => s + e.amount, 0);
        const months = new Set(db.expenses.filter(e => e.vehicleId === v.id).map(e => monthKey(e.date))).size || 1;
        return { name: v.name, spend, cpk: spend / (v.kmPerMonth * months) };
      }).sort((a, b) => b.cpk - a.cpk);
      const top = stats[0];
      return `Highest maintenance cost per km: <strong>${esc(top.name)}</strong> at <strong>₹${top.cpk.toFixed(2)}/km</strong> (total ${inr(top.spend)}).<br>` +
        stats.slice(1, 4).map(s => `• ${esc(s.name)}: ₹${s.cpk.toFixed(2)}/km`).join("<br>") +
        "<br>Full comparison with industry benchmarks is on the AI Dashboard.";
    }

    // Spend / expenses
    if (has("spend", "expense", "how much", "total", "cost", "money")) {
      const v = findVehicle();
      const thisMonth = has("this month", "month");
      let list = db.expenses;
      let label = "overall";
      if (v) { list = list.filter(e => e.vehicleId === v.id); label = "for " + v.name; }
      if (thisMonth) { list = list.filter(e => monthKey(e.date) === nowKey()); label += " this month"; }
      const total = list.reduce((s, e) => s + e.amount, 0);
      const byCat = {};
      list.forEach(e => byCat[e.category] = (byCat[e.category] || 0) + e.amount);
      const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 3);
      return `Total spend ${esc(label)}: <strong>${inr(total)}</strong> across ${list.length} jobs.` +
        (top.length ? "<br>Top heads: " + top.map(([c, a]) => `${esc(c)} (${inr(a)})`).join(", ") : "");
    }

    // Predictions / due / upcoming
    if (has("due", "upcoming", "predict", "next", "replace", "when")) {
      const rem = db.reminders.map(r => {
        const next = new Date(r.lastDate); next.setMonth(next.getMonth() + (+r.everyMonths || 3));
        return { v: r.vehicleId, task: r.task, next };
      }).sort((a, b) => a.next - b.next).slice(0, 5);
      const vn = id => (db.vehicles.find(x => x.id === id) || {}).name || "?";
      if (!rem.length) return "No PM schedules set. Add them in Fleet Manager → Maintenance, and see ML part-replacement predictions on the AI Dashboard.";
      return "Next maintenance due:<br>" + rem.map(r =>
        `• <strong>${esc(vn(r.v))}</strong> — ${esc(r.task)}: ${r.next.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`).join("<br>") +
        "<br>Part-level ML predictions (tyres, battery, clutch…) are on the AI Dashboard.";
    }

    // Drivers / DL
    if (has("driver", "dl ", " dl", "licence", "license")) {
      if (!db.drivers.length) return "No drivers added yet — add them in Fleet Manager → Drivers, and I'll track DL expiries for you.";
      return "Your drivers:<br>" + db.drivers.map(d => {
        const days = d.dlExpiry ? Math.round((new Date(d.dlExpiry) - new Date()) / 86400000) : null;
        const dl = days === null ? "DL date not set" : days < 0 ? `<span style='color:#d03b3b'>DL EXPIRED ${-days} days ago</span>` : days <= 30 ? `<strong>DL expires in ${days} days</strong>` : "DL valid";
        const veh = d.vehicleId ? (db.vehicles.find(v => v.id === d.vehicleId) || {}).name : null;
        return `• <strong>${esc(d.name)}</strong>${veh ? " (" + esc(veh) + ")" : ""} — ${dl}`;
      }).join("<br>");
    }

    // Job cards / work orders
    if (has("job card", "work order", "workshop", "in the garage", "under repair")) {
      const open = db.workOrders.filter(w => w.status !== "Completed");
      if (!open.length) return "No vehicles in the workshop right now — all job cards closed.";
      const vn = id => (db.vehicles.find(x => x.id === id) || {}).name || "?";
      return `${open.length} open job card(s):<br>` + open.map(w =>
        `• <strong>${esc(vn(w.vehicleId))}</strong> — ${esc(w.title)} at ${esc(w.vendor || "workshop")} (since ${new Date(w.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })})`).join("<br>");
    }

    // Issues / priorities
    if (has("issue", "problem", "priorit", "urgent", "fix", "broken")) {
      const open = db.issues.filter(i => i.status !== "Resolved");
      if (!open.length) return "No open issues.";
      const sevW = { High: 3, Medium: 2, Low: 1 };
      const vn = id => (db.vehicles.find(x => x.id === id) || {}).name || "?";
      const ranked = open.sort((a, b) => sevW[b.severity] - sevW[a.severity]).slice(0, 5);
      return `${open.length} open issue(s). AI priority order:<br>` + ranked.map((i, idx) =>
        `${idx + 1}. <strong>${esc(vn(i.vehicleId))}</strong> — ${esc(i.title)} <em>(${i.severity})</em>`).join("<br>");
    }

    // Help / capabilities
    if (has("help", "what can")) {
      return "I can answer from your fleet data — try:<br>• \"total spend this month\"<br>• \"which vehicle is most expensive\"<br>• \"mileage of TN-01-AB-1234\"<br>• \"which documents are expiring\"<br>• \"driver licences\"<br>• \"open job cards\"<br>• \"what maintenance is due next\"<br>• \"open issues by priority\"";
    }

    return "I didn't catch that. Try asking about <strong>spend</strong>, <strong>mileage</strong>, <strong>documents expiring</strong>, <strong>drivers</strong>, <strong>job cards</strong>, <strong>maintenance due</strong> or <strong>open issues</strong> — or type \"help\".";
  }

  // ---------- UI ----------
  const html = `
    <button id="cpFab" aria-label="Ask Copilot, the FleetWorks AI"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5L19 9.9l-5.1 1.9L12 17l-1.9-5.2L5 9.9l5.1-1L12 3Z"/></svg><span>Ask Copilot</span></button>
    <div id="cpPanel" hidden>
      <div class="cp-head" id="cpHead" title="Drag to move">
        <span class="cp-head-title"><span class="cp-drag-grip">⠿</span><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:4px"><path d="M12 3l1.9 5L19 9.9l-5.1 1.9L12 17l-1.9-5.2L5 9.9l5.1-1L12 3Z"/></svg>Copilot <small style="font-weight:500;opacity:0.75;margin-left:4px">· AI</small></span>
        <span class="cp-head-actions">
          <button id="cpMin" aria-label="Minimize" title="Minimize">–</button>
          <button id="cpClose" aria-label="Close" title="Close">✕</button>
        </span>
      </div>
      <div class="cp-body" id="cpBody">
        <div class="cp-msg cp-bot">Hello! I'm <strong>Copilot</strong>, your fleet's AI. Ask me about expenses, mileage, RTO documents, driver licences, job cards or maintenance — plain English works great.</div>
        <div class="cp-chips" id="cpChips">
          <button data-q="Total spend this month">Spend this month</button>
          <button data-q="Which vehicle is most expensive per km?">Costliest vehicle</button>
          <button data-q="Which documents are expiring?">RTO documents</button>
          <button data-q="Driver licences">Driver DLs</button>
          <button data-q="Open job cards">Job cards</button>
          <button data-q="What maintenance is due next?">Due next</button>
        </div>
      </div>
      <form class="cp-input" id="cpForm">
        <input type="text" id="cpText" placeholder="Ask about your fleet…" autocomplete="off" />
        <button type="submit" class="btn btn-primary btn-sm">Send</button>
      </form>
    </div>`;
  const wrap = document.createElement("div");
  wrap.id = "cpWrap";
  wrap.innerHTML = html;
  document.body.appendChild(wrap);

  const panel = document.getElementById("cpPanel");
  const body = document.getElementById("cpBody");

  function addMsg(text, who) {
    const div = document.createElement("div");
    div.className = "cp-msg " + (who === "user" ? "cp-user" : "cp-bot");
    if (who === "user") div.textContent = text; else div.innerHTML = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }
  function ask(q) {
    addMsg(q, "user");
    setTimeout(() => addMsg(answer(q), "bot"), 250);
  }

  // ---------- Drag to move ----------
  const POS_KEY = "fw_sarathi_pos";
  const head = document.getElementById("cpHead");
  let dragging = false, moved = false, startX, startY, startLeft, startTop;

  function clamp(left, top) {
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const maxLeft = Math.max(6, window.innerWidth - w - 6);
    const maxTop = Math.max(6, window.innerHeight - h - 6);
    return { left: Math.min(Math.max(6, left), maxLeft), top: Math.min(Math.max(6, top), maxTop) };
  }
  function setPos(left, top) {
    const p = clamp(left, top);
    panel.style.left = p.left + "px";
    panel.style.top = p.top + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }
  function restorePos() {
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      if (saved) setPos(saved.left, saved.top);
    } catch { /* keep default corner position */ }
  }

  head.addEventListener("pointerdown", ev => {
    if (ev.target.closest("button")) return;
    dragging = true; moved = false;
    head.setPointerCapture(ev.pointerId);
    const rect = panel.getBoundingClientRect();
    startX = ev.clientX; startY = ev.clientY;
    startLeft = rect.left; startTop = rect.top;
  });
  head.addEventListener("pointermove", ev => {
    if (!dragging) return;
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    setPos(startLeft + dx, startTop + dy);
  });
  function endDrag(ev) {
    if (!dragging) return;
    dragging = false;
    if (moved) {
      const rect = panel.getBoundingClientRect();
      localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
    }
  }
  head.addEventListener("pointerup", endDrag);
  head.addEventListener("pointercancel", endDrag);
  window.addEventListener("resize", () => {
    if (panel.style.left) { const r = panel.getBoundingClientRect(); setPos(r.left, r.top); }
  });

  // ---------- Minimize (collapse to header bar, distinct from close) ----------
  const minBtn = document.getElementById("cpMin");
  function setCollapsed(on) {
    panel.classList.toggle("cp-collapsed", on);
    minBtn.textContent = on ? "▢" : "–";
    minBtn.title = on ? "Expand" : "Minimize";
    minBtn.setAttribute("aria-label", on ? "Expand" : "Minimize");
  }
  minBtn.addEventListener("click", () => setCollapsed(!panel.classList.contains("cp-collapsed")));

  document.getElementById("cpFab").addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { restorePos(); setCollapsed(false); document.getElementById("cpText").focus(); }
  });
  document.getElementById("cpClose").addEventListener("click", () => panel.hidden = true);
  document.getElementById("cpForm").addEventListener("submit", e => {
    e.preventDefault();
    const t = document.getElementById("cpText");
    if (t.value.trim()) { ask(t.value.trim()); t.value = ""; }
  });
  document.getElementById("cpChips").addEventListener("click", e => {
    if (e.target.dataset.q) ask(e.target.dataset.q);
  });
})();
