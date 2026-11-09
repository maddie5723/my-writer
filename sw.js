/* My Writer service worker
   Network-first for the app's own files (so updates show up right away),
   falling back to the cached copy when offline. The AI model files are
   cached separately by WebLLM, so they're not touched here. */
const CACHE = "my-writer-v4";
const SHELL = [
  "./", "./index.html", "./styles.css", "./manifest.webmanifest", "./icons/icon.svg",
  "./js/app.js", "./js/ui.js", "./js/store.js", "./js/ai.js", "./js/prompts.js", "./js/layout.js",
  "./js/characters.js", "./js/chat.js", "./js/writer.js", "./js/lore.js", "./js/settings.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (req.method !== "GET" || (!sameOrigin && !fonts)) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("./index.html"))));
});
