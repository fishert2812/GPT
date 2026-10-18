// Service worker for the home-screen app. Template: tools/web_artifact.py --full fills in
// the build id and the precache list below and writes it next to index.html as sw.js.
// Game parts carry ?v=BUILD in their URL, so they are served from cache forever;
// everything else (the page itself, sw.js, manifest, icons) is network-first and
// revalidated past the HTTP cache, so a new deploy shows up on the next launch;
// the cached copy is used only when the network fails or stalls.
const BUILD = "17bdddd220ec";
const PRECACHE = ["index.html", "manifest.json", "index.png", "index.audio.worklet.js", "index.audio.position.worklet.js", "icon-180.png", "icon-192.png", "icon-512.png", "wasm/0.wasm?v=17bdddd220ec", "pck/0.wasm?v=17bdddd220ec", "pck/1.wasm?v=17bdddd220ec", "pck/2.wasm?v=17bdddd220ec", "pck/3.wasm?v=17bdddd220ec"];
const CACHE = "archertd-" + BUILD;
const NET_TIMEOUT = 8000;

const isChunk = (url) => new URL(url, self.location.href).searchParams.has("v");
const fresh = (url) => new Request(url, { cache: "reload" });
const store = (key) => (res) => {
  if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
  return res;
};

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    // The shell must precache; the big game chunks are best-effort (they are also cached on first use).
    await c.addAll(PRECACHE.filter((u) => !isChunk(u)).map(fresh));
    await Promise.allSettled(PRECACHE.filter(isChunk).map((u) => c.add(fresh(u))));
  }).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("archertd-") && k !== CACHE)
      .map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// The page asks which build this worker serves (after controllerchange) and reloads if it differs.
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "build" && e.ports[0]) e.ports[0].postMessage({ build: BUILD });
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  if (isChunk(req.url)) {
    // Versioned game chunk: cache-first, forever.
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(store(req))));
    return;
  }
  // Shell file or navigation: network-first ("no-cache" revalidates past the HTTP cache's max-age),
  // cached copy only when the network fails or does not answer within NET_TIMEOUT.
  const net = fetch(req.url, { cache: "no-cache" }).then(store(req.url));
  const timeout = new Promise((_, fail) => setTimeout(() => fail(new Error("timeout")), NET_TIMEOUT));
  const cached = () => caches.match(req.url, { ignoreSearch: true })
    .then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined));
  e.respondWith(Promise.race([net, timeout])
    .catch(() => cached().then((hit) => hit || net))
    .catch(() => Response.error()));
});
