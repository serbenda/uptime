"use strict";

// Datos: la rama `datos` del repo. En local (o con ?local) se leen de data/.
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname) || new URLSearchParams(location.search).has("local");
const BASE = LOCAL ? "data/" : document.querySelector('meta[name="uptime-datos"]').content;
const REFRESCO_MS = 5 * 60 * 1000;
const VIEJO_MIN = 40;               // si los datos tienen más de esto, se avisa
const DIAS = 90;
const MOVIMIENTO = !matchMedia("(prefers-reduced-motion: reduce)").matches;

const NIVELES = ["operativo", "mantenimiento", "degradado", "parcial", "grave"];
const RANGO = Object.fromEntries(NIVELES.map((n, i) => [n, i]));
RANGO.desconocido = -1;
RANGO.aviso = 0.5;
const COLOR = { operativo: "43D17F", mantenimiento: "5AA9FF", degradado: "F2C230", parcial: "FF8A2A", grave: "FF4D4D", desconocido: "6B7885" };

const $ = (s) => document.querySelector(s);
const estado = {
  datos: null,
  historial: {},
  registro: {},
  mapa: null,
  idioma: idiomaInicial(),
  categoria: "todas",
  busqueda: "",
  soloProblemas: false,
  abiertos: new Set(),
  journalCompleto: false,
  lugarElegido: null,
  fijados: new Set(leerLocal("fijados", leerLocal("vigilados", []))),
  anteriores: null,  // nivel de cada proveedor en la carga anterior, para avisar
  primeraVez: true,
};

let T = IDIOMAS[estado.idioma];
const nivelTexto = (n) => T.estados[n] ?? n;

// ------------------------------------------------------------ utilidades

function leerLocal(clave, defecto) {
  try { return JSON.parse(localStorage.getItem("uptime." + clave)) ?? defecto; } catch { return defecto; }
}
function guardarLocal(clave, valor) {
  try { localStorage.setItem("uptime." + clave, JSON.stringify(valor)); } catch { /* sin almacenamiento */ }
}

function el(etiqueta, props = {}, ...hijos) {
  const n = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "nivel") n.dataset.nivel = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const h of hijos.flat()) if (h != null && h !== false && h !== "") n.append(h);
  return n;
}

const SVG = "http://www.w3.org/2000/svg";
function svg(etiqueta, atributos = {}) {
  const n = document.createElementNS(SVG, etiqueta);
  for (const [k, v] of Object.entries(atributos)) if (v != null) n.setAttribute(k, v);
  return n;
}

function hace(iso) {
  if (!iso) return "";
  const rtf = new Intl.RelativeTimeFormat(T.html, { numeric: "auto" });
  const s = (new Date(iso) - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 60) return T.ahora_mismo;
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 45) return rtf.format(Math.round(s / 86400), "day");
  return rtf.format(Math.round(s / (86400 * 30)), "month");
}

// "02 nov 09:11", en la hora local de quien mira
const dos = (n) => String(n).padStart(2, "0");
function fecha(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${dos(d.getDate())} ${T.meses[d.getMonth()]} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
}
const diaCorto = (ymd) => `${Number(ymd.slice(8))} ${T.meses[Number(ymd.slice(5, 7)) - 1]}`;

function duracion(desde, hasta) {
  const min = Math.max(1, Math.round((new Date(hasta) - new Date(desde)) / 60000));
  if (min < 60) return `${min} ${T.dur.min}`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 48) return m ? `${h} ${T.dur.h} ${m} ${T.dur.min}` : `${h} ${T.dur.h}`;
  return `${Math.round(h / 24)} ${T.dur.dias}`;
}

function enumerar(nombres) {
  if (nombres.length <= 1) return nombres.join("");
  return nombres.slice(0, -1).join(", ") + ` ${T.y} ` + nombres.at(-1);
}

const conFallos = (p) => RANGO[p.estado] >= RANGO.degradado;
const porcentaje = (n) => `${n >= 99.995 ? "100" : n.toFixed(2)}%`;
const nombreCategoria = (id) => T.categorias[id] ?? estado.datos?.categorias?.[id] ?? id;
const nombreLugar = (l) => l[T.html] || l.en;
const fase = (f) => (f && T.fases[f]) || f || "";

// ------------------------------------------------------------ idioma

function aplicarIdioma(idioma) {
  estado.idioma = idioma;
  T = IDIOMAS[idioma];
  document.documentElement.lang = T.html;
  $("#descripcion").content = T.descripcion;
  for (const n of document.querySelectorAll("[data-i18n]")) {
    const v = T[n.dataset.i18n];
    if (typeof v === "string") n.textContent = v;
  }
  for (const n of document.querySelectorAll("[data-i18n-aria]")) n.setAttribute("aria-label", T[n.dataset.i18nAria]);
  for (const n of document.querySelectorAll("[data-i18n-ph]")) n.placeholder = T[n.dataset.i18nPh];
  for (const b of document.querySelectorAll("[data-idioma]")) b.setAttribute("aria-pressed", String(b.dataset.idioma === idioma));
  pintarLeyenda();
  if (estado.datos) pintar();
}

