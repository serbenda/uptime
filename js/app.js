"use strict";

// Data lives on the repo's `data` branch. Locally (or with ?local) it's read from data/.
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname) || new URLSearchParams(location.search).has("local");
const BASE = LOCAL ? "data/" : document.querySelector('meta[name="uptime-data"]').content;
const REFRESH_MS = 5 * 60 * 1000;
const STALE_MIN = 40;               // data older than this gets a warning
const DAYS = 90;
const MOTION = !matchMedia("(prefers-reduced-motion: reduce)").matches;

const LEVELS = ["operational", "maintenance", "degraded", "partial", "major"];
const RANK = Object.fromEntries(LEVELS.map((n, i) => [n, i]));
RANK.unknown = -1;
RANK.advisory = 0.5;
const COLOR = { operational: "43D17F", maintenance: "5AA9FF", degraded: "F2C230", partial: "FF8A2A", major: "FF4D4D", unknown: "6B7885" };

const $ = (s) => document.querySelector(s);
const state = {
  data: null,
  history: {},
  log: {},
  map: null,
  language: initialLanguage(),
  category: "all",
  query: "",
  failedOnly: false,
  open: new Set(),
  fullJournal: false,
  selectedPlace: null,
  pinned: new Set(readLocal(STORAGE.pinned, [])),
  previous: null,  // each provider's level on the previous load, for notifications
  firstLoad: true,
};

let T = LANGUAGES[state.language];
const levelText = (n) => T.levels[n] ?? n;

// ------------------------------------------------------------ helpers

// keys: a list from STORAGE in i18n.js
function readLocal(keys, fallback) {
  try {
    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v != null) return JSON.parse(v) ?? fallback;
    }
  } catch { /* no storage */ }
  return fallback;
}
function saveLocal(keys, value) {
  try { localStorage.setItem(keys[0], JSON.stringify(value)); } catch { /* no storage */ }
}

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "level") n.dataset.level = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false && c !== "") n.append(c);
  return n;
}

const SVG = "http://www.w3.org/2000/svg";
function svg(tag, attributes = {}) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attributes)) if (v != null) n.setAttribute(k, v);
  return n;
}

function ago(iso) {
  if (!iso) return "";
  const rtf = new Intl.RelativeTimeFormat(T.html, { numeric: "auto" });
  const s = (new Date(iso) - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 60) return T.just_now;
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 45) return rtf.format(Math.round(s / 86400), "day");
  return rtf.format(Math.round(s / (86400 * 30)), "month");
}

// "02 Nov 09:11", in the viewer's local time
const pad2 = (n) => String(n).padStart(2, "0");
function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${pad2(d.getDate())} ${T.months[d.getMonth()]} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
const shortDay = (ymd) => `${Number(ymd.slice(8))} ${T.months[Number(ymd.slice(5, 7)) - 1]}`;

function duration(from, to) {
  const min = Math.max(1, Math.round((new Date(to) - new Date(from)) / 60000));
  if (min < 60) return `${min} ${T.dur.min}`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 48) return m ? `${h} ${T.dur.h} ${m} ${T.dur.min}` : `${h} ${T.dur.h}`;
  return `${Math.round(h / 24)} ${T.dur.days}`;
}

function list(names) {
  if (names.length <= 1) return names.join("");
  return names.slice(0, -1).join(", ") + ` ${T.and} ` + names.at(-1);
}

const isFailing = (p) => RANK[p.status] >= RANK.degraded;
const percent = (n) => `${n >= 99.995 ? "100" : n.toFixed(2)}%`;
const categoryName = (id) => T.categories[id] ?? state.data?.categories?.[id] ?? id;
const placeName = (l) => l[T.html] || l.en;
const phase = (f) => (f && T.phases[f]) || f || "";

// ------------------------------------------------------------ language

function applyLanguage(language) {
  state.language = language;
  T = LANGUAGES[language];
  document.documentElement.lang = T.html;
  $("#description").content = T.description;
  for (const n of document.querySelectorAll("[data-i18n]")) {
    const v = T[n.dataset.i18n];
    if (typeof v === "string") n.textContent = v;
  }
  for (const n of document.querySelectorAll("[data-i18n-aria]")) n.setAttribute("aria-label", T[n.dataset.i18nAria]);
  for (const n of document.querySelectorAll("[data-i18n-ph]")) n.placeholder = T[n.dataset.i18nPh];
  for (const b of document.querySelectorAll("[data-lang]")) b.setAttribute("aria-pressed", String(b.dataset.lang === language));
  renderLegend();
  if (state.data) render();
}

