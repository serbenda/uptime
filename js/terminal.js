"use strict";

// Terminal de la cabecera: una shell de juguete que responde con los datos reales de la página.
// Usa las funciones y el estado de app.js. Nada de lo que se escribe sale del navegador.

(() => {
  const sesion = $("#sesion");
  const form = $("#entrada");
  const input = $("#orden");
  const MAX_NODOS = 300;            // líneas de salida que se conservan
  const historial = leerLocal("historial", []).filter((x) => typeof x === "string").slice(-50);
  let posicion = historial.length;

  // ---------------------------------------------------------- salida

  const linea = (...hijos) => { const n = el("div", { class: "linea" }, ...hijos); sesion.append(n); return n; };
  const tenue = (texto) => el("span", { class: "tenue" }, texto);
  const led = (nivel, texto = "●") => el("span", { class: "nivel", nivel }, texto);
  const error = (texto) => linea(el("span", { class: "t-error" }, texto));

  function tabla(columnas, filas, cabecera) {
    const n = el("div", { class: "t-tabla", style: `grid-template-columns: ${columnas}` });
    if (cabecera) for (const c of cabecera) n.append(el("span", { class: "t-cabecera" }, c));
    for (const f of filas) for (const c of f) n.append(typeof c === "string" ? el("span", {}, c) : c);
    sesion.append(n);
    return n;
  }

  function enlace(p) {
    return el("button", { type: "button", class: "t-enlace", title: T.term.abrir, onclick: () => irA(p.id) }, p.id);
  }

  function recortar() {
    while (sesion.childNodes.length > MAX_NODOS) sesion.firstChild.remove();
  }

  // ---------------------------------------------------------- búsqueda de servicios y lugares

  const normalizar = (t) => String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  function buscarServicio(texto) {
    const q = normalizar(texto).replace(/\.service$/, "");
    const lista = estado.datos.proveedores;
    const exacto = lista.find((p) => p.id === q || normalizar(p.nombre) === q);
    if (exacto) return { p: exacto };
    const parecidos = lista.filter((p) => p.id.startsWith(q) || normalizar(p.nombre).includes(q));
    if (parecidos.length === 1) return { p: parecidos[0] };
    return { varios: parecidos };
  }

  function servicioDe(args, orden) {
    if (!args.length) { error(T.term.falta(T.term.uso[orden])); return null; }
    const r = buscarServicio(args.join(" "));
    if (r.p) return r.p;
    error(r.varios.length ? T.term.varios(r.varios.map((p) => p.id).join(", ")) : T.term.no_existe(args.join(" ")));
    return null;
  }

  // nube, cloud, --nube, Nube…: todos llevan al mismo rack
  function rackDe(texto) {
    const q = normalizar(texto).replace(/^-+/, "").replace(/\/$/, "");
    for (const id of Object.keys(estado.datos.categorias)) {
      const nombres = [id, ...Object.values(IDIOMAS).flatMap((I) => [I.categorias[id], I.flags[id]])].filter(Boolean);
      if (nombres.some((n) => normalizar(n).replace(/^-+/, "") === q)) return id;
    }
    return null;
  }

  const host = (p) => { try { return new URL(p.web).host; } catch { return p.web; } };

  // ---------------------------------------------------------- órdenes

  const ORDENES = {
    help() {
      linea(tenue(T.term.ayuda_cabecera));
      const filas = Object.keys(T.term.desc).map((o) => [
        el("span", { class: "t-orden" }, T.term.uso[o] ?? o), tenue(T.term.desc[o])]);
      tabla("max-content 1fr", filas);
      linea(tenue(T.term.ayuda_pie));
    },

    uptime() { linea(lineaUptime().trim()); },

    systemctl(args) {
      if (args[0] === "status") {
        if (args.length > 1) return ORDENES.status(args.slice(1));
        return linea(led($("#veredicto").dataset.nivel, `● ${$("#marca").textContent.trim()} `), $("#titular").textContent);
      }
      if (args[0] !== "--failed" && args[0] !== "list-units") return error(T.term.falta(T.term.uso.systemctl));
      const malos = estado.datos.proveedores.filter(conFallos).sort((a, b) => RANGO[b.estado] - RANGO[a.estado]);
      if (malos.length) {
        tabla("max-content max-content 1fr", malos.map((p) => {
          const i = p.incidencias.find((x) => x.impacto !== "aviso");
          return [el("span", {}, led(p.estado, "● "), enlace(p)), led(p.estado, nivelTexto(p.estado)),
            el("span", { lang: "en", class: "tenue" }, i?.titulo || p.resumen || "")];
        }), T.term.cab_fallos);
      }
      linea(tenue(T.term.unidades_fallo(malos.length)));
    },

    status(args) {
      const p = servicioDe(args, "status");
      if (!p) return;
      const f = p.fuente || {};
      const { pct, diasMalos } = disponibilidad(p.id);
      const afectados = p.afectados ?? p.componentes.length;
      linea(led(p.estado, "● "), el("b", {}, `${p.id}.service`), ` - ${p.nombre}`);
      const filas = [
        [T.term.fuente, el("span", {}, host(p), tenue(`, ${f.ok ? T.respondio(hace(f.comprobado)) : T.no_responde(f.error, f.ultimo_ok && hace(f.ultimo_ok))}`))],
        [T.term.estado_k, el("span", {}, led(p.estado, nivelTexto(p.estado)),
          p.resumen && !/^sin incidencias/i.test(p.resumen) ? el("span", { class: "tenue", lang: "en" }, ` (${p.resumen})`) : "")],
      ];
      if (pct != null) filas.push([T.term.noventa, T.disponibilidad(porcentaje(pct), diasMalos, disponibilidad(p.id).dias)]);
      if (p.total_componentes) filas.push([T.term.componentes, afectados ? T.afectados_de(afectados, p.total_componentes) : T.todos_ok(p.total_componentes)]);
      const inc = p.incidencias.filter((i) => i.impacto !== "aviso");
      filas.push([T.term.incidencias, inc.length ? String(inc.length) : "0"]);
      tabla("max-content 1fr", filas.map(([k, v]) => [el("span", { class: "t-clave" }, `${k}:`), v]));
      for (const i of inc.slice(0, 5)) {
        linea("  ", led(i.impacto, "● "), el("a", { href: i.enlace, target: "_blank", rel: "noopener", lang: "en" }, i.titulo), tenue(` ${fecha(i.inicio)}`));
      }
      linea(el("button", { type: "button", class: "t-enlace", onclick: () => irA(p.id) }, `[${T.term.abrir}]`));
    },

    ls(args) {
      const largo = args.includes("-l") || args.includes("-la") || args.includes("-al");
      const nombre = args.find((a) => !a.startsWith("-"));
      let racks = Object.keys(estado.datos.categorias);
      if (nombre) {
        const id = rackDe(nombre);
        if (!id) return error(T.term.rack_desconocido(nombre, racks.map((r) => T.flags[r].replace(/^--/, "")).join(" ")));
        racks = [id];
      }
      for (const id of racks) {
        const ps = estado.datos.proveedores.filter((p) => p.categoria === id)
          .sort((a, b) => RANGO[b.estado] - RANGO[a.estado] || a.id.localeCompare(b.id));
        const carpeta = `${T.flags[id].replace(/^--/, "")}/`;
        if (largo || nombre) {
          linea(el("b", { class: "t-carpeta" }, carpeta), tenue(` ${nombreCategoria(id)}`));
          tabla("max-content max-content max-content", ps.map((p) => {
            const { pct } = disponibilidad(p.id);
            return [el("span", {}, "  ", led(p.estado, "● "), enlace(p)), led(p.estado, nivelTexto(p.estado)), tenue(pct == null ? "--" : porcentaje(pct))];
          }));
        } else {
          linea(el("b", { class: "t-carpeta" }, carpeta.padEnd(14)), ...ps.flatMap((p) => [led(p.estado, "●"), " ", enlace(p), "  "]));
        }
      }
    },

    journalctl(args) {
      const filtro = args.filter((a) => !a.startsWith("-"));
      let lista = estado.datos.proveedores;
      if (filtro.length) {
        const p = servicioDe(filtro, "journalctl");
        if (!p) return;
        lista = [p];
      }
      const filas = lista.flatMap((p) => p.incidencias.map((i) => ({ p, i })))
        .sort((a, b) => String(b.i.inicio).localeCompare(String(a.i.inicio)));
      if (!filas.length) return linea(tenue(T.term.sin_entradas));
      for (const { p, i } of filas.slice(0, 25)) {
        linea(tenue(`${fecha(i.inicio || i.actualizado)} `), enlace(p), ": ",
          el("a", { href: i.enlace, target: "_blank", rel: "noopener", lang: "en" }, i.titulo), " ", led(i.impacto, `[${nivelTexto(i.impacto)}]`));
      }
    },

    geoiplookup(args) {
      const grupos = lugaresActuales();
      if (!grupos.length) return linea(tenue(T.term.sin_lugares));
      let elegidos = grupos;
      if (args.length) {
        const plano = (t) => normalizar(t).replace(/[-_]+/g, " ");
        const q = plano(args.join(" "));
        elegidos = grupos.filter((g) => [g.lugar.id.replace(/^[@Z]:?/, ""), g.lugar.en, g.lugar.es, g.lugar.pais_en, g.lugar.pais_es]
          .some((n) => n && plano(n).includes(q)));
        if (!elegidos.length) return error(T.term.sin_lugar(args.join(" ")));
        if (elegidos.length === 1 && estado.lugarElegido !== elegidos[0].lugar.id) elegirLugar(elegidos[0].lugar.id);
      }
      tabla("max-content max-content 1fr", elegidos.slice(0, 30).map((g) => [
        el("span", {}, led(g.nivel, "● "), el("button", { type: "button", class: "t-enlace", onclick: () => elegirLugar(g.lugar.id) }, nombreLugar(g.lugar))),
        tenue(coordenadas(g.lugar.lat, g.lugar.lon)),
        el("span", {}, ...g.proveedores.flatMap((v, k) => [k ? ", " : "", enlace(v.p), led(v.nivel, ` (${nivelTexto(v.nivel)})`)]))]));
    },

    top() {
      const filas = estado.datos.proveedores.map((p) => ({ p, ...disponibilidad(p.id) }))
        .filter((x) => x.pct != null).sort((a, b) => a.pct - b.pct).slice(0, 10);
      tabla("max-content max-content max-content", filas.map(({ p, pct, diasMalos }) =>
        [el("span", {}, led(p.estado, "● "), enlace(p)), porcentaje(pct), String(diasMalos)]), T.term.cab_top);
    },

    ping(args) {
      const p = servicioDe(args, "ping");
      if (!p) return;
      const f = p.fuente || {};
      linea(f.ok ? T.term.ping(host(p), hace(f.comprobado)) : el("span", { class: "t-error" }, T.term.ping_error(host(p), f.error)),
        " ", led(p.estado, `[${nivelTexto(p.estado)}]`));
      linea(tenue(T.term.ping_nota));
    },

    crontab(args) {
      if (args[0] !== "-l") return error(T.term.falta(T.term.uso.crontab));
      const filas = estado.datos.proveedores.flatMap((p) => p.mantenimientos.map((m) => ({ p, m })))
        .sort((a, b) => Number(b.m.en_curso) - Number(a.m.en_curso) || String(a.m.inicio).localeCompare(String(b.m.inicio)));
      if (!filas.length) return linea(tenue(T.term.sin_mant));
      for (const { p, m } of filas.slice(0, 20)) {
        linea(tenue(`${(m.en_curso ? T.en_curso : fecha(m.inicio) || T.sin_fecha).padEnd(13)} `), enlace(p), " ",
          el("a", { href: m.enlace, target: "_blank", rel: "noopener", lang: "en" }, m.titulo));
      }
      if (filas.length > 20) linea(tenue(T.y_mas(filas.length - 20)));
    },

    last() {
      const filas = Object.values(estado.registro).filter((r) => r.impacto !== "aviso")
        .sort((a, b) => String(b.inicio).localeCompare(String(a.inicio))).slice(0, 15);
      if (!filas.length) return linea(tenue(T.term.sin_entradas));
      const porId = Object.fromEntries(estado.datos.proveedores.map((p) => [p.id, p]));
      for (const r of filas) {
        linea(tenue(`${fecha(r.inicio)} `), porId[r.proveedor] ? enlace(porId[r.proveedor]) : r.proveedor, " ",
          el("a", { href: r.enlace, target: "_blank", rel: "noopener", lang: "en" }, r.titulo), " ",
          tenue(r.fin ? `(${duracion(r.inicio, r.fin)})` : T.sigue_abierta));
      }
    },

    grep(args) {
      if (!args.length) return error(T.term.falta(T.term.uso.grep));
      const q = normalizar(args.join(" "));
      let hay = false;
      for (const p of estado.datos.proveedores) {
        const textos = [p.nombre, ...p.incidencias.map((i) => i.titulo), ...p.componentes.map((c) => c.nombre)];
        for (const t of new Set(textos.filter((x) => x && normalizar(x).includes(q)))) {
          hay = true;
          const i = normalizar(t).indexOf(q);
          linea(enlace(p), tenue(": "), t.slice(0, i), el("mark", {}, t.slice(i, i + q.length)), t.slice(i + q.length));
        }
      }
      if (!hay) linea(tenue(T.term.sin_grep));
    },

    neofetch() {
      const racks = Object.keys(estado.datos.categorias).map((id) => {
        const ps = estado.datos.proveedores.filter((p) => p.categoria === id);
        return ps.reduce((n, p) => (RANGO[p.estado] > RANGO[n] ? p.estado : n), "operativo");
      });
      const arte = el("pre", { class: "t-arte", "aria-hidden": "true" },
        "┌──────────────┐\n",
        ...racks.flatMap((n, i) => [`│ `, led(n, "●"), ` ▪▪ ▬▬▬▬▬▬ │\n`, i < racks.length - 1 ? "├──────────────┤\n" : ""]),
        "└──────────────┘");
      const lista = estado.datos.proveedores;
      const N = T.term.neo;
      const info = el("div", { class: "t-info" },
        el("p", {}, el("b", { class: "prompt" }, "visitante@noc".replace("visitante", T.term.quien))),
        el("p", { class: "tenue" }, "─".repeat(14)),
        ...[
          [N.so, "uptime NOC"],
          ["Uptime", lineaUptime().trim().split(",")[0].replace(/^\S+\s+up\s+/, "")],
          [N.servicios, String(lista.length)],
          [N.racks, String(racks.length)],
          [N.fallos, String(lista.filter(conFallos).length)],
          [N.lugares, String(lugaresActuales().length)],
          [N.datos, hace(estado.datos.actualizado)],
          [N.idioma, T.codigo],
          [N.shell, N.shell_v],
        ].map(([k, v]) => el("p", {}, el("span", { class: "t-clave" }, `${k}: `), v)),
        el("p", { class: "t-paleta", "aria-hidden": "true" }, ...["operativo", "mantenimiento", "degradado", "parcial", "grave", "desconocido"].map((n) => led(n, "███"))));
      sesion.append(el("div", { class: "t-neofetch" }, arte, info));
    },

    lang(args) {
      const pedido = normalizar(args.join(" ").replace(/^LANG=/i, "")).slice(0, 2);
      if (!elegirIdioma(pedido)) return error(T.term.falta(T.term.uso.lang));
      linea(tenue(T.term.lang_ok(T.codigo)));
    },

    export(args) {
      const m = args.join(" ").match(/^LANG=(\w\w)/i);
      if (m) return ORDENES.lang([m[1]]);
      linea("");
    },

    sponsor() {
      for (const t of T.term.sponsor) linea(t);
      linea("→ ", el("a", { href: "https://github.com/sponsors/serbenda", target: "_blank", rel: "noopener" }, T.term.sponsor_enlace));
    },

    history() {
      if (!historial.length) return linea(tenue(T.term.vacio));
      tabla("max-content 1fr", historial.map((h, i) => [tenue(String(i + 1).padStart(4)), h]));
    },

    clear() { sesion.replaceChildren(); },
    date() { linea(new Date().toLocaleString(T.html, { dateStyle: "full", timeStyle: "long" })); },
    whoami() { linea(T.term.quien); },
    echo(args) { linea(args.join(" ")); },

    man(args) {
      const o = args[0];
      if (!o || !T.term.desc[o]) return error(o ? T.term.sin_man(o) : T.term.falta(T.term.uso.man));
      linea(el("b", {}, T.term.uso[o] ?? o));
      linea("    ", T.term.desc[o]);
    },

    sudo() { error(T.term.sudo); },
    rm() { error(T.term.rm); },
    exit() { linea(T.term.exit); },
    coffee() { linea(T.term.cafe); },
    hello() { linea(T.term.hola); },
  };

  // Sinónimos
  Object.assign(ORDENES, {
    ayuda: ORDENES.help, "?": ORDENES.help, cls: ORDENES.clear, logout: ORDENES.exit, quit: ORDENES.exit, salir: ORDENES.exit,
    cafe: ORDENES.coffee, "café": ORDENES.coffee, brew: ORDENES.coffee, hola: ORDENES.hello, hi: ORDENES.hello,
    dir: ORDENES.ls, ll: (a) => ORDENES.ls(["-l", ...a]), donate: ORDENES.sponsor, patrocinar: ORDENES.sponsor,
    fastfetch: ORDENES.neofetch, journal: ORDENES.journalctl, where: ORDENES.geoiplookup, top10: ORDENES.top, htop: ORDENES.top,
  });

  const VISIBLES = Object.keys(T.term.desc);

  // ---------------------------------------------------------- ejecutar

  function partir(texto) {
    return (texto.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((t) => t.replace(/^(["'])(.*)\1$/, "$2"));
  }

  function distancia(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }

  function ejecutar(texto) {
    const limpio = texto.trim().slice(0, 200);
    linea(el("span", { class: "prompt" }, "bendi@noc:~$ "), limpio);
    if (!limpio) return;
    if (historial.at(-1) !== limpio) historial.push(limpio);
    while (historial.length > 50) historial.shift();
    posicion = historial.length;
    guardarLocal("historial", historial);

    if (!estado.datos && !["help", "clear", "lang", "echo", "whoami", "date", "history", "man"].includes(limpio.split(/\s/)[0])) {
      return error(T.sin_conexion);
    }
    const [orden, ...args] = partir(limpio);
    const nombre = orden.toLowerCase();
    const accion = Object.hasOwn(ORDENES, nombre) ? ORDENES[nombre] : null;
    if (accion) {
      try { accion(args); } catch (e) { console.error(e); error(`${nombre}: ${e.message}`); }
    } else {
      error(T.term.no_encontrada(orden));
      const cerca = VISIBLES.map((o) => [o, distancia(nombre, o)]).sort((a, b) => a[1] - b[1])[0];
      if (cerca && cerca[1] <= 2) linea(tenue(T.term.quizas(cerca[0])));
    }
    recortar();
  }

  function desplazar() {
    sesion.scrollTop = sesion.scrollHeight;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    ejecutar(input.value);
    input.value = "";
    desplazar();
  });

  // ---------------------------------------------------------- teclado: historial, Tab, Ctrl+L, Ctrl+C

  function candidatos(palabras, ultima) {
    if (palabras.length <= 1) return VISIBLES;
    const o = palabras[0].toLowerCase();
    if (["status", "ping", "journalctl"].includes(o) || (o === "systemctl" && palabras[1] === "status" && palabras.length > 2)) {
      return estado.datos?.proveedores.map((p) => p.id) ?? [];
    }
    if (o === "systemctl") return ["--failed", "status"];
    if (o === "crontab") return ["-l"];
    if (o === "ls") return Object.keys(estado.datos?.categorias ?? {}).map((id) => T.flags[id].replace(/^--/, "")).concat("-l");
    if (o === "lang") return Object.keys(IDIOMAS);
    if (o === "man") return VISIBLES;
    if (o === "geoiplookup") return lugaresActuales().map((g) => normalizar(nombreLugar(g.lugar)).replace(/\s+/g, "-"));
    return [];
  }

  function completar() {
    const valor = input.value;
    const palabras = valor.split(/\s+/);
    const ultima = palabras.at(-1);
    const opciones = candidatos(palabras, ultima).filter((c) => c.startsWith(ultima.toLowerCase()));
    if (!opciones.length) return;
    // prefijo común de todas las opciones
    let comun = opciones[0];
    for (const o of opciones) while (!o.startsWith(comun)) comun = comun.slice(0, -1);
    if (opciones.length === 1) {
      input.value = valor.slice(0, valor.length - ultima.length) + opciones[0] + " ";
    } else if (comun.length > ultima.length) {
      input.value = valor.slice(0, valor.length - ultima.length) + comun;
    } else {
      linea(el("span", { class: "prompt" }, "bendi@noc:~$ "), valor);
      linea(tenue(opciones.slice(0, 40).join("  ")));
      recortar();
      desplazar();
    }
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && historial.length) {
      e.preventDefault();
      posicion = Math.max(0, posicion - 1);
      input.value = historial[posicion];
    } else if (e.key === "ArrowDown" && historial.length) {
      e.preventDefault();
      posicion = Math.min(historial.length, posicion + 1);
      input.value = historial[posicion] ?? "";
    } else if (e.key === "Tab" && input.value.trim()) {
      e.preventDefault();
      completar();
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      ORDENES.clear();
    } else if (e.key === "c" && e.ctrlKey && input.selectionStart === input.selectionEnd) {
      e.preventDefault();
      linea(el("span", { class: "prompt" }, "bendi@noc:~$ "), input.value, "^C");
      input.value = "";
      desplazar();
    } else if (e.key === "Escape") {
      input.value = "";
    }
  });

  // Pulsar en la consola lleva el foco a la línea de órdenes (salvo si se está seleccionando texto o se pulsa un enlace)
  $("#consola").addEventListener("click", (e) => {
    if (e.target.closest("a, button, input") || String(getSelection())) return;
    input.focus({ preventScroll: true });
  });

  // "/" desde cualquier sitio que no sea un campo de texto lleva a la terminal
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest("input, textarea, select, [contenteditable]")) return;
    e.preventDefault();
    input.focus();
  });

  // ---------------------------------------------------------- sugerencias bajo la línea de órdenes

  function pintarAtajos() {
    const sugerencias = ["help", "systemctl --failed"];
    const peor = estado.datos?.proveedores.filter(conFallos).sort((a, b) => RANGO[b.estado] - RANGO[a.estado])[0];
    sugerencias.push(`status ${peor?.id ?? "github"}`);
    const lugar = estado.datos && lugaresActuales()[0];
    if (lugar) sugerencias.push(`geoiplookup ${normalizar(nombreLugar(lugar.lugar)).replace(/\s+/g, "-")}`);
    sugerencias.push("neofetch");
    $("#atajos").replaceChildren(tenue(`${T.term.prueba} `), ...sugerencias.map((s) =>
      el("button", { type: "button", class: "atajo", onclick: () => { ejecutar(s); desplazar(); } }, s)));
  }

  // Las sugerencias dependen de los datos y del idioma: se repintan con el resto de la página
  const pintarPagina = pintar;
  pintar = function () { pintarPagina(); pintarAtajos(); };
  pintarAtajos();
})();