function elegirIdioma(idioma) {
  if (!(idioma in IDIOMAS)) return false;
  try { localStorage.setItem("uptime.idioma", idioma); } catch { /* sin almacenamiento */ }
  const url = new URL(location.href);
  url.searchParams.delete("lang");
  history.replaceState(null, "", url);
  aplicarIdioma(idioma);
  return true;
}

for (const b of document.querySelectorAll("[data-idioma]")) {
  b.addEventListener("click", () => elegirIdioma(b.dataset.idioma));
}

function pintarLeyenda() {
  $("#leyenda").replaceChildren(...["operativo", "mantenimiento", "degradado", "parcial", "grave", "desconocido"].map((n) =>
    el("div", {}, el("dt", {}, el("span", { class: "led", nivel: n })), el("dd", {}, nivelTexto(n)))));
}

// ------------------------------------------------------------ carga

async function leerJSON(nombre, base = BASE) {
  const r = await fetch(`${base}${nombre}?t=${Math.floor(Date.now() / 60000)}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${nombre}: HTTP ${r.status}`);
  return r.json();
}

async function cargar() {
  try {
    const [datos, historial, registro, mapa] = await Promise.all([
      leerJSON("estado.json"),
      leerJSON("historial.json").catch(() => ({})),
      leerJSON("incidencias.json").catch(() => ({})),
      estado.mapa ? Promise.resolve(estado.mapa) : leerJSON("mapa.json", "data/").catch(() => null),
    ]);
    avisarCambios(datos);
    Object.assign(estado, { datos, historial, registro, mapa });
    pintar();
    if (estado.primeraVez) { estado.primeraVez = false; escribirConsola(); }
  } catch (e) {
    console.error(e);
    if (!estado.datos) {
      $("#veredicto").dataset.nivel = "desconocido";
      $("#marca").textContent = "[ERROR ]";
      $("#titular").textContent = T.error_titular;
      $("#subtitular").textContent = T.error_sub;
    }
    $("#actualizado").textContent = T.sin_conexion;
  }
}

// ------------------------------------------------------------ pintar

function pintar() {
  pintarConsola();
  pintarMapa();
  pintarJournal();
  pintarFiltros();
  pintarRacks();
  pintarMantenimientos();
  pintarRecientes();
  pintarActualizado();
  pintarPSU();
  actualizarBotonAvisos();
}

function pintarActualizado() {
  const iso = estado.datos?.actualizado;
  if (!iso) return;
  const n = $("#actualizado");
  const viejo = (Date.now() - new Date(iso)) / 60000 > VIEJO_MIN;
  n.textContent = viejo ? T.retraso(hace(iso)) : T.actualizado(hace(iso));
  n.title = fecha(iso);
  n.classList.toggle("viejo", viejo);
}

// `uptime` de verdad: hora, días de historial, servicios y "load average" de fallos
function lineaUptime() {
  const lista = estado.datos.proveedores;
  const ahora = new Date();
  const hora = `${dos(ahora.getHours())}:${dos(ahora.getMinutes())}:${dos(ahora.getSeconds())}`;
  const dias = Math.max(0, ...Object.values(estado.historial).map((h) => Object.keys(h).length));
  const media = (n) => {
    const desde = new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    let total = 0, malos = 0;
    for (const h of Object.values(estado.historial)) {
      for (const [d, v] of Object.entries(h)) {
        if (d < desde) continue;
        total++;
        if (RANGO[v.peor] >= RANGO.parcial) malos++;
      }
    }
    return total ? malos / total : 0;
  };
  const fallos = lista.filter(conFallos).length;
  const carga = [fallos / lista.length, media(7), media(30)].map((x) => x.toFixed(2)).join(", ");
  return T.linea_uptime({ hora, dias, total: lista.length, fallos, carga });
}