function chooseLanguage(language) {
  if (!(language in LANGUAGES)) return false;
  try { localStorage.setItem(STORAGE.language[0], language); } catch { /* no storage */ }
  const url = new URL(location.href);
  url.searchParams.delete("lang");
  history.replaceState(null, "", url);
  applyLanguage(language);
  return true;
}

for (const b of document.querySelectorAll("[data-lang]")) {
  b.addEventListener("click", () => chooseLanguage(b.dataset.lang));
}

function renderLegend() {
  $("#legend").replaceChildren(...["operational", "maintenance", "degraded", "partial", "major", "unknown"].map((n) =>
    el("div", {}, el("dt", {}, el("span", { class: "led", level: n })), el("dd", {}, levelText(n)))));
}

// ------------------------------------------------------------ loading

async function readJSON(name, base = BASE) {
  const r = await fetch(`${base}${name}?t=${Math.floor(Date.now() / 60000)}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}

async function load() {
  try {
    const [data, history, log] = await Promise.all([
      readJSON("status.json"),
      readJSON("history.json").catch(() => ({})),
      readJSON("incidents.json").catch(() => ({})),
    ]);
    const map = state.map ?? await readJSON("map.json", "data/").catch(() => null);
    notifyChanges(data);
    Object.assign(state, { data, history, log, map });
    render();
    if (state.firstLoad) { state.firstLoad = false; typeConsole(); }
  } catch (e) {
    console.error(e);
    if (!state.data) {
      $("#verdict").dataset.level = "unknown";
      $("#mark").textContent = "[ERROR ]";
      $("#headline").textContent = T.error_headline;
      $("#subheadline").textContent = T.error_sub;
    }
    $("#updated").textContent = T.offline;
  }
}

// ------------------------------------------------------------ rendering

function render() {
  renderConsole();
  renderMap();
  renderJournal();
  renderFilters();
  renderRacks();
  renderMaintenance();
  renderRecent();
  renderUpdated();
  renderPSU();
  updateNotifyButton();
}

function renderUpdated() {
  const iso = state.data?.updated;
  if (!iso) return;
  const n = $("#updated");
  const stale = (Date.now() - new Date(iso)) / 60000 > STALE_MIN;
  n.textContent = stale ? T.late(ago(iso)) : T.updated(ago(iso));
  n.title = when(iso);
  n.classList.toggle("stale", stale);
}

// A real `uptime`: time, days of history, services and a "load average" of failures
function uptimeLine() {
  const providers = state.data.providers;
  const now = new Date();
  const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  const days = Math.max(0, ...Object.values(state.history).map((h) => Object.keys(h).length));
  const average = (n) => {
    const since = new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    let total = 0, bad = 0;
    for (const h of Object.values(state.history)) {
      for (const [d, v] of Object.entries(h)) {
        if (d < since) continue;
        total++;
        if (RANK[v.worst] >= RANK.partial) bad++;
      }
    }
    return total ? bad / total : 0;
  };
  const failing = providers.filter(isFailing).length;
  const load = [failing / providers.length, average(7), average(30)].map((x) => x.toFixed(2)).join(", ");
  return T.uptime_line({ time, days, total: providers.length, failing, load });
}

function renderConsole() {
  const providers = state.data.providers;
  const failing = providers.filter(isFailing).sort((a, b) => RANK[b.status] - RANK[a.status] || a.name.localeCompare(b.name, T.html));
  const maint = providers.filter((p) => p.status === "maintenance");
  const noData = providers.filter((p) => p.status === "unknown");
  const level = failing[0]?.status ?? (maint.length ? "maintenance" : "operational");

  const uptime = $("#uptime-line");
  uptime.textContent = uptimeLine();
  uptime.title = T.load_title;

  $("#status-command").textContent = failing.length ? "systemctl --failed" : "systemctl status providers";
  $("#verdict").dataset.level = level;
  $("#logo").dataset.level = level;      // the LED over the logo's i takes the colour of the worst status
  $("#mark").textContent = failing.length ? "[FAILED]" : "[  OK  ]";
  $("#headline").textContent = !failing.length ? T.all_good
    : failing.length <= 3 ? T.having_problems(list(failing.map((p) => p.name)), failing.length)
    : T.many_problems(failing.length);

  const s = T.summary;
  const parts = [`${providers.length} ${s.total}`, `${providers.length - failing.length - maint.length - noData.length} ${s.ok}`];
  if (maint.length) parts.push(`${maint.length} ${s.maint}`);
  if (failing.length) parts.push(`${failing.length} ${s.failing}`);
  if (noData.length) parts.push(`${noData.length} ${s.no_data}`);
  $("#subheadline").textContent = parts.join(", ");

  $("#failures").replaceChildren(...failing.map((p) => {
    const i = p.incidents.filter((x) => x.impact !== "advisory").sort((a, b) => (RANK[b.impact] ?? 0) - (RANK[a.impact] ?? 0))[0];
    const affected = p.affected ?? p.components.length;
    const text = i?.title || (affected ? T.components_affected(affected, p.total_components || affected) : p.description);
    return el("li", { level: p.status },
      el("span", { "aria-hidden": "true" }, "●"),
      el("a", { href: `#p=${p.id}`, onclick: (e) => { e.preventDefault(); goTo(p.id); } }, p.name),
      el("span", { class: "failure-level" }, levelText(p.status)),
      el("span", { class: "failure-text", lang: "en" }, text || ""));
  }));

  document.title = failing.length ? `(${failing.length}) uptime` : "uptime";
  $("#favicon").href = "data:image/svg+xml," + encodeURIComponent(
    // The same drawing as docs/logo/favicon.svg, with the LED in the colour of the worst status
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect x='1' y='6' width='30' height='20' rx='4' fill='#18212A'/>` +
    `<rect x='3.5' y='8.5' width='25' height='15' rx='2.5' fill='#253241'/><circle cx='9.5' cy='16' r='3.6' fill='#${COLOR[level]}'/>` +
    `<rect x='15' y='15' width='2.6' height='5' rx='.8' fill='#2E9A60'/><rect x='18.6' y='13' width='2.6' height='7' rx='.8' fill='#F2C230'/>` +
    `<rect x='22.2' y='11' width='2.6' height='9' rx='.8' fill='#FF4D4D'/></svg>`);
}

// The first time, the console appears line by line, as if it were being typed
function typeConsole() {
  const body = $("#console");
  if (!MOTION) return;
  const lines = [...body.children];
  body.classList.add("typing");
  lines.forEach((n, i) => setTimeout(() => {
    n.classList.add("visible");
    if (i === lines.length - 1) body.classList.remove("typing");
  }, 90 + i * 140));
}

// ------------------------------------------------------------ map

// Equirectangular, like the grid in data/map.json
function project(lat, lon) {
  const m = state.map;
  return [(lon + 180) / m.step, (m.lat_max - lat) / m.step];
}
function unproject(x, y) {
  const m = state.map;
  return [m.lat_max - y * m.step, x * m.step - 180];
}

let landDrawn = false;
function drawLand() {
  if (landDrawn || !state.map) return;
  landDrawn = true;
  const { rows, columns } = state.map;
  let d = "";
  rows.forEach((hex, y) => {
    const offset = y % 2 ? 0.5 : 0;
    for (let i = 0; i < hex.length; i++) {
      const nibble = parseInt(hex[i], 16);
      for (let b = 0; b < 4; b++) {
        if (nibble & (8 >> b)) {
          const x = i * 4 + b;
          if (x < columns) d += `M${x + offset} ${y}h0`;
        }
      }
    }
  });
  $("#map-land").setAttribute("d", d);

  // Grid: equator, tropics and the Greenwich meridian
  const g = $("#map-grid");
  for (const [lat, cls] of [[0, "equator"], [23.44, "tropic"], [-23.44, "tropic"]]) {
    const [, y] = project(lat, 0);
    g.append(svg("line", { x1: 0, x2: columns, y1: y, y2: y, class: cls }));
  }
  const [x0] = project(0, 0);
  g.append(svg("line", { x1: x0, x2: x0, y1: 0, y2: rows.length, class: "tropic" }));
}

// Groups every provider's dots by place
function currentPlaces() {
  const groups = new Map();
  for (const p of state.data.providers) {
    for (const l of p.places || []) {
      const g = groups.get(l.id) ?? { place: l, level: "operational", providers: [] };
      g.level = RANK[l.level] > RANK[g.level] ? l.level : g.level;
      g.providers.push({ p, level: l.level, n: l.n, examples: l.examples || [] });
      groups.set(l.id, g);
    }
  }
  const all = [...groups.values()];
  for (const g of all) g.providers.sort((a, b) => RANK[b.level] - RANK[a.level]);
  return all.sort((a, b) => RANK[b.level] - RANK[a.level] || b.providers.length - a.providers.length ||
    placeName(a.place).localeCompare(placeName(b.place), T.html));
}

function renderMap() {
  if (!state.map) { $("#map-block").hidden = true; return; }
  $("#map-block").hidden = false;
  drawLand();
  const groups = currentPlaces();
  state.groups = groups;
  if (!groups.some((g) => g.place.id === state.selectedPlace)) state.selectedPlace = null;

  // Dots: least to most severe, so the worst ends up on top
  const layer = $("#map-dots");
  layer.replaceChildren(...[...groups].reverse().map((g) => {
    const [x, y] = project(g.place.lat, g.place.lon);
    const r = 0.9 + Math.min(g.providers.reduce((s, v) => s + v.n, 0), 8) * 0.12;
    const label = T.dot_aria(placeName(g.place), levelText(g.level), g.providers.length);
    const dot = svg("g", {
      class: "dot",
      "data-level": g.level, "data-id": g.place.id, tabindex: "0", role: "button", "aria-label": label,
      transform: `translate(${x.toFixed(2)} ${y.toFixed(2)})`,
    });
    dot.append(svg("circle", { class: "halo", r: (r * 2.6).toFixed(2) }), svg("circle", { class: "core", r: r.toFixed(2) }));
    dot.addEventListener("click", () => selectPlace(g.place.id));
    dot.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectPlace(g.place.id); } });
    dot.addEventListener("pointerenter", () => showTip(g, dot));
    dot.addEventListener("pointerleave", hideTip);
    dot.addEventListener("focus", () => showTip(g, dot));
    dot.addEventListener("blur", hideTip);
    return dot;
  }));

  // Side list
  const nProviders = new Set(groups.flatMap((g) => g.providers.map((v) => v.p.id))).size;
  $("#places-summary").textContent = groups.length ? T.places_summary(groups.length, nProviders) : T.no_located;
  $("#places").replaceChildren(...groups.map((g) => el("li", { level: g.level, "data-id": g.place.id },
    el("button", { type: "button", "aria-pressed": "false", onclick: () => selectPlace(g.place.id),
      onpointerenter: () => highlight(g.place.id, true), onpointerleave: () => highlight(g.place.id, false) },
      el("span", { class: "led" }),
      el("span", { class: "place-name" }, placeName(g.place)),
      el("span", { class: "place-who" }, g.providers.map((v) => v.p.name).join(", "))))));

  const global = state.data.providers.filter((p) => isFailing(p) && !(p.places || []).length);
  const nGlobal = $("#places-global");
  nGlobal.hidden = !global.length;
  nGlobal.textContent = global.length ? T.unlocated(list(global.map((p) => p.name))) : "";

  updateSelection();
}

// Selecting a place doesn't redraw the map, so keyboard focus isn't lost
function updateSelection() {
  const id = state.selectedPlace;
  for (const n of document.querySelectorAll("#map-dots .dot")) n.classList.toggle("selected", n.dataset.id === id);
  for (const n of document.querySelectorAll("#places li")) {
    n.classList.toggle("selected", n.dataset.id === id);
    n.querySelector("button").setAttribute("aria-pressed", String(n.dataset.id === id));
  }
  renderPlaceDetail((state.groups || []).find((g) => g.place.id === id));
}

function highlight(id, on) {
  document.querySelector(`#map-dots [data-id="${CSS.escape(id)}"]`)?.classList.toggle("highlighted", on);
}

