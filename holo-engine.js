/* The assistant's hologram, for every place it appears: the dialogue, the background window (orb),
   CUSTOMIZAÇÃO and the phone app. A model is a set of layers of glowing traces exported from Blender
   (tools/export_hologram.py for the JARVIS core, tools/avatar_builder.py for the others): each layer
   keeps its spin and sway, and the shader is the "JARVIS Holograma" material (light pulses running
   along every trace, shimmer, per-layer glow, AgX color and the compositor's bloom). The voice and
   the microphone drive it; the "faça você mesmo" settings scale, recolor, explode and pace it. */
import * as THREE from "three";
import { EffectComposer } from "./vendor/three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "./vendor/three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "./vendor/three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "./vendor/three/addons/postprocessing/UnrealBloomPass.js";

export const MODELS = {
  jarvis: { title: "JARVIS", path: "models/jarvis-holo" },
  ultron: { title: "ULTRON", path: "models/avatars/ultron" },
  sexta: { title: "SEXTA-FEIRA", path: "models/avatars/sexta" },
  mark3: { title: "MARK III", path: "models/avatars/mark3" },
  hulk: { title: "HULKBUSTER", path: "models/avatars/hulk" },
  stealth: { title: "STEALTH", path: "models/avatars/stealth" },
  vibranium: { title: "VIBRANIUM", path: "models/avatars/vibranium" },
  matrix: { title: "MATRIX", path: "models/avatars/matrix" },
};
// The JARVIS core was exported before layers had roles: by name.
const JARVIS_ROLES = { "Anel Diagonal": "orbit", "Anel Equatorial": "orbit", "Arcos A": "detail", "Arcos B": "detail",
  Calotas: "shell", "Camada Media": "shell", Casca: "shell", Nucleo: "glow" };
export const DEFAULTS = {
  id: "", shell: "", glow: "", scale: 100, float: 50, spin: 50, orbit: 50, opacity: 70, pulse: 50, explode: 0, voice: true,
  parts: { shell: true, detail: true, glow: true, orbit: true },
};
const EXPLODE = { shell: 0, detail: 0.16, glow: -0.12, orbit: 0.4 };

/** Which model a theme shows: the one chosen in "faça você mesmo", else the preset's own, else JARVIS. */
export function modelOf(theme) {
  const chosen = theme?.model?.id;
  if (chosen && MODELS[chosen]) return chosen;
  const preset = theme?.preset === "reator" ? "jarvis" : theme?.preset;
  return MODELS[preset] ? preset : "jarvis";
}