function pintarConsola() {
  const lista = estado.datos.proveedores;
  const malos = lista.filter(conFallos).sort((a, b) => RANGO[b.estado] - RANGO[a.estado] || a.nombre.localeCompare(b.nombre, T.html));
  const mant = lista.filter((p) => p.estado === "mantenimiento");
  const sinDatos = lista.filter((p) => p.estado === "desconocido");
  const nivel = malos[0]?.estado ?? (mant.length ? "mantenimiento" : "operativo");

  const uptime = $("#linea-uptime");
  uptime.textContent = lineaUptime();
  uptime.title = T.load_title;

  $("#orden-estado").textContent = malos.length ? "systemctl --failed" : "systemctl status proveedores";
  $("#veredicto").dataset.nivel = nivel;
  $("#marca").textContent = malos.length ? "[FAILED]" : "[  OK  ]";
  $("#titular").textContent = !malos.length ? T.todo_bien
    : malos.length <= 3 ? T.con_problemas(enumerar(malos.map((p) => p.nombre)), malos.length)
    : T.muchos_problemas(malos.length);

  const r = T.resumen;
  const partes = [`${lista.length} ${r.total}`, `${lista.length - malos.length - mant.length - sinDatos.length} ${r.ok}`];
  if (mant.length) partes.push(`${mant.length} ${r.mant}`);
  if (malos.length) partes.push(`${malos.length} ${r.fallos}`);
  if (sinDatos.length) partes.push(`${sinDatos.length} ${r.sin}`);
  $("#subtitular").textContent = partes.join(", ");

  $("#fallos").replaceChildren(...malos.map((p) => {
    const i = p.incidencias.filter((x) => x.impacto !== "aviso").sort((a, b) => (RANGO[b.impacto] ?? 0) - (RANGO[a.impacto] ?? 0))[0];
    const afectados = p.afectados ?? p.componentes.length;
    const texto = i?.titulo || (afectados ? T.componentes_afectados(afectados, p.total_componentes || afectados) : p.resumen);
    return el("li", { nivel: p.estado },
      el("span", { "aria-hidden": "true" }, "●"),
      el("a", { href: `#p=${p.id}`, onclick: (e) => { e.preventDefault(); irA(p.id); } }, p.nombre),
      el("span", { class: "fallo-nivel" }, nivelTexto(p.estado)),
      el("span", { class: "fallo-texto", lang: "en" }, texto || ""));
  }));

  document.title = malos.length ? `(${malos.length}) uptime` : "uptime";
  $("#favicon").href = "data:image/svg+xml," + encodeURIComponent(
    // El mismo dibujo que docs/logo/uptime-favicon.svg, con el LED del color del peor estado
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect x='1' y='6' width='30' height='20' rx='4' fill='#18212A'/>` +
    `<rect x='3.5' y='8.5' width='25' height='15' rx='2.5' fill='#253241'/><circle cx='9.5' cy='16' r='3.6' fill='#${COLOR[nivel]}'/>` +
    `<rect x='15' y='15' width='2.6' height='5' rx='.8' fill='#2E9A60'/><rect x='18.6' y='13' width='2.6' height='7' rx='.8' fill='#F2C230'/>` +
    `<rect x='22.2' y='11' width='2.6' height='9' rx='.8' fill='#FF4D4D'/></svg>`);
}

// La consola aparece línea a línea la primera vez, como si se estuviera escribiendo
function escribirConsola() {
  const cuerpo = $("#consola");
  if (!MOVIMIENTO) return;
  const lineas = [...cuerpo.children];
  cuerpo.classList.add("escribiendo");
  lineas.forEach((n, i) => setTimeout(() => {
    n.classList.add("visible");
    if (i === lineas.length - 1) cuerpo.classList.remove("escribiendo");
  }, 90 + i * 140));
}

// ------------------------------------------------------------ mapa

// Equirectangular, como la rejilla de data/mapa.json
function proyectar(lat, lon) {
  const m = estado.mapa;
  return [(lon + 180) / m.paso, (m.lat_max - lat) / m.paso];
}
function desproyectar(x, y) {
  const m = estado.mapa;
  return [m.lat_max - y * m.paso, x * m.paso - 180];
}

let tierraDibujada = false;
function dibujarTierra() {
  if (tierraDibujada || !estado.mapa) return;
  tierraDibujada = true;
  const { filas, columnas } = estado.mapa;
  let d = "";
  filas.forEach((hex, y) => {
    const desplazamiento = y % 2 ? 0.5 : 0;
    for (let i = 0; i < hex.length; i++) {
      const nibble = parseInt(hex[i], 16);
      for (let b = 0; b < 4; b++) {
        if (nibble & (8 >> b)) {
          const x = i * 4 + b;
          if (x < columnas) d += `M${x + desplazamiento} ${y}h0`;
        }
      }
    }
  });
  $("#mapa-tierra").setAttribute("d", d);

  // Retícula: ecuador, trópicos y meridiano de Greenwich
  const g = $("#mapa-reticula");
  const ancho = columnas;
  for (const [lat, clase] of [[0, "ecuador"], [23.44, "tropico"], [-23.44, "tropico"]]) {
    const [, y] = proyectar(lat, 0);
    g.append(svg("line", { x1: 0, x2: ancho, y1: y, y2: y, class: clase }));
  }
  const [x0] = proyectar(0, 0);
  g.append(svg("line", { x1: x0, x2: x0, y1: 0, y2: estado.mapa.filas.length, class: "tropico" }));
}

// Agrupa los puntos de todos los proveedores por lugar
function lugaresActuales() {
  const grupos = new Map();
  for (const p of estado.datos.proveedores) {
    for (const l of p.lugares || []) {
      const g = grupos.get(l.id) ?? { lugar: l, nivel: "operativo", proveedores: [] };
      g.nivel = RANGO[l.nivel] > RANGO[g.nivel] ? l.nivel : g.nivel;
      g.proveedores.push({ p, nivel: l.nivel, n: l.n, ejemplos: l.ejemplos || [] });
      grupos.set(l.id, g);
    }
  }
  const lista = [...grupos.values()];
  for (const g of lista) g.proveedores.sort((a, b) => RANGO[b.nivel] - RANGO[a.nivel]);
  return lista.sort((a, b) => RANGO[b.nivel] - RANGO[a.nivel] || b.proveedores.length - a.proveedores.length ||
    nombreLugar(a.lugar).localeCompare(nombreLugar(b.lugar), T.html));
}

function pintarMapa() {
  if (!estado.mapa) { $("#bloque-mapa").hidden = true; return; }
  $("#bloque-mapa").hidden = false;
  dibujarTierra();
  const grupos = lugaresActuales();
  estado.grupos = grupos;
  if (!grupos.some((g) => g.lugar.id === estado.lugarElegido)) estado.lugarElegido = null;

  // Puntos: de menos a más grave, para que lo peor quede encima
  const capa = $("#mapa-puntos");
  capa.replaceChildren(...[...grupos].reverse().map((g) => {
    const [x, y] = proyectar(g.lugar.lat, g.lugar.lon);
    const r = 0.9 + Math.min(g.proveedores.reduce((s, v) => s + v.n, 0), 8) * 0.12;
    const etiqueta = T.punto_aria(nombreLugar(g.lugar), nivelTexto(g.nivel), g.proveedores.length);
    const punto = svg("g", {
      class: "punto",
      "data-nivel": g.nivel, "data-id": g.lugar.id, tabindex: "0", role: "button", "aria-label": etiqueta,
      transform: `translate(${x.toFixed(2)} ${y.toFixed(2)})`,
    });
    punto.append(svg("circle", { class: "halo", r: (r * 2.6).toFixed(2) }), svg("circle", { class: "nucleo", r: r.toFixed(2) }));
    punto.addEventListener("click", () => elegirLugar(g.lugar.id));
    punto.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegirLugar(g.lugar.id); } });
    punto.addEventListener("pointerenter", () => mostrarTip(g, punto));
    punto.addEventListener("pointerleave", ocultarTip);
    punto.addEventListener("focus", () => mostrarTip(g, punto));
    punto.addEventListener("blur", ocultarTip);
    return punto;
  }));

  // Lista lateral
  const nProveedores = new Set(grupos.flatMap((g) => g.proveedores.map((v) => v.p.id))).size;
  $("#lugares-resumen").textContent = grupos.length ? T.lugares_resumen(grupos.length, nProveedores) : T.sin_lugares;
  $("#lugares").replaceChildren(...grupos.map((g) => el("li", { nivel: g.nivel, "data-id": g.lugar.id },
    el("button", { type: "button", "aria-pressed": "false", onclick: () => elegirLugar(g.lugar.id),
      onpointerenter: () => resaltar(g.lugar.id, true), onpointerleave: () => resaltar(g.lugar.id, false) },
      el("span", { class: "led" }),
      el("span", { class: "lugar-nombre" }, nombreLugar(g.lugar)),
      el("span", { class: "lugar-quien" }, g.proveedores.map((v) => v.p.nombre).join(", "))))));

  const globales = estado.datos.proveedores.filter((p) => conFallos(p) && !(p.lugares || []).length);
  const nGlobal = $("#lugares-global");
  nGlobal.hidden = !globales.length;
  nGlobal.textContent = globales.length ? T.globales(enumerar(globales.map((p) => p.nombre))) : "";

  actualizarSeleccion();
}

// Elegir un lugar no redibuja el mapa: así no se pierde el foco del teclado
function actualizarSeleccion() {
  const id = estado.lugarElegido;
  for (const n of document.querySelectorAll("#mapa-puntos .punto")) n.classList.toggle("elegido", n.dataset.id === id);
  for (const n of document.querySelectorAll("#lugares li")) {
    n.classList.toggle("elegido", n.dataset.id === id);
    n.querySelector("button").setAttribute("aria-pressed", String(n.dataset.id === id));
  }
  pintarDetalleLugar((estado.grupos || []).find((g) => g.lugar.id === id));
}

function resaltar(id, si) {
  document.querySelector(`#mapa-puntos [data-id="${CSS.escape(id)}"]`)?.classList.toggle("resaltado", si);
}

function elegirLugar(id) {
  estado.lugarElegido = estado.lugarElegido === id ? null : id;
  actualizarSeleccion();
}

function pintarDetalleLugar(g) {
  const caja = $("#lugar-detalle");
  caja.hidden = !g;
  if (!g) return;
  const l = g.lugar;
  const pais = l[`pais_${T.html}`];
  caja.tabIndex = -1;
  caja.dataset.nivel = g.nivel;
  caja.replaceChildren(
    el("div", { class: "detalle-cabecera" },
      el("p", { class: "orden" }, el("span", { class: "prompt" }, "$ "), `geoiplookup ${l.id.replace(/^[@Z]:?/, "")}`),
      el("button", { type: "button", class: "cerrar", onclick: () => elegirLugar(l.id) }, T.cerrar)),
    el("p", { class: "detalle-lugar" }, nombreLugar(l), pais && pais !== nombreLugar(l) ? el("span", {}, `, ${pais}`) : "",
      el("span", { class: "detalle-coord" }, ` ${coordenadas(l.lat, l.lon)}`)),
    el("ul", { class: "detalle-proveedores" }, g.proveedores.map((v) => el("li", { nivel: v.nivel },
      el("div", { class: "item" },
        el("span", {}, "●"),
        el("a", { href: `#p=${v.p.id}`, onclick: (e) => { e.preventDefault(); irA(v.p.id); } }, v.p.nombre),
        el("span", { class: "nivel" }, nivelTexto(v.nivel))),
      el("ul", { class: "ejemplos" }, v.ejemplos.map((x) => el("li", { lang: "en" }, x.t)))))));
}

function coordenadas(lat, lon) {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : (T.html === "es" ? "O" : "W")}`;
}

function mostrarTip(g, punto) {
  const tip = $("#tip");
  const caja = $("#pantalla").getBoundingClientRect();
  const r = punto.getBoundingClientRect();
  tip.replaceChildren(
    el("p", { class: "tip-lugar" }, nombreLugar(g.lugar)),
    ...g.proveedores.slice(0, 5).map((v) => el("p", { class: "tip-fila", nivel: v.nivel },
      el("span", {}, "● "), v.p.nombre, el("span", { class: "nivel" }, ` ${nivelTexto(v.nivel)}`))));
  tip.hidden = false;
  const x = r.left + r.width / 2 - caja.left;
  const y = r.top - caja.top;
  tip.style.left = `${Math.min(Math.max(x, 90), caja.width - 90)}px`;
  tip.style.top = `${y}px`;
  tip.classList.toggle("abajo", y < 70);
}
function ocultarTip() { $("#tip").hidden = true; }

$("#pantalla").addEventListener("pointermove", (e) => {
  if (!estado.mapa) return;
  const mapa = $("#mapa");
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(mapa.getScreenCTM().inverse());
  const [lat, lon] = desproyectar(p.x, p.y);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
  $("#coord").textContent = coordenadas(lat, lon);
});

// ------------------------------------------------------------ journal

function pintarJournal() {
  const filas = estado.datos.proveedores.flatMap((p) => p.incidencias.map((i) => ({ p, i })));
  filas.sort((a, b) => (RANGO[b.i.impacto] ?? 0) - (RANGO[a.i.impacto] ?? 0) ||
    String(b.i.actualizado || b.i.inicio).localeCompare(String(a.i.actualizado || a.i.inicio)));
  $("#bloque-activas").hidden = !filas.length;
  const LIMITE = 8;
  const mostradas = estado.journalCompleto ? filas : filas.slice(0, LIMITE);
  const resto = filas.length - mostradas.length;
  $("#activas").replaceChildren(...mostradas.map(({ p, i }) => el("li", { nivel: i.impacto },
    el("details", {},
      el("summary", {},
        el("span", { class: "j-hora" }, fecha(i.inicio || i.actualizado)),
        el("span", { class: "j-quien" }, p.id),
        el("span", { class: "j-nivel" }, nivelTexto(i.impacto)),
        el("span", { class: "j-titulo", lang: "en" }, i.titulo || T.sin_titulo)),
      el("div", { class: "j-detalle" },
        el("p", {}, [fase(i.fase), i.inicio && T.empezo(hace(i.inicio)), i.actualizado && T.actualizada(hace(i.actualizado)),
          i.afecta?.length && T.afecta(enumerar(i.afecta))].filter(Boolean).join(", ")),
        i.mensaje && el("p", { lang: "en" }, i.mensaje),
        el("p", {}, el("a", { href: i.enlace, target: "_blank", rel: "noopener" }, T.ver_en(p.nombre))))))),
    resto > 0 && el("li", {}, el("button", { type: "button", class: "mas",
      onclick: () => { estado.journalCompleto = true; pintarJournal(); } }, T.mas_entradas(resto))));
}

// ------------------------------------------------------------ racks

function pintarFiltros() {
  const ids = ["todas", ...Object.keys(estado.datos.categorias)];
  $("#categorias").replaceChildren(...ids.map((id) =>
    el("button", {
      type: "button",
      class: "flag",
      title: id === "todas" ? null : nombreCategoria(id),
      "aria-pressed": String(estado.categoria === id),
      onclick: () => { estado.categoria = id; pintarFiltros(); pintarRacks(); },
    }, T.flags[id] ?? `--${id}`)));
}

function visibles() {
  const q = estado.busqueda.trim().toLowerCase();
  return estado.datos.proveedores.filter((p) =>
    (estado.categoria === "todas" || p.categoria === estado.categoria) &&
    (!estado.soloProblemas || conFallos(p) || p.estado === "mantenimiento" || p.estado === "desconocido") &&
    (!q || p.nombre.toLowerCase().includes(q) || p.id.includes(q)));
}

function pintarRacks() {
  const lista = visibles();
  const racks = [];
  const fijados = lista.filter((p) => estado.fijados.has(p.id));
  if (fijados.length) racks.push([T.fijados, fijados]);
  for (const id of Object.keys(estado.datos.categorias)) {
    const resto = lista.filter((p) => p.categoria === id && !estado.fijados.has(p.id));
    if (resto.length) racks.push([nombreCategoria(id), resto]);
  }
  const ordenar = (a, b) => RANGO[b.estado] - RANGO[a.estado] || a.nombre.localeCompare(b.nombre, T.html);
  const nodos = racks.map(([nombre, ps]) => {
    ps.sort(ordenar);
    const malos = ps.filter(conFallos).length;
    const peor = ps[0]?.estado ?? "operativo";
    return el("section", { class: "rack", "aria-label": `${T.rack} ${nombre}` },
      el("header", { class: "rack-placa", nivel: peor },
        el("h3", { class: "rack-nombre" }, nombre),
        el("span", { class: "rack-cuenta" }, T.servidores(ps.length), malos ? [", ", el("b", {}, T.con_fallos(malos))] : "")),
      el("div", { class: "rack-hueco" }, ps.map((p, i) => servidor(p, ps.length - i))));
  });
  if (!nodos.length) nodos.push(el("p", { class: "sin-resultados" }, estado.soloProblemas ? T.grep_fallos : T.grep_nada));
  $("#racks").replaceChildren(...nodos);
}

function diasRecientes() {
  const dias = [];
  const hoy = new Date();
  for (let i = DIAS - 1; i >= 0; i--) {
    dias.push(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - i)).toISOString().slice(0, 10));
  }
  return dias;
}

function disponibilidad(id) {
  let m = 0, c = 0, diasMalos = 0;
  for (const v of Object.values(estado.historial[id] || {})) {
    m += v.m; c += v.c;
    if (RANGO[v.peor] >= RANGO.parcial) diasMalos++;
  }
  return { pct: m ? (1 - c / m) * 100 : null, diasMalos, dias: Object.keys(estado.historial[id] || {}).length };
}

function servidor(p, unidad) {
  const nodo = $("#plantilla-servidor").content.firstElementChild.cloneNode(true);
  nodo.dataset.nivel = p.estado;
  nodo.id = `p-${p.id}`;
  if (estado.fijados.has(p.id)) nodo.dataset.fijado = "";
  nodo.querySelector(".u").textContent = `U${unidad}`;
  nodo.querySelector(".nombre").textContent = p.nombre;
  const n = p.incidencias.filter((i) => i.impacto !== "aviso").length;
  nodo.querySelector(".estado").textContent = nivelTexto(p.estado) + (n > 1 ? ` ×${n}` : "");

  // 90 días
  const hist = estado.historial[p.id] || {};
  const tira = nodo.querySelector(".historia");
  for (const d of diasRecientes()) {
    const h = hist[d];
    const barra = document.createElement("span");
    if (h) {
      barra.dataset.nivel = h.peor;
      const pct = h.m ? ((1 - h.c / h.m) * 100).toFixed(1) : "100";
      barra.title = `${diaCorto(d)}: ${h.peor === "operativo" ? T.dia_ok : T.dia_peor(nivelTexto(h.peor))} (${T.dia_disponible(pct)})`;
    } else {
      barra.title = `${diaCorto(d)}: ${T.dia_sin}`;
    }
    tira.append(barra);
  }
  const { pct } = disponibilidad(p.id);
  const lcd = nodo.querySelector(".lcd");
  lcd.textContent = pct == null ? "--.--%" : porcentaje(pct);
  lcd.classList.toggle("vacio", pct == null);
  lcd.title = T.lcd_title;
  tira.setAttribute("aria-label", pct == null ? T.sin_historial : T.tira_aria(porcentaje(pct)));

  // Fijar arriba
  const fijar = nodo.querySelector(".fijar");
  const fijado = estado.fijados.has(p.id);
  fijar.setAttribute("aria-pressed", String(fijado));
  fijar.title = fijado ? T.desfijar : T.fijar_title;
  nodo.querySelector(".fijar-texto").textContent = T.fijar;
  fijar.addEventListener("click", () => {
    estado.fijados.has(p.id) ? estado.fijados.delete(p.id) : estado.fijados.add(p.id);
    guardarLocal("fijados", [...estado.fijados]);
    pintarRacks();
    actualizarBotonAvisos();
    document.querySelector(`#p-${p.id} .fijar`)?.focus();
  });

  // Cajón
  const abrir = nodo.querySelector(".abrir");
  const cajon = nodo.querySelector(".cajon");
  const alternar = (forzar) => {
    const abierto = forzar ?? cajon.hidden;
    cajon.hidden = !abierto;
    abrir.setAttribute("aria-expanded", String(abierto));
    if (abierto) { estado.abiertos.add(p.id); cajon.replaceChildren(...contenidoCajon(p)); }
    else estado.abiertos.delete(p.id);
  };
  abrir.addEventListener("click", () => {
    alternar();
    history.replaceState(null, "", estado.abiertos.has(p.id) ? `#p=${p.id}` : location.pathname + location.search);
  });
  if (estado.abiertos.has(p.id)) alternar(true);
  return nodo;
}

