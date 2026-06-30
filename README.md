# Proxmox Backup Server Exporter

[![license](https://img.shields.io/github/license/simonjur/pbs-exporter-node)](https://github.com/simonjur/pbs-exporter-node/blob/main/LICENSE)
[![Built with Claude AI](https://img.shields.io/badge/Built%20with-Claude%20AI-D97757)](https://claude.ai/)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=simonjur_pbs-exporter&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=simonjur_pbs-exporter)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=simonjur_pbs-exporter&metric=bugs)](https://sonarcloud.io/summary/new_code?id=simonjur_pbs-exporter)
[![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=simonjur_pbs-exporter&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=simonjur_pbs-exporter)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=simonjur_pbs-exporter&metric=coverage)](https://sonarcloud.io/summary/new_code?id=simonjur_pbs-exporter)
[![Duplicated Lines (%)](https://sonarcloud.io/api/project_badges/measure?project=simonjur_pbs-exporter&metric=duplicated_lines_density)](https://sonarcloud.io/summary/new_code?id=simonjur_pbs-exporter)
[![Lines of Code](https://sonarcloud.io/api/project_badges/measure?project=simonjur_pbs-exporter&metric=ncloc)](https://sonarcloud.io/summary/new_code?id=simonjur_pbs-exporter)
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=simonjur_pbs-exporter&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=simonjur_pbs-exporter)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=simonjur_pbs-exporter&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=simonjur_pbs-exporter)
[![Technical Debt](https://sonarcloud.io/api/project_badges/measure?project=simonjur_pbs-exporter&metric=sqale_index)](https://sonarcloud.io/summary/new_code?id=simonjur_pbs-exporter)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=simonjur_pbs-exporter&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=simonjur_pbs-exporter)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=simonjur_pbs-exporter&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=simonjur_pbs-exporter)
[![CodeQL](https://github.com/simonjur/pbs-exporter-node/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/simonjur/pbs-exporter-node/actions/workflows/github-code-scanning/codeql)

---

> 🤖 This project was created with [Claude](https://claude.ai/) (Claude Code).

Export [Proxmox Backup Server](https://www.proxmox.com/en/proxmox-backup-server/overview) statistics to [Prometheus](https://prometheus.io/).

Metrics are retrieved using the [Proxmox Backup Server API](https://pbs.proxmox.com/docs/api-viewer/index.html).

> **Note:** This is a **Node.js (>= 24) / TypeScript** application — a rewrite of the
> original Go exporter. It runs directly from TypeScript via Node's native type
> stripping, so there is **no compile step** for the exporter itself. A small status
> dashboard is served at `/` (the Prometheus metrics stay on the configured metrics
> path); its assets are built into `public/` with `npm run build:fe`.

## Running

### With Docker (recommended)

Multi-arch images (`linux/amd64`, `linux/arm64`) are published to the GitHub Container
Registry:

```bash
docker run -p 10019:10019 \
  -e PBS_ENDPOINT=https://your-pbs:8007 \
  -e PBS_API_TOKEN=your-token \
  ghcr.io/simonjur/pbs-exporter-node:alpha
```

Or use [docker-compose.example.yaml](docker-compose.example.yaml) as a starting point.

### From source

Requires **Node.js >= 24**.

```bash
npm ci                 # install dependencies
npm run build:fe       # build the status-UI assets into public/ (required before start)
npm start              # run with .env  (node --env-file=.env src/run.ts)

# …or run directly, passing flags/env yourself:
node src/run.ts --pbs.endpoint https://your-pbs:8007
```

Run `node src/run.ts --help` to see all flags, or `node src/run.ts --version` to print
the build version and exit.

## Exported Metrics

| Metric                                      | Meaning                                                               | Labels                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| pbs_up                                      | Was the last query of Proxmox Backup Server successful?               |                                                                              |
| pbs_version                                 | Version of Proxmox Backup Server                                      | `version`, `repoid`, `release`                                               |
| pbs_available                               | The available bytes of the underlying storage.                        | `datastore`                                                                  |
| pbs_size                                    | The size of the underlying storage in bytes.                          | `datastore`                                                                  |
| pbs_used                                    | The used bytes of the underlying storage.                             | `datastore`                                                                  |
| pbs_snapshot_count                          | The total number of backups.                                          | `datastore`, `namespace`                                                     |
| pbs_snapshot_vm_count                       | The total number of backups per VM.                                   | `datastore`, `namespace`, `vm_id`, `vm_name`                                 |
| pbs_snapshot_vm_last_timestamp              | The timestamp of the last backup of a VM.                             | `datastore`, `namespace`, `vm_id`, `vm_name`                                 |
| pbs_snapshot_vm_last_verify                 | The verify status of the last backup of a VM.                         | `datastore`, `namespace`, `vm_id`, `vm_name`                                 |
| pbs_host_subscription_due_timestamp_seconds | The subscription due timestamp of the host in seconds.                | `productname`                                                                |
| pbs_host_subscription_info                  | The subscription info of the host.                                    | `productname`, `status`                                                      |
| pbs_host_subscription_status                | Indicates if the subscription is in the state indicated by the label. | `status` = (`active`\|`expired`\|`invalid`\|`new`\|`notfound`\|`superseded`) |
| pbs_host_cpu_usage                          | The CPU usage of the host.                                            |                                                                              |
| pbs_host_memory_free                        | The free memory of the host.                                          |                                                                              |
| pbs_host_memory_total                       | The total memory of the host.                                         |                                                                              |
| pbs_host_memory_used                        | The used memory of the host.                                          |                                                                              |
| pbs_host_swap_free                          | The free swap of the host.                                            |                                                                              |
| pbs_host_swap_total                         | The total swap of the host.                                           |                                                                              |
| pbs_host_swap_used                          | The used swap of the host.                                            |                                                                              |
| pbs_host_disk_available                     | The available disk of the local root disk in bytes.                   |                                                                              |
| pbs_host_disk_total                         | The total disk of the local root disk in bytes.                       |                                                                              |
| pbs_host_disk_used                          | The used disk of the local root disk in bytes.                        |                                                                              |
| pbs_host_uptime                             | The uptime of the host.                                               |                                                                              |
| pbs_host_io_wait                            | The io wait of the host.                                              |                                                                              |
| pbs_host_load1                              | The load for 1 minute of the host.                                    |                                                                              |
| pbs_host_load5                              | The load for 5 minutes of the host.                                   |                                                                              |
| pbs_host_load15                             | The load 15 minutes of the host.                                      |                                                                              |

## Flags / Environment Variables

```bash
$ node src/run.ts --help
```

You can use the following flags to configure the exporter. All flags can also be set using environment variables. Environment variables take precedence over flags.

| Flag                 | Environment Variable | Description                                          | Default                                                |
| -------------------- | -------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| `pbs.loglevel`       | `PBS_LOGLEVEL`       | Log level (`debug`, `info`, …)                       | `info`                                                 |
| `pbs.logformat`      | `PBS_LOGFORMAT`      | Log output format (`text`, `json`)                   | `text`                                                 |
| `pbs.api.token`      | `PBS_API_TOKEN`      | API token to use for authentication                  |                                                        |
| `pbs.api.token.name` | `PBS_API_TOKEN_NAME` | Name of the API token to use for authentication      | `pbs-exporter`                                         |
| `pbs.endpoint`       | `PBS_ENDPOINT`       | Address of the Proxmox Backup Server                 | `http://localhost:8007` (if no parameter `target` set) |
| `pbs.username`       | `PBS_USERNAME`       | Username to use for authentication                   | `root@pam`                                             |
| `pbs.timeout`        | `PBS_TIMEOUT`        | Timeout for requests to Proxmox Backup Server        | `5s`                                                   |
| `pbs.insecure`       | `PBS_INSECURE`       | Disable TLS certificate verification                 | `false`                                                |
| `pbs.metrics-path`   | `PBS_METRICS_PATH`   | Path under which to expose metrics                   | `/metrics`                                             |
| `pbs.listen-address` | `PBS_LISTEN_ADDRESS` | Address to listen on for web interface and telemetry | `:10019`                                               |

### Running on PBS (systemd)

The exporter can also be installed directly on a Proxmox Backup Server instead of
spawning an additional Docker container. As there is no compiled binary, this runs the
TypeScript source with Node.js (>= 24) — install Node on the host first
(e.g. via [nodesource](https://github.com/nodesource/distributions)).

```bash
# Fetch the source into /opt/pbs-exporter
git clone https://github.com/simonjur/pbs-exporter-node.git /opt/pbs-exporter
cd /opt/pbs-exporter
npm ci --omit=dev        # runtime dependencies only
npm run build:fe         # build the status-UI assets into public/

# Create a dedicated user for running the exporter
useradd -m pbs-exporter -s /sbin/nologin

# Install the systemd unit (see ./systemd/prometheus-pbs-exporter.service)
cp systemd/prometheus-pbs-exporter.service /etc/systemd/system/
systemctl daemon-reload

# Create the environment file (minimum: the API token)
vi /etc/pbs-exporter.env
# Add the token content and other options if required:
PBS_ENDPOINT=https://localhost:8007
PBS_API_TOKEN=beef-1337-cafe-beef-cafe-1337
PBS_INSECURE=true

# Enable and start the service
systemctl enable prometheus-pbs-exporter.service
systemctl start prometheus-pbs-exporter.service
```

The unit runs `node /opt/pbs-exporter/src/run.ts`; configure the exporter through
`/etc/pbs-exporter.env` using the environment variables from the table above.

### Docker secrets

If you are using [Docker secrets](https://docs.docker.com/engine/swarm/secrets/), you can use the following environment variables to set the path to the secrets:

| Environment Variable      | Description                     |
| ------------------------- | ------------------------------- |
| `PBS_API_TOKEN_FILE`      | Path to the API token file      |
| `PBS_API_TOKEN_NAME_FILE` | Path to the API token name file |
| `PBS_USERNAME_FILE`       | Path to the username file       |

Each `*_FILE` variable points at a file whose **first line** is read as the value. The
direct variables `PBS_API_TOKEN`, `PBS_API_TOKEN_NAME`, and `PBS_USERNAME` take
precedence over their `*_FILE` counterparts.

## Multiple Proxmox Backup Servers

If you want to monitor multiple Proxmox Backup Servers, you can use the `targets` parameter in the query string. Instead of setting the `pbs.endpoint` flag (or `PBS_ENDPOINT` env), you can use the `target` parameter in the query string to specify the Proxmox Backup Server to monitor. You would then use following URL to scrape metrics: `http://localhost:10019/metrics?target=http://10.10.10.10:8007`.

This is useful if you are using Prometheus and want to monitor multiple Proxmox Backup Servers with one "pbs-exporter" instance.
You find examples for Prometheus static configuration in the [prometheus/static-config](prometheus/static-config) directory.

:warning: **Important**: if `pbs.endpoint` or `PBS_ENDPOINT` is set, the `target` parameter is ignored.

## Node metrics

According to the [api documentation](https://pbs.proxmox.com/docs/api-viewer/index.html#/nodes/{node}), we have to provide a node name (won't work with the node ip), but it seems to work with any name, so we just use "localhost" for the request. This setup is tested with one proxmox backup server host.

## Supported versions

This exporter has been developed and tested against Proxmox Backup Server **4.x** (the
mocked API responses in the test suite are derived from a PBS 4.2 instance; see
[Proxmox Backup Server Roadmap](https://pbs.proxmox.com/wiki/index.php/Roadmap)). If you
have tested it with another version, or have encountered problems, please let us know.

## Release

The exporter is distributed as a multi-arch container image (`linux/amd64`,
`linux/arm64`) published to the GitHub Container Registry at
`ghcr.io/simonjur/pbs-exporter-node`. The [release workflow](.github/workflows/release.yml)
builds and pushes:

- `:alpha` — on every push to `main`
- `:v<version>` — on every `v*` git tag (e.g. `:v1.2.3`)

Build metadata (version, commit, build time) is injected at image-build time and surfaced
by `--version`.

# TODO

AI verification:
"Verify the app against SPEC.md and report PASS/FAIL/SKIP per requirement ID."
