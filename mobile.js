/* Conexão JARVIS: the phone app of the assistant whose PC is the server.

   Two ways in, one app:
   - installed from GitHub Pages: the QR code on the PC (aba CELULAR, acesso remoto ligado) opens
     this page with #c=<topic, one-time secret>. The PC's current HTTPS address (a Cloudflare quick
     tunnel) is read from that private ntfy topic, the secret becomes this device's token, and
     from then on the app always finds that PC again, from any network, until DESCONECTAR.
   - served by the PC itself on the same Wi-Fi (http://<pc>:8770): same app, same-origin calls,
     pairing by the QR code or the 6-digit code.
   The PC must be on with Jarvis open; while it is not, the app keeps looking for it. */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const STORE = "jarvis.conexao";
  const NTFY = "https://ntfy.sh";
  const REMOTE_APP = location.hostname.endsWith("github.io"); // installed app, not the PC's own page
  const STATES = {
    "pt-BR": { idle: "PRONTO", armed: "OUVINDO", thinking: "PENSANDO", speaking: "FALANDO", muted: "MUDO", loading: "INICIANDO", off: "SÓ TEXTO" },
    "en-US": { idle: "READY", armed: "LISTENING", thinking: "THINKING", speaking: "SPEAKING", muted: "MUTED", loading: "STARTING", off: "TEXT ONLY" },
    "es-ES": { idle: "LISTO", armed: "ESCUCHANDO", thinking: "PENSANDO", speaking: "HABLANDO", muted: "SILENCIO", loading: "INICIANDO", off: "SOLO TEXTO" },
  };
  const MODULES = [
    ["home", ["INÍCIO", "HOME", "INICIO"]], ["dialogue", ["DIÁLOGO", "DIALOGUE", "DIÁLOGO"]], ["map", ["MAPA GLOBAL", "WORLD MAP", "MAPA GLOBAL"]],
    ["news", ["NOTÍCIAS", "NEWS", "NOTICIAS"]], ["finance", ["MERCADO DE INVESTIMENTO", "INVESTMENT MARKET", "MERCADO DE INVERSIÓN"]],
    ["explorer", ["EXPLORER", "EXPLORER", "EXPLORADOR"]], ["apps", ["APLICATIVOS", "APPS", "APLICACIONES"]], ["technical", ["TÉCNICO", "TECHNICAL", "TÉCNICO"]],
    ["system", ["SISTEMA", "SYSTEM", "SISTEMA"]], ["files", ["ARQUIVOS", "FILES", "ARCHIVOS"]], ["notes", ["ANOTAÇÕES", "NOTES", "NOTAS"]],
    ["security", ["SEGURANÇA", "SECURITY", "SEGURIDAD"]], ["tutorial", ["TUTORIAL", "TUTORIAL", "TUTORIAL"]], ["custom", ["CUSTOMIZAÇÃO", "CUSTOMIZE", "PERSONALIZAR"]],
  ];
  const LANGS = ["pt-BR", "en-US", "es-ES"];
  const TEXT = {
    secure: ["LINK NEURAL SEGURO", "SECURE NEURAL LINK", "ENLACE NEURAL SEGURO"], conn: ["CONEXÃO", "CONNECTION", "CONEXIÓN"],
    tagline: ["SEU ASSISTENTE, ONDE VOCÊ ESTIVER", "YOUR ASSISTANT, WHEREVER YOU ARE", "TU ASISTENTE, DONDE ESTÉS"],
    scan: ["ESCANEAR QR CODE", "SCAN QR CODE", "ESCANEAR CÓDIGO QR"], typeCode: ["DIGITAR CÓDIGO (MESMO WI-FI)", "TYPE CODE (SAME WI-FI)", "ESCRIBIR CÓDIGO (MISMO WI-FI)"],
    pair: ["PAREAR", "PAIR", "EMPAREJAR"], cancel: ["CANCELAR", "CANCEL", "CANCELAR"],
    hint: ["No PC, abra a aba CELULAR e aponte a câmera para o QR code.", "On the PC, open the PHONE tab and point the camera at the QR code.",
      "En el PC, abra la pestaña MÓVIL y apunte la cámara al código QR."],
    lost: ["PROCURANDO O JARVIS… O PC ESTÁ LIGADO?", "LOOKING FOR JARVIS… IS THE PC ON?", "BUSCANDO A JARVIS… ¿EL PC ESTÁ ENCENDIDO?"],
    telemetry: ["// TELEMETRIA DO PC", "// PC TELEMETRY", "// TELEMETRÍA DEL PC"], modules: ["// MÓDULO NA TELA DO PC", "// MODULE ON THE PC SCREEN", "// MÓDULO EN LA PANTALLA DEL PC"],
    media: ["// MÍDIA E SISTEMA", "// MEDIA AND SYSTEM", "// MEDIOS Y SISTEMA"], prev: ["ANTERIOR", "PREVIOUS", "ANTERIOR"], play: ["PLAY/PAUSA", "PLAY/PAUSE", "PLAY/PAUSA"],
    next: ["PRÓXIMA", "NEXT", "SIGUIENTE"], volume: ["VOLUME", "VOLUME", "VOLUMEN"], mute: ["MUDO", "MUTE", "SILENCIO"], desktop: ["ÁREA DE TRAB.", "DESKTOP", "ESCRITORIO"],
    lock: ["BLOQUEAR PC", "LOCK PC", "BLOQUEAR PC"], refresh: ["ATUALIZAR", "REFRESH", "ACTUALIZAR"], live: ["AO VIVO", "LIVE", "EN VIVO"],
    shotHint: ["Toque em ATUALIZAR para ver a tela do PC.", "Tap REFRESH to see the PC screen.", "Toque ACTUALIZAR para ver la pantalla del PC."],
    sendTitle: ["// ENVIAR PARA O PC", "// SEND TO THE PC", "// ENVIAR AL PC"], pick: ["Toque para escolher fotos ou arquivos", "Tap to pick photos or files", "Toque para elegir fotos o archivos"],
    pickNote: ["Vão para a pasta de anotações do PC", "They go to the PC's notes folder", "Van a la carpeta de notas del PC"], openTitle: ["// ABRIR NO PC", "// OPEN ON THE PC", "// ABRIR EN EL PC"],
    open: ["ABRIR", "OPEN", "ABRIR"], language: ["// LINGUAGEM", "// LANGUAGE", "// IDIOMA"],
    langPc: ["MUDAR TAMBÉM O IDIOMA DO JARVIS NO PC", "ALSO CHANGE JARVIS'S LANGUAGE ON THE PC", "CAMBIAR TAMBIÉN EL IDIOMA DE JARVIS EN EL PC"],
    voice: ["// VOZ", "// VOICE", "// VOZ"], speakHere: ["FALAR AS RESPOSTAS NESTE CELULAR", "SPEAK THE REPLIES ON THIS PHONE", "HABLAR LAS RESPUESTAS EN ESTE MÓVIL"],
    connection: ["// CONEXÃO", "// CONNECTION", "// CONEXIÓN"], disconnect: ["DESCONECTAR DESTE JARVIS", "DISCONNECT FROM THIS JARVIS", "DESCONECTAR DE ESTE JARVIS"],
    disconnectNote: ["O celular deixa de ter acesso. Para voltar, escaneie o QR code de novo.", "This phone loses access. To come back, scan the QR code again.",
      "Este móvil pierde el acceso. Para volver, escanee el código QR de nuevo."],
    tTalk: ["CONVERSA", "TALK", "CHARLA"], tControl: ["CONTROLE", "CONTROL", "CONTROL"], tScreen: ["TELA", "SCREEN", "PANTALLA"], tSettings: ["AJUSTES", "SETTINGS", "AJUSTES"],
    ask: ["Fale ou digite um pedido…", "Speak or type a request…", "Hable o escriba un pedido…"], you: ["VOCÊ", "YOU", "TÚ"], action: ["AÇÃO", "ACTION", "ACCIÓN"],
    bootScan: ["Iniciando o núcleo do app", "Starting the app core", "Iniciando el núcleo de la app"],
    bootLocate: ["Localizando o servidor", "Locating the server", "Localizando el servidor"],
    bootTunnel: ["Abrindo canal criptografado", "Opening encrypted channel", "Abriendo canal cifrado"],
    bootAuth: ["Autenticando este dispositivo", "Authenticating this device", "Autenticando este dispositivo"],
    bootOk: ["Link estabelecido", "Link established", "Enlace establecido"], bootWait: ["Aguardando pareamento", "Waiting for pairing", "Esperando emparejamiento"],
    connected: ["Conectado ao", "Connected to", "Conectado a"], server: ["SERVIDOR", "SERVER", "SERVIDOR"], route: ["ROTA", "ROUTE", "RUTA"],
    routeRemote: ["Internet (túnel seguro)", "Internet (secure tunnel)", "Internet (túnel seguro)"], routeLan: ["Mesmo Wi-Fi", "Same Wi-Fi", "Mismo Wi-Fi"],
    device: ["ESTE APARELHO", "THIS DEVICE", "ESTE DISPOSITIVO"], since: ["DESDE", "SINCE", "DESDE"], confirmOff: ["Desconectar este celular do Jarvis?",
      "Disconnect this phone from Jarvis?", "¿Desconectar este móvil de Jarvis?"], noCamera: ["Este navegador não lê QR code: use a câmera do celular.",
      "This browser can't read QR codes: use the phone camera.", "Este navegador no lee códigos QR: use la cámara del móvil."],
    dictate: ["Toque no 🎤 do teclado para ditar.", "Tap the keyboard 🎤 to dictate.", "Toque el 🎤 del teclado para dictar."],
    expired: ["Pareamento expirado ou revogado.", "Pairing expired or revoked.", "Emparejamiento vencido o revocado."],
  };
  const state = { conn: null, base: "", seq: 0, synced: false, polling: false, failures: 0, live: 0, rows: new Map(), name: "Jarvis",
    lang: "pt-BR", speak: false, pollTimer: 0 };

  /* ---------- storage and language ---------- */

  function loadConn() {
    try {
      state.conn = JSON.parse(window.localStorage.getItem(STORE) || "null");
      state.speak = window.localStorage.getItem("jarvis.remote.speak") === "on";
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

  const t = (key) => (TEXT[key] || [key])[LANGS.indexOf(state.lang)] || TEXT[key]?.[0] || key;

  function applyLang() {
    document.documentElement.lang = state.lang;
    $$("[data-i18n]").forEach((item) => {
      item.textContent = t(item.dataset.i18n);
    });
    $("#ask").placeholder = t("ask");
    $$("#langs button").forEach((button) => button.classList.toggle("is-active", button.dataset.lang === state.lang));
    buildModules();
    renderConn();
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

  /** The base of every call: "" on the PC's own page, the tunnel address in the installed app. */
  async function resolveBase(force = false) {
    if (!REMOTE_APP) {
      state.base = "";
      return "";
    }
    if (!state.conn?.topic) throw new Error("sem servidor");
    if (state.base && !force) return state.base;
    state.base = await latestAddress(state.conn.topic);
    state.conn.base = state.base;
    saveConn();
    return state.base;
  }

  async function api(path, { method = "GET", body, raw, timeout } = {}) {
    const headers = { Authorization: `Bearer ${state.conn?.token || ""}` };
    if (body !== undefined && !raw) headers["Content-Type"] = "application/json";
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout || (raw ? 120000 : 10000));
    try {
      const response = await fetch(`${state.base}${path}`, { method, headers, body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store", signal: controller.signal });
      if (response.status === 401) {
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

  function deviceName() {
    const agent = navigator.userAgent;
    const model = /\(Linux; Android [^;]+; ([^)]+?)(?: Build|\))/.exec(agent)?.[1];
    if (model) return model.trim().slice(0, 32);
    if (/iPhone/.test(agent)) return "iPhone";
    if (/iPad/.test(agent)) return "iPad";
    return /Android/.test(agent) ? "Android" : "Celular";
  }

  function showEntry() {
    document.body.dataset.screen = "entry";
    $("#app").hidden = true;
    $("#entry").hidden = false;
    $("#show-code").hidden = REMOTE_APP; // 6 digits only on the same Wi-Fi
  }

  /** Pairs with what the QR code carried: {t: topic, k: secret, n: name, l: lan url}. */
  async function pairRemote(config) {
    const locate = bootLine("bootLocate");
    try {
      state.conn = { topic: config.t, token: "", name: config.n || "Jarvis", since: Date.now(), lan: config.l || "" };
      await resolveBase(true);
      locate("OK");
    } catch (error) {
      locate("OFFLINE", false);
      throw error;
    }
    const tunnel = bootLine("bootTunnel");
    tunnel("TLS");
    const auth = bootLine("bootAuth");
    const response = await fetch(`${state.base}/m/pair`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: config.k, name: deviceName() }) });
    const data = await response.json().catch(() => ({}));
    if (!data.ok) {
      auth("NEGADO", false);
      state.conn = null;
      throw new Error(data.error || "pareamento recusado");
    }
    auth("OK");
    state.conn.token = data.token;
    state.conn.name = data.name || state.conn.name;
    saveConn();
  }

  async function pairLocal(code) {
    const clean = /^\d[\d ]*$/.test(String(code)) ? String(code).replace(/\D/g, "") : String(code); // 6 digits or the QR secret
    const auth = bootLine("bootAuth");
    const response = await fetch("/m/pair", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: clean, name: deviceName() }) });
    const data = await response.json().catch(() => ({}));
    if (!data.ok) {
      auth("NEGADO", false);
      throw new Error(data.error || "código recusado");
    }
    auth("OK");
    state.conn = { topic: "", token: data.token, name: data.name || "Jarvis", since: Date.now(), lan: location.origin };
    saveConn();
  }

  function fromFragment() {
    const hash = location.hash || "";
    const packed = /[#&]c=([A-Za-z0-9_-]+)/.exec(hash)?.[1];
    const digits = /[#&]pair=(\d{6})/.exec(hash)?.[1];
    history.replaceState(null, "", location.pathname); // the secret does not stay in the address bar
    if (packed) {
      try {
        const text = atob(packed.replace(/-/g, "+").replace(/_/g, "/"));
        return { remote: JSON.parse(decodeURIComponent(escape(text))) };
      } catch (_) {
        return null;
      }
    }
    return digits ? { digits } : null;
  }

  async function connectFlow(pairing) {
    showEntry();
    $("#entry-log").replaceChildren();
    const boot = bootLine("bootScan");
    boot("OK");
    try {
      if (pairing?.remote) {
        if (REMOTE_APP) await pairRemote(pairing.remote);
        else await pairLocal(pairing.remote.k); // the remote QR read on the PC's own page: same secret, same Wi-Fi
      } else if (pairing?.digits && !REMOTE_APP) {
        await pairLocal(pairing.digits);
      } else if (state.conn?.token) {
        const locate = bootLine("bootLocate");
        await resolveBase(true).then(() => locate("OK"), (error) => {
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

  /* ---------- QR scanning inside the app (where the browser can) ---------- */

  async function scan() {
    if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
      toast(t("noCamera"));
      return;
    }
    const box = $("#scanner");
    const video = $("#scanner-video");
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch (error) {
      toast(t("noCamera"), true);
      return;
    }
    box.hidden = false;
    video.srcObject = stream;
    await video.play().catch(() => {});
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    let done = false;
    const stop = () => {
      done = true;
      stream.getTracks().forEach((track) => track.stop());
      box.hidden = true;
    };
    $("#scanner-close").onclick = stop;
    const loop = async () => {
      if (done) return;
      try {
        const codes = await detector.detect(video);
        const value = codes[0]?.rawValue || "";
        const packed = /[#&]c=([A-Za-z0-9_-]+)/.exec(value)?.[1];
        const digits = /[#&]pair=(\d{6})/.exec(value)?.[1];
        if (packed || digits) {
          stop();
          vibrate(60);
          history.replaceState(null, "", `${location.pathname}#${packed ? `c=${packed}` : `pair=${digits}`}`);
          connectFlow(fromFragment());
          return;
        }
      } catch (_) {
        /* Next frame. */
      }
      window.setTimeout(loop, 250);
    };
    loop();
  }

  /* ---------- the app ---------- */

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

  function speak(text) {
    if (!state.speak || !window.speechSynthesis || !text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = state.lang;
    const voice = window.speechSynthesis.getVoices().find((item) => item.lang?.toLowerCase().startsWith(state.lang.slice(0, 2)));
    if (voice) utterance.voice = voice;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function handle(event, live) {
    if (event.type === "heard") addRow("user", event.text, event.turn);
    else if (event.type === "reply") {
      addRow("jarvis", event.text, event.turn);
      if (live && event.done) speak(event.text);
    } else if (event.type === "tool") addRow("tool", event.label, `${event.turn}-${event.seq}`);
  }

  function setTheme(theme) {
    if (!theme?.accent) return;
    const value = parseInt(theme.accent.slice(1), 16);
    document.documentElement.style.setProperty("--hud", theme.accent);
    document.documentElement.style.setProperty("--hud-rgb", [(value >> 16) & 255, (value >> 8) & 255, value & 255].join(", "));
    document.documentElement.style.setProperty("--accent2", theme.accent2 || "#ffb45e");
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
      setTheme(data.theme);
      for (const event of data.events || []) {
        state.seq = Math.max(state.seq, event.seq);
        handle(event, live);
      }
      state.seq = Math.max(state.seq, data.seq || 0);
      state.synced = true;
      const mood = data.state || "idle";
      document.body.dataset.state = mood;
      $("#state").textContent = STATES[state.lang][mood] || mood.toUpperCase();
      $("#dot").classList.add("is-on");
      $("#host").textContent = data.telemetry?.hostname || "";
      if (data.telemetry) gauges(data.telemetry);
    } catch (error) {
      state.failures += 1;
      $("#dot").classList.remove("is-on");
      if (state.failures >= 3) {
        $("#lost").hidden = false;
        if (REMOTE_APP && state.failures % 3 === 0) resolveBase(true).catch(() => {}); // the tunnel may have a new address
      }
    } finally {
      state.polling = false;
    }
  }

  async function ask(text) {
    const message = String(text || "").trim();
    if (!message) return;
    vibrate();
    $("#ask").value = "";
    try {
      await json("/m/ask", { method: "POST", body: { text: message } });
      showPane("talk");
      poll(true);
    } catch (error) {
      toast(error.message, true);
    }
  }

  function setupMic() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const button = $("#mic");
    if (!Recognition || !window.isSecureContext) {
      button.addEventListener("click", () => {
        $("#ask").focus();
        toast(t("dictate"));
      });
      return;
    }
    const recognition = new Recognition();
    recognition.interimResults = true;
    let listening = false;
    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      $("#ask").value = result[0].transcript;
      if (result.isFinal) ask(result[0].transcript);
    };
    const end = () => {
      listening = false;
      button.classList.remove("is-live");
    };
    recognition.onend = end;
    recognition.onerror = () => {
      end();
      $("#ask").focus();
    };
    button.addEventListener("click", () => {
      if (listening) {
        recognition.stop();
        return;
      }
      recognition.lang = state.lang;
      try {
        recognition.start();
        listening = true;
        button.classList.add("is-live");
        vibrate(25);
      } catch (_) {
        $("#ask").focus();
      }
    });
  }

  function showPane(name) {
    $$(".pane").forEach((pane) => pane.classList.toggle("is-active", pane.id === `pane-${name}`));
    $$(".tabs [data-pane]").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.pane === name));
    if (name !== "screen") setLive(false);
    if (name === "settings") renderConn();
  }

  function buildModules() {
    const column = LANGS.indexOf(state.lang);
    $("#modules").replaceChildren(...MODULES.map(([view, labels]) => {
      const button = node("button", view === "finance" ? "is-wide" : "", labels[column]);
      button.type = "button";
      button.addEventListener("click", async () => {
        vibrate();
        try {
          await json("/m/view", { method: "POST", body: { view } });
          toast(`PC: ${labels[column].toLowerCase()}`);
        } catch (error) {
          toast(error.message, true);
        }
      });
      return button;
    }));
  }

  function renderConn() {
    const box = $("#conn");
    if (!box) return;
    const rows = [[t("server"), state.conn?.name || "--"], [t("route"), REMOTE_APP ? t("routeRemote") : t("routeLan")],
      [t("device"), deviceName()], [t("since"), state.conn?.since ? new Date(state.conn.since).toLocaleDateString(state.lang) : "--"]];
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
      state.live = window.setInterval(screenshot, REMOTE_APP ? 4000 : 2500);
    }
  }

  async function upload(files) {
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

  async function disconnect(ask = true) {
    if (ask && !window.confirm(t("confirmOff"))) return;
    if (ask) {
      try {
        await json("/m/unpair", { method: "POST", body: {} });
      } catch (_) {
        /* Offline: forgotten here anyway; it can be revoked on the PC. */
      }
    }
    window.clearInterval(state.pollTimer);
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
    state.pollTimer = window.setInterval(poll, REMOTE_APP ? 1500 : 1000);
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

  function init() {
    loadConn();
    background();
    setupMic();
    applyLang();
    const bars = $("#orb-bars");
    for (let i = 0; i < 24; i += 1) {
      const bar = node("i");
      bar.style.setProperty("--i", i);
      bars.append(bar);
    }
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
      upload([...event.target.files]);
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
      try {
        window.localStorage.setItem("jarvis.remote.speak", state.speak ? "on" : "off");
      } catch (_) {
        /* Not remembered. */
      }
    });
    $("#disconnect").addEventListener("click", () => disconnect(true));
    if (REMOTE_APP && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    connectFlow(fromFragment());
  }

  init();
})();