function fila(clave, ...valor) {
  return el("p", { class: "clave-fila" }, el("span", { class: "clave" }, clave), el("span", {}, ...valor));
}

function contenidoCajon(p) {
  const f = p.fuente || {};
  const afectados = p.afectados ?? p.componentes.length;
  const host = (() => { try { return new URL(p.web).host; } catch { return p.web; } })();
  const partes = [el("p", { class: "orden" }, el("span", { class: "prompt" }, "$ "), `status ${p.id}`)];

  partes.push(fila(T.k_estado, el("span", { class: "nivel", nivel: p.estado }, `● ${nivelTexto(p.estado)}`),
    p.resumen && !/^sin incidencias/i.test(p.resumen) ? el("span", { lang: "en" }, `  "${p.resumen}"`) : ""));
  partes.push(fila(T.k_fuente, host, ", ",
    f.ok ? T.respondio(hace(f.comprobado)) : el("span", { class: "error" }, T.no_responde(f.error, f.ultimo_ok && hace(f.ultimo_ok)))));

  const { pct, diasMalos, dias } = disponibilidad(p.id);
  if (pct != null) partes.push(fila(T.k_90, T.disponibilidad(porcentaje(pct), diasMalos, dias)));

  if (p.total_componentes || p.componentes.length) {
    const resumen = afectados ? T.afectados_de(afectados, p.total_componentes || afectados) : T.todos_ok(p.total_componentes);
    partes.push(fila(T.k_comp, resumen, p.alcance_limitado ? el("span", { class: "clave" }, T.alcance) : ""));
    if (p.componentes.length) {
      partes.push(el("ul", { class: "sangria" }, p.componentes.map((c) =>
        el("li", { class: "item", nivel: c.estado }, el("span", {}, "●"), el("span", { lang: "en" }, c.nombre), el("span", { class: "nivel" }, nivelTexto(c.estado))))));
      if (afectados > p.componentes.length) partes.push(el("p", { class: "sangria clave" }, T.y_mas(afectados - p.componentes.length)));
    }
  }

  if (p.incidencias.length) {
    partes.push(el("p", { class: "bloque clave" }, T.k_inc));
    partes.push(el("ul", { class: "sangria" }, p.incidencias.map((i) => el("li", { nivel: i.impacto },
      el("div", { class: "item" }, el("span", {}, "●"),
        el("a", { href: i.enlace, target: "_blank", rel: "noopener", lang: "en" }, i.titulo),
        el("span", { class: "nivel" }, nivelTexto(i.impacto))),
      el("p", { class: "sangria clave" }, [fase(i.fase), i.inicio && T.desde(fecha(i.inicio)), i.actualizado && T.actualizada(hace(i.actualizado))].filter(Boolean).join(", ")),
      i.mensaje && el("p", { class: "mensaje", lang: "en" }, i.mensaje)))));
  }

  if (p.mantenimientos.length) {
    partes.push(el("p", { class: "bloque clave" }, T.k_mant));
    partes.push(el("ul", { class: "sangria" }, p.mantenimientos.map((m) => el("li", { class: "item", nivel: "mantenimiento" },
      el("span", {}, m.en_curso ? "●" : "○"),
      el("a", { href: m.enlace, target: "_blank", rel: "noopener", lang: "en" }, m.titulo),
      el("span", { class: "clave" }, m.en_curso ? T.en_curso : fecha(m.inicio))))));
  }

  partes.push(el("p", { class: "bloque" }, el("a", { class: "enlace-oficial", href: p.web, target: "_blank", rel: "noopener" }, T.abrir(host))));
  return partes;
}

