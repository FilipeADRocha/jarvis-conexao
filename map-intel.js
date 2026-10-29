/* "Mapa global" dossier: when a country, state or city comes into focus (a click or "Jarvis, foca
   em ..."), six holographic cards open around the globe, each wired to the place by a leader line
   that follows it as the globe moves: overview, latest news, controversies, weather and local time,
   tourism (attractions pinned on the globe) and politics/economy/culture.
   Live data: /api/place/live (Google Notícias, Open-Meteo); encyclopedia: /api/place (Wikidata,
   Wikipédia), slower and cached for a week. */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const globe = () => window.jarvisGlobe;
  const hud = () => window.jarvisHUD;
  const ui = () => window.jarvisUI;
  const calm = () => document.documentElement.classList.contains("reduce-motion");
  const SVG = "http://www.w3.org/2000/svg";
  const KIND = { city: "CIDADE", state: "ESTADO / PROVÍNCIA", country: "PAÍS" };
  // Card slots: side, row; and where its line lands around the place (angle in degrees, 0 = right).
  const CARDS = [
    { key: "overview", code: "01", title: "VISÃO GERAL", side: "left", row: 0, angle: 215 },
    { key: "news", code: "02", title: "ÚLTIMAS NOTÍCIAS", side: "left", row: 1, angle: 180 },
    { key: "controversies", code: "03", title: "POLÊMICAS & ALERTAS", side: "left", row: 2, angle: 145 },
    { key: "weather", code: "04", title: "CLIMA · HORA LOCAL", side: "right", row: 0, angle: -35 },
    { key: "tourism", code: "05", title: "TURISMO", side: "right", row: 1, angle: 0 },
    { key: "power", code: "06", title: "POLÍTICA · ECONOMIA · CULTURA", side: "right", row: 2, angle: 35 },
  ];
  const state = {
    open: true,
    focus: null,
    token: 0,
    live: null,
    dossier: null,
    shownAt: 0,
    frame: 0,
    hoverPin: null,
    tab: "politica",
  };
  const el = {};

  try {
    state.open = window.localStorage.getItem("jarvis.mapIntel") !== "off";
  } catch (_) {
    /* Storage unavailable: the dossier stays on. */
  }

  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined && text !== null) item.textContent = text;
    return item;
  }

  function svg(tag, attrs = {}) {
    const item = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) item.setAttribute(key, value);
    return item;
  }

  const ago = (seconds) => {
    if (!seconds) return "";
    const minutes = Math.max(1, Math.round((Date.now() / 1000 - seconds) / 60));
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `há ${hours} h`;
    return `há ${Math.round(hours / 24)} d`;
  };
  const degrees = (value) => (value === null || value === undefined ? "--" : `${Math.round(value)}°`);

  /* ---------- skeleton ---------- */

  function build() {
    const stage = $(".gl-stage");
    if (!stage || el.layer) return;
    el.stage = stage;
    el.layer = node("div", "mi-layer");
    el.layer.setAttribute("aria-live", "polite");
    el.links = svg("svg", { class: "mi-links", "aria-hidden": "true" });
    el.defs = svg("defs");
    const glow = svg("filter", { id: "mi-glow", x: "-50%", y: "-50%", width: "200%", height: "200%" });
    glow.append(svg("feGaussianBlur", { stdDeviation: "2.2", result: "b" }));
    const merge = svg("feMerge");
    merge.append(svg("feMergeNode", { in: "b" }), svg("feMergeNode", { in: "SourceGraphic" }));
    glow.append(merge);
    el.defs.append(glow);
    el.links.append(el.defs);
    el.wires = svg("g", { class: "mi-wires" });
    el.pins = svg("g", { class: "mi-pins" });
    el.core = svg("g", { class: "mi-core" });
    el.core.append(svg("circle", { r: "22", class: "mi-core-ring" }), svg("circle", { r: "34", class: "mi-core-ring is-outer" }),
      svg("circle", { r: "4", class: "mi-core-dot" }));
    el.links.append(el.wires, el.pins, el.core);
    el.layer.append(el.links);

    el.ribbon = node("header", "mi-ribbon");
    el.ribbonKind = node("span", "mi-ribbon-kind", "DOSSIÊ");
    el.ribbonName = node("strong", "mi-ribbon-name", "");
    el.ribbonMeta = node("em", "mi-ribbon-meta", "");
    el.ribbonClock = node("b", "mi-ribbon-clock", "");
    const close = node("button", "mi-ribbon-close", "×");
    close.type = "button";
    close.title = "Fechar o dossiê (o botão INTEL reabre)";
    close.addEventListener("click", () => setOpen(false));
    el.ribbon.append(el.ribbonKind, el.ribbonName, el.ribbonMeta, el.ribbonClock, close);
    el.layer.append(el.ribbon);

    el.cards = {};
    for (const card of CARDS) {
      const box = node("section", `mi-card is-${card.side}`);
      box.dataset.key = card.key;
      box.style.setProperty("--row", card.row);
      box.style.setProperty("--delay", `${(card.side === "left" ? 0 : 3) * 90 + card.row * 90}ms`);
      const head = node("h4", "mi-card-head");
      head.append(node("i", "mi-code", card.code), node("span", "", card.title), node("em", "mi-card-state", "SINAL"));
      const body = node("div", "mi-card-body");
      box.append(node("i", "mi-corner is-a"), node("i", "mi-corner is-b"), head, body, node("i", "mi-scan"));
      el.layer.append(box);
      el.cards[card.key] = { box, body, state: head.lastChild, card };
    }
    stage.append(el.layer);

    el.toggle = node("button", "mi-toggle", "INTEL");
    el.toggle.type = "button";
    el.toggle.title = "Dossiê do lugar em foco: notícias, turismo, polêmicas, clima";
    el.toggle.addEventListener("click", () => setOpen(!state.open));
    $(".gl-controls")?.prepend(el.toggle);
    syncToggle();
  }

  function syncToggle() {
    el.toggle?.setAttribute("aria-pressed", String(state.open));
    el.layer?.classList.toggle("is-hidden", !state.open || !state.focus);
  }

  function setOpen(open) {
    state.open = open;
    try {
      window.localStorage.setItem("jarvis.mapIntel", open ? "on" : "off");
    } catch (_) {
      /* Not remembered; it still works. */
    }
    syncToggle();
    hud()?.sound?.[open ? "open" : "close"]?.();
    if (open && state.focus) loop();
  }

  /* ---------- loading ---------- */

  function cardState(key, text, mood = "") {
    const card = el.cards[key];
    card.state.textContent = text;
    card.box.dataset.mood = mood;
  }

  function placeholder(key, text = "ADQUIRINDO SINAL…") {
    const card = el.cards[key];
    card.box.classList.add("is-loading");
    card.body.replaceChildren(node("div", "mi-wait", text), node("div", "mi-bars"));
    cardState(key, "BUSCANDO", "wait");
  }

  async function getJSON(url, timeout = 15000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try { // the phone app (window.jarvisFetch) asks the PC through its link
      const response = await (window.jarvisFetch || fetch)(url, { cache: "no-store", signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        const error = new Error(data.error || `falha ${response.status}`);
        error.retry = Boolean(data.retry);
        throw error;
      }
      return data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function query(focus, extra = {}) {
    const params = new URLSearchParams({ name: focus.name, kind: focus.kind, country: focus.country || "", country_name: focus.countryName || "",
      lat: String(focus.lat), lon: String(focus.lon), pop: String(focus.pop || 0), ...extra });
    if (focus.box) params.set("box", focus.box.map((value) => value.toFixed(3)).join(","));
    return params.toString();
  }

  async function load(focus) {
    const token = ++state.token;
    state.focus = focus;
    state.live = null;
    state.dossier = null;
    state.shownAt = performance.now();
    el.pins.replaceChildren();
    el.layer.classList.remove("is-leaving");
    el.layer.classList.remove("is-in");
    void el.layer.offsetWidth; // restart the entrance animation
    el.layer.classList.add("is-in");
    el.ribbonKind.textContent = `DOSSIÊ · ${KIND[focus.kind] || "LOCAL"}`;
    el.ribbonName.textContent = focus.name.toUpperCase();
    el.ribbonMeta.textContent = [focus.region, focus.kind !== "country" ? focus.countryName : ""].filter(Boolean).join(" · ").toUpperCase();
    el.ribbonClock.textContent = "";
    for (const card of CARDS) placeholder(card.key);
    syncToggle();
    hud()?.sound?.data?.();
    loop();

    const live = getJSON(`/api/place/live?${query(focus)}`).then((data) => {
      if (token !== state.token) return;
      state.live = data;
      renderNews();
      renderControversies();
      renderWeather();
    }).catch((error) => {
      if (token !== state.token) return;
      for (const key of ["news", "controversies", "weather"]) failed(key, error.message);
    });

    const dossier = async (attempt = 0) => {
      try {
        const data = await getJSON(`/api/place?${query(focus)}`, 40000);
        if (token !== state.token) return;
        state.dossier = data;
        renderOverview();
        renderTourism();
        renderPower();
      } catch (error) {
        if (token !== state.token) return;
        if (error.retry && attempt < 2) {
          for (const key of ["overview", "tourism", "power"]) placeholder(key, "FONTE OCUPADA · NOVA TENTATIVA…");
          window.setTimeout(() => dossier(attempt + 1), 4000 + attempt * 3000);
          return;
        }
        for (const key of ["overview", "tourism", "power"]) failed(key, error.message);
      }
    };
    await Promise.all([live, dossier()]);
  }

  function failed(key, message) {
    const card = el.cards[key];
    card.box.classList.remove("is-loading");
    card.body.replaceChildren(node("p", "mi-empty", `Sem sinal: ${message || "fonte indisponível"}.`));
    cardState(key, "OFFLINE", "error");
  }

  function ready(key, label = "AO VIVO") {
    const card = el.cards[key];
    card.box.classList.remove("is-loading");
    card.box.classList.remove("is-fresh");
    void card.box.offsetWidth;
    card.box.classList.add("is-fresh");
    cardState(key, label, "ok");
    hud()?.sound?.data?.();
  }

  /* ---------- cards ---------- */

  function openLink(url) {
    if (!url) return;
    if (window.jarvisOpenLink) { // the phone app: in the phone's browser, not on the PC
      window.jarvisOpenLink(url);
      return;
    }
    fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "open_link", url }) })
      .then((response) => response.json())
      .then((data) => ui()?.toast(data.message || data.error || "Abrindo.", !data.ok))
      .catch(() => ui()?.toast("Não consegui abrir o link.", true));
  }

  function headlines(items, warn) {
    const list = node("ol", `mi-list${warn ? " is-warn" : ""}`);
    items.slice(0, warn ? 5 : 6).forEach((item, index) => {
      const row = node("li");
      row.style.setProperty("--i", index);
      const button = node("button");
      button.type = "button";
      button.title = "Abrir no navegador";
      button.append(node("span", "mi-list-title", item.title), node("em", "", [item.source, ago(item.published)].filter(Boolean).join(" · ")));
      button.addEventListener("click", () => openLink(item.url));
      row.append(button);
      list.append(row);
    });
    return list;
  }

  function renderNews() {
    const items = state.live?.news || [];
    const card = el.cards.news;
    if (!items.length) {
      failed("news", state.live?.errors?.news || "nenhuma notícia recente");
      return;
    }
    card.body.replaceChildren(headlines(items, false));
    ready("news", `${items.length} MANCHETES`);
  }

  function renderControversies() {
    const items = state.live?.controversies || [];
    const card = el.cards.controversies;
    if (!items.length) {
      card.box.classList.remove("is-loading");
      card.body.replaceChildren(node("p", "mi-empty is-calm", "Nenhuma polêmica nas manchetes dos últimos 60 dias."));
      cardState("controversies", "ESTÁVEL", "ok");
      return;
    }
    card.body.replaceChildren(headlines(items, true));
    ready("controversies", `${items.length} ALERTAS`);
    card.box.dataset.mood = "warn";
  }

  function localTime() {
    const weather = state.live?.weather;
    if (!weather) return "";
    const now = new Date(Date.now() + (weather.utc_offset || 0) * 1000);
    return `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}:${String(now.getUTCSeconds()).padStart(2, "0")}`;
  }

  function renderWeather() {
    const weather = state.live?.weather;
    const card = el.cards.weather;
    if (!weather) {
      failed("weather", state.live?.errors?.weather || "sem previsão");
      return;
    }
    const big = node("div", "mi-weather");
    const temp = node("strong", "mi-temp", degrees(weather.temp));
    const sky = node("div", "mi-sky");
    sky.append(node("span", "", (weather.sky || "--").toUpperCase()), node("em", "", `SENSAÇÃO ${degrees(weather.feels)} · ${weather.day ? "DIA" : "NOITE"}`));
    big.append(node("i", `mi-sky-icon is-${skyIcon(weather.code, weather.day)}`), temp, sky);
    const clock = node("div", "mi-clock");
    clock.append(node("span", "", "HORA LOCAL"), node("b", "mi-clock-time", localTime()), node("em", "", weather.timezone || ""));
    const grid = node("dl", "mi-stats");
    for (const [term, value] of [["MÍN / MÁX", `${degrees(weather.min)} / ${degrees(weather.max)}`], ["CHUVA", weather.rain === null ? "--" : `${weather.rain}%`],
      ["UMIDADE", weather.humidity === null ? "--" : `${weather.humidity}%`], ["VENTO", weather.wind === null ? "--" : `${Math.round(weather.wind)} km/h`],
      ["NASCER", weather.sunrise || "--"], ["PÔR", weather.sunset || "--"]]) {
      const item = node("div");
      item.append(node("dt", "", term), node("dd", "", value));
      grid.append(item);
    }
    card.body.replaceChildren(big, clock, grid);
    ready("weather", "OPEN-METEO");
  }

  function skyIcon(code, day) {
    if (code === null || code === undefined) return "cloud";
    if (code >= 95) return "storm";
    if (code >= 71 && code <= 86 && code !== 80 && code !== 81 && code !== 82) return "snow";
    if (code >= 51) return "rain";
    if (code >= 45) return "fog";
    if (code >= 2) return "cloud";
    return day ? "sun" : "moon";
  }

  function renderOverview() {
    const data = state.dossier;
    const card = el.cards.overview;
    const parts = [];
    if (data.image) {
      const frame = node("figure", "mi-photo");
      const image = node("img");
      image.alt = data.name;
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.src = data.image;
      image.addEventListener("error", () => frame.remove());
      frame.append(image, node("i", "mi-photo-scan"));
      parts.push(frame);
    }
    if (data.description) parts.push(node("p", "mi-desc", data.description.toUpperCase()));
    parts.push(node("p", "mi-summary", data.summary || "Sem resumo na Wikipédia."));
    const facts = node("dl", "mi-facts");
    for (const [term, value] of (data.facts?.geral || []).slice(0, 4)) {
      const item = node("div");
      item.append(node("dt", "", term), node("dd", "", value));
      facts.append(item);
    }
    if (facts.childElementCount) parts.push(facts);
    if (data.wikipedia) {
      const more = node("button", "mi-more", "WIKIPÉDIA ›");
      more.type = "button";
      more.addEventListener("click", () => openLink(data.wikipedia));
      parts.push(more);
    }
    card.body.replaceChildren(...parts);
    ready("overview", (data.sources || []).join(" · ").toUpperCase() || "WIKI");
  }

  function renderTourism() {
    const data = state.dossier;
    const card = el.cards.tourism;
    const attractions = data.attractions || [];
    const text = data.sections?.turismo;
    if (!attractions.length && !text) {
      failed("tourism", "nenhum ponto turístico catalogado por perto");
      return;
    }
    const grid = node("div", "mi-sights");
    attractions.slice(0, 6).forEach((item, index) => {
      const tile = node("button", "mi-sight");
      tile.type = "button";
      tile.style.setProperty("--i", index);
      tile.title = item.description || item.name;
      if (item.image) {
        const image = node("img");
        image.alt = "";
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        image.src = item.image;
        image.addEventListener("error", () => image.remove());
        tile.append(image);
      }
      tile.append(node("span", "", item.name));
      if (item.unesco) tile.append(node("b", "mi-unesco", "UNESCO"));
      tile.addEventListener("mouseenter", () => highlightPin(item.id));
      tile.addEventListener("mouseleave", () => highlightPin(null));
      tile.addEventListener("click", () => {
        globe()?.flyTo(item.lon, item.lat, Math.max(globe()?.zoom || 1, 40));
        hud()?.sound?.select?.();
      });
      grid.append(tile);
    });
    const parts = [grid];
    if (text && attractions.length < 3) parts.push(node("p", "mi-summary", text));
    card.body.replaceChildren(...parts);
    ready("tourism", `${attractions.length} PONTOS`);
    drawPins(attractions.slice(0, 8));
  }

  function renderPower() {
    const data = state.dossier;
    const card = el.cards.power;
    const tabs = node("div", "mi-tabs");
    const content = node("div", "mi-tab-body");
    const names = { politica: "POLÍTICA", economia: "ECONOMIA", cultura: "CULTURA" };
    const show = (key) => {
      state.tab = key;
      for (const button of tabs.children) button.classList.toggle("is-active", button.dataset.tab === key);
      const facts = node("dl", "mi-facts");
      for (const [term, value] of data.facts?.[key] || []) {
        const item = node("div");
        item.append(node("dt", "", term), node("dd", "", value));
        facts.append(item);
      }
      const parts = facts.childElementCount ? [facts] : [];
      if (data.sections?.[key]) parts.push(node("p", "mi-summary", data.sections[key]));
      if (!parts.length) parts.push(node("p", "mi-empty", "Sem dados nesta categoria."));
      content.replaceChildren(...parts);
    };
    for (const key of Object.keys(names)) {
      const button = node("button", "", names[key]);
      button.type = "button";
      button.dataset.tab = key;
      button.addEventListener("click", () => {
        show(key);
        hud()?.sound?.click?.();
      });
      tabs.append(button);
    }
    card.body.replaceChildren(tabs, content);
    show(state.tab in names ? state.tab : "politica");
    ready("power", "WIKIDATA");
  }

  /* ---------- pins and wires ---------- */

  function drawPins(attractions) {
    el.pins.replaceChildren();
    for (const item of attractions) {
      const group = svg("g", { class: "mi-pin" });
      group.dataset.id = item.id;
      group.append(svg("path", { d: "M0 -6 L6 0 L0 6 L-6 0 Z", class: "mi-pin-mark" }), svg("circle", { r: "11", class: "mi-pin-ring" }));
      const label = svg("text", { x: "10", y: "4", class: "mi-pin-label" });
      label.textContent = item.name.length > 26 ? `${item.name.slice(0, 25)}…` : item.name;
      group.append(label);
      group.__point = [item.lon, item.lat];
      el.pins.append(group);
    }
  }

  function highlightPin(id) {
    state.hoverPin = id;
    for (const pin of el.pins.children) pin.classList.toggle("is-hot", pin.dataset.id === id);
  }

  function wirePath(from, to, side) {
    const elbow = side === "left" ? Math.min(from.x + 46, to.x - 10) : Math.max(from.x - 46, to.x + 10);
    return `M${from.x.toFixed(1)},${from.y.toFixed(1)} L${elbow.toFixed(1)},${from.y.toFixed(1)} L${to.x.toFixed(1)},${to.y.toFixed(1)}`;
  }

  function ensureWires() {
    if (el.wires.childElementCount) return;
    for (const card of CARDS) {
      const group = svg("g", { class: "mi-wire" });
      group.dataset.key = card.key;
      group.append(svg("path", { class: "mi-wire-line", pathLength: "100" }), svg("path", { class: "mi-wire-pulse", pathLength: "100" }),
        svg("circle", { r: "3.2", class: "mi-wire-start" }), svg("circle", { r: "4.4", class: "mi-wire-end" }));
      el.wires.append(group);
    }
  }

  function frame() {
    state.frame = 0;
    if (!state.focus || !state.open || document.body.dataset.view !== "map" || !el.layer) return;
    const g = globe();
    const stageBox = el.stage.getBoundingClientRect();
    const canvasBox = g?.canvas?.getBoundingClientRect();
    if (!canvasBox || !stageBox.width) {
      loop();
      return;
    }
    el.links.setAttribute("viewBox", `0 0 ${stageBox.width} ${stageBox.height}`);
    const dx = canvasBox.left - stageBox.left;
    const dy = canvasBox.top - stageBox.top;
    const centerPoint = g.project(state.focus.lon, state.focus.lat);
    const center = centerPoint ? { x: centerPoint.x + dx, y: centerPoint.y + dy, visible: centerPoint.visible } : null;
    el.core.setAttribute("transform", center ? `translate(${center.x.toFixed(1)},${center.y.toFixed(1)})` : "translate(-99,-99)");
    el.core.classList.toggle("is-behind", !center?.visible);
    ensureWires();
    const spread = Math.max(26, Math.min(90, Math.min(stageBox.width, stageBox.height) * 0.08));
    for (const wire of el.wires.children) {
      const card = el.cards[wire.dataset.key];
      const box = card.box.getBoundingClientRect();
      const side = card.card.side;
      const from = { x: (side === "left" ? box.right : box.left) - stageBox.left, y: box.top - stageBox.top + Math.min(26, box.height / 2) };
      let to = null;
      if (card.card.key === "tourism" && el.pins.firstChild?.__point) {
        const first = g.project(...el.pins.firstChild.__point);
        if (first?.visible) to = { x: first.x + dx, y: first.y + dy };
      }
      if (!to && center) {
        const angle = (card.card.angle * Math.PI) / 180;
        to = { x: center.x + Math.cos(angle) * spread, y: center.y + Math.sin(angle) * spread * 0.8 };
      }
      const visible = Boolean(to && center?.visible && box.width);
      wire.classList.toggle("is-off", !visible);
      if (!visible) continue;
      const path = wirePath(from, to, side);
      wire.children[0].setAttribute("d", path);
      wire.children[1].setAttribute("d", path);
      wire.children[2].setAttribute("cx", from.x.toFixed(1));
      wire.children[2].setAttribute("cy", from.y.toFixed(1));
      wire.children[3].setAttribute("cx", to.x.toFixed(1));
      wire.children[3].setAttribute("cy", to.y.toFixed(1));
      wire.dataset.mood = card.box.dataset.mood || "";
    }
    for (const pin of el.pins.children) {
      const point = g.project(...pin.__point);
      const shown = Boolean(point?.visible);
      pin.classList.toggle("is-off", !shown);
      if (shown) pin.setAttribute("transform", `translate(${(point.x + dx).toFixed(1)},${(point.y + dy).toFixed(1)})`);
    }
    if (state.live?.weather) {
      const time = localTime();
      el.ribbonClock.textContent = `${time} LOCAL`;
      const clock = $(".mi-clock-time", el.cards.weather.body);
      if (clock) clock.textContent = time;
    }
    loop();
  }

  function loop() {
    if (!state.frame) state.frame = window.requestAnimationFrame(frame);
  }

  function clear() {
    state.token += 1;
    state.focus = null;
    if (!el.layer) return;
    el.layer.classList.add("is-leaving");
    window.setTimeout(() => {
      if (!state.focus) {
        el.layer.classList.remove("is-in", "is-leaving");
        el.pins.replaceChildren();
        syncToggle();
      }
    }, calm() ? 0 : 380);
  }

  function init() {
    build();
    document.addEventListener("jarvis:map-focus", (event) => {
      build();
      if (event.detail) load(event.detail);
      else clear();
    });
    document.addEventListener("jarvis:view", (event) => {
      if (event.detail.view === "map" && state.focus) loop();
    });
    window.addEventListener("resize", loop);
    document.addEventListener("jarvis:command", (event) => {
      const command = event.detail?.command;
      if (command === "map-intel") setOpen(event.detail.arg !== "off");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