function selectPlace(id) {
  state.selectedPlace = state.selectedPlace === id ? null : id;
  updateSelection();
}

function renderPlaceDetail(g) {
  const box = $("#place-detail");
  box.hidden = !g;
  if (!g) return;
  const l = g.place;
  const country = l[`country_${T.html}`];
  box.tabIndex = -1;
  box.dataset.level = g.level;
  box.replaceChildren(
    el("div", { class: "detail-header" },
      el("p", { class: "command" }, el("span", { class: "prompt" }, "$ "), `geoiplookup ${l.id.replace(/^[@Z]:?/, "")}`),
      el("button", { type: "button", class: "close", onclick: () => selectPlace(l.id) }, T.close)),
    el("p", { class: "detail-place" }, placeName(l), country && country !== placeName(l) ? el("span", {}, `, ${country}`) : "",
      el("span", { class: "detail-coord" }, ` ${coordinates(l.lat, l.lon)}`)),
    el("ul", { class: "detail-providers" }, g.providers.map((v) => el("li", { level: v.level },
      el("div", { class: "item" },
        el("span", {}, "●"),
        el("a", { href: `#p=${v.p.id}`, onclick: (e) => { e.preventDefault(); goTo(v.p.id); } }, v.p.name),
        el("span", { class: "level" }, levelText(v.level))),
      el("ul", { class: "examples" }, v.examples.map((x) => el("li", { lang: "en" }, x.t)))))));
}

