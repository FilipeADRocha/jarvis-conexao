/* PAINEL: the PC's HUD on the phone. The same 16 modules of the desktop ring, each adapted to a phone
   screen and fed by the desktop's own APIs through the phone link (/m/api/... -> /api/...): telemetry,
   apps (launched on the PC), the investment market, news, the explorer, notes, the global map (the PC's own
   globe and dossier), security, the tutorial and CUSTOMIZAÇÃO (theme and 3D model, which the PC follows at once).
   "NO PC" shows the same module on the PC's screen. */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const phone = () => window.jarvisPhone;
  const SVG = "http://www.w3.org/2000/svg";
  const L = (pt, en, es) => ({ "en-US": en, "es-ES": es }[phone()?.lang] || pt);
  const node = (tag, className, text) => phone().node(tag, className, text);
  const PRESETS = {
    jarvis: { accent: "#2bd9ff", accent2: "#ffb45e", background: "profundo", style: "reator", font: "tecnica" },
    ultron: { accent: "#ff2e55", accent2: "#c7d0d8", background: "preto", style: "tatico", font: "mono" },
    sexta: { accent: "#b07bff", accent2: "#ff7ad9", background: "naval", style: "reator", font: "classica" },
    sentinela: { accent: "#3dff7a", accent2: "#ff3b2a", background: "preto", style: "minimal", font: "mono" },
    hal: { accent: "#ff3b30", accent2: "#5aa9e6", background: "preto", style: "minimal", font: "classica" },
    kinito: { accent: "#ff7ae0", accent2: "#8dff5a", background: "naval", style: "reator", font: "mono" },
    verity: { accent: "#ffd21a", accent2: "#ff5a3c", background: "preto", style: "minimal", font: "tecnica" },
    glados: { accent: "#ffb21c", accent2: "#e9eef2", background: "carbono", style: "tatico", font: "tecnica" },
    auto: { accent: "#ff3a2e", accent2: "#eef3f6", background: "naval", style: "tatico", font: "tecnica" },
  };
  const MODEL_NAMES = { jarvis: "JARVIS", ultron: "ULTRON", sexta: "SEXTA-FEIRA", sentinela: "SENTINELA", hal: "HAL 9000",
    kinito: "KINITOPET", verity: "VERITY", glados: "GLaDOS", auto: "AUTO" };
  let timer = 0;
  let clock = 0;
  let current = null;

  /* ---------- small helpers ---------- */

  function card(title) {
    const box = node("section", "m-card");
    if (title) box.append(node("h3", "", title));
    return box;
  }

  function kv(rows) {
    const list = node("dl", "m-kv");
    for (const [term, value] of rows) {
      if (value === undefined || value === null || value === "") continue;
      const item = node("div");
      item.append(node("dt", "", term), node("dd", "", String(value)));
      list.append(item);
    }
    return list;
  }

  function button(text, action, className = "m-button") {
    const item = node("button", className, text);
    item.type = "button";
    item.addEventListener("click", action);
    return item;
  }

  function link(text, url, meta = "") {
    const item = node("a", "m-link");
    item.href = url;
    item.target = "_blank";
    item.rel = "noopener noreferrer";
    item.append(node("span", "", text));
    if (meta) item.append(node("em", "", meta));
    return item;
  }

  function ago(seconds) {
    if (!seconds) return "";
    const minutes = Math.max(1, Math.round((Date.now() / 1000 - seconds) / 60));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
  }

  function meter(label, percent, extra = "") {
    const box = node("div", "m-meter");
    const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    box.style.setProperty("--p", value);
    box.append(node("span", "", label), node("b", "", `${value}%`), node("i"));
    if (extra) box.append(node("em", "", extra));
    return box;
  }

  function spark(values) {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 60 20");
    svg.classList.add("m-spark");
    const nums = (values || []).filter((value) => Number.isFinite(value));
    if (nums.length > 1) {
      const lo = Math.min(...nums);
      const hi = Math.max(...nums);
      const path = document.createElementNS(SVG, "polyline");
      path.setAttribute("points", nums.map((value, index) => `${(index / (nums.length - 1)) * 60},${18 - ((value - lo) / ((hi - lo) || 1)) * 16}`).join(" "));
      svg.append(path);
    }
    return svg;
  }

  function search(placeholder, onSubmit) {
    const form = node("form", "m-search");
    const input = node("input");
    input.placeholder = placeholder;
    input.autocomplete = "off";
    form.append(input, node("button", "", "›"));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (input.value.trim()) onSubmit(input.value.trim());
    });
    return form;
  }

  const fmt = (value, decimals = 2) => (Number.isFinite(value) ? value.toLocaleString(phone().lang, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : "--");

  /* ---------- the modules ---------- */

  async function technical(body) {
    const render = async () => {
      const { tech } = await phone().json("/m/api/tech?lite=1");
      const gpu = tech.gpu || {};
      const vram = gpu.mem_total_mb ? (100 * gpu.mem_used_mb) / gpu.mem_total_mb : 0;
      const box = card(L("// DIAGNÓSTICO AO VIVO", "// LIVE DIAGNOSTICS", "// DIAGNÓSTICO EN VIVO"));
      box.append(meter("CPU", tech.cpu?.percent), meter("RAM", tech.memory?.percent), meter("GPU", gpu.util, gpu.name || ""),
        meter("VRAM", vram, gpu.mem_total_mb ? `${Math.round(gpu.mem_used_mb)} / ${Math.round(gpu.mem_total_mb)} MB` : ""));
      box.append(kv([[L("TEMPERATURA", "TEMPERATURE", "TEMPERATURA"), Number.isFinite(gpu.temp_c) ? `${Math.round(gpu.temp_c)} °C` : ""],
        [L("POTÊNCIA", "POWER", "POTENCIA"), gpu.power_w !== undefined ? `${Math.round(gpu.power_w)} W` : ""]]));
      body.replaceChildren(box);
    };
    await render();
    timer = window.setInterval(() => render().catch(() => {}), 2500);
  }

  async function apps(body) {
    const data = await phone().json("/m/api/apps");
    const usage = data.usage || {}; // {id: {count, last}}: what was opened through Jarvis comes first
    const all = (data.apps || []).slice().sort((a, b) => (usage[b.id]?.count || 0) - (usage[a.id]?.count || 0) || a.name.localeCompare(b.name));
    const grid = node("div", "m-apps");
    const icons = new Map();
    const show = (filter) => {
      const wanted = filter.toLowerCase();
      grid.replaceChildren(...all.filter((app) => !wanted || app.name.toLowerCase().includes(wanted)).slice(0, 60).map((app) => {
        const tile = node("button", "m-app");
        tile.type = "button";
        const icon = node("i");
        tile.append(icon, node("span", "", app.name));
        tile.addEventListener("click", async () => {
          phone().vibrate(20);
          try {
            const result = await phone().json("/m/api/apps/launch", { method: "POST", body: { id: app.id } });
            phone().toast(result.message || `${app.name} ✓`);
          } catch (error) {
            phone().toast(error.message, true);
          }
        });
        const load = icons.get(app.id) || phone().api(`/m/api/apps/icon?id=${encodeURIComponent(app.id)}`)
          .then((response) => (response.ok ? response.blob() : null)).then((blob) => (blob ? URL.createObjectURL(blob) : ""), () => "");
        icons.set(app.id, load);
        load.then((url) => {
          if (url) icon.style.backgroundImage = `url("${url}")`;
        });
        return tile;
      }));
    };
    const filter = search(L("Buscar app ou jogo…", "Search app or game…", "Buscar app o juego…"), show);
    filter.querySelector("input").addEventListener("input", (event) => show(event.target.value));
    body.replaceChildren(filter, node("p", "m-note", L("Toque para abrir no PC.", "Tap to open on the PC.", "Toque para abrir en el PC.")), grid);
    show("");
  }

  async function system(body) {
    const { system: info } = await phone().json("/m/api/system");
    const box = card(L("// SISTEMA", "// SYSTEM", "// SISTEMA"));
    box.append(kv([["OS", `${info.os || ""} ${info.release || ""}`], [L("MÁQUINA", "MACHINE", "MÁQUINA"), info.machine], ["PYTHON", info.python],
      [L("NÚCLEOS", "CORES", "NÚCLEOS"), info.cpu_count], [L("DISCO LIVRE", "FREE DISK", "DISCO LIBRE"), info.disk_free_gb ? `${info.disk_free_gb} / ${info.disk_total_gb} GB` : ""],
      [L("VERSÃO", "VERSION", "VERSIÓN"), info.version]]));
    const scanBox = card(L("// VARREDURA GERAL", "// FULL SCAN", "// ESCANEO GENERAL"));
    const result = node("div");
    scanBox.append(button(L("INICIAR VARREDURA", "START SCAN", "INICIAR ESCANEO"), async () => {
      result.replaceChildren(node("p", "m-wait", L("VARRENDO…", "SCANNING…", "ESCANEANDO…")));
      try {
        const review = await phone().json("/m/api/scan", { method: "POST", body: {} });
        result.replaceChildren(node("p", "m-score", `${review.score}%`), ...(review.checks || []).map((check) => {
          const row = node("div", `m-check is-${check.status}`);
          row.append(node("b", "", check.title), node("span", "", check.detail || ""));
          return row;
        }));
      } catch (error) {
        result.replaceChildren(node("p", "m-note", error.message));
      }
    }), result);
    body.replaceChildren(box, scanBox);
  }

  function linkList(items, empty) {
    const list = node("div", "m-list");
    if (!items?.length) list.append(node("p", "m-note", empty));
    for (const item of items || []) list.append(link(item.title, item.link || item.url, [item.source, ago(item.published)].filter(Boolean).join(" · ")));
    return list;
  }

  async function explorer(body) {
    const results = node("div");
    const run = async (query) => {
      results.replaceChildren(node("p", "m-wait", L("PESQUISANDO…", "SEARCHING…", "BUSCANDO…")));
      try {
        const { result } = await phone().json(`/m/api/research?q=${encodeURIComponent(query)}&kinds=wiki,news,science`, { timeout: 30000 });
        const parts = [];
        if (result.wiki) {
          const wiki = card(`// WIKIPÉDIA · ${result.wiki.title}`);
          wiki.append(node("p", "m-text", result.wiki.extract), link(L("ABRIR ARTIGO", "OPEN ARTICLE", "ABRIR ARTÍCULO"), result.wiki.url));
          parts.push(wiki);
        }
        const news = card(L("// NOTÍCIAS", "// NEWS", "// NOTICIAS"));
        news.append(linkList(result.news, "--"));
        const science = card(L("// CIÊNCIA", "// SCIENCE", "// CIENCIA"));
        science.append(linkList(result.science, "--"));
        parts.push(news, science);
        results.replaceChildren(...parts);
      } catch (error) {
        results.replaceChildren(node("p", "m-note", error.message));
      }
    };
    body.replaceChildren(search(L("Pesquisar na web…", "Search the web…", "Buscar en la web…"), run), results);
  }

  async function news(body) {
    const data = await phone().json("/m/api/news");
    const list = node("div");
    const chips = node("div", "m-chips");
    const show = (category) => {
      list.replaceChildren(linkList((data.items || []).filter((item) => !category || item.category === category).slice(0, 40), "--"));
      for (const chip of chips.children) chip.classList.toggle("is-active", chip.dataset.key === (category || ""));
    };
    const present = new Set((data.items || []).map((item) => item.category));
    for (const [key, label] of [["", L("TUDO", "ALL", "TODO")], ...Object.entries(data.categories || {}).filter(([key]) => present.has(key))]) {
      const chip = button(label.toUpperCase(), () => show(key), "m-chip");
      chip.dataset.key = key;
      chips.append(chip);
    }
    body.replaceChildren(chips, list);
    show("");
  }

  async function finance(body) {
    const data = await phone().json("/m/api/finance", { timeout: 30000 });
    const rates = data.rates || {};
    const box = card(L("// TAXAS BRASIL", "// BRAZIL RATES", "// TASAS BRASIL"));
    box.append(kv([["SELIC", rates.selic !== undefined ? `${fmt(rates.selic)}%` : ""], ["CDI", rates.cdi !== undefined ? `${fmt(rates.cdi)}%` : ""],
      ["IPCA 12M", rates.ipca12 !== undefined ? `${fmt(rates.ipca12)}%` : ""], [L("POUPANÇA", "SAVINGS", "AHORRO"), rates.poupanca !== undefined ? `${fmt(rates.poupanca)}%` : ""]]));
    const chips = node("div", "m-chips");
    const list = node("div", "m-assets");
    const show = (group) => {
      const assets = (data.assets || []).filter((asset) => asset.ok !== false && asset.group === group);
      list.replaceChildren(...assets.map((asset) => {
        const moved = Number.isFinite(asset.change);
        const row = node("div", `m-asset ${!moved ? "" : asset.change >= 0 ? "is-up" : "is-down"}`);
        const name = node("div");
        name.append(node("b", "", asset.symbol || asset.id), node("span", "", asset.name || ""));
        row.append(name, spark(asset.spark), node("strong", "", fmt(asset.price)), node("em", "", moved ? `${asset.change >= 0 ? "+" : ""}${fmt(asset.change)}%` : "--"));
        return row;
      }));
      for (const chip of chips.children) chip.classList.toggle("is-active", chip.dataset.key === group);
    };
    const present = new Set((data.assets || []).filter((asset) => asset.ok !== false).map((asset) => asset.group));
    // {key: label} in the desktop's order; "lista" (MINHA LISTA) only when it has something.
    for (const [key, label] of Object.entries(data.groups || {}).filter(([key]) => present.has(key))) {
      const chip = button(key === "lista" ? L("MINHA LISTA", "MY LIST", "MI LISTA") : label, () => show(key), "m-chip");
      chip.dataset.key = key;
      chips.append(chip);
    }
    body.replaceChildren(box, chips, list);
    show(chips.firstChild?.dataset.key || "indices");
  }

  async function files(body) {
    const data = await phone().json("/m/api/files");
    const counts = {};
    for (const file of data.files || []) counts[file.ext || "—"] = (counts[file.ext || "—"] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const box = card(`// ${(data.files || []).length} ${L("ARQUIVOS DO PROJETO", "PROJECT FILES", "ARCHIVOS DEL PROYECTO")}`);
    for (const [ext, count] of top) box.append(meter(ext, (100 * count) / (top[0]?.[1] || 1), `${count}`));
    const recent = card(L("// MODIFICADOS POR ÚLTIMO", "// LAST MODIFIED", "// MODIFICADOS ÚLTIMO"));
    recent.append(kv((data.files || []).slice().sort((a, b) => b.modified - a.modified).slice(0, 8).map((file) => [file.name, ago(file.modified)])));
    body.replaceChildren(box, recent);
  }

  async function notes(body) {
    const data = await phone().json("/m/api/notes");
    const form = card(L("// NOVA ANOTAÇÃO", "// NEW NOTE", "// NUEVA NOTA"));
    const title = node("input", "m-input");
    title.placeholder = L("Título", "Title", "Título");
    const text = node("textarea", "m-input");
    text.rows = 4;
    text.placeholder = L("Escreva aqui…", "Write here…", "Escriba aquí…");
    form.append(title, text, button(L("SALVAR NO PC", "SAVE ON THE PC", "GUARDAR EN EL PC"), async () => {
      try {
        await phone().json("/m/api/notes", { method: "POST", body: { title: title.value, body: text.value } });
        phone().toast("✓");
        open("notes");
      } catch (error) {
        phone().toast(error.message, true);
      }
    }));
    const list = card(`// ${(data.notes || []).length} ${L("ITENS", "ITEMS", "ELEMENTOS")}`);
    const recent = (data.notes || []).slice().sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)).slice(0, 40);
    for (const item of recent) {
      if (!["note", "text"].includes(item.kind)) { // photos, PDFs...: listed; opened on the PC
        const row = node("div", "m-row is-file");
        row.append(node("span", "", item.name), node("em", "", ago(item.updated_at)));
        list.append(row);
        continue;
      }
      const row = button(item.title || item.name, async () => {
        try {
          const note = await phone().json(`/m/api/notes/read?id=${encodeURIComponent(item.id)}`);
          const view = card(`// ${item.title || item.name}`);
          view.append(node("pre", "m-text", note.body || ""), button(L("‹ VOLTAR", "‹ BACK", "‹ VOLVER"), () => open("notes")));
          body.replaceChildren(view);
        } catch (error) {
          phone().toast(error.message, true);
        }
      }, "m-row");
      list.append(row);
    }
    body.replaceChildren(form, list);
  }

  async function security(body) {
    const data = await phone().json("/m/api/avast");
    const box = card(`// ${data.product || "AVAST"}`);
    box.append(node("p", `m-status is-${data.state}`, data.headline || data.state || "--"),
      meter(L("ESCUDOS", "SHIELDS", "ESCUDOS"), data.shields_total ? (100 * data.shields_on) / data.shields_total : 0, `${data.shields_on || 0}/${data.shields_total || 0}`));
    const features = card(L("// PROTEÇÕES", "// PROTECTIONS", "// PROTECCIONES"));
    for (const feature of (data.features || []).slice(0, 16)) {
      const row = node("div", `m-check is-${feature.state === "on" ? "ok" : "warn"}`);
      row.append(node("b", "", feature.title), node("span", "", feature.detail || ""));
      features.append(row);
    }
    body.replaceChildren(box, features);
  }

  async function askCard(body, text, label, question) {
    const box = card();
    box.append(node("p", "m-text", text), button(label, () => {
      phone().ask(question); // answered where the user is (mobile.js dock)
    }));
    body.replaceChildren(box);
  }

  async function tests(body) {
    await askCard(body, L("Roda a suíte de testes do projeto no PC; o resultado chega na conversa. Se algo falhar, ele lê a saída dos testes e corrige o código sozinho.",
      "Runs the project's test suite on the PC; the result comes in the conversation. If something fails, it reads the test output and fixes the code itself.",
      "Ejecuta las pruebas del proyecto en el PC; el resultado llega a la conversación. Si algo falla, lee la salida de las pruebas y corrige el código solo."),
      L("RODAR OS TESTES", "RUN THE TESTS", "EJECUTAR PRUEBAS"), "rode os testes");
  }

  async function status(body) {
    const data = await phone().json("/m/api/status");
    const box = card(L("// PROJETO", "// PROJECT", "// PROYECTO"));
    box.append(kv(Object.entries(data.counts || {}).map(([key, value]) => [key.toUpperCase(), value])),
      kv([[L("VERSÃO", "VERSION", "VERSIÓN"), data.version], ["SHELL", data.shell]]),
      button(L("PERGUNTAR AO JARVIS", "ASK JARVIS", "PREGUNTAR A JARVIS"), () => {
        phone().ask("status do projeto");
      }));
    body.replaceChildren(box);
  }

  /* MAPA is the PC's own globe and dossier: the desktop's globe.js and map-intel.js run on #m-map (the same
     elements), which stays in the page, so the globe keeps its place between visits. They are told the map
     is on screen as the desktop tells them (body[data-view], "jarvis:view"), and get from here what the
     desktop page gives them: the geographic data (in this app's own files), the dossier's sources through
     the phone link, links opened on the phone and a light vibration for the HUD's sounds. */
  const MAP_SOUNDS = { click: () => phone()?.vibrate(5), select: () => phone()?.vibrate(14), zoom() {}, data() {}, open() {}, close() {} };

  /** The map's data: the app's own files (Android, GitHub Pages) at once; from the PC's own page in slices, each
      retried on its own URL, since security software there now and then holds a long answer (~2 MB here). */
  async function geoJSON(path, timeout = 20000, retries = 3) {
    if (phone()?.servedByPc) return JSON.parse(new TextDecoder().decode(await phone().sliced(`/${path}`)));
    let last = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const clock = window.setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(path, { signal: controller.signal });
        if (!response.ok) throw new Error(`mapa ${response.status}`);
        return await response.json();
      } catch (error) {
        last = error;
        await new Promise((resolve) => window.setTimeout(resolve, 400 * (attempt + 1)));
      } finally {
        window.clearTimeout(clock);
      }
    }
    throw last;
  }

  window.jarvisHUD = window.jarvisHUD || { getJSON: geoJSON, sound: MAP_SOUNDS };
  window.jarvisUI = window.jarvisUI || { toast: (text, error) => phone()?.toast(text, error) };
  window.jarvisFetch = (url, options = {}) => phone().api(String(url).replace(/^\/api\//, "/m/api/"), { method: options.method || "GET",
    body: options.body, raw: true, headers: options.headers, signal: options.signal, timeout: 60000 });
  window.jarvisOpenLink = (url) => {
    const anchor = node("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
  };

  function showMap(on) {
    const box = $("#m-map");
    if (!box) return;
    box.hidden = !on;
    $("#module-body").hidden = on;
    const view = on ? "map" : "panel";
    if (document.body.dataset.view === view) return;
    document.body.dataset.view = view;
    document.dispatchEvent(new CustomEvent("jarvis:view", { detail: { view } })); // the globe starts or stops drawing
  }

  async function map(body) {
    body.replaceChildren();
    showMap(true);
  }

  async function tutorial(body) {
    const data = await phone().json("/m/api/tutorial");
    const box = card(L("// CONFIGURAÇÃO", "// SETUP", "// CONFIGURACIÓN"));
    for (const item of data.items || []) {
      const row = node("div", `m-check is-${item.ok ? "ok" : "warn"}`);
      row.append(node("b", "", item.label), node("span", "", item.detail || ""));
      box.append(row);
    }
    const tries = card(L("// EXPERIMENTE", "// TRY", "// PRUEBE"));
    const chips = node("div", "m-chips");
    const commands = L(["que horas são?", "abre o mapa global", "estados unidos", "como está o Ibovespa?", "vai chover amanhã?", "toca uma música do Queen"],
      ["what time is it?", "open the world map", "united states", "how is the Ibovespa?", "will it rain tomorrow?", "play a Queen song"],
      ["¿qué hora es?", "abre el mapa global", "estados unidos", "¿cómo está el Ibovespa?", "¿va a llover mañana?", "pon una canción de Queen"]);
    for (const command of commands) {
      chips.append(button(command, () => {
        phone().ask(command);
      }, "m-chip"));
    }
    tries.append(chips);
    body.replaceChildren(box, tries);
  }

  async function custom(body) {
    const data = await phone().json("/m/api/customization");
    const save = async (patch) => {
      try {
        const saved = await phone().json("/m/api/customization", { method: "POST", body: { tema: { ...data.tema, ...patch } } });
        data.tema = saved.tema;
        const renamed = saved.nome && saved.nome !== data.nome; // another model: it answers to its name now
        data.nome = saved.nome || data.nome;
        phone().toast(renamed ? L(`Aplicado. Agora diga “${data.nome}”.`, `Applied. Now say “${data.nome}”.`, `Aplicado. Ahora di “${data.nome}”.`)
          : L("Aplicado no PC.", "Applied on the PC.", "Aplicado en el PC."));
        render();
      } catch (error) {
        phone().toast(error.message, true);
      }
    };
    const render = () => {
      const models = card(L("// MODELO 3D (DIÁLOGO, SEGUNDO PLANO E AQUI)", "// 3D MODEL (DIALOGUE, BACKGROUND AND HERE)", "// MODELO 3D (DIÁLOGO, SEGUNDO PLANO Y AQUÍ)"));
      const grid = node("div", "m-chips");
      const chosen = data.tema?.model?.id || "";
      for (const [id, name] of [["", L("DO TEMA", "FROM THEME", "DEL TEMA")], ...Object.entries(MODEL_NAMES)]) {
        const chip = button(name, () => save({ model: { ...(data.tema?.model || {}), id } }), `m-chip${chosen === id ? " is-active" : ""}`);
        grid.append(chip);
      }
      const showing = chosen || (MODEL_NAMES[data.tema?.preset] ? data.tema.preset : "jarvis");
      models.append(grid, node("p", "m-note", `${L("NO PC AGORA", "ON THE PC NOW", "EN EL PC AHORA")}: ${MODEL_NAMES[showing] || showing.toUpperCase()}`));
      const themes = card(L("// TEMA", "// THEME", "// TEMA"));
      const presets = node("div", "m-presets");
      for (const [id, look] of Object.entries(PRESETS)) {
        const tile = button(MODEL_NAMES[id], () => save({ ...look, preset: id }), `m-preset${data.tema?.preset === id ? " is-active" : ""}`);
        tile.style.setProperty("--a", look.accent);
        tile.style.setProperty("--b", look.accent2);
        presets.append(tile);
      }
      themes.append(presets);
      body.replaceChildren(models, themes);
    };
    render();
  }

  const MODULES = [
    { id: "technical", short: ["TÉCNICO", "TECH", "TÉCNICO"], title: ["TÉCNICO", "TECHNICAL", "TÉCNICO"], pc: "technical", render: technical },
    { id: "apps", short: ["APPS", "APPS", "APPS"], title: ["APLICATIVOS", "APPS", "APLICACIONES"], pc: "apps", render: apps },
    { id: "system", short: ["SISTEMA", "SYSTEM", "SISTEMA"], title: ["SISTEMA OPERACIONAL", "OPERATING SYSTEM", "SISTEMA OPERATIVO"], pc: "system", render: system },
    { id: "explorer", short: ["EXPLORER", "EXPLORER", "EXPLORER"], title: ["EXPLORER", "EXPLORER", "EXPLORADOR"], pc: "explorer", render: explorer },
    { id: "news", short: ["NOTÍCIAS", "NEWS", "NOTICIAS"], title: ["ÚLTIMAS NOTÍCIAS", "LATEST NEWS", "ÚLTIMAS NOTICIAS"], pc: "news", render: news },
    { id: "finance", short: ["MERCADO", "MARKET", "MERCADO"], title: ["MERCADO DE INVESTIMENTO", "INVESTMENT MARKET", "MERCADO DE INVERSIÓN"], pc: "finance", render: finance },
    { id: "files", short: ["ARQUIVOS", "FILES", "ARCHIVOS"], title: ["ARQUIVOS", "FILES", "ARCHIVOS"], pc: "files", render: files },
    { id: "notes", short: ["NOTAS", "NOTES", "NOTAS"], title: ["ANOTAÇÕES", "NOTES", "NOTAS"], pc: "notes", render: notes },
    { id: "security", short: ["SEGURANÇA", "SECURITY", "SEGURIDAD"], title: ["SEGURANÇA", "SECURITY", "SEGURIDAD"], pc: "security", render: security },
    { id: "tests", short: ["TESTES", "TESTS", "PRUEBAS"], title: ["TESTES", "TESTS", "PRUEBAS"], pc: "", render: tests },
    { id: "status", short: ["STATUS", "STATUS", "ESTADO"], title: ["STATUS", "STATUS", "ESTADO"], pc: "", render: status },
    { id: "map", short: ["MAPA", "MAP", "MAPA"], title: ["MAPA GLOBAL", "WORLD MAP", "MAPA GLOBAL"], pc: "map", render: map },
    { id: "dialogue", short: ["DIÁLOGO", "DIALOGUE", "DIÁLOGO"], title: ["DIÁLOGO", "DIALOGUE", "DIÁLOGO"], pc: "dialogue", go: "talk" },
    { id: "tutorial", short: ["TUTORIAL", "TUTORIAL", "TUTORIAL"], title: ["TUTORIAL", "TUTORIAL", "TUTORIAL"], pc: "tutorial", render: tutorial },
    { id: "custom", short: ["CUSTOM", "CUSTOM", "CUSTOM"], title: ["CUSTOMIZAÇÃO", "CUSTOMIZATION", "PERSONALIZACIÓN"], pc: "custom", render: custom },
    { id: "phone", short: ["CELULAR", "PHONE", "MÓVIL"], title: ["CELULAR", "PHONE", "MÓVIL"], pc: "phone", go: "settings" },
  ];

  /* ---------- the ring ---------- */

  function polar(radius, degrees) {
    const angle = (degrees * Math.PI) / 180;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  }

  function element(tag, attrs, parent) {
    const item = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) item.setAttribute(key, value);
    parent?.append(item);
    return item;
  }

  function buildRing() {
    const ring = $("#ring");
    if (!ring) return;
    ring.replaceChildren();
    const column = { "en-US": 1, "es-ES": 2 }[phone()?.lang] || 0;
    const step = 360 / MODULES.length;
    element("circle", { r: 196, class: "r-line" }, ring);
    element("circle", { r: 112, class: "r-line is-dash" }, ring);
    const spinner = element("g", { class: "r-spin" }, ring);
    for (let k = 0; k < 60; k += 1) {
      const [x0, y0] = polar(100, k * 6);
      const [x1, y1] = polar(k % 5 ? 104 : 108, k * 6);
      element("line", { x1: x0, y1: y0, x2: x1, y2: y1, class: "r-tick" }, spinner);
    }
    MODULES.forEach((module, index) => {
      const center = -90 + step * (index + 0.5);
      const a0 = center - step / 2 + 1.1;
      const a1 = center + step / 2 - 1.1;
      const [ox0, oy0] = polar(190, a0);
      const [ox1, oy1] = polar(190, a1);
      const [ix1, iy1] = polar(120, a1);
      const [ix0, iy0] = polar(120, a0);
      const group = element("g", { class: "r-wedge", role: "button", tabindex: "0" }, ring);
      group.style.setProperty("--i", index);
      element("path", { d: `M${ox0},${oy0} A190,190 0 0 1 ${ox1},${oy1} L${ix1},${iy1} A120,120 0 0 0 ${ix0},${iy0} Z` }, group);
      const lower = Math.sin((center * Math.PI) / 180) > 0.01;
      const [tx0, ty0] = polar(155, lower ? a1 : a0);
      const [tx1, ty1] = polar(155, lower ? a0 : a1);
      const id = `r-path-${index}`;
      element("path", { id, d: `M${tx0},${ty0} A155,155 0 0 ${lower ? 0 : 1} ${tx1},${ty1}`, class: "r-guide" }, group);
      const text = element("text", { class: "r-label", "dominant-baseline": "middle" }, group);
      const along = element("textPath", { href: `#${id}`, startOffset: "50%", "text-anchor": "middle" }, text);
      along.textContent = module.short[column];
      const room = (155 * (step - 3) * Math.PI) / 180; // the wedge's arc, less a margin
      if (along.textContent.length * 6.3 > room) { // a long word (SEGURANÇA) is narrowed to fit, not cut
        text.setAttribute("textLength", room.toFixed(1));
        text.setAttribute("lengthAdjust", "spacingAndGlyphs");
      }
      group.addEventListener("click", () => open(module.id));
    });
    const core = element("g", { class: "r-core" }, ring);
    element("circle", { r: 84, class: "r-disc" }, core);
    const time = element("text", { y: -8, class: "r-time" }, core);
    const date = element("text", { y: 16, class: "r-date" }, core);
    const online = element("text", { y: 36, class: "r-online" }, core);
    online.textContent = { 1: "SYSTEMS ONLINE", 2: "SISTEMAS EN LÍNEA" }[column] || "SISTEMAS ONLINE";
    const tick = () => {
      const now = new Date();
      time.textContent = now.toLocaleTimeString(phone()?.lang || "pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false });
      date.textContent = now.toLocaleDateString(phone()?.lang || "pt-BR", { weekday: "short", day: "2-digit", month: "short" }).toUpperCase();
    };
    tick();
    window.clearInterval(clock);
    clock = window.setInterval(tick, 15000);
  }

  /* ---------- opening a module ---------- */

  async function open(id) {
    const module = MODULES.find((item) => item.id === id);
    if (!module) return;
    window.clearInterval(timer);
    if (module.go) {
      phone().showPane(module.go);
      return;
    }
    current = module;
    const column = { "en-US": 1, "es-ES": 2 }[phone().lang] || 0;
    showMap(false);
    $("#panel-home").hidden = true;
    $("#module").hidden = false;
    $("#module-title").textContent = module.title[column];
    $("#module-pc").hidden = !module.pc;
    const body = $("#module-body");
    body.replaceChildren(node("p", "m-wait", L("CARREGANDO…", "LOADING…", "CARGANDO…")));
    phone().vibrate(10);
    try {
      await module.render(body);
    } catch (error) {
      body.replaceChildren(node("p", "m-note", error.message));
    }
  }

  function close() {
    window.clearInterval(timer);
    current = null;
    showMap(false);
    $("#module").hidden = true;
    $("#panel-home").hidden = false;
  }

  /** "NO PC": the same module on the PC's screen; the map with the place in focus here. */
  function onPc() {
    if (!current?.pc) return;
    const focus = current.id === "map" ? window.jarvisGlobe?.focus?.() : null;
    if (focus?.name) phone().onPc("map", "map-focus", focus.name);
    else phone().onPc(current.pc);
  }

  /** A voice command for the map ("foca no Japão", "aproxima"): the map here follows it while it is on
      screen, and opens for it when the request was made from this phone. */
  function mapAction({ view, command, arg, mine }) {
    if (view !== "map" && !String(command || "").startsWith("map-")) return;
    const showing = current?.id === "map" && $("#pane-panel").classList.contains("is-active");
    if (!showing && !mine) return; // asked on the PC: the phone stays where it is
    if (!showing) {
      current = null; // the pane change must not reopen the module that was there
      phone().showPane("panel");
      open("map");
    }
    if (command) {
      window.setTimeout(() => document.dispatchEvent(new CustomEvent("jarvis:command", { detail: { command, query: arg, target: arg } })),
        showing ? 0 : 160);
    }
  }

  function init() {
    if (!$("#ring")) return;
    $("#module-back").addEventListener("click", close);
    $("#module-pc").addEventListener("click", onPc);
    document.addEventListener("jarvis:phone-back", close);
    document.addEventListener("jarvis:phone-lang", () => {
      buildRing();
      if (current) open(current.id);
    });
    document.addEventListener("jarvis:phone-pane", (event) => {
      if (event.detail.pane !== "panel") {
        window.clearInterval(timer);
        showMap(false); // the globe stops drawing while another tab is open
      } else if (current) {
        open(current.id);
      }
    });
    document.addEventListener("jarvis:phone-action", (event) => mapAction(event.detail || {}));
    buildRing();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