// ------------------------------------------------------------ mantenimientos, historial y PSU

function pintarMantenimientos() {
  const filas = estado.datos.proveedores.flatMap((p) => p.mantenimientos.map((m) => ({ p, m })))
    .sort((a, b) => Number(b.m.en_curso) - Number(a.m.en_curso) || String(a.m.inicio).localeCompare(String(b.m.inicio)));
  $("#bloque-mantenimientos").hidden = !filas.length;
  // Como mucho 3 por proveedor: Cloudflare, por ejemplo, programa decenas de centros de datos a la vez
  const POR_PROVEEDOR = 3;
  const vistos = {}, ocultos = {};
  const nodos = [];
  for (const { p, m } of filas) {
    vistos[p.id] = (vistos[p.id] || 0) + 1;
    if (vistos[p.id] > POR_PROVEEDOR) { ocultos[p.id] = (ocultos[p.id] || 0) + 1; continue; }
    nodos.push(el("li", { class: m.en_curso ? "ahora" : null },
      el("span", { class: "t-cuando" }, m.en_curso ? T.en_curso : fecha(m.inicio) || T.sin_fecha),
      el("span", { class: "t-que" }, el("span", { class: "t-quien" }, p.id),
        el("a", { href: m.enlace, target: "_blank", rel: "noopener", lang: "en" }, m.titulo))));
  }
  for (const [id, n] of Object.entries(ocultos)) {
    nodos.push(el("li", {}, el("span", { class: "t-cuando" }, "..."),
      el("span", { class: "t-que t-resto" }, el("a", { href: `#p=${id}`, onclick: (e) => { e.preventDefault(); irA(id); } }, T.mas_mant(id, n)))));
  }
  $("#mantenimientos").replaceChildren(...nodos);
}

