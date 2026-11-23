// Minimal service worker: makes the customer app installable ("Add to Home Screen"). Always loads live data from the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