function coordinates(lat, lon) {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : (T.html === "es" ? "O" : "W")}`;
}

function showTip(g, dot) {
  const tip = $("#tip");
  const box = $("#screen").getBoundingClientRect();
  const r = dot.getBoundingClientRect();
  tip.replaceChildren(
    el("p", { class: "tip-place" }, placeName(g.place)),
    ...g.providers.slice(0, 5).map((v) => el("p", { class: "tip-row", level: v.level },
      el("span", {}, "● "), v.p.name, el("span", { class: "level" }, ` ${levelText(v.level)}`))));
  tip.hidden = false;
  const x = r.left + r.width / 2 - box.left;
  const y = r.top - box.top;
  tip.style.left = `${Math.min(Math.max(x, 90), box.width - 90)}px`;
  tip.style.top = `${y}px`;
  tip.classList.toggle("below", y < 70);
}
function hideTip() { $("#tip").hidden = true; }

$("#screen").addEventListener("pointermove", (e) => {
  if (!state.map) return;
  const map = $("#map");
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(map.getScreenCTM().inverse());
  const [lat, lon] = unproject(p.x, p.y);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
  $("#coord").textContent = coordinates(lat, lon);
});

// ------------------------------------------------------------ journal

function renderJournal() {
  const rows = state.data.providers.flatMap((p) => p.incidents.map((i) => ({ p, i })));
  rows.sort((a, b) => (RANK[b.i.impact] ?? 0) - (RANK[a.i.impact] ?? 0) ||
    String(b.i.updated || b.i.started).localeCompare(String(a.i.updated || a.i.started)));
  $("#incidents-block").hidden = !rows.length;
  const LIMIT = 8;
  const shown = state.fullJournal ? rows : rows.slice(0, LIMIT);
  const rest = rows.length - shown.length;
  $("#incidents").replaceChildren(...shown.map(({ p, i }) => el("li", { level: i.impact },
    el("details", {},
      el("summary", {},
        el("span", { class: "j-time" }, when(i.started || i.updated)),
        el("span", { class: "j-who" }, p.id),
        el("span", { class: "j-level" }, levelText(i.impact)),
        el("span", { class: "j-title", lang: "en" }, i.title || T.untitled)),
      el("div", { class: "j-detail" },
        el("p", {}, [phase(i.phase), i.started && T.started(ago(i.started)), i.updated && T.updated_ago(ago(i.updated)),
          i.affects?.length && T.affects(list(i.affects))].filter(Boolean).join(", ")),
        i.message && el("p", { lang: "en" }, i.message),
        el("p", {}, el("a", { href: i.link, target: "_blank", rel: "noopener" }, T.view_on(p.name))))))),
    rest > 0 && el("li", {}, el("button", { type: "button", class: "more",
      onclick: () => { state.fullJournal = true; renderJournal(); } }, T.more_entries(rest))));
}

// ------------------------------------------------------------ racks

function renderFilters() {
  const ids = ["all", ...Object.keys(state.data.categories)];
  $("#categories").replaceChildren(...ids.map((id) =>
    el("button", {
      type: "button",
      class: "flag",
      title: id === "all" ? null : categoryName(id),
      "aria-pressed": String(state.category === id),
      onclick: () => { state.category = id; renderFilters(); renderRacks(); },
    }, T.flags[id] ?? `--${id}`)));
}

function visible() {
  const q = state.query.trim().toLowerCase();
  return state.data.providers.filter((p) =>
    (state.category === "all" || p.category === state.category) &&
    (!state.failedOnly || isFailing(p) || p.status === "maintenance" || p.status === "unknown") &&
    (!q || p.name.toLowerCase().includes(q) || p.id.includes(q)));
}

function renderRacks() {
  const shown = visible();
  const racks = [];
  const pinned = shown.filter((p) => state.pinned.has(p.id));
  if (pinned.length) racks.push([T.pinned, pinned]);
  for (const id of Object.keys(state.data.categories)) {
    const rest = shown.filter((p) => p.category === id && !state.pinned.has(p.id));
    if (rest.length) racks.push([categoryName(id), rest]);
  }
  const order = (a, b) => RANK[b.status] - RANK[a.status] || a.name.localeCompare(b.name, T.html);
  const nodes = racks.map(([name, ps]) => {
    ps.sort(order);
    const failing = ps.filter(isFailing).length;
    const worst = ps[0]?.status ?? "operational";
    return el("section", { class: "rack", "aria-label": `${T.rack} ${name}` },
      el("header", { class: "rack-plate", level: worst },
        el("h3", { class: "rack-name" }, name),
        el("span", { class: "rack-count" }, T.servers(ps.length), failing ? [", ", el("b", {}, T.failing_count(failing))] : "")),
      el("div", { class: "rack-bay" }, ps.map((p, i) => server(p, ps.length - i))));
  });
  if (!nodes.length) nodes.push(el("p", { class: "no-results" }, state.failedOnly ? T.grep_no_failing : T.grep_no_match));
  $("#racks").replaceChildren(...nodes);
}

function recentDays() {
  const days = [];
  const today = new Date();
  for (let i = DAYS - 1; i >= 0; i--) {
    days.push(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)).toISOString().slice(0, 10));
  }
  return days;
}

function availability(id) {
  let samples = 0, down = 0, badDays = 0;
  for (const v of Object.values(state.history[id] || {})) {
    samples += v.samples; down += v.down;
    if (RANK[v.worst] >= RANK.partial) badDays++;
  }
  return { pct: samples ? (1 - down / samples) * 100 : null, badDays, days: Object.keys(state.history[id] || {}).length };
}

function server(p, unit) {
  const node = $("#server-template").content.firstElementChild.cloneNode(true);
  node.dataset.level = p.status;
  node.id = `srv-${p.id}`;
  if (state.pinned.has(p.id)) node.dataset.pinned = "";
  node.querySelector(".u").textContent = `U${unit}`;
  node.querySelector(".name").textContent = p.name;
  const n = p.incidents.filter((i) => i.impact !== "advisory").length;
  node.querySelector(".status").textContent = levelText(p.status) + (n > 1 ? ` ×${n}` : "");

  // 90 days
  const hist = state.history[p.id] || {};
  const bars = node.querySelector(".history-bars");
  for (const d of recentDays()) {
    const h = hist[d];
    const bar = document.createElement("span");
    if (h) {
      bar.dataset.level = h.worst;
      const pct = h.samples ? ((1 - h.down / h.samples) * 100).toFixed(1) : "100";
      bar.title = `${shortDay(d)}: ${h.worst === "operational" ? T.day_ok : T.day_worst(levelText(h.worst))} (${T.day_available(pct)})`;
    } else {
      bar.title = `${shortDay(d)}: ${T.day_no_data}`;
    }
    bars.append(bar);
  }
  const { pct } = availability(p.id);
  const lcd = node.querySelector(".lcd");
  lcd.textContent = pct == null ? "--.--%" : percent(pct);
  lcd.classList.toggle("empty", pct == null);
  lcd.title = T.lcd_title;
  bars.setAttribute("aria-label", pct == null ? T.no_history : T.bars_aria(percent(pct)));

  // Pin to top
  const pin = node.querySelector(".pin");
  const isPinned = state.pinned.has(p.id);
  pin.setAttribute("aria-pressed", String(isPinned));
  pin.title = isPinned ? T.unpin : T.pin_title;
  node.querySelector(".pin-label").textContent = T.pin;
  pin.addEventListener("click", () => {
    state.pinned.has(p.id) ? state.pinned.delete(p.id) : state.pinned.add(p.id);
    saveLocal(STORAGE.pinned, [...state.pinned]);
    renderRacks();
    updateNotifyButton();
    document.querySelector(`#srv-${p.id} .pin`)?.focus();
  });

  // Drawer
  const open = node.querySelector(".open");
  const drawer = node.querySelector(".drawer");
  const toggle = (force) => {
    const isOpen = force ?? drawer.hidden;
    drawer.hidden = !isOpen;
    open.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) { state.open.add(p.id); drawer.replaceChildren(...drawerContent(p)); }
    else state.open.delete(p.id);
  };
  open.addEventListener("click", () => {
    toggle();
    history.replaceState(null, "", state.open.has(p.id) ? `#p=${p.id}` : location.pathname + location.search);
  });
  if (state.open.has(p.id)) toggle(true);
  return node;
}

