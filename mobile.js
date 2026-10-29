/* Conexão JARVIS: the phone app of the assistant whose PC is the server.

   One app, three ways in:
   - the Android app (Capacitor) and the page installed from GitHub Pages: the QR code on the PC (aba
     CELULAR) carries a private ntfy topic and a one-time secret. The PC's current HTTPS address (a
     Cloudflare quick tunnel) is read from the topic, the secret becomes this device's token, and from then
     on the app finds that PC again from any network until DESCONECTAR. At home the Android app talks to
     the PC straight over the Wi-Fi.
   - the page the PC itself serves on the Wi-Fi (http://<pc>:8770): same-origin calls, the 6-digit code.
   The replies can be spoken here in the PC's own voice (/m/speech), the microphone records for the PC's
   Whisper (/m/listen), and the PAINEL (panel.js) opens the desktop modules adapted to the phone. */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const STORE = "jarvis.conexao";
  const NTFY = "https://ntfy.sh";
  const NATIVE = Boolean(window.Capacitor?.isNativePlatform?.()) || location.protocol === "capacitor:";
  const REMOTE_APP = NATIVE || location.hostname.endsWith("github.io"); // not the PC's own page
  const STATES = {
    "pt-BR": { idle: "PRONTO", armed: "OUVINDO", thinking: "PENSANDO", speaking: "FALANDO", muted: "MUDO", loading: "INICIANDO", off: "SÓ TEXTO" },
    "en-US": { idle: "READY", armed: "LISTENING", thinking: "THINKING", speaking: "SPEAKING", muted: "MUTED", loading: "STARTING", off: "TEXT ONLY" },
    "es-ES": { idle: "LISTO", armed: "ESCUCHANDO", thinking: "PENSANDO", speaking: "HABLANDO", muted: "SILENCIO", loading: "INICIANDO", off: "SOLO TEXTO" },
  };
  const LANGS = ["pt-BR", "en-US", "es-ES"];
  const TEXT = {
    secure: ["LINK NEURAL SEGURO", "SECURE NEURAL LINK", "ENLACE NEURAL SEGURO"], conn: ["CONEXÃO", "CONNECTION", "CONEXIÓN"],
    tagline: ["SEU ASSISTENTE, ONDE VOCÊ ESTIVER", "YOUR ASSISTANT, WHEREVER YOU ARE", "TU ASISTENTE, DONDE ESTÉS"],
    scan: ["ESCANEAR QR CODE", "SCAN QR CODE", "ESCANEAR CÓDIGO QR"], typeCode: ["DIGITAR CÓDIGO (MESMO WI-FI)", "TYPE CODE (SAME WI-FI)", "ESCRIBIR CÓDIGO (MISMO WI-FI)"],
    pair: ["PAREAR", "PAIR", "EMPAREJAR"], cancel: ["CANCELAR", "CANCEL", "CANCELAR"],
    hint: ["No PC, abra a aba CELULAR e aponte a câmera para o QR code.", "On the PC, open the PHONE tab and point the camera at the QR code.",
      "En el PC, abra la pestaña MÓVIL y apunte la cámara al código QR."],
    lost: ["PROCURANDO O JARVIS… O PC ESTÁ LIGADO?", "LOOKING FOR JARVIS… IS THE PC ON?", "BUSCANDO A JARVIS… ¿EL PC ESTÁ ENCENDIDO?"],
    telemetry: ["// TELEMETRIA DO PC", "// PC TELEMETRY", "// TELEMETRÍA DEL PC"], media: ["// MÍDIA E SISTEMA", "// MEDIA AND SYSTEM", "// MEDIOS Y SISTEMA"],
    prev: ["ANTERIOR", "PREVIOUS", "ANTERIOR"], play: ["PLAY/PAUSA", "PLAY/PAUSE", "PLAY/PAUSA"], next: ["PRÓXIMA", "NEXT", "SIGUIENTE"],
    volume: ["VOLUME", "VOLUME", "VOLUMEN"], mute: ["MUDO", "MUTE", "SILENCIO"], desktop: ["ÁREA DE TRAB.", "DESKTOP", "ESCRITORIO"],
    lock: ["BLOQUEAR PC", "LOCK PC", "BLOQUEAR PC"], refresh: ["ATUALIZAR", "REFRESH", "ACTUALIZAR"], live: ["AO VIVO", "LIVE", "EN VIVO"],
    screenTitle: ["// TELA DO PC", "// PC SCREEN", "// PANTALLA DEL PC"],
    shotHint: ["Toque em ATUALIZAR para ver a tela do PC.", "Tap REFRESH to see the PC screen.", "Toque ACTUALIZAR para ver la pantalla del PC."],
    sendTitle: ["// ENVIAR PARA O PC", "// SEND TO THE PC", "// ENVIAR AL PC"], pick: ["Toque para escolher fotos ou arquivos", "Tap to pick photos or files", "Toque para elegir fotos o archivos"],
    pickNote: ["Vão para a pasta de anotações do PC", "They go to the PC's notes folder", "Van a la carpeta de notas del PC"], openTitle: ["// ABRIR NO PC", "// OPEN ON THE PC", "// ABRIR EN EL PC"],
    open: ["ABRIR", "OPEN", "ABRIR"], language: ["// LINGUAGEM", "// LANGUAGE", "// IDIOMA"],
    langPc: ["MUDAR TAMBÉM O IDIOMA DO JARVIS NO PC", "ALSO CHANGE JARVIS'S LANGUAGE ON THE PC", "CAMBIAR TAMBIÉN EL IDIOMA DE JARVIS EN EL PC"],
    voice: ["// VOZ", "// VOICE", "// VOZ"], speakHere: ["FALAR AS RESPOSTAS NESTE CELULAR (VOZ DO JARVIS)", "SPEAK THE REPLIES ON THIS PHONE (JARVIS'S VOICE)",
      "HABLAR LAS RESPUESTAS EN ESTE MÓVIL (VOZ DE JARVIS)"],
    quietPc: ["SILENCIAR O PC QUANDO EU FALAR PELO CELULAR", "KEEP THE PC SILENT WHEN I TALK FROM THE PHONE", "SILENCIAR EL PC CUANDO HABLE DESDE EL MÓVIL"],
    connection: ["// CONEXÃO", "// CONNECTION", "// CONEXIÓN"], disconnect: ["DESCONECTAR DESTE JARVIS", "DISCONNECT FROM THIS JARVIS", "DESCONECTAR DE ESTE JARVIS"],
    disconnectNote: ["O celular deixa de ter acesso. Para voltar, escaneie o QR code de novo.", "This phone loses access. To come back, scan the QR code again.",
      "Este móvil pierde el acceso. Para volver, escanee el código QR de nuevo."],
    tTalk: ["CONVERSA", "TALK", "CHARLA"], tPanel: ["PAINEL", "PANEL", "PANEL"], tControl: ["CONTROLE", "CONTROL", "CONTROL"], tSettings: ["AJUSTES", "SETTINGS", "AJUSTES"],
    ringHint: ["Toque num módulo para abrir aqui, adaptado ao celular.", "Tap a module to open it here, made for the phone.", "Toque un módulo para abrirlo aquí, adaptado al móvil."],
    onPc: ["NO PC", "ON PC", "EN EL PC"],
    ask: ["Fale ou digite um pedido…", "Speak or type a request…", "Hable o escriba un pedido…"], you: ["VOCÊ", "YOU", "TÚ"], action: ["AÇÃO", "ACTION", "ACCIÓN"],
    bootScan: ["Iniciando o núcleo do app", "Starting the app core", "Iniciando el núcleo de la app"],
    bootLocate: ["Localizando o servidor", "Locating the server", "Localizando el servidor"],
    bootTunnel: ["Abrindo canal criptografado", "Opening encrypted channel", "Abriendo canal cifrado"],
    bootAuth: ["Autenticando este dispositivo", "Authenticating this device", "Autenticando este dispositivo"],
    bootOk: ["Link estabelecido", "Link established", "Enlace establecido"], bootWait: ["Aguardando pareamento", "Waiting for pairing", "Esperando emparejamiento"],
    server: ["SERVIDOR", "SERVER", "SERVIDOR"], route: ["ROTA", "ROUTE", "RUTA"],
    routeRemote: ["Internet (túnel seguro)", "Internet (secure tunnel)", "Internet (túnel seguro)"], routeLan: ["Mesmo Wi-Fi", "Same Wi-Fi", "Mismo Wi-Fi"],
    device: ["ESTE APARELHO", "THIS DEVICE", "ESTE DISPOSITIVO"], since: ["DESDE", "SINCE", "DESDE"], confirmOff: ["Desconectar este celular do Jarvis?",
      "Disconnect this phone from Jarvis?", "¿Desconectar este móvil de Jarvis?"], noCamera: ["Não consegui abrir a câmera.", "Could not open the camera.",
      "No pude abrir la cámara."],
    dictate: ["Toque no 🎤 do teclado para ditar.", "Tap the keyboard 🎤 to dictate.", "Toque el 🎤 del teclado para dictar."],
    expired: ["Pareamento expirado ou revogado.", "Pairing expired or revoked.", "Emparejamiento vencido o revocado."],
    recording: ["Ouvindo… toque de novo para enviar", "Listening… tap again to send", "Escuchando… toque de nuevo para enviar"],
    sending: ["Enviando para o Jarvis…", "Sending to Jarvis…", "Enviando a Jarvis…"], heardNothing: ["Não ouvi nada.", "I heard nothing.", "No oí nada."],
    offWifi: ["Fora do Wi-Fi do PC: ligue o acesso remoto na aba CELULAR do PC.", "Away from the PC's Wi-Fi: turn on remote access in the PC's PHONE tab.",
      "Fuera del Wi-Fi del PC: active el acceso remoto en la pestaña MÓVIL del PC."],
  };
  const state = { conn: null, base: "", route: "", seq: 0, synced: false, polling: false, failures: 0, live: 0, rows: new Map(), name: "Jarvis",
    lang: "pt-BR", speak: true, quiet: REMOTE_APP, pollTimer: 0, mood: "idle", themeKey: "", modelsVersion: "" };

  /* ---------- storage and language ---------- */

  function loadConn() {
    try {
      state.conn = JSON.parse(window.localStorage.getItem(STORE) || "null");
      const speak = window.localStorage.getItem("jarvis.remote.speak");
      const quiet = window.localStorage.getItem("jarvis.remote.quiet");
      if (speak) state.speak = speak === "on";
      if (quiet) state.quiet = quiet === "on";
      const nav = (navigator.language || "pt").slice(0, 2);
      state.lang = window.localStorage.getItem("jarvis.remote.lang") || (nav === "en" ? "en-US" : nav === "es" ? "es-ES" : "pt-BR");
      if (!LANGS.includes(state.lang)) state.lang = "pt-BR";
    } catch (_) {
      state.conn = null;
    }
  }

  function saveConn() {
    try {
      if (state.conn) window.localStorage.setItem(STORE, JSON.stringify(state.conn));
      else window.localStorage.removeItem(STORE);
    } catch (_) {
      /* Private mode: the connection lasts this visit. */
    }
  }

  function remember(key, on) {
    try {
      window.localStorage.setItem(key, on ? "on" : "off");
    } catch (_) {
      /* Not remembered. */
    }
  }

  const t = (key) => (TEXT[key] || [key])[LANGS.indexOf(state.lang)] || TEXT[key]?.[0] || key;

  function applyLang() {
    document.documentElement.lang = state.lang;
    $$("[data-i18n]").forEach((item) => {
      item.textContent = t(item.dataset.i18n);
    });
    $("#ask").placeholder = t("ask");
    $$("#langs button").forEach((button) => button.classList.toggle("is-active", button.dataset.lang === state.lang));
    renderConn();
    document.dispatchEvent(new CustomEvent("jarvis:phone-lang", { detail: { lang: state.lang } }));
  }

  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }

  let toastTimer = 0;
  function toast(text, error = false) {
    const box = $("#toast");
    box.textContent = text;
    box.classList.toggle("is-error", error);
    box.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => box.classList.remove("show"), 3200);
  }

  const vibrate = (ms = 12) => {
    try {
      navigator.vibrate?.(ms);
    } catch (_) {
      /* No vibration. */
    }
  };

  /* ---------- finding the PC ---------- */

  async function latestAddress(topic) {
    const response = await fetch(`${NTFY}/${encodeURIComponent(topic)}/json?poll=1&since=24h`, { cache: "no-store" });
    const lines = (await response.text()).trim().split("\n").filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const event = JSON.parse(lines[index]);
        if (event.event !== "message") continue;
        const data = JSON.parse(event.message);
        if (/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(data.url)) return data.url;
      } catch (_) {
        /* Not ours. */
      }
    }
    throw new Error("PC offline");
  }

  async function reachable(base) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 1600);
    try {
      const response = await fetch(`${base}/m/state?since=999999999`, { headers: { Authorization: `Bearer ${state.conn?.token || ""}` },
        cache: "no-store", signal: controller.signal });
      return response.ok || response.status === 401;
    } catch (_) {
      return false;
    } finally {
      window.clearTimeout(timer);
    }
  }

  /** The base of every call: "" on the PC's own page; the PC on the Wi-Fi (Android app at home); else the tunnel. */
  async function resolveBase(force = false) {
    if (!REMOTE_APP) {
      state.base = "";
      state.route = "lan";
      return "";
    }
    if (state.base && !force) return state.base;
    const lan = (state.conn?.lan || "").replace(/\/+$/, "");
    if (NATIVE && lan && await reachable(lan)) {
      state.base = lan;
      state.route = "lan";
      return lan;
    }
    if (!state.conn?.topic) throw new Error(lan ? t("offWifi") : "sem servidor");
    state.base = await latestAddress(state.conn.topic);
    state.route = "remote";
    return state.base;
  }

  async function api(path, { method = "GET", body, raw, timeout, headers: extra = {}, signal } = {}) {
    const headers = { Authorization: `Bearer ${state.conn?.token || ""}`, ...extra };
    if (body !== undefined && !raw) headers["Content-Type"] = "application/json";
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout || (raw ? 120000 : 12000));
    signal?.addEventListener("abort", () => controller.abort(), { once: true }); // the caller's clock covers the body too
    try {
      const response = await fetch(`${state.base}${path}`, { method, headers, body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store", signal: controller.signal });
      if (response.status === 401 && path !== "/m/pair") {
        disconnect(false);
        toast(t("expired"), true);
        throw new Error(t("expired"));
      }
      return response;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function json(path, options) {
    const response = await api(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || data.message || `falha ${response.status}`);
    return data;
  }

  /** A big file in 32 KB slices, a few at a time, each retried on its own URL: security software on the PC
      now and then holds a long local answer for ~19 s and resets it (the desktop's holo-loader.js does the same). */
  async function sliced(path, size = 32 * 1024) {
    const wait = state.route === "remote" ? 9000 : 4000;
    const part = async (start) => {
      let last = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), wait);
        try {
          const response = await api(`${path}?r=${start}.${attempt}.${Date.now() % 1e6}`, { timeout: wait, signal: controller.signal,
            headers: { Range: `bytes=${start}-${start + size - 1}` } });
          if (response.status !== 200 && response.status !== 206) throw new Error(`modelo ${response.status}`);
          const total = Number((response.headers.get("Content-Range") || "").split("/")[1]) || 0;
          return { data: new Uint8Array(await response.arrayBuffer()), total, whole: response.status === 200 };
        } catch (error) {
          last = error;
          await new Promise((resolve) => window.setTimeout(resolve, 200 * (attempt + 1)));
        } finally {
          window.clearTimeout(timer);
        }
      }
      throw last;
    };
    const first = await part(0);
    if (first.whole || first.total <= first.data.length) return first.data.buffer; // small, or no slices offered
    const bytes = new Uint8Array(first.total);
    bytes.set(first.data, 0);
    const starts = [];
    for (let start = size; start < first.total; start += size) starts.push(start);
    let next = 0;
    const worker = async () => {
      while (next < starts.length) {
        const start = starts[next];
        next += 1;
        bytes.set((await part(start)).data, start);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return bytes.buffer;
  }

  /* ---------- entry screen and pairing ---------- */

  function bootLine(key, status = "") {
    const log = $("#entry-log");
    const row = node("li");
    row.append(node("span", "", `› ${t(key)}`), node("b", "", status || "…"));
    log.append(row);
    while (log.children.length > 5) log.firstElementChild.remove();
    return (done, ok = true) => {
      row.lastChild.textContent = done;
      row.classList.add(ok ? "is-ok" : "is-bad");
    };
  }

  async function deviceName() {
    try {
      const data = await navigator.userAgentData?.getHighEntropyValues?.(["model"]);
      if (data?.model) return data.model.slice(0, 32);
    } catch (_) {
      /* Not offered. */
    }
    const agent = navigator.userAgent;
    const model = /\(Linux; Android [^;]+; ([^)]+?)(?: Build|\))/.exec(agent)?.[1];
    if (model && model.trim().length > 1) return model.trim().slice(0, 32);
    if (/iPhone/.test(agent)) return "iPhone";
    if (/iPad/.test(agent)) return "iPad";
    return /Android/.test(agent) ? "Android" : "Celular";
  }

  function showEntry() {
    document.body.dataset.screen = "entry";
    $("#app").hidden = true;
    $("#entry").hidden = false;
    $("#show-code").hidden = REMOTE_APP && !NATIVE; // 6 digits: the Wi-Fi only
  }

  async function pairAt(base, code) {
    const response = await fetch(`${base}/m/pair`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: await deviceName() }) });
    const data = await response.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.error || "pareamento recusado");
    return data;
  }

  /** What the QR code carried: {t: topic, k: secret, n: name, l: Wi-Fi address}. */
  async function pairRemote(config) {
    const locate = bootLine("bootLocate");
    state.conn = { topic: config.t, token: "", name: config.n || "Jarvis", since: Date.now(), lan: config.l || "" };
    try {
      await resolveBase(true);
      locate(state.route === "lan" ? "WI-FI" : "OK");
    } catch (error) {
      locate("OFFLINE", false);
      state.conn = null;
      throw error;
    }
    if (state.route === "remote") bootLine("bootTunnel")("TLS");
    const auth = bootLine("bootAuth");
    try {
      const data = await pairAt(state.base, config.k);
      auth("OK");
      Object.assign(state.conn, { token: data.token, name: data.name || state.conn.name });
      saveConn();
    } catch (error) {
      auth("NEGADO", false);
      state.conn = null;
      throw error;
    }
  }

  /** The 6-digit code: on the PC's own page (same origin) or, in the Android app, a Wi-Fi QR code. */
  async function pairLocal(code, base = "") {
    const auth = bootLine("bootAuth");
    try {
      const data = await pairAt(base, code);
      auth("OK");
      state.conn = { topic: "", token: data.token, name: data.name || "Jarvis", since: Date.now(), lan: base || location.origin };
      state.base = base;
      saveConn();
    } catch (error) {
      auth("NEGADO", false);
      throw error;
    }
  }

  function parsePairing(text) {
    const packed = /[#&]c=([A-Za-z0-9_-]+)/.exec(text)?.[1];
    if (packed) {
      try {
        const raw = atob(packed.replace(/-/g, "+").replace(/_/g, "/"));
        return { remote: JSON.parse(decodeURIComponent(escape(raw))) };
      } catch (_) {
        return null;
      }
    }
    const lan = /^(https?:\/\/[^/#]+)\/?#pair=(\d{6})/.exec(text);
    if (lan) return { digits: lan[2], base: lan[1] };
    const digits = /[#&]pair=(\d{6})/.exec(text)?.[1];
    return digits ? { digits } : null;
  }

  function fromFragment() {
    const found = parsePairing(location.hash || "");
    if (location.hash) history.replaceState(null, "", location.pathname); // the secret does not stay in the address bar
    return found;
  }

  async function connectFlow(pairing) {
    showEntry();
    $("#entry-log").replaceChildren();
    bootLine("bootScan")("OK");
    try {
      if (pairing?.remote) {
        if (REMOTE_APP) await pairRemote(pairing.remote);
        else await pairLocal(pairing.remote.k); // the remote QR read on the PC's own page: same secret, same Wi-Fi
      } else if (pairing?.digits) {
        if (NATIVE && pairing.base) await pairLocal(pairing.digits, pairing.base);
        else if (!REMOTE_APP) await pairLocal(pairing.digits);
        else throw new Error(t("hint"));
      } else if (state.conn?.token) {
        const locate = bootLine("bootLocate");
        await resolveBase(true).then(() => locate(state.route === "lan" ? "WI-FI" : "OK"), (error) => {
          locate("OFFLINE", false);
          throw error;
        });
      } else {
        bootLine("bootWait")("—");
        return;
      }
      bootLine("bootOk")("✓");
      vibrate(40);
      window.setTimeout(startApp, 700);
    } catch (error) {
      toast(error.message, true);
      if (state.conn?.token) window.setTimeout(() => connectFlow(null), 6000); // the PC may be starting
    }
  }

  /* ---------- QR scanning inside the app (camera + BarcodeDetector or jsQR) ---------- */

  async function scan() {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast(t("noCamera"), true);
      return;
    }
    const box = $("#scanner");
    const video = $("#scanner-video");
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch (_) {
      toast(t("noCamera"), true);
      return;
    }
    box.hidden = false;
    video.srcObject = stream;
    await video.play().catch(() => {});
    const detector = "BarcodeDetector" in window ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
    if (!detector && !window.jsQR) { // the reader in JavaScript (256 KB) only when the phone has none built in
      const script = document.createElement("script");
      script.src = "vendor/jsQR.js";
      document.head.append(script);
    }
    const canvas = $("#scanner-canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let done = false;
    const stop = () => {
      done = true;
      stream.getTracks().forEach((track) => track.stop());
      box.hidden = true;
    };
    $("#scanner-close").onclick = stop;
    const read = async () => {
      if (detector) return (await detector.detect(video))[0]?.rawValue || "";
      if (!window.jsQR || !video.videoWidth) return "";
      const scale = Math.min(1, 640 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      return window.jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data || "";
    };
    const loop = async () => {
      if (done) return;
      try {
        const value = await read();
        const pairing = value ? parsePairing(value) : null;
        if (pairing) {
          stop();
          vibrate(60);
          connectFlow(pairing);
          return;
        }
      } catch (_) {
        /* Next frame. */
      }
      window.setTimeout(loop, 200);
    };
    loop();
  }

  /* ---------- the PC's voice, played here ---------- */

  const audio = { ctx: null, analyser: null, data: null, queue: [], playing: null, generation: 0 };

  function audioContext() {
    if (!audio.ctx) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return null;
      audio.ctx = new Context();
      audio.analyser = audio.ctx.createAnalyser();
      audio.analyser.fftSize = 512;
      audio.analyser.connect(audio.ctx.destination);
      audio.data = new Uint8Array(audio.analyser.fftSize);
    }
    if (audio.ctx.state === "suspended") audio.ctx.resume().catch(() => {});
    return audio.ctx;
  }

  function stopSpeech() {
    audio.generation += 1;
    audio.queue = [];
    try {
      audio.playing?.stop();
    } catch (_) {
      /* Already over. */
    }
    audio.playing = null;
  }

  /** Each sentence is fetched as soon as it is known (synthesis takes a moment), played in order. */
  function enqueueSpeech(text) {
    if (!state.speak || !text) return;
    const context = audioContext();
    if (!context) return;
    const generation = audio.generation;
    const buffer = api("/m/speech", { method: "POST", body: { text }, timeout: 40000 })
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(`voz ${response.status}`))))
      .then((data) => context.decodeAudioData(data));
    buffer.catch(() => {});
    audio.queue.push({ buffer, generation });
    if (!audio.playing) playNext();
  }

  async function playNext() {
    const job = audio.queue.shift();
    if (!job) {
      audio.playing = null;
      return;
    }
    audio.playing = { stop() {} }; // reserved while the audio arrives
    try {
      const buffer = await job.buffer;
      if (job.generation !== audio.generation) return;
      const source = audio.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(audio.analyser);
      source.onended = () => {
        if (audio.playing === source) {
          audio.playing = null;
          playNext();
        }
      };
      audio.playing = source;
      source.start();
    } catch (_) {
      if (job.generation === audio.generation) {
        audio.playing = null;
        playNext(); // a sentence that failed is skipped, not the rest
      }
    }
  }

  function outputLevel() {
    if (!audio.analyser || !audio.playing?.buffer) return 0;
    audio.analyser.getByteTimeDomainData(audio.data);
    let sum = 0;
    for (const value of audio.data) sum += ((value - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / audio.data.length) * 4);
  }

  /* ---------- the microphone: recorded here, understood by the PC's Whisper ---------- */

  const rec = { stream: null, recorder: null, chunks: [], analyser: null, data: null, frame: 0, level: 0 };

  function canRecord() {
    return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  }

  async function startRecording() {
    if (!canRecord()) {
      $("#ask").focus();
      toast(t("dictate"));
      return;
    }
    stopSpeech();
    try {
      rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (_) {
      toast(t("noCamera").replace("câmera", "microfone").replace("camera", "microphone").replace("cámara", "micrófono"), true);
      return;
    }
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"].find((kind) => window.MediaRecorder.isTypeSupported?.(kind)) || "";
    rec.recorder = new window.MediaRecorder(rec.stream, type ? { mimeType: type } : undefined);
    rec.chunks = [];
    rec.recorder.ondataavailable = (event) => {
      if (event.data?.size) rec.chunks.push(event.data);
    };
    rec.recorder.onstop = upload;
    rec.recorder.start(250);
    const context = audioContext();
    if (context) { // stops by itself after a silence, like the PC's microphone
      const source = context.createMediaStreamSource(rec.stream);
      rec.analyser = context.createAnalyser();
      rec.analyser.fftSize = 1024;
      rec.data = new Uint8Array(rec.analyser.fftSize);
      source.connect(rec.analyser);
    }
    const started = performance.now();
    let spoke = 0;
    let quietSince = 0;
    const watch = () => {
      if (rec.recorder?.state !== "recording") return;
      let level = 0;
      if (rec.analyser) {
        rec.analyser.getByteTimeDomainData(rec.data);
        let sum = 0;
        for (const value of rec.data) sum += ((value - 128) / 128) ** 2;
        level = Math.sqrt(sum / rec.data.length);
      }
      rec.level = Math.min(1, level * 6);
      const now = performance.now();
      if (level > 0.035) {
        spoke = spoke || now;
        quietSince = 0;
      } else if (spoke && !quietSince) {
        quietSince = now;
      }
      if ((spoke && quietSince && now - quietSince > 1300) || now - started > 15000) {
        stopRecording();
        return;
      }
      rec.frame = window.requestAnimationFrame(watch);
    };
    rec.frame = window.requestAnimationFrame(watch);
    document.body.classList.add("is-recording");
    toast(t("recording"));
    vibrate(25);
  }

  function stopRecording() {
    window.cancelAnimationFrame(rec.frame);
    document.body.classList.remove("is-recording");
    rec.level = 0;
    if (rec.recorder?.state === "recording") rec.recorder.stop();
    rec.stream?.getTracks().forEach((track) => track.stop());
  }

  async function upload() {
    const type = rec.recorder?.mimeType || "audio/webm";
    const blob = new Blob(rec.chunks, { type });
    rec.recorder = null;
    if (blob.size < 2500) {
      toast(t("heardNothing"));
      return;
    }
    toast(t("sending"));
    try {
      await json(`/m/listen?quiet=${state.quiet ? 1 : 0}`, { method: "POST", body: blob, raw: true, timeout: 60000 });
      showPane("talk");
      poll(true);
    } catch (error) {
      toast(error.message, true);
    }
  }

  /* ---------- conversation ---------- */

  function addRow(kind, text, turn) {
    const log = $("#log");
    const key = `${kind}:${turn ?? Math.random()}`;
    let row = state.rows.get(key);
    if (!row) {
      row = node("li", `row is-${kind}`);
      row.append(node("span", "who", kind === "user" ? t("you") : kind === "tool" ? t("action") : state.name.toUpperCase()), node("p"));
      log.append(row);
      state.rows.set(key, row);
      while (log.children.length > 60) {
        const first = log.firstElementChild;
        for (const [name, item] of state.rows) if (item === first) state.rows.delete(name);
        first.remove();
      }
    }
    row.lastChild.textContent = text;
    log.scrollTop = log.scrollHeight;
  }

  function handle(event, live) {
    if (event.type === "heard") addRow("user", event.text, event.turn);
    else if (event.type === "reply") addRow("jarvis", event.text, event.turn);
    else if (event.type === "tool") addRow("tool", event.label, `${event.turn}-${event.seq}`);
    else if (event.type === "say" && live) enqueueSpeech(event.text);
    else if (event.type === "ignored" && live && event.why) toast(event.why, true);
  }

  function setTheme(theme) {
    if (!theme?.accent) return;
    const value = parseInt(theme.accent.slice(1), 16);
    document.documentElement.style.setProperty("--hud", theme.accent);
    document.documentElement.style.setProperty("--hud-rgb", [(value >> 16) & 255, (value >> 8) & 255, value & 255].join(", "));
    document.documentElement.style.setProperty("--accent2", theme.accent2 || "#ffb45e");
    const key = JSON.stringify(theme);
    if (key !== state.themeKey) {
      state.themeKey = key;
      state.theme = theme;
      document.dispatchEvent(new CustomEvent("jarvis:phone-theme", { detail: { theme } }));
    }
  }

  function gauges(data) {
    const items = [["CPU", data.cpu_percent], ["RAM", data.memory_percent], [state.lang === "en-US" ? "DISK" : "DISCO", data.disk_percent]];
    if (data.battery_percent !== undefined) items.push([state.lang === "en-US" ? "BATTERY" : "BATERIA", data.battery_percent]);
    $("#gauges").replaceChildren(...items.map(([label, value]) => {
      const gauge = node("div", "gauge");
      const percent = Math.round(Number(value) || 0);
      gauge.style.setProperty("--p", percent);
      gauge.append(node("b", "", `${percent}%`), node("span", "", label));
      return gauge;
    }));
  }

  async function poll(force = false) {
    if (state.polling && !force) return;
    state.polling = true;
    try {
      const data = await json(`/m/state?since=${state.seq}`, { timeout: 8000 });
      const live = state.synced;
      state.failures = 0;
      $("#lost").hidden = true;
      state.name = data.name || "Jarvis";
      $$("[data-brand]").forEach((item) => {
        item.textContent = state.name.toUpperCase();
      });
      state.modelsVersion = String(data.models || "");
      setTheme(data.theme);
      for (const event of data.events || []) {
        state.seq = Math.max(state.seq, event.seq);
        handle(event, live);
      }
      state.seq = Math.max(state.seq, data.seq || 0);
      state.synced = true;
      state.mood = data.state || "idle";
      document.body.dataset.state = state.mood;
      $("#state").textContent = STATES[state.lang][state.mood] || state.mood.toUpperCase();
      $("#dot").classList.add("is-on");
      $("#host").textContent = data.telemetry?.hostname || "";
      if (data.telemetry) gauges(data.telemetry);
    } catch (error) {
      state.failures += 1;
      $("#dot").classList.remove("is-on");
      if (state.failures >= 3) {
        $("#lost").hidden = false;
        if (REMOTE_APP && state.failures % 3 === 0) resolveBase(true).catch(() => {}); // a new tunnel address, or back on the Wi-Fi
      }
    } finally {
      state.polling = false;
    }
  }

  async function ask(text) {
    const message = String(text || "").trim();
    if (!message) return;
    vibrate();
    stopSpeech();
    audioContext(); // a tap: the phone allows the voice to play from now on
    $("#ask").value = "";
    try {
      await json("/m/ask", { method: "POST", body: { text: message, quiet: state.quiet } });
      showPane("talk");
      poll(true);
    } catch (error) {
      toast(error.message, true);
    }
  }

  /* ---------- panes ---------- */

  function showPane(name) {
    $$(".pane").forEach((pane) => pane.classList.toggle("is-active", pane.id === `pane-${name}`));
    $$(".tabs [data-pane]").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.pane === name));
    if (name !== "control") setLive(false);
    if (name === "settings") renderConn();
    document.dispatchEvent(new CustomEvent("jarvis:phone-pane", { detail: { pane: name } }));
  }

  function renderConn() {
    const box = $("#conn");
    if (!box) return;
    const rows = [[t("server"), state.conn?.name || "--"], [t("route"), state.route === "remote" ? t("routeRemote") : t("routeLan")],
      [t("device"), state.device || "--"], [t("since"), state.conn?.since ? new Date(state.conn.since).toLocaleDateString(state.lang) : "--"]];
    box.replaceChildren(...rows.map(([term, value]) => {
      const item = node("div");
      item.append(node("dt", "", term), node("dd", "", value));
      return item;
    }));
  }

  async function screenshot() {
    const box = $("#shot-box");
    box.classList.add("is-loading");
    try {
      const response = await api(`/m/screen?t=${Date.now()}`, { timeout: 20000 });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "falhou");
      const url = URL.createObjectURL(await response.blob());
      const image = $("img", box) || node("img");
      const old = image.src;
      image.src = url;
      if (!image.parentNode) box.replaceChildren(image);
      if (old.startsWith("blob:")) URL.revokeObjectURL(old);
    } catch (error) {
      toast(error.message, true);
      setLive(false);
    } finally {
      box.classList.remove("is-loading");
    }
  }

  function setLive(on) {
    window.clearInterval(state.live);
    state.live = 0;
    $("#shot-live").checked = on;
    if (on) {
      screenshot();
      state.live = window.setInterval(screenshot, state.route === "remote" ? 4000 : 2500);
    }
  }

  async function uploadFiles(files) {
    for (const file of files) {
      const row = node("li", "", `${file.name} · …`);
      $("#uploads").prepend(row);
      try {
        const data = await json(`/m/upload?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file, raw: true });
        row.textContent = `✓ ${data.file?.name || file.name}`;
        row.classList.add("is-ok");
      } catch (error) {
        row.textContent = `✗ ${file.name}: ${error.message}`;
        row.classList.add("is-error");
      }
    }
  }

  async function disconnect(confirmFirst = true) {
    if (confirmFirst && !window.confirm(t("confirmOff"))) return;
    if (confirmFirst) {
      try {
        await json("/m/unpair", { method: "POST", body: {} });
      } catch (_) {
        /* Offline: forgotten here anyway; it can be revoked on the PC. */
      }
    }
    window.clearInterval(state.pollTimer);
    stopSpeech();
    state.conn = null;
    state.base = "";
    state.seq = 0;
    state.synced = false;
    saveConn();
    $("#log").replaceChildren();
    state.rows.clear();
    showEntry();
    $("#entry-log").replaceChildren();
    bootLine("bootWait")("—");
  }

  function startApp() {
    document.body.dataset.screen = "app";
    $("#entry").hidden = true;
    $("#app").hidden = false;
    renderConn();
    window.clearInterval(state.pollTimer);
    poll(true);
    state.pollTimer = window.setInterval(poll, state.route === "remote" ? 1500 : 1000);
    document.dispatchEvent(new CustomEvent("jarvis:phone-ready"));
  }

  async function setLanguage(code) {
    state.lang = code;
    try {
      window.localStorage.setItem("jarvis.remote.lang", code);
    } catch (_) {
      /* Not remembered. */
    }
    applyLang();
    if ($("#lang-pc").checked && state.conn?.token) {
      try {
        await json("/m/language", { method: "POST", body: { code } });
      } catch (error) {
        toast(error.message, true);
      }
    }
  }

  /* ---------- background and clock ---------- */

  function background() {
    const canvas = $("#bg");
    const context = canvas.getContext("2d");
    let width = 0;
    let height = 0;
    const dots = Array.from({ length: 46 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 0.0006 + 0.0002, r: Math.random() * 1.3 + 0.3 }));
    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const draw = () => {
      context.clearRect(0, 0, width, height);
      const rgb = getComputedStyle(document.documentElement).getPropertyValue("--hud-rgb").trim() || "43, 217, 255";
      for (const dot of dots) {
        dot.y -= dot.s;
        if (dot.y < -0.02) dot.y = 1.02;
        context.fillStyle = `rgba(${rgb}, 0.35)`;
        context.beginPath();
        context.arc(dot.x * width, dot.y * height, dot.r, 0, Math.PI * 2);
        context.fill();
      }
      window.requestAnimationFrame(draw);
    };
    resize();
    window.addEventListener("resize", resize);
    draw();
    window.setInterval(() => {
      $("#entry-clock").textContent = new Date().toLocaleTimeString(state.lang, { hour12: false });
    }, 1000);
  }

  /* ---------- shared with panel.js and holo.js ---------- */

  window.jarvisPhone = {
    json,
    api,
    t,
    toast,
    ask,
    vibrate,
    showPane,
    node,
    get lang() { return state.lang; },
    get theme() { return state.theme; },
    get modelsVersion() { return state.modelsVersion; },
    /** The hologram: what the assistant is doing, and how loud (its voice here, or the microphone). */
    voice() {
      if (document.body.classList.contains("is-recording")) return { state: "armed", level: rec.level };
      const level = outputLevel();
      if (level > 0.01) return { state: "speaking", level };
      return { state: state.mood === "speaking" ? "idle" : state.mood, level: 0 };
    },
    /** A model file through the server (cached here by its version): models/... -> /m/model/... */
    async model(path, kind) {
      const url = `/m/model/${path.replace(/^models\//, "")}`;
      const key = `https://jarvis.local${url}?v=${encodeURIComponent(state.modelsVersion)}`;
      let cache = null;
      try {
        cache = await caches.open("jarvis-models");
        const hit = await cache.match(key);
        if (hit) return kind === "json" ? hit.json() : hit.arrayBuffer();
      } catch (_) {
        cache = null; // no Cache Storage here: straight from the PC every time
      }
      let bytes;
      if (kind === "json") {
        const response = await api(url, { timeout: 30000 });
        if (!response.ok) throw new Error(`modelo ${response.status}`);
        bytes = await response.arrayBuffer();
      } else {
        bytes = await sliced(url);
      }
      if (cache) cache.put(key, new Response(bytes.slice(0))).catch(() => {});
      return kind === "json" ? JSON.parse(new TextDecoder().decode(bytes)) : bytes;
    },
    /** Shows a module on the PC's screen (and, for the map, a place). */
    async onPc(view, command = "", arg = "") {
      try {
        await json("/m/view", { method: "POST", body: { view, command, arg } });
        toast(`PC ✓`);
      } catch (error) {
        toast(error.message, true);
      }
    },
  };

  function init() {
    loadConn();
    background();
    deviceName().then((name) => {
      state.device = name;
    });
    applyLang();
    $("#scan").addEventListener("click", scan);
    $("#show-code").addEventListener("click", () => {
      $("#pair-form").hidden = !$("#pair-form").hidden;
      $("#pair-code").focus();
    });
    $("#pair-form").addEventListener("submit", (event) => {
      event.preventDefault();
      connectFlow({ digits: $("#pair-code").value.replace(/\D/g, "") });
    });
    $("#ask-form").addEventListener("submit", (event) => {
      event.preventDefault();
      ask($("#ask").value);
    });
    $("#mic").addEventListener("click", () => {
      audioContext();
      if (document.body.classList.contains("is-recording")) stopRecording();
      else startRecording();
    });
    document.addEventListener("pointerdown", () => audioContext(), { passive: true }); // phones only play audio after a touch
    $$(".tabs [data-pane]").forEach((tab) => tab.addEventListener("click", () => {
      vibrate(6);
      showPane(tab.dataset.pane);
    }));
    $$("[data-control]").forEach((button) => button.addEventListener("click", async () => {
      vibrate();
      try {
        toast((await json("/m/control", { method: "POST", body: { action: button.dataset.control } })).message || "OK");
      } catch (error) {
        toast(error.message, true);
      }
    }));
    $("#shot").addEventListener("click", screenshot);
    $("#shot-live").addEventListener("change", (event) => setLive(event.target.checked));
    $("#files").addEventListener("change", (event) => {
      uploadFiles([...event.target.files]);
      event.target.value = "";
    });
    $("#open-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const url = $("#open-url").value.trim();
      if (!url) return;
      try {
        toast((await json("/m/open", { method: "POST", body: { url } })).message || "OK");
        $("#open-url").value = "";
      } catch (error) {
        toast(error.message, true);
      }
    });
    $$("#langs button").forEach((button) => button.addEventListener("click", () => setLanguage(button.dataset.lang)));
    const speakToggle = $("#speak-toggle");
    speakToggle.checked = state.speak;
    speakToggle.addEventListener("change", () => {
      state.speak = speakToggle.checked;
      remember("jarvis.remote.speak", state.speak);
      if (!state.speak) stopSpeech();
    });
    const quietToggle = $("#quiet-toggle");
    quietToggle.checked = state.quiet;
    quietToggle.addEventListener("change", () => {
      state.quiet = quietToggle.checked;
      remember("jarvis.remote.quiet", state.quiet);
    });
    $("#disconnect").addEventListener("click", () => disconnect(true));
    if (REMOTE_APP && !NATIVE && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    if (NATIVE) {
      window.Capacitor?.Plugins?.App?.addListener?.("backButton", () => { // Android's back key: one step back, then out
        if ($("#pane-panel").classList.contains("is-active") && !$("#module").hidden) document.dispatchEvent(new CustomEvent("jarvis:phone-back"));
        else if (!$("#pane-talk").classList.contains("is-active")) showPane("talk");
        else window.Capacitor.Plugins.App.minimizeApp?.();
      });
    }
    connectFlow(fromFragment());
  }

  init();
})();
