// Service worker for the home-screen app (written by tools/web_artifact.py --full).
// Game parts carry ?v=BUILD in their URL, so they are served from cache forever;
// everything else (the page itself, icons) goes to the network first, so a new
// deploy shows up on the next launch, and falls back to the cache offline.
const BUILD = "cceed239563a";
const PRECACHE = ["./", "index.html", "manifest.json", "index.png", "index.audio.worklet.js", "index.audio.position.worklet.js", "icon-180.png", "icon-192.png", "icon-512.png", "wasm/0.wasm?v=cceed239563a", "pck/0.wasm?v=cceed239563a", "pck/1.wasm?v=cceed239563a", "pck/2.wasm?v=cceed239563a"];
const CACHE = "archertd-" + BUILD;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("archertd-") && k !== CACHE)
      .map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  if (new URL(req.url).searchParams.has("v")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  const net = fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  });
  // Slow network: after 3 s take the cached copy if there is one, so the app still opens fast.
  const slow = new Promise((ok) => setTimeout(ok, 3000))
    .then(() => caches.match(req, { ignoreSearch: true }))
    .then((hit) => hit || net);
  e.respondWith(Promise.race([net, slow])
    .catch(() => caches.match(req, { ignoreSearch: true }))
    .then((res) => res || Response.error()));
});
