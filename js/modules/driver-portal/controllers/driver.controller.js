/* ============ FleetWorks — driver-portal/controllers/driver ============
   No-login driver page UI controller. The owner generates a Driver Link
   (fleet.html → Drivers → Copy link) that carries owner id, a
   per-driver token, the driver's name, assigned vehicle and vehicle id.
   Entries are posted to the driver_entries table (anon role). */

"use strict";

const qs = new URLSearchParams(location.search);
const OWNER = qs.get("o"), TOKEN = qs.get("t");
const DNAME = qs.get("n") || "Driver", DVEH = qs.get("v") || "";
const DVID  = qs.get("vid") || "";
const DRIVER_CTX = { ownerId: OWNER, token: TOKEN, driverName: DNAME, vehicleName: DVEH };

document.getElementById("drvName").textContent = DNAME;
document.getElementById("drvVeh").textContent = DVEH ? "வாகனம்: " + DVEH : "வாகனம் ஒதுக்கப்படவில்லை";

if (!OWNER || !TOKEN || !DVEH) {
  document.getElementById("drvApp").hidden = true;
  document.getElementById("drvInvalid").hidden = false;
}

// ---------- Tabs ----------
document.getElementById("drvTabs").addEventListener("click", e => {
  const btn = e.target.closest(".tab-btn");
  if (!btn || !btn.dataset.tab) return;
  document.querySelectorAll("#drvTabs .tab-btn").forEach(b => b.classList.toggle("active", b === btn));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "dtab-" + btn.dataset.tab));
});

// ---------- Inspection checklist ----------
const CHECK_ITEMS = [
  { id: "safety_belts",    label: "பாதுகாப்பு பட்டை",         icon: "shieldCheck" },
  { id: "brakes",          label: "பிரேக் & ஸ்டீயரிங்",       icon: "wrench"      },
  { id: "engine",          label: "என்ஜின்",                  icon: "engine"      },
  { id: "transmission",    label: "கியர் பெட்டி",             icon: "settings"    },
  { id: "grease",          label: "கிரீஸ் பேக்கிங்",          icon: "tools"       },
  { id: "wipers",          label: "வைப்பர்கள்",               icon: "droplet"     },
  { id: "headlight_high",  label: "ஹெட் லைட் — ஹை பீம்",     icon: "zap"         },
  { id: "headlight_low",   label: "ஹெட் லைட் — லோ பீம்",     icon: "zap"         },
  { id: "turn_signals",    label: "திருப்பு சமிக்ஞை",         icon: "alert"       },
  { id: "brake_lights",    label: "பிரேக் விளக்குகள்",        icon: "alert"       },
  { id: "doors",           label: "கதவுகள்",                  icon: "truck"       },
  { id: "windows",         label: "ஜன்னல்கள்",                icon: "eye"         },
  { id: "radio",           label: "ரேடியோ",                   icon: "chat"        },
  { id: "horn",            label: "ஹார்ன்",                   icon: "bell"        },
  { id: "tyre",            label: "டயர்",                     icon: "tire"        },
  { id: "coolant",         label: "கூலண்ட் அளவு",            icon: "droplet"     },
  { id: "battery",         label: "பேட்டரி & டெர்மினல்கள்",  icon: "battery"     },
  { id: "documents",       label: "கேபினில் ஆவணங்கள்",       icon: "document"    },
];

function buildCheckTable() {
  const tbody = document.getElementById("dCheckList");
  if (!tbody) return;
  tbody.innerHTML = CHECK_ITEMS.map(item => `
    <tr class="chk-row" id="crow_${item.id}">
      <td class="chk-item-cell">
        <div class="chk-item-inner">
          <i data-icon="${item.icon}" data-icon-size="15"></i>
          <span>${item.label}</span>
        </div>
      </td>
      <td class="chk-radio-cell">
        <input class="chk-radio chk-ok-radio" type="radio" name="chk_${item.id}" value="ok" checked
          onchange="updateCheckRow('${item.id}',this)" />
      </td>
      <td class="chk-radio-cell">
        <input class="chk-radio chk-notok-radio" type="radio" name="chk_${item.id}" value="notok"
          onchange="updateCheckRow('${item.id}',this)" />
      </td>
      <td class="chk-rem-cell">
        <input class="chk-rem-input" type="text" name="rem_${item.id}" placeholder="குறிப்பு…" />
      </td>
    </tr>`).join("");
  if (window.FWIcon) document.querySelectorAll("#dCheckList [data-icon]").forEach(el => {
    el.innerHTML = FWIcon(el.dataset.icon, { size: 15 });
  });
  updateScore();
}

