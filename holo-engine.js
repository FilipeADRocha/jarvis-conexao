/* The assistant's 3D model, for every place it appears: the dialogue, the background window (orb),
   CUSTOMIZAÇÃO and the phone app. Two kinds of model come from Blender:
   - "lines": a hologram of glowing traces (tools/export_hologram.py for the JARVIS core,
     tools/avatar_builder.py for Ultron and Sexta-feira). Each layer keeps its spin and sway, and the shader
     is the "JARVIS Holograma" material: light pulses running along every trace, shimmer, per-layer glow,
     AgX color and the compositor's bloom;
   - "solid": a shaded character (tools/character_builder.py: HAL 9000, KinitoPET and Verity; the user's own
     textured models: tools/glados_builder.py GLaDOS, sentinel_builder.py the Sentinela, auto_builder.py AUTO),
     a tree of named parts that BEHAVIORS below bring to life: blinking eyes, gills, the helm, living
     tentacles, a body that turns after the mouse, a face drawn live on a canvas.
   The voice and the microphone drive both; the "faça você mesmo" settings scale, recolor, explode and
   pace them. The canvas is transparent: the page shows around the model and through its gaps. */
import * as THREE from "three";
import { EffectComposer } from "./vendor/three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "./vendor/three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "./vendor/three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "./vendor/three/addons/postprocessing/UnrealBloomPass.js";

export const MODELS = {
  jarvis: { title: "JARVIS", path: "models/jarvis-holo" },
  ultron: { title: "ULTRON", path: "models/avatars/ultron" },
  sexta: { title: "SEXTA-FEIRA", path: "models/avatars/sexta" },
  sentinela: { title: "SENTINELA", path: "models/avatars/sentinela" },
  hal: { title: "HAL 9000", path: "models/avatars/hal" },
  kinito: { title: "KINITOPET", path: "models/avatars/kinito" },
  verity: { title: "VERITY", path: "models/avatars/verity" },
  glados: { title: "GLaDOS", path: "models/avatars/glados" },
  auto: { title: "AUTO", path: "models/avatars/auto" },
};
// The JARVIS core was exported before layers had roles: by name.
const JARVIS_ROLES = { "Anel Diagonal": "orbit", "Anel Equatorial": "orbit", "Arcos A": "detail", "Arcos B": "detail",
  Calotas: "shell", "Camada Media": "shell", Casca: "shell", Nucleo: "glow" };
export const DEFAULTS = {
  id: "", shell: "", glow: "", scale: 100, float: 50, spin: 50, orbit: 50, opacity: 70, pulse: 50, explode: 0, voice: true,
  parts: { shell: true, detail: true, glow: true, orbit: true },
};
const EXPLODE = { shell: 0, detail: 0.16, glow: -0.12, orbit: 0.4 };
const TONES = { neutral: THREE.NeutralToneMapping, agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping };

// Older names of models, in themes saved before: "Reator Arc" is now JARVIS, "Matrix" is the Sentinela.
const RENAMED = { reator: "jarvis", matrix: "sentinela" };

/** Which model a theme shows: the one chosen in "faça você mesmo", else the preset's own, else JARVIS. */
export function modelOf(theme) {
  const chosen = RENAMED[theme?.model?.id] || theme?.model?.id;
  if (chosen && MODELS[chosen]) return chosen;
  const preset = RENAMED[theme?.preset] || theme?.preset;
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

// three's OutputPass shader (tone mapping, sRGB) that also writes coverage: the model's own alpha, or the
// brightness of the glow around it. With the bloom added to the color only (see the constructor), the
// canvas is transparent wherever nothing is drawn: no black square behind the model.
const OUTPUT = `
  precision highp float;
  uniform sampler2D tDiffuse;
  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D( tDiffuse, vUv );
    float cover = clamp( gl_FragColor.a, 0.0, 1.0 );
    #ifdef LINEAR_TONE_MAPPING
      gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
    #elif defined( REINHARD_TONE_MAPPING )
      gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
    #elif defined( CINEON_TONE_MAPPING )
      gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
    #elif defined( ACES_FILMIC_TONE_MAPPING )
      gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
    #elif defined( AGX_TONE_MAPPING )
      gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
    #elif defined( NEUTRAL_TONE_MAPPING )
      gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
    #endif
    #ifdef SRGB_TRANSFER
      gl_FragColor = sRGBTransferOETF( gl_FragColor );
    #endif
    vec3 shown = clamp( gl_FragColor.rgb, 0.0, 1.0 );
    // A wide glow fades out before the canvas edge, where it would show the canvas's square.
    float edge = smoothstep( 0.0, 0.14, min( min( vUv.x, 1.0 - vUv.x ), min( vUv.y, 1.0 - vUv.y ) ) );
    shown *= mix( edge, 1.0, cover );
    gl_FragColor = vec4( shown, max( cover, max( shown.r, max( shown.g, shown.b ) ) ) );
  }`;

// The Sentinela's tentacles, alive. Each vertex knows how free it is (wave.x: 0 in the body, 1 at the tips),
// its own phase (wave.y: each tentacle on its own time) and how near the ground it hangs (wave.z). They writhe,
// the wave running out to the tips and breathing stronger and weaker; the tips on the ground lift, reach a
// little and settle again, one tentacle after another; and now and then a few of them twitch (uTwitch, around
// the phase uTwitchPhase). Blender plays the same with a geometry-nodes modifier (tools/sentinel_builder.py).
const WAVE = `{
    float flex = wave.x * wave.x;
    float t = uWaveTime;
    float breath = 0.75 + 0.35 * sin(t * 0.37 + wave.y * 0.5);
    vec3 sway = vec3(sin(t * 1.7 + wave.y - wave.x * 5.0),
                     sin(t * 1.3 + wave.y * 1.6 - wave.x * 4.2 + 1.3),
                     cos(t * 1.5 + wave.y * 0.7 - wave.x * 4.6));
    float twitch = uTwitch * exp(-8.0 * pow(sin((wave.y - uTwitchPhase) * 0.5), 2.0));
    transformed += sway * uWaveAmp * flex * (breath + 2.2 * twitch);
    float curl = max(0.0, sin(t * 0.45 + wave.y * 1.3));
    curl = curl * curl * curl;
    transformed.z += curl * uLift * flex * wave.z;
    transformed.y -= curl * uLift * 0.6 * flex * wave.z;
  }`;

const cache = new Map(); // model id -> Promise<{manifest, buffer, images}>

// A model's textures travel inside its .bin as JPEG: decoded once, shared by every hologram of the page.
async function decodeImages(manifest, buffer) {
  return Promise.all((manifest.images || []).map(async (spec) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(buffer, spec.offset, spec.length)], { type: spec.type || "image/jpeg" }));
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } finally {
      URL.revokeObjectURL(url);
    }
    return image;
  }));
}
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const ease = (current, goal, rate, dt) => current + (goal - current) * Math.min(1, dt * rate);

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

