# PBS Exporter — Specification

> **Spec-driven development.** This document is the source of truth for what the
> exporter must do. The implementation in [`src/main.ts`](src/main.ts) is verified
> *against* this spec, not the other way around. Each requirement has a stable ID
> and a verification method an agent (or human) can execute. When behavior changes,
> update this spec **first**, then the code, then re-verify.

## How to verify

An agent verifies a requirement by executing its **Verify** step and confirming the
observable outcome. Where a live Proxmox Backup Server is unavailable, requirements
are marked **[offline-ok]** (verifiable without a real PBS) or **[needs-pbs]**
(requires a reachable PBS or a stub returning the documented JSON).

Build/run baseline:

```bash
npm install
npm run lint:ts          # MUST exit 0
PBS_LISTEN_ADDRESS=":19099" node src/main.ts
```

Produce a report mapping every `REQ-*` ID to PASS / FAIL / SKIP with the evidence
(command output) for each.

---

## 1. Purpose

The exporter exposes Proxmox Backup Server (PBS) metrics in Prometheus text format
over HTTP. It is a faithful TypeScript/Node.js port of the original Go exporter and
MUST preserve metric names, labels, and help strings.

---

## 2. Runtime & build

| ID | Requirement | Verify |
|----|-------------|--------|
| REQ-RT-1 | Runs on Node.js >= 24 directly from TypeScript (native type stripping); no separate build step required to run. | `node src/main.ts --version` prints a version line and exits 0. **[offline-ok]** |
| REQ-RT-2 | Type-checks cleanly. | `npm run lint:ts` exits 0. **[offline-ok]** |
| REQ-RT-3 | Runtime dependencies are limited to `prom-client`, `undici`, `commander`, and `parse-duration`. | Inspect `package.json` `dependencies`. **[offline-ok]** |
| REQ-RT-4 | Config-loading logic lives in [`src/config.ts`](src/config.ts) (separate from `main.ts`) and is covered by vitest unit tests run via `npm run tests:unit`. | `npm run tests:unit` exits 0 with all tests passing. **[offline-ok]** |
| REQ-RT-5 | `npm run tests:unit:coverage` generates coverage reports under `coverage/`: HTML (`index.html`), Cobertura XML (`cobertura-coverage.xml`, for GitHub) and LCOV (`lcov.info`, for SonarQube via `sonar.javascript.lcov.reportPaths`). | Run it; assert the three artifacts exist. **[offline-ok]** |
| REQ-RT-6 | All `.ts` files lint cleanly under ESLint 10 (flat config in [`eslint.config.mjs`](eslint.config.mjs), using `@eslint/js` + `typescript-eslint` recommended rules). | `npm run lint:eslint` exits 0. **[offline-ok]** |
| REQ-RT-7 | All `.ts` files conform to Prettier formatting. | `npm run lint:prettier` exits 0 (`npm run format` auto-fixes). **[offline-ok]** |

---

## 3. Configuration

Precedence (lowest → highest): built-in default → CLI flag → environment variable.

