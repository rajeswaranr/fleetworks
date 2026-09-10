/* ============ FleetWorks — team-access/domain ============
   Pure helpers for portal access, assignments, and team updates. */

(function () {
  "use strict";

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function normalizeRole(role) {
    const value = String(role || "").toLowerCase();
    return ["owner", "manager", "supervisor", "driver"].includes(value) ? value : "";
  }

  function normalizeAccess(access, fallback) {
    return access === "update" ? "update" : (fallback || "view");
  }

  function normalizeMembership(input) {
    const m = input || {};
    return {
      id: m.id || "",
      userId: m.user_id || m.userId || "",
      orgId: m.org_id || m.orgId || "",
      role: normalizeRole(m.role),
    };
  }

  function normalizeAssignment(input) {
    const a = input || {};
    return {
      vehicleExtId: a.vehicle_ext_id || a.vehicleExtId || "",
      access: normalizeAccess(a.access),
    };
  }

  function assignmentMap(assignments) {
    return (assignments || []).reduce((map, assignment) => {
      const a = normalizeAssignment(assignment);
      if (a.vehicleExtId) map[a.vehicleExtId] = a.access;
      return map;
    }, {});
  }

  function canUseTeamPortal(membership) {
    const role = normalizeMembership(membership).role;
    return role === "driver" || role === "supervisor";
  }

  function canUpdate(access) {
    return normalizeAccess(access) === "update";
  }

  function roleLabel(role) {
    const value = normalizeRole(role);
    if (value === "driver") return "Driver";
    if (value === "supervisor") return "Supervisor";
    if (value === "manager") return "Manager";
    if (value === "owner") return "Owner";
    return "";
  }

  function accessNote(role, hasUpdateAccess) {
    const r = normalizeRole(role);
    if (r === "driver") {
      return hasUpdateAccess
        ? "Tap a vehicle to log diesel, trips, expenses or a problem, and see its recent history."
        : "Tap a vehicle to see its recent fuel, expenses, issues and inspections.";
    }
    if (r === "supervisor") {
      return hasUpdateAccess
        ? "Vehicles marked 'Can update' let you log fuel, expenses, inspections and report problems. View-only vehicles show history."
        : "Tap a vehicle to see its recent fuel, expenses, issues and inspections.";
    }
    return "";
  }

  function profileName(profile, email) {
    return (profile && profile.full_name) || String(email || "").split("@")[0] || "";
  }

  function normalizeFuelLog(input) {
    const f = input || {};
    return {
      org_id: f.orgId || f.org_id || "",
      vehicle_id: f.vehicleId || f.vehicle_id || "",
      log_date: f.date || f.log_date || today(),
      litres: Number(f.litres || 0),
      amount: Number(f.amount || 0),
      odometer: f.odo || f.odometer ? Number(f.odo || f.odometer) : null,
    };
  }

  function normalizeExpenseRequest(input) {
    const e = input || {};
    return {
      org_id: e.orgId || e.org_id || "",
      vehicle_id: e.vehicleId || e.vehicle_id || "",
      action: e.action || "create",
      patch: {
        expense_date: e.date || e.expense_date || today(),
        category: String(e.category || "").trim(),
        amount: Number(e.amount || 0),
      },
      requested_by: e.requestedBy || e.requested_by || "",
    };
  }

  function normalizeIssue(input) {
    const i = input || {};
    return {
      org_id: i.orgId || i.org_id || "",
      vehicle_id: i.vehicleId || i.vehicle_id || "",
      title: String(i.title || "").trim(),
      severity: i.severity || "Medium",
      status: i.status || "Open",
      reported_at: i.date || i.reported_at || today(),
      source: i.source || "Team portal",
    };
  }

  window.FWTeamAccessDomain = window.FWTeamAccessDomain || {
    today,
    normalizeRole,
    normalizeAccess,
    normalizeMembership,
    normalizeAssignment,
    assignmentMap,
    canUseTeamPortal,
    canUpdate,
    roleLabel,
    accessNote,
    profileName,
    normalizeFuelLog,
    normalizeExpenseRequest,
    normalizeIssue,
  };
})();
