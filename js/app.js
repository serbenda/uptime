"use strict";

// Datos: la rama `datos` del repo. En local (o con ?local) se leen de data/.
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname) || new URLSearchParams(location.search).has("local");
const BASE = LOCAL ? "data/" : document.querySelector('meta[name="uptime-datos"]').content;
const REFRESCO_MS = 5 * 60 * 1000;
const VIEJO_MIN = 40;               // si los datos tienen más de esto, se avisa
const DIAS = 90;

const NIVELES = ["operativo", "mantenimiento", "degradado", "parcial", "grave"];
const RANGO = Object.fromEntries(NIVELES.map((n, i) => [n, i]));
RANGO.desconocido = -1;
const TEXTO = {
  operativo: "Operativo",
  mantenimiento: "Mantenimiento",
  degradado: "Degradado",
  parcial: "Caída parcial",
  grave: "Caída grave",
  desconocido: "Sin datos",
};
const COLOR_FAVICON = { operativo: "2F8F5B", mantenimiento: "3D6FD6", degradado: "B8930F", parcial: "DD7320", grave: "C8332B", desconocido: "8A96A3" };

const $ = (s) => document.querySelector(s);
const estado = {
  datos: null,
  historial: {},
  registro: {},
  categoria: "todas",
  busqueda: "",
  soloProblemas: false,
  abiertos: new Set(),
  vigilados: new Set(leerLocal("vigilados", [])),
  anteriores: null,  // nivel de cada proveedor en la carga anterior, para avisar
};

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
  for (const h of hijos.flat()) if (h != null && h !== false) n.append(h);
  return n;
}

