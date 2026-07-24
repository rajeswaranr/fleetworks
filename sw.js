/* FleetWorks service worker — network-first with offline fallback cache */
const CACHE = "fleetworks-v48";
const CORE = [
  "./",
  "./index.html",
  "./partner.html",
  "./dashboard.html",
  "./why.html",
  "./fleet.html",
  "./my.html",
  "./signin.html",
  "./driver.html",
  "./garage.html",
  "./css/style.css",
  "./js/icons.js",
  "./js/backend.js",
  "./js/main.js",
  "./js/partner.js",
  "./js/fleet.js",
  "./js/analytics.js",
  "./js/account.js",
  "./js/driver.js",
  "./js/garage.js",
  "./js/workflow.js",
  "./js/copilot.js",
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