function pintarRecientes() {
  const ids = new Set(estado.datos.proveedores.map((p) => p.id));
  const filas = Object.values(estado.registro)
    .filter((r) => ids.has(r.proveedor) && r.impacto !== "aviso")
    .sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)))
    .slice(0, 60);
  $("#bloque-recientes").hidden = !filas.length;
  $("#recientes").replaceChildren(...filas.map((r) => el("li", { nivel: r.impacto },
    el("span", { class: "t-cuando" }, fecha(r.inicio)),
    el("span", { class: "t-que" }, el("span", { class: "t-quien" }, r.proveedor),
      el("a", { href: r.enlace, target: "_blank", rel: "noopener", lang: "en" }, r.titulo), " ",
      el("span", { class: "t-dura" }, r.fin ? `(${duracion(r.inicio, r.fin)})` : T.sigue_abierta)))));
}

function pintarPSU() {
  $("#psu-salida").textContent = T.psu_salida_valor(estado.datos.proveedores.length);
}

// ------------------------------------------------------------ navegación y avisos

function irA(id) {
  estado.abiertos.add(id);
  if (!visibles().some((p) => p.id === id)) {
    estado.categoria = "todas"; estado.busqueda = ""; estado.soloProblemas = false;
    $("#buscar").value = ""; $("#solo-problemas").checked = false;
    pintarFiltros();
  }
  pintarRacks();
  history.replaceState(null, "", `#p=${id}`);
  const nodo = document.getElementById(`p-${id}`);
  if (nodo) {
    nodo.scrollIntoView({ behavior: MOVIMIENTO ? "smooth" : "auto", block: "center" });
    nodo.querySelector(".abrir").focus({ preventScroll: true });
  }
}