const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
function hace(iso) {
  if (!iso) return "";
  const s = (new Date(iso) - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 60) return "ahora mismo";
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

const fmtFecha = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtDia = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
const fecha = (iso) => (iso ? fmtFecha.format(new Date(iso)) : "");

function duracion(desde, hasta) {
  const min = Math.max(1, Math.round((new Date(hasta) - new Date(desde)) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.round(h / 24)} días`;
}

function enumerar(nombres) {
  if (nombres.length <= 1) return nombres.join("");
  if (nombres.length <= 3) return nombres.slice(0, -1).join(", ") + " y " + nombres.at(-1);
  return `${nombres.slice(0, 2).join(", ")} y ${nombres.length - 2} más`;
}

const tieneProblemas = (p) => RANGO[p.estado] >= RANGO.degradado;

// ------------------------------------------------------------ carga

async function leerJSON(nombre) {
  const r = await fetch(`${BASE}${nombre}?t=${Math.floor(Date.now() / 60000)}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${nombre}: HTTP ${r.status}`);
  return r.json();
}

async function cargar() {
  try {
    const [datos, historial, registro] = await Promise.all([
      leerJSON("estado.json"),
      leerJSON("historial.json").catch(() => ({})),
      leerJSON("incidencias.json").catch(() => ({})),
    ]);
    avisarCambios(datos);
    Object.assign(estado, { datos, historial, registro });
    pintar();
  } catch (e) {
    console.error(e);
    if (!estado.datos) {
      $("#titular").textContent = "No se han podido cargar los datos.";
      $("#subtitular").textContent = "Vuelve a intentarlo en unos minutos. Si persiste, la rama de datos del repositorio puede no existir todavía.";
    }
    $("#actualizado").textContent = "Error al actualizar. Se reintentará en 5 minutos.";
  }
}

// ------------------------------------------------------------ pintar

function pintar() {
  pintarVeredicto();
  pintarActivas();
  pintarCategorias();
  pintarServicios();
  pintarMantenimientos();
  pintarRecientes();
  pintarActualizado();
  $("#avisos").hidden = !("Notification" in window) || !estado.vigilados.size || Notification.permission === "granted";
}

function pintarActualizado() {
  const iso = estado.datos?.actualizado;
  const n = $("#actualizado");
  if (!iso) return;
  const viejo = (Date.now() - new Date(iso)) / 60000 > VIEJO_MIN;
  n.textContent = viejo ? `Datos de ${hace(iso)}: la actualización automática va con retraso` : `Actualizado ${hace(iso)}`;
  n.title = fecha(iso);
  n.classList.toggle("viejo", viejo);
}

function pintarVeredicto() {
  const lista = estado.datos.proveedores;
  const malos = lista.filter(tieneProblemas).sort((a, b) => RANGO[b.estado] - RANGO[a.estado]);
  const enMantenimiento = lista.filter((p) => p.estado === "mantenimiento");
  const sinDatos = lista.filter((p) => p.estado === "desconocido");
  const nivel = malos[0]?.estado ?? (enMantenimiento.length ? "mantenimiento" : "operativo");

  let titular, sub;
  if (malos.length) {
    titular = `${enumerar(malos.map((p) => p.nombre))} ${malos.length === 1 ? "tiene" : "tienen"} problemas.`;
    sub = `${malos.length} de ${lista.length} servicios con incidencias. El resto funciona con normalidad.`;
  } else if (enMantenimiento.length) {
    titular = "Todo funciona.";
    sub = `${enumerar(enMantenimiento.map((p) => p.nombre))} ${enMantenimiento.length === 1 ? "está" : "están"} en mantenimiento programado.`;
  } else {
    titular = "Todo funciona.";
    sub = `Ninguno de los ${lista.length} servicios tiene incidencias abiertas.`;
  }
  if (sinDatos.length) sub += ` No hay datos de ${enumerar(sinDatos.map((p) => p.nombre))}.`;

  $("#veredicto").dataset.nivel = nivel;
  $("#titular").textContent = titular;
  $("#subtitular").textContent = sub;
  document.title = malos.length ? `(${malos.length}) uptime` : "uptime";
  $("#favicon").href = "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect x='3' y='3' width='26' height='26' rx='7' fill='#1D2935'/><circle cx='16' cy='16' r='6' fill='#${COLOR_FAVICON[nivel]}'/></svg>`);
}

function pintarActivas() {
  const filas = [];
  for (const p of estado.datos.proveedores) {
    for (const i of p.incidencias) filas.push({ p, i });
  }
  filas.sort((a, b) => RANGO[b.i.impacto] - RANGO[a.i.impacto] || String(b.i.actualizado).localeCompare(String(a.i.actualizado)));
  $("#bloque-activas").hidden = !filas.length;
  $("#activas").replaceChildren(...filas.map(({ p, i }) => el("li", { class: "activa", nivel: i.impacto },
    el("div", { class: "activa-cabecera" },
      el("a", { class: "activa-proveedor", href: `#p=${p.id}`, onclick: (e) => { e.preventDefault(); irA(p.id); } }, p.nombre),
      el("a", { class: "activa-titulo", href: i.enlace, target: "_blank", rel: "noopener" }, i.titulo || "Incidencia sin título"),
      el("span", { class: "etiqueta-nivel" }, TEXTO[i.impacto])),
    el("p", { class: "activa-meta" }, [
      i.fase,
      [i.inicio && `Empezó ${hace(i.inicio)}`, i.actualizado && `actualizada ${hace(i.actualizado)}`].filter(Boolean).join(", "),
      i.afecta?.length && `Afecta a ${enumerar(i.afecta)}`,
    ].filter(Boolean).join(". ")),
    i.mensaje && el("p", { class: "activa-mensaje", lang: "en" }, i.mensaje))));
}

function pintarCategorias() {
  const cats = { todas: "Todos", ...estado.datos.categorias };
  $("#categorias").replaceChildren(...Object.entries(cats).map(([id, nombre]) =>
    el("button", {
      type: "button",
      "aria-pressed": String(estado.categoria === id),
      onclick: () => { estado.categoria = id; pintarCategorias(); pintarServicios(); },
    }, nombre)));
}

function visibles() {
  const q = estado.busqueda.trim().toLowerCase();
  return estado.datos.proveedores.filter((p) =>
    (estado.categoria === "todas" || p.categoria === estado.categoria) &&
    (!estado.soloProblemas || tieneProblemas(p) || p.estado === "mantenimiento") &&
    (!q || p.nombre.toLowerCase().includes(q) || p.id.includes(q)));
}

function pintarServicios() {
  const lista = visibles();
  const grupos = [];
  const vigilados = lista.filter((p) => estado.vigilados.has(p.id));
  if (vigilados.length) grupos.push(["Vigilados", vigilados]);
  for (const [id, nombre] of Object.entries(estado.datos.categorias)) {
    const resto = lista.filter((p) => p.categoria === id && !estado.vigilados.has(p.id));
    if (resto.length) grupos.push([nombre, resto]);
  }
  const ordenar = (a, b) => RANGO[b.estado] - RANGO[a.estado] || a.nombre.localeCompare(b.nombre, "es");
  const nodos = grupos.flatMap(([titulo, ps]) => [
    el("h3", { class: "grupo-titulo" }, titulo),
    ...ps.sort(ordenar).map(tarjeta),
  ]);
  if (!nodos.length) {
    nodos.push(el("p", { class: "sin-resultados" },
      estado.soloProblemas ? "Ningún servicio tiene problemas ahora mismo." : "Ningún servicio coincide con la búsqueda."));
  }
  $("#servicios").replaceChildren(...nodos);
}

function diasRecientes() {
  const dias = [];
  const hoy = new Date();
  for (let i = DIAS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - i));
    dias.push(d.toISOString().slice(0, 10));
  }
  return dias;
}