// A soft studio for the solid models' reflections: a bright ceiling, a dim floor and three softboxes.
function studio(renderer) {
  const scene = new THREE.Scene();
  const room = new THREE.SphereGeometry(10, 48, 24);
  const position = room.attributes.position;
  const colors = [];
  for (let index = 0; index < position.count; index += 1) {
    const up = position.getY(index) / 10;
    const light = up > 0 ? 0.32 + 0.6 * up : 0.32 + 0.28 * up;
    colors.push(light * 0.93, light * 0.97, light);
  }
  room.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(room, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  for (const [width, height, x, y, z, power] of [[7, 5, -5, 5, 7, 7], [4, 7, 7, 1, -4, 4.5], [10, 2, 0, 9, 1, 3.5]]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(power), side: THREE.DoubleSide }));
    panel.position.set(x, y, z);
    panel.lookAt(0, 0, 0);
    scene.add(panel);
  }
  const generator = new THREE.PMREMGenerator(renderer);
  const texture = generator.fromScene(scene, 0.04).texture;
  generator.dispose();
  return texture;
}

/* ---------- the characters' life (solid models): one function per model, called every frame ----------
   rig: the parts by name (node), their rest pose (reset before each frame), per-model state, the face canvas.
   ctx: t (animation seconds, paced), dt, time (real seconds), state and the voice (level, talk), float,
   secondary (the "órbitas" speed), pointer (-1..1 over the canvas), motion (the orb window's speed, px/s),
   camera. */

const wobble = (t, seed) => 0.5 * Math.sin(t * 1.3 + seed) + 0.3 * Math.sin(t * 2.7 + seed * 1.7) + 0.2 * Math.sin(t * 4.1 + seed * 2.3);

function blinkAmount(state, time, every = [2.5, 6], length = 0.16) {
  state.nextBlink ??= time + 1.5 + Math.random() * 2;
  if (time < state.nextBlink) return 0;
  const k = (time - state.nextBlink) / length;
  if (k >= 1) {
    state.nextBlink = time + every[0] + Math.random() * (every[1] - every[0]);
    return 0;
  }
  return Math.sin(k * Math.PI);
}

function glance(state, ctx, reach = 1) {
  // Where idle eyes wander: a new point every few seconds, the mouse pointer when it moves.
  if (ctx.time > (state.nextGlance ?? 0)) {
    state.glanceGoal = { x: (Math.random() - 0.5) * reach, y: (Math.random() - 0.5) * reach * 0.6 };
    state.nextGlance = ctx.time + 1.2 + Math.random() * 3.5;
  }
  const goal = ctx.pointer.active ? ctx.pointer : state.glanceGoal || { x: 0, y: 0 };
  state.gaze ??= { x: 0, y: 0 };
  state.gaze.x = ease(state.gaze.x, goal.x, 9, ctx.dt);
  state.gaze.y = ease(state.gaze.y, goal.y, 9, ctx.dt);
  return state.gaze;
}

const _point = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _ray = new THREE.Vector3();
const _local = new THREE.Vector3();
const _turn = new THREE.Quaternion();

/** Turns `object` (resting with its front along -Y) toward a point in world space, at most `limit` radians. */
function lookAt(object, base, world, limit, state, key, rate, dt) {
  object.parent.updateWorldMatrix(true, false);
  _point.copy(world);
  object.parent.worldToLocal(_point);
  _point.sub(base.position).normalize();
  _forward.set(0, -1, 0).applyQuaternion(base.quaternion);
  const angle = _forward.angleTo(_point);
  if (angle > limit) _point.lerp(_forward, 1 - limit / angle).normalize();
  _turn.setFromUnitVectors(_forward, _point).multiply(base.quaternion);
  state[key] ??= base.quaternion.clone();
  state[key].slerp(_turn, Math.min(1, dt * rate));
  object.quaternion.copy(state[key]);
}

const VERITY_YELLOW = "#ffd21a";

