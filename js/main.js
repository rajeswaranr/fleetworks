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

// ---------- Modal booking form ----------
bookingForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!validateForm(bookingForm)) return;

  const data = Object.fromEntries(new FormData(bookingForm));
  data.ref = makeRef();
  saveLead(data);

  document.getElementById("successName").textContent = data.name;
  document.getElementById("successPhone").textContent = "+91 " + data.phone;
  document.getElementById("successRef").textContent = data.ref;
  modalFormView.hidden = true;
  modalSuccessView.hidden = false;
  bookingForm.reset();
});

// ---------- Hero quick form ----------
const quickForm = document.getElementById("quickForm");
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
