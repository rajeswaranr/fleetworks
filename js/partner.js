/* ============ FleetWorks — partner.js (vendor onboarding) ============ */

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

  // Optional fields with format rules (email, gstin)
  step.querySelectorAll("input[name=email], input[name=gstin]").forEach((field) => {
    const ok = validators[field.name](field.value.trim());
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

  // Step 3: consent
  if (n === 3) {
    const consentOk = step.querySelector('input[name="consent"]').checked;
    document.getElementById("consentError").hidden = consentOk;
    if (!consentOk) valid = false;
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

vendorForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!validateStep(3)) return;

  const fd = new FormData(vendorForm);
  const data = Object.fromEntries(fd);
  data.services = fd.getAll("services");
  data.vehicles = fd.getAll("vehicles");
  data.documents = [...vendorForm.elements.documents.files].map((f) => f.name);
  data.ref = makeVendorRef();
  data.status = "Under Review";
  data.createdAt = new Date().toISOString();
  delete data.consent;

  // Local copy (offline safety) + cloud insert via Supabase when configured.
  const vendors = getVendors();
  vendors.push(data);
  localStorage.setItem("ff_vendors", JSON.stringify(vendors));
  if (window.fwInsert) {
    window.fwInsert("vendor_applications", {
      ref: data.ref, business_name: data.businessName, owner_name: data.ownerName,
      business_type: data.businessType, phone: data.phone, email: data.email || null,
      city: data.city, pincode: data.pincode, address: data.address,
      services: data.services, vehicles: data.vehicles,
      mechanics: data.mechanics, bays: data.bays, all_night: data.allNight,
      doorstep: data.doorstep, experience: data.experience,
      gstin: data.gstin || null, pan: data.pan, bank_ready: data.bankReady
    });
  }

  document.getElementById("vSuccessName").textContent = data.ownerName;
  document.getElementById("vSuccessRef").textContent = data.ref;
  document.getElementById("vSuccessPhone").textContent = "+91 " + data.phone;
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
