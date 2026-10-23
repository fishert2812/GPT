// Service worker for the home-screen app. Template: tools/web_artifact.py --full fills in
// the build id and the precache list below and writes it next to index.html as sw.js.
// Game parts carry ?v=BUILD in their URL, so they are served from cache forever; a part is
// cached only when its byte count matches SIZES (a stale or cut copy from a CDN never sticks);
// everything else (the page itself, sw.js, manifest, icons) is network-first and
// revalidated past the HTTP cache, so a new deploy shows up on the next launch;
// the cached copy is used only when the network fails or stalls.
const BUILD = "a381b0a61f58";
const PRECACHE = ["index.html", "manifest.json", "index.png", "index.audio.worklet.js", "index.audio.position.worklet.js", "icon-180.png", "icon-192.png", "icon-512.png", "wasm/0-e06c0d789e.wasm?v=a381b0a61f58", "pck/0-a3605a527b.wasm?v=a381b0a61f58", "pck/1-bfc03a865e.wasm?v=a381b0a61f58", "pck/2-f1cc96b93c.wasm?v=a381b0a61f58", "pck/3-37cbbbc332.wasm?v=a381b0a61f58", "pck/4-d0ca7d3708.wasm?v=a381b0a61f58", "pck/5-5601196ba1.wasm?v=a381b0a61f58"];
const SIZES = {"0-e06c0d789e.wasm": 9387768, "0-a3605a527b.wasm": 14000000, "1-bfc03a865e.wasm": 14000000, "2-f1cc96b93c.wasm": 14000000, "3-37cbbbc332.wasm": 14000000, "4-d0ca7d3708.wasm": 14000000, "5-5601196ba1.wasm": 11759248};
const CACHE = "archertd-" + BUILD;
const NET_TIMEOUT = 8000;

const isChunk = (url) => new URL(url, self.location.href).searchParams.has("v");
const fresh = (url) => new Request(url, { cache: "reload" });
const want = (url) => SIZES[new URL(url, self.location.href).pathname.split("/").pop()];

// A game part from the network, checked against its byte count; one more try past the HTTP cache
// if it does not match. Resolves to { res, ok }: only ok parts go into the cache.
const fetchPart = async (url) => {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, { cache: attempt ? "reload" : "default" });
    if (!r.ok) { last = r; continue; }
    const buf = await r.arrayBuffer();
    const res = new Response(buf, { status: 200, headers: { "Content-Type": "application/wasm" } });
    if (want(url) === undefined || buf.byteLength === want(url)) return { res, ok: true };
    last = res;
  }
  return { res: last, ok: false };
};
const cachePart = (key) => fetchPart(key).then(({ res, ok }) => {
  if (ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
  return res;
});

const store = (key) => (res) => {
  if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
  return res;
};

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    // The shell must precache; the big game chunks are best-effort (they are also cached on first use).
    await c.addAll(PRECACHE.filter((u) => !isChunk(u)).map(fresh));
    await Promise.allSettled(PRECACHE.filter(isChunk).map((u) => fetchPart(u)
      .then(({ res, ok }) => ok && c.put(u, res))));
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
