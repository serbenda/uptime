<div align="center">

# uptime

**Is it down, or is it just me?**

Real-time status of the IT services we rely on every day: GitHub, Microsoft Azure,<br>
Red Hat, Google Cloud, AWS, Cloudflare and more. Incidents, maintenance and outages in one panel,<br>
with a world map of failures and a terminal you can type into.

[![Update data](https://github.com/serbenda/uptime/actions/workflows/actualizar.yml/badge.svg)](https://github.com/serbenda/uptime/actions/workflows/actualizar.yml)
[![Tests](https://github.com/serbenda/uptime/actions/workflows/pruebas.yml/badge.svg)](https://github.com/serbenda/uptime/actions/workflows/pruebas.yml)
[![Sponsor uptime on GitHub Sponsors](https://img.shields.io/badge/Sponsor_uptime-GitHub_Sponsors-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/serbenda)

<img src="docs/screenshots/hero.webp" alt="The top of uptime: a console answering “5 services are having problems” with the list of failures, and the outage map below" width="900">

</div>

> [!NOTE]
> uptime **does not probe** services itself: it reads what each provider publishes on its official status page. If a provider is slow to acknowledge a problem, or never reports it, it won't show up here either. Availability figures are an estimate based on those pages. They are nobody's SLA and carry no contractual value.

---

## Contents

1. [In 30 seconds](#in-30-seconds)
2. [A tour of the site](#a-tour-of-the-site)
   - [The console](#the-console) · [The terminal](#the-terminal) · [The outage map](#the-outage-map) · [Open incidents](#open-incidents)
   - [Racks and drawers](#racks-and-drawers) · [Filters, pins and notifications](#filters-pins-and-notifications) · [Maintenance and history](#maintenance-and-history)
   - [The power supply](#the-power-supply) · [Languages](#languages) · [On mobile](#on-mobile) · [Links and shortcuts](#links-and-shortcuts) · [Accessibility](#accessibility)
3. [Terminal reference](#terminal-reference)
4. [Providers](#providers)
5. [How status is decided](#how-status-is-decided)
6. [How availability is calculated](#how-availability-is-calculated)
7. [How failures are placed on the map](#how-failures-are-placed-on-the-map)
8. [Architecture](#architecture)
9. [Operations](#operations)
10. [Development](#development)
11. [Data formats](#data-formats)
12. [Security and privacy](#security-and-privacy)
13. [FAQ](#faq)
14. [Known limitations](#known-limitations)
15. [Roadmap](#roadmap)
16. [Credits](#credits)
17. [Support the project](#support-the-project)

---

## In 30 seconds

| Question | Answer |
|---|---|
| **What is it?** | A single page that brings together the status of 27 services almost every tech team depends on: clouds, code forges, package registries, CDNs, collaboration tools and AI. |
| **What is it for?** | Telling at a glance whether the problem is yours or the provider's, where it's failing and since when. |
| **Where does the data come from?** | Each provider's official status page, read every 10 minutes. |
| **What does it cost?** | Nothing. There are no servers: everything runs on GitHub Actions and GitHub Pages. |
| **What does it need?** | Python 3.12 with no dependencies to collect the data, and a framework-free static page to show it. |
| **What does it look like?** | A NOC (*Network Operations Center*): a console with a terminal, a world map made of LEDs, and one rack per category with one server per provider. |
| **Which languages?** | The site is in English and Spanish, following your browser. |
| **Is it related to anything?** | It's a sibling of [atalaya](https://github.com/serbenda/atalaya), a world situation viewer: same philosophy, same conventions. |

---

## A tour of the site

The site imitates a NOC, and the metaphor isn't just decoration: every piece of the room maps to a piece of information.

| In a real NOC | In uptime |
|---|---|
| The on-call operator's terminal | The console at the top, with its command line |
| The big screen with the alarm map | The outage map |
| The system log (`journalctl`) | Open incidents |
| Racks with their servers and LEDs | One rack per category, one server per provider |
| Pulling a server out of the rack to inspect it | The drawer with its diagnostics terminal |
| The scheduled jobs table (`crontab`) | Maintenance |
| The login history (`last`) | The 30-day history |
| The power supply that keeps it all running | The GitHub Sponsors section |

### The console

The first thing you see is a terminal session that has already run two commands:

- **`uptime`** prints a line like the real command: time, days of history, number of services, how many are failing and a *load average*. The load average is real: the share of services with a partial or major outage right now, averaged over the last 7 days and over the last 30. Hover over it for an explanation.
- **`systemctl --failed`** (or `systemctl status proveedores` when all is well) answers the question with systemd's boot marker: a green `[  OK  ] All systems operational.` or a red `[FAILED] GitHub and Azure are having problems.` With more than three services down it's summarised: `5 services are having problems.`
- Below it, the summary (`27 services, 20 operational, 2 in maintenance, 5 failing`) and one line per failing service: LED, name, status and the title of its worst incident. Each name takes you to its server in the rack.

The title bar shows when the data was last updated (`updated 4 minutes ago`). If it's more than 40 minutes old, it turns orange and warns that updates are running late. It also holds the language switcher (`LANG= es_ES en_US`). The favicon and the tab title change colour with the worst status and show the number of failing services: `(5) uptime`.

On first load, the console appears line by line, as if it were being typed. It's the only entrance animation on the page, and it's skipped when the system asks for reduced motion.

### The terminal

<img src="docs/screenshots/terminal.webp" alt="The terminal showing the output of status cloudflare and geoiplookup singapore" width="800">

Below the verdict there's a real command line. It's a toy shell that answers with the data on the page: you can ask about a service, list the racks, look up where things are failing or switch languages. It all happens in the browser, and nothing you type leaves it.

- **Getting there:** click anywhere on the console, or press `/` from anywhere on the page.
- **If you don't know what to type:** there are clickable suggestions underneath, and they change with what's happening (`status red-hat` if Red Hat is the worst right now, `geoiplookup` with the first place on the map).
- **Like a shell:** Tab completes commands, services, racks and places; ↑ and ↓ browse the history, which is remembered between visits; Ctrl+L clears; Ctrl+C cancels the line; Esc erases it.
- **If you mistype:** `stauts github` answers `bash: stauts: command not found` and suggests `Did you mean "status"?`.

The full command list is in the [terminal reference](#terminal-reference).

### The outage map

<img src="docs/screenshots/map.webp" alt="The outage map: a dot-matrix world with red, orange and yellow LEDs, and on the right the card for Singapore listing the providers failing there" width="900">

A world map made of LEDs (6,852 land dots, one every 1.5°) with a light on wherever something is failing right now.

| What you see | What it means |
|---|---|
| **Colour** | The worst status at that place, across all providers |
| **Size** | How many failures are there (components plus incidents) |
| **Pulse** | Partial and major outages pulse; everything else stays still |
| **Blue dot** | Maintenance in progress, not a failure |

- **Hover** over a dot for a tooltip with the place and the providers failing there.
- **Click it** (or press Enter if you got there with the keyboard), and the right-hand column shows a `$ geoiplookup SIN` with the place, its country, its coordinates and, for each provider, its status and the exact text that put it there (the component `Singapore, Singapore - (SIN)`, the incident `Connectivity Issue between ID-CGK (Jakarta) and SG-SIN-2`…). Each provider links to its server in the rack. Esc or *close* clears the selection.
- **The list on the right** has every place with problems, worst first, and highlights the dot as you hover.
- **Under the list** are the failing providers that couldn't be placed (*No specific location: GitHub, Red Hat*).
- **Bottom left** shows the cursor's coordinates: `40.42°N 3.70°W`.
- **The faint lines** are the equator, the tropics and the Greenwich meridian.

How each dot gets its position is explained in [How failures are placed on the map](#how-failures-are-placed-on-the-map).

### Open incidents

<img src="docs/screenshots/incidents.webp" alt="Open incidents as journalctl output, with one entry expanded" width="900">

A `journalctl -f -p warning` with every active incident from every provider, most severe first and, at equal severity, most recent first. Each line has the time, provider, severity and title. Click it to expand the phase (*Investigating*, *Identified*, *Monitoring*), when it started and was last updated, what it affects, the provider's latest message (in its original language, usually English) and a link to the incident on the provider's page.

The first 8 are shown, and the rest sit behind `-- 12 more entries, click to show --`.

### Racks and drawers

<img src="docs/screenshots/racks.webp" alt="The Cloud, Development, Network & CDN, Collaboration and AI racks, with one server pulled out showing its diagnostics terminal" width="900">

Each category is a rack (with its drilled rails) and each provider a 1U server. Racks sit in two columns with no gaps. Each rack's plate says how many servers it holds and how many are failing.

From left to right, each server has:

| Part | What it tells you |
|---|---|
| **Unit** (`U6`) | Its position in the rack. The worst ones go on top. |
| **LED** | Its status. It blinks fast for partial or major outages and slowly when degraded. |
| **Name and status** | `partial outage ×3` when there are several incidents. |
| **90-day graph** | One bar per day. Height repeats the colour: the worse the day, the taller the bar, so it reads without telling colours apart. Hover a bar for `28 Oct: worst: partial outage (97.2% available)`. |
| **Display** | Availability over the last 90 days, as a green LCD. |
| **Pin** | Keeps it on top (see [Filters, pins and notifications](#filters-pins-and-notifications)). |

**The drawer.** Click a server and it slides out to show its diagnostics terminal, `$ status linode`:

| Line | Content |
|---|---|
| `status` | The status, plus the summary the provider itself publishes (`"Partially Degraded Service"`) |
| `source` | Its status page's domain and when it last responded, or the error if it isn't responding |
| `90 days` | Availability and number of days with outages |
| `components` | How many components it has and how many are affected, with the list (up to 12). If the scope rule was applied, it says so: *small scope: counted as degraded* |
| `incidents` | Each incident with its severity, phase, dates and latest message |
| `maintenance` | Scheduled and in-progress maintenance |
| `open …` | Link to the official status page |

### Filters, pins and notifications

- **`$ grep -i`**: filters services by name as you type.
- **Rack flags**: `--all`, `--cloud`, `--dev`, `--network`, `--collab`, `--ai` (in Spanish, `--todos`, `--nube`, `--desarrollo`, `--red`, `--colaboracion`, `--ia`).
- **`--failed-only`**: keeps only services that are failing, in maintenance or without data.
- **Pins**: each server's pin moves it to a *Pinned* rack that comes first. It's stored in your browser, with no accounts.
- **Notifications**: once you've pinned something, a *Notify me when a pinned one fails* button appears. If you allow it, the browser shows a notification when a pinned service gets worse (degraded or above) and another when it recovers. It only works while the page is open (in a tab, even if not visible): the page reloads its data every 5 minutes and whenever you come back to the tab.

### Maintenance and history

<img src="docs/screenshots/history.webp" alt="Maintenance as crontab -l and the last 30 days as last" width="900">

- **Maintenance** (`crontab -l`): in-progress first, then upcoming by date. Up to 3 per provider, because Cloudflare schedules dozens of data centres at once. The rest are summarised as `cloudflare: 24 more`, which opens its drawer.
- **Last 30 days** (`last -30d`): the incidents seen, with their duration (`(3 h 20 min)`) or `(still open)`. The 60 most recent. Security advisories are left out.

### The power supply

<img src="docs/screenshots/psu.webp" alt="The GitHub Sponsors block shaped like a power supply unit: fan, text, specification label and I/O switch" width="900">

The GitHub Sponsors section is shaped like a server's power supply:

- **The fan** spins slowly, and speeds up when you hover the switch.
- **The PSU LED** is blue on standby (*waiting for power*) and turns green as you approach the switch.
- **The specification label**, like the silver sticker on a real PSU, shows real figures: `INPUT GitHub Sponsors`, `OUTPUT 27 services every 10 min`, `COST €0 in servers`.
- **The I/O rocker switch** is the link to [github.com/sponsors/serbenda](https://github.com/sponsors/serbenda).

### Languages

<img src="docs/screenshots/spanish.webp" alt="The top of the page in Spanish: «5 servicios tienen problemas.»" width="900">

The site speaks English and Spanish. The language is picked in this order:

1. `?lang=en` or `?lang=es` in the address.
2. Your last choice in the console's `LANG=` switcher or with the `lang` command, remembered in the browser.
3. The browser's language: Spanish if any preferred language is `es`, English otherwise.

Switching repaints the whole page without reloading: labels, dates (`02 Nov` / `02 nov`), relative times (`3 minutes ago` / `hace 3 minutos`), place names (`London` / `Londres`), coordinates (`3.70°W` / `3.70°O`), filter flags and the terminal's answers. Text published by providers (incident titles and messages) is shown as is, usually in English, marked with `lang="en"` for screen readers.

### On mobile

<img src="docs/screenshots/mobile.webp" alt="uptime on a phone: the console, the verdict and the start of the map" width="300">

On narrow screens, each server splits into two rows (name, display and pin on top, the 90-day graph underneath), the map takes the full width with its list below, and the power supply rearranges itself. The terminal works with the phone's keyboard, and the clickable suggestions save you from typing.

### Links and shortcuts

| Link | What it opens |
|---|---|
| `#p=github` | The page with GitHub's drawer open and in view |
| `?lang=es` | The page in Spanish (and remembers it) |
| `?local` | Reads data from `data/` instead of the `datos` branch (for development) |

| Key | Where | What it does |
|---|---|---|
| `/` | Anywhere outside a text field | Jumps to the terminal |
| `Enter` | Terminal | Runs the command |
| `Tab` | Terminal | Completes commands, services, racks and places |
| `↑` `↓` | Terminal | Command history |
| `Ctrl+L` | Terminal | Clears the output |
| `Ctrl+C` | Terminal | Cancels the line (prints `^C`) |
| `Esc` | Terminal | Erases the line |
| `Esc` | Map | Clears the selected place |
| `Enter` or `Space` | A dot on the map | Selects it |

### Accessibility

- **Keyboard**: everything works without a mouse. Map dots take focus and are selected with Enter; selecting a place doesn't redraw the map, so focus isn't lost; focus is always visible.
- **Screen readers**: the terminal output is a `role="log"` region that announces changes; the list next to the map is a text alternative to the dots; each dot has a label such as *Houston: major outage, 1 provider*; provider text carries `lang="en"`.
- **Colour**: status never depends on colour alone. It always comes with text (*partial outage*), and in the graphs bar height repeats severity.
- **Motion**: with `prefers-reduced-motion` there's no typing console, no blinking LEDs, no pulsing map, no spinning fan and no smooth scrolling.
- **Contrast**: a single dark theme, built for on-call screens, with main text `#DCE6EE` on `#0F151B`.

---

## Terminal reference

<img src="docs/screenshots/services.webp" alt="The services command listing every monitored service rack by rack, with its format and status page" width="800">

Commands and options are the same in both languages; answers come in the selected language. Services can be named by their id (`google-cloud`), their name (`google cloud`) or any fragment that matches just one (`cloudf`). If several match, the terminal lists them and asks you to be more specific.

### Information

| Command | Aliases | What it does | Example |
|---|---|---|---|
| `help` | `ayuda`, `?` | List of commands with a description of each | `help` |
| `services [rack]` | `servicios`, `svc`, `providers`, `proveedores`, `systemctl list-units`, `cat /etc/uptime/services.conf` | Everything uptime monitors, rack by rack: LED, id, name, status page format and link | `services cloud` |
| `status <service>` | `systemctl status <service>` | A `systemctl status`-style card: source and when it responded, status, 90-day availability, affected components and the first 5 incidents, with a link to its server in the rack | `status cloudflare` |
| `systemctl --failed` | | A `UNIT STATUS DESCRIPTION` table of failing services, worst first | `systemctl --failed` |
| `systemctl status` | | The console's verdict on one line | `systemctl status` |
| `ls [rack]` | `dir` | One line per rack with its servers' LEDs; with a rack, the details | `ls network` |
| `ls -l` | `ll` | Details for every rack: LED, id, status and availability | `ls -l` |
| `journalctl [service]` | `journal` | Open incidents, for all or one, newest first (up to 25) | `journalctl aws` |
| `geoiplookup [place]` | `where` | With no argument, every place with failures; with a place, just that one, and it gets selected on the map | `geoiplookup singapore` |
| `top` | `htop`, `top10` | The 10 services with the worst 90-day availability | `top` |
| `ping <service>` | | When its status page last responded, with its status. It also explains that uptime doesn't ping anyone | `ping github` |
| `crontab -l` | | In-progress and upcoming maintenance (up to 20) | `crontab -l` |
| `last` | | The 15 most recent incidents of the last 30 days, with their duration | `last` |
| `grep <text>` | | Searches service names, incident titles and components, highlighting the match | `grep singapore` |
| `uptime` | | The `uptime` line | `uptime` |
| `neofetch` | `fastfetch` | The NOC at a glance: an ASCII rack with one LED per rack coloured by its worst status, plus services, racks, failures, locations, data age and language | `neofetch` |

### Session

| Command | Aliases | What it does |
|---|---|---|
| `lang en` · `lang es` | `export LANG=es_ES.UTF-8` | Switches the whole page's language |
| `history` | | Numbered list of the commands you've typed (the last 50 are kept) |
| `clear` | `cls`, Ctrl+L | Clears the output. The verdict at the top stays |
| `man <command>` | | Usage and description of a command |
| `echo <text>` | | Prints the text |
| `date` | | Full date and time, in the selected language |
| `whoami` | | `guest` |
| `sponsor` | `donate`, `patrocinar` | How to help keep uptime running, with the link |

### Easter eggs

| Command | Answer |
|---|---|
| `sudo …` | `guest is not in the sudoers file. This incident will be reported.` |
| `rm …` | `rm: cannot remove '/': read-only file system. Nice try.` |
| `exit`, `logout`, `quit`, `salir` | `There's no way out: this is a NOC. Close the tab if you want to leave.` |
| `coffee`, `cafe`, `café`, `brew` | `418 I'm a teapot. Coffee is ordered at the power supply: type sponsor.` |
| `hello`, `hi`, `hola` | A greeting and a hint |

### How it behaves

- Each line is capped at 200 characters. Quotes group words (`grep "region availability"`).
- The output keeps the last 300 lines and scrolls itself; the box has a maximum height so it doesn't push the page around.
- Until the data has loaded, only `help`, `clear`, `lang`, `echo`, `whoami`, `date`, `history` and `man` work.
- The first time it's used, `services` reads `data/proveedores.json` (the same file the collector uses) to find out each status page's format.
- The "did you mean" suggestion uses Levenshtein distance, and only kicks in for a difference of 2 letters or fewer.
- History is stored in `localStorage` (`uptime.historial`). If the browser won't store it, everything still works during the visit.

---

## Providers

27 providers in 5 racks. The list lives in [`data/proveedores.json`](data/proveedores.json): adding one that uses a known format is a one-line change.

| Rack | id | Provider | Format | Status page |
|---|---|---|---|---|
| Cloud | `aws` | AWS | `aws` | [health.aws.amazon.com](https://health.aws.amazon.com/health/status) |
| Cloud | `azure` | Microsoft Azure | `azure` | [azure.status.microsoft](https://azure.status.microsoft/en-us/status) |
| Cloud | `google-cloud` | Google Cloud | `google` | [status.cloud.google.com](https://status.cloud.google.com/) |
| Cloud | `red-hat` | Red Hat | `statuspage` | [status.redhat.com](https://status.redhat.com) |
| Cloud | `digitalocean` | DigitalOcean | `statuspage` | [status.digitalocean.com](https://status.digitalocean.com) |
| Cloud | `linode` | Akamai Cloud (Linode) | `statuspage` | [status.linode.com](https://status.linode.com) |
| Development | `github` | GitHub | `statuspage` | [githubstatus.com](https://www.githubstatus.com) |
| Development | `gitlab` | GitLab | `statusio` | [status.gitlab.com](https://status.gitlab.com) |
| Development | `bitbucket` | Bitbucket | `statuspage` | [bitbucket.status.atlassian.com](https://bitbucket.status.atlassian.com) |
| Development | `azure-devops` | Azure DevOps | `azure-devops` | [status.dev.azure.com](https://status.dev.azure.com) |
| Development | `docker-hub` | Docker Hub | `statusio` | [dockerstatus.com](https://www.dockerstatus.com) |
| Development | `hashicorp` | HashiCorp (Terraform) | `statuspage` | [status.hashicorp.com](https://status.hashicorp.com) |
| Development | `npm` | npm | `statuspage` | [status.npmjs.org](https://status.npmjs.org) |
| Development | `pypi` | PyPI | `statuspage` | [status.python.org](https://status.python.org) |
| Development | `circleci` | CircleCI | `statuspage` | [status.circleci.com](https://status.circleci.com) |
| Network & CDN | `cloudflare` | Cloudflare | `statuspage` | [cloudflarestatus.com](https://www.cloudflarestatus.com) |
| Network & CDN | `akamai` | Akamai | `statuspage` | [akamaistatus.com](https://www.akamaistatus.com) |
| Network & CDN | `netlify` | Netlify | `statuspage` | [netlifystatus.com](https://www.netlifystatus.com) |
| Network & CDN | `vercel` | Vercel | `statuspage` | [vercel-status.com](https://www.vercel-status.com) |
| Collaboration | `google-workspace` | Google Workspace | `google` | [google.com/appsstatus](https://www.google.com/appsstatus/dashboard/) |
| Collaboration | `slack` | Slack | `slack` | [slack-status.com](https://slack-status.com) |
| Collaboration | `zoom` | Zoom | `statuspage` | [status.zoom.us](https://status.zoom.us) |
| Collaboration | `jira` | Jira | `statuspage` | [jira-software.status.atlassian.com](https://jira-software.status.atlassian.com) |
| Collaboration | `confluence` | Confluence | `statuspage` | [confluence.status.atlassian.com](https://confluence.status.atlassian.com) |
| Collaboration | `dropbox` | Dropbox | `statuspage` | [status.dropbox.com](https://status.dropbox.com) |
| Collaboration | `discord` | Discord | `statuspage` | [discordstatus.com](https://discordstatus.com) |
| AI | `openai` | OpenAI | `statuspage` | [status.openai.com](https://status.openai.com) |

### Supported formats

Every provider publishes its status in its own way. [`actualizar.py`](scripts/actualizar.py) understands seven formats and translates them all into a common one.

| `tipo` | What it downloads | What it uses | Used by |
|---|---|---|---|
| `statuspage` | `{url}/api/v2/summary.json` from Atlassian Statuspage | Overall indicator, components (excluding groups), unresolved incidents with their components and latest update, maintenance that isn't completed | 19 providers |
| `statusio` | `api.status.io/1.0/status/{pagina}` | `status_overall`, components, incidents with their latest message, active and upcoming maintenance | GitLab, Docker Hub |
| `google` | `incidents.json` | Only incidents with no end date that have already started; affected products and locations | Google Cloud, Google Workspace |
| `azure` | Active incidents RSS feed | Every RSS item is an active incident | Microsoft Azure |
| `azure-devops` | `/_apis/status/health` | Overall health, and each service's health per geography | Azure DevOps |
| `aws` | Current public events from the AWS Health Dashboard | Service, region, summary and the latest entry in the event log. AWS serves it as UTF-16 with a BOM, which is handled | AWS |
| `slack` | `slack-status.com/api/v2.0.0/current` | Active incidents with their type, affected services and latest note | Slack |

### Why some are missing

- **Microsoft 365**: its status is only published through Microsoft Graph, with tenant credentials. From Microsoft, Azure and Azure DevOps are included. It's on the [roadmap](#roadmap).
- **Quay.io**: its status page is Red Hat's; listing it separately duplicated every incident.
- **Providers without a readable public page** (Salesforce, Meta, Apple Developer…): their pages are rendered in the browser, with no stable API that can be read without credentials.

### Adding a provider

**If it uses a known format**, all it takes is one line in `data/proveedores.json`:

```json
{"id": "sentry", "nombre": "Sentry", "categoria": "desarrollo", "tipo": "statuspage",
 "url": "https://status.sentry.io", "web": "https://status.sentry.io"}
```

| Field | Required | Purpose |
|---|---|---|
| `id` | Yes | Unique identifier, lowercase with hyphens. It's what you type in the terminal and in `#p=` |
| `nombre` | Yes | Display name |
| `categoria` | Yes | One of the racks in `categorias`: `nube` (cloud), `desarrollo` (development), `red` (network & CDN), `colaboracion` (collaboration), `ia` (AI) |
| `tipo` | Yes | One of the seven formats |
| `url` | Depends on the format | The page's base URL (Statuspage) or the exact URL to download (all others) |
| `pagina` | `statusio` only | The page id on status.io |
| `web` | Recommended | The page linked for humans |

To check whether a page runs on Statuspage, open `https://its-domain/api/v2/summary.json`. If it returns JSON with `page`, `status` and `components`, it does.

The tests check that every provider has a known `tipo`, an existing `categoria`, a unique `id` and an `https` URL.

**If it uses a new format:**

1. Write `procesar_<tipo>(datos, prov)` in `actualizar.py`. It receives the parsed JSON (or raw bytes for non-JSON formats) and returns the [common format](#the-common-provider-format).
2. If the response doesn't look as expected, raise `FormatoInesperado("what's missing")`: it will be treated as that source being down, without breaking the others.
3. Finish with `r["estado"] = estado_final(r, indicador, afectados, en_curso)`, which applies the shared rules and places failures on the map.
4. Register it in `PROCESADORES` (with `True` if the response is JSON) and, if its URL is built rather than given, in `url_de()`.
5. Add a test class with a sample response: the normal case, an incident and a broken format.

---

## How status is decided

### The scale

| Status | LED | Meaning | Counts against availability? |
|---|---|---|---|
| Operational | 🟢 green | No incidents | No |
| Maintenance | 🔵 blue | Scheduled work in progress | No |
| Degraded | 🟡 yellow | Works, but slow or with occasional errors | No |
| Partial outage | 🟠 orange | Part of the service doesn't work | Yes |
| Major outage | 🔴 red | The service doesn't work | Yes |
| No data | ⚪ grey | The status page isn't responding, or never has | Not counted |
| Advisory | 🟣 violet | Incidents only: informational notices with no impact, such as security advisories | No |

### The rules

A provider's status is **the worst** of four things: its overall indicator, its components, its incidents and its in-progress maintenance. Some providers are slow to move their overall indicator when a component is already down, or keep an incident open while the indicator stays green.

On top of that, three corrections apply:

1. **Scope matters.** If a provider has 20 or more components, fewer than 5% are affected and there's no partial or major incident, its status is capped at *degraded*. That's the case for Cloudflare, which has hundreds of data centres and almost always has a few rerouted: three cities down out of 473 isn't a Cloudflare outage. The drawer says so, and on the map those cities still show their real colour.
2. **Advisories aren't outages.** An incident published with no impact (Statuspage `impact: none`), or whose title is a security notice (`Security Advisory`, `Security Bulletin`, `CVE-2026-…`), is marked as an *advisory*: it's shown, but it doesn't change the status, doesn't go on the map and isn't kept in the history. Akamai and Linode publish their CVE notices this way.
3. **Maintenance isn't a failure.** Azure DevOps reports maintenance as *advisory*; if its message mentions *maintenance*, it counts as maintenance.

### How each format maps

| Format | Original value | Status |
|---|---|---|
| Statuspage, component | `operational` · `degraded_performance` · `partial_outage` · `major_outage` · `under_maintenance` | operational · degraded · partial · major · maintenance |
| Statuspage, indicator | `none` · `minor` · `major` · `critical` · `maintenance` | operational · degraded · partial · major · maintenance |
| Statuspage, incident | `none` · `minor` · `major` · `critical` | advisory · degraded · partial · major |
| status.io | `100` · `200` · `300` · `400` · `500` · `600` | operational · maintenance · degraded · partial · major · major |
| Google | `SERVICE_INFORMATION` · `SERVICE_DISRUPTION` · `SERVICE_OUTAGE` | degraded · partial · major |
| Azure (RSS) | any RSS item | partial |
| Azure DevOps | `healthy` · `advisory` · `degraded` · `unhealthy` | operational · degraded · partial · major |
| AWS | any event; *informational* in the title | partial; degraded |
| Slack | `notice` · `incident` · `outage` · `maintenance` | degraded · partial · major · maintenance |

Statuspage phases are translated too: *Investigating*, *Identified*, *Monitoring*, *Resolved*, *Postmortem*, *Scheduled*, *In progress*, *Verifying*, *Completed*.

### When a source fails

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Responding
  Responding --> Failing: network, HTTP or format error
  Failing --> Responding: responds again
  Failing --> Failing: fewer than 18 failures in a row<br/>(its last good data is kept)
  Failing --> NoData: 18 failures in a row (3 h)<br/>or never responded
  NoData --> Responding: responds again
  note right of NoData: the issue «Fuentes de datos caídas»<br/>is opened or commented on
```

- A provider that doesn't respond **doesn't break the others**: each one is fetched separately, and any error ends up on its own card.
- While it's failing, **its last good data is kept**, and the drawer says so: *not responding (HTTP 503), last data 40 minutes ago*.
- After **18 runs in a row** with no response (3 hours), or if it has never responded, it becomes *No data*.
- Each download has a **20-second** limit and **2 retries** (after 2 and 4 seconds), except for HTTP 4xx errors other than 429, which aren't retried.
- If **no source responds at all**, it's almost certainly the runner's network: the Action fails without publishing.

---

## How availability is calculated

Each run (every 10 minutes) is a **sample**. For each provider and UTC day, three numbers are stored:

| Field | What it counts |
|---|---|
| `m` | Samples taken that day |
| `c` | Samples where the provider was in a partial or major outage |
| `peor` | The worst status of the day |

- **Availability** over a period = 1 − Σc / Σm. Degraded and maintenance don't count against it.
- Samples where a provider had *no data*, or where its source failed on that run, **don't count**, either way.
- The **90-day graph** draws one bar per day with the colour and height of `peor`; days with no samples appear as short grey bars.
- The **display percentage** uses every sample from the last 90 days; 99.995% or more is shown as `100%`.
- The console's **load average** is: services with an outage now / total, and the share of provider-days with an outage over the last 7 and 30 days.
- The history is trimmed to 90 days on every run.

One consequence worth knowing: with few samples, the percentage is very sensitive. A provider that has spent its first full day with an open partial outage shows `0.00%`, even if the outage only affects one region (as with AWS in its Middle East regions). Over the days, the number settles.

---

## How failures are placed on the map

Status pages carry no coordinates, but they do carry place names. `actualizar.py` looks for places in the **name of every affected component** (all of them, not just the 12 that are stored), in the **title of every incident** and, where the format provides them, in the **incident's components** (Statuspage), its **affected locations** (Google) and its **region** (AWS). Advisories are never placed.

### Search order

| Level | How it's recognised | Example | Result |
|---|---|---|---|
| 1. Cloud region | AWS, Google Cloud and Azure region ids and names, case-insensitive; longer names first (`East US 2` before `East US`) | `Elevated errors in us-east-1`, `Belgium (europe-west1)`, `West Europe` | Ashburn, Brussels, Amsterdam |
| 2. IATA code | Only in three shapes, to avoid matching other acronyms: `(IAH)`, `AMS (…)` at the start, or `XX-YYY` | `Houston, United States - (IAH)` (Cloudflare), `SG-SIN-2` (Linode), `HNL (Honolulu) on …` | Houston, Singapore, Honolulu |
| 3. City | Full capitalised name, in English or Spanish, plus aliases (`Bengaluru`, `N. Virginia`, `Ohio`, `Oregon`…) | `Performance Degradation in Mumbai and Chennai` | Mumbai and Chennai |
| 4. Country | ISO 3166 names in English and Spanish, plus aliases (`US`, `UK`, `UAE`, `Korea`…) | `Core services (Australia)` | The centre of Australia |
| 5. Zone | `Europe`, `EU`, `APAC`, `Middle East`, `LATAM`, `EMEA`… | `Degraded performance in APAC` | A representative point for the zone |

Regions, codes and cities **add up**. Countries are only added when there isn't already a city in that same country: `Houston, United States - (IAH)` gives just Houston, while `Edge Delivery issues between Indonesia and Singapore` gives Singapore and Indonesia. Zones are only used when nothing more specific was found.

For each place, uptime stores its **worst level**, how many failures are there (`n`) and **up to 4 examples** of the text that placed it, which are the ones shown on the map. Each provider has at most **80 points**. Anything that can't be placed is counted in `sin_ubicacion`, and the site shows it as *no specific location*.

### The gazetteer

[`data/geo/lugares_base.json`](data/geo/lugares_base.json) is maintained by hand:

| Section | Content |
|---|---|
| `ciudades` | 243 cities with data centres or points of presence: `[IATA, English name, Spanish name, ISO-2 country, lat, lon]`. A trailing `"-"` marks ambiguous names (`Córdoba`, `San José`, `Salvador`), which are only matched by their code |
| `alias_ciudades` | Other names that lead to a city: `Bengaluru`, `Sao Paulo`, `N. Virginia`, `Silicon Valley`, `Iowa`… |
| `regiones` | 143 AWS, Google Cloud and Azure region ids and names, each mapped to the nearest city |
| `zonas` and `alias_zonas` | 11 world zones with a representative point, and 17 ways of naming them |
| `alias_paises` | Short forms of country names |
| `paises_extra` | Small countries the map doesn't draw (Singapore, Bahrain, Hong Kong, Luxembourg, Malta…) with their coordinates |

[`scripts/generar_mapa.py`](scripts/generar_mapa.py) merges it with the borders (`mundo.geojson`) and the country names (`paises.json`) and generates two files that are committed to the repository:

- **`data/lugares.json`** (about 65 KB): the compiled gazetteer the collector uses. Cities are prefixed with `@` (`@FRA` is Frankfurt) so they don't clash with ISO country codes (`FRA` is France); zones are prefixed with `Z:`. Each country gets a centroid, taken from its largest polygon (its mainland).
- **`data/mapa.json`** (about 6 KB): the world map as an LED matrix. See [its format](#datamapajson).

If a failure is in a city that isn't listed, it's placed at the centre of its country. To add a city or a region:

```bash
# 1. Edit data/geo/lugares_base.json
# 2. Regenerate
python3 scripts/generar_mapa.py
# mapa: 93×240, 6852 puntos de tierra
# lugares: 441 (243 ciudades, 143 regiones, 505 nombres de país)
# 3. Check
python3 -m unittest discover -s tests
```

### The projection

Equirectangular, from 82° N to 56° S, cropping the poles (no data centres, and they take up a lot of room). Each row is a parallel every 1.5°, and odd rows are shifted half a dot so the grid is staggered, like an LED panel. In the browser, a place's coordinates map to the grid with `x = (lon + 180) / 1.5` and `y = (82 − lat) / 1.5`. All the land is drawn as a single SVG `<path>` with one zero-length segment per dot and round caps: thousands of dots in one element.

---

## Architecture

### Overview

```mermaid
flowchart TB
  Fuentes["<b>27 official status pages</b><br/>Statuspage, status.io, Google, Azure,<br/>Azure DevOps, AWS, Slack"]

  subgraph Actions["GitHub Actions, every 10 min"]
    direction LR
    A1["actualizar.py<br/>fetches in parallel,<br/>normalises, places,<br/>keeps history"]
    A2["salud.py<br/>watches the sources"]
    A1 --> A2
  end

  subgraph Main["main branch (code)"]
    direction TB
    Conf["data/proveedores.json"]
    Geo["data/lugares.json<br/>data/mapa.json"]
    Web["index.html, css/, js/"]
  end

  Datos[("datos branch<br/>estado.json<br/>historial.json<br/>incidencias.json")]
  Pages["GitHub Pages<br/>bendi.dev/uptime"]
  Issue["Issue<br/>«Fuentes de datos caídas»"]
  Nav["Browser"]

  Fuentes --> A1
  Conf --> A1
  Geo --> A1
  A1 --> Datos
  A2 -. if a source has been down for 3 h .-> Issue
  Main --> Pages
  Pages --> Nav
  Datos -- raw.githubusercontent.com --> Nav
```

### One run, step by step

```mermaid
sequenceDiagram
  autonumber
  participant C as Cron, merge or manual
  participant A as Action
  participant D as datos branch
  participant F as Status pages
  participant G as Issues
  C->>A: triggers
  A->>D: does it exist? (git ls-remote)
  alt exists
    A->>D: restores data/ (status, history, incidents)
  else doesn't exist
    A->>A: starts from scratch
  else can't be checked
    A--xC: fails, so history isn't wiped
  end
  A->>F: 27 downloads, 8 in parallel
  F-->>A: JSON, RSS or error
  A->>A: translates to the common format, applies the rules, places on the map
  A->>A: merges with the previous data, adds the sample to the history, opens and closes incidents
  A->>D: orphan commit + force push
  A->>G: if a source has failed 18 times in a row, opens or comments on the issue
```

### Inside the site

```mermaid
flowchart LR
  subgraph Browser
    direction TB
    I18n["i18n.js<br/>es / en strings"]
    App["app.js<br/>state, loading, pintar()"]
    Term["terminal.js<br/>commands, Tab, history"]
    I18n --> App --> Term
  end
  Raw["raw.githubusercontent.com<br/>datos branch"] -- "status, history, incidents<br/>every 5 min" --> App
  Local["same origin<br/>data/"] -- "mapa.json once<br/>proveedores.json for services" --> App
  App -- "pintar()" --> DOM["console · map · journal · racks<br/>maintenance · history · PSU"]
  Term -- "irA(), elegirLugar(), elegirIdioma()" --> App
```

- **`i18n.js`** defines `IDIOMAS.es` and `IDIOMAS.en`, plus `idiomaInicial()`.
- **`app.js`** keeps everything in a single `estado` object (data, history, incident log, map, language, filters, open drawers, selected place, pins) and has one function per block (`pintarConsola`, `pintarMapa`, `pintarJournal`, `pintarRacks`…), which `pintar()` calls in order. Every data load and every language change repaints everything; small changes (opening a drawer, selecting a place, pinning) only touch their own part.
- **`terminal.js`** lives inside a closure and builds on `app.js`'s functions. It wraps `pintar()` to repaint its suggestions when the data or the language changes.
- No frameworks, no build step, no dependencies: three classic scripts, one stylesheet and one HTML file.

### Design decisions

| Decision | Why | Rejected alternative |
|---|---|---|
| **Read status pages, don't probe** | Pinging `github.com` from a GitHub runner tells you nothing useful, isn't polite, and can't see partial failures | Custom probes from Actions |
| **One common format** | The site knows nothing about Statuspage or RSS; adding a format doesn't touch the site | Teaching the site every format |
| **The worst signal wins** | Some providers are slow to move their overall indicator | Trusting the overall indicator |
| **Scope matters** | Without it, Cloudflare would always be red | Flagging an outage for any component |
| **Data on a separate branch** | `main` only gets code changes through PRs; `datos` is a single commit that gets replaced, so it never grows | Committing data to `main` every 10 minutes |
| **raw.githubusercontent.com** | Data updates without redeploying Pages, and without CORS issues | Publishing the data through Pages |
| **Our own history** | No public format offers 90 days of history consistently | Reading each provider's history |
| **A hand-made gazetteer** | No runtime dependencies or geocoding services, and full control over ambiguous names | A geocoding API |
| **The map as an LED matrix** | 6 KB, a single SVG element, fits the look and needs no map library | d3 with a 175 KB GeoJSON |
| **A single dark theme** | A NOC is a dark room, and the light comes from the LEDs | Light and dark themes |
| **A toy terminal** | Exploring the data by typing is fast for those who know how and fun for those who don't; clickable suggestions cover everyone else | Just another search box |

---

## Operations

### Workflows

| Workflow | When | What it does | Permissions |
|---|---|---|---|
| [`actualizar.yml`](.github/workflows/actualizar.yml) (*Actualizar datos*, "update data") | Every 10 minutes (`3,13,23,33,43,53 * * * *`); when changes to `scripts/`, `data/proveedores.json`, `data/lugares.json` or the workflow itself are merged into `main`; and manually | Restores the previous data, queries the sources, publishes to `datos` and checks source health | `contents: write`, `issues: write` |
| [`pruebas.yml`](.github/workflows/pruebas.yml) (*Pruebas*, "tests") | On every PR and every push to `development` | `python -m unittest discover -s tests -v` | Defaults |
| `pages-build-deployment` | When `main` changes | GitHub Pages deployment | GitHub's |

The cron minute is offset from the top of the hour, which is when GitHub is busiest and most likely to delay scheduled runs.

### Branch model

```mermaid
gitGraph
  commit id: "start"
  branch development
  checkout development
  commit id: "change"
  commit id: "tests pass"
  checkout main
  merge development id: "PR"
  branch datos
  checkout datos
  commit id: "data, replaced every 10 min"
```

| Branch | Content | Written by |
|---|---|---|
| `development` | Where work happens. Every push runs the tests | People |
| `main` | What Pages serves and what the cron runs. Only takes changes through PRs | PRs from `development` |
| `datos` | The Action's output: a single orphan commit replaced with a *force push* | `github-actions[bot]` |
| `datos-prueba` | Same as `datos`, for test runs. The site doesn't read it | `github-actions[bot]` |

### Setting it up

1. Create the repository and push `main` with the code.
2. Settings → Pages → *Deploy from a branch* → `main`, folder `/` (root). With the account's custom domain, the site lives at `bendi.dev/uptime`.
3. Actions → *Actualizar datos* → *Run workflow*, to create the `datos` branch without waiting for the cron.
4. Check that the site loads and the console bar says `updated … ago`.
5. If you protect branches: protect `main` and `development`, and only allow changes to `main` through PRs. The Action needs no special permissions on `datos`, which must not be protected.

No secrets or variables are needed: every source is public.

### Reliability

| Risk | Mitigation |
|---|---|
| A provider doesn't respond | Its last good data is kept and its card says so |
| A provider changes its format | It raises `FormatoInesperado` and is treated as that source being down, without breaking the rest |
| A source is down for a long time | After 18 runs in a row (3 hours), `salud.py` opens or comments on the *Fuentes de datos caídas* ("data sources down") issue |
| No source responds | Almost certainly the runner's network: the Action fails without publishing |
| `datos` can't be read | The Action fails before publishing: it never overwrites the history with empty data |
| Half-written files | Each file is written to a `.tmp` and then renamed |
| Two runs at once | `concurrency: actualizar-datos` queues them |
| GitHub's cron runs late or skips runs | The Action runs after every merge, can be run manually, and the site warns when data is more than 40 minutes old |
| The browser mixes versions | CSS and JS links carry `?v=N`, bumped on every change |
| Huge or odd responses | Text is stripped of HTML and trimmed (600 characters per message, 200 per title); at most 12 components and 80 points per provider |
| raw.githubusercontent.com caching | About 5 minutes; the site requests data with a parameter that changes every minute and `cache: no-store` |

### Testing changes with real data without touching the site

Actions → *Actualizar datos* → *Run workflow* → branch `development`, with **Publicar** ("publish") unchecked. The data is written to `datos-prueba`:

```bash
git fetch origin datos-prueba
git show origin/datos-prueba:data/estado.json | python3 -m json.tool | less
```

### What it writes to the log

Every run leaves one line per provider in the Action's log (statuses are in Spanish there, since the data itself uses Spanish keys):

```
[ok ] GitHub                   operativo     0 incidencias
[ok ] Cloudflare               grave         0 incidencias
[ERR] OpenAI                   desconocido   0 incidencias  TimeoutError: timed out
```

And `salud.py` prints either `Todas las fuentes responden.` ("all sources are responding") or the issue's table:

| Proveedor | Error | Fallos seguidos | Último dato bueno |
|---|---|---|---|
| OpenAI | HTTP 503 | 18 | 2026-11-02T08:13:36Z |

### Costs and limits

| Resource | Usage | Cost |
|---|---|---|
| GitHub Actions | About 144 runs a day, under a minute each | Free for public repositories |
| GitHub Pages | About 90 KB of site, including the map | Free |
| `datos` branch | About 250 KB with 90 days of history; it doesn't grow, since it's a single commit | Free |
| Requests to providers | 27 every 10 minutes, with a `User-Agent` that identifies the project | Status pages are public and meant for this |

### Troubleshooting

| Symptom | What to check |
|---|---|
| The site says data is running late | Actions → *Actualizar datos*: are there recent runs? GitHub's cron sometimes skips runs; trigger it manually. |
| There are only `push` and `workflow_dispatch` runs, never `schedule` | GitHub hasn't registered the cron, which sometimes happens with new repositories. Run the workflow manually once; if it still doesn't show up, change the cron minute in `actualizar.yml` and merge it into `main`. Also, GitHub disables scheduled workflows in repositories with no activity for 60 days: a commit re-enables them. |
| The *Fuentes de datos caídas* issue appears | The issue says which provider and which error. If it's *formato inesperado* (unexpected format), its page has changed and its parser or `tipo` needs updating. If it's HTTP 404, its address may have changed. |
| A provider's status doesn't match its website | Check its drawer: it may be the worst-signal rule (a component down with the indicator green) or the scope rule. |
| The map shows no dots | Is anything failing? If so, and everything is under *no specific location*, the names contain no recognisable places. If a city is missing, add it to `lugares_base.json`. |
| A dot sits in the middle of a country | Its city isn't in the gazetteer: add it with its IATA code. |
| The site doesn't load data | Check that the `datos` branch exists, and check the `<meta name="uptime-datos">` tag in `index.html`. |
| The site looks broken after a deploy | Bump the `?v=N` number in `index.html`. |
| The terminal says *offline* | The data hasn't loaded: same problem as the row above. |

---

## Development

### Layout

```
uptime/
├── index.html                    Single page
├── css/estilo.css                Styles: room, console, terminal, map, racks, drawers and PSU
├── js/
│   ├── i18n.js                   English and Spanish strings, and the initial language
│   ├── app.js                    State, loading, console, map, journal, racks, drawers, filters and notifications
│   └── terminal.js               The console's command line
├── data/
│   ├── proveedores.json          What is queried and in which format
│   ├── mapa.json                 World map as an LED matrix (generated)
│   ├── lugares.json              Compiled gazetteer (generated)
│   └── geo/
│       ├── lugares_base.json     Cities, regions, zones and aliases (hand-made)
│       ├── mundo.geojson         Borders of 180 countries (public domain)
│       └── paises.json           ISO 3166 names in English and Spanish
├── scripts/
│   ├── actualizar.py             Fetches, normalises, places and keeps the history
│   ├── generar_mapa.py           Builds mapa.json and lugares.json from data/geo/
│   └── salud.py                  Report of failing sources, for the issue
├── tests/test_actualizar.py      Tests with sample responses for each format
├── docs/screenshots/             Screenshots for this README
└── .github/
    ├── workflows/                actualizar.yml and pruebas.yml
    └── FUNDING.yml               The repository's Sponsor button
```

The code is written in Spanish (identifiers, comments and commit messages), the same as atalaya. The table below is a glossary for the names you'll meet most often.

| Spanish | English |
|---|---|
| `actualizar` · `datos` · `pruebas` · `salud` | update · data · tests · health |
| `proveedor` · `fuente` · `incidencia` · `mantenimiento` · `componente` | provider · source · incident · maintenance · component |
| `estado` · `nivel` · `peor` · `operativo` · `degradado` · `parcial` · `grave` · `desconocido` · `aviso` | status · level · worst · operational · degraded · partial · major · unknown · advisory |
| `historial` · `muestras` · `caídas` | history · samples · outages |
| `lugar` · `ciudad` · `país` · `zona` · `mapa` · `ubicar` | place · city · country · zone · map · locate |
| `pintar` · `cajón` · `fijado` · `idioma` · `orden` | render · drawer · pinned · language · command |

There's no generated data on `main`: `estado.json`, `historial.json` and `incidencias.json` are in `.gitignore` and live on the `datos` branch.

### Running it locally

```bash
# Tests
python3 -m unittest discover -s tests -v

# Real data (writes estado.json, historial.json and incidencias.json to data/)
python3 scripts/actualizar.py

# Or the published data, without querying anyone
git fetch origin datos
for f in estado historial incidencias; do git show origin/datos:data/$f.json > data/$f.json; done

# Site: on localhost it reads data/ instead of the datos branch
python3 -m http.server 8000      # http://localhost:8000

# If you change data/geo/
python3 scripts/generar_mapa.py
```

`UPTIME_SALIDA=/path` changes where `actualizar.py` writes (the Action uses it to write into its copy of the `datos` branch).

### Constants

In [`actualizar.py`](scripts/actualizar.py):

| Constant | Value | Purpose |
|---|---|---|
| `DIAS_HISTORIAL` | 90 | Days of daily history |
| `DIAS_INCIDENCIAS` | 30 | Days closed incidents are kept |
| `FALLOS_PARA_AVISAR` | 18 | Failed runs in a row (3 h) before a source becomes *no data* and the issue is opened |
| `ALCANCE_MINIMO` | 0.05 | Share of components below which the *degraded* cap applies |
| `COMPONENTES_MINIMOS` | 20 | Minimum number of components for that rule |
| `MAX_COMPONENTES` | 12 | Affected components stored per provider |
| `MAX_TEXTO` | 600 | Characters kept from each incident's latest message |
| `MAX_LUGARES` | 80 | Map points per provider |
| `MAX_EJEMPLOS` | 4 | Source texts stored per point |
| `TIEMPO_ESPERA` | 20 | Seconds per download |
| `REINTENTOS` | 2 | Retries per download |
| `AGENTE` | `uptime/1.0 (+https://github.com/serbenda/uptime)` | Requests' `User-Agent` |

In the site:

| Constant | Where | Value | Purpose |
|---|---|---|---|
| `REFRESCO_MS` | `app.js` | 5 min | How often data is reloaded |
| `VIEJO_MIN` | `app.js` | 40 min | When to warn that data is running late |
| `DIAS` | `app.js` | 90 | Bars in each server's graph |
| `LIMITE` | `app.js` | 8 | Incidents shown before *more entries* |
| `POR_PROVEEDOR` | `app.js` | 3 | Maintenance windows shown per provider |
| `MAX_NODOS` | `terminal.js` | 300 | Output lines kept by the terminal |

### The common provider format

This is what every `procesar_<tipo>()` returns and what the site reads. `vacio()` provides the template.

```python
{
  "estado": "operativo|mantenimiento|degradado|parcial|grave",
  "resumen": "text published by the provider, or ''",
  "componentes": [{"nombre": "…", "estado": "…"}],       # affected only, at most 12
  "total_componentes": 0,                                # 0 if the format has no components
  "afectados": 0,                                        # filled in by estado_final()
  "alcance_limitado": False,                             # filled in by estado_final()
  "incidencias": [{
      "id": "…", "titulo": "…", "impacto": "aviso|degradado|parcial|grave",
      "fase": "Investigando…", "inicio": "ISO", "actualizado": "ISO",
      "mensaje": "latest message", "enlace": "https://…",
      "afecta": ["product"],                             # optional
      "lugares_texto": ["text with places"],             # optional, only used to place it; not stored
  }],
  "mantenimientos": [{"id": "…", "titulo": "…", "fase": "…", "en_curso": False,
                      "inicio": "ISO", "fin": "ISO", "enlace": "https://…"}],
  "lugares": [],                                         # filled in by estado_final()
  "sin_ubicacion": 0,                                    # filled in by estado_final()
}
```

### Tests

[`tests/test_actualizar.py`](tests/test_actualizar.py) has 33 `unittest` tests built on sample responses for each format. They don't connect to anything: if a provider changes its format, these tests won't notice, but the Action will (it flags it as *formato inesperado* and, if it persists, opens the issue).

| Class | What it checks |
|---|---|
| `TestUtilidades` | The level scale, dates (ISO, RFC 822, seconds and milliseconds since 1970), HTML stripping and UTF-16 JSON |
| `TestStatuspage` | All clear, incidents and components, groups not counting, maintenance, broken format, the scope rule and advisories (by impact and by title) |
| `TestStatusio`, `TestGoogle`, `TestAzure`, `TestAzureDevOps`, `TestAws`, `TestSlack` | Each format: normal case, incidents, empty and broken; for Azure DevOps, that maintenance doesn't count as degraded |
| `TestUbicacion` | 13 real-world texts with their expected result (Cloudflare, Linode, AWS, Google, Azure, Akamai, acronyms that aren't airports…), that the gazetteer has no broken references, and that `localizar()` merges, ranks and skips advisories |
| `TestConsulta` | URLs, that a network or format error doesn't break anything, and that every provider in the config is valid |
| `TestPersistencia` | That a failing source keeps its data and becomes *no data* on time, that history is trimmed and doesn't count what wasn't measured, and that incidents open and close (and don't close when the source fails) |

The site has no automated tests; it's checked in the browser, on desktop and mobile, in both languages.

### Strings and languages

Every string on the site lives in [`js/i18n.js`](js/i18n.js), with both versions side by side:

- Fixed text in the HTML carries `data-i18n="key"` (content), `data-i18n-aria="key"` (`aria-label`) or `data-i18n-ph="key"` (`placeholder`).
- Sentences with data in them are functions, so each language can order its words and handle plurals its own way: `con_problemas: (nombres, n) => \`${nombres} ${n === 1 ? "is" : "are"} having problems.\``.
- The terminal has its own block, `term`, with each command's description and usage.

To add a string, add the same key to both `es` and `en`. To add a language, copy the `en` block under a new code, translate it and add its button to the console's switcher; `idiomaInicial()` and everything else pick it up automatically.

### Design

| Token | Value | Used for |
|---|---|---|
| `--sala` | `#0F151B` | Background, with a faint raised-floor grid |
| `--metal` | `#18212A` | Rack frames |
| `--frontal` | `#222D38` | Server faces |
| `--terminal` | `#0A1016` | Console, drawers, journal, map |
| `--tinta` | `#DCE6EE` | Main text |
| `--prompt` | `#6FB7FF` | Prompt, terminal links, focus |
| `--operativo` · `--mantenimiento` · `--degradado` · `--parcial` · `--grave` · `--desconocido` · `--aviso` | `#43D17F` · `#5AA9FF` · `#F2C230` · `#FF8A2A` · `#FF4D4D` · `#6B7885` · `#B79CFF` | The LEDs |

- **Type**: [Archivo](https://fonts.google.com/specimen/Archivo), with variable width (narrow in the verdict and headings), for labels; [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) for anything that comes out of a terminal.
- **Colour means something**: bright colours are reserved for LEDs and statuses; everything else is metal and ink.
- **A single entrance animation**: the console typing itself. All other motion responds to something (an LED warning you, a dot pulsing, a drawer sliding out).

### Conventions

- Python 3.12, standard library only. JavaScript with no frameworks and no build step.
- Code, comments and commit messages in Spanish; documentation in English. Provider ids are lowercase with hyphens.
- Work happens on `development`; `main` is only reached through PRs.
- If you change CSS or JS, bump the `?v=N` in `index.html`.
- If you change `data/geo/`, regenerate with `generar_mapa.py` and commit the generated files too.

---

## Data formats

Field names are in Spanish, like the code (see the [glossary](#layout)).

### On the `datos` branch

#### `estado.json`

```json
{
  "actualizado": "2026-11-02T15:53:36Z",
  "categorias": {"nube": "Nube", "desarrollo": "Desarrollo", "red": "Red y CDN", "colaboracion": "Colaboración", "ia": "IA"},
  "resumen": {"total": 27, "con_problemas": 5, "peor": "grave", "sin_datos": 0},
  "proveedores": [
    {
      "id": "linode",
      "nombre": "Akamai Cloud (Linode)",
      "categoria": "nube",
      "web": "https://status.linode.com",
      "estado": "degradado",
      "resumen": "Partially Degraded Service",
      "componentes": [{"nombre": "US-Southeast (Atlanta)", "estado": "degradado"}],
      "total_componentes": 242,
      "afectados": 1,
      "alcance_limitado": true,
      "incidencias": [{
        "id": "nt58zhx3pmgm",
        "titulo": "Customer Security Advisory: CVE-2026-98432",
        "impacto": "aviso",
        "fase": "Investigando",
        "inicio": "2026-10-30T18:10:58Z",
        "actualizado": "2026-11-02T10:55:43Z",
        "mensaje": "While we continue to deploy kernel patches across our infrastructure…",
        "enlace": "https://stspg.io/9pzh45ps11bv"
      }],
      "mantenimientos": [{
        "id": "jkxgzslpmgl4",
        "titulo": "Scheduled Longview Maintenance - US-Central (Dallas)",
        "fase": "Programado",
        "en_curso": false,
        "inicio": "2026-11-03T05:30:00Z",
        "fin": "2026-11-03T11:30:00Z",
        "enlace": "https://stspg.io/00rz5txrcy3z"
      }],
      "lugares": [{
        "id": "@ATL", "en": "Atlanta", "es": "Atlanta", "lat": 33.75, "lon": -84.39,
        "pais": "USA", "pais_en": "United States", "pais_es": "Estados Unidos",
        "nivel": "degradado", "n": 2,
        "ejemplos": [
          {"t": "US-Southeast (Atlanta)", "nivel": "degradado"},
          {"t": "Service Issue - US-Southeast (Atlanta)", "nivel": "degradado"}
        ]
      }],
      "sin_ubicacion": 0,
      "fuente": {
        "comprobado": "2026-11-02T15:53:36Z",
        "ok": true,
        "error": null,
        "fallos_seguidos": 0,
        "ultimo_ok": "2026-11-02T15:53:36Z"
      }
    }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `actualizado` | ISO 8601 UTC | When the run finished |
| `categorias` | object | The racks, in the order they're drawn |
| `resumen.total` · `con_problemas` · `peor` · `sin_datos` | number · number · level · number | Global summary: total, failing, worst level, without data |
| `proveedores[].estado` | level or `desconocido` | Final status, after the rules |
| `proveedores[].resumen` | text | The sentence the provider itself publishes |
| `proveedores[].componentes` | list | Affected components, worst first, at most 12 |
| `proveedores[].total_componentes` · `afectados` | number | Totals, for the `59 of 473` line |
| `proveedores[].alcance_limitado` | boolean | Whether the *degraded* cap was applied |
| `proveedores[].incidencias[].impacto` | level or `aviso` | Each incident's severity |
| `proveedores[].incidencias[].fase` | text | Phase, already translated to Spanish; the site translates it back |
| `proveedores[].lugares[]` | list | Map points, worst first, at most 80 |
| `proveedores[].lugares[].id` | text | `@IAH` city, `USA` country, `Z:europe` zone |
| `proveedores[].lugares[].n` | number | How many components and incidents placed it there |
| `proveedores[].sin_ubicacion` | number | Failures that couldn't be placed |
| `proveedores[].fuente` | object | Status page health: last check, whether it responded, error, consecutive failures and last good data |

#### `historial.json`

```json
{"aws": {"2026-11-01": {"m": 144, "c": 144, "peor": "parcial"}, "2026-11-02": {"m": 96, "c": 96, "peor": "parcial"}}}
```

Per provider and UTC day: samples (`m`), samples with a partial or major outage (`c`) and the day's worst status (`peor`). Trimmed to 90 days.

#### `incidencias.json`

```json
{
  "aws:arn:aws:health:me-central-1::event/MULTIPLE_SERVICES/…": {
    "proveedor": "aws",
    "titulo": "Multiple services (UAE): Region Availability",
    "impacto": "parcial",
    "inicio": "2026-03-01T12:51:25Z",
    "visto": "2026-11-02T15:53:36Z",
    "fin": null,
    "enlace": "https://health.aws.amazon.com/health/status"
  }
}
```

The key is `provider:id`. An incident opens the first time it's seen and closes (`fin` = the last time it was seen) once it no longer appears on the provider's page. If the source fails, its open incidents aren't closed. `impacto` holds the worst level seen, unless the incident becomes an advisory. Closed incidents are deleted after 30 days.

### On `main`

#### `data/proveedores.json`

See [Adding a provider](#adding-a-provider).

#### `data/mapa.json`

```json
{"paso": 1.5, "lat_max": 82.0, "columnas": 240, "filas": ["0000000001fffffffc00…", "…"]}
```

93 rows (from 82° N to 56° S, every 1.5°) of 60 hexadecimal characters: each character is 4 dots of the row, left to right, with `1` for land. Odd rows are shifted half a dot east.

#### `data/lugares.json`

```json
{
  "regiones": {"us-east-1": "@IAD", "West Europe": "@AMS", "…": "…"},
  "iata":     {"IAH": "@IAH", "…": "…"},
  "ciudades": {"Houston": "@IAH", "London": "@LHR", "Londres": "@LHR", "…": "…"},
  "paises":   {"Spain": "ESP", "España": "ESP", "UK": "GBR", "…": "…"},
  "zonas":    {"Europe": "Z:europe", "APAC": "Z:apac", "…": "…"},
  "lugares":  {"@IAH": {"en": "Houston", "es": "Houston", "lat": 29.76, "lon": -95.37, "pais": "USA",
                        "pais_en": "United States", "pais_es": "Estados Unidos"},
               "ESP":  {"en": "Spain", "es": "España", "lat": 40.35, "lon": -3.62},
               "…": "…"}
}
```

The first five tables map a name to an id; `lugares` maps an id to its name in both languages and its coordinates.

### In the browser

| `localStorage` key | What it stores |
|---|---|
| `uptime.idioma` | `es` or `en` |
| `uptime.fijados` | Ids of pinned services |
| `uptime.historial` | The last 50 terminal commands |

Every read and write is wrapped in `try/catch`: if the browser won't store anything (private mode, blocked storage), the site works the same and just forgets on reload.

---

## Security and privacy

- **No servers, no accounts, no cookies, no analytics, no tracking.** The page is static and sends nothing to anyone.
- **The terminal doesn't execute anything**: it's a fixed-command interpreter written in JavaScript. What you type never leaves the browser, and it's always rendered as text (`textContent`), never as HTML.
- **Provider text** is stripped of tags by the collector and inserted as text on the site, so an incident title containing HTML can't inject anything.
- **External links** open with `rel="noopener"`.
- **Notifications** are local: the tab itself generates them when it sees a change in the data. There's no *push* and no subscription.
- **The Action** only has `contents: write` (to publish to `datos`) and `issues: write` (to raise the alarm). It uses no secrets.
- **Polite requests**: 27 every 10 minutes, to public pages built for this, with a `User-Agent` that says who's asking.
- **Third parties on the site**: fonts from Google Fonts, and data from `raw.githubusercontent.com`.

---

## FAQ

**Why doesn't it ping the services?**
Because a ping from a GitHub runner only tells you whether that runner can reach that server. It can't see an Actions outage in Europe, a billing problem or an AWS region going down. Status pages can, and they're the source the providers themselves maintain. The terminal's `ping` command explains this too.

**Why does a provider show failures when its website says "All Systems Operational"?**
Because the worst signal wins: it may have an affected component or an open incident while its overall indicator is green. Its drawer tells you exactly what.

**And the other way round: why is Cloudflare degraded and not red, with cities down?**
Because of the scope rule: fewer than 5% of components affected, with no serious incident, means degraded. On the map, those cities do show up in red.

**Why has AWS had an incident open since March?**
Because AWS is still publishing it: they're events for its Middle East regions (UAE and Bahrain). uptime shows what the provider publishes.

**Why does a service show 0.00% availability?**
Because every sample measured so far had a partial or major outage open. With only a few days of history the number is very sensitive; with 90, it settles.

**Is it real time?**
Almost: data is updated every 10 minutes (if GitHub honours the cron) and the site reloads it every 5. A problem a provider publishes at 10:02 shows up by around 10:20 at the latest.

**Why isn't Microsoft 365 included?**
Because its status is only available through Microsoft Graph, with tenant credentials.

**Can I add a service?**
Yes, if it has a public status page in one of the known formats: it's one line in `data/proveedores.json`. See [Adding a provider](#adding-a-provider).

**Is it official?**
No. It's a personal project with no relationship to any of the providers. Names and trademarks belong to their owners.

**Why "NOC", and why `bendi@noc`?**
A NOC is a *Network Operations Center*, the room where people make sure everything keeps working. `noc` is the machine's name in the prompt: you're logged into the NOC's terminal.

**Why is the code in Spanish?**
Because that's the author's working language, as in his other projects. The documentation is in English, and the site speaks both.

---

## Known limitations

- **It only knows what gets published.** If a provider is slow to acknowledge an outage, so is uptime; if it never publishes it, it didn't happen.
- **The granularity is 10 minutes**, and GitHub can delay or skip scheduled runs. A 5-minute outage between two samples may go unseen.
- **The map depends on names.** An incident titled *Elevated errors for some customers* has nowhere to go, and a place missing from the gazetteer lands in the middle of its country.
- **Cities with the same name resolve to the one in the gazetteer**: `Santiago` is Santiago de Chile, `Portland` is Portland, Oregon.
- **Azure and AWS give little detail**: Azure only publishes active incidents as RSS, without components; AWS, standalone events. Their statuses are coarser as a result (everything is a *partial outage*).
- **Percentages aren't SLAs**: they're time with a published partial or major outage, measured in 10-minute samples.
- **Security advisories are recognised by their title.** An advisory with a different title would count as a degradation.
- **Browser notifications** only work while the tab is open.

---

## Roadmap

- [ ] Microsoft 365 through Microsoft Graph (requires registering an application in a tenant).
- [ ] More providers: Oracle Cloud, IBM Cloud, Fastly, Datadog, Sentry, Stripe.
- [ ] Docker Hub is moving its status page to incident.io: its parser will need updating when it switches.
- [ ] uptime's own RSS feed with every provider's incidents.
- [ ] Telegram or email alerts for pinned services, without keeping the page open.
- [ ] Correlation view: several providers failing in the same place at once usually points to a shared third party (a cable, a shared data centre).
- [ ] More cities in the gazetteer, as they appear in the data.
- [ ] Automated tests for the site.

---

## Credits

| What | Where from | Licence |
|---|---|---|
| Service status | Each provider's official status page | Public; data and trademarks belong to their owners |
| Country borders | [world.geo.json](https://github.com/johan/world.geo.json), the same as atalaya | Public domain |
| Country names | ISO 3166, in English and Spanish, the same as atalaya | |
| Cities, regions and zones | Hand-made compilation in `lugares_base.json` | |
| Typefaces | [Archivo](https://fonts.google.com/specimen/Archivo) and [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono), via Google Fonts | SIL Open Font License |
| Infrastructure | GitHub Actions and GitHub Pages | |

A sibling of [atalaya](https://github.com/serbenda/atalaya). Made by [Bendi](https://bendi.dev).

---

## Support the project

uptime is a personal project: free, with no ads and no tracking. If it's ever saved you from an "is it me or is it them?", you can help keep the lights on through [GitHub Sponsors](https://github.com/sponsors/serbenda). On the site it's the NOC's power supply, and in the terminal, `sponsor`.