function actualizarBotonAvisos() {
  $("#avisos").hidden = !("Notification" in window) || !estado.fijados.size || Notification.permission === "granted";
}

function avisarCambios(datos) {
  const actuales = Object.fromEntries(datos.proveedores.map((p) => [p.id, p.estado]));
  const previos = estado.anteriores;
  estado.anteriores = actuales;
  if (!previos || !("Notification" in window) || Notification.permission !== "granted") return;
  for (const p of datos.proveedores) {
    if (!estado.fijados.has(p.id) || !(p.id in previos)) continue;
    const antes = RANGO[previos[p.id]] ?? -1, ahora = RANGO[p.estado];
    if (ahora >= RANGO.degradado && ahora > antes) {
      new Notification(T.aviso_cae(p.nombre, nivelTexto(p.estado)), { body: p.incidencias[0]?.titulo || p.resumen || "", tag: `uptime-${p.id}` });
    } else if (antes >= RANGO.degradado && ahora < RANGO.degradado) {
      new Notification(T.aviso_vuelve(p.nombre), { tag: `uptime-${p.id}` });
    }
  }
}

$("#avisos").addEventListener("click", async () => {
  const permiso = await Notification.requestPermission();
  if (permiso === "denied") $("#avisos").textContent = T.avisos_bloqueados;
  else actualizarBotonAvisos();
});

$("#buscar").addEventListener("input", (e) => { estado.busqueda = e.target.value; pintarRacks(); });
$("#solo-problemas").addEventListener("change", (e) => { estado.soloProblemas = e.target.checked; pintarRacks(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && estado.lugarElegido) elegirLugar(estado.lugarElegido); });

aplicarIdioma(estado.idioma);
const inicial = location.hash.match(/^#p=([\w-]+)/)?.[1];
cargar().then(() => { if (inicial && estado.datos) irA(inicial); });
setInterval(cargar, REFRESCO_MS);
setInterval(() => { if (estado.datos) $("#linea-uptime").textContent = lineaUptime(); }, 1000);
setInterval(() => estado.datos && pintarActualizado(), 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && estado.datos && Date.now() - new Date(estado.datos.actualizado) > REFRESCO_MS) cargar();
});