window.updateCheckRow = function(itemId, radio) {
  const row = document.getElementById("crow_" + itemId);
  if (!row) return;
  row.classList.toggle("row-notok", radio.value === "notok");
  updateScore();
};

function updateScore() {
  const total = CHECK_ITEMS.length;
  const passed = CHECK_ITEMS.filter(item => {
    const el = document.querySelector(`input[name="chk_${item.id}"]:checked`);
    return el && el.value === "ok";
  }).length;
  const el = document.getElementById("dCheckScore");
  if (el) el.textContent = passed + "/" + total;
}

buildCheckTable();

// ---------- Trip Status milestones ----------
const TRIP_MILESTONES = [
  { section: "ஏற்றுமதி",   id: "picked_vehicle",     label: "வாகனம் எடுக்கப்பட்டது"        },
  { section: "ஏற்றுமதி",   id: "reached_loading",    label: "ஏற்றுமதி இடம் வந்தோம்"       },
  { section: "ஏற்றுமதி",   id: "loading_started",    label: "ஏற்றுமதி தொடங்கியது"         },
  { section: "ஏற்றுமதி",   id: "contacted_client",   label: "கிளையண்டை தொடர்பு கொண்டோம்" },
  { section: "ஏற்றுமதி",   id: "loading_time",       label: "ஏற்றுமதி நேரம்", isTime: true },
  { section: "ஏற்றுமதி",   id: "loading_complete",   label: "ஏற்றுமதி முடிந்தது"          },
  { section: "பயணத்தில்", id: "left_loading",       label: "ஏற்றுமதி இடம் விட்டுச் சென்றோம்" },
  { section: "இறக்குமதி", id: "reached_unloading",  label: "இறக்குமதி இடம் வந்தோம்"      },
  { section: "இறக்குமதி", id: "unloading_started",  label: "இறக்குமதி தொடங்கியது"        },
  { section: "இறக்குமதி", id: "unloading_complete", label: "இறக்குமதி முடிந்தது"         },
  { section: "பயணம்",     id: "trip_complete",      label: "பயணம் முடிந்தது"             },
];

