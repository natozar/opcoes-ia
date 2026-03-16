const CACHE_NAME = "optionhunter-v3.1";
const ASSETS = ["/", "/index.html", "/css/style.css", "/js/app.js", "/js/indicators.js", "/js/score-engine.js", "/js/market-data.js", "/js/paper-trading.js", "/js/options-chain.js"];

self.addEventListener("install", e => {
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener("activate", e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
    self.clients.claim();
});

self.addEventListener("fetch", e => {
    if (e.request.url.includes("brapi.dev")) return; // Don't cache API calls
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