function row(key, ...value) {
  return el("p", { class: "key-row" }, el("span", { class: "key" }, key), el("span", {}, ...value));
}

function drawerContent(p) {
  const f = p.source || {};
  const affected = p.affected ?? p.components.length;
  const host = (() => { try { return new URL(p.web).host; } catch { return p.web; } })();
  const parts = [el("p", { class: "command" }, el("span", { class: "prompt" }, "$ "), `status ${p.id}`)];

  parts.push(row(T.k_status, el("span", { class: "level", level: p.status }, `● ${levelText(p.status)}`),
    p.description ? el("span", { lang: "en" }, `  "${p.description}"`) : ""));
  parts.push(row(T.k_source, host, ", ",
    f.ok ? T.responded(ago(f.checked)) : el("span", { class: "error" }, T.not_responding(f.error, f.last_ok && ago(f.last_ok)))));

  const { pct, badDays, days } = availability(p.id);
  if (pct != null) parts.push(row(T.k_90, T.availability(percent(pct), badDays, days)));

  if (p.total_components || p.components.length) {
    const summary = affected ? T.affected_of(affected, p.total_components || affected) : T.all_ok(p.total_components);
    parts.push(row(T.k_components, summary, p.limited_scope ? el("span", { class: "key" }, T.limited_scope) : ""));
    if (p.components.length) {
      parts.push(el("ul", { class: "indent" }, p.components.map((c) =>
        el("li", { class: "item", level: c.status }, el("span", {}, "●"), el("span", { lang: "en" }, c.name), el("span", { class: "level" }, levelText(c.status))))));
      if (affected > p.components.length) parts.push(el("p", { class: "indent key" }, T.and_more(affected - p.components.length)));
    }
  }

  if (p.incidents.length) {
    parts.push(el("p", { class: "block key" }, T.k_incidents));
    parts.push(el("ul", { class: "indent" }, p.incidents.map((i) => el("li", { level: i.impact },
      el("div", { class: "item" }, el("span", {}, "●"),
        el("a", { href: i.link, target: "_blank", rel: "noopener", lang: "en" }, i.title),
        el("span", { class: "level" }, levelText(i.impact))),
      el("p", { class: "indent key" }, [phase(i.phase), i.started && T.since(when(i.started)), i.updated && T.updated_ago(ago(i.updated))].filter(Boolean).join(", ")),
      i.message && el("p", { class: "message", lang: "en" }, i.message)))));
  }

  if (p.maintenance.length) {
    parts.push(el("p", { class: "block key" }, T.k_maintenance));
    parts.push(el("ul", { class: "indent" }, p.maintenance.map((m) => el("li", { class: "item", level: "maintenance" },
      el("span", {}, m.in_progress ? "●" : "○"),
      el("a", { href: m.link, target: "_blank", rel: "noopener", lang: "en" }, m.title),
      el("span", { class: "key" }, m.in_progress ? T.in_progress : when(m.start))))));
  }

  parts.push(el("p", { class: "block" }, el("a", { class: "official-link", href: p.web, target: "_blank", rel: "noopener" }, T.open_host(host))));
  return parts;
}