function buildTripPanel() {
  const el = document.getElementById("dTripPanel");
  if (!el) return;

  // Active trip header card
  const tripCard = `
    <div class="trip-active-card" id="tripActiveCard">
      <div class="trip-active-veh">
        <i data-icon="truck" data-icon-size="20"></i>
        <span>${DVEH}</span>
      </div>
      <div class="trip-route-row" id="tripRouteDisplay" hidden>
        <span class="trip-route-from" id="tripFrom"></span>
        <i data-icon="chevronRight" data-icon-size="16" style="flex:none;opacity:0.6"></i>
        <span class="trip-route-to" id="tripTo"></span>
      </div>
      <div class="trip-route-inputs" id="tripRouteInputs">
        <input type="text" id="tripFromInput" placeholder="இருந்து (ஏற்றுமதி இடம்)" class="trip-route-input" />
        <i data-icon="chevronRight" data-icon-size="16" style="flex:none;opacity:0.5"></i>
        <input type="text" id="tripToInput" placeholder="செல்ல (டெலிவரி இடம்)" class="trip-route-input" />
        <button class="trip-btn trip-btn-y" onclick="setTripRoute()" style="flex:none;padding:5px 10px;font-size:0.8rem">சேமி</button>
      </div>
      <div class="trip-quick-btns">
        <button class="trip-quick-btn sos" onclick="sendSOSAttention()"><i data-icon="sos" data-icon-size="16"></i> SOS / உதவி</button>
        <button class="trip-quick-btn fuel" onclick="document.querySelector('.tab-btn[data-tab=fuel]').click()"><i data-icon="fuel" data-icon-size="16"></i> டீசல் நிரப்பு</button>
        <button class="trip-quick-btn check" onclick="document.querySelector('.tab-btn[data-tab=check]').click()"><i data-icon="clipboardCheck" data-icon-size="16"></i> ஆய்வு பட்டியல்</button>
        <button class="trip-quick-btn location" id="locToggleBtn" onclick="toggleLocationTracking()"><i data-icon="mapPin" data-icon-size="16"></i> இடம் பகிர்</button>
      </div>
      <div class="loc-status off" id="locStatus" hidden></div>
    </div>`;

  const sections = [...new Set(TRIP_MILESTONES.map(m => m.section))];
  let num = 0;
  const milestoneHtml = sections.map(sec => {
    const items = TRIP_MILESTONES.filter(m => m.section === sec);
    return `<div class="trip-section">
      <div class="trip-section-label">${sec}</div>
      ${items.map(m => {
        num++;
        if (m.isTime) return `
          <div class="trip-time-row" id="trow_${m.id}">
            <label>
              <span class="trip-ms-num">${num}</span>
              <span style="flex:1;font-weight:500;color:var(--navy)">${m.label}</span>
              <input type="time" id="tinput_${m.id}" style="border:1px solid var(--border);border-radius:8px;padding:4px 8px;font-size:0.82rem;font-family:inherit" />
              <button class="trip-btn trip-btn-y" style="flex:none" onclick="sendTripTime('${m.id}')">பதிவு</button>
            </label>
          </div>`;
        return `
          <div class="trip-milestone" id="trow_${m.id}">
            <span class="trip-ms-num">${num}</span>
            <span class="trip-ms-text">${m.label}</span>
            <div class="trip-btns">
              <button class="trip-btn trip-btn-y" onclick="sendTripMilestone('${m.id}','yes',this)">✓ ஆம்</button>
              <button class="trip-btn trip-btn-n" onclick="sendTripMilestone('${m.id}','no',this)">✗ இல்லை</button>
            </div>
            <span class="trip-ms-time" id="ttime_${m.id}" hidden></span>
          </div>`;
      }).join("")}
    </div>`;
  }).join("");

  el.innerHTML = tripCard + milestoneHtml;
  if (window.FWIcon) el.querySelectorAll("[data-icon]").forEach(i => { i.innerHTML = FWIcon(i.dataset.icon, { size: parseInt(i.dataset.iconSize || 16) }); });
}

window.setTripRoute = function() {
  const from = document.getElementById("tripFromInput")?.value.trim();
  const to   = document.getElementById("tripToInput")?.value.trim();
  if (!from || !to) return;
  document.getElementById("tripFromInput").closest(".trip-route-inputs").setAttribute("hidden", "");
  const disp = document.getElementById("tripRouteDisplay");
  document.getElementById("tripFrom").textContent = from;
  document.getElementById("tripTo").textContent = to;
  disp.removeAttribute("hidden");
  send("trip_status", { milestone: "trip_route", from, to, timestamp: new Date().toISOString() }).catch(() => {});
};

window.sendSOSAttention = async function() {
  const btn = document.querySelector(".trip-quick-btn.sos");
  if (btn) btn.disabled = true;
  try {
    await send("sos", { message: "டிரைவர் உதவி தேவை / SOS", timestamp: new Date().toISOString(), vehicle: DVEH });
    flash(true, "SOS அனுப்பப்பட்டது — உரிமையாளருக்கு அறிவிக்கப்பட்டது!");
  } catch {
    flash(false, "SOS அனுப்ப முடியவில்லை — இணையதளம் சரிபார்க்கவும்.");
  }
  if (btn) btn.disabled = false;
};