const vertexShader = `
  attribute float flow;
  attribute float rnd;
  varying float vFlow;
  varying float vRnd;
  void main() {
    vFlow = flow;
    vRnd = rnd;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// Node for node the Blender material; uLevel stands in for the baked audio images.
const fragmentShader = `
  uniform vec3 uBase;
  uniform vec3 uHot;
  uniform float uTempo;
  uniform float uPulseTempo;
  uniform float uTime;
  uniform float uGlow;
  uniform float uCoverage;
  uniform float uIntensity;
  uniform float uSens;
  uniform float uLevel;
  uniform float uPulseScale;
  uniform float uShimmerRnd, uShimmerCycles, uShimmerMul, uShimmerAdd, uShimmerScale, uShimmerFloor;
  uniform float uPulseFlow, uPulseCycles, uPulseRnd, uPulseFrom, uPulseTo, uPulseGain;
  uniform float uBandGain, uLevelGain, uLevelOffset, uBandColor, uIntensityGain;
  varying float vFlow;
  varying float vRnd;
  void main() {
    float shimmer = sin((uTempo * uShimmerCycles + vRnd * uShimmerRnd) * 6.283) * uShimmerMul + uShimmerAdd;
    float pulse = smoothstep(uPulseFrom, uPulseTo, fract(vFlow * uPulseFlow + uPulseTempo * uPulseCycles + vRnd * uPulseRnd));
    pulse *= pulse * uPulseScale;
    // Each trace listens to its own "band" of the voice, as each read one band of the spectrum.
    float band = uLevel * (0.55 + 0.45 * sin(vRnd * 37.0 + uTime * 7.0 + vRnd * vRnd * 13.0));
    float audio = band * band * uBandGain + uLevel * uLevelGain + uLevelOffset;
    float strength = (pulse * uPulseGain + shimmer * uShimmerScale + uShimmerFloor) * (uSens * audio + 1.0)
      * uGlow * uIntensity * uIntensityGain * uCoverage;
    vec3 color = uHot * max(pulse, min(band * uSens * uBandColor, 1.0)) + uBase;
    gl_FragColor = vec4(color * strength, 1.0);
  }`;

const cache = new Map(); // model id -> Promise<{manifest, buffer}>

// A driven channel from the exporter: constant, spin ("frame*rate*vel"), sway or voice scale.
function driven(spec, frame, spinFrame, voice) {
  let value = spec.base ?? 0;
  if (spec.rate !== undefined) value += spec.rate * spinFrame;
  if (spec.freq !== undefined) value += (spec.amp ?? 1) * Math.sin(frame * spec.freq + (spec.phase ?? 0));
  if (spec.voice !== undefined) value += spec.voice * voice;
  return value;
}

function linear(hex) {
  const color = new THREE.Color(hex); // sRGB in, linear inside (three's color management)
  return new THREE.Vector3(color.r, color.g, color.b);
}

function defaultVoice() {
  const voice = window.jarvisVoice || {};
  const speech = voice.speech;
  let level = 0;
  if (voice.state === "speaking" && speech?.values?.length) {
    const index = Math.floor((Date.now() / 1000 - speech.start) * speech.fps);
    if (index >= 0 && index <= speech.values.length + 3) level = speech.values[Math.min(index, speech.values.length - 1)] || 0;
  } else if (voice.state === "armed") {
    level = Math.min(1, (voice.mic || 0) * 2.5);
  }
  return { state: voice.state || "idle", level };
}

export class Hologram {
  /**
   * host: the element it fills; options: canvas, load(path, kind) -> json | ArrayBuffer, visible() -> bool,
   * voice() -> {state, level}, interactive (drag to turn, wheel to zoom), fit (share of the smaller side).
   */
  constructor(host, options = {}) {
    this.host = host;
    this.options = options;
    this.config = { ...DEFAULTS, parts: { ...DEFAULTS.parts } };
    this.model = "";
    this.layers = [];
    this.view = { yaw: 0, pitch: 0, zoom: 1, velocity: 0, drag: null };
    this.frame = 0;
    this.ticket = 0;
    const canvas = options.canvas || document.createElement("canvas");
    if (!canvas.parentNode) host.prepend(canvas);
    canvas.classList.add("no-hue"); // drawn in its own colors: the theme's hue shift is not for it
    canvas.style.filter = "";
    this.canvas = canvas;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (error) {
      this.failed = `webgl: ${error?.message || error}`;
      return;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(27, 1, 0.1, 100);
    this.turn = new THREE.Group(); // the user's drag
    this.world = new THREE.Group();
    this.world.rotation.x = -Math.PI / 2; // Blender axes (Z up) into the web scene (Y up)
    this.root = new THREE.Group();
    this.root.rotation.order = "ZYX";
    this.world.add(this.root);
    this.turn.add(this.world);
    this.scene.add(this.turn);
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.3, 0, 0.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.clock = { frame: 0, spin: 0, orbit: 0, tempo: 0, pulse: 0 };
    this.smooth = { level: 0, voice: 0, intensity: 1, spin: 1, pulse: 1, born: 0 };
    this.last = performance.now();
    new ResizeObserver(() => {
      this.resize();
      this.wake();
    }).observe(host);
    if (options.interactive) this.setupInput();
    document.addEventListener("visibilitychange", () => this.wake());
  }

  async load(id) {
    if (!cache.has(id)) {
      const path = MODELS[id].path;
      const loader = this.options.load || (async (file, kind) => {
        const response = await fetch(file);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return kind === "json" ? response.json() : response.arrayBuffer();
      });
      const job = Promise.all([loader(`${path}.json`, "json"), loader(`${path}.bin`, "binary")])
        .then(([manifest, buffer]) => ({ manifest, buffer }));
      cache.set(id, job);
      job.catch(() => cache.delete(id));
    }
    return cache.get(id);
  }

  /** Shows a model (from MODELS); resolves once it is on screen. */
  async setModel(id) {
    if (this.failed) return;
    id = MODELS[id] ? id : "jarvis";
    if (id === this.model && this.layers.length) return;
    const ticket = ++this.ticket;
    this.host.classList.add("is-loading");
    let data;
    try {
      data = await this.load(id);
    } catch (error) {
      this.host.dataset.fallback = `modelo: ${error?.message || error}`;
      this.host.classList.add("is-fallback");
      this.host.classList.remove("is-loading");
      return;
    }
    if (ticket !== this.ticket) return;
    this.build(id, data.manifest, data.buffer);
    this.host.classList.remove("is-loading", "is-fallback");
    delete this.host.dataset.fallback;
    this.host.classList.add("is-ready");
    this.host.dataset.model = id;
    this.options.onModel?.(id, data.manifest);
  }

  build(id, manifest, buffer) {
    for (const layer of this.layers) {
      this.root.remove(layer);
      layer.geometry.dispose();
      layer.material.dispose();
    }
    this.model = id;
    this.manifest = manifest;
    const shader = manifest.shader;
    this.layers = manifest.objects.map((item) => {
      const view = (spec, Type) => new Type(buffer, spec.offset, spec.length);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(view(item.position, Float32Array), 3));
      geometry.setAttribute("flow", new THREE.BufferAttribute(view(item.flow, Float32Array), 1));
      geometry.setAttribute("rnd", new THREE.BufferAttribute(view(item.rnd, Float32Array), 1));
      geometry.setIndex(new THREE.BufferAttribute(view(item.index, Uint32Array), 1));
      const uniforms = {
        uBase: { value: new THREE.Vector3(...(item.color || shader.base)) },
        uHot: { value: new THREE.Vector3(...shader.hot) },
        uTempo: { value: 0 }, uPulseTempo: { value: 0 }, uTime: { value: 0 }, uGlow: { value: item.glow ?? 1 },
        uCoverage: { value: 1 }, uIntensity: { value: 1 }, uSens: { value: manifest.root?.sensibilidade ?? 1 },
        uLevel: { value: 0 }, uPulseScale: { value: 1 },
      };
      for (const [key, value] of Object.entries(shader)) {
        if (typeof value === "number") uniforms[`u${key[0].toUpperCase()}${key.slice(1)}`] = { value };
      }
      // Opaque lines with depth, like Blender's tubes: crossings do not add up and blow out.
      const lines = new THREE.LineSegments(geometry, new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms }));
      lines.rotation.order = "ZYX"; // Blender's XYZ Euler: X first, then Y, then Z
      lines.userData = { ...item, role: item.role || JARVIS_ROLES[item.name] || "shell" };
      this.root.add(lines);
      return lines;
    });
    const glare = manifest.bloom || { threshold: 0.6, strength: 0.75 };
    this.bloom.strength = glare.strength * 0.4;
    this.bloom.threshold = glare.threshold;
    this.renderer.toneMappingExposure = 2 ** (manifest.view?.exposure ?? 0);
    this.smooth.born = 0;
    this.apply();
    this.resize();
    this.wake();
  }

  /** The "faça você mesmo" settings (DEFAULTS' keys); colors are "#rrggbb" or "" for the model's own. */
  setConfig(config) {
    this.config = { ...DEFAULTS, ...(config || {}), parts: { ...DEFAULTS.parts, ...(config?.parts || {}) } };
    this.apply();
    this.wake();
  }

  apply() {
    if (!this.layers.length) return;
    const config = this.config;
    const shader = this.manifest.shader;
    const hot = config.glow ? linear(config.glow) : new THREE.Vector3(...shader.hot);
    for (const layer of this.layers) {
      const item = layer.userData;
      const uniforms = layer.material.uniforms;
      // The model's colors (a layer may have its own, like white eyes), unless the user picked others.
      let base = item.color ? new THREE.Vector3(...item.color) : new THREE.Vector3(...shader.base);
      if (item.role === "glow" && config.glow) base = linear(config.glow);
      else if (item.role !== "glow" && config.shell) base = linear(config.shell);
      uniforms.uBase.value.copy(base);
      uniforms.uHot.value.copy(hot);
      uniforms.uPulseScale.value = config.pulse / 50;
      layer.visible = config.parts[item.role] !== false;
    }
  }

  resize() {
    if (!this.renderer) return;
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    const distance = (this.manifest?.camera?.distance ?? 6.1) / this.view.zoom;
    this.camera.position.set(0, 0, distance); // Blender's camera at (0, -distance, 0), looking along +Y
    this.camera.aspect = width / height;
    const halfTan = 1.2 / (this.manifest?.camera?.distance ?? 6.1) / (this.options.fit ?? 0.82);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfTan / Math.min(1, this.camera.aspect)));
    this.camera.updateProjectionMatrix();
    // A WebGL line is one pixel and Blender's tubes are thinner: each layer's light is scaled by how
    // many pixels its tube would cover, so a line carries as much light as in the render.
    const pixelsPerUnit = (height * this.renderer.getPixelRatio()) / (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    for (const layer of this.layers) {
      const tube = 2 * (layer.userData.thickness || 0.002) * pixelsPerUnit;
      layer.material.uniforms.uCoverage.value = Math.min(1, Math.max(0.25, tube));
    }
  }

  visible() {
    return !document.hidden && (this.options.visible ? this.options.visible() : true);
  }

  wake() {
    if (!this.frame && this.layers.length && this.visible()) {
      this.last = performance.now();
      this.frame = window.requestAnimationFrame((now) => this.render(now));
    }
  }

  render(now) {
    this.frame = 0;
    if (!this.visible()) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const config = this.config;
    const sample = config.voice === false ? { state: "idle", level: 0 } : (this.options.voice || defaultVoice)();
    const state = sample.state || "idle";
    const calm = document.documentElement.classList.contains("reduce-motion");
    const ease = (current, goal, rate) => current + (goal - current) * Math.min(1, dt * rate);
    const smooth = this.smooth;
    // Speaking: the voice envelope. Listening: the microphone. Scaled down: the speech envelope
    // peaks every syllable, Blender's baked spectrum was smoother.
    const level = 0.55 * (sample.level || 0);
    smooth.level = ease(smooth.level, level, level > smooth.level ? 22 : 7);
    smooth.voice = ease(smooth.voice, state === "speaking" ? level : 0, 12);
    smooth.intensity = ease(smooth.intensity, state === "muted" ? 0.45 : state === "armed" ? 1.15 : 1, 4);
    smooth.spin = ease(smooth.spin, state === "thinking" ? 1.8 : 1, 3);
    smooth.pulse = ease(smooth.pulse, state === "thinking" ? 2.2 : state === "armed" ? 1.15 : 1, 3);
    smooth.born = Math.min(1, smooth.born + dt * 1.6); // materializes when a model comes in

    const manifest = this.manifest;
    const fps = manifest.fps || 24;
    const loopSeconds = (manifest.shader?.loopFrames || 720) / fps;
    const pace = calm ? 0.25 : 1;
    const spin = config.spin / 50;
    const clock = this.clock;
    clock.frame += dt * fps * pace;
    clock.spin += dt * fps * pace * (manifest.root?.velocidade ?? 1) * smooth.spin * spin;
    clock.orbit += dt * fps * pace * (manifest.root?.velocidade ?? 1) * smooth.spin * spin * (config.orbit / 50);
    clock.tempo += (dt * pace) / loopSeconds;
    clock.pulse += (dt * pace * smooth.pulse) / loopSeconds;
    const root = manifest.root || {};
    const float = config.float / 50;
    if (root.float) this.root.position.set(...root.float.map((channel) => driven(channel, clock.frame, clock.spin, 0) * float));
    if (root.sway) this.root.rotation.set(...root.sway.map((channel) => driven(channel, clock.frame, clock.spin, 0) * Math.min(1.5, float)));
    const intensity = (root.brilho ?? 1) * (1 + (manifest.shader?.voiceIntensity ?? 0.6) * smooth.voice) * smooth.intensity
      * (config.opacity / 70) * (0.15 + 0.85 * smooth.born);
    const scale = config.scale / 100;
    const explode = config.explode / 100;
    for (const layer of this.layers) {
      const item = layer.userData;
      const orbit = item.role === "orbit";
      layer.rotation.set(...item.rotation.map((channel) => driven(channel, clock.frame, orbit ? clock.orbit : clock.spin, smooth.voice)));
      const spread = (1 + explode * (EXPLODE[item.role] ?? 0)) * scale * (0.92 + 0.08 * smooth.born);
      layer.scale.set(...item.scale.map((channel) => driven(channel, clock.frame, clock.spin, smooth.voice) * spread));
      const uniforms = layer.material.uniforms;
      uniforms.uTempo.value = clock.tempo;
      uniforms.uPulseTempo.value = clock.pulse;
      uniforms.uTime.value = now / 1000;
      uniforms.uIntensity.value = intensity;
      uniforms.uLevel.value = smooth.level;
    }
    const view = this.view;
    if (!view.drag) {
      view.yaw += view.velocity;
      view.velocity *= 0.93;
    }
    this.turn.rotation.set(view.pitch, view.yaw, 0);
    this.composer.render();
    this.frame = window.requestAnimationFrame((time) => this.render(time));
  }

  resetView() {
    Object.assign(this.view, { yaw: 0, pitch: 0, zoom: 1, velocity: 0 });
    this.resize();
  }

  setupInput() {
    const canvas = this.canvas;
    canvas.style.touchAction = "none";
    const view = this.view;
    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId);
      view.drag = { x: event.clientX, y: event.clientY };
      this.host.classList.add("is-dragging");
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!view.drag) return;
      const dx = (event.clientX - view.drag.x) / 160;
      const dy = (event.clientY - view.drag.y) / 200;
      view.drag = { x: event.clientX, y: event.clientY };
      view.yaw += dx;
      view.velocity = dx * 0.3;
      view.pitch = Math.max(-1.1, Math.min(1.1, view.pitch + dy));
    });
    const release = () => {
      view.drag = null;
      this.host.classList.remove("is-dragging");
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      view.zoom = Math.max(0.55, Math.min(2.6, view.zoom * Math.exp(-event.deltaY * 0.0012)));
      this.resize();
    }, { passive: false });
    canvas.addEventListener("dblclick", () => this.resetView());
  }
}
