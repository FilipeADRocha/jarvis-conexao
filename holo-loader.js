/* Loads three.js for the CONVERSA hologram, then holo.js (like the desktop's holo-loader.js). On the PC's own
   page the file comes from the PC, where security software now and then holds a long local answer for ~19 s
   and resets it: each try gets a short clock (and, after the first, its own URL), and three.js goes to the
   import map as a blob URL, since a failed module script cannot retry. The Android app and the GitHub page
   read their own copy the same way. */
(() => {
  "use strict";

  const host = document.querySelector("#holo");
  const fromPc = !(window.Capacitor || location.hostname.endsWith("github.io"));
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  async function three() {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), fromPc ? 6000 : 45000);
      try {
        const url = `vendor/three/three.module.min.js${attempt ? `?r=${attempt}.${Date.now() % 1e6}` : ""}`;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
      } catch (_) {
        await sleep(300 * (attempt + 1));
      } finally {
        window.clearTimeout(timer);
      }
    }
    return null;
  }

  if (!host) return;
  three().then((source) => {
    if (!source) {
      host.classList.add("is-fallback"); // the CSS reactor stays in its place
      return;
    }
    const map = document.createElement("script");
    map.type = "importmap";
    map.textContent = JSON.stringify({ imports: { three: URL.createObjectURL(new Blob([source], { type: "text/javascript" })) } });
    document.head.append(map);
    const module = document.createElement("script");
    module.type = "module";
    module.src = "holo.js";
    module.addEventListener("error", () => host.classList.add("is-fallback"));
    document.body.append(module);
  });
})();