function tarjeta(p) {
  const nodo = $("#plantilla-servicio").content.firstElementChild.cloneNode(true);
  nodo.dataset.nivel = p.estado;
  nodo.id = `p-${p.id}`;
  nodo.querySelector(".nombre").textContent = p.nombre;
  nodo.querySelector(".estado").textContent = TEXTO[p.estado] + (p.incidencias.length > 1 ? ` (${p.incidencias.length})` : "");

  // Tira de 90 días
  const hist = estado.historial[p.id] || {};
  let muestras = 0, caidas = 0;
  const tira = nodo.querySelector(".tira");
  for (const d of diasRecientes()) {
    const h = hist[d];
    const span = document.createElement("span");
    const dia = fmtDia.format(new Date(d + "T00:00:00Z"));
    if (h) {
      muestras += h.m;
      caidas += h.c;
      span.dataset.nivel = h.peor;
      const pct = h.m ? ((1 - h.c / h.m) * 100).toFixed(1).replace(".", ",") : "100";
      span.title = `${dia}: ${h.peor === "operativo" ? "sin incidencias" : `peor momento ${TEXTO[h.peor].toLowerCase()}`}, ${pct} % disponible`;
    } else {
      span.title = `${dia}: sin datos`;
    }
    tira.append(span);
  }
  const pct = muestras ? (1 - caidas / muestras) * 100 : null;
  const textoPct = pct == null ? "—" : `${pct >= 99.995 ? "100" : pct.toFixed(2).replace(".", ",")} %`;
  nodo.querySelector(".porcentaje").textContent = textoPct;
  tira.setAttribute("aria-label", pct == null
    ? "Aún no hay historial"
    : `Disponibilidad de los últimos ${DIAS} días: ${textoPct}`);

  // Vigilar
  const estrella = nodo.querySelector(".vigilar");
  const vigilado = estado.vigilados.has(p.id);
  estrella.setAttribute("aria-pressed", String(vigilado));
  estrella.title = vigilado ? "Dejar de vigilar" : "Vigilar este servicio";
  estrella.addEventListener("click", () => {
    estado.vigilados.has(p.id) ? estado.vigilados.delete(p.id) : estado.vigilados.add(p.id);
    guardarLocal("vigilados", [...estado.vigilados]);
    pintarServicios();
    $("#avisos").hidden = !("Notification" in window) || !estado.vigilados.size || Notification.permission === "granted";
  });

  // Detalle
  const abrir = nodo.querySelector(".abrir");
  const detalle = nodo.querySelector(".detalle");
  const alternar = (forzar) => {
    const abierto = forzar ?? detalle.hidden;
    detalle.hidden = !abierto;
    abrir.setAttribute("aria-expanded", String(abierto));
    if (abierto) { estado.abiertos.add(p.id); detalle.replaceChildren(...contenidoDetalle(p)); }
    else estado.abiertos.delete(p.id);
  };
  abrir.addEventListener("click", () => {
    alternar();
    history.replaceState(null, "", estado.abiertos.has(p.id) ? `#p=${p.id}` : location.pathname + location.search);
  });
  if (estado.abiertos.has(p.id)) alternar(true);
  return nodo;
}

function contenidoDetalle(p) {
  const partes = [];
  const f = p.fuente || {};
  if (!f.ok) {
    partes.push(el("p", { class: "aviso-fuente" }, f.ultimo_ok
      ? `Su página de estado no responde (${f.error}). Mostramos lo último que publicó, ${hace(f.ultimo_ok)}.`
      : `Su página de estado no responde (${f.error}).`));
  }
  if (p.incidencias.length) {
    partes.push(el("div", {}, el("h3", {}, "Incidencias abiertas"), el("ul", {}, p.incidencias.map((i) =>
      el("li", {},
        el("a", { href: i.enlace, target: "_blank", rel: "noopener" }, i.titulo),
        " ", el("span", { class: "etiqueta-nivel", nivel: i.impacto }, TEXTO[i.impacto]),
        i.mensaje && el("p", { class: "activa-mensaje", lang: "en" }, i.mensaje))))));
  }
  if (p.componentes.length) {
    const titulo = p.total_componentes ? `Componentes afectados (${p.componentes.length} de ${p.total_componentes})` : "Afectado";
    partes.push(el("div", {}, el("h3", {}, titulo), el("ul", {}, p.componentes.map((c) =>
      el("li", { class: "componente" }, el("span", {}, c.nombre), el("span", { class: "etiqueta-nivel", nivel: c.estado }, TEXTO[c.estado]))))));
  }
  if (p.mantenimientos.length) {
    partes.push(el("div", {}, el("h3", {}, "Mantenimientos"), el("ul", {}, p.mantenimientos.map((m) =>
      el("li", {}, el("a", { href: m.enlace, target: "_blank", rel: "noopener" }, m.titulo), ` ${m.en_curso ? "en curso" : fecha(m.inicio)}`)))));
  }
  if (!partes.length || (f.ok && !p.incidencias.length && !p.componentes.length && !p.mantenimientos.length)) {
    partes.push(el("p", { class: "vacio" }, p.resumen && !/^sin incidencias/i.test(p.resumen)
      ? `El proveedor dice: ${p.resumen}.`
      : "Sin incidencias ni mantenimientos."));
  }
  partes.push(el("p", {}, el("a", { href: p.web, target: "_blank", rel: "noopener" }, `Página de estado oficial de ${p.nombre}`)));
  return partes;
}