// ---------- Location tracking (GPS via browser, sends every 60s) ----------
let _locInterval = null;
let _locWatchId  = null;
let _lastCoords  = null;

window.toggleLocationTracking = function() {
  if (_locInterval) {
    stopLocationTracking();
  } else {
    startLocationTracking();
  }
};

function startLocationTracking() {
  if (!navigator.geolocation) {
    flash(false, "இந்த சாதனத்தில் GPS கிடைக்கவில்லை.");
    return;
  }
  const btn = document.getElementById("locToggleBtn");
  const statusEl = document.getElementById("locStatus");
  if (btn) { btn.classList.add("active"); btn.innerHTML = (window.FWIcon ? FWIcon("mapPin",{size:16}) : "") + " இடம் பகிர்கிறது"; }
  if (statusEl) { statusEl.removeAttribute("hidden"); statusEl.className = "loc-status tracking"; statusEl.textContent = "📍 இடம் கண்டறிகிறது…"; }

  navigator.geolocation.getCurrentPosition(pos => {
    _lastCoords = pos.coords;
    sendLocation(pos.coords);
    if (statusEl) statusEl.textContent = "📍 நேரலை இடம் பகிர்கிறது — 60 நொடிக்கு ஒரு முறை புதுப்பிக்கும்";
  }, err => {
    if (statusEl) { statusEl.className = "loc-status off"; statusEl.textContent = "GPS error: " + err.message; }
  }, { enableHighAccuracy: true, timeout: 15000 });

  // send every 60 seconds
  _locInterval = setInterval(() => {
    navigator.geolocation.getCurrentPosition(pos => {
      _lastCoords = pos.coords;
      sendLocation(pos.coords);
      if (statusEl) statusEl.textContent = "📍 இடம் " + new Date().toLocaleTimeString("ta-IN", { hour: "2-digit", minute: "2-digit" }) + " மணிக்கு பகிரப்பட்டது";
    }, () => {}, { enableHighAccuracy: false, timeout: 10000 });
  }, 60000);
}

function stopLocationTracking() {
  clearInterval(_locInterval);
  _locInterval = null;
  const btn = document.getElementById("locToggleBtn");
  const statusEl = document.getElementById("locStatus");
  if (btn) { btn.classList.remove("active"); btn.innerHTML = (window.FWIcon ? FWIcon("mapPin",{size:16}) : "") + " இடம் பகிர்"; }
  if (statusEl) { statusEl.className = "loc-status off"; statusEl.setAttribute("hidden",""); }
}

async function sendLocation(coords) {
  try {
    await send("location", {
      lat: coords.latitude,
      lng: coords.longitude,
      accuracy: Math.round(coords.accuracy),
      timestamp: new Date().toISOString(),
      vehicle: DVEH
    });
  } catch { /* silent — location updates are best-effort */ }
}

window.sendTripMilestone = async function(milestoneId, value, btn) {
  const row = document.getElementById("trow_" + milestoneId);
  const timeEl = document.getElementById("ttime_" + milestoneId);
  const allBtns = row.querySelectorAll(".trip-btn");
  allBtns.forEach(b => b.disabled = true);
  try {
    const now = new Date();
    await send("trip_status", { milestone: milestoneId, value, timestamp: now.toISOString() });
    row.classList.remove("ms-yes", "ms-no");
    row.classList.add(value === "yes" ? "ms-yes" : "ms-no");
    if (timeEl) {
      timeEl.textContent = (value === "yes" ? "✓ " : "✗ ") + now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      timeEl.className = "trip-ms-time" + (value === "yes" ? "" : " no");
      timeEl.removeAttribute("hidden");
    }
  } catch {
    allBtns.forEach(b => b.disabled = false);
    flash(false, "அனுப்ப முடியவில்லை — இணையதளம் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.");
  }
};