function drawVerity(face, look) {
  const { context: c, canvas } = face;
  const size = canvas.width;
  const px = (x) => size / 2 + x * (size / 2);
  const pz = (z) => size / 2 - z * (size / 2);
  const unit = size / 2;
  const sketch = look.glitch ? face.scratch : canvas;
  const g = look.glitch ? face.scratchContext : c;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.fillStyle = look.yellow;
  g.fillRect(0, 0, size, size);
  const oval = (x, z, rx, rz, fill) => {
    g.beginPath();
    g.ellipse(px(x), pz(z), rx * unit, rz * unit, 0, 0, Math.PI * 2);
    g.fillStyle = fill;
    g.fill();
  };
  if (!look.glitch) {
    const squint = 1 - 0.92 * look.blink;
    const eye = look.open > 0.05 ? [0.068, 0.12] : [0.075, 0.135];
    for (const side of [-1, 1]) oval(side * 0.24, 0.17, eye[0], Math.max(0.01, eye[1] * squint), "#111");
    if (look.open > 0.05) { // talking: the wide open "D" mouth with the tongue at the bottom
      const depth = 0.16 + 0.42 * look.open;
      g.beginPath();
      g.moveTo(px(-0.47), pz(-0.07));
      g.quadraticCurveTo(px(0), pz(-0.15), px(0.47), pz(-0.07));
      g.bezierCurveTo(px(0.45), pz(-0.07 - depth * 0.95), px(-0.45), pz(-0.07 - depth * 0.95), px(-0.47), pz(-0.07));
      g.closePath();
      g.fillStyle = "#151010";
      g.fill();
      g.save();
      g.clip();
      g.beginPath();
      g.ellipse(px(0.02), pz(-0.07 - depth * 0.78), 0.27 * unit, 0.16 * unit * (0.6 + look.open * 0.5), 0, 0, Math.PI * 2);
      g.fillStyle = "#e9a31c";
      g.fill();
      g.restore();
    } else { // the thin smile with its curled ends
      g.beginPath();
      g.moveTo(px(-0.72), pz(-0.2));
      g.quadraticCurveTo(px(0), pz(-1.0), px(0.72), pz(-0.2));
      g.strokeStyle = "#111";
      g.lineWidth = 0.034 * unit;
      g.lineCap = "round";
      g.stroke();
      for (const side of [-1, 1]) {
        g.save();
        g.translate(px(side * 0.73), pz(-0.19));
        g.rotate(side * -0.55);
        g.beginPath();
        g.ellipse(0, 0, 0.026 * unit, 0.05 * unit, 0, 0, Math.PI * 2);
        g.fillStyle = "#111";
        g.fill();
        g.restore();
      }
    }
    face.texture.needsUpdate = true;
    return;
  }
  // The glitch: hollow eyes in a bruised shade and a torn grin full of teeth.
  for (const side of [-1, 1]) {
    const shade = g.createRadialGradient(px(side * 0.23), pz(0.2), 0, px(side * 0.23), pz(0.2), 0.24 * unit);
    shade.addColorStop(0, "rgba(60, 12, 18, 0.95)");
    shade.addColorStop(0.55, "rgba(120, 40, 30, 0.55)");
    shade.addColorStop(1, "rgba(160, 80, 20, 0)");
    g.fillStyle = shade;
    g.fillRect(0, 0, size, size);
    oval(side * 0.23, 0.2, 0.05, 0.1, "#050505");
  }
  const corner = 0.8;
  const top = (x) => -0.08 - 0.3 * (1 - (x / corner) ** 2);
  const bottom = (x) => -0.04 - 0.66 * (1 - (x / corner) ** 2) ** 0.8;
  g.beginPath();
  for (let i = 0; i <= 40; i += 1) {
    const x = -corner + (2 * corner * i) / 40;
    const jag = i % 2 ? 0.018 : -0.012;
    if (i === 0) g.moveTo(px(x), pz(top(x)));
    else g.lineTo(px(x), pz(top(x) + jag * Math.random()));
  }
  for (let i = 40; i >= 0; i -= 1) {
    const x = -corner + (2 * corner * i) / 40;
    g.lineTo(px(x), pz(bottom(x) - 0.02 * Math.random()));
  }
  g.closePath();
  g.fillStyle = "#070505";
  g.fill();
  g.fillStyle = "#f4f1ea";
  for (const [edge, down, count] of [[top, -1, 12], [bottom, 1, 11]]) {
    for (let i = 0; i < count; i += 1) {
      const x = -corner * 0.86 + (1.72 * corner * (i + 0.5)) / count;
      const z = edge(x);
      const width = 0.11 * (1 - Math.abs(x) / corner * 0.5);
      const height = (0.14 + 0.03 * Math.sin(i * 2.3)) * (1 - Math.abs(x) / corner * 0.55);
      g.save();
      g.translate(px(x), pz(z));
      g.rotate((x / corner) * 0.35 * down);
      g.fillRect((-width / 2) * unit, down < 0 ? 0 : -height * unit, width * unit * 0.86, height * unit);
      g.restore();
    }
  }
  g.strokeStyle = "#090606";
  g.lineWidth = 0.012 * unit;
  for (let i = 0; i < 26; i += 1) { // ink scratches around the grin
    const x = -corner + Math.random() * corner * 2;
    const z = (Math.random() < 0.5 ? top(x) : bottom(x)) + (Math.random() - 0.5) * 0.06;
    g.beginPath();
    g.moveTo(px(x), pz(z));
    g.lineTo(px(x + (Math.random() - 0.5) * 0.1), pz(z + (Math.random() - 0.5) * 0.1));
    g.stroke();
  }
  // Torn into bands, shifted sideways, with a few dead blocks: the picture of a glitch.
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = look.yellow;
  c.fillRect(0, 0, size, size);
  let y = 0;
  while (y < size) {
    const band = 6 + Math.random() * 44;
    const shift = Math.random() < 0.3 ? (Math.random() - 0.5) * 44 : 0;
    c.drawImage(sketch, 0, y, size, band, shift, y, size, band);
    y += band;
  }
  c.globalCompositeOperation = "multiply";
  c.globalAlpha = 0.5;
  c.drawImage(sketch, 7, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = "source-over";
  for (let i = 0; i < 7; i += 1) {
    c.fillStyle = ["#ff2a2a", "#2af0ff", "#111", "#fff27a"][i % 4];
    c.globalAlpha = 0.35 + Math.random() * 0.4;
    c.fillRect(Math.random() * size, Math.random() * size, 20 + Math.random() * 120, 2 + Math.random() * 9);
  }
  c.globalAlpha = 1;
  face.texture.needsUpdate = true;
}

const BEHAVIORS = {
  // HAL 9000 stands still: no float, no turn; only the eye's light lives (the common glow below).
  hal() {},

  kinito(rig, ctx) {
    const s = rig.state;
    const body = rig.node("corpo");
    const head = rig.node("cabeca");
    // Riding: while the background window is dragged he leans into the motion on his green board.
    const speed = Math.hypot(ctx.motion.x, ctx.motion.y);
    s.ride = ease(s.ride ?? 0, speed > 60 ? 1 : 0, speed > 60 ? 7 : 2.2, ctx.dt);
    s.lean = ease(s.lean ?? 0, clamp(ctx.motion.x / 900, -0.42, 0.42), 6, ctx.dt);
    const board = rig.node("prancha");
    board.visible = s.ride > 0.04;
    board.scale.multiplyScalar(0.2 + 0.8 * s.ride);
    board.rotateY(-s.lean * 0.35);
    body.rotateY(s.lean * s.ride);
    body.position.z += 0.06 * s.ride + 0.015 * ctx.float * Math.sin(ctx.t * 2.1) * (1 - s.ride);
    body.scale.z *= 1 + clamp(-ctx.motion.y / 4000, -0.08, 0.08) * s.ride;
    head.rotateY(0.07 * Math.sin(ctx.t * 0.9) + s.lean * 0.25 * s.ride);
    head.rotateX(0.04 * Math.sin(ctx.t * 0.7 + 1) - ctx.talk * 0.35 * Math.abs(Math.sin(ctx.time * 8.5)));
    rig.each("gill", (gill, i) => {
      gill.rotateY((0.13 + 0.25 * s.ride + ctx.talk * 0.4) * Math.sin(ctx.t * (3 + s.ride * 5) * ctx.secondary + i * 1.1));
    });
    const blink = blinkAmount(s, ctx.time);
    const gaze = glance(s, ctx, 0.8);
    const lookX = clamp(gaze.x * 0.35 + ctx.motion.x / 2500, -0.45, 0.45);
    for (const side of ["e", "d"]) {
      rig.node(`palpebra_${side}`).rotateX(blink * 0.75);
      const pupil = rig.node(`pupila_${side}`);
      pupil.rotateZ(lookX);
      pupil.rotateX(clamp(-gaze.y * 0.3, -0.3, 0.3));
    }
  },

  verity(rig, ctx) {
    const s = rig.state;
    const ball = rig.node("bola");
    ball.rotateZ(0.09 * Math.sin(ctx.t * 0.55));
    ball.rotateX(0.05 * Math.sin(ctx.t * 0.8 + 1) - ctx.talk * 0.12 * Math.abs(Math.sin(ctx.time * 7)));
    ball.position.z += 0.04 * ctx.float * Math.sin(ctx.t * 1.5);
    // Glitches come only while nobody is talking to it.
    const quiet = !["armed", "thinking", "speaking"].includes(ctx.state);
    s.nextGlitch ??= ctx.time + 4 + Math.random() * 6;
    if (!quiet) s.nextGlitch = Math.max(s.nextGlitch, ctx.time + 5);
    if (quiet && ctx.time >= s.nextGlitch) {
      s.glitchUntil = ctx.time + 0.25 + Math.random() * 0.7;
      s.nextGlitch = ctx.time + 7 + Math.random() * 15;
    }
    const glitch = quiet && ctx.time < (s.glitchUntil ?? 0);
    s.open = ease(s.open ?? 0, ctx.speaking ? clamp(0.3 + ctx.talk * 2.4, 0, 1) : 0, 16, ctx.dt);
    const blink = glitch ? 0 : blinkAmount(s, ctx.time, [3, 7]);
    const yellow = ctx.config.shell || VERITY_YELLOW;
    if (glitch) {
      ball.position.x += (Math.random() - 0.5) * 0.09;
      ball.position.z += (Math.random() - 0.5) * 0.05;
      ball.rotateZ((Math.random() - 0.5) * 0.35);
      ball.scale.x *= 1 + (Math.random() - 0.5) * 0.12;
    }
    const key = glitch ? `g${Math.floor(ctx.time * 18)}` : `${s.open.toFixed(2)}|${blink.toFixed(2)}|${yellow}`;
    if (rig.face && key !== s.drawn) {
      s.drawn = key;
      drawVerity(rig.face, { open: s.open, blink, glitch, yellow });
      rig.material("costas")?.color.set(yellow);
    }
  },

  glados(rig, ctx) {
    const s = rig.state;
    const body = rig.node("corpo");
    const head = rig.node("cabeca");
    // What she follows: the mouse (where its ray crosses a plane just in front of her), else the user (the camera).
    s.target ??= new THREE.Vector3();
    if (ctx.pointer.active) {
      _ray.set(ctx.pointer.x, ctx.pointer.y, 0.5).unproject(ctx.camera).sub(ctx.camera.position).normalize();
      s.target.copy(ctx.camera.position).addScaledVector(_ray, (0.6 - ctx.camera.position.z) / _ray.z);
    } else {
      s.target.copy(ctx.camera.position);
    }
    // The body turns on the ceiling plate's center, inside the plate, all the way round if it must, until the
    // side her eye is on faces what she follows; the head aims the rest of the way.
    body.parent.updateWorldMatrix(true, false);
    _local.copy(s.target);
    body.parent.worldToLocal(_local);
    const pivot = rig.base.get(body).position;
    if (s.rest === undefined) {
      _forward.set(0, -1, 0).applyQuaternion(rig.base.get(head).quaternion); // where her eye looks at rest
      s.rest = Math.atan2(_forward.y, _forward.x);
    }
    s.yaw ??= 0;
    s.yawSpeed ??= 0;
    const wanted = Math.atan2(_local.y - pivot.y, _local.x - pivot.x) - s.rest;
    const goal = s.yaw + Math.atan2(Math.sin(wanted - s.yaw), Math.cos(wanted - s.yaw)); // the short way round
    s.yawSpeed = ease(s.yawSpeed, clamp((goal - s.yaw) * 3, -2.6, 2.6) * (ctx.calm ? 0.3 : 1), 6, ctx.dt);
    s.yaw += s.yawSpeed * ctx.dt;
    body.rotateZ(s.yaw);
    // The body hangs from the ceiling plate and sways (as in the Blender loop: a few degrees each way).
    body.rotateX(0.045 * Math.sin(ctx.t * 0.47) * ctx.float);
    body.rotateY(0.06 * Math.sin(ctx.t * 0.31 + 1) * ctx.float);
    // The head aims at it; with nobody moving the mouse, a glance aside now and then.
    if (ctx.time > (s.nextAside ?? 0)) {
      s.aside = Math.random() < 0.35 ? { x: (Math.random() - 0.5) * 3.2, y: (Math.random() - 0.3) * 1.6, until: ctx.time + 1 + Math.random() * 1.4 } : null;
      s.nextAside = ctx.time + 3 + Math.random() * 5;
    }
    const aside = s.aside && ctx.time < s.aside.until && !ctx.speaking && !ctx.pointer.active ? s.aside : { x: 0, y: 0 };
    const reach = ctx.camera.position.z * 0.32;
    _point.set(aside.x * reach, aside.y * reach, 0).add(s.target);
    lookAt(head, rig.base.get(head), _point, 1.15, s, "look", 4.5, ctx.dt);
    head.rotateX(-ctx.talk * 0.3 * Math.sin(ctx.time * 9));
    head.rotateY(0.06 * Math.sin(ctx.t * 0.8));
  },

  auto(rig, ctx) {
    const s = rig.state;
    // The helm steers: small turns back and forth and, now and then, a firmer correction.
    if (ctx.time > (s.nextCorrection ?? 0)) {
      s.correctionGoal = (Math.random() - 0.5) * 0.7;
      s.nextCorrection = ctx.time + 4 + Math.random() * 6;
    }
    s.correction = ease(s.correction ?? 0, ctx.time < s.nextCorrection - 2.5 ? s.correctionGoal : 0, 1.6, ctx.dt);
    const steer = (0.1 * Math.sin(ctx.t * 0.8) + 0.04 * Math.sin(ctx.t * 2.3 + 1) + s.correction) * ctx.secondary;
    rig.node("roda").rotateY(steer + (ctx.state === "thinking" ? ctx.t * 1.2 % (Math.PI * 2) : 0));
    const helm = rig.node("leme");
    helm.rotateX(0.035 * Math.sin(ctx.t * 0.55) * ctx.float - ctx.talk * 0.1);
    helm.rotateZ(0.04 * Math.sin(ctx.t * 0.42 + 1) * ctx.float);
  },

  sentinela(rig, ctx) {
    const s = rig.state;
    const body = rig.node("corpo");
    // It stays where it is and its tentacles live (the material's WAVE): they writhe, lift and settle, and now
    // and then a few twitch. Thinking, they go faster; talking, they stir. The body breathes.
    rig.waveSpeed = (ctx.state === "thinking" ? 1.7 : 1) * (1 + 0.6 * ctx.talk);
    rig.waveAmp = 1 + 0.8 * ctx.talk;
    s.nextTwitch ??= ctx.time + 2 + Math.random() * 3;
    if (ctx.time > s.nextTwitch) {
      s.twitchAt = ctx.time;
      rig.twitchPhase = Math.random() * Math.PI * 4;
      s.nextTwitch = ctx.time + 2.5 + Math.random() * 5;
    }
    const since = ctx.time - (s.twitchAt ?? -10);
    rig.twitch = since < 0.7 ? Math.sin(Math.PI * Math.min(1, since / 0.12)) * Math.exp(-since * 4) : 0; // a jolt, fading
    body.position.z += 0.02 * ctx.float * Math.sin(ctx.t * 1.05);
    body.rotateX(0.025 * Math.sin(ctx.t * 0.8));
    body.rotateZ(0.1 * Math.sin(ctx.t * 0.33));
  },
};

export class Hologram {
  /**
   * host: the element it fills; options: canvas, load(path, kind) -> json | ArrayBuffer, visible() -> bool,
   * voice() -> {state, level}, interactive (drag to turn, wheel to zoom), fit (share of the smaller side),
   * motion() -> {x, y} (how fast the window moves, px/s), onModel(id, manifest).
   */
  constructor(host, options = {}) {
    this.host = host;
    this.options = options;
    this.config = { ...DEFAULTS, parts: { ...DEFAULTS.parts } };
    this.model = "";
    this.layers = [];
    this.rig = null;
    this.ready = false;
    this.view = { yaw: 0, pitch: 0, zoom: 1, velocity: 0, drag: null };
    this.frame = 0;
    this.ticket = 0;
    this.pointer = { x: 0, y: 0, goalX: 0, goalY: 0, at: 0, active: false };
    this.motion = { x: 0, y: 0 };
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
    // The solid models' light, fixed to the camera: a key from the upper left, a cool rim behind, a soft fill.
    this.lights = new THREE.Group();
    const key = new THREE.DirectionalLight(0xfff6ee, 2.6);
    key.position.set(-3, 4, 5);
    const rim = new THREE.DirectionalLight(0xbfe4ff, 2.2);
    rim.position.set(4, 3, -5);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.7);
    fill.position.set(4, -2, 3);
    this.lights.add(new THREE.HemisphereLight(0xe8f2ff, 0x1a1c22, 0.9), key, rim, fill);
    this.lights.visible = false;
    this.scene.add(this.lights);
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.3, 0, 0.6);
    // The bloom adds light to the color but leaves the alpha alone: the model's own coverage survives.
    const add = this.bloom.blendMaterial;
    add.blending = THREE.CustomBlending;
    add.blendEquation = THREE.AddEquation;
    add.blendSrc = THREE.SrcAlphaFactor;
    add.blendDst = THREE.OneFactor;
    add.blendSrcAlpha = THREE.ZeroFactor;
    add.blendDstAlpha = THREE.OneFactor;
    this.composer.addPass(this.bloom);
    const output = new OutputPass();
    output.material.fragmentShader = OUTPUT;
    output.material.needsUpdate = true;
    this.composer.addPass(output);
    this.clock = { frame: 0, spin: 0, orbit: 0, tempo: 0, pulse: 0 };
    this.smooth = { level: 0, voice: 0, intensity: 1, spin: 1, pulse: 1, born: 0 };
    this.last = performance.now();
    const observer = new ResizeObserver(() => {
      this.resize();
      this.wake();
    });
    observer.observe(host);
    observer.observe(canvas);
    if (options.interactive) this.setupInput();
    document.addEventListener("visibilitychange", () => this.wake());
    window.addEventListener("pointermove", (event) => {
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.pointer.goalX = clamp((event.clientX - rect.left - rect.width / 2) / (rect.width / 2), -1.5, 1.5);
      this.pointer.goalY = clamp(-(event.clientY - rect.top - rect.height / 2) / (rect.height / 2), -1.5, 1.5);
      this.pointer.at = performance.now();
    }, { passive: true });
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
        .then(async ([manifest, buffer]) => ({ manifest, buffer, images: await decodeImages(manifest, buffer) }));
      cache.set(id, job);
      job.catch(() => cache.delete(id));
    }
    return cache.get(id);
  }

  /** Shows a model (from MODELS); resolves once it is on screen. */
  async setModel(id) {
    if (this.failed) return;
    id = MODELS[id] ? id : "jarvis";
    if (id === this.model && this.ready) return;
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
    this.build(id, data.manifest, data.buffer, data.images);
    this.host.classList.remove("is-loading", "is-fallback");
    delete this.host.dataset.fallback;
    this.host.classList.add("is-ready");
    this.host.dataset.model = id;
    this.options.onModel?.(id, data.manifest);
  }

  clear() {
    for (const layer of this.layers) {
      this.root.remove(layer);
      layer.geometry.dispose();
      layer.material.dispose();
    }
    this.layers = [];
    if (this.rig) {
      this.root.remove(this.rig.group);
      for (const geometry of this.rig.geometries) geometry.dispose();
      for (const material of this.rig.materials) {
        for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap"]) material[key]?.dispose();
        material.dispose();
      }
      this.rig = null;
    }
  }

  build(id, manifest, buffer, images = []) {
    this.clear();
    this.model = id;
    this.manifest = manifest;
    this.solid = manifest.kind === "solid";
    this.host.classList.toggle("is-solid", this.solid);
    if (this.solid) this.buildSolid(manifest, buffer, images);
    else this.buildLines(manifest, buffer);
    const look = this.solid ? manifest.look || {} : {};
    const glare = (this.solid ? look.bloom : manifest.bloom) || { threshold: 0.6, strength: 0.75 };
    this.bloom.strength = glare.strength * 0.4;
    this.bloom.threshold = glare.threshold;
    this.bloom.radius = glare.radius ?? 0;
    this.renderer.toneMapping = this.solid ? TONES[look.tone] ?? THREE.NeutralToneMapping : THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 2 ** ((this.solid ? look.exposure : manifest.view?.exposure) ?? 0);
    this.lights.visible = this.solid;
    if (this.solid && !this.environment) this.environment = studio(this.renderer);
    this.scene.environment = this.solid ? this.environment : null;
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.smooth.born = 0;
    this.ready = true;
    this.apply();
    this.resize();
    this.wake();
  }

  buildLines(manifest, buffer) {
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
  }

  solidMaterial(spec, images = []) {
    const options = {
      color: new THREE.Color().setRGB(...spec.color), metalness: spec.metal ?? 0, roughness: spec.rough ?? 0.5,
      transparent: (spec.opacity ?? 1) < 1, opacity: spec.opacity ?? 1, flatShading: Boolean(spec.flat),
      side: spec.double ? THREE.DoubleSide : THREE.FrontSide, vertexColors: Boolean(spec.colors),
    };
    const material = spec.coat ? new THREE.MeshPhysicalMaterial({ ...options, clearcoat: spec.coat, clearcoatRoughness: 0.06 })
      : new THREE.MeshStandardMaterial(options);
    material.name = spec.name;
    material.userData = { spec, glow: spec.glow || 0, tint: spec.tint || "" };
    const patches = [];
    if (spec.glow) {
      material.emissive.setRGB(...spec.emissive);
      material.emissiveIntensity = spec.glow;
      if (spec.colors) { // the vertex colors paint the light too (HAL's eye: white core, red, dark rim)
        patches.push((shader) => {
          shader.fragmentShader = shader.fragmentShader.replace("vec3 totalEmissiveRadiance = emissive;",
            "vec3 totalEmissiveRadiance = emissive * vColor.rgb;");
        });
      }
    }
    if (spec.wave) { // living tentacles: the geometry carries a "wave" attribute
      const wave = { uWaveTime: { value: 0 }, uWaveAmp: { value: spec.wave.amp ?? 0.05 }, uLift: { value: spec.wave.lift ?? 0.06 },
        uTwitch: { value: 0 }, uTwitchPhase: { value: 0 } };
      material.userData.wave = wave;
      patches.push((shader) => {
        Object.assign(shader.uniforms, wave);
        shader.vertexShader = `attribute vec3 wave;\nuniform float uWaveTime, uWaveAmp, uLift, uTwitch, uTwitchPhase;\n${shader.vertexShader}`
          .replace("#include <begin_vertex>", `#include <begin_vertex>\n${WAVE}`);
      });
    }
    if (patches.length) {
      material.onBeforeCompile = (shader) => patches.forEach((patch) => patch(shader));
      material.customProgramCacheKey = () => `${spec.colors && spec.glow ? "glow-colors" : ""}|${spec.wave ? "wave" : ""}`;
    }
    // Textures from Blender (GLaDOS): the color, the relief, roughness (G) and metal (B), what glows.
    const maps = spec.maps || {};
    const texture = (index, srgb) => {
      const map = new THREE.Texture(images[index]);
      map.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      map.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      map.needsUpdate = true;
      return map;
    };
    if (images[maps.color]) material.map = texture(maps.color, true);
    if (images[maps.normal]) material.normalMap = texture(maps.normal, false);
    if (images[maps.rm]) {
      material.roughnessMap = material.metalnessMap = texture(maps.rm, false);
      material.roughness = 1;
      material.metalness = 1;
    }
    if (images[maps.glow]) material.emissiveMap = texture(maps.glow, true);
    if (spec.canvas) { // a texture drawn live by the model's behavior (Verity's face)
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 512;
      const scratch = document.createElement("canvas");
      scratch.width = scratch.height = 512;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      material.map = texture;
      material.color.setRGB(1, 1, 1);
      material.userData.face = { canvas, context: canvas.getContext("2d"), scratch, scratchContext: scratch.getContext("2d"), texture };
    }
    return material;
  }

  buildSolid(manifest, buffer, images) {
    const view = (spec, Type) => new Type(buffer, spec.offset, spec.length);
    const materials = manifest.materials.map((spec) => this.solidMaterial(spec, images));
    const geometries = manifest.meshes.map((spec) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(view(spec.position, Float32Array), 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(view(spec.normal, Int8Array), 3, true));
      if (spec.uv) geometry.setAttribute("uv", new THREE.BufferAttribute(view(spec.uv, Float32Array), 2));
      if (spec.color) geometry.setAttribute("color", new THREE.BufferAttribute(view(spec.color, Float32Array), 3));
      if (spec.wave) {
        geometry.setAttribute("wave", new THREE.BufferAttribute(view(spec.wave, Float32Array), Math.round(spec.wave.length / spec.vertices)));
      }
      geometry.setIndex(new THREE.BufferAttribute(view(spec.index, spec.index.type === "uint32" ? Uint32Array : Uint16Array), 1));
      for (const group of spec.groups) geometry.addGroup(group.start, group.count, group.material);
      return geometry;
    });
    const group = new THREE.Group(); // what the engine scales; the model's own root is inside
    const nodes = manifest.nodes.map((spec) => {
      const object = spec.mesh !== undefined ? new THREE.Mesh(geometries[spec.mesh], materials) : new THREE.Group();
      object.name = spec.name;
      object.position.fromArray(spec.position);
      object.quaternion.fromArray(spec.quaternion);
      object.scale.fromArray(spec.scale);
      object.visible = !spec.hidden;
      object.userData = { role: spec.role || "shell", tags: spec.tags || {} };
      if (object.isMesh && object.geometry.attributes.wave) object.frustumCulled = false; // it reaches past its rest bounds
      return object;
    });
    manifest.nodes.forEach((spec, index) => (spec.parent >= 0 ? nodes[spec.parent] : group).add(nodes[index]));
    this.root.add(group);
    const byName = new Map(nodes.map((object) => [object.name, object]));
    const spare = new THREE.Object3D(); // stands in for a part a model does not have
    // "Explodir peças": a part hung from a pivot (not from another part) moves away from that pivot.
    const spread = [];
    for (const object of nodes) {
      if (!object.isMesh || object.parent?.isMesh) continue;
      object.geometry.computeBoundingSphere();
      const center = object.geometry.boundingSphere.center.clone().multiply(object.scale).applyQuaternion(object.quaternion).add(object.position);
      if (center.lengthSq() > 1e-6) spread.push([object, center.normalize().multiplyScalar(0.35)]);
    }
    this.rig = {
      group, nodes, geometries, materials, spread, state: {}, clock: 0,
      base: new Map(nodes.map((object) => [object, { position: object.position.clone(), quaternion: object.quaternion.clone(),
        scale: object.scale.clone(), visible: object.visible }])),
      glows: materials.filter((material) => material.userData.glow > 0),
      waves: materials.filter((material) => material.userData.wave),
      face: materials.find((material) => material.userData.face)?.userData.face || null,
      node: (name) => byName.get(name) || spare,
      material: (name) => materials.find((material) => material.name === name),
      each: (tag, fn) => nodes.forEach((object) => object.userData.tags[tag] !== undefined && fn(object, object.userData.tags[tag])),
    };
  }

  /** The "faça você mesmo" settings (DEFAULTS' keys); colors are "#rrggbb" or "" for the model's own. */
  setConfig(config) {
    this.config = { ...DEFAULTS, ...(config || {}), parts: { ...DEFAULTS.parts, ...(config?.parts || {}) } };
    this.apply();
    this.wake();
  }

  apply() {
    const config = this.config;
    if (this.rig) {
      for (const material of this.rig.materials) {
        const { spec, tint } = material.userData;
        if (tint === "shell" && !material.userData.face) {
          if (config.shell) material.color.set(config.shell);
          else material.color.setRGB(...spec.color);
        }
        if (tint === "glow") {
          if (config.glow) material.emissive.set(config.glow);
          else material.emissive.setRGB(...spec.emissive);
        }
      }
      this.rig.state.drawn = ""; // a face drawn in the old color is drawn again
      return;
    }
    if (!this.layers.length) return;
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
    let box = this.canvas.getBoundingClientRect();
    if (!box.width || !box.height) box = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(box.width));
    const height = Math.max(1, Math.round(box.height));
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    const reach = this.manifest?.camera?.distance ?? 6.1;
    const distance = reach / this.view.zoom;
    this.camera.position.set(0, 0, distance); // Blender's camera at (0, -distance, 0), looking along +Y
    this.camera.aspect = width / height;
    const halfHeight = (1.2 / (this.options.fit ?? 0.82)) * (height / Math.min(width, height));
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfHeight / reach));
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
    if (!this.frame && this.ready && this.visible()) {
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
    const smooth = this.smooth;
    // Speaking: the voice envelope. Listening: the microphone. Scaled down: the speech envelope
    // peaks every syllable, Blender's baked spectrum was smoother.
    const level = 0.55 * (sample.level || 0);
    smooth.level = ease(smooth.level, level, level > smooth.level ? 22 : 7, dt);
    smooth.voice = ease(smooth.voice, state === "speaking" ? level : 0, 12, dt);
    smooth.intensity = ease(smooth.intensity, state === "muted" ? 0.45 : state === "armed" ? 1.15 : 1, 4, dt);
    smooth.spin = ease(smooth.spin, state === "thinking" ? 1.8 : 1, 3, dt);
    smooth.pulse = ease(smooth.pulse, state === "thinking" ? 2.2 : state === "armed" ? 1.15 : 1, 3, dt);
    smooth.born = Math.min(1, smooth.born + dt * 1.6); // materializes when a model comes in
    if (this.solid) this.animateSolid(dt, now, state, calm);
    else this.animateLines(dt, now, calm);
    const view = this.view;
    if (!view.drag) {
      view.yaw += view.velocity;
      view.velocity *= 0.93;
    }
    this.turn.rotation.set(view.pitch, view.yaw, 0);
    this.composer.render();
    this.frame = window.requestAnimationFrame((time) => this.render(time));
  }

  animateLines(dt, now, calm) {
    const config = this.config;
    const smooth = this.smooth;
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
  }

  animateSolid(dt, now, state, calm) {
    const rig = this.rig;
    const config = this.config;
    const smooth = this.smooth;
    for (const [object, base] of rig.base) {
      object.position.copy(base.position);
      object.quaternion.copy(base.quaternion);
      object.scale.copy(base.scale);
      object.visible = base.visible;
    }
    rig.group.position.set(0, 0, 0);
    rig.group.quaternion.identity();
    const explode = config.explode / 100;
    if (explode) for (const [object, direction] of rig.spread) object.position.addScaledVector(direction, explode);
    // The pointer: where the mouse is over the canvas, back to the middle a few seconds after it stops.
    const pointer = this.pointer;
    pointer.active = now - pointer.at < 4000;
    pointer.x = ease(pointer.x, pointer.active ? pointer.goalX : 0, 5, dt);
    pointer.y = ease(pointer.y, pointer.active ? pointer.goalY : 0, 5, dt);
    const moving = this.options.motion?.() || { x: 0, y: 0 };
    this.motion.x = ease(this.motion.x, moving.x || 0, 10, dt);
    this.motion.y = ease(this.motion.y, moving.y || 0, 10, dt);
    const pace = (calm ? 0.3 : 1) * (0.3 + 0.7 * (config.spin / 50)) * smooth.spin;
    rig.clock += dt * pace;
    BEHAVIORS[this.manifest.behavior]?.(rig, {
      t: rig.clock, dt, time: now / 1000, state, level: smooth.level, talk: smooth.voice, speaking: state === "speaking",
      float: config.float / 50, secondary: config.orbit / 50, pulse: config.pulse / 50, pointer, motion: this.motion,
      camera: this.camera, config, calm,
    });
    for (const object of rig.nodes) {
      if (config.parts[object.userData.role] === false) object.visible = false;
    }
    // The light of eyes and lenses: a slow breath, the voice, the state and "intensidade".
    const breath = 1 + 0.14 * (config.pulse / 50) * Math.sin((now / 1000) * 1.7);
    const thinking = state === "thinking" ? 1 + 0.3 * Math.sin((now / 1000) * 7) : 1;
    const glow = breath * thinking * (1 + 1.4 * smooth.voice) * smooth.intensity * (config.opacity / 70) * (0.2 + 0.8 * smooth.born);
    for (const material of rig.glows) material.emissiveIntensity = material.userData.glow * glow;
    for (const material of rig.waves) { // the tentacles: their pace, their reach and the twitches (from the behavior)
      const { spec, wave } = material.userData;
      wave.uWaveTime.value += dt * (spec.wave.speed ?? 1.6) * (rig.waveSpeed ?? 1) * (config.orbit / 50) * (calm ? 0.3 : 1);
      wave.uWaveAmp.value = (spec.wave.amp ?? 0.05) * (rig.waveAmp ?? 1) * (0.3 + 0.7 * smooth.born);
      wave.uTwitch.value = calm ? 0 : rig.twitch ?? 0;
      wave.uTwitchPhase.value = rig.twitchPhase ?? 0;
    }
    rig.group.scale.setScalar((config.scale / 100) * (0.92 + 0.08 * smooth.born));
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
