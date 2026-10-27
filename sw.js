// Service worker for the home-screen app. Template: tools/web_artifact.py --full fills in
// the build id and the precache list below and writes it next to index.html as sw.js.
// Game parts are named by a hash of their bytes (pck/pc-0-1a2b3c4d5e.wasm), so they are served from cache
// forever and kept across builds in PARTS: an update downloads only the parts whose names changed.
// A part is cached on first use, and only when its bytes hash to its name (a stale or cut copy from a
// CDN never sticks); parts the new build no longer lists (SIZES) are dropped on activate. Parts are not
// precached: the page is downloading them at that very moment, and a second copy in parallel
// would double the first load;
// everything else (the page itself, sw.js, manifest, icons) is network-first and
// revalidated past the HTTP cache, so a new deploy shows up on the next launch;
// the cached copy is used only when the network fails or stalls.
const BUILD = "a3077028a565";
const PRECACHE = ["index.html", "manifest.json", "index.png", "index.audio.worklet.js", "index.audio.position.worklet.js", "icon-180.png", "icon-192.png", "icon-512.png", "wasm/0-e06c0d789e.wasm", "pck/pc-0-1647f253d6.wasm", "pck/pc-1-5ed277dee0.wasm", "pck/pc-2-e7079e7ee4.wasm", "pck/pc-3-e58d37ab4f.wasm", "pck/pc-4-ea164b136e.wasm", "pck/pc-5-fb01b96207.wasm", "pck/pc-6-8d052c9edd.wasm", "pck/pc-7-53ab68f6c8.wasm", "pck/pc-8-7835c36458.wasm", "pck/pc-9-59ad7e2c16.wasm", "pck/pc-10-5e5ba5260e.wasm", "pck/pc-11-f1ba5ada47.wasm", "pck/phone-0-1795420b25.wasm", "pck/phone-1-e97c955f2a.wasm", "pck/phone-2-d9645e7337.wasm", "pck/phone-3-029ca7511d.wasm", "pck/phone-4-beaa49e784.wasm", "pck/phone-5-c8a02ae604.wasm", "pck/phone-6-8c293b303a.wasm", "pck/phone-7-fe505c5af1.wasm", "pck/phone-8-89a555979c.wasm", "pck/phone-9-bf08c8b81d.wasm", "pck/phone-10-78667e29a4.wasm", "pck/phone-11-cb237d95f5.wasm"];
const SIZES = {"0-e06c0d789e.wasm": 9387768, "pc-0-1647f253d6.wasm": 14000000, "pc-1-5ed277dee0.wasm": 14000000, "pc-2-e7079e7ee4.wasm": 14000000, "pc-3-e58d37ab4f.wasm": 14000000, "pc-4-ea164b136e.wasm": 14000000, "pc-5-fb01b96207.wasm": 14000000, "pc-6-8d052c9edd.wasm": 14000000, "pc-7-53ab68f6c8.wasm": 14000000, "pc-8-7835c36458.wasm": 14000000, "pc-9-59ad7e2c16.wasm": 14000000, "pc-10-5e5ba5260e.wasm": 14000000, "pc-11-f1ba5ada47.wasm": 13494123, "phone-0-1795420b25.wasm": 14000000, "phone-1-e97c955f2a.wasm": 14000000, "phone-2-d9645e7337.wasm": 14000000, "phone-3-029ca7511d.wasm": 14000000, "phone-4-beaa49e784.wasm": 14000000, "phone-5-c8a02ae604.wasm": 14000000, "phone-6-8c293b303a.wasm": 14000000, "phone-7-fe505c5af1.wasm": 14000000, "phone-8-89a555979c.wasm": 14000000, "phone-9-bf08c8b81d.wasm": 14000000, "phone-10-78667e29a4.wasm": 14000000, "phone-11-cb237d95f5.wasm": 13432700};
const CACHE = "archertd-" + BUILD;
const PARTS = "archertd-parts";
const NET_TIMEOUT = 8000;

const fresh = (url) => new Request(url, { cache: "reload" });
// Any build's part, not only this one's: an old worker still in charge during an update caches the new
// build's parts too, so they are not downloaded again once the new worker takes over.
const PART = /\/(?:pck|wasm)\/(?:[a-z]+-)?\d+-([0-9a-f]{10})\.wasm$/;  // pck/phone-0-<hash>.wasm too
const tagOf = (url) => (PART.exec(new URL(url, self.location.href).pathname) || [])[1];
const isChunk = (url) => tagOf(url) !== undefined;
const listed = (url) => SIZES[new URL(url, self.location.href).pathname.split("/").pop()] !== undefined;
const hex10 = async (buf) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)).slice(0, 5))
  .map((b) => b.toString(16).padStart(2, "0")).join("");

// A game part from the network, streamed to the page as it arrives (the loading bar moves) while a
// copy of the same bytes goes into the cache once they hash to the part's name. The page checks the size
// itself and re-fetches a bad part with ?fresh, which bypasses this worker.
const cachePart = async (key) => {
  const r = await fetch(key);
  if (!r.ok || !r.body) return r;
  const [page, copy] = r.body.tee();
  new Response(copy).arrayBuffer().then(async (buf) => {
    if ((await hex10(buf)) !== tagOf(key)) return;
    const res = new Response(buf, { status: 200, headers: { "Content-Type": "application/wasm" } });
    return caches.open(PARTS).then((c) => c.put(key, res));
  }).catch(() => {});
  return new Response(page, { status: 200, headers: { "Content-Type": "application/wasm" } });
};

const store = (key) => (res) => {
  if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
  return res;
};

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    // Only the shell: game chunks are cached as the page downloads them (cachePart).
    await c.addAll(PRECACHE.filter((u) => !isChunk(u)).map(fresh));
  }).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("archertd-") && k !== CACHE && k !== PARTS)
      .map((k) => caches.delete(k))))
    .then(() => caches.open(PARTS))
    .then((c) => c.keys().then((reqs) => Promise.all(reqs.filter((r) => !listed(r.url)).map((r) => c.delete(r)))))
    .then(() => self.clients.claim()));
});

// The page asks which build this worker serves (after controllerchange) and reloads if it differs.
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "build" && e.ports[0]) e.ports[0].postMessage({ build: BUILD });
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // The page's build check must see the network, never a cache (and must not fill the cache).
  if (new URL(req.url).pathname.endsWith("/version.json")) return;
  if (new URL(req.url).searchParams.has("fresh")) {
    // The page re-fetching a part that came back the wrong size: straight to the network, not cached.
    e.respondWith(fetch(req.url, { cache: "reload" }));
    return;
  }
  if (isChunk(req.url)) {
    // Game part (name = hash of its bytes): cache-first, forever.
    e.respondWith(caches.open(PARTS).then((c) => c.match(req.url)).then((hit) => hit || cachePart(req.url)));
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
