"use strict";
// FleetWorks Automation — client-side controller for automation.html
// Manages intent-based rule creation, template rules, enable/disable, and run history.

const TRIGGER_LABELS = {
  document_expiry:  "Document Expiry Alert",
  odometer_service: "Service Interval",
  expense_stale:    "Stale Expense Approval",
  high_issue_open:  "High Issue Watch",
  fuel_efficiency:  "Fuel Efficiency Drop",
};

const ACTION_LABELS = {
  create_reminder:  "Create Reminder",
  create_work_order:"Create Work Order",
  create_issue:     "Create Issue",
  whatsapp_notify:  "WhatsApp Notify",
};

const TRIGGER_ICONS = {
  document_expiry:  "calendar",
  odometer_service: "gauge",
  expense_stale:    "receipt",
  high_issue_open:  "alert",
  fuel_efficiency:  "fuel",
};

const ACTION_ICONS = {
  create_reminder:   "bell",
  create_work_order: "wrench",
  create_issue:      "alert",
  whatsapp_notify:   "phone",
};

const TEMPLATES = [
  {
    name: "Insurance & PUC expiry reminder",
    description: "Reminds you 30 days before any vehicle's insurance or PUC expires.",
    trigger_type: "document_expiry",
    trigger_config: { days_before: 30, documents: ["insurance","puc","fitness","permit","roadtax"] },
    action_type: "create_reminder",
    action_config: { title_template: "{vehicle} — {doc} expires in {days} day(s)" },
    icon: "calendar",
    color: "#f59e0b",
  },
  {
    name: "Service interval reminder",
    description: "Creates a work order when a vehicle goes 10,000 km without a completed service.",
    trigger_type: "odometer_service",
    trigger_config: { interval_km: 10000 },
    action_type: "create_work_order",
    action_config: { title_template: "{vehicle} — service due ({ago} km since last service)" },
    icon: "wrench",
    color: "#6366f1",
  },
  {
    name: "Stale expense approval",
    description: "Reminds you when driver expense requests sit unapproved for 3+ days.",
    trigger_type: "expense_stale",
    trigger_config: { days: 3 },
    action_type: "create_reminder",
    action_config: { title_template: "{count} expense request(s) waiting for approval" },
    icon: "receipt",
    color: "#22d3ee",
  },
  {
    name: "High-severity issue escalation",
    description: "Auto-creates a work order when a High/Critical issue stays unresolved for 7 days.",
    trigger_type: "high_issue_open",
    trigger_config: { days: 7, severities: ["High","Critical"] },
    action_type: "create_work_order",
    action_config: { title_template: "ESCALATED: {issue} (open {days}+ days)" },
    icon: "alert",
    color: "#ef4444",
  },
  {
    name: "Fuel efficiency monitor",
    description: "Reports an issue when a vehicle's fuel efficiency drops 20% vs its history.",
    trigger_type: "fuel_efficiency",
    trigger_config: { drop_percent: 20, lookback_days: 30 },
    action_type: "create_issue",
    action_config: { title_template: "Fuel efficiency dropped {pct}% on {vehicle}", severity: "Medium" },
    icon: "fuel",
    color: "#a855f7",
  },
];

let ORG_ID = null;