window.sendTripTime = async function(milestoneId) {
  const input = document.getElementById("tinput_" + milestoneId);
  const row = document.getElementById("trow_" + milestoneId);
  const logBtn = row.querySelector("button");
  if (!input.value) { input.focus(); return; }
  logBtn.disabled = true;
  try {
    await send("trip_status", { milestone: milestoneId, value: input.value, timestamp: new Date().toISOString() });
    row.style.background = "#e7faea";
    logBtn.textContent = "✓ பதிவானது";
  } catch {
    logBtn.disabled = false;
    flash(false, "அனுப்ப முடியவில்லை — இணையதளம் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.");
  }
};

buildTripPanel();

// ---------- Documents tab ----------
const DOC_FIELDS = [
  { key: "fc_due",             label: "ஃபிட்னஸ் சான்றிதழ் (FC)",  isDate: true },
  { key: "national_permit_no", label: "தேசிய அனுமதி எண்"           },
  { key: "state_permit_no",    label: "மாநில அனுமதி எண்"           },
  { key: "road_tax_due",       label: "சாலை வரி காலாவதி",          isDate: true },
  { key: "goods_permit_due",   label: "சரக்கு அனுமதி காலாவதி",    isDate: true },
  { key: "puc_due",            label: "மாசு சான்றிதழ் (PUC)",      isDate: true },
  { key: "insurance_no",       label: "காப்பீடு பாலிசி எண்"        },
  { key: "insurance_due",      label: "காப்பீடு காலாவதி",          isDate: true },
  { key: "permit_no",          label: "அனுமதி எண்"                 },
];

function expiryBadge(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr), now = new Date();
  const days = Math.round((d - now) / 86400000);
  if (days < 0)  return `<span class="doc-badge exp">காலாவதியானது</span>`;
  if (days < 30) return `<span class="doc-badge warn">${days} நாளில் காலாவதி</span>`;
  return `<span class="doc-badge ok">செல்லுபடியாகும்</span>`;
}

async function buildDocsPanel() {
  const el = document.getElementById("dDocsPanel");
  if (!el) return;

  el.innerHTML = `<div class="doc-empty"><i data-icon="document" data-icon-size="32"></i>ஆவணங்கள் ஏற்றுகிறது…</div>`;

  // Vehicle ID card always shown
  const vehCard = `<div class="doc-card">
    <div class="doc-card-head"><i data-icon="truck" data-icon-size="16"></i>&nbsp;${DVEH || "வாகனம்"}</div>
    <div class="doc-row"><span class="doc-row-label">டிரைவர்</span><span class="doc-row-val">${DNAME}</span></div>
    <div class="doc-row"><span class="doc-row-label">தேதி</span><span class="doc-row-val">${new Date().toLocaleDateString("ta-IN",{day:"2-digit",month:"short",year:"numeric"})}</span></div>
  </div>`;

  if (!DVID) {
    el.innerHTML = vehCard + `<div class="doc-empty">
      <i data-icon="document" data-icon-size="28"></i>
      உங்கள் வாகன உரிமையாளரிடம் புதிய டிரைவர் இணைப்பு கேட்கவும் — ஆவண விவரங்கள் இங்கே தெரியும்.
    </div>`;
    if (window.FWIcon) el.querySelectorAll("[data-icon]").forEach(i => { i.innerHTML = FWIcon(i.dataset.icon, { size: parseInt(i.dataset.iconSize || 16) }); });
    return;
  }

  try {
    const res = await fetch(FW_BACKEND.url + "/rest/v1/vehicles?select=reg_no,compliance,permit_no,insurance_no,national_permit_no,state_permit_no&id=eq." + DVID, {
      headers: { "apikey": FW_BACKEND.anonKey }
    });
    if (!res.ok) throw new Error();
    const rows = await res.json();
    const veh = rows[0] || {};
    const comp = veh.compliance || {};

    const docRows = DOC_FIELDS.map(f => {
      const val = veh[f.key] || comp[f.key];
      if (!val) return "";
      return `<div class="doc-row">
        <span class="doc-row-label">${f.label}</span>
        <span class="doc-row-val">${val}${f.isDate ? "&nbsp;" + expiryBadge(val) : ""}</span>
      </div>`;
    }).filter(Boolean).join("");

    el.innerHTML = vehCard + (docRows ? `<div class="doc-card">
      <div class="doc-card-head"><i data-icon="shieldCheck" data-icon-size="16"></i>&nbsp;இணக்க ஆவணங்கள்</div>
      ${docRows}
    </div>` : `<div class="doc-empty">ஆவண விவரங்கள் இல்லை. உங்கள் வாகன உரிமையாளரிடம் FleetWorks-ல் வாகன தகவல்களை நிரப்பச் சொல்லுங்கள்.</div>`);
  } catch {
    el.innerHTML = vehCard + `<div class="doc-empty">ஆவணங்கள் ஏற்ற முடியவில்லை — இணையதளம் சரிபார்க்கவும்.</div>`;
  }

  if (window.FWIcon) el.querySelectorAll("[data-icon]").forEach(i => { i.innerHTML = FWIcon(i.dataset.icon, { size: parseInt(i.dataset.iconSize || 16) }); });
}

