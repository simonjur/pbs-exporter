# 12. Status UI

> Part of the [PBS Exporter specification](../SPEC.md). See the index for the
> spec-driven-development workflow and the meaning of **[offline-ok]** / **[needs-pbs]**.

The root path `/` serves a human-facing status dashboard (the Prometheus metrics
remain on the configured metrics path). It is a Vue 3 + Vuetify 3 single-page app
pre-built into the `public/` directory by `npm run build:fe`; both libraries are
served as their browser builds (no CDN), so the page works in air-gapped
environments. The server serves `public/` as-is and requires it to exist. The page
is backed by an
in-memory store ([`src/status.ts`](../src/status.ts)) that holds the **latest** scrape
result per resolved target — the exporter is otherwise stateless, so a target only
appears once it has been scraped (or, for a fixed `endpoint`, it is seeded as
*pending* at startup).

| ID | Requirement | Verify |
|----|-------------|--------|
| REQ-UI-1 | `GET /` serves the Vue 3 + Vuetify 3 status page; its assets are served locally under `/assets/` (`app.js`, `vue.global.prod.js`, `vuetify.min.js`, `vuetify.min.css`) with correct content types — never fetched from a CDN. | `curl -sI /assets/vuetify.min.css` → `text/css`; `/assets/vue.global.prod.js` and `/assets/app.js` → `text/javascript`; page HTML contains no external `http(s)://` asset URLs. **[offline-ok]** |
| REQ-UI-6 | The status-UI assets are pre-built into the `public/` directory by `npm run build:fe` (app shell from `src/web/` plus the Vue/Vuetify browser builds from `node_modules`); the server serves `public/` and does **not** resolve assets from `node_modules` at runtime. If `public/` (or `public/index.html`) is missing at startup, the server exits non-zero with an actionable error naming `npm run build:fe`. | `npm run build:fe` populates `public/index.html` + `public/assets/*`; starting with `public/` removed exits non-zero with an `ERROR:` line mentioning `npm run build:fe`. **[offline-ok]** |
| REQ-UI-2 | `GET /api/status` returns JSON: `{ exporter: {version, commit, buildTime}, summary: {total, up, down, pending}, targets: [{target, up, version, release, lastScrapeMs, error}] }`. | `curl -s /api/status \| jq` shows the documented shape. **[offline-ok]** |
| REQ-UI-3 | The store records the latest result per resolved target after each scrape; counts in `summary` reflect `up` (`up===true`), `down` (`up===false`), and `pending` (never scraped). A fixed `endpoint` is seeded as `pending` before its first scrape. | With `PBS_ENDPOINT` set, `/api/status` shows the target as `pending` before any `/metrics` hit, then `up`/`down` after. **[offline-ok]** |
| REQ-UI-4 | For an `up` target the UI/API expose the PBS `version` (and `release`) and the last-scrape time; for a `down` target the `error` message from the failed scrape is shown. | Scrape an unreachable target → `/api/status` target has `up:false` and a non-null `error`; scrape a working PBS → `up:true` with a `version`. **[offline-ok]** for the error path; **[needs-pbs]** for the populated version. |
| REQ-UI-5 | The status store is a separate, unit-tested module. | `npm run tests:unit` includes `src/status.test.ts` and passes. **[offline-ok]** |
