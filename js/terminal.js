"use strict";

// The console's terminal: a toy shell that answers with the page's real data.
// It uses app.js's functions and state. Nothing typed here ever leaves the browser.

(() => {
  const session = $("#session");
  const form = $("#prompt-form");
  const input = $("#command");
  const MAX_NODES = 300;            // output lines kept
  const typed = readLocal(STORAGE.history, []).filter((x) => typeof x === "string").slice(-50);
  let position = typed.length;

  // ---------------------------------------------------------- output

  const line = (...children) => { const n = el("div", { class: "line" }, ...children); session.append(n); return n; };
  const dim = (text) => el("span", { class: "dim" }, text);
  const led = (level, text = "●") => el("span", { class: "level", level }, text);
  const error = (text) => line(el("span", { class: "t-error" }, text));

  function table(columns, rows, head) {
    const n = el("div", { class: "t-table", style: `grid-template-columns: ${columns}` });
    if (head) for (const c of head) n.append(el("span", { class: "t-head" }, c));
    for (const r of rows) for (const c of r) n.append(typeof c === "string" ? el("span", {}, c) : c);
    session.append(n);
    return n;
  }

  function link(p) {
    return el("button", { type: "button", class: "t-link", title: T.term.open_in_rack, onclick: () => goTo(p.id) }, p.id);
  }

  function trim() {
    while (session.childNodes.length > MAX_NODES) session.firstChild.remove();
  }

  // ---------------------------------------------------------- finding services and places

  const normalize = (t) => String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  function findService(text) {
    const q = normalize(text).replace(/\.service$/, "");
    const all = state.data.providers;
    const exact = all.find((p) => p.id === q || normalize(p.name) === q);
    if (exact) return { p: exact };
    const similar = all.filter((p) => p.id.startsWith(q) || normalize(p.name).includes(q));
    if (similar.length === 1) return { p: similar[0] };
    return { several: similar };
  }

  function serviceFrom(args, command) {
    if (!args.length) { error(T.term.usage_line(T.term.usage[command])); return null; }
    const r = findService(args.join(" "));
    if (r.p) return r.p;
    error(r.several.length ? T.term.several(r.several.map((p) => p.id).join(", ")) : T.term.no_such_service(args.join(" ")));
    return null;
  }

  // cloud, nube, --cloud, Nube…: they all lead to the same rack
  function rackFrom(text) {
    const q = normalize(text).replace(/^-+/, "").replace(/\/$/, "");
    for (const id of Object.keys(state.data.categories)) {
      const names = [id, ...Object.values(LANGUAGES).flatMap((L) => [L.categories[id], L.flags[id]])].filter(Boolean);
      if (names.some((n) => normalize(n).replace(/^-+/, "") === q)) return id;
    }
    return null;
  }

  const host = (p) => { try { return new URL(p.web).host; } catch { return p.web; } };
  const rackDir = (id) => T.flags[id].replace(/^--/, "");

  // ---------------------------------------------------------- commands

  const COMMANDS = {
    help() {
      line(dim(T.term.help_header));
      const rows = Object.keys(T.term.desc).map((o) => [
        el("span", { class: "t-cmd" }, T.term.usage[o] ?? o), dim(T.term.desc[o])]);
      table("max-content 1fr", rows);
      line(dim(T.term.help_footer));
    },

    uptime() { line(uptimeLine().trim()); },

    systemctl(args) {
      if (args[0] === "status") {
        if (args.length > 1) return COMMANDS.status(args.slice(1));
        return line(led($("#verdict").dataset.level, `● ${$("#mark").textContent.trim()} `), $("#headline").textContent);
      }
      if (args[0] === "list-units" && !args.includes("--failed")) return COMMANDS.services([]);
      if (args[0] !== "--failed" && args[0] !== "list-units") return error(T.term.usage_line(T.term.usage.systemctl));
      const failing = state.data.providers.filter(isFailing).sort((a, b) => RANK[b.status] - RANK[a.status]);
      if (failing.length) {
        table("max-content max-content 1fr", failing.map((p) => {
          const i = p.incidents.find((x) => x.impact !== "advisory");
          return [el("span", {}, led(p.status, "● "), link(p)), led(p.status, levelText(p.status)),
            el("span", { lang: "en", class: "dim" }, i?.title || p.description || "")];
        }), T.term.failed_header);
      }
      line(dim(T.term.failed_units(failing.length)));
    },

    status(args) {
      const p = serviceFrom(args, "status");
      if (!p) return;
      const f = p.source || {};
      const { pct, badDays, days } = availability(p.id);
      const affected = p.affected ?? p.components.length;
      line(led(p.status, "● "), el("b", {}, `${p.id}.service`), ` - ${p.name}`);
      const rows = [
        [T.term.source, el("span", {}, host(p), dim(`, ${f.ok ? T.responded(ago(f.checked)) : T.not_responding(f.error, f.last_ok && ago(f.last_ok))}`))],
        [T.term.status, el("span", {}, led(p.status, levelText(p.status)),
          p.description ? el("span", { class: "dim", lang: "en" }, ` (${p.description})`) : "")],
      ];
      if (pct != null) rows.push([T.term.days90, T.availability(percent(pct), badDays, days)]);
      if (p.total_components) rows.push([T.term.components, affected ? T.affected_of(affected, p.total_components) : T.all_ok(p.total_components)]);
      const open = p.incidents.filter((i) => i.impact !== "advisory");
      rows.push([T.term.incidents, String(open.length)]);
      table("max-content 1fr", rows.map(([k, v]) => [el("span", { class: "t-key" }, `${k}:`), v]));
      for (const i of open.slice(0, 5)) {
        line("  ", led(i.impact, "● "), el("a", { href: i.link, target: "_blank", rel: "noopener", lang: "en" }, i.title), dim(` ${when(i.started)}`));
      }
      line(el("button", { type: "button", class: "t-link", onclick: () => goTo(p.id) }, `[${T.term.open_in_rack}]`));
    },

    ls(args) {
      const long = args.includes("-l") || args.includes("-la") || args.includes("-al");
      const name = args.find((a) => !a.startsWith("-"));
      let racks = Object.keys(state.data.categories);
      if (name) {
        const id = rackFrom(name);
        if (!id) return error(T.term.unknown_rack(name, racks.map(rackDir).join(" ")));
        racks = [id];
      }
      for (const id of racks) {
        const ps = state.data.providers.filter((p) => p.category === id)
          .sort((a, b) => RANK[b.status] - RANK[a.status] || a.id.localeCompare(b.id));
        const dir = `${rackDir(id)}/`;
        if (long || name) {
          line(el("b", { class: "t-dir" }, dir), dim(` ${categoryName(id)}`));
          table("max-content max-content max-content", ps.map((p) => {
            const { pct } = availability(p.id);
            return [el("span", {}, "  ", led(p.status, "● "), link(p)), led(p.status, levelText(p.status)), dim(pct == null ? "--" : percent(pct))];
          }));
        } else {
          line(el("b", { class: "t-dir" }, dir.padEnd(14)), ...ps.flatMap((p) => [led(p.status, "●"), " ", link(p), "  "]));
        }
      }
    },

    journalctl(args) {
      const filter = args.filter((a) => !a.startsWith("-"));
      let providers = state.data.providers;
      if (filter.length) {
        const p = serviceFrom(filter, "journalctl");
        if (!p) return;
        providers = [p];
      }
      const rows = providers.flatMap((p) => p.incidents.map((i) => ({ p, i })))
        .sort((a, b) => String(b.i.started).localeCompare(String(a.i.started)));
      if (!rows.length) return line(dim(T.term.no_entries));
      for (const { p, i } of rows.slice(0, 25)) {
        line(dim(`${when(i.started || i.updated)} `), link(p), ": ",
          el("a", { href: i.link, target: "_blank", rel: "noopener", lang: "en" }, i.title), " ", led(i.impact, `[${levelText(i.impact)}]`));
      }
    },

    geoiplookup(args) {
      const groups = currentPlaces();
      if (!groups.length) return line(dim(T.term.no_places));
      let chosen = groups;
      if (args.length) {
        const flat = (t) => normalize(t).replace(/[-_]+/g, " ");
        const q = flat(args.join(" "));
        chosen = groups.filter((g) => [g.place.id.replace(/^[@Z]:?/, ""), g.place.en, g.place.es, g.place.country_en, g.place.country_es]
          .some((n) => n && flat(n).includes(q)));
        if (!chosen.length) return error(T.term.no_place(args.join(" ")));
        if (chosen.length === 1 && state.selectedPlace !== chosen[0].place.id) selectPlace(chosen[0].place.id);
      }
      table("max-content max-content 1fr", chosen.slice(0, 30).map((g) => [
        el("span", {}, led(g.level, "● "), el("button", { type: "button", class: "t-link", onclick: () => selectPlace(g.place.id) }, placeName(g.place))),
        dim(coordinates(g.place.lat, g.place.lon)),
        el("span", {}, ...g.providers.flatMap((v, k) => [k ? ", " : "", link(v.p), led(v.level, ` (${levelText(v.level)})`)]))]));
    },

    top() {
      const rows = state.data.providers.map((p) => ({ p, ...availability(p.id) }))
        .filter((x) => x.pct != null).sort((a, b) => a.pct - b.pct).slice(0, 10);
      table("max-content max-content max-content", rows.map(({ p, pct, badDays }) =>
        [el("span", {}, led(p.status, "● "), link(p)), percent(pct), String(badDays)]), T.term.top_header);
    },

    ping(args) {
      const p = serviceFrom(args, "ping");
      if (!p) return;
      const f = p.source || {};
      line(f.ok ? T.term.ping(host(p), ago(f.checked)) : el("span", { class: "t-error" }, T.term.ping_error(host(p), f.error)),
        " ", led(p.status, `[${levelText(p.status)}]`));
      line(dim(T.term.ping_note));
    },

    crontab(args) {
      if (args[0] !== "-l") return error(T.term.usage_line(T.term.usage.crontab));
      const rows = state.data.providers.flatMap((p) => p.maintenance.map((m) => ({ p, m })))
        .sort((a, b) => Number(b.m.in_progress) - Number(a.m.in_progress) || String(a.m.start).localeCompare(String(b.m.start)));
      if (!rows.length) return line(dim(T.term.no_maintenance));
      for (const { p, m } of rows.slice(0, 20)) {
        line(dim(`${(m.in_progress ? T.in_progress : when(m.start) || T.no_date).padEnd(13)} `), link(p), " ",
          el("a", { href: m.link, target: "_blank", rel: "noopener", lang: "en" }, m.title));
      }
      if (rows.length > 20) line(dim(T.and_more(rows.length - 20)));
    },

    last() {
      const rows = Object.values(state.log).filter((r) => r.impact !== "advisory")
        .sort((a, b) => String(b.started).localeCompare(String(a.started))).slice(0, 15);
      if (!rows.length) return line(dim(T.term.no_entries));
      const byId = Object.fromEntries(state.data.providers.map((p) => [p.id, p]));
      for (const r of rows) {
        line(dim(`${when(r.started)} `), byId[r.provider] ? link(byId[r.provider]) : r.provider, " ",
          el("a", { href: r.link, target: "_blank", rel: "noopener", lang: "en" }, r.title), " ",
          dim(r.ended ? `(${duration(r.started, r.ended)})` : T.still_open));
      }
    },

    grep(args) {
      if (!args.length) return error(T.term.usage_line(T.term.usage.grep));
      const q = normalize(args.join(" "));
      let found = false;
      for (const p of state.data.providers) {
        const texts = [p.name, ...p.incidents.map((i) => i.title), ...p.components.map((c) => c.name)];
        for (const t of new Set(texts.filter((x) => x && normalize(x).includes(q)))) {
          found = true;
          const i = normalize(t).indexOf(q);
          line(link(p), dim(": "), t.slice(0, i), el("mark", {}, t.slice(i, i + q.length)), t.slice(i + q.length));
        }
      }
      if (!found) line(dim(T.term.no_matches));
    },

    // What uptime monitors: data/providers.json, the same file the collector reads
    async services(args) {
      if (!config) {
        try { config = await (await fetch("data/providers.json", { cache: "no-cache" })).json(); }
        catch { config = { providers: [] }; }
      }
      const types = Object.fromEntries(config.providers.map((c) => [c.id, c.type]));
      const name = args.find((a) => !a.startsWith("-"));
      let racks = Object.keys(state.data.categories);
      if (name) {
        const id = rackFrom(name);
        if (!id) return error(T.term.unknown_rack(name, racks.map(rackDir).join(" ")));
        racks = [id];
      }
      const providers = state.data.providers;
      line(dim(T.term.services_header(providers.length)));
      // One grid so the columns line up across racks; the rack name spans the whole row
      const grid = el("div", { class: "t-table", style: "grid-template-columns: max-content max-content max-content 1fr" },
        ...T.term.services_columns.map((c, i) => el("span", { class: "t-head" }, i ? c : `  ${c}`)));
      for (const id of racks) {
        const ps = providers.filter((p) => p.category === id).sort((a, b) => a.id.localeCompare(b.id));
        grid.append(el("span", { class: "t-full-row" },
          el("b", { class: "t-dir" }, `[${rackDir(id)}]`), dim(`  ${categoryName(id)}, ${ps.length}`)));
        for (const p of ps) {
          grid.append(
            el("span", {}, "  ", led(p.status, "● "), link(p)),
            el("span", {}, p.name),
            dim(types[p.id] ?? "?"),
            el("a", { href: p.web, target: "_blank", rel: "noopener" }, host(p)));
        }
      }
      session.append(grid);
      line(dim(T.term.services_footer));
    },

    cat(args) {
      const path = args.join(" ");
      if (/servicios\.conf|services\.conf|providers|proveedores/.test(path)) return COMMANDS.services([]);
      error(path ? `cat: ${path}: ${T.term.no_such_file}` : T.term.usage_line(`cat ${T.term.services_file}`));
    },

    neofetch() {
      const racks = Object.keys(state.data.categories).map((id) => {
        const ps = state.data.providers.filter((p) => p.category === id);
        return ps.reduce((n, p) => (RANK[p.status] > RANK[n] ? p.status : n), "operational");
      });
      const art = el("pre", { class: "t-art", "aria-hidden": "true" },
        "┌──────────────┐\n",
        ...racks.flatMap((n, i) => [`│ `, led(n, "●"), ` ▪▪ ▬▬▬▬▬▬ │\n`, i < racks.length - 1 ? "├──────────────┤\n" : ""]),
        "└──────────────┘");
      const providers = state.data.providers;
      const N = T.term.neo;
      const info = el("div", { class: "t-info" },
        el("p", {}, el("b", { class: "prompt" }, `${T.term.whoami}@noc`)),
        el("p", { class: "dim" }, "─".repeat(14)),
        ...[
          [N.os, "uptime NOC"],
          ["Uptime", uptimeLine().trim().split(",")[0].replace(/^\S+\s+up\s+/, "")],
          [N.services, String(providers.length)],
          [N.racks, String(racks.length)],
          [N.failing, String(providers.filter(isFailing).length)],
          [N.locations, String(currentPlaces().length)],
          [N.data, ago(state.data.updated)],
          [N.language, T.locale],
          [N.shell, N.shell_value],
        ].map(([k, v]) => el("p", {}, el("span", { class: "t-key" }, `${k}: `), v)),
        el("p", { class: "t-palette", "aria-hidden": "true" }, ...["operational", "maintenance", "degraded", "partial", "major", "unknown"].map((n) => led(n, "███"))));
      session.append(el("div", { class: "t-neofetch" }, art, info));
    },

    lang(args) {
      const asked = normalize(args.join(" ").replace(/^LANG=/i, "")).slice(0, 2);
      if (!chooseLanguage(asked)) return error(T.term.usage_line(T.term.usage.lang));
      line(dim(T.term.lang_ok(T.locale)));
    },

    export(args) {
      const m = args.join(" ").match(/^LANG=(\w\w)/i);
      if (m) return COMMANDS.lang([m[1]]);
      line("");
    },

    sponsor() {
      for (const t of T.term.sponsor) line(t);
      line("→ ", el("a", { href: "https://github.com/sponsors/serbenda", target: "_blank", rel: "noopener" }, T.term.sponsor_link));
    },

    history() {
      if (!typed.length) return line(dim(T.term.empty));
      table("max-content 1fr", typed.map((h, i) => [dim(String(i + 1).padStart(4)), h]));
    },

    clear() { session.replaceChildren(); },
    date() { line(new Date().toLocaleString(T.html, { dateStyle: "full", timeStyle: "long" })); },
    whoami() { line(T.term.whoami); },
    echo(args) { line(args.join(" ")); },

    man(args) {
      const o = args[0];
      if (!o || !T.term.desc[o]) return error(o ? T.term.no_manual(o) : T.term.usage_line(T.term.usage.man));
      line(el("b", {}, T.term.usage[o] ?? o));
      line("    ", T.term.desc[o]);
    },

    sudo() { error(T.term.sudo); },
    rm() { error(T.term.rm); },
    exit() { line(T.term.exit); },
    coffee() { line(T.term.coffee); },
    hello() { line(T.term.hello); },
  };

  // Aliases, Spanish ones included
  Object.assign(COMMANDS, {
    ayuda: COMMANDS.help, "?": COMMANDS.help, cls: COMMANDS.clear, logout: COMMANDS.exit, quit: COMMANDS.exit, salir: COMMANDS.exit,
    cafe: COMMANDS.coffee, "café": COMMANDS.coffee, brew: COMMANDS.coffee, hola: COMMANDS.hello, hi: COMMANDS.hello,
    servicios: COMMANDS.services, svc: COMMANDS.services, providers: COMMANDS.services, proveedores: COMMANDS.services,
    dir: COMMANDS.ls, ll: (a) => COMMANDS.ls(["-l", ...a]), donate: COMMANDS.sponsor, patrocinar: COMMANDS.sponsor,
    fastfetch: COMMANDS.neofetch, journal: COMMANDS.journalctl, where: COMMANDS.geoiplookup, top10: COMMANDS.top, htop: COMMANDS.top,
  });

  let config = null;
  const LISTED = Object.keys(T.term.desc);

  // ---------------------------------------------------------- running a command

  function split(text) {
    return (text.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((t) => t.replace(/^(["'])(.*)\1$/, "$2"));
  }

  function distance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }

  function run(text) {
    const clean = text.trim().slice(0, 200);
    line(el("span", { class: "prompt" }, "bendi@noc:~$ "), clean);
    if (!clean) return;
    if (typed.at(-1) !== clean) typed.push(clean);
    while (typed.length > 50) typed.shift();
    position = typed.length;
    saveLocal(STORAGE.history, typed);

    if (!state.data && !["help", "clear", "lang", "echo", "whoami", "date", "history", "man"].includes(clean.split(/\s/)[0])) {
      return error(T.offline);
    }
    const [command, ...args] = split(clean);
    const name = command.toLowerCase();
    const action = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : null;
    if (action) {
      try {
        const r = action(args);
        if (r?.then) r.then(() => { trim(); scroll(); }, (e) => error(`${name}: ${e.message}`));
      } catch (e) { console.error(e); error(`${name}: ${e.message}`); }
    } else {
      error(T.term.not_found(command));
      const near = LISTED.map((o) => [o, distance(name, o)]).sort((a, b) => a[1] - b[1])[0];
      if (near && near[1] <= 2) line(dim(T.term.did_you_mean(near[0])));
    }
    trim();
  }

  function scroll() {
    session.scrollTop = session.scrollHeight;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    run(input.value);
    input.value = "";
    scroll();
  });

  // ---------------------------------------------------------- keyboard: history, Tab, Ctrl+L, Ctrl+C

  function candidates(words) {
    if (words.length <= 1) return LISTED;
    const o = words[0].toLowerCase();
    if (["status", "ping", "journalctl"].includes(o) || (o === "systemctl" && words[1] === "status" && words.length > 2)) {
      return state.data?.providers.map((p) => p.id) ?? [];
    }
    if (o === "systemctl") return ["--failed", "status"];
    if (o === "crontab") return ["-l"];
    if (o === "ls") return Object.keys(state.data?.categories ?? {}).map(rackDir).concat("-l");
    if (o === "lang") return Object.keys(LANGUAGES);
    if (o === "man") return LISTED;
    if (o === "services" || o === "servicios") return Object.keys(state.data?.categories ?? {}).map(rackDir);
    if (o === "cat") return [T.term.services_file];
    if (o === "geoiplookup") return currentPlaces().map((g) => normalize(placeName(g.place)).replace(/\s+/g, "-"));
    return [];
  }

  function complete() {
    const value = input.value;
    const words = value.split(/\s+/);
    const last = words.at(-1);
    const options = candidates(words).filter((c) => c.startsWith(last.toLowerCase()));
    if (!options.length) return;
    // longest prefix shared by every option
    let common = options[0];
    for (const o of options) while (!o.startsWith(common)) common = common.slice(0, -1);
    if (options.length === 1) {
      input.value = value.slice(0, value.length - last.length) + options[0] + " ";
    } else if (common.length > last.length) {
      input.value = value.slice(0, value.length - last.length) + common;
    } else {
      line(el("span", { class: "prompt" }, "bendi@noc:~$ "), value);
      line(dim(options.slice(0, 40).join("  ")));
      trim();
      scroll();
    }
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && typed.length) {
      e.preventDefault();
      position = Math.max(0, position - 1);
      input.value = typed[position];
    } else if (e.key === "ArrowDown" && typed.length) {
      e.preventDefault();
      position = Math.min(typed.length, position + 1);
      input.value = typed[position] ?? "";
    } else if (e.key === "Tab" && input.value.trim()) {
      e.preventDefault();
      complete();
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      COMMANDS.clear();
    } else if (e.key === "c" && e.ctrlKey && input.selectionStart === input.selectionEnd) {
      e.preventDefault();
      line(el("span", { class: "prompt" }, "bendi@noc:~$ "), input.value, "^C");
      input.value = "";
      scroll();
    } else if (e.key === "Escape") {
      input.value = "";
    }
  });

  // Clicking the console focuses the prompt (unless text is being selected or a link is clicked)
  $("#console").addEventListener("click", (e) => {
    if (e.target.closest("a, button, input") || String(getSelection())) return;
    input.focus({ preventScroll: true });
  });

  // "/" from anywhere that isn't a text field jumps to the terminal
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest("input, textarea, select, [contenteditable]")) return;
    e.preventDefault();
    input.focus();
  });

  // ---------------------------------------------------------- suggestions under the prompt

  function renderShortcuts() {
    const suggestions = ["help", "services", "systemctl --failed"];
    const worst = state.data?.providers.filter(isFailing).sort((a, b) => RANK[b.status] - RANK[a.status])[0];
    suggestions.push(`status ${worst?.id ?? "github"}`);
    const place = state.data && currentPlaces()[0];
    if (place) suggestions.push(`geoiplookup ${normalize(placeName(place.place)).replace(/\s+/g, "-")}`);
    suggestions.push("neofetch");
    $("#shortcuts").replaceChildren(dim(`${T.term.try} `), ...suggestions.map((s) =>
      el("button", { type: "button", class: "shortcut", onclick: () => { run(s); scroll(); } }, s)));
  }

  // The suggestions depend on the data and the language: they're redrawn along with the rest of the page
  const renderPage = render;
  render = function () { renderPage(); renderShortcuts(); };
  renderShortcuts();
})();
