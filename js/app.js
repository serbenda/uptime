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
const TEXTO = {
  operativo: "operativo",
  mantenimiento: "mantenimiento",
  degradado: "degradado",
  parcial: "caída parcial",
  grave: "caída grave",
  desconocido: "sin datos",
  aviso: "aviso",
};
const COLOR = { operativo: "43D17F", mantenimiento: "5AA9FF", degradado: "F2C230", parcial: "FF8A2A", grave: "FF4D4D", desconocido: "6B7885" };

const $ = (s) => document.querySelector(s);
const estado = {
  datos: null,
  historial: {},
  registro: {},
  categoria: "todas",
  busqueda: "",
  soloProblemas: false,
  abiertos: new Set(),
  journalCompleto: false,
  fijados: new Set(leerLocal("fijados", leerLocal("vigilados", []))),
  anteriores: null,  // nivel de cada proveedor en la carga anterior, para avisar
  primeraVez: true,
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
  for (const h of hijos.flat()) if (h != null && h !== false && h !== "") n.append(h);
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
  if (a < 86400 * 45) return rtf.format(Math.round(s / 86400), "day");
  return rtf.format(Math.round(s / (86400 * 30)), "month");
}

// "02 nov 09:11", en la hora local de quien mira
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dos = (n) => String(n).padStart(2, "0");
function fecha(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${dos(d.getDate())} ${MESES[d.getMonth()]} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
}
const diaCorto = (ymd) => `${Number(ymd.slice(8))} ${MESES[Number(ymd.slice(5, 7)) - 1]}`;

