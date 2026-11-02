<div align="center">

# uptime

**Is it down or is it just me?**

Real-time status of the IT services we use every day: GitHub, Microsoft Azure,<br>
Red Hat, Google Cloud, AWS, Cloudflare and more. Incidents, maintenance and outages in one panel.

[![Update data](https://github.com/serbenda/uptime/actions/workflows/actualizar.yml/badge.svg)](https://github.com/serbenda/uptime/actions/workflows/actualizar.yml)
[![Tests](https://github.com/serbenda/uptime/actions/workflows/pruebas.yml/badge.svg)](https://github.com/serbenda/uptime/actions/workflows/pruebas.yml)
[![Sponsor uptime on GitHub Sponsors](https://img.shields.io/badge/Sponsor_uptime-GitHub_Sponsors-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/serbenda)

[Castellano](README.md) · **English**

</div>

> [!NOTE]
> uptime **does not probe** services itself: it reads what each provider publishes on its official status page. If a provider is slow to acknowledge a problem, or doesn't report it, it won't show up here either. Availability figures are an estimate based on those pages, not anyone's SLA.

The full documentation (architecture, operations, data format) is in [Spanish](README.md). This page is a summary.

## What it is

When something breaks, the first question is whether the problem is yours or the provider's. uptime brings together, on one page, the status of the services almost every tech team depends on: clouds, code forges, package registries, CDNs and collaboration tools. Every 10 minutes it reads their official status pages, translates them into a common format and keeps the history.

It's a sibling of [atalaya](https://github.com/serbenda/atalaya), with the same **zero servers, zero cost** approach: everything runs on GitHub Actions and GitHub Pages, with dependency-free Python and a static page.

## What you see

The site is a NOC (network operations centre): each category is a rack and each provider a server with its own status LED. It's available in Spanish and English: it follows your browser, and you can switch with `LANG= es_ES en_US` in the console bar or with `?lang=en`.

| Part | What it does |
|---|---|
| **Console** | A terminal session running `uptime` and `systemctl --failed`. It answers with `[  OK  ] All systems operational.` or `[FAILED] GitHub and Azure are having problems.` The *load average* is real: the share of services with an outage now, and on average over 7 and 30 days. |
| **Terminal** | The console is also a real command line, a toy shell answering with the page's data: `status github`, `systemctl --failed`, `ls cloud`, `geoiplookup singapore`, `top`, `journalctl aws`, `neofetch`, `lang es`… Press `/` anywhere to jump to it; Tab completes and ↑ ↓ browse history. Nothing you type leaves your browser. |
| **Outage map** | A world map made of LEDs, lit wherever something is failing: colour is the worst status, size is how many failures, major outages pulse. Hover to see who's failing; click for a `geoiplookup` with each provider and the component or incident that put it there. |
| **Open incidents** | A `journalctl` with every active incident, most severe first, expandable to the provider's latest message. |
| **Racks** | One rack per category. Each server has its LED (blinking when failing), its status, a 90-day graph and an availability display. Click it to pull out a drawer with its diagnostics terminal. |
| **Filters and pins** | `grep -i` to search, flags to pick a rack, and a pin to keep a server on top and get a browser notification when it fails or recovers. |
| **Maintenance and history** | A `crontab -l` with ongoing and upcoming maintenance, and a `last` with the incidents of the last 30 days and how long they lasted. |
| **Power supply** | The GitHub Sponsors section, styled as a server PSU. |

Everything can be shared with a link: `#p=github` opens GitHub's drawer directly.

## Providers

27 providers across five racks: AWS, Microsoft Azure, Google Cloud, Red Hat, DigitalOcean, Akamai Cloud (Linode), GitHub, GitLab, Bitbucket, Azure DevOps, Docker Hub, HashiCorp, npm, PyPI, CircleCI, Cloudflare, Akamai, Netlify, Vercel, Google Workspace, Slack, Zoom, Jira, Confluence, Dropbox, Discord and OpenAI.

Seven status formats are supported: Atlassian Statuspage, status.io, Google's `incidents.json`, the Azure RSS feed, the Azure DevOps health API, the AWS Health Dashboard public events and the Slack status API. Adding a provider that uses one of them is one line in [`data/proveedores.json`](data/proveedores.json).

Microsoft 365 isn't included: its status is only published through Microsoft Graph, with tenant credentials.

## How the map locates failures

Status pages don't carry coordinates, but they do carry place names. For each affected component and incident title, uptime looks for, from most to least specific: a cloud region (`us-east-1`, `West Europe`), an IATA code (`Houston, United States - (IAH)`), a city, a country or a world zone (`Europe`, `APAC`). The gazetteer is in [`data/geo/lugares_base.json`](data/geo/lugares_base.json) and [`scripts/generar_mapa.py`](scripts/generar_mapa.py) compiles it, together with the LED world map.

## Running it locally

```bash
python3 -m unittest discover -s tests -v   # tests
python3 scripts/actualizar.py              # writes estado.json, historial.json and incidencias.json to data/
python3 -m http.server 8000                # http://localhost:8000 reads data/ instead of the data branch
```

## Support the project

uptime is free, with no ads and no tracking. If you find it useful, you can support it on [GitHub Sponsors](https://github.com/sponsors/serbenda).
