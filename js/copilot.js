/* ============ FleetWorks — copilot.js ============
   FleetWorks AI Copilot: a floating chat assistant that answers
   questions from the fleet data in localStorage ("ff_fleet").
   Runs fully client-side; understands English + common Hinglish terms. */

(function () {
  "use strict";

  function data() {
    try {
      const d = JSON.parse(localStorage.getItem("ff_fleet") || "{}");
      return { vehicles: d.vehicles || [], expenses: d.expenses || [], fuelLogs: d.fuelLogs || [], issues: d.issues || [], reminders: d.reminders || [] };
    } catch { return { vehicles: [], expenses: [], fuelLogs: [], issues: [], reminders: [] }; }
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
    if (!db.vehicles.length) return "I don't see any fleet data yet. Load the demo fleet or add your vehicles first — then ask me anything about your spend, mileage, compliance or maintenance.";

    const findVehicle = () => db.vehicles.find(v => q.includes(v.name.toLowerCase()) || q.includes(v.name.toLowerCase().replace(/-/g, "")));
    const has = (...words) => words.some(w => q.includes(w));

    // Compliance / documents
    if (has("insurance", "puc", "permit", "fitness", "road tax", "roadtax", "expir", "document", "rc ", "compliance", "kagaz")) {
      const rows = [];
      db.vehicles.forEach(v => Object.entries(v.compliance || {}).forEach(([doc, till]) => {
        if (!till) return;
        const d = Math.round((new Date(till) - new Date()) / 86400000);
        if (d < 60) rows.push({ v: v.name, doc: DOC_LABELS[doc], d, till });
      }));
      if (!rows.length) return "All RTO documents (Insurance, PUC, Fitness, Permit, Road Tax) are valid for at least 60 days. ✅";
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
    if (has("cost per km", "costliest", "most expensive", "expensive vehicle", "worst vehicle", "mehenga", "sabse")) {
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
    if (has("spend", "expense", "kharcha", "kitna", "total", "cost", "paisa")) {
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
    if (has("due", "upcoming", "predict", "next", "replace", "kab")) {
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

    // Issues / priorities
    if (has("issue", "problem", "priorit", "urgent", "fix", "kharab")) {
      const open = db.issues.filter(i => i.status !== "Resolved");
      if (!open.length) return "No open issues. 🎉";
      const sevW = { High: 3, Medium: 2, Low: 1 };
      const vn = id => (db.vehicles.find(x => x.id === id) || {}).name || "?";
      const ranked = open.sort((a, b) => sevW[b.severity] - sevW[a.severity]).slice(0, 5);
      return `${open.length} open issue(s). AI priority order:<br>` + ranked.map((i, idx) =>
        `${idx + 1}. <strong>${esc(vn(i.vehicleId))}</strong> — ${esc(i.title)} <em>(${i.severity})</em>`).join("<br>");
    }

    // Help / capabilities
    if (has("help", "what can", "kya kar")) {
      return "I can answer from your fleet data — try:<br>• \"total spend this month\"<br>• \"which vehicle is most expensive\"<br>• \"mileage of TN-01-AB-1234\"<br>• \"which documents are expiring\"<br>• \"what maintenance is due next\"<br>• \"open issues by priority\"";
    }

    return "I didn't catch that. Try asking about <strong>spend</strong>, <strong>mileage</strong>, <strong>documents expiring</strong>, <strong>maintenance due</strong> or <strong>open issues</strong> — or type \"help\".";
  }

  // ---------- UI ----------
  const html = `
    <button id="cpFab" aria-label="FleetWorks AI Copilot">🤖<span>Ask AI</span></button>
    <div id="cpPanel" hidden>
      <div class="cp-head">
        <span>🤖 FleetWorks AI Copilot</span>
        <button id="cpClose" aria-label="Close">✕</button>
      </div>
      <div class="cp-body" id="cpBody">
        <div class="cp-msg cp-bot">Namaste! 🙏 I'm your fleet's AI Copilot. Ask me about spend, mileage, RTO documents, maintenance due or open issues.</div>
        <div class="cp-chips" id="cpChips">
          <button data-q="Total spend this month">Spend this month</button>
          <button data-q="Which vehicle is most expensive per km?">Costliest vehicle</button>
          <button data-q="Which documents are expiring?">RTO documents</button>
          <button data-q="What maintenance is due next?">Due next</button>
          <button data-q="Open issues by priority">Issue priorities</button>
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

  document.getElementById("cpFab").addEventListener("click", () => { panel.hidden = !panel.hidden; if (!panel.hidden) document.getElementById("cpText").focus(); });
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