function duracion(desde, hasta) {
  const min = Math.max(1, Math.round((new Date(hasta) - new Date(desde)) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.round(h / 24)} días`;
}

function enumerar(nombres) {
  if (nombres.length <= 1) return nombres.join("");
  return nombres.slice(0, -1).join(", ") + " y " + nombres.at(-1);
}

const conFallos = (p) => RANGO[p.estado] >= RANGO.degradado;
const porcentaje = (n) => `${n >= 99.995 ? "100" : n.toFixed(2)}%`;

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
    if (estado.primeraVez) { estado.primeraVez = false; escribirConsola(); }
  } catch (e) {
    console.error(e);
    if (!estado.datos) {
      $("#veredicto").dataset.nivel = "desconocido";
      $("#marca").textContent = "[ERROR ]";
      $("#titular").textContent = "No se han podido cargar los datos.";
      $("#subtitular").textContent = "Vuelve a intentarlo en unos minutos. Si persiste, puede que la rama de datos aún no exista.";
    }
    $("#actualizado").textContent = "sin conexión, se reintentará en 5 min";
  }
}

// ------------------------------------------------------------ pintar

function pintar() {
  pintarConsola();
  pintarJournal();
  pintarFiltros();
  pintarRacks();
  pintarMantenimientos();
  pintarRecientes();
  pintarActualizado();
  actualizarBotonAvisos();
}

function pintarActualizado() {
  const iso = estado.datos?.actualizado;
  if (!iso) return;
  const n = $("#actualizado");
  const viejo = (Date.now() - new Date(iso)) / 60000 > VIEJO_MIN;
  n.textContent = viejo ? `datos ${hace(iso)}: la actualización va con retraso` : `actualizado ${hace(iso)}`;
  n.title = fecha(iso);
  n.classList.toggle("viejo", viejo);
}

// `uptime` de verdad: hora, días de historial, servicios y "load average" de fallos
function lineaUptime() {
  const lista = estado.datos.proveedores;
  const ahora = new Date();
  const hora = `${dos(ahora.getHours())}:${dos(ahora.getMinutes())}:${dos(ahora.getSeconds())}`;
  const dias = Math.max(0, ...Object.values(estado.historial).map((h) => Object.keys(h).length));
  const ahoraCarga = lista.filter(conFallos).length / lista.length;
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
  const caidos = lista.filter(conFallos).length;
  return ` ${hora} up ${dias} ${dias === 1 ? "día" : "días"},  ${lista.length} servicios,  ${caidos} con fallos,  ` +
    `load average: ${ahoraCarga.toFixed(2)}, ${media(7).toFixed(2)}, ${media(30).toFixed(2)}`;
}

function pintarConsola() {
  const lista = estado.datos.proveedores;
  const malos = lista.filter(conFallos).sort((a, b) => RANGO[b.estado] - RANGO[a.estado] || a.nombre.localeCompare(b.nombre, "es"));
  const mant = lista.filter((p) => p.estado === "mantenimiento");
  const sinDatos = lista.filter((p) => p.estado === "desconocido");
  const nivel = malos[0]?.estado ?? (mant.length ? "mantenimiento" : "operativo");

  const uptime = $("#linea-uptime");
  uptime.textContent = lineaUptime();
  uptime.title = "load average: fracción de servicios con caída parcial o grave ahora, de media en 7 días y en 30 días";

  $("#orden-estado").textContent = malos.length ? "systemctl --failed" : "systemctl status proveedores";
  $("#veredicto").dataset.nivel = nivel;
  $("#marca").textContent = malos.length ? "[FAILED]" : "[  OK  ]";
  $("#titular").textContent = !malos.length ? "Todo funciona."
    : malos.length <= 3 ? `${enumerar(malos.map((p) => p.nombre))} ${malos.length === 1 ? "tiene" : "tienen"} problemas.`
    : `${malos.length} servicios tienen problemas.`;

  const partes = [`${lista.length} servicios`, `${lista.length - malos.length - mant.length - sinDatos.length} operativos`];
  if (mant.length) partes.push(`${mant.length} en mantenimiento`);
  if (malos.length) partes.push(`${malos.length} con fallos`);
  if (sinDatos.length) partes.push(`${sinDatos.length} sin datos`);
  $("#subtitular").textContent = partes.join(", ");

  $("#fallos").replaceChildren(...malos.map((p) => {
    const i = [...p.incidencias].sort((a, b) => (RANGO[b.impacto] ?? 0) - (RANGO[a.impacto] ?? 0))[0];
    const texto = i?.titulo || ((p.afectados ?? p.componentes.length) ? `${p.afectados ?? p.componentes.length} de ${p.total_componentes} componentes afectados` : p.resumen);
    return el("li", { nivel: p.estado },
      el("span", { "aria-hidden": "true" }, "●"),
      el("a", { href: `#p=${p.id}`, onclick: (e) => { e.preventDefault(); irA(p.id); } }, p.nombre),
      el("span", { class: "fallo-nivel" }, TEXTO[p.estado]),
      el("span", { class: "fallo-texto", lang: "en" }, texto || ""));
  }));

  document.title = malos.length ? `(${malos.length}) uptime` : "uptime";
  $("#favicon").href = "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect x='2' y='6' width='28' height='20' rx='3' fill='#202A34'/><circle cx='9' cy='16' r='4' fill='#${COLOR[nivel]}'/></svg>`);
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
        el("span", { class: "j-nivel" }, TEXTO[i.impacto]),
        el("span", { class: "j-titulo", lang: "en" }, i.titulo || "Incidencia sin título")),
      el("div", { class: "j-detalle" },
        el("p", {}, [i.fase, i.inicio && `empezó ${hace(i.inicio)}`, i.actualizado && `actualizada ${hace(i.actualizado)}`,
          i.afecta?.length && `afecta a ${enumerar(i.afecta)}`].filter(Boolean).join(", ")),
        i.mensaje && el("p", { lang: "en" }, i.mensaje),
        el("p", {}, el("a", { href: i.enlace, target: "_blank", rel: "noopener" }, `Ver en la página de ${p.nombre}`)))))),
    resto > 0 && el("li", {}, el("button", { type: "button", class: "mas",
      onclick: () => { estado.journalCompleto = true; pintarJournal(); } }, `-- ${resto} entradas más, pulsa para verlas --`)));
}

