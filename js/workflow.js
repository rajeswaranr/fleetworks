/* ============ FleetWorks — workflow.js ============
   The integrated owner ↔ mechanic service workflow. Loaded by BOTH
   fleet.html (owner view: #svcReqList) and garage.html (mechanic view:
   #gFlowList). One shared store ("fw_service_requests") so the full
   12-stage lifecycle is playable end-to-end; db/schema-service-workflow.sql
   is the normalized cloud twin (no blobs) for cross-device production.

   Stages (index = position; req.stage = last COMPLETED index):
   0 raised → 1 assigned → 2 accepted → 3 reached → 4 assessed →
   5 approved → 6 inprogress → 7 completed → 8 invoiced → 9 paid →
   10 reported → 11 closed */

"use strict";

const WF_KEY = "fw_service_requests";
const WF_STAGES = [
  { k: "raised",     label: "Complaint Raised",        actor: "Owner" },
  { k: "assigned",   label: "Mechanic Identified",     actor: "FleetWorks" },
  { k: "accepted",   label: "Owner OK — Quote Asked",  actor: "Owner" },
  { k: "reached",    label: "Vehicle at Workshop",     actor: "Owner" },
  { k: "assessed",   label: "Assessment & Estimate",   actor: "Mechanic" },
  { k: "approved",   label: "Estimate Approved",       actor: "Owner" },
  { k: "inprogress", label: "Work in Progress",        actor: "Mechanic" },
  { k: "completed",  label: "Work Completed",          actor: "Mechanic" },
  { k: "invoiced",   label: "Invoice Raised",          actor: "FleetWorks" },
  { k: "paid",       label: "Owner Paid",              actor: "Owner" },
  { k: "reported",   label: "Photos & Final Report",   actor: "Mechanic" },
  { k: "closed",     label: "Feedback — Vehicle Out",  actor: "Owner" }
];

function wfLoad() { try { return JSON.parse(localStorage.getItem(WF_KEY) || "[]"); } catch { return []; } }
function wfSave() { localStorage.setItem(WF_KEY, JSON.stringify(WFD)); }
let WFD = wfLoad();

const wfEsc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const wfINR = v => "₹" + Math.round(v).toLocaleString("en-IN");
const wfNow = () => new Date().toISOString();
const wfDate = d => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const wfUid = () => "sr" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

const WF_MECHANICS = [
  { name: "Murugan S", exp: "14 yrs · engine & clutch specialist", phone: "9840011111", shop: "Annai Auto Works, Salem", rating: 4.6, km: 3.2 },
  { name: "Ibrahim K", exp: "9 yrs · brakes & air systems", phone: "9840022222", shop: "Highway Motors, Chennai", rating: 4.4, km: 5.1 },
  { name: "Selvam P", exp: "17 yrs · electricals & BS6 diagnostics", phone: "9840033333", shop: "Sri Ganesh Truck Care, Coimbatore", rating: 4.8, km: 2.4 }
];

function wfAdvance(id, toIdx, by, note, patch) {
  const r = WFD.find(x => x.id === id);
  if (!r || toIdx !== r.stage + 1) return;
  r.stage = toIdx;
  r.events.push({ stage: toIdx, at: wfNow(), by, note: note || WF_STAGES[toIdx].label });
  if (patch) Object.assign(r, patch);
  // FleetWorks auto-steps: invoice immediately after completion
  if (WF_STAGES[toIdx].k === "completed") {
    const sub = r.finalAmount || (r.assessment && r.assessment.total) || 0;
    const gst = Math.round(sub * 0.18);
    r.invoice = { number: "FW-INV-" + String(1000 + WFD.indexOf(r) + 1), subtotal: sub, gst, total: sub + gst, issuedAt: wfNow() };
    r.stage = toIdx + 1;
    r.events.push({ stage: toIdx + 1, at: wfNow(), by: "FleetWorks", note: "Invoice " + r.invoice.number + " raised — " + wfINR(r.invoice.total) + " (incl. 18% GST)" });
  }
  wfSave();
  wfRender();
}

