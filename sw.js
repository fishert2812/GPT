// Service worker for the home-screen app. Template: tools/web_artifact.py --full fills in
// the build id and the precache list below and writes it next to index.html as sw.js.
// Game parts carry ?v=BUILD in their URL, so they are served from cache forever; a part is
// cached on first use, and only when its byte count matches SIZES (a stale or cut copy from a CDN
// never sticks). Parts are not precached: the page is downloading them at that very moment, and
// a second copy in parallel would double the first load;
// everything else (the page itself, sw.js, manifest, icons) is network-first and
// revalidated past the HTTP cache, so a new deploy shows up on the next launch;
// the cached copy is used only when the network fails or stalls.
const BUILD = "05de881d45e7";
const PRECACHE = ["index.html", "manifest.json", "index.png", "index.audio.worklet.js", "index.audio.position.worklet.js", "icon-180.png", "icon-192.png", "icon-512.png", "wasm/0-e06c0d789e.wasm?v=05de881d45e7", "pck/0-c6798ecbb9.wasm?v=05de881d45e7", "pck/1-6045ccb8b6.wasm?v=05de881d45e7", "pck/2-50a8a80165.wasm?v=05de881d45e7", "pck/3-85dff5f651.wasm?v=05de881d45e7", "pck/4-73195df6ab.wasm?v=05de881d45e7"];
const SIZES = {"0-e06c0d789e.wasm": 9387768, "0-c6798ecbb9.wasm": 14000000, "1-6045ccb8b6.wasm": 14000000, "2-50a8a80165.wasm": 14000000, "3-85dff5f651.wasm": 14000000, "4-73195df6ab.wasm": 5565362};
const CACHE = "archertd-" + BUILD;
const NET_TIMEOUT = 8000;

const isChunk = (url) => new URL(url, self.location.href).searchParams.has("v");
const fresh = (url) => new Request(url, { cache: "reload" });
const want = (url) => SIZES[new URL(url, self.location.href).pathname.split("/").pop()];

// A game part from the network, streamed to the page as it arrives (the loading bar moves) while a
// copy of the same bytes goes into the cache once its byte count matches. The page checks the size
// itself and re-fetches a bad part with ?fresh, which bypasses this worker.
const cachePart = async (key) => {
  const r = await fetch(key);
  if (!r.ok || !r.body) return r;
  const [page, copy] = r.body.tee();
  new Response(copy).arrayBuffer().then((buf) => {
    if (want(key) !== undefined && buf.byteLength !== want(key)) return;
    const res = new Response(buf, { status: 200, headers: { "Content-Type": "application/wasm" } });
    return caches.open(CACHE).then((c) => c.put(key, res));
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
  // The page's build check must see the network, never a cache (and must not fill the cache).
  if (new URL(req.url).pathname.endsWith("/version.json")) return;
  if (new URL(req.url).searchParams.has("fresh")) {
    // The page re-fetching a part that came back the wrong size: straight to the network, not cached.
    e.respondWith(fetch(req.url, { cache: "reload" }));
    return;
  }
  if (isChunk(req.url)) {
    // Versioned game chunk: cache-first, forever.
    e.respondWith(caches.match(req).then((hit) => hit || cachePart(req.url)));
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