// ------------------------------------------------------------ maintenance, history and PSU

function renderMaintenance() {
  const rows = state.data.providers.flatMap((p) => p.maintenance.map((m) => ({ p, m })))
    .sort((a, b) => Number(b.m.in_progress) - Number(a.m.in_progress) || String(a.m.start).localeCompare(String(b.m.start)));
  $("#maintenance-block").hidden = !rows.length;
  // At most 3 per provider: Cloudflare, for one, schedules dozens of data centres at once
  const PER_PROVIDER = 3;
  const seen = {}, hidden = {};
  const nodes = [];
  for (const { p, m } of rows) {
    seen[p.id] = (seen[p.id] || 0) + 1;
    if (seen[p.id] > PER_PROVIDER) { hidden[p.id] = (hidden[p.id] || 0) + 1; continue; }
    nodes.push(el("li", { class: m.in_progress ? "now" : null },
      el("span", { class: "t-when" }, m.in_progress ? T.in_progress : when(m.start) || T.no_date),
      el("span", { class: "t-what" }, el("span", { class: "t-who" }, p.id),
        el("a", { href: m.link, target: "_blank", rel: "noopener", lang: "en" }, m.title))));
  }
  for (const [id, n] of Object.entries(hidden)) {
    nodes.push(el("li", {}, el("span", { class: "t-when" }, "..."),
      el("span", { class: "t-what t-rest" }, el("a", { href: `#p=${id}`, onclick: (e) => { e.preventDefault(); goTo(id); } }, T.more_maintenance(id, n)))));
  }
  $("#maintenance").replaceChildren(...nodes);
}