buildDocsPanel();

// ---------- Default dates to today ----------
document.querySelectorAll('input[name="date"]').forEach(i => { i.value = new Date().toISOString().slice(0, 10); });

// ---------- Send ----------
async function send(kind, payload) {
  if (window.FWDriverPortal) return FWDriverPortal.submitEntry({ context: DRIVER_CTX, kind, payload });
  const r = await fetch(FW_BACKEND.url + "/rest/v1/driver_entries", {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": FW_BACKEND.anonKey, "Prefer": "return=minimal" },
    body: JSON.stringify({ owner_id: OWNER, token: TOKEN, driver_name: DNAME, vehicle_name: DVEH, kind, payload })
  });
  if (!r.ok) throw new Error();
}

const status = document.getElementById("drvStatus");
function flash(ok, msg) {
  status.hidden = false;
  status.textContent = msg;
  status.style.color = ok ? "#0ca30c" : "#d03b3b";
  setTimeout(() => { status.hidden = true; }, 6000);
}

async function handle(form, kind, payload) {
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    await send(kind, payload);
    form.reset();
    document.querySelectorAll('input[name="date"]').forEach(i => { i.value = new Date().toISOString().slice(0, 10); });
    // reset checklist radios to OK
    CHECK_ITEMS.forEach(item => {
      const ok = document.querySelector(`input[name="chk_${item.id}"][value="ok"]`);
      if (ok) ok.checked = true;
      const row = document.getElementById("crow_" + item.id);
      if (row) row.classList.remove("row-notok");
    });
    updateScore();
    flash(true, "அனுப்பப்பட்டது ✓ — உரிமையாளர் டேஷ்போர்டில் சேர்க்கப்பட்டது.");
  } catch {
    flash(false, "அனுப்ப முடியவில்லை — இணையதளம் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.");
  }
  btn.disabled = false;
}

document.getElementById("dFuelForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  handle(e.target, "fuel", { litres: +fd.litres, amount: +fd.amount, odo: +fd.odo, date: fd.date });
});

document.getElementById("dIssForm").addEventListener("submit", e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  handle(e.target, "issue", { title: fd.title.trim(), severity: fd.severity });
});

document.getElementById("dCheckForm").addEventListener("submit", e => {
  e.preventDefault();
  const results = CHECK_ITEMS.map(item => {
    const checked = document.querySelector(`input[name="chk_${item.id}"]:checked`);
    const rem = document.querySelector(`input[name="rem_${item.id}"]`);
    return { id: item.id, item: item.label, ok: checked ? checked.value === "ok" : true, remarks: rem ? rem.value.trim() : "" };
  });
  const passed = results.filter(r => r.ok).length;
  const odo = e.target.querySelector('[name="odo"]');
  handle(e.target, "inspection", {
    results, passed, total: CHECK_ITEMS.length,
    score: +(passed / CHECK_ITEMS.length * 10).toFixed(1),
    odo: odo ? (+odo.value || 0) : 0,
    date: new Date().toISOString().slice(0, 10)
  });
});