function wfRaise(vehicle, issue, severity) {
  const m = WF_MECHANICS[WFD.length % WF_MECHANICS.length];
  const r = {
    id: wfUid(), vehicle, issue, severity, createdAt: wfNow(), stage: 1,
    mechanic: m, assessment: null, invoice: null, finalAmount: null,
    photos: [], postReport: null, feedback: null,
    events: [
      { stage: 0, at: wfNow(), by: "Owner", note: "Complaint raised: " + issue },
      { stage: 1, at: wfNow(), by: "FleetWorks", note: `Matched ${m.name} (${m.rating}★, ${m.km} km away) — ${m.shop}` }
    ]
  };
  WFD.unshift(r);
  wfSave();
  wfRender();
}

// ---------- The graphical pipeline tracker ----------
function wfStepper(r) {
  return `<div class="wf-stepper">` + WF_STAGES.map((s, i) => {
    const cls = i <= r.stage ? "done" : i === r.stage + 1 ? "cur" : "";
    const dot = i <= r.stage ? (typeof FWIcon === "function" ? FWIcon("check", { size: 13 }) : "✓") : (i + 1);
    return `<div class="wf-step ${cls}"><span class="wf-dot">${dot}</span><span class="wf-lbl">${s.label}</span><span class="wf-actor ${s.actor}">${s.actor}</span></div>`;
  }).join("") + `</div>`;
}

function wfDetails(r) {
  let h = "";
  if (r.stage >= 1) h += `<div class="wf-act"><strong>${wfEsc(r.mechanic.name)}</strong> — ${wfEsc(r.mechanic.exp)}<br />
    <span class="muted">${wfEsc(r.mechanic.shop)} · ${r.mechanic.rating}★ · ${r.mechanic.km} km away · <a href="tel:+91${r.mechanic.phone}">${r.mechanic.phone}</a></span></div>`;
  if (r.assessment) h += `<div class="wf-act"><strong>Assessment:</strong> ${wfEsc(r.assessment.notes)}<br />
    <span class="muted">Estimate <strong>${wfINR(r.assessment.total)}</strong> · TAT <strong>${wfEsc(r.assessment.tat)}</strong>${r.assessment.items ? " · " + wfEsc(r.assessment.items) : ""}</span></div>`;
  if (r.invoice) h += `<div class="wf-act"><strong>FleetWorks Invoice ${r.invoice.number}</strong> — work ${wfINR(r.invoice.subtotal)} + GST ${wfINR(r.invoice.gst)} = <strong>${wfINR(r.invoice.total)}</strong>${r.stage >= 9 ? ' <span class="fw-badge ok">PAID</span>' : ""}</div>`;
  if (r.photos.length) h += `<div class="gphotos">${r.photos.map(p => `<img src="${p}" alt="repair photo" />`).join("")}</div>`;
  if (r.postReport) h += `<div class="wf-act"><strong>Completion report:</strong> ${wfEsc(r.postReport)}</div>`;
  if (r.feedback) h += `<div class="wf-act"><strong>Owner feedback:</strong> <span style="color:#e2930f">${"★".repeat(r.feedback.stars)}</span> ${wfEsc(r.feedback.text || "")}</div>`;
  return h;
}

function wfEventsHTML(r) {
  return `<details class="chart-table"><summary>Full timeline (${r.events.length})</summary>` +
    r.events.map(e => `<p class="muted" style="margin:5px 0;font-size:0.8rem"><strong>${wfEsc(e.by)}</strong> · ${wfDate(e.at)} — ${wfEsc(e.note)}</p>`).join("") + `</details>`;
}