function renderRecent() {
  const ids = new Set(state.data.providers.map((p) => p.id));
  const rows = Object.values(state.log)
    .filter((r) => ids.has(r.provider) && r.impact !== "advisory")
    .sort((a, b) => String(b.started).localeCompare(String(a.started)))
    .slice(0, 60);
  $("#recent-block").hidden = !rows.length;
  $("#recent").replaceChildren(...rows.map((r) => el("li", { level: r.impact },
    el("span", { class: "t-when" }, when(r.started)),
    el("span", { class: "t-what" }, el("span", { class: "t-who" }, r.provider),
      el("a", { href: r.link, target: "_blank", rel: "noopener", lang: "en" }, r.title), " ",
      el("span", { class: "t-duration" }, r.ended ? `(${duration(r.started, r.ended)})` : T.still_open)))));
}

function renderPSU() {
  $("#psu-output").textContent = T.psu_output_value(state.data.providers.length);
}

// ------------------------------------------------------------ navigation and notifications

function goTo(id) {
  state.open.add(id);
  if (!visible().some((p) => p.id === id)) {
    state.category = "all"; state.query = ""; state.failedOnly = false;
    $("#search").value = ""; $("#failed-only").checked = false;
    renderFilters();
  }
  renderRacks();
  history.replaceState(null, "", `#p=${id}`);
  const node = document.getElementById(`srv-${id}`);
  if (node) {
    node.scrollIntoView({ behavior: MOTION ? "smooth" : "auto", block: "center" });
    node.querySelector(".open").focus({ preventScroll: true });
  }
}