// ── toast ──────────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, tone) {
  let el = document.getElementById("fwToast");
  if (!el) { el = document.createElement("div"); el.id = "fwToast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = tone || "ok";
  void el.offsetHeight;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

// ── render rules list ──────────────────────────────────────────────────────
function renderRules(rules) {
  const box = document.getElementById("autoRulesList");
  if (!rules.length) {
    box.innerHTML = `<p class="muted" style="text-align:center;padding:24px">No active automation rules yet — add one above or pick a template below.</p>`;
    return;
  }
  box.innerHTML = rules.map(r => {
    const lastRun = r.last_run_at ? new Date(r.last_run_at).toLocaleString("en-IN") : "Never";
    const statusDot = !r.last_run_status || r.last_run_status === "ok"
      ? `<span class="fw-badge ok" style="font-size:0.7rem">OK</span>`
      : `<span class="fw-badge overdue" style="font-size:0.7rem">${r.last_run_status}</span>`;
    return `
    <div class="auto-rule-card" id="rule-${r.id}">
      <div class="auto-rule-head">
        <span class="ic-tile brand"><i data-icon="${TRIGGER_ICONS[r.trigger_type] || 'gear'}" data-icon-size="16"></i></span>
        <div class="auto-rule-meta">
          <strong>${esc(r.name)}</strong>
          <span class="muted" style="font-size:0.78rem">${esc(TRIGGER_LABELS[r.trigger_type] || r.trigger_type)} → ${esc(ACTION_LABELS[r.action_type] || r.action_type)}</span>
        </div>
        <div class="auto-rule-actions">
          <label class="auto-toggle" title="${r.enabled ? 'Enabled — click to pause' : 'Paused — click to enable'}">
            <input type="checkbox" ${r.enabled ? "checked" : ""} onchange="toggleRule('${r.id}', this.checked)" />
            <span class="auto-toggle-track"></span>
          </label>
          <button class="link-btn" onclick="deleteRule('${r.id}')" title="Delete rule" style="color:#ef4444;font-size:0.8rem">✕</button>
        </div>
      </div>
      <p class="muted" style="font-size:0.78rem;margin:4px 0 0 40px">${r.description ? esc(r.description) : ""}</p>
      <div class="auto-rule-foot">
        <span class="muted" style="font-size:0.73rem">Last run: ${lastRun} · Ran ${r.run_count || 0}×</span>
        ${statusDot}
      </div>
    </div>`;
  }).join("");
  if (window.FWIcons) FWIcons.hydrate(box);
}

// ── render run history ─────────────────────────────────────────────────────
function renderHistory(runs) {
  const box = document.getElementById("autoHistory");
  if (!runs.length) {
    box.innerHTML = `<p class="muted" style="text-align:center;padding:16px;font-size:0.82rem">No runs yet — click "Run All Now" to trigger the engine.</p>`;
    return;
  }
  box.innerHTML = `<table class="auto-hist-table">
    <thead><tr><th>Rule</th><th>Ran at</th><th>Actions</th><th>Status</th></tr></thead>
    <tbody>${runs.map(r => `<tr>
      <td>${esc(r.rule_name || "—")}</td>
      <td style="white-space:nowrap">${new Date(r.triggered_at).toLocaleString("en-IN")}</td>
      <td style="text-align:center">${r.actions_taken}</td>
      <td><span class="fw-badge ${r.status === "ok" ? "ok" : "overdue"}">${esc(r.status)}</span></td>
    </tr>`).join("")}</tbody>
  </table>`;
}

// ── load data ──────────────────────────────────────────────────────────────
async function loadRules() {
  const rules = await fwCloud.authGet("automation_rules", "select=*&order=created_at.desc") || [];
  renderRules(rules);
  return rules;
}

async function loadHistory() {
  const runs = await fwCloud.authGet("automation_runs", "select=*&order=triggered_at.desc&limit=40") || [];
  renderHistory(runs);
}

// ── toggle rule enabled ────────────────────────────────────────────────────
window.toggleRule = async function(id, enabled) {
  await fwCloud.authPatch(`automation_rules?id=eq.${id}`, { enabled });
  toast(enabled ? "Rule enabled." : "Rule paused.");
};

// ── delete rule ────────────────────────────────────────────────────────────
window.deleteRule = async function(id) {
  if (!confirm("Delete this automation rule?")) return;
  const ok = await fwCloud.authDelete("automation_rules", `id=eq.${id}`);
  if (ok) { toast("Rule deleted."); loadRules(); }
  else toast("Could not delete — try again.", "warn");
};

// ── save rule (from intent parse result or template) ──────────────────────
async function saveRule(ruleData) {
  const row = {
    org_id: ORG_ID,
    name: ruleData.name,
    description: ruleData.description || null,
    intent_text: ruleData.intent_text || null,
    trigger_type: ruleData.trigger_type,
    trigger_config: ruleData.trigger_config || {},
    action_type: ruleData.action_type,
    action_config: ruleData.action_config || {},
    enabled: true,
    created_by: fwCloud.uid(),
  };
  const ok = await fwCloud.authInsert("automation_rules", row);
  if (ok) { toast(`"${ruleData.name}" added.`); loadRules(); }
  else toast("Could not save rule — check your access.", "warn");
  return ok;
}

// ── template cards ─────────────────────────────────────────────────────────
function renderTemplates() {
  const box = document.getElementById("autoTemplates");
  box.innerHTML = TEMPLATES.map((t, i) => `
    <div class="auto-tmpl-card" onclick="useTemplate(${i})">
      <span class="ic-tile" style="background:${t.color}22;border-color:${t.color}44"><i data-icon="${t.icon}" data-icon-size="18" style="color:${t.color}"></i></span>
      <div>
        <strong style="font-size:0.88rem">${esc(t.name)}</strong>
        <p class="muted" style="font-size:0.75rem;margin:2px 0 0">${esc(t.description)}</p>
      </div>
    </div>`).join("");
  if (window.FWIcons) FWIcons.hydrate(box);
}

window.useTemplate = async function(idx) {
  const t = TEMPLATES[idx];
  const name = prompt(`Rule name:`, t.name);
  if (name === null) return;
  await saveRule({ ...t, name: name.trim() || t.name });
};

// ── intent parsing ─────────────────────────────────────────────────────────
const intentInput = document.getElementById("autoIntentInput");
const intentBtn   = document.getElementById("autoIntentBtn");
const intentErr   = document.getElementById("autoIntentErr");
const intentPreview = document.getElementById("autoIntentPreview");

async function parseIntent() {
  const text = (intentInput.value || "").trim();
  if (!text) { intentErr.textContent = "Describe what you want to automate first."; intentErr.hidden = false; return; }
  intentErr.hidden = true;
  intentPreview.hidden = true;
  intentBtn.disabled = true;
  intentBtn.textContent = "Thinking…";

  try {
    const result = await fwCloud.callFunction("automation-intent", { intent: text });
    if (!result) throw new Error("No response from AI.");
    if (result.ambiguous || result.error) {
      intentErr.textContent = result.message || result.error || "Could not understand — try rephrasing.";
      intentErr.hidden = false;
      return;
    }
    const rule = result.rule;
    // Show preview and confirm
    document.getElementById("autoPreviewName").textContent = rule.name || "";
    document.getElementById("autoPreviewDesc").textContent = rule.description || "";
    document.getElementById("autoPreviewTrigger").textContent =
      (TRIGGER_LABELS[rule.trigger_type] || rule.trigger_type) + " — " + JSON.stringify(rule.trigger_config);
    document.getElementById("autoPreviewAction").textContent =
      (ACTION_LABELS[rule.action_type] || rule.action_type) + " — " + JSON.stringify(rule.action_config);
    intentPreview.hidden = false;
    intentPreview._pendingRule = rule;
  } catch (e) {
    intentErr.textContent = e.message || "Something went wrong — try again.";
    intentErr.hidden = false;
  } finally {
    intentBtn.disabled = false;
    intentBtn.innerHTML = '<i data-icon="zap" data-icon-size="14"></i> Build Rule';
    if (window.FWIcons) FWIcons.hydrate(intentBtn);
  }
}

intentBtn.addEventListener("click", parseIntent);
intentInput.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); parseIntent(); }});

