/* Conexão JARVIS: keeps the app's own files for offline start (the conversation itself always needs
   the PC). Network first, so a new version arrives as soon as it is online. */
const CACHE = "conexao-jarvis-v2";
const SHELL = ["./", "index.html", "mobile.css", "mobile.js", "panel.js", "holo-loader.js", "holo.js", "holo-engine.js", "manifest.json", "icon.svg",
  "vendor/jsQR.js", "vendor/three/three.module.min.js", "vendor/three/addons/postprocessing/EffectComposer.js",
  "vendor/three/addons/postprocessing/MaskPass.js", "vendor/three/addons/postprocessing/OutputPass.js",
  "vendor/three/addons/postprocessing/Pass.js", "vendor/three/addons/postprocessing/RenderPass.js",
  "vendor/three/addons/postprocessing/ShaderPass.js", "vendor/three/addons/postprocessing/UnrealBloomPass.js",
  "vendor/three/addons/shaders/CopyShader.js", "vendor/three/addons/shaders/LuminosityHighPassShader.js",
  "vendor/three/addons/shaders/OutputShader.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== "jarvis-models")
    .map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return; // the PC and ntfy: never cached
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((hit) => hit || caches.match("index.html"))));
});
