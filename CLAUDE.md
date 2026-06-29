# CLAUDE.md

## Specification (source of truth)

[SPEC.md](SPEC.md) is the spec-driven-development source of truth for what the
exporter must do. It is an index; the requirements live in per-area files under
[spec/](spec/) (e.g. [spec/configuration.md](spec/configuration.md),
[spec/http-server.md](spec/http-server.md)), each grouping a set of stable `REQ-*` IDs
with a verification method. When behavior changes, update the relevant `spec/` file
**first** (and the index if an area is added/removed), then the code, then re-verify
against it. To check the app does what it's supposed to, work through SPEC.md's "How to
verify" section and report PASS/FAIL/SKIP per requirement ID.

## Stack

This project is a **Node.js (>= 24) / TypeScript** application. It is run directly from
TypeScript via Node's native type stripping — there is no required build step to run it.

- Runtime deps: [`prom-client`](https://github.com/siimon/prom-client) (metrics),
  [`undici`](https://github.com/nodejs/undici) (HTTP/TLS dispatcher for `fetch`),
  [`commander`](https://github.com/tj/commander.js) (flag parsing),
  [`parse-duration`](https://github.com/jkroso/parse-duration) (timeout duration parsing),
  [`winston`](https://github.com/winstonjs/winston) (logging),
  [`vue`](https://vuejs.org) + [`vuetify`](https://vuetifyjs.com) (browser builds for the
  status UI on `/`). The frontend is assembled into `public/` by `npm run build:fe`
  (copies the app shell + the Vue/Vuetify browser builds; no bundler yet); the server
  serves `public/` as-is and requires it to exist.
- Dev deps: `typescript`, `@types/node`, `vitest`, `@vitest/coverage-v8`,
  `eslint` (v10, flat config), `@eslint/js`, `typescript-eslint`, `prettier`.

### Layout

Tests live under [`src/__tests__/`](src/__tests__) (mirroring the `src/` layout) with the
`*.test.ts` suffix; shared fixtures/helpers sit alongside them (`pbs.fixtures.ts`). See the
[testing spec](spec/testing.md) (`REQ-TEST-*`) for the authoritative testing conventions.

- [src/run.ts](src/run.ts) — process entrypoint: the only place using commander
  (`import { program } from "commander"`), parses CLI flags, calls `loadConfig`, then
  `main()`. Thin and excluded from coverage.
- [src/main.ts](src/main.ts) — exports `main(config)`: wires collaborators and starts the
  HTTP server. Thin and excluded from coverage.
- [src/exporter.ts](src/exporter.ts) — the `Exporter` PBS API client and per-scrape metric
  collection (timeout + TLS dispatcher injected); unit-tested.
- [src/__tests__/exporter.test.ts](src/__tests__/exporter.test.ts) — vitest tests driving the exporter with
  mocked PBS responses (`fetch` stubbed).
- [src/server.ts](src/server.ts) — HTTP layer: `/metrics` scrape, `/api/status` feed, static
  asset serving, `parseListenAddress`; unit-tested.
- [src/__tests__/server.test.ts](src/__tests__/server.test.ts) / [src/__tests__/server.assets.test.ts](src/__tests__/server.assets.test.ts) — vitest tests for the HTTP layer.
- [src/metrics.ts](src/metrics.ts) — `buildMetrics` (prom-client gauge definitions), built fresh per scrape.
- [src/log.ts](src/log.ts) — exports a single `createLogger(level, format)` factory returning a winston logger with selectable output (`text` → `LEVEL: message`, `json` → one JSON object per line). CR/LF stripping (log-injection guard) is applied internally as a winston format, so callers never sanitize manually.
- [src/buildinfo.ts](src/buildinfo.ts) — build metadata (version/commit/build time).
- [src/__tests__/pbs.fixtures.ts](src/__tests__/pbs.fixtures.ts) — mock PBS API responses + test helpers (`makeFetchMock`, `metricValue`).
- [src/config.ts](src/config.ts) — config loading (flags + env), pure and unit-tested.
- [src/__tests__/config.test.ts](src/__tests__/config.test.ts) — vitest unit tests for the config module.
- [src/status.ts](src/status.ts) — in-memory per-target scrape-status store powering the UI; unit-tested.
- [src/__tests__/status.test.ts](src/__tests__/status.test.ts) — vitest unit tests for the status store.
- [src/web/](src/web) — status UI sources: `index.html` shell + `app.js` (Vue 3 + Vuetify 3).
- [scripts/build-fe.mjs](scripts/build-fe.mjs) — `npm run build:fe`: assembles the status UI
  (app shell + Vue/Vuetify browser builds) into `public/`. Server serves `public/` and fails
  fast at startup if it is missing. `public/` is git-ignored; run `build:fe` locally before `npm start`.

## Commands

```bash
npm install                  # install dependencies
npm start                    # run the exporter (node --env-file=.env src/run.ts)
npm run dev                  # run with --watch for local development
npm run lint:ts              # type-check only (tsc --noEmit) — must exit 0
npm run lint:eslint          # lint all .ts files + src/web/app.js with ESLint 10 — must exit 0
npm run lint:prettier        # check formatting of all .ts files — must exit 0
npm run format               # auto-fix formatting with Prettier (--write)
npm run tests:unit           # run vitest unit tests
npm run tests:unit:coverage  # run tests + write coverage/ reports (html, cobertura xml, lcov)
npm run build:fe             # assemble the status-UI frontend into public/ (required before `npm start`)
npm run build                # emit JS to dist/ (tsc)
```

Always run unit tests via these npm scripts (`npm run tests:unit`, or
`npm run tests:unit:coverage` for coverage) — never invoke `npx vitest`/`vitest`
directly, as that bypasses the configured flags and coverage reporters.

Coverage reports land in `coverage/`:
- `index.html` — human-browsable report
- `cobertura-coverage.xml` — generic XML for GitHub coverage actions
- `lcov.info` — for SonarQube (`sonar.javascript.lcov.reportPaths=coverage/lcov.info`)

## TypeScript conventions

- **Relative imports use the `.ts` extension** (e.g. `import { loadConfig } from "./config.ts"`).
  This is required by Node's native TypeScript execution. `tsconfig.json` enables
  `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`, so `tsc` type-checks
  these and rewrites them to `.js` on `npm run build`.
- Avoid constructs the type stripper can't handle (TS `enum`, `namespace`, parameter
  properties). Use plain types/interfaces and union literals.
- After any change, `npm run lint:ts`, `npm run lint:eslint`, `npm run lint:prettier`,
  and `npm run tests:unit` must all pass. ESLint uses a flat config
  ([eslint.config.mjs](eslint.config.mjs), v10) with `typescript-eslint`; Prettier
  formatting is enforced in CI — run `npm run format` to fix style locally.

## Configuration

Flags and environment variables; precedence is default → flag → env. CLI flags are
declared and parsed with commander in [src/run.ts](src/run.ts) (the `program` singleton);
[src/config.ts](src/config.ts) stays pure — `loadConfig(opts, env)` maps the already-parsed
options plus the environment into a `Config`. See `loadConfig`/`CliOptions` and the
`REQ-CFG-*` requirements in [SPEC.md](SPEC.md) for the authoritative list. Secret values can
be supplied via `*_FILE` env vars (first line of the file is read).

## Security — log injection

User-controlled values (e.g. the resolved `target` endpoint, external error text) must be
stripped of CR/LF before being logged, to prevent log-injection. This is handled centrally
in [src/log.ts](src/log.ts): every logger from `createLogger` runs a winston format step
that `replaceAll`s `\n`/`\r` on the message, so call sites log values directly without a
per-call sanitize helper.

## Security — SSRF (target validation)

The endpoint/`?target=` URL is attacker-influenceable, so it is validated with
`validateUrl()` in [src/config.ts](src/config.ts) before any HTTP request: it must be a
parseable absolute URL with an `http:`/`https:` scheme (rejects `file:`, `gopher:`,
etc.), and it returns a parsed `URL` object. A configured `endpoint` is validated at load
(fatal on failure); a `?target=` is validated per-request in [src/server.ts](src/server.ts)
(HTTP 400 on failure, no scrape). As a defence-in-depth measure at the network boundary,
[src/exporter.ts](src/exporter.ts) re-validates the fully-resolved request URL with
`validateUrl()` immediately before each `fetch` and passes it the resulting `URL` object
(not a raw string). See `REQ-SEC-4` in [SPEC.md](SPEC.md).

## Legacy Go code (pending removal)

The repository still contains the original Go implementation and its tooling — `main.go`,
`go.mod`/`go.sum`, the `Makefile`, and the Go-oriented GitHub workflows / pre-commit hooks.
These are **superseded by the TypeScript app** and kept only until a later cleanup. Do not
treat them as the current source of truth; the Node/TypeScript code above is authoritative.