// ---------- Owner-side actions ----------
function wfOwnerAction(r) {
  const next = r.stage + 1;
  const k = WF_STAGES[next] ? WF_STAGES[next].k : null;
  if (k === "accepted") return `<button class="btn btn-primary btn-sm" onclick="wfAdvance('${r.id}',${next},'Owner','Owner accepted the mechanic and asked for a quotation')">Mechanic OK — Ask for Quotation</button>`;
  if (k === "reached") return `<button class="btn btn-primary btn-sm" onclick="wfAdvance('${r.id}',${next},'Owner','Vehicle reached the workshop')">Vehicle Reached Workshop</button>`;
  if (k === "approved") return r.assessment ?
    `<button class="btn btn-primary btn-sm" onclick="wfAdvance('${r.id}',${next},'Owner','Estimate ${wfINR(r.assessment.total)} approved — work authorised')">Approve Estimate ${wfINR(r.assessment.total)}</button>` :
    `<span class="muted">Waiting for the mechanic's assessment…</span>`;
  if (k === "paid") return `<button class="btn btn-primary btn-sm" onclick="wfAdvance('${r.id}',${next},'Owner','Invoice ${r.invoice ? r.invoice.number : ""} paid')">Pay ${r.invoice ? wfINR(r.invoice.total) : "Invoice"} (UPI / Bank)</button>`;
  if (k === "closed") return `<span class="wf-fb">Rate the job:
    ${[1,2,3,4,5].map(n => `<button class="link-btn wf-star" onclick="wfClose('${r.id}',${n})">${n}★</button>`).join(" ")}</span>`;
  if (!WF_STAGES[next]) return `<span class="fw-badge ok">Closed — vehicle released</span>`;
  return `<span class="muted">With ${WF_STAGES[next].actor} — ${WF_STAGES[next].label}…</span>`;
}
function wfClose(id, stars) {
  const text = prompt("Any comments for the workshop? (optional)", "") || "";
  wfAdvance(id, 11, "Owner", "Feedback " + stars + "★ — vehicle released from workshop", { feedback: { stars, text } });
}

