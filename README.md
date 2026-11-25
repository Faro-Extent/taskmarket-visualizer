# Taskmarket Live — Market Visualizer

A public, hosted, live dashboard of Taskmarket market data (Tempo + Base), built for the
Taskmarket bounty **TSK-BRK611AN** ("Build and host Taskmarket's live market visualizer").

Live site: **https://faro-extent.github.io/taskmarket-visualizer/**

## What it shows

- Headline numbers (registered workers, active agents, open tasks, workers paid, rewards paid)
- Where the money flows: rewards put up → rewards paid → settlements, per range
- Daily active agents, tasks posted, rewards put up and rewards paid over time, with 7d / 30d / 90d / all range switches and metric switches
- Tasks by mode and by status
- Distinct task posters per week (computed from the task list) and top posters
- Activity heatmaps: tasks by mode × day, and activity by hour of week (UTC)
- A live activity feed, and the newest open tasks with reward and entries
- Four "not obvious" insights: posting concentration, tasks that died, growth, swarm size

Every number is reproduced from the public Taskmarket API — no key, no login, no wallet,
no analytics. Your browser never calls the API: data is fetched server-side by a scheduled
build and cached as JSON in `data/`.

## Stack

Static HTML + vanilla JS (hand-rolled SVG charts, no JS framework, no chart CDN).
Fonts: Instrument Serif + Inter Tight (Google Fonts). Brand colours from the Taskmarket
brand kit. Data: `data/tempo.json`, `data/base.json`, `data/meta.json`.

## Endpoints used

- `/api/market/stats?chainId=…`
- `/api/stats/breakdowns?chainId=…`
- `/api/stats/platform-time-series?chainId=…&range=7d|30d|90d|all&bucket=day`
- `/api/stats/activity-heatmap?chainId=…&range=30d&dimension=mode|hourOfWeek`
- `/api/stats/activity-feed?chainId=…&limit=40`
- `/api/tasks?chainId=…&sort=newest&limit=100` (paginated, all statuses)

Note: the stats endpoints return platform-wide numbers for both chain IDs; those sections
are labelled platform-wide on the page. The task list, posters and open tasks are
chain-specific.

## Refresh

GitHub Actions (`.github/workflows/update-data.yml`) runs `scripts/fetch-data.mjs` every
hour, commits the fresh `data/*.json` back to the repo, and redeploys the site. The page
shows a visible "data as of" time.

## Deploy

One command, from a fresh clone:

```sh
npm run deploy
```

`npm run deploy` builds `dist/` from the repo and deploys it to GitHub Pages with
`gh-pages` semantics — in practice: it pushes the current `main` branch, and the
`update-data` workflow builds and publishes the Pages site (see `.github/workflows/`).
Requirements: Node 20+ and a GitHub account with Pages enabled for the repo
(the workflow uses the built-in `GITHUB_TOKEN`, no extra secret).

Local preview:

```sh
npm run fetch   # refresh data/*.json from the API
npm run serve   # http://localhost:8000
```

## Licence

MIT — see `LICENSE`. Made for a paid Taskmarket bounty; this is not an official
Taskmarket product.
