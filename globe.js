/* "Mapa global": a holographic globe on a canvas (orthographic projection) with the countries,
   states and capitals of Natural Earth and the cities of GeoNames (web/geo), plus zoom, focus,
   search and a target panel. Cities come in as the zoom grows, the biggest first, like in map
   software; the smaller ones load only when the view gets close. */
(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const ui = () => window.jarvisUI;
  const hud = () => window.jarvisHUD;
  const calm = () => document.documentElement.classList.contains("reduce-motion");
  const plain = (text) => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const RAD = Math.PI / 180;
  const MIN_ZOOM = 0.8;
  const MAX_ZOOM = 60;
  const CYAN = "43, 217, 255";
  const HELP = window.matchMedia?.("(pointer: coarse)").matches // a touch screen: the phone app's MAPA
    ? "PINCE PARA APROXIMAR · TOQUE DUAS VEZES APROXIMA · ARRASTE PARA GIRAR · TOQUE PARA FOCAR"
    : "ROLE PARA APROXIMAR NO CURSOR · DUPLO CLIQUE APROXIMA · SHIFT+ARRASTE ENQUADRA · CLIQUE PARA FOCAR";
  const numbers = new Intl.NumberFormat("pt-BR");
  // The smallest city on screen has about CITY_DETAIL / zoom^2.3 people: 1,8 million at 2x, 150
  // thousand at 6x, 15 thousand (all of them) from about 20x. In the country in focus, 2.5x fewer.
  const CITY_DETAIL = 9e6;
  const CITY_FLOOR = 15000;
  const FOCUS_BOOST = 2.5;
  const CITY_TIERS = { major: { file: "geo/cities-major.json", zoom: 2 }, minor: { file: "geo/cities-minor.json", zoom: 5.5 } };
  const minPopulation = (zoom) => (zoom < 1.8 ? Infinity : Math.max(CITY_FLOOR, CITY_DETAIL / zoom ** 2.3));
  const PLACE_KINDS = { capital: "CAPITAL NACIONAL", state: "CAPITAL REGIONAL", city: "METRÓPOLE", town: "CIDADE" };

  const view = {
    canvas: null,
    ctx: null,
    width: 0,
    height: 0,
    lon: -50,
    lat: -12,
    zoom: 1,
    spin: true,
    drag: null,
    velocity: [0, 0],
    hover: null,
    hoverState: null,
    selected: null,
    selectedState: null,
    selectedCity: null,
    drawn: [], // markers on screen in the last frame: [x, y, place], for clicks
    flight: null,
    glide: null, // a zoom easing toward its target, the point under the cursor kept in place
    box: null, // Shift + drag: the area to frame
    touches: new Map(),
    pinch: null,
    cursor: null,
    frame: 0,
    last: 0,
    dirty: true,
    layers: { borders: true, states: true, places: true, grid: true },
    loaded: false,
    loading: false,
    wave: 0,
  };
  const data = { countries: [], states: null, statesLoading: null, places: [], cities: [], citiesLoading: {}, coarse: null, fine: null, grid: [] };
  const out = new Float64Array(3);

  /* ---------- data ---------- */

  function unit(lon, lat, target, offset) {
    const cosLat = Math.cos(lat * RAD);
    target[offset] = cosLat * Math.cos(lon * RAD);
    target[offset + 1] = cosLat * Math.sin(lon * RAD);
    target[offset + 2] = Math.sin(lat * RAD);
  }

  function decodeRing(flat, scale) {
    const n = flat.length / 2;
    const lonlat = new Float32Array(n * 2);
    const xyz = new Float32Array(n * 3);
    let x = 0;
    let y = 0;
    for (let i = 0; i < n; i += 1) {
      x += flat[2 * i];
      y += flat[2 * i + 1];
      lonlat[2 * i] = x / scale;
      lonlat[2 * i + 1] = y / scale;
      unit(x / scale, y / scale, xyz, 3 * i);
    }
    return { n, lonlat, xyz };
  }

  /** Decoded rings, bbox in degrees, a center vector and an angular radius for culling. */
  function prepare(item, scale) {
    item.shape = item.rings.map((ring) => decodeRing(ring, scale));
    item.box = item.bbox.map((value) => value / scale);
    delete item.rings;
    item.center = new Float64Array(3);
    unit(item.label[0], item.label[1], item.center, 0);
    let radius = 0;
    for (const ring of item.shape) {
      for (let i = 0; i < ring.n; i += 1) {
        const dot = ring.xyz[3 * i] * item.center[0] + ring.xyz[3 * i + 1] * item.center[1] + ring.xyz[3 * i + 2] * item.center[2];
        radius = Math.max(radius, Math.acos(Math.max(-1, Math.min(1, dot))));
      }
    }
    item.radius = radius / RAD;
    item.search = plain(`${item.name} ${item.en || ""} ${item.local || ""}`);
  }

  function prepareDots(flat) {
    const count = flat.length / 3;
    const xyz = new Float32Array(count * 3);
    const owner = new Int16Array(count);
    for (let i = 0; i < count; i += 1) {
      unit(flat[3 * i] / 10, flat[3 * i + 1] / 10, xyz, 3 * i);
      owner[i] = flat[3 * i + 2];
    }
    return { count, xyz, owner };
  }

  function prepareGrid() {
    const lines = [];
    const add = (points) => {
      const xyz = new Float32Array(points.length * 3);
      points.forEach(([lon, lat], i) => unit(lon, lat, xyz, 3 * i));
      lines.push({ n: points.length, xyz });
    };
    for (let lon = -180; lon < 180; lon += 15) add(Array.from({ length: 91 }, (_, i) => [lon, -90 + i * 2]));
    for (let lat = -75; lat <= 75; lat += 15) add(Array.from({ length: 181 }, (_, i) => [-180 + i * 2, lat]));
    data.grid = lines;
  }

  async function load() {
    if (view.loaded || view.loading) return;
    view.loading = true;
    status("CARREGANDO DADOS GEOGRÁFICOS…");
    try {
      const [countries, places, dots] = await Promise.all([
        hud().getJSON("geo/countries.json", 8000, 4),
        hud().getJSON("geo/places.json", 8000, 4),
        hud().getJSON("geo/dots.json", 8000, 4),
      ]);
      data.countries = countries.countries;
      data.countries.forEach((country, index) => {
        country.index = index;
        prepare(country, countries.scale);
      });
      data.places = places.places;
      data.places.forEach(preparePlace);
      data.coarse = prepareDots(dots.coarse);
      data.fine = prepareDots(dots.fine);
      prepareGrid();
      view.loaded = true;
      status(HELP);
      renderList();
      renderTarget();
      view.dirty = true;
      loadStates();
      if (view.pending) {
        const query = view.pending;
        view.pending = null;
        focusQuery(query);
      }
    } catch (error) {
      status(`FALHA AO LER O MAPA: ${error.message}`);
    } finally {
      view.loading = false;
    }
  }

  function loadStates() {
    if (!data.statesLoading) {
      data.statesLoading = hud().getJSON("geo/states.json", 10000, 4).then((payload) => {
        data.states = payload.countries;
        data.statesScale = payload.scale;
        if (view.selected) renderList();
        view.dirty = true;
        return data.states;
      }).catch(() => null);
    }
    return data.statesLoading;
  }

  /** A place or city: its unit vector for drawing, a name to search and a point for the target. */
  function preparePlace(place) {
    place.xyz = new Float64Array(3);
    unit(place.lon, place.lat, place.xyz, 0);
    place.label = [place.lon, place.lat];
    place.search = plain(`${place.name} ${place.en || ""}`);
  }

  async function readJSON(path) {
    // ~0.2 and ~0.9 MB: in slices, like the hologram, since security software here sometimes
    // holds big local answers; a plain request if the slicer is missing.
    if (window.jarvisFetchChunked) return JSON.parse(new TextDecoder().decode(await window.jarvisFetchChunked(path)));
    return hud().getJSON(path, 20000, 4);
  }

  /** The cities of one tier (major or minor), merged into data.cities, biggest first. */
  function loadCities(tier) {
    if (!data.citiesLoading[tier]) {
      data.citiesLoading[tier] = readJSON(CITY_TIERS[tier].file).then((payload) => {
        for (const [name, country, state, popK, lon, lat] of payload.cities) {
          const city = { name, country: payload.countries[country], state: payload.states[state], kind: "town", pop: popK * 1000, lon: lon / 100, lat: lat / 100 };
          preparePlace(city);
          data.cities.push(city);
        }
        data.cities.sort((a, b) => b.pop - a.pop);
        view.dirty = true;
        return data.cities;
      }).catch(() => {
        window.setTimeout(() => delete data.citiesLoading[tier], 15000); // try again a little later
        return data.cities;
      });
    }
    return data.citiesLoading[tier];
  }

  function statesOf(country) {
    const list = data.states?.[country?.id];
    if (!list) return [];
    if (!list.prepared) {
      for (const state of list) {
        state.country = country;
        prepare(state, data.statesScale);
      }
      list.prepared = true;
    }
    return list;
  }

  /* ---------- projection ---------- */

  const baseRadius = () => Math.min(view.width * 0.4, view.height * 0.37);

  function projector() {
    const lift = Math.max(0, Math.min(1, 2 - view.zoom)); // the globe sits higher above its base at full view
    return {
      R: baseRadius() * view.zoom,
      cx: view.width / 2,
      cy: view.height * (0.5 - 0.04 * lift),
      cl: Math.cos(view.lon * RAD),
      sl: Math.sin(view.lon * RAD),
      cp: Math.cos(view.lat * RAD),
      sp: Math.sin(view.lat * RAD),
    };
  }

  /** out = [depth (>0 means facing the viewer), screen x, screen y]. */
  function tf(p, xyz, i) {
    const x = xyz[i];
    const y = xyz[i + 1];
    const z = xyz[i + 2];
    const x1 = x * p.cl + y * p.sl;
    out[0] = x1 * p.cp + z * p.sp;
    out[1] = p.cx + p.R * (y * p.cl - x * p.sl);
    out[2] = p.cy - p.R * (z * p.cp - x1 * p.sp);
  }

  function inverse(p, sx, sy) {
    const y2 = (sx - p.cx) / p.R;
    const z2 = -(sy - p.cy) / p.R;
    const rest = 1 - y2 * y2 - z2 * z2;
    if (rest < 0) return null;
    const x2 = Math.sqrt(rest);
    const x1 = x2 * p.cp - z2 * p.sp;
    const z = x2 * p.sp + z2 * p.cp;
    const x = x1 * p.cl - y2 * p.sl;
    const y = x1 * p.sl + y2 * p.cl;
    return [Math.atan2(y, x) / RAD, Math.asin(Math.max(-1, Math.min(1, z))) / RAD];
  }

  /** Whether a shape can be on screen: hemisphere and viewport culling by angular distance. */
  function maybeVisible(p, item) {
    const axisX = Math.cos(view.lat * RAD) * Math.cos(view.lon * RAD);
    const axisY = Math.cos(view.lat * RAD) * Math.sin(view.lon * RAD);
    const axisZ = Math.sin(view.lat * RAD);
    const distance = Math.acos(Math.max(-1, Math.min(1, item.center[0] * axisX + item.center[1] * axisY + item.center[2] * axisZ))) / RAD;
    const reach = Math.min(90, Math.asin(Math.min(1, Math.hypot(view.width, view.height) / 2 / p.R)) / RAD + 2);
    return distance <= reach + item.radius;
  }

  function contains(item, lon, lat) {
    const [x0, y0, x1, y1] = item.box;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) return false;
    let inside = false;
    for (const ring of item.shape) {
      const pts = ring.lonlat;
      for (let i = 0, j = ring.n - 1; i < ring.n; j = i, i += 1) {
        const xi = pts[2 * i];
        const yi = pts[2 * i + 1];
        const xj = pts[2 * j];
        const yj = pts[2 * j + 1];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  }

  const pickCountry = (lon, lat) => data.countries.find((country) => contains(country, lon, lat)) || null;
  const pickState = (country, lon, lat) => statesOf(country).find((state) => contains(state, lon, lat)) || null;

  /* ---------- drawing ---------- */

  function trace(ctx, p, ring) {
    let pen = false;
    let prevLon = 0;
    let prevLat = 0;
    for (let i = 0; i < ring.n; i += 1) {
      tf(p, ring.xyz, 3 * i);
      const lon = ring.lonlat ? ring.lonlat[2 * i] : 0;
      const lat = ring.lonlat ? ring.lonlat[2 * i + 1] : 0;
      // Natural Earth cuts shapes at the antimeridian and closes Antarctica along the pole: no border there.
      const seam = i > 0 && ring.lonlat && ((Math.abs(lon) > 179.9 && Math.abs(prevLon) > 179.9) || (lat < -89.5 && prevLat < -89.5));
      const visible = out[0] > 0;
      if (visible && pen && !seam) ctx.lineTo(out[1], out[2]);
      else if (visible) ctx.moveTo(out[1], out[2]);
      pen = visible;
      prevLon = lon;
      prevLat = lat;
    }
  }

  function fillShape(ctx, p, item) {
    // Only rings fully on the visible side are filled; the borders still show the rest.
    ctx.beginPath();
    let any = false;
    for (const ring of item.shape) {
      let ok = true;
      for (let i = 0; i < ring.n && ok; i += 1) {
        tf(p, ring.xyz, 3 * i);
        ok = out[0] > 0;
      }
      if (!ok) continue;
      for (let i = 0; i < ring.n; i += 1) {
        tf(p, ring.xyz, 3 * i);
        if (i) ctx.lineTo(out[1], out[2]);
        else ctx.moveTo(out[1], out[2]);
      }
      ctx.closePath();
      any = true;
    }
    if (any) ctx.fill("evenodd");
  }

  function drawBase(ctx, p, now) {
    const fade = Math.max(0, 1 - (view.zoom - 1) * 1.6);
    if (fade <= 0) return;
    const y = p.cy + p.R * 1.16;
    ctx.save();
    ctx.globalAlpha = fade;
    const glow = ctx.createRadialGradient(p.cx, y, 0, p.cx, y, p.R * 1.3);
    glow.addColorStop(0, `rgba(${CYAN}, 0.28)`);
    glow.addColorStop(1, `rgba(${CYAN}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(p.cx, y, p.R * 1.3, p.R * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    const spin = calm() ? 0 : now / 3000;
    for (const [scale, alpha, dash] of [[1.18, 0.55, []], [0.95, 0.4, [4, 10]], [0.7, 0.7, []], [0.42, 0.5, [2, 6]]]) {
      ctx.strokeStyle = `rgba(${CYAN}, ${alpha})`;
      ctx.lineWidth = scale > 1 ? 2 : 1.4;
      ctx.setLineDash(dash);
      ctx.lineDashOffset = -spin * 40 * scale;
      ctx.beginPath();
      ctx.ellipse(p.cx, y, p.R * scale, p.R * scale * 0.17, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Light column from the projector up to the globe.
    const beam = ctx.createLinearGradient(0, y, 0, p.cy);
    beam.addColorStop(0, `rgba(${CYAN}, 0.16)`);
    beam.addColorStop(1, `rgba(${CYAN}, 0)`);
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(p.cx - p.R * 0.42, y);
    ctx.lineTo(p.cx - p.R * 0.8, p.cy + p.R * 0.6);
    ctx.lineTo(p.cx + p.R * 0.8, p.cy + p.R * 0.6);
    ctx.lineTo(p.cx + p.R * 0.42, y);
    ctx.fill();
    ctx.restore();
  }

  function drawSphere(ctx, p) {
    const atmosphere = ctx.createRadialGradient(p.cx, p.cy, p.R * 0.94, p.cx, p.cy, p.R * 1.16);
    atmosphere.addColorStop(0, `rgba(${CYAN}, 0.32)`);
    atmosphere.addColorStop(1, `rgba(${CYAN}, 0)`);
    ctx.fillStyle = atmosphere;
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, p.R * 1.16, 0, Math.PI * 2);
    ctx.fill();
    const body = ctx.createRadialGradient(p.cx - p.R * 0.3, p.cy - p.R * 0.35, p.R * 0.1, p.cx, p.cy, p.R);
    body.addColorStop(0, "rgba(24, 92, 130, 0.55)");
    body.addColorStop(0.7, "rgba(6, 34, 56, 0.72)");
    body.addColorStop(1, "rgba(2, 14, 26, 0.9)");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, p.R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(${CYAN}, 0.55)`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  function drawGrid(ctx, p) {
    ctx.beginPath();
    for (const line of data.grid) trace(ctx, p, line);
    ctx.strokeStyle = `rgba(${CYAN}, 0.1)`;
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }

  function drawLand(ctx, p) {
    // Close up, the dot grid thins out; a faint fill keeps the land reading as solid.
    if (view.zoom < 1.8) return;
    ctx.beginPath();
    for (const country of data.countries) {
      if (!maybeVisible(p, country)) continue;
      for (const ring of country.shape) {
        let ok = true;
        for (let i = 0; i < ring.n && ok; i += 1) {
          tf(p, ring.xyz, 3 * i);
          ok = out[0] > 0;
        }
        if (!ok) continue;
        for (let i = 0; i < ring.n; i += 1) {
          tf(p, ring.xyz, 3 * i);
          if (i) ctx.lineTo(out[1], out[2]);
          else ctx.moveTo(out[1], out[2]);
        }
        ctx.closePath();
      }
    }
    ctx.fillStyle = `rgba(${CYAN}, ${Math.min(0.14, 0.05 + view.zoom * 0.01)})`;
    ctx.fill("evenodd");
  }

  function drawDots(ctx, p) {
    const fine = view.zoom >= 2.2;
    const set = fine ? data.fine : data.coarse;
    const spacing = p.R * RAD * (fine ? 0.5 : 1);
    const size = Math.max(1.1, Math.min(4.5, spacing * (view.zoom > 3 ? 0.3 : 0.5)));
    const fade = view.zoom > 3 ? 0.6 : 1;
    const half = size / 2;
    const selected = view.selected ? view.selected.index : -1;
    const hovered = view.hover ? view.hover.index : -1;
    const bright = [];
    const { width: w, height: h } = view;
    ctx.fillStyle = `rgb(${CYAN})`;
    for (let i = 0; i < set.count; i += 1) {
      tf(p, set.xyz, 3 * i);
      const depth = out[0];
      if (depth <= 0.02) continue;
      const sx = out[1];
      const sy = out[2];
      if (sx < -size || sy < -size || sx > w + size || sy > h + size) continue;
      const owner = set.owner[i];
      if (owner === selected || owner === hovered) {
        bright.push(sx, sy, depth, owner === selected ? 1 : 0);
        continue;
      }
      ctx.globalAlpha = (0.16 + 0.6 * depth) * fade;
      ctx.fillRect(sx - half, sy - half, size, size);
    }
    for (let i = 0; i < bright.length; i += 4) {
      ctx.fillStyle = bright[i + 3] ? "#eafdff" : "#9fefff";
      ctx.globalAlpha = 0.45 + 0.55 * bright[i + 2];
      ctx.fillRect(bright[i] - half * 1.2, bright[i + 1] - half * 1.2, size * 1.2, size * 1.2);
    }
    ctx.globalAlpha = 1;
  }

  function drawBorders(ctx, p) {
    ctx.beginPath();
    for (const country of data.countries) {
      if (!maybeVisible(p, country)) continue;
      for (const ring of country.shape) trace(ctx, p, ring);
    }
    ctx.strokeStyle = `rgba(${CYAN}, ${view.zoom > 3 ? 0.55 : 0.4})`;
    ctx.lineWidth = view.zoom > 3 ? 1 : 0.8;
    ctx.stroke();
  }

  function drawFocus(ctx, p) {
    for (const [item, selected] of [[view.hover, false], [view.selected, true]]) {
      if (!item || (selected === false && item === view.selected)) continue;
      ctx.fillStyle = `rgba(${CYAN}, ${selected ? 0.16 : 0.1})`;
      fillShape(ctx, p, item);
      ctx.beginPath();
      for (const ring of item.shape) trace(ctx, p, ring);
      ctx.save();
      ctx.shadowColor = `rgb(${CYAN})`;
      ctx.shadowBlur = selected ? 14 : 8;
      ctx.strokeStyle = selected ? "#bff7ff" : `rgba(${CYAN}, 0.9)`;
      ctx.lineWidth = selected ? 1.8 : 1.2;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawStates(ctx, p) {
    if (!data.states || view.zoom < 1.6) return;
    const owners = new Set();
    if (view.selected) owners.add(view.selected);
    if (view.zoom >= 3.5) {
      for (const country of data.countries) if (data.states[country.id] && maybeVisible(p, country)) owners.add(country);
    }
    ctx.beginPath();
    for (const country of owners) {
      for (const state of statesOf(country)) {
        if (!maybeVisible(p, state)) continue;
        for (const ring of state.shape) trace(ctx, p, ring);
      }
    }
    ctx.strokeStyle = `rgba(${CYAN}, 0.3)`;
    ctx.lineWidth = 0.6;
    ctx.stroke();
    for (const [state, selected] of [[view.hoverState, false], [view.selectedState, true]]) {
      if (!state) continue;
      ctx.fillStyle = selected ? "rgba(255, 180, 94, 0.22)" : `rgba(${CYAN}, 0.16)`;
      fillShape(ctx, p, state);
      ctx.beginPath();
      for (const ring of state.shape) trace(ctx, p, ring);
      ctx.strokeStyle = selected ? "#ffcf8a" : "#9fefff";
      ctx.lineWidth = selected ? 1.6 : 1;
      ctx.stroke();
    }
  }

  const scratch = new Float64Array(3);

  function project(lon, lat, p) {
    unit(lon, lat, scratch, 0);
    tf(p, scratch, 0);
    return out[0] > 0 ? [out[1], out[2]] : null;
  }

  function drawLabel(ctx, text, x, y, color, size = 12, weight = "600") {
    ctx.font = `${weight} ${size}px Bahnschrift, "Segoe UI", sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(2, 10, 18, 0.85)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /** Capitals, then every city big enough for the zoom (more in the country in focus), biggest
   *  first so their names win the space; a small city whose name does not fit is left out. */
  function drawPlaces(ctx, p, taken) {
    view.drawn = [];
    if (view.zoom < 1.3) return;
    for (const [tier, spec] of Object.entries(CITY_TIERS)) if (view.zoom >= spec.zoom) loadCities(tier);
    const free = (box) => {
      if (taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) return false;
      taken.push(box);
      return true;
    };
    const floor = minPopulation(view.zoom);
    const focus = view.selected?.id;
    const { width: w, height: h } = view;
    ctx.textAlign = "left";

    const mark = (place) => {
      const ofFocus = place.country === focus;
      if (place.kind === "state" ? view.zoom < (ofFocus ? 2.6 : 4) : place.kind !== "capital" && place.pop < (ofFocus ? floor / FOCUS_BOOST : floor)) return;
      tf(p, place.xyz, 0);
      const x = out[1];
      const y = out[2];
      if (out[0] <= 0.02 || x < -40 || y < -20 || x > w + 40 || y > h + 20) return;
      const capital = place.kind === "capital";
      const town = place.kind === "town" || place.kind === "city";
      const size = capital ? 11.5 : place.pop >= 1e6 ? 11 : town ? 10 : 10.5;
      const named = capital ? ofFocus || view.zoom >= 3.2 : true;
      let box = null;
      if (named) {
        ctx.font = `${capital ? 600 : 400} ${size}px Bahnschrift, "Segoe UI", sans-serif`;
        const width = ctx.measureText(place.name).width;
        box = [x + 3, y - size - 1, x + width + 11, y + 5];
        if (!free(box)) {
          if (town) return; // no room for its name: the bigger neighbour keeps the spot
          box = null;
        }
      }
      if (capital || place.kind === "state") {
        const r = capital ? 4 : 3;
        ctx.fillStyle = capital ? "#ffcf8a" : "#e9fbff";
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.fill();
      } else {
        const r = Math.max(1.4, 1.4 + 0.55 * Math.log10(place.pop / CITY_FLOOR));
        ctx.fillStyle = place === view.selectedCity ? "#ffcf8a" : "rgba(143, 233, 255, 0.9)";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (place.pop >= 1e6) {
          ctx.strokeStyle = `rgba(${CYAN}, 0.6)`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      view.drawn.push([x, y, place]);
      if (box) {
        const color = capital ? "#ffcf8a" : place.kind === "state" ? "#e9fbff" : place.pop >= 1e6 ? "#cfeef8" : "rgba(196, 232, 244, 0.82)";
        drawLabel(ctx, place.name, x + 7, y + 4, color, size, capital ? "600" : "400");
      }
    };

    for (const place of data.places) mark(place);
    const lowest = focus ? floor / FOCUS_BOOST : floor;
    for (const city of data.cities) {
      if (city.pop < lowest) break; // sorted biggest first
      mark(city);
    }
  }

  /** The divisions of the country in focus; their boxes go into `taken`, so city names avoid them. */
  function drawStateNames(ctx, p, taken) {
    if (!view.selected || view.zoom < 1.6 || !view.layers.states || !data.states) return;
    ctx.textAlign = "center";
    const states = statesOf(view.selected).filter((state) => maybeVisible(p, state)).sort((a, b) => b.area - a.area);
    for (const state of states) {
      const point = project(state.label[0], state.label[1], p);
      if (!point) continue;
      ctx.font = "10.5px Bahnschrift, \"Segoe UI\", sans-serif";
      const width = ctx.measureText(state.name).width;
      const box = [point[0] - width / 2 - 3, point[1] - 11, point[0] + width / 2 + 3, point[1] + 3];
      if (taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) continue;
      taken.push(box);
      drawLabel(ctx, state.name, point[0], point[1], state === view.selectedState ? "#ffcf8a" : "rgba(207, 238, 248, 0.85)", 10.5, "400");
    }
  }

  function drawNames(ctx, p, now) {
    ctx.textAlign = "center";
    const target = view.selectedCity || view.selectedState || view.selected;
    if (target) {
      const point = project(target.label[0], target.label[1], p);
      if (point) {
        // Rotating target brackets around the focus point.
        const spin = calm() ? 0 : now / 900;
        ctx.strokeStyle = view.selectedCity || view.selectedState ? "#ffcf8a" : "#bff7ff";
        ctx.lineWidth = 1.6;
        for (let k = 0; k < 4; k += 1) {
          ctx.beginPath();
          ctx.arc(point[0], point[1], 16, spin + k * Math.PI / 2, spin + k * Math.PI / 2 + 0.8);
          ctx.stroke();
        }
        drawLabel(ctx, target.name.toUpperCase(), point[0], point[1] - 24, "#ffffff", 14);
      }
    }
    if (view.hover && view.hover !== view.selected && view.cursor) {
      ctx.textAlign = "left";
      drawLabel(ctx, view.hover.name, view.cursor[0] + 14, view.cursor[1] - 10, "#9fefff", 12);
    }
  }

  function drawRing(ctx, p, now) {
    if (p.R * 1.25 > Math.max(view.width, view.height)) return;
    const spin = calm() ? 0 : now / 7000;
    const r = p.R * 1.07;
    ctx.save();
    ctx.strokeStyle = `rgba(${CYAN}, 0.35)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowColor = `rgb(${CYAN})`;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = `rgba(${CYAN}, 0.85)`;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, r, spin, spin + 1.3);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, r, spin + Math.PI, spin + Math.PI + 0.5);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(${CYAN}, 0.7)`;
    for (let k = 0; k < 120; k += 1) {
      const angle = -spin * 0.6 + (k * Math.PI) / 60;
      ctx.fillRect(p.cx + Math.cos(angle) * r * 1.05 - 1, p.cy + Math.sin(angle) * r * 1.05 - 1, 2, 2);
    }
    ctx.strokeStyle = `rgba(${CYAN}, 0.4)`;
    ctx.lineWidth = 1;
    for (let k = 0; k < 72; k += 1) {
      const angle = (k * Math.PI) / 36;
      const inner = r * (k % 6 === 0 ? 1.1 : 1.12);
      ctx.beginPath();
      ctx.moveTo(p.cx + Math.cos(angle) * inner, p.cy + Math.sin(angle) * inner);
      ctx.lineTo(p.cx + Math.cos(angle) * r * 1.14, p.cy + Math.sin(angle) * r * 1.14);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBeams(ctx, p, now) {
    if (calm() || view.zoom > 1.6) return;
    ctx.save();
    for (const [offset, width] of [[-0.06, 1.25], [0.03, 1.1]]) {
      const y = p.cy + p.R * (offset + Math.sin(now / 2400 + offset * 20) * 0.02);
      const beam = ctx.createLinearGradient(p.cx - p.R * width, 0, p.cx + p.R * width, 0);
      beam.addColorStop(0, `rgba(${CYAN}, 0)`);
      beam.addColorStop(0.5, "rgba(220, 252, 255, 0.55)");
      beam.addColorStop(1, `rgba(${CYAN}, 0)`);
      ctx.fillStyle = beam;
      ctx.fillRect(p.cx - p.R * width, y - 1, p.R * width * 2, 2);
    }
    ctx.restore();
  }

  function drawBox(ctx) {
    if (!view.box) return;
    const [x0, y0] = view.box.start;
    const [x1, y1] = view.box.end;
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    ctx.save();
    ctx.fillStyle = `rgba(${CYAN}, 0.08)`;
    ctx.fillRect(x, y, w, h);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = `rgba(${CYAN}, 0.85)`;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + dy * 12);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + dx * 12, cy);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(220, 252, 255, 0.95)";
    ctx.font = "10px Cascadia Mono, Consolas, monospace";
    ctx.fillText("ENQUADRAR", x + 6, y - 6);
    ctx.restore();
  }

  function draw(now) {
    const ctx = view.ctx;
    ctx.clearRect(0, 0, view.width, view.height);
    if (!view.loaded) return;
    const p = projector();
    drawBase(ctx, p, now);
    drawSphere(ctx, p);
    if (view.layers.grid) drawGrid(ctx, p);
    drawLand(ctx, p);
    drawDots(ctx, p);
    if (view.layers.borders) drawBorders(ctx, p);
    if (view.layers.states) drawStates(ctx, p);
    drawFocus(ctx, p);
    const taken = []; // label boxes: state names first, then capitals and cities around them
    drawStateNames(ctx, p, taken);
    view.drawn = [];
    if (view.layers.places) drawPlaces(ctx, p, taken);
    drawNames(ctx, p, now);
    drawRing(ctx, p, now);
    drawBeams(ctx, p, now);
    drawBox(ctx);
  }

  function drawWave(now) {
    const canvas = $("#gl-wave");
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const t = calm() ? 0 : now / 1000;
    for (const [amp, freq, alpha] of [[0.32, 2.1, 0.9], [0.18, 3.7, 0.45], [0.1, 7.3, 0.3]]) {
      ctx.beginPath();
      for (let x = 0; x <= width; x += 3) {
        const y = height / 2 + Math.sin(x / width * Math.PI * 2 * freq + t * freq) * height * amp * (0.6 + 0.4 * Math.sin(t + x / 40));
        if (x) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.strokeStyle = `rgba(${CYAN}, ${alpha})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  /* ---------- motion ---------- */

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  function flyTo(lon, lat, zoom, duration = 1500) {
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    if (calm()) {
      Object.assign(view, { lon, lat, zoom, flight: null, dirty: true });
      return;
    }
    const dLon = ((lon - view.lon + 540) % 360) - 180;
    const distance = Math.hypot(dLon * Math.cos(lat * RAD), lat - view.lat);
    view.flight = {
      from: { lon: view.lon, lat: view.lat, zoom: view.zoom },
      to: { lon: view.lon + dLon, lat, zoom },
      start: performance.now(),
      duration,
      dip: Math.min(0.55, distance / 160),
    };
    view.velocity = [0, 0];
  }

  function fitZoom(box) {
    const [x0, y0, x1, y1] = box;
    const span = Math.max(y1 - y0, (x1 - x0) * Math.cos(((y0 + y1) / 2) * RAD), 0.3);
    return Math.max(1, Math.min(MAX_ZOOM, (Math.min(view.width, view.height) * 0.6) / (baseRadius() * span * RAD)));
  }

  /** Keeps the place that was under a screen point under it while the zoom changes. */
  function anchor(geo, point) {
    const after = inverse(projector(), point[0], point[1]);
    if (!geo || !after) return;
    view.lon += ((geo[0] - after[0] + 540) % 360) - 180;
    view.lat = Math.max(-85, Math.min(85, view.lat + geo[1] - after[1]));
  }

  function tick(now) {
    const elapsed = view.last ? Math.min(64, now - view.last) : 16;
    view.last = now;
    if (view.glide) { // like map software: the zoom eases in, around the point that was clicked or scrolled
      const glide = view.glide;
      view.zoom += (glide.target - view.zoom) * (1 - Math.exp(-elapsed / 85));
      if (Math.abs(glide.target - view.zoom) < glide.target * 0.002) {
        view.zoom = glide.target;
        view.glide = null;
      }
      anchor(glide.geo, glide.point);
      view.dirty = true;
    }
    if (view.flight) {
      const flight = view.flight;
      const t = Math.min(1, (now - flight.start) / flight.duration);
      const e = ease(t);
      view.lon = flight.from.lon + (flight.to.lon - flight.from.lon) * e;
      view.lat = flight.from.lat + (flight.to.lat - flight.from.lat) * e;
      view.zoom = (flight.from.zoom + (flight.to.zoom - flight.from.zoom) * e) * (1 - flight.dip * Math.sin(Math.PI * t));
      view.dirty = true;
      if (t >= 1) view.flight = null;
    } else if (!view.drag) {
      if (Math.abs(view.velocity[0]) + Math.abs(view.velocity[1]) > 0.01) {
        view.lon -= view.velocity[0];
        view.lat = Math.max(-85, Math.min(85, view.lat + view.velocity[1]));
        view.velocity = view.velocity.map((v) => v * 0.92);
        view.dirty = true;
      } else if (view.spin && !view.selected && !view.glide && view.zoom < 1.4 && !calm()) {
        view.lon += elapsed * 0.012; // only the whole globe turns by itself; a close look stays put
        view.dirty = true;
      }
    }
    view.lon = ((view.lon + 540) % 360) - 180;
    if (view.dirty || !calm()) {
      draw(now);
      view.dirty = false;
    }
    drawWave(now);
    updateReadouts();
    view.frame = document.body.dataset.view === "map" ? window.requestAnimationFrame(tick) : 0;
  }

  function start() {
    if (!view.frame) {
      view.last = 0;
      view.frame = window.requestAnimationFrame(tick);
    }
  }

  function stop() {
    window.cancelAnimationFrame(view.frame);
    view.frame = 0;
  }

  /* ---------- panels ---------- */

  function status(text) {
    $("#gl-status").textContent = text;
  }

  const latText = (lat) => `${Math.abs(lat).toFixed(2).replace(".", ",")}°${lat >= 0 ? "N" : "S"}`;
  const lonText = (lon) => `${Math.abs(lon).toFixed(2).replace(".", ",")}°${lon >= 0 ? "L" : "O"}`;

  function updateReadouts() {
    $("#gl-center").textContent = `${latText(view.lat)} ${lonText(view.lon)}`;
    $("#gl-altitude").textContent = `${numbers.format(Math.round(16000 / view.zoom))} km`;
    // Scale bar at the center of the globe: a round distance about 100 px long.
    const kmPerPixel = 6371 / (baseRadius() * view.zoom || 1);
    const raw = kmPerPixel * 100;
    const power = 10 ** Math.floor(Math.log10(raw));
    const nice = [5, 2, 1].map((step) => step * power).find((value) => value <= raw) || power;
    const bar = $("#gl-scale-bar");
    if (bar) {
      bar.style.width = `${Math.round(nice / kmPerPixel)}px`;
      $("#gl-scale-text").textContent = `${numbers.format(nice)} km`;
      $("#gl-zoom-level").textContent = `ZOOM ${view.zoom.toFixed(1).replace(".", ",")}×`;
    }
  }

  function big(value, unitText) {
    if (!value) return "--";
    if (value >= 1e12) return `${(value / 1e12).toFixed(2).replace(".", ",")} tri${unitText}`;
    if (value >= 1e9) return `${(value / 1e9).toFixed(1).replace(".", ",")} bi${unitText}`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1).replace(".", ",")} mi${unitText}`;
    return `${numbers.format(value)}${unitText}`;
  }

  function capitalOf(country) {
    return data.places.find((place) => place.kind === "capital" && place.country === country.id)?.name || "--";
  }

  function stateCapital(state) {
    const names = [plain(state.local), plain(state.name)];
    return data.places.find((place) => place.kind === "state" && place.country === state.country.id && names.includes(plain(place.state)))?.name || "--";
  }

  function fact(list, term, value) {
    const item = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = value;
    item.append(dt, dd);
    list.append(item);
  }

  function renderTarget() {
    const box = $("#gl-target");
    const head = document.createElement("h3");
    head.className = "vx-head";
    head.textContent = "// INFORMAÇÕES DO ALVO";
    box.replaceChildren(head);
    const country = view.selected;
    const city = view.selectedCity;
    if (city) {
      const kind = document.createElement("span");
      kind.className = "gl-kind";
      kind.textContent = `${PLACE_KINDS[city.kind] || "CIDADE"} · ${(country?.name || city.country).toUpperCase()}`;
      const title = document.createElement("h4");
      title.textContent = city.name;
      const facts = document.createElement("dl");
      facts.className = "gl-facts";
      fact(facts, "POPULAÇÃO", city.pop ? `≈ ${big(city.pop, "")}` : "--");
      fact(facts, "ESTADO / REGIÃO", city.state || "--");
      fact(facts, "PAÍS", country?.name || city.country || "--");
      if (city.en) fact(facts, "NOME LOCAL", city.en);
      fact(facts, "LATITUDE", latText(city.lat));
      fact(facts, "LONGITUDE", lonText(city.lon));
      const back = document.createElement("button");
      back.type = "button";
      back.className = "vx-button";
      back.textContent = country ? "VOLTAR AO PAÍS" : "VISÃO GLOBAL";
      back.addEventListener("click", () => (country ? selectCountry(country) : reset()));
      box.append(kind, title, facts, back);
      return;
    }
    if (!country) {
      const empty = document.createElement("p");
      empty.className = "vx-empty";
      empty.textContent = view.loaded ? `${data.countries.length} países carregados. Clique num país ou busque pelo nome.` : "Carregando o mapa…";
      box.append(empty);
      return;
    }
    const state = view.selectedState;
    const kind = document.createElement("span");
    kind.className = "gl-kind";
    kind.textContent = state ? `${state.type.toUpperCase()} · ${country.name.toUpperCase()}` : `PAÍS · ${country.continent.toUpperCase()}`;
    const title = document.createElement("h4");
    title.textContent = state ? state.name : country.name;
    const facts = document.createElement("dl");
    facts.className = "gl-facts";
    if (state) {
      fact(facts, "CAPITAL", stateCapital(state));
      fact(facts, "CÓDIGO", state.code || "--");
      fact(facts, "ÁREA", state.area ? `${numbers.format(state.area)} km²` : "--");
      fact(facts, "NOME LOCAL", state.local || state.name);
      fact(facts, "LATITUDE", latText(state.label[1]));
      fact(facts, "LONGITUDE", lonText(state.label[0]));
    } else {
      fact(facts, "CAPITAL", capitalOf(country));
      fact(facts, "REGIÃO", country.subregion || "--");
      fact(facts, "POPULAÇÃO", country.pop ? `${big(country.pop, "")}${country.popYear ? ` (${country.popYear})` : ""}` : "--");
      fact(facts, "PIB", country.gdp ? `US$ ${big(country.gdp * 1e6, "")}${country.gdpYear ? ` (${country.gdpYear})` : ""}` : "--");
      fact(facts, "ÁREA", country.area ? `${numbers.format(country.area)} km²` : "--");
      fact(facts, "DIVISÕES", data.states ? String(statesOf(country).length) : "…");
      fact(facts, "CÓDIGO", [country.iso2, country.id].filter(Boolean).join(" · "));
      fact(facts, "NOME OFICIAL", country.formal || country.en || "--");
    }
    const back = document.createElement("button");
    back.type = "button";
    back.className = "vx-button";
    back.textContent = state ? "VOLTAR AO PAÍS" : "VISÃO GLOBAL";
    back.addEventListener("click", () => (state ? selectCountry(country) : reset()));
    box.append(kind, title, facts, back);
  }

  function listButton(text, meta, active, action) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    if (active) button.className = "is-active";
    const name = document.createElement("span");
    name.textContent = text;
    const em = document.createElement("em");
    em.textContent = meta;
    button.append(name, em);
    button.addEventListener("click", action);
    item.append(button);
    return item;
  }

  function renderList() {
    const list = $("#gl-list");
    list.replaceChildren();
    if (view.selected) {
      const states = statesOf(view.selected);
      $("#gl-list-title").textContent = `DIVISÕES · ${view.selected.name.toUpperCase()}`;
      $("#gl-list-count").textContent = data.states ? String(states.length) : "…";
      for (const state of states) {
        list.append(listButton(state.name, state.code || state.type, state === view.selectedState, () => selectState(state)));
      }
      return;
    }
    $("#gl-list-title").textContent = "PAÍSES";
    $("#gl-list-count").textContent = String(data.countries.length);
    for (const country of data.countries) {
      list.append(listButton(country.name, country.iso2 || country.id, false, () => selectCountry(country)));
    }
  }

  function renderResults(query) {
    const box = $("#gl-results");
    box.replaceChildren();
    const wanted = plain(query);
    if (!wanted || !view.loaded) return [];
    const score = (item) => (plain(item.name).startsWith(wanted) ? 0 : item.search.includes(wanted) ? 1 : 2);
    const countries = data.countries.filter((country) => score(country) < 2).sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name, "pt-BR"));
    const states = [];
    if (data.states) {
      for (const country of data.countries) {
        if (!data.states[country.id]) continue;
        for (const state of data.states[country.id]) {
          const search = plain(`${state.name} ${state.local || ""}`);
          if (search.includes(wanted)) states.push({ state, country, starts: plain(state.name).startsWith(wanted) });
        }
      }
      states.sort((a, b) => Number(b.starts) - Number(a.starts));
    }
    // Cities: the exact name first, then names that start with it; the biggest first within each.
    const cities = [];
    for (const list of [data.places, data.cities]) {
      for (const place of list) {
        if (!place.search.includes(wanted)) continue;
        const exact = plain(place.name) === wanted || plain(place.en) === wanted;
        const starts = exact || plain(place.name).startsWith(wanted) || plain(place.en).startsWith(wanted);
        if (starts) cities.push({ place, rank: exact ? 0 : 1 });
      }
    }
    cities.sort((a, b) => a.rank - b.rank || b.place.pop - a.place.pop);
    const countryName = (code) => data.countries.find((country) => country.id === code)?.name || code;
    const results = [
      ...countries.slice(0, 6).map((country) => ({ label: country.name, meta: "PAÍS", run: () => selectCountry(country) })),
      ...states.slice(0, 8).map(({ state, country }) => ({ label: state.name, meta: country.name, run: () => selectState(state, country) })),
      ...cities.slice(0, 8).map(({ place }) => ({ label: place.name, meta: `${place.state ? `${place.state} · ` : ""}${countryName(place.country)}`, run: () => selectCity(place) })),
    ];
    for (const result of results) box.append(listButton(result.label, result.meta, false, () => {
      result.run();
      box.replaceChildren();
      $("#gl-search").value = "";
    }));
    return results;
  }

  /* ---------- actions ---------- */

  function lockOn() {
    const sound = hud()?.sound;
    if (sound?.select) sound.select();
    else sound?.click();
    window.setTimeout(emitFocus, 0);
  }

  /** What is in focus, for the dossier overlay (map-intel.js): kind, name, ISO country, center, box. */
  function focusDetail() {
    const country = view.selected;
    const state = view.selectedState;
    const city = view.selectedCity;
    const base = { country: country?.iso2 || "", countryName: country?.name || "" };
    if (city) return { ...base, kind: "city", name: city.name, lat: city.lat, lon: city.lon, pop: city.pop || 0, region: city.state || "" };
    if (state) return { ...base, kind: "state", name: state.name, lat: state.label[1], lon: state.label[0], box: state.box };
    if (country) return { ...base, kind: "country", name: country.name, lat: country.label[1], lon: country.label[0], box: country.box, pop: country.pop || 0 };
    return null;
  }

  let lastFocus = "";
  function emitFocus() {
    const detail = focusDetail();
    const key = detail ? `${detail.kind}:${detail.name}:${detail.country}` : "";
    if (key === lastFocus) return;
    lastFocus = key;
    document.dispatchEvent(new CustomEvent("jarvis:map-focus", { detail }));
    // Jarvis knows what the map shows ("o que tem de turismo aqui?"); the phone app sends it through its link.
    if (detail) {
      (window.jarvisFetch || fetch)("/api/ui-state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        view: "map", detail: { foco: detail.name, tipo: { city: "cidade", state: "estado", country: "país" }[detail.kind], pais: detail.countryName },
      }) }).catch(() => {});
    }
  }

  const projected = new Float64Array(3);
  window.jarvisGlobe = {
    /** Screen point (canvas CSS pixels) of a coordinate, and whether it faces the viewer. */
    project(lon, lat) {
      if (!view.width) return null;
      unit(lon, lat, projected, 0);
      tf(projector(), projected, 0);
      return { x: out[1], y: out[2], visible: out[0] > 0.04 };
    },
    get canvas() { return view.canvas; },
    get zoom() { return view.zoom; },
    focus: focusDetail,
    flyTo: (lon, lat, zoom) => flyTo(lon, lat, zoom ?? view.zoom),
  };

  function selectCountry(country, fly = true) {
    view.selected = country;
    view.selectedState = null;
    view.selectedCity = null;
    view.hover = null;
    view.glide = null;
    if (fly) flyTo(country.label[0], country.label[1], fitZoom(country.box));
    renderTarget();
    renderList();
    status(`ALVO: ${country.name.toUpperCase()} · ${country.continent.toUpperCase()}`);
    lockOn();
    loadStates().then(() => {
      if (view.selected === country) {
        renderTarget();
        renderList();
      }
    });
    view.dirty = true;
  }

  function selectState(state, country = state.country) {
    if (!state.shape) statesOf(country);
    view.selected = country;
    view.selectedState = state;
    view.selectedCity = null;
    view.glide = null;
    flyTo(state.label[0], state.label[1], Math.max(fitZoom(state.box), fitZoom(country.box)));
    renderTarget();
    renderList();
    status(`ALVO: ${state.name.toUpperCase()} · ${country.name.toUpperCase()}`);
    lockOn();
    view.dirty = true;
  }

  /** A city: the view flies close (the smaller the city, the closer) and its country lights up. */
  function selectCity(city) {
    const country = data.countries.find((item) => item.id === city.country) || null;
    view.selected = country;
    view.selectedState = null;
    view.selectedCity = city;
    view.glide = null;
    flyTo(city.lon, city.lat, Math.max(view.zoom, city.pop >= 5e6 ? 7 : city.pop >= 1e6 ? 10 : city.pop >= 1e5 ? 15 : 22));
    renderTarget();
    renderList();
    status(`ALVO: ${city.name.toUpperCase()} · ${(country?.name || city.country).toUpperCase()}`);
    lockOn();
    if (country) loadStates();
    view.dirty = true;
  }

  function reset() {
    view.selected = null;
    view.selectedState = null;
    view.selectedCity = null;
    view.glide = null;
    flyTo(view.lon, Math.max(-30, Math.min(30, view.lat)), 1);
    renderTarget();
    renderList();
    status(HELP);
    view.dirty = true;
    emitFocus();
  }

  function setSpin(on) {
    view.spin = on;
    $("#gl-spin")?.setAttribute("aria-pressed", String(on));
  }

  // Spoken orders ("Jarvis, aproxima", "gira o globo", "mais para o norte", "esconde as capitais").
  function control(action) {
    const [verb, layer] = action.split(":");
    const steps = { left: [-28, 0], right: [28, 0], up: [0, 16], down: [0, -16] };
    if (verb === "zoom-in") glideZoom(1.8);
    else if (verb === "zoom-out") glideZoom(1 / 1.8);
    else if (verb === "reset") reset();
    else if (verb === "spin") {
      if (view.selected) reset(); // the globe only turns by itself with nothing in focus
      setSpin(true);
    } else if (verb === "stop") {
      setSpin(false);
      view.velocity = [0, 0];
    } else if (steps[verb]) {
      const [dLon, dLat] = steps[verb];
      flyTo(view.lon + dLon / view.zoom, Math.max(-85, Math.min(85, view.lat + dLat / view.zoom)), view.zoom, 700);
    } else if ((verb === "show" || verb === "hide") && layer in view.layers) {
      view.layers[layer] = verb === "show";
      const box = $(`#gl-layers [data-layer="${layer}"]`);
      if (box) box.checked = view.layers[layer];
    } else {
      return;
    }
    view.dirty = true;
    hud()?.sound.click();
  }

  async function focusQuery(query) {
    if (!view.loaded) {
      view.pending = query;
      return;
    }
    await loadStates();
    let results = renderResults(query);
    if (!results.some((result) => plain(result.label) === plain(query))) { // maybe a city not loaded yet
      await Promise.all(Object.keys(CITY_TIERS).map(loadCities));
      results = renderResults(query);
    }
    $("#gl-results").replaceChildren();
    // The exact name wins over a longer one that contains it ("Salvador" the city, not El Salvador).
    const best = results.find((result) => plain(result.label) === plain(query)) || results[0];
    if (best) {
      best.run();
      ui()?.toast(`Mapa: ${best.label}`);
    } else {
      ui()?.toast(`Não encontrei “${query}” no mapa.`, true);
    }
  }

  /** At once (a pinch follows the fingers): the place under `point` stays under it. */
  function zoomBy(factor, point) {
    const geo = point ? inverse(projector(), point[0], point[1]) : null;
    view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * factor));
    if (point) anchor(geo, point);
    view.flight = null;
    view.glide = null;
    view.dirty = true;
    setSpin(false); // a close look holds still, as in map software (the ⟳ button turns it again)
  }

  /** Eased, like map software: wheel steps add up and the zoom glides around the cursor (or the
   *  center), deeper detail appearing as it goes. */
  function glideZoom(factor, point) {
    point = point || [view.width / 2, view.height / 2];
    if (calm()) {
      zoomBy(factor, point);
      return;
    }
    const from = view.glide ? view.glide.target : view.zoom;
    const target = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, from * factor));
    if (Math.abs(target - from) < 1e-6) return;
    view.glide = { target, point, geo: inverse(projector(), point[0], point[1]) };
    view.flight = null;
    view.velocity = [0, 0];
    view.dirty = true;
    setSpin(false); // the place under the cursor must not drift away while it zooms
    hud()?.sound.zoom?.(factor > 1 ? 1 : -1);
  }

  /** Shift + drag: the rectangle drawn fills the view. */
  function frameBox(box) {
    const [x0, y0] = box.start;
    const [x1, y1] = box.end;
    const width = Math.abs(x1 - x0);
    const height = Math.abs(y1 - y0);
    if (width < 12 || height < 12) return;
    const center = inverse(projector(), (x0 + x1) / 2, (y0 + y1) / 2);
    if (!center) return;
    const factor = Math.min(view.width / width, view.height / height) * 0.9;
    flyTo(center[0], center[1], view.zoom * factor, 900);
    status(`ENQUADRANDO ${latText(center[1])} ${lonText(center[0])}`);
    lockOn();
  }

  /* ---------- input ---------- */

  function local(event) {
    const rect = view.canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  function hoverAt(point) {
    view.cursor = point;
    const where = inverse(projector(), point[0], point[1]);
    $("#gl-cursor").textContent = where ? `${latText(where[1])} ${lonText(where[0])}` : "--";
    const country = where ? pickCountry(where[0], where[1]) : null;
    const state = where && view.selected && country === view.selected && view.zoom >= 1.6 ? pickState(country, where[0], where[1]) : null;
    if (country !== view.hover || state !== view.hoverState) {
      view.hover = country;
      view.hoverState = state;
      view.dirty = true;
    }
    view.canvas.classList.toggle("is-pointing", Boolean(country));
  }

  function pinchState() {
    const [a, b] = [...view.touches.values()];
    return { distance: Math.hypot(a[0] - b[0], a[1] - b[1]), middle: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
  }

  function setupInput() {
    const canvas = view.canvas;
    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId);
      view.touches.set(event.pointerId, local(event));
      if (view.touches.size === 2) { // two fingers: pinch to zoom, not a drag
        view.drag = null;
        view.pinch = pinchState();
        return;
      }
      if (event.shiftKey) { // Shift + drag frames an area
        view.box = { start: local(event), end: local(event) };
        canvas.classList.add("is-framing");
        return;
      }
      view.drag = { start: local(event), last: local(event), moved: 0, time: performance.now() };
      view.flight = null;
      view.glide = null;
      view.velocity = [0, 0];
      canvas.classList.add("is-dragging");
    });
    canvas.addEventListener("pointermove", (event) => {
      const point = local(event);
      if (view.touches.has(event.pointerId)) view.touches.set(event.pointerId, point);
      if (view.pinch && view.touches.size === 2) {
        const now = pinchState();
        zoomBy(now.distance / (view.pinch.distance || now.distance), now.middle);
        view.pinch = now;
        return;
      }
      if (view.box) {
        view.box.end = point;
        view.dirty = true;
        return;
      }
      if (!view.drag) {
        hoverAt(point);
        return;
      }
      const R = baseRadius() * view.zoom;
      const dx = point[0] - view.drag.last[0];
      const dy = point[1] - view.drag.last[1];
      view.drag.last = point;
      view.drag.moved += Math.abs(dx) + Math.abs(dy);
      const step = [dx / R / RAD, dy / R / RAD];
      view.lon -= step[0];
      view.lat = Math.max(-85, Math.min(85, view.lat + step[1]));
      view.velocity = step;
      view.dirty = true;
    });
    const release = (event) => {
      view.touches.delete(event.pointerId);
      if (view.touches.size < 2) view.pinch = null;
      if (view.box) {
        const box = view.box;
        view.box = null;
        canvas.classList.remove("is-framing");
        view.dirty = true;
        frameBox(box);
        return;
      }
      if (!view.drag) return;
      const drag = view.drag;
      view.drag = null;
      canvas.classList.remove("is-dragging");
      if (drag.moved < 5) {
        view.velocity = [0, 0];
        const [px, py] = drag.start;
        const near = view.drawn.find(([x, y]) => Math.hypot(x - px, y - py) <= 7); // a city's marker
        const where = inverse(projector(), px, py);
        const country = where ? pickCountry(where[0], where[1]) : null;
        if (near && view.zoom >= 2) {
          selectCity(near[2]);
        } else if (country && country === view.selected && view.zoom >= 1.6) {
          const state = pickState(country, where[0], where[1]);
          if (state) selectState(state, country);
          else selectCountry(country);
        } else if (country) {
          selectCountry(country);
        }
      } else if (calm()) {
        view.velocity = [0, 0]; // no inertia with reduced motion
      }
      hoverAt(local(event));
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("pointerleave", () => {
      view.cursor = null;
      view.hover = null;
      view.hoverState = null;
      view.dirty = true;
      $("#gl-cursor").textContent = "--";
    });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      // Mouse wheels send big steps, touchpads many small ones (pinch arrives as Ctrl + wheel):
      // the zoom follows how far the wheel moved, around the cursor.
      const scale = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 400 : 1;
      const delta = Math.max(-300, Math.min(300, event.deltaY * scale));
      glideZoom(Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0022)), local(event));
    }, { passive: false });
    canvas.addEventListener("dblclick", (event) => {
      glideZoom(event.shiftKey ? 1 / 2.2 : 2.2, local(event)); // closer on the point, as in map software
    });

    $("#gl-zoom-in").addEventListener("click", () => glideZoom(1.8));
    $("#gl-zoom-out").addEventListener("click", () => glideZoom(1 / 1.8));
    $("#gl-reset").addEventListener("click", reset);
    $("#gl-spin").addEventListener("click", () => setSpin(!view.spin));
    $("#gl-layers").addEventListener("change", (event) => {
      const layer = event.target.dataset.layer;
      if (layer) {
        view.layers[layer] = event.target.checked;
        view.dirty = true;
      }
    });
    const search = $("#gl-search");
    search.addEventListener("input", () => {
      if (search.value.trim().length < 2) {
        $("#gl-results").replaceChildren();
        return;
      }
      renderResults(search.value); // what is loaded now; the cities join as they arrive
      Promise.all([loadStates(), ...Object.keys(CITY_TIERS).map(loadCities)]).then(() => {
        if (search.value.trim().length >= 2) renderResults(search.value);
      });
    });
    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        focusQuery(search.value);
        search.value = "";
      } else if (event.key === "Escape") {
        search.value = "";
        $("#gl-results").replaceChildren();
      }
    });
    // Capture phase: on the map, Esc first steps out of the focus before app.js goes home.
    window.addEventListener("keydown", (event) => {
      if (document.body.dataset.view !== "map") return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const moves = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, 6], ArrowDown: [0, -6] };
      if (event.key === "Escape" && (view.selected || view.zoom > 1.05)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if ((view.selectedState || view.selectedCity) && view.selected) selectCountry(view.selected);
        else reset();
      } else if (moves[event.key]) {
        event.preventDefault();
        const [dLon, dLat] = moves[event.key];
        flyTo(view.lon + dLon / view.zoom, Math.max(-85, Math.min(85, view.lat + dLat / view.zoom)), view.zoom, 400);
      } else if (event.key === "+" || event.key === "=") {
        glideZoom(1.6, view.cursor);
      } else if (event.key === "-") {
        glideZoom(1 / 1.6, view.cursor);
      }
    }, true);
  }

  function resize() {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    view.width = view.canvas.clientWidth;
    view.height = view.canvas.clientHeight;
    view.canvas.width = Math.floor(view.width * ratio);
    view.canvas.height = Math.floor(view.height * ratio);
    view.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    view.dirty = true;
  }

  function init() {
    view.canvas = $("#gl-canvas");
    view.ctx = view.canvas?.getContext("2d");
    if (!view.ctx) return;
    setupInput();
    window.addEventListener("resize", () => {
      if (document.body.dataset.view === "map") resize();
    });
    document.addEventListener("jarvis:command", (event) => {
      if (event.detail?.command === "map-focus") focusQuery(event.detail.query || "");
      else if (event.detail?.command === "map-control") control(String(event.detail.query || ""));
    });
    const activate = (current) => {
      if (current !== "map") {
        stop();
        return;
      }
      window.requestAnimationFrame(() => {
        resize();
        start();
      });
      load();
    };
    document.addEventListener("jarvis:view", (event) => activate(event.detail.view));
    activate(document.body.dataset.view);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