// ---------- Mechanic-side actions ----------
function wfMechAction(r) {
  const next = r.stage + 1;
  const k = WF_STAGES[next] ? WF_STAGES[next].k : null;
  if (k === "assessed") return `
    <div class="wf-form">
      <input type="text" id="wfNotes-${r.id}" placeholder="Initial assessment — what's wrong &amp; what's needed" />
      <div class="form-row" style="margin-top:8px">
        <input type="number" id="wfTotal-${r.id}" placeholder="Estimate total ₹" min="1" inputmode="numeric" />
        <input type="text" id="wfTat-${r.id}" placeholder="TAT e.g. 2 days" />
      </div>
      <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="wfAssess('${r.id}')">Send Assessment &amp; Estimate to Owner</button>
    </div>`;
  if (k === "inprogress") return `<button class="btn btn-primary btn-sm" onclick="wfAdvance('${r.id}',${next},'Mechanic','Work started on the vehicle')">Start Work</button>`;
  if (k === "completed") return `<button class="btn btn-primary btn-sm" onclick="wfAdvance('${r.id}',${next},'Mechanic','Work completed — sent for invoicing',{finalAmount:${r.assessment ? r.assessment.total : 0}})">Mark Work Completed</button>`;
  if (k === "reported") return `
    <div class="wf-form">
      <button class="btn btn-outline btn-sm" onclick="wfPhoto('${r.id}')">${typeof FWIcon === "function" ? FWIcon("plus", { size: 14 }) : "+"} Add Repair Photo (${r.photos.length}/6)</button>
      <input type="text" id="wfReport-${r.id}" placeholder="Post-work completion report" style="margin-top:8px" />
      <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="wfReport('${r.id}')">Submit Photos &amp; Final Report</button>
    </div>`;
  if (!WF_STAGES[next]) return `<span class="fw-badge ok">Closed — great job!</span>`;
  return `<span class="muted">With ${WF_STAGES[next].actor} — ${WF_STAGES[next].label}…</span>`;
}
function wfAssess(id) {
  const notes = document.getElementById("wfNotes-" + id).value.trim();
  const total = +document.getElementById("wfTotal-" + id).value;
  const tat = document.getElementById("wfTat-" + id).value.trim() || "1 day";
  if (!notes || !total) { alert("Assessment notes and estimate total are needed."); return; }
  wfAdvance(id, 4, "Mechanic", `Assessment sent — estimate ${wfINR(total)}, TAT ${tat}`, { assessment: { notes, total, tat } });
}
let wfPhotoTarget = null;
function wfPhoto(id) {
  wfPhotoTarget = id;
  document.getElementById("wfPhotoFile")?.click();
}
document.getElementById("wfPhotoFile")?.addEventListener("change", e => {
  const f = e.target.files[0];
  const r = WFD.find(x => x.id === wfPhotoTarget);
  if (!f || !r || r.photos.length >= 6) { e.target.value = ""; return; }
  const img = new Image();
  img.onload = () => {
    const s = Math.min(1, 360 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    r.photos.push(c.toDataURL("image/jpeg", 0.55));
    wfSave(); wfRender();
  };
  img.src = URL.createObjectURL(f);
  e.target.value = "";
});
function wfReport(id) {
  const r = WFD.find(x => x.id === id);
  const rep = document.getElementById("wfReport-" + id).value.trim();
  if (!rep) { alert("Write a short completion report — the owner reads it before feedback."); return; }
  if (!r.photos.length && !confirm("No photos attached — submit anyway?")) return;
  wfAdvance(id, 10, "Mechanic", "Photos & post-work report submitted", { postReport: rep });
}

// ---------- Render (owner OR garage, whichever panel exists) ----------
function wfCard(r, actionsHTML) {
  const sev = r.severity === "High" ? "overdue" : r.severity === "Medium" ? "soon" : "ok";
  return `<div class="chart-card wf-card">
    <div class="chart-head" style="margin-bottom:2px"><div>
      <h2 style="font-size:1.02rem"><strong>${wfEsc(r.vehicle)}</strong> — ${wfEsc(r.issue)} <span class="fw-badge ${sev}">${wfEsc(r.severity)}</span></h2>
      <p class="muted" style="font-size:0.78rem">Request ${r.id.toUpperCase()} · raised ${wfDate(r.createdAt)}</p>
    </div></div>
    ${wfStepper(r)}
    ${wfDetails(r)}
    <div class="wf-actions">${actionsHTML}</div>
    ${wfEventsHTML(r)}
  </div>`;
}

function wfRender() {
  const owner = document.getElementById("svcReqList");
  const mech = document.getElementById("gFlowList");
  if (owner) owner.innerHTML = WFD.length ?
    WFD.map(r => wfCard(r, wfOwnerAction(r))).join("") :
    "<p class='muted' style='padding:12px 4px'>No service requests yet — raise one above and watch FleetWorks take over.</p>";
  if (mech) mech.innerHTML = WFD.length ?
    WFD.map(r => wfCard(r, wfMechAction(r))).join("") :
    "<p class='muted' style='padding:12px 4px'>No live FleetWorks jobs yet. Owner-raised complaints assigned to you appear here.</p>";
}

// ---------- Owner raise form ----------
document.getElementById("svcReqForm")?.addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const sel = document.getElementById("svcVehicle");
  const vehicle = sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text : (fd.vehicle || "Vehicle");
  wfRaise(vehicle, fd.issue.trim(), fd.severity);
  e.target.reset();
});

// ---------- Demo seed (only when both empty and demo mode somewhere) ----------
if (!WFD.length && (localStorage.getItem("ff_fleet") || localStorage.getItem("fw_garage"))) {
  wfRaise("KA-05-GH-7890", "Brakes spongy after inspection fault", "High");
  wfRaise("TN-09-CD-5678", "Coolant temperature climbing on ghats", "Medium");
  // move the second one deep into the flow so both sides have live actions
  const deep = WFD[0]; // TN-09 (unshifted last)
  ["Owner accepted the mechanic and asked for a quotation", "Vehicle reached the workshop"].forEach((n, i) =>
    (deep.stage = 2 + i, deep.events.push({ stage: 2 + i, at: wfNow(), by: "Owner", note: n })));
  deep.assessment = { notes: "Radiator core 40% choked, fan clutch weak. De-choke + fan clutch replacement.", total: 7800, tat: "1 day" };
  deep.stage = 4;
  deep.events.push({ stage: 4, at: wfNow(), by: "Mechanic", note: "Assessment sent — estimate ₹7,800, TAT 1 day" });
  wfSave();
}
wfRender();