function updateNotifyButton() {
  $("#notify").hidden = !("Notification" in window) || !state.pinned.size || Notification.permission === "granted";
}

function notifyChanges(data) {
  const current = Object.fromEntries(data.providers.map((p) => [p.id, p.status]));
  const before = state.previous;
  state.previous = current;
  if (!before || !("Notification" in window) || Notification.permission !== "granted") return;
  for (const p of data.providers) {
    if (!state.pinned.has(p.id) || !(p.id in before)) continue;
    const was = RANK[before[p.id]] ?? -1, now = RANK[p.status];
    if (now >= RANK.degraded && now > was) {
      new Notification(T.notify_down(p.name, levelText(p.status)), { body: p.incidents[0]?.title || p.description || "", tag: `uptime-${p.id}` });
    } else if (was >= RANK.degraded && now < RANK.degraded) {
      new Notification(T.notify_up(p.name), { tag: `uptime-${p.id}` });
    }
  }
}

$("#notify").addEventListener("click", async () => {
  const permission = await Notification.requestPermission();
  if (permission === "denied") $("#notify").textContent = T.notify_blocked;
  else updateNotifyButton();
});

$("#search").addEventListener("input", (e) => { state.query = e.target.value; renderRacks(); });
$("#failed-only").addEventListener("change", (e) => { state.failedOnly = e.target.checked; renderRacks(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.selectedPlace) selectPlace(state.selectedPlace); });

applyLanguage(state.language);
const initial = location.hash.match(/^#p=([\w-]+)/)?.[1];
load().then(() => { if (initial && state.data) goTo(initial); });
setInterval(load, REFRESH_MS);
setInterval(() => { if (state.data) $("#uptime-line").textContent = uptimeLine(); }, 1000);
setInterval(() => state.data && renderUpdated(), 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.data && Date.now() - new Date(state.data.updated) > REFRESH_MS) load();
});
