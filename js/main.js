/* ============ FleetWorks — main.js ============ */

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

// ---------- Booking modal ----------
const bookingModal = document.getElementById("bookingModal");
const modalFormView = document.getElementById("modalFormView");
const modalSuccessView = document.getElementById("modalSuccessView");
const bookingForm = document.getElementById("bookingForm");
const modalService = document.getElementById("modalService");

function openBooking(service) {
  modalFormView.hidden = false;
  modalSuccessView.hidden = true;
  if (service) {
    // Select the matching option if it exists
    const opt = [...modalService.options].find((o) => o.text === service);
    modalService.value = opt ? opt.text : "";
  }
  bookingModal.classList.add("open");
  bookingModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeBooking() {
  bookingModal.classList.remove("open");
  bookingModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

bookingModal.addEventListener("click", (e) => {
  if (e.target === bookingModal) closeBooking();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeBooking();
});

// Service cards open the modal pre-filled
document.querySelectorAll(".service-card").forEach((card) => {
  card.querySelector(".link-btn").addEventListener("click", () => {
    openBooking(card.dataset.service);
  });
});

// ---------- Validation helpers ----------
function validateForm(form) {
  let valid = true;
  form.querySelectorAll("[required]").forEach((field) => {
    const value = field.value.trim();
    let fieldOk = value !== "";
    if (fieldOk && field.name === "phone") {
      fieldOk = /^[6-9]\d{9}$/.test(value);
    }
    field.classList.toggle("invalid", !fieldOk);
    if (!fieldOk) valid = false;
  });
  return valid;
}

// Clear error styling as the user types
document.addEventListener("input", (e) => {
  if (e.target.matches("input, select, textarea")) {
    e.target.classList.remove("invalid");
  }
});

// Digits only in phone fields
document.querySelectorAll('input[name="phone"]').forEach((input) => {
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 10);
  });
});

function makeRef() {
  return "FW-" + Date.now().toString(36).toUpperCase().slice(-6);
}

function saveLead(data) {
  // Local copy (offline safety) + cloud insert via Supabase when configured.
  const leads = JSON.parse(localStorage.getItem("ff_leads") || "[]");
  leads.push({ ...data, createdAt: new Date().toISOString() });
  localStorage.setItem("ff_leads", JSON.stringify(leads));
  if (window.fwInsert) {
    window.fwInsert("leads", {
      ref: data.ref, name: data.name || null, phone: data.phone,
      city: data.city || null, vehicle: data.vehicle || null,
      service: data.service || null, issue: data.issue || null
    });
  }
}

// ---------- State -> District -> Town cascade ----------
// Districts come from IN_DISTRICTS (all India); towns from TN_TOWNS (Tamil
// Nadu only — the current market). Elsewhere the town is typed in: a dropdown
// that silently omits someone's town is worse than a text field.
const bookState = document.getElementById("bookState");
const bookDistrict = document.getElementById("bookDistrict");
const bookTownSel = document.getElementById("bookTownSel");
const bookTownText = document.getElementById("bookTownText");

// Exactly one town control is active at a time. The inactive one must drop its
// `required` too — validateForm sees hidden fields, and a hidden required
// control would block the submit with nothing visible to fix.
function activateTown(control) {
  for (const el of [bookTownSel, bookTownText]) {
    const on = el === control;
    el.hidden = !on;
    el.disabled = !on;
    el.required = on;
    if (!on) { el.value = ""; el.classList.remove("invalid"); }
  }
}

if (bookState && window.IN_DISTRICTS) {
  bookState.innerHTML = '<option value="">Select state</option>' +
    Object.keys(IN_DISTRICTS).map((s) => `<option>${s}</option>`).join("");

  bookState.addEventListener("change", () => {
    const districts = IN_DISTRICTS[bookState.value] || [];
    bookDistrict.disabled = !districts.length;
    bookDistrict.innerHTML = districts.length
      ? '<option value="">Select district</option>' + districts.map((d) => `<option>${d}</option>`).join("")
      : '<option value="">Select state first</option>';
    activateTown(bookTownText); // placeholder until a district is picked
    bookTownText.hidden = true; bookTownText.disabled = true; bookTownText.required = false;
  });

  bookDistrict.addEventListener("change", () => {
    const towns = (window.TN_TOWNS || {})[bookDistrict.value];
    if (towns && bookState.value === "Tamil Nadu") {
      bookTownSel.innerHTML = '<option value="">Select town</option>' +
        towns.map((t) => `<option>${t}</option>`).join("") +
        '<option value="__other">Other…</option>';
      activateTown(bookTownSel);
    } else {
      bookTownText.placeholder = "Your town / city";
      activateTown(bookTownText);
    }
  });

  // "Other…" inside a TN district swaps to the text field so an unlisted
  // town never blocks a booking.
  bookTownSel.addEventListener("change", () => {
    if (bookTownSel.value === "__other") {
      bookTownText.placeholder = "Type your town in " + bookDistrict.value;
      activateTown(bookTownText);
      bookTownText.focus();
    }
  });
}

// ---------- Modal booking form ----------
bookingForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const errEl = document.getElementById("bookingErr");
  if (!validateForm(bookingForm)) {
    // Never block silently: on the dark modal the red borders alone were
    // invisible until landing.css got its .invalid override, and a blocked
    // submit read as a dead Confirm button.
    if (errEl) {
      const badPhone = bookingForm.elements.phone.classList.contains("invalid") && bookingForm.elements.phone.value.trim() !== "";
      errEl.textContent = badPhone
        ? "Enter a valid 10-digit mobile number (starting 6–9)."
        : "Please fill the highlighted fields.";
      errEl.hidden = false;
    }
    return;
  }
  if (errEl) errEl.hidden = true;

  const data = Object.fromEntries(new FormData(bookingForm));
  // The leads table keeps its single city column; compose "Town, District,
  // State" into it so no schema change is needed and the admin console shows
  // the full location in the column it already renders.
  const town = (data.townSel && data.townSel !== "__other" ? data.townSel : data.town || "").trim();
  data.city = [town, data.district, data.state].filter(Boolean).join(", ");
  data.ref = makeRef();
  saveLead(data);

  document.getElementById("successName").textContent = data.name;
  document.getElementById("successPhone").textContent = "+91 " + data.phone;
  document.getElementById("successRef").textContent = data.ref;
  modalFormView.hidden = true;
  modalSuccessView.hidden = false;
  bookingForm.reset();
});

// ---------- Hero quick form (optional — present on some layouts) ----------
const quickForm = document.getElementById("quickForm");
if (quickForm) {
  quickForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validateForm(quickForm)) return;

    const data = Object.fromEntries(new FormData(quickForm));
    // Hand off to the full booking modal with the service pre-selected
    openBooking(data.service);
    const modalForm = document.getElementById("bookingForm");
    modalForm.elements.phone.value = data.phone;
    modalForm.elements.city.value = data.city;
    modalForm.elements.vehicle.value = data.vehicle;
  });
}
