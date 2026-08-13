/* FleetWorks service worker — network-first with offline fallback cache */
const CACHE = "fleetworks-v82";
const CORE = [
  "./",
  "./index.html",
  "./partner.html",
  "./dashboard.html",
  "./why.html",
  "./fleet.html",
  "./my.html",
  "./signin.html",
  "./reset.html",
  "./driver.html",
  "./garage.html",
  "./team.html",
  "./css/style.css",
  "./css/landing.css",
  "./js/icons.js",
  "./js/backend.js",
  "./js/modules/auth/domain/auth.domain.js",
  "./js/modules/auth/ports/auth-repository.port.js",
  "./js/modules/auth/adapters/supabase-auth.repository.js",
  "./js/modules/auth/use-cases/auth.usecases.js",
  "./js/modules/auth/view-models/auth.viewmodel.js",
  "./js/modules/auth/auth.module.js",
  "./js/modules/fleet-ops/domain/fleet-ops.domain.js",
  "./js/modules/fleet-ops/ports/fleet-ops-repository.port.js",
  "./js/modules/fleet-ops/adapters/legacy-fleet-ops.repository.js",
  "./js/modules/fleet-ops/use-cases/fleet-ops.usecases.js",
  "./js/modules/fleet-ops/view-models/fleet-ops.viewmodel.js",
  "./js/modules/fleet-ops/fleet-ops.module.js",
  "./js/modules/maintenance/domain/maintenance.domain.js",
  "./js/modules/maintenance/ports/maintenance-repository.port.js",
  "./js/modules/maintenance/adapters/legacy-maintenance.repository.js",
  "./js/modules/maintenance/use-cases/maintenance.usecases.js",
  "./js/modules/maintenance/view-models/maintenance.viewmodel.js",
  "./js/modules/maintenance/maintenance.module.js",
  "./js/modules/fleet-fin/domain/fleet-fin.domain.js",
  "./js/modules/fleet-fin/ports/fleet-fin-repository.port.js",
  "./js/modules/fleet-fin/adapters/legacy-fleet-fin.repository.js",
  "./js/modules/fleet-fin/use-cases/fleet-fin.usecases.js",
  "./js/modules/fleet-fin/view-models/fleet-fin.viewmodel.js",
  "./js/modules/fleet-fin/fleet-fin.module.js",
  "./js/modules/team-access/domain/team-access.domain.js",
  "./js/modules/team-access/ports/team-access-repository.port.js",
  "./js/modules/team-access/adapters/legacy-team-access.repository.js",
  "./js/modules/team-access/use-cases/team-access.usecases.js",
  "./js/modules/team-access/view-models/team-access.viewmodel.js",
  "./js/modules/team-access/team-access.module.js",
  "./js/modules/fleet-iq/domain/fleet-iq.domain.js",
  "./js/modules/fleet-iq/ports/fleet-iq-repository.port.js",
  "./js/modules/fleet-iq/adapters/legacy-fleet-iq.repository.js",
  "./js/modules/fleet-iq/use-cases/fleet-iq.usecases.js",
  "./js/modules/fleet-iq/view-models/fleet-iq.viewmodel.js",
  "./js/modules/fleet-iq/fleet-iq.module.js",
  "./js/modules/driver-portal/domain/driver-portal.domain.js",
  "./js/modules/driver-portal/ports/driver-portal-repository.port.js",
  "./js/modules/driver-portal/adapters/legacy-driver-portal.repository.js",
  "./js/modules/driver-portal/use-cases/driver-portal.usecases.js",
  "./js/modules/driver-portal/view-models/driver-portal.viewmodel.js",
  "./js/modules/driver-portal/driver-portal.module.js",
  "./js/modules/garage-ops/domain/garage-ops.domain.js",
  "./js/modules/garage-ops/ports/garage-ops-repository.port.js",
  "./js/modules/garage-ops/adapters/legacy-garage-ops.repository.js",
  "./js/modules/garage-ops/use-cases/garage-ops.usecases.js",
  "./js/modules/garage-ops/view-models/garage-ops.viewmodel.js",
  "./js/modules/garage-ops/garage-ops.module.js",
  "./js/modules/bulk-import/domain/bulk-import.domain.js",
  "./js/modules/bulk-import/ports/bulk-import-repository.port.js",
  "./js/modules/bulk-import/adapters/legacy-bulk-import.repository.js",
  "./js/modules/bulk-import/use-cases/bulk-import.usecases.js",
  "./js/modules/bulk-import/view-models/bulk-import.viewmodel.js",
  "./js/modules/bulk-import/bulk-import.module.js",
  "./js/modules/service-workflow/domain/service-workflow.domain.js",
  "./js/modules/service-workflow/ports/service-workflow-repository.port.js",
  "./js/modules/service-workflow/adapters/legacy-service-workflow.repository.js",
  "./js/modules/service-workflow/use-cases/service-workflow.usecases.js",
  "./js/modules/service-workflow/view-models/service-workflow.viewmodel.js",
  "./js/modules/service-workflow/service-workflow.module.js",
  "./js/modules/driver-map/domain/driver-map.domain.js",
  "./js/modules/driver-map/ports/driver-map.port.js",
  "./js/modules/driver-map/adapters/legacy-driver-map.repository.js",
  "./js/modules/driver-map/use-cases/driver-map.usecases.js",
  "./js/modules/driver-map/view-models/driver-map.viewmodel.js",
  "./js/modules/driver-map/driver-map.module.js",
  "./js/modules/payments/domain/payment.domain.js",
  "./js/modules/payments/ports/payment-repository.port.js",
  "./js/modules/payments/adapters/legacy-payment.repository.js",
  "./js/modules/payments/use-cases/payment.usecases.js",
  "./js/modules/payments/view-models/payment.viewmodel.js",
  "./js/modules/payments/payment.module.js",
  "./js/modules/llm-gateway/llm-gateway.module.js",
  "./js/auth-reset.js",
  "./js/main.js",
  "./js/partner.js",
  "./js/legacy/fleet.js",
  "./js/dbcore.js",
  "./js/legacy/analytics.js",
  "./js/account.js",
  "./js/legacy/payroll.js",
  "./js/legacy/bulkimport.js",
  "./js/legacy/fleetmap.js",
  "./js/legacy/driver.js",
  "./js/legacy/garage.js",
  "./js/legacy/team.js",
  "./js/legacy/workflow.js",
  "./js/legacy/copilot.js",
  "./js/cloudstore.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (!e.request.url.startsWith("http")) return; // browser-extension requests (chrome-extension://) aren't cacheable
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
  );
});
