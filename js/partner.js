/* ============ FleetWorks — partner.js (vendor onboarding) ============ */

// The floating fleet-sync pill (cloudstore.js) doesn't apply to partners —
// they have no fleet data to sync. Remove it on this page only.
document.getElementById("fwSyncPill")?.remove();

// ---------- Navbar ----------
const navbar = document.getElementById("navbar");
const hamburger = document.getElementById("hamburger");
const navLinks = document.getElementById("navLinks");

window.addEventListener("scroll", () => {
  navbar.classList.toggle("scrolled", window.scrollY > 10);
});
hamburger.addEventListener("click", () => navLinks.classList.toggle("open"));
navLinks.querySelectorAll("a").forEach((a) =>
  a.addEventListener("click", () => navLinks.classList.remove("open"))
);

// ---------- Multi-step form ----------
const vendorForm = document.getElementById("vendorForm");
const steps = [...vendorForm.querySelectorAll(".form-step")];
const stepperItems = [...document.querySelectorAll(".stepper-item")];
let currentStep = 1;

function showStep(n) {
  currentStep = n;
  steps.forEach((s) => s.classList.toggle("active", +s.dataset.step === n));
  stepperItems.forEach((item) => {
    const step = +item.dataset.step;
    item.classList.toggle("active", step === n);
    item.classList.toggle("done", step < n);
  });
  document.getElementById("onboardCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Validation ----------
const validators = {
  phone: (v) => /^[6-9]\d{9}$/.test(v),
  pincode: (v) => /^[1-9]\d{5}$/.test(v),
  pan: (v) => /^[A-Z]{5}\d{4}[A-Z]$/.test(v.toUpperCase()),
  gstin: (v) => v === "" || /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]{3}$/.test(v.toUpperCase()),
  email: (v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
};

function validateStep(n) {
  const step = steps.find((s) => +s.dataset.step === n);
  let valid = true;

  step.querySelectorAll("input[required]:not([type=checkbox]), select[required], textarea[required]").forEach((field) => {
    const value = field.value.trim();
    let ok = value !== "";
    if (ok && validators[field.name]) ok = validators[field.name](value);
    field.classList.toggle("invalid", !ok);
    if (!ok) valid = false;
  });

  // GSTIN stays genuinely optional (no [required] attribute), so it needs
  // its own format check independent of the required-fields loop above.
  // Email is now required and is fully covered by that loop already.
  step.querySelectorAll("input[name=gstin]").forEach((field) => {
    const ok = validators.gstin(field.value.trim());
    field.classList.toggle("invalid", !ok);
    if (!ok) valid = false;
  });

  // Step 2: at least one service + one vehicle type
  if (n === 2) {
    const servicesOk = step.querySelectorAll('input[name="services"]:checked').length > 0;
    const vehiclesOk = step.querySelectorAll('input[name="vehicles"]:checked').length > 0;
    document.getElementById("servicesError").hidden = servicesOk;
    document.getElementById("vehiclesError").hidden = vehiclesOk;
    if (!servicesOk || !vehiclesOk) valid = false;
  }

  // Step 3: consent + password match
  if (n === 3) {
    const consentOk = step.querySelector('input[name="consent"]').checked;
    document.getElementById("consentError").hidden = consentOk;
    if (!consentOk) valid = false;

    const pw = step.querySelector('input[name="password"]');
    const pwc = step.querySelector('input[name="passwordConfirm"]');
    const pwOk = pw.value.length >= 6 && pw.value === pwc.value;
    pw.classList.toggle("invalid", pw.value.length < 6);
    pwc.classList.toggle("invalid", !pwOk);
    document.getElementById("passwordError").hidden = pwOk;
    if (!pwOk) valid = false;
  }

  return valid;
}

vendorForm.addEventListener("click", (e) => {
  if (e.target.dataset.next) {
    if (validateStep(currentStep)) showStep(+e.target.dataset.next);
  } else if (e.target.dataset.prev) {
    showStep(+e.target.dataset.prev);
  }
});

// Live cleanup of error states
vendorForm.addEventListener("input", (e) => {
  e.target.classList.remove("invalid");
  if (e.target.name === "services") document.getElementById("servicesError").hidden = true;
  if (e.target.name === "vehicles") document.getElementById("vehiclesError").hidden = true;
  if (e.target.name === "consent") document.getElementById("consentError").hidden = true;
});

// Input shaping
vendorForm.elements.phone.addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10);
});
vendorForm.elements.pincode.addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
});
["pan", "gstin"].forEach((name) => {
  vendorForm.elements[name].addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
});

