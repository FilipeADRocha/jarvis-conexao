/* The CONVERSA tab's hologram: the same model the PC shows in the dialogue (the one chosen in
   CUSTOMIZAÇÃO), drawn by the shared holo-engine.js. It follows the PC's choice (/m/state theme), speaks
   with the PC's voice played here and listens with this phone's microphone. Model files come from the PC
   (/m/model/...) and stay cached on the phone until they change. */
import { Hologram, modelOf } from "./holo-engine.js";

const host = document.querySelector("#holo");
const phone = () => window.jarvisPhone;

if (host) {
  const holo = new Hologram(host, {
    load: (path, kind) => phone().model(path, kind),
    voice: () => phone()?.voice() || { state: "idle", level: 0 },
    visible: () => document.body.dataset.screen === "app" && document.querySelector("#pane-talk")?.classList.contains("is-active"),
    fit: 0.86,
    onModel: (id, manifest) => {
      const label = document.querySelector("#holo-model");
      if (label) label.textContent = manifest?.title || id.toUpperCase();
    },
  });
  if (holo.failed) host.classList.add("is-fallback"); // no WebGL: the CSS reactor stays

  let current = "";
  const show = (theme) => {
    holo.setConfig(theme?.model || {});
    const id = modelOf(theme || {});
    if (id !== current) {
      current = id;
      holo.setModel(id);
    }
  };
  document.addEventListener("jarvis:phone-theme", (event) => show(event.detail.theme));
  document.addEventListener("jarvis:phone-pane", () => holo.wake());
  document.addEventListener("jarvis:phone-ready", () => holo.wake());
  if (phone()?.theme) show(phone().theme);
  // Keep animating while it speaks or listens, even with no new poll.
  window.setInterval(() => holo.wake(), 1000);
}