| ID | Requirement | Verify |
|----|-------------|--------|
| REQ-CFG-1 | Flags are parsed with [commander](https://github.com/tj/commander.js). Supports `--pbs.endpoint`, `--pbs.username`, `--pbs.api.token`, `--pbs.api.token.name`, `--pbs.timeout`, `--pbs.insecure`, `--pbs.metrics-path`, `--pbs.listen-address`, `--pbs.loglevel`, `--version`, in both `--key=value` and `--key value` forms. Unknown flags are rejected with a usage error (commander default). | Start with `--pbs.listen-address=:19099` and `--pbs.metrics-path /m`; confirm metrics served at `/m`. **[offline-ok]** |
| REQ-CFG-1a | Commander auto-generates `--help` listing every option with its default. | `node src/main.ts --help` lists all `--pbs.*` options. **[offline-ok]** |
| REQ-CFG-2 | Environment variables `PBS_ENDPOINT`, `PBS_USERNAME`, `PBS_API_TOKEN`, `PBS_API_TOKEN_NAME`, `PBS_TIMEOUT`, `PBS_INSECURE`, `PBS_METRICS_PATH`, `PBS_LISTEN_ADDRESS`, `PBS_LOGLEVEL` override flags/defaults. | Set `PBS_METRICS_PATH=/x` while passing `--pbs.metrics-path=/y`; metrics MUST be at `/x`. **[offline-ok]** |
| REQ-CFG-3 | Defaults: username `root@pam`, api token name `pbs-exporter`, timeout `5s`, insecure `false`, metrics path `/metrics`, listen address `:10019`, loglevel `info`. | Start with no config; logs report listen `:10019`, path `/metrics`. **[offline-ok]** |
| REQ-CFG-4 | `PBS_USERNAME_FILE`, `PBS_API_TOKEN_FILE`, `PBS_API_TOKEN_NAME_FILE` read the **first line** of the named file (used only when the non-`_FILE` var is unset). | Point `PBS_API_TOKEN_FILE` at a 2-line file; with debug loglevel the logged token equals line 1 only. **[offline-ok]** |
| REQ-CFG-5 | `--version` prints `PBS Exporter Version: <v>, Commit: <c>, Build Time: <t>` and exits 0 without starting the server. | `node src/main.ts --version`. **[offline-ok]** |
| REQ-CFG-6 | Invalid `pbs.insecure` (non-boolean) or `pbs.timeout` (non-duration) causes a fatal error log and non-zero exit. | `PBS_INSECURE=maybe node src/main.ts` exits non-zero with an `ERROR:` line. **[offline-ok]** |
| REQ-CFG-7 | Timeout accepts duration strings parsed by [`parse-duration`](https://github.com/jkroso/parse-duration): single or compound units (`5s`, `500ms`, `1m30s`, `1h`, `1h 20m`); a unit-less number is interpreted as milliseconds (`10` → 10ms). | `PBS_TIMEOUT=1m30s` starts successfully. **[offline-ok]** |

---

## 4. HTTP server

| ID | Requirement | Verify |
|----|-------------|--------|
| REQ-HTTP-1 | Listens on the configured address/port; `:PORT` binds all interfaces. | `curl -s http://localhost:19099/` returns 200. **[offline-ok]** |
| REQ-HTTP-2 | `GET /` returns an HTML landing page with a link to the metrics path. | Response body contains `Proxmox Backup Server Exporter` and `href='/metrics'`. **[offline-ok]** |
| REQ-HTTP-3 | `GET <metrics-path>` returns Prometheus text format with `Content-Type` from prom-client. | `curl -sI http://localhost:19099/metrics` shows `text/plain; version=0.0.4`. **[offline-ok]** |
| REQ-HTTP-4 | Unknown paths return HTTP 404. | `curl -s -o /dev/null -w '%{http_code}' http://localhost:19099/nope` → `404`. **[offline-ok]** |
| REQ-HTTP-5 | Target resolution: if `endpoint` is configured it is always used; otherwise the `?target=` query param is used; otherwise default `http://localhost:8007`. | With no endpoint set, `GET /metrics?target=http://localhost:1` attempts that target (debug log shows it). **[offline-ok]** |

---

## 5. Scrape lifecycle

| ID | Requirement | Verify |
|----|-------------|--------|
| REQ-SCRAPE-1 | PBS metrics are built on a **fresh registry per scrape**, so labels that disappear between scrapes are not retained as stale series. | Two scrapes against different targets do not accumulate each other's datastore label series. **[needs-pbs]** |
| REQ-SCRAPE-2 | On a fully successful collection, `pbs_up` = 1. | `GET /metrics` against a working PBS → `pbs_up 1`. **[needs-pbs]** |
| REQ-SCRAPE-3 | On any collection error (network, non-200, parse), `pbs_up` = 0 and the error is logged; the endpoint still returns 200 with whatever metrics were gathered. | `GET /metrics?target=http://localhost:1` → `pbs_up 0`, HTTP 200. **[offline-ok]** |
| REQ-SCRAPE-4 | Requests carry header `Authorization: PBSAPIToken=<username>!<tokenname>:<token>`. | Inspect request against a stub server. **[needs-pbs]** |
| REQ-SCRAPE-5 | Each PBS HTTP request is bounded by the configured timeout. | With an unresponsive target and `PBS_TIMEOUT=1s`, scrape fails within ~1s and sets `pbs_up 0`. **[offline-ok]** |

---

## 6. PBS API calls

All paths are relative to the resolved endpoint.

| ID | Call | Purpose |
|----|------|---------|
| REQ-API-1 | `GET /api2/json/version` | version metric |
| REQ-API-2 | `GET /api2/json/status/datastore-usage` | per-datastore usage |
| REQ-API-3 | `GET /api2/json/admin/datastore/<store>/namespace` | namespaces of a datastore |
| REQ-API-4 | `GET /api2/json/admin/datastore/<store>/snapshots?ns=<ns>` | snapshots in a namespace |
| REQ-API-5 | `GET /api2/json/nodes/localhost/status` | host metrics |
| REQ-API-6 | `GET /api2/json/nodes/localhost/subscription` | subscription metrics |

**Verify [needs-pbs]:** capture requests against a stub and confirm the exact path set above is requested.

---

## 7. Metrics

All metric names are prefixed `pbs_`. Type is gauge unless noted.

| ID | Metric | Labels | Help |
|----|--------|--------|------|
| REQ-M-1 | `pbs_up` | — | Was the last query of PBS successful. |
| REQ-M-2 | `pbs_version` | version, repoid, release | Version of the PBS installation. (value 1) |
| REQ-M-3 | `pbs_available` | datastore | Available bytes of the underlying storage. |
| REQ-M-4 | `pbs_size` | datastore | Size of the underlying storage in bytes. |
| REQ-M-5 | `pbs_used` | datastore | Used bytes of the underlying storage. |
| REQ-M-6 | `pbs_snapshot_count` | datastore, namespace | Total number of backups. |
| REQ-M-7 | `pbs_snapshot_vm_count` | datastore, namespace, vm_id, vm_name | Total number of backups per VM. |
| REQ-M-8 | `pbs_snapshot_vm_last_timestamp` | datastore, namespace, vm_id, vm_name | Timestamp of the last backup of a VM. |
| REQ-M-9 | `pbs_snapshot_vm_last_age` | datastore, namespace, vm_id, vm_name | Age in seconds of the last backup of a VM (now - `pbs_snapshot_vm_last_timestamp`). |
| REQ-M-10 | `pbs_snapshot_vm_last_verify` | datastore, namespace, vm_id, vm_name | Verify status of the last backup of a VM (1 if `ok`, else 0). |
| REQ-M-11 | `pbs_host_subscription_status` | status | Subscription status of the host (1 for the active status string, 0 for the rest). |
| REQ-M-12 | `pbs_host_subscription_info` | productname, status | Subscription info of the host. (value 1) |
| REQ-M-13 | `pbs_host_subscription_due_timestamp_seconds` | productname | Subscription next due timestamp (unix seconds). |
| REQ-M-14 | `pbs_host_cpu_usage` | — | CPU usage of the host. |
| REQ-M-15 | `pbs_host_memory_free` / `_total` / `_used` | — | Host memory. |
| REQ-M-16 | `pbs_host_swap_free` / `_total` / `_used` | — | Host swap. |
| REQ-M-17 | `pbs_host_disk_available` / `_total` / `_used` | — | Local root disk bytes. |
| REQ-M-18 | `pbs_host_uptime` | — | Uptime of the host. |
| REQ-M-19 | `pbs_host_io_wait` | — | IO wait of the host. |
| REQ-M-20 | `pbs_host_load1` / `load5` / `load15` | — | Host load averages (loadavg[0/1/2]). |

**Verify [offline-ok]:** every `# HELP pbs_<name>` and `# TYPE` line is present in `/metrics`
output (names/labels/help match this table exactly) even when `pbs_up 0`, because the
gauges are declared per scrape. **[needs-pbs]** for populated values.

---

## 8. Behavioral rules

| ID | Requirement | Verify |
|----|-------------|--------|
| REQ-B-1 | `pbs_snapshot_vm_last_verify` is 1 only when the most recent snapshot's `verification.state` == `ok`, else 0. The "most recent" snapshot is the one with the greatest `backup-time` for that `backup-id`. | Stub two snapshots for one vm_id; the later one's state drives the value. **[needs-pbs]** |
| REQ-B-2 | `vm_name` label is taken from the snapshot `comment` field (empty string if absent). | Stub a snapshot with `comment`; label matches. **[needs-pbs]** |
| REQ-B-3 | When `GET .../namespace` returns HTTP 400 with a body matching `/datastore is being deleted/i`, that datastore is skipped (logged at INFO) without failing the whole scrape. | Stub a 400 with that body; scrape still ends with `pbs_up 1`. **[needs-pbs]** |
| REQ-B-4 | Subscription `nextduedate` (format `YYYY-MM-DD`, interpreted as UTC midnight) becomes `pbs_host_subscription_due_timestamp_seconds`; absent/invalid → 0. | Stub `nextduedate: "2026-01-01"` → metric == `1767225600`. **[needs-pbs]** |
| REQ-B-5 | `pbs_host_subscription_status` is emitted for each of: `new`, `notfound`, `active`, `invalid`, `expired`, `suspended`, with value 1 for the matching status and 0 otherwise. | Stub `status: active`; only `{status="active"}` == 1. **[needs-pbs]** |
| REQ-B-6 | `pbs_snapshot_vm_last_age` equals the current unix time (whole seconds) minus `pbs_snapshot_vm_last_timestamp` for the same labels, computed at scrape time. | For any vm series, `pbs_snapshot_vm_last_age` ≈ `now - pbs_snapshot_vm_last_timestamp` (±1s). **[needs-pbs]** |

---

## 9. TLS & security

| ID | Requirement | Verify |
|----|-------------|--------|
| REQ-SEC-1 | TLS minimum version is 1.2. | Code review of the undici `Agent` config. **[offline-ok]** |
| REQ-SEC-2 | When `insecure` is true, server certificate verification is disabled (per-client, not process-global). | With a self-signed PBS and `PBS_INSECURE=true`, scrape succeeds. **[needs-pbs]** |
| REQ-SEC-3 | User-controlled values (e.g. the resolved target) are stripped of CR/LF before being logged, preventing log injection. | `?target=` containing `%0a` does not produce a multi-line debug log. **[offline-ok]** |

---

## 10. Node.js runtime metrics

| ID | Requirement | Verify |
|----|-------------|--------|
| REQ-NODE-1 | Default Node.js process/runtime metrics (`process_*`, `nodejs_*`) are exposed alongside the PBS metrics. | `/metrics` output contains `process_cpu_seconds_total` and `nodejs_eventloop_lag_seconds`. **[offline-ok]** |
| REQ-NODE-2 | Default metrics are collected on a persistent registry (registered once at startup), not rebuilt per scrape. | Two consecutive scrapes both show `process_start_time_seconds` with the same value. **[offline-ok]** |

---

## 11. Container image & release

The exporter ships as a container image published to the GitHub Container Registry
under `ghcr.io/simonjur/pbs-exporter-node`.

| ID | Requirement | Verify |
|----|-------------|--------|
| REQ-IMG-1 | A [`Dockerfile`](Dockerfile) builds a Node.js 24 image that runs the exporter straight from TypeScript (no compile step); the runtime stage installs production dependencies only (`npm ci --omit=dev`) and copies `src/`. | `docker build -t pbs-exporter-node .` succeeds. **[offline-ok]** |
| REQ-IMG-2 | The image runs as the unprivileged `nobody` user (UID `65534`) and exposes port `10019`. | `Dockerfile` declares `USER 65534` and `EXPOSE 10019`; `docker run --rm pbs-exporter-node --version` prints the version line. **[offline-ok]** |
| REQ-IMG-3 | Build metadata (`PBS_BUILD_VERSION`, `PBS_BUILD_COMMIT`, `PBS_BUILD_TIME`) is injectable at build time via `--build-arg` and surfaced as env at runtime (consumed by `--version`). | `docker build --build-arg PBS_BUILD_VERSION=vX.Y.Z .` then `docker run` with `--version` reflects `vX.Y.Z`. **[offline-ok]** |
| REQ-IMG-4 | Published images are multi-arch, built and pushed as a single manifest list for `linux/amd64` and `linux/arm64`. | The release workflow's build step sets `platforms: linux/amd64,linux/arm64`; `docker buildx imagetools inspect ghcr.io/simonjur/pbs-exporter-node:alpha` lists both platforms. **[offline-ok]** |
| REQ-REL-1 | The [release workflow](.github/workflows/release.yml) builds and pushes `ghcr.io/simonjur/pbs-exporter-node` on every push to `main` and on every `v*` tag. | Inspect `on.push.branches` (`main`) and `on.push.tags` (`v*`). **[offline-ok]** |
| REQ-REL-2 | A push to `main` publishes the `:alpha` tag. | Inspect the `docker/metadata-action` `tags` rule (`type=raw,value=alpha` enabled on `refs/heads/main`). **[offline-ok]** |
| REQ-REL-3 | A push of a `v*` tag publishes a `:v<version>` tag equal to the git tag name (e.g. `v1.2.3`). | Inspect the `docker/metadata-action` `tags` rule (`type=ref,event=tag`). **[offline-ok]** |
| REQ-REL-4 | [`docker-compose.yaml`](docker-compose.yaml) references the published image `ghcr.io/simonjur/pbs-exporter-node:alpha`. | Inspect the compose `image:` field. **[offline-ok]** |