function pintarMantenimientos() {
  const filas = estado.datos.proveedores.flatMap((p) => p.mantenimientos.map((m) => ({ p, m })))
    .sort((a, b) => Number(b.m.en_curso) - Number(a.m.en_curso) || String(a.m.inicio).localeCompare(String(b.m.inicio)));
  $("#bloque-mantenimientos").hidden = !filas.length;
  $("#mantenimientos").replaceChildren(...filas.map(({ p, m }) => el("li", {},
    el("span", { class: "cuando" }, m.en_curso ? "Ahora" : fecha(m.inicio) || "Fecha por confirmar"),
    el("span", { class: "que" }, el("b", {}, p.nombre), el("a", { href: m.enlace, target: "_blank", rel: "noopener" }, m.titulo),
      m.fin ? ` hasta ${fecha(m.fin)}` : ""))));
}

function pintarRecientes() {
  const nombres = Object.fromEntries(estado.datos.proveedores.map((p) => [p.id, p.nombre]));
  const filas = Object.values(estado.registro)
    .filter((r) => nombres[r.proveedor])
    .sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)))
    .slice(0, 40);
  $("#bloque-recientes").hidden = !filas.length;
  $("#recientes").replaceChildren(...filas.map((r) => el("li", { nivel: r.impacto },
    el("span", { class: "cuando" }, fecha(r.inicio)),
    el("span", { class: "que" }, el("b", {}, nombres[r.proveedor]),
      el("a", { href: r.enlace, target: "_blank", rel: "noopener" }, r.titulo), " ",
      el("span", { class: "duracion" }, r.fin ? `Duró ${duracion(r.inicio, r.fin)}` : `Sigue abierta, desde hace ${duracion(r.inicio, Date.now())}`)))));
}

// ------------------------------------------------------------ navegación y avisos

function irA(id) {
  estado.abiertos.add(id);
  if (!visibles().some((p) => p.id === id)) {
    estado.categoria = "todas"; estado.busqueda = ""; estado.soloProblemas = false;
    $("#buscar").value = ""; $("#solo-problemas").checked = false;
    pintarCategorias();
  }
  pintarServicios();
  history.replaceState(null, "", `#p=${id}`);
  const nodo = document.getElementById(`p-${id}`);
  if (nodo) {
    nodo.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    nodo.querySelector(".abrir").focus({ preventScroll: true });
  }
}

function avisarCambios(datos) {
  const actuales = Object.fromEntries(datos.proveedores.map((p) => [p.id, p.estado]));
  const previos = estado.anteriores;
  estado.anteriores = actuales;
  if (!previos || !("Notification" in window) || Notification.permission !== "granted") return;
  for (const p of datos.proveedores) {
    if (!estado.vigilados.has(p.id) || !(p.id in previos)) continue;
    const antes = RANGO[previos[p.id]] ?? -1, ahora = RANGO[p.estado];
    if (ahora >= RANGO.degradado && ahora > antes) {
      new Notification(`${p.nombre}: ${TEXTO[p.estado].toLowerCase()}`, { body: p.incidencias[0]?.titulo || p.resumen || "", tag: `uptime-${p.id}` });
    } else if (antes >= RANGO.degradado && ahora < RANGO.degradado) {
      new Notification(`${p.nombre} vuelve a funcionar`, { tag: `uptime-${p.id}` });
    }
  }
}

$("#avisos").addEventListener("click", async () => {
  const permiso = await Notification.requestPermission();
  $("#avisos").hidden = permiso === "granted";
  if (permiso === "denied") $("#avisos").textContent = "El navegador tiene bloqueados los avisos de esta web";
});

$("#buscar").addEventListener("input", (e) => { estado.busqueda = e.target.value; pintarServicios(); });
$("#solo-problemas").addEventListener("change", (e) => { estado.soloProblemas = e.target.checked; pintarServicios(); });

const inicial = location.hash.match(/^#p=([\w-]+)/)?.[1];
cargar().then(() => { if (inicial && estado.datos) irA(inicial); });
setInterval(cargar, REFRESCO_MS);
setInterval(() => estado.datos && pintarActualizado(), 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && estado.datos && Date.now() - new Date(estado.datos.actualizado) > REFRESCO_MS) cargar();
});