function pintarFiltros() {
  const cats = { todas: "todos", ...Object.fromEntries(Object.entries(estado.datos.categorias).map(([k, v]) => [k, v.toLowerCase()])) };
  $("#categorias").replaceChildren(...Object.entries(cats).map(([id, nombre]) =>
    el("button", {
      type: "button",
      class: "flag",
      "aria-pressed": String(estado.categoria === id),
      onclick: () => { estado.categoria = id; pintarFiltros(); pintarRacks(); },
    }, id === "todas" ? "--todos" : `--${id}`)));
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
  if (fijados.length) racks.push(["Fijados", fijados]);
  for (const [id, nombre] of Object.entries(estado.datos.categorias)) {
    const resto = lista.filter((p) => p.categoria === id && !estado.fijados.has(p.id));
    if (resto.length) racks.push([nombre, resto]);
  }
  const ordenar = (a, b) => RANGO[b.estado] - RANGO[a.estado] || a.nombre.localeCompare(b.nombre, "es");
  const nodos = racks.map(([nombre, ps]) => {
    ps.sort(ordenar);
    const malos = ps.filter(conFallos).length;
    const peor = ps[0]?.estado ?? "operativo";
    return el("section", { class: "rack", "aria-label": `Rack ${nombre}` },
      el("header", { class: "rack-placa", nivel: peor },
        el("h3", { class: "rack-nombre" }, nombre),
        el("span", { class: "rack-cuenta" }, `${ps.length} ${ps.length === 1 ? "servidor" : "servidores"}`,
          malos ? [", ", el("b", {}, `${malos} con fallos`)] : "")),
      el("div", { class: "rack-hueco" }, ps.map((p, i) => servidor(p, ps.length - i))));
  });
  if (!nodos.length) {
    nodos.push(el("p", { class: "sin-resultados" },
      estado.soloProblemas ? "grep: ningún servicio con fallos ahora mismo." : "grep: ningún servicio coincide."));
  }
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
  nodo.querySelector(".estado").textContent = TEXTO[p.estado] + (n > 1 ? ` ×${n}` : "");

  // 90 días
  const hist = estado.historial[p.id] || {};
  const tira = nodo.querySelector(".historia");
  for (const d of diasRecientes()) {
    const h = hist[d];
    const barra = document.createElement("span");
    if (h) {
      barra.dataset.nivel = h.peor;
      const pct = h.m ? ((1 - h.c / h.m) * 100).toFixed(1) : "100";
      barra.title = `${diaCorto(d)}: ${h.peor === "operativo" ? "sin incidencias" : `lo peor, ${TEXTO[h.peor]}`} (${pct}% disponible)`;
    } else {
      barra.title = `${diaCorto(d)}: sin datos`;
    }
    tira.append(barra);
  }
  const { pct } = disponibilidad(p.id);
  const lcd = nodo.querySelector(".lcd");
  lcd.textContent = pct == null ? "--.--%" : porcentaje(pct);
  lcd.classList.toggle("vacio", pct == null);
  lcd.title = "Disponibilidad en los últimos 90 días";
  tira.setAttribute("aria-label", pct == null ? "Aún sin historial" : `Últimos ${DIAS} días: ${porcentaje(pct)} disponible`);

  // Fijar arriba
  const fijar = nodo.querySelector(".fijar");
  const fijado = estado.fijados.has(p.id);
  fijar.setAttribute("aria-pressed", String(fijado));
  fijar.title = fijado ? "Quitar de fijados" : "Fijar arriba y avisarme si falla";
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

  partes.push(fila("estado", el("span", { class: "nivel", nivel: p.estado }, `● ${TEXTO[p.estado]}`),
    p.resumen && !/^sin incidencias/i.test(p.resumen) ? el("span", { lang: "en" }, `  "${p.resumen}"`) : ""));
  partes.push(fila("fuente", host, ", ",
    f.ok ? `respondió ${hace(f.comprobado)}` : el("span", { class: "error" }, `no responde (${f.error}), último dato ${f.ultimo_ok ? hace(f.ultimo_ok) : "nunca"}`)));

  const { pct, diasMalos, dias } = disponibilidad(p.id);
  if (pct != null) {
    partes.push(fila("90 días", `${porcentaje(pct)} disponible, ${diasMalos} ${diasMalos === 1 ? "día" : "días"} con caída de ${dias} medidos`));
  }

  if (p.total_componentes || p.componentes.length) {
    const resumen = afectados
      ? `${afectados} de ${p.total_componentes || afectados} afectados`
      : `${p.total_componentes} componentes, todos operativos`;
    partes.push(fila("componentes", resumen,
      p.alcance_limitado ? el("span", { class: "clave" }, " (alcance pequeño: cuenta como degradado)") : ""));
    if (p.componentes.length) {
      partes.push(el("ul", { class: "sangria" }, p.componentes.map((c) =>
        el("li", { class: "item", nivel: c.estado }, el("span", {}, "●"), el("span", { lang: "en" }, c.nombre), el("span", { class: "nivel" }, TEXTO[c.estado])))));
      if (afectados > p.componentes.length) partes.push(el("p", { class: "sangria clave" }, `y ${afectados - p.componentes.length} más`));
    }
  }

  if (p.incidencias.length) {
    partes.push(el("p", { class: "bloque clave" }, "incidencias"));
    partes.push(el("ul", { class: "sangria" }, p.incidencias.map((i) => el("li", { nivel: i.impacto },
      el("div", { class: "item" }, el("span", {}, "●"),
        el("a", { href: i.enlace, target: "_blank", rel: "noopener", lang: "en" }, i.titulo),
        el("span", { class: "nivel" }, TEXTO[i.impacto])),
      el("p", { class: "sangria clave" }, [i.fase, i.inicio && `desde ${fecha(i.inicio)}`, i.actualizado && `actualizada ${hace(i.actualizado)}`].filter(Boolean).join(", ")),
      i.mensaje && el("p", { class: "mensaje", lang: "en" }, i.mensaje)))));
  }

  if (p.mantenimientos.length) {
    partes.push(el("p", { class: "bloque clave" }, "mantenimientos"));
    partes.push(el("ul", { class: "sangria" }, p.mantenimientos.map((m) => el("li", { class: "item", nivel: "mantenimiento" },
      el("span", {}, m.en_curso ? "●" : "○"),
      el("a", { href: m.enlace, target: "_blank", rel: "noopener", lang: "en" }, m.titulo),
      el("span", { class: "clave" }, m.en_curso ? "en curso" : fecha(m.inicio))))));
  }

  partes.push(el("p", { class: "bloque" }, el("a", { class: "enlace-oficial", href: p.web, target: "_blank", rel: "noopener" }, `abrir ${host}`)));
  return partes;
}

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
      el("span", { class: "t-cuando" }, m.en_curso ? "en curso" : fecha(m.inicio) || "sin fecha"),
      el("span", { class: "t-que" }, el("span", { class: "t-quien" }, p.id),
        el("a", { href: m.enlace, target: "_blank", rel: "noopener", lang: "en" }, m.titulo))));
  }
  for (const [id, n] of Object.entries(ocultos)) {
    nodos.push(el("li", {}, el("span", { class: "t-cuando" }, "..."),
      el("span", { class: "t-que t-resto" }, el("a", { href: `#p=${id}`, onclick: (e) => { e.preventDefault(); irA(id); } },
        `${id}: ${n} mantenimientos más`))));
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
      el("span", { class: "t-dura" }, r.fin ? `(${duracion(r.inicio, r.fin)})` : "(sigue abierta)")))));
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
      new Notification(`${p.nombre}: ${TEXTO[p.estado]}`, { body: p.incidencias[0]?.titulo || p.resumen || "", tag: `uptime-${p.id}` });
    } else if (antes >= RANGO.degradado && ahora < RANGO.degradado) {
      new Notification(`${p.nombre} vuelve a funcionar`, { tag: `uptime-${p.id}` });
    }
  }
}

$("#avisos").addEventListener("click", async () => {
  const permiso = await Notification.requestPermission();
  if (permiso === "denied") $("#avisos").textContent = "El navegador tiene bloqueados los avisos de esta web";
  else actualizarBotonAvisos();
});

$("#buscar").addEventListener("input", (e) => { estado.busqueda = e.target.value; pintarRacks(); });
$("#solo-problemas").addEventListener("change", (e) => { estado.soloProblemas = e.target.checked; pintarRacks(); });

const inicial = location.hash.match(/^#p=([\w-]+)/)?.[1];
cargar().then(() => { if (inicial && estado.datos) irA(inicial); });
setInterval(cargar, REFRESCO_MS);
setInterval(() => { if (estado.datos) { $("#linea-uptime").textContent = lineaUptime(); } }, 1000);
setInterval(() => estado.datos && pintarActualizado(), 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && estado.datos && Date.now() - new Date(estado.datos.actualizado) > REFRESCO_MS) cargar();
});