document.getElementById("autoPreviewSave").addEventListener("click", async () => {
  const rule = intentPreview._pendingRule;
  if (!rule) return;
  const ok = await saveRule(rule);
  if (ok) { intentInput.value = ""; intentPreview.hidden = true; }
});

document.getElementById("autoPreviewDiscard").addEventListener("click", () => {
  intentPreview.hidden = true;
  intentPreview._pendingRule = null;
});

// ── run all now ────────────────────────────────────────────────────────────
document.getElementById("autoRunNowBtn").addEventListener("click", async function() {
  this.disabled = true;
  this.textContent = "Running…";
  try {
    const result = await fwCloud.callFunction("automation-run", {});
    if (result?.ok) {
      const n = result.rules_evaluated || 0;
      const a = (result.summary || []).reduce((s, r) => s + (r.actions || 0), 0);
      toast(`Ran ${n} rule(s) — ${a} action(s) taken.`);
      loadRules();
      loadHistory();
    } else {
      toast(result?.error || "Run failed — check logs.", "warn");
    }
  } catch (e) {
    toast(e.message || "Run failed.", "warn");
  } finally {
    this.disabled = false;
    this.textContent = "Run All Now";
  }
});

// ── auth + init ────────────────────────────────────────────────────────────
function esc(s) { return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

async function init() {
  const uid = fwCloud.uid();
  if (!uid) { window.location.href = "fleet.html"; return; }

  const mem = await fwCloud.authGet("memberships", `select=org_id,role&user_id=eq.${uid}&limit=1`);
  const m = mem && mem[0];
  if (!m || !["owner","manager"].includes(m.role)) {
    document.getElementById("autoAccessDenied").hidden = false;
    document.getElementById("autoApp").hidden = true;
    return;
  }
  ORG_ID = m.org_id;

  renderTemplates();
  await Promise.all([loadRules(), loadHistory()]);
}

if (window.fwCloud && fwCloud.user()) init();