// ---------- Submission ----------
function makeVendorRef() {
  return "FWV-" + Date.now().toString(36).toUpperCase().slice(-6);
}

function getVendors() {
  return JSON.parse(localStorage.getItem("ff_vendors") || "[]");
}

vendorForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validateStep(3)) return;

  const submitBtn = vendorForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting…";

  const fd = new FormData(vendorForm);
  const data = Object.fromEntries(fd);
  data.services = fd.getAll("services");
  data.vehicles = fd.getAll("vehicles");
  data.documents = [...vendorForm.elements.documents.files].map((f) => f.name);
  data.ref = makeVendorRef();
  data.status = "Under Review";
  data.createdAt = new Date().toISOString();
  delete data.consent;
  const password = data.password;
  delete data.password;
  delete data.passwordConfirm;

  // Local copy (offline safety) + cloud insert via Supabase when configured.
  const vendors = getVendors();
  vendors.push(data);
  localStorage.setItem("ff_vendors", JSON.stringify(vendors));

  // Account creation: if Supabase requires email confirmation, there's no
  // session yet and owner_id stays null for now — the sign-in flow's
  // claim fallback links it up the first time they successfully log in
  // (matched by verified email, see db/schema-roles.sql).
  let ownerId = null;
  let needsEmailConfirm = false;
  if (window.fwCloud && password) {
    try {
      const res = await fwCloud.signup(data.email, password, {
        role: "partner", business_name: data.businessName, phone: data.phone
      });
      if (res === "ready") {
        const session = JSON.parse(localStorage.getItem("fw_session") || "null");
        ownerId = session?.user?.id || null;
      } else {
        needsEmailConfirm = true;
      }
    } catch (ex) {
      // Account creation failed (e.g. email already registered under a
      // different application) — the application itself still goes
      // through; they can sign in with that existing account instead.
    }
  }

  const row = {
    ref: data.ref, business_name: data.businessName, owner_name: data.ownerName,
    business_type: data.businessType, phone: data.phone, email: data.email,
    city: data.city, pincode: data.pincode, address: data.address,
    services: data.services, vehicles: data.vehicles,
    mechanics: data.mechanics, bays: data.bays, all_night: data.allNight,
    doorstep: data.doorstep, experience: data.experience,
    gstin: data.gstin || null, pan: data.pan, bank_ready: data.bankReady,
    owner_id: ownerId
  };
  // owner_id can only be set by an authenticated insert (RLS enforces this
  // at the database level) -- anonymous submissions must leave it null.
  if (ownerId && window.fwCloud) await fwCloud.authInsert("vendor_applications", row);
  else if (window.fwInsert) window.fwInsert("vendor_applications", row);

  document.getElementById("vSuccessName").textContent = data.ownerName;
  document.getElementById("vSuccessRef").textContent = data.ref;
  document.getElementById("vSuccessPhone").textContent = "+91 " + data.phone;
  const confirmNote = document.getElementById("vSuccessConfirmNote");
  if (confirmNote) confirmNote.hidden = !needsEmailConfirm;
  vendorForm.hidden = true;
  document.getElementById("stepper").hidden = true;
  document.getElementById("vendorSuccess").hidden = false;
  document.getElementById("onboardCard").scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---------- Application status checker ----------
const statusForm = document.getElementById("statusForm");
const statusResult = document.getElementById("statusResult");

statusForm.elements.phone.addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10);
});

statusForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const phone = statusForm.elements.phone.value.trim();
  statusResult.hidden = false;

  if (!validators.phone(phone)) {
    statusResult.className = "status-result error";
    statusResult.textContent = "Please enter a valid 10-digit mobile number.";
    return;
  }

  const showFound = (name, ref, status, createdAt) => {
    statusResult.className = "status-result found";
    statusResult.innerHTML =
      "<strong>" + name + "</strong><br />" +
      "Ref: " + ref + " · Applied " + new Date(createdAt).toLocaleDateString("en-IN") +
      '<br />Status: <span class="status-pill">' + status + "</span>";
  };
  const showNotFound = () => {
    statusResult.className = "status-result error";
    statusResult.innerHTML = "No application found for this number. <a href='#register'>Register now →</a>";
  };

  const localMatch = getVendors().filter((v) => v.phone === phone).pop();
  const cloudLookup = window.fwRpc ? window.fwRpc("check_application_status", { p_phone: phone }) : Promise.resolve(null);
  statusResult.className = "status-result";
  statusResult.textContent = "Checking…";
  cloudLookup.then((rows) => {
    const r = rows && rows[0];
    if (r) showFound(r.business_name, r.ref, r.status, r.created_at);
    else if (localMatch) showFound(localMatch.businessName, localMatch.ref, localMatch.status, localMatch.createdAt);
    else showNotFound();
  });
});

// ---------- Partner Sign In & Portal ----------
const partnerLoginForm = document.getElementById("partnerLoginForm");
const partnerSignedOut = document.getElementById("partnerSignedOut");
const partnerSignedIn = document.getElementById("partnerSignedIn");

function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

async function fetchOwnApplication() {
  const uid = JSON.parse(localStorage.getItem("fw_session") || "null")?.user?.id;
  if (!uid || !window.fwCloud) return null;
  let rows = await fwCloud.authGet("vendor_applications", "owner_id=eq." + uid + "&select=*&order=created_at.desc&limit=1");
  if (rows && rows.length) return rows[0];

  // Not linked yet (e.g. the account was confirmed after the application
  // was submitted) — try to claim an ownerless application with a
  // matching email. Matched on the JWT's *verified* email claim (proven
  // by actually confirming that inbox), never on phone number, which
  // anyone could type in without proving they own it.
  const email = JSON.parse(localStorage.getItem("fw_session") || "null")?.user?.email;
  if (email) {
    const matches = await fwCloud.authGet("vendor_applications",
      "email=eq." + encodeURIComponent(email) + "&owner_id=is.null&order=created_at.desc&limit=1");
    if (matches && matches.length) {
      await fetch(FW_BACKEND.url + "/rest/v1/vendor_applications?id=eq." + matches[0].id, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json", "apikey": FW_BACKEND.anonKey,
          "Authorization": "Bearer " + JSON.parse(localStorage.getItem("fw_session")).access_token,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({ owner_id: uid })
      }).catch(() => {});
      rows = await fwCloud.authGet("vendor_applications", "owner_id=eq." + uid + "&select=*&order=created_at.desc&limit=1");
      if (rows && rows.length) return rows[0];
    }
  }
  return null;
}

async function renderPartnerPortal() {
  partnerSignedOut.hidden = true;
  partnerSignedIn.hidden = false;
  document.getElementById("partnerOwnerName").textContent = "";
  const details = document.getElementById("partnerAppDetails");
  details.innerHTML = "<p class='muted'>Loading your application…</p>";

  const app = await fetchOwnApplication();
  if (!app) {
    details.innerHTML = "<p class='muted'>No application linked to this account yet. If you just registered, this can take a minute — or <a href='#register'>register your workshop</a>.</p>";
    return;
  }
  document.getElementById("partnerOwnerName").textContent = " — " + app.business_name;
  details.innerHTML =
    "Ref: <strong>" + esc(app.ref) + "</strong><br />" +
    "Applied " + new Date(app.created_at).toLocaleDateString("en-IN") + "<br />" +
    "Status: <span class='status-pill'>" + esc(app.status) + "</span>";
}

partnerLoginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("partnerLoginErr");
  err.hidden = true;
  const fd = Object.fromEntries(new FormData(partnerLoginForm));
  try {
    await fwCloud.login(fd.email, fd.password);
    renderPartnerPortal();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

document.getElementById("partnerLogoutBtn").addEventListener("click", () => {
  if (confirm("Sign out of your partner account?")) fwCloud.logout();
});

if (window.fwCloud && fwCloud.user()) renderPartnerPortal();
