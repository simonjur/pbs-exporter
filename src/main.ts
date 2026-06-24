/**
 * PBS Exporter — Proxmox Backup Server metrics for Prometheus.
 *
 * TypeScript/Node.js 24+ rewrite of the original Go exporter.
 * Uses the native `fetch`/`undici` HTTP stack and the `prom-client` library.
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Agent } from "undici";
import { Registry, Gauge, collectDefaultMetrics } from "prom-client";
import { type Config, loadConfig, parseDuration, parseBool } from "./config.ts";

const PROM_NAMESPACE = "pbs";
const VERSION_API = "/api2/json/version";
const DATASTORE_USAGE_API = "/api2/json/status/datastore-usage";
const DATASTORE_API = "/api2/json/admin/datastore";
const NODE_API = "/api2/json/nodes";

// These variables are set in the build step (overridable via env at runtime).
const Version = process.env.PBS_BUILD_VERSION ?? "v0.0.0-dev.0";
const Commit = process.env.PBS_BUILD_COMMIT ?? "none";
const BuildTime = process.env.PBS_BUILD_TIME ?? "unknown";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip CR/LF to prevent log injection from user-controlled values. */
function sanitize(value: string): string {
  return value.replaceAll("\n", "").replaceAll("\r", "");
}

const log = {
  info: (msg: string) => console.log(`INFO: ${msg}`),
  error: (msg: string) => console.error(`ERROR: ${msg}`),
  debug: (msg: string) => {
    if (loglevel === "debug") console.log(`DEBUG: ${msg}`);
  },
};

// Resolved at startup; used by the log helper and request layer.
let loglevel = "info";
let timeoutMs = 5000;
let dispatcher: Agent | undefined;

// Persistent registry for Node.js process/runtime metrics (process_*, nodejs_*).
// Collected once at startup — NOT rebuilt per scrape, unlike the PBS metrics.
const defaultRegistry = new Registry();

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

type VersionResponse = {
  data: { release: string; repoid: string; version: string };
};

type DatastoreEntry = {
  avail: number;
  store: string;
  total: number;
  used: number;
  ns?: string;
};

type DatastoreResponse = { data: DatastoreEntry[] };

type NamespaceResponse = { data: { ns: string }[] };

type SnapshotEntry = {
  "backup-id": string;
  "backup-time": number;
  comment?: string;
  verification?: { state?: string };
};

type SnapshotResponse = { data: SnapshotEntry[] };

type HostResponse = {
  data: {
    cpu: number;
    memory: { free: number; total: number; used: number };
    swap: { free: number; total: number; used: number };
    root: { avail: number; total: number; used: number };
    loadavg: number[];
    uptime: number;
    wait: number;
  };
};

// ---------------------------------------------------------------------------
// Metrics — built fresh per scrape so stale label series are not retained.
// ---------------------------------------------------------------------------

function buildMetrics(registry: Registry) {
  const g = (name: string, help: string, labelNames: string[] = []) =>
    new Gauge({
      name: `${PROM_NAMESPACE}_${name}`,
      help,
      labelNames,
      registers: [registry],
    });

  return {
    up: g("up", "Was the last query of PBS successful."),
    version: g("version", "Version of the PBS installation.", [
      "version",
      "repoid",
      "release",
    ]),
    available: g(
      "available",
      "The available bytes of the underlying storage.",
      ["datastore"],
    ),
    size: g("size", "The size of the underlying storage in bytes.", [
      "datastore",
    ]),
    used: g("used", "The used bytes of the underlying storage.", ["datastore"]),
    snapshotCount: g("snapshot_count", "The total number of backups.", [
      "datastore",
      "namespace",
    ]),
    snapshotVmCount: g(
      "snapshot_vm_count",
      "The total number of backups per VM.",
      ["datastore", "namespace", "vm_id", "vm_name"],
    ),
    snapshotVmLastTimestamp: g(
      "snapshot_vm_last_timestamp",
      "The timestamp of the last backup of a VM.",
      ["datastore", "namespace", "vm_id", "vm_name"],
    ),
    snapshotVmLastAge: g(
      "snapshot_vm_last_age",
      "The age in seconds of the last backup of a VM (now - last timestamp).",
      ["datastore", "namespace", "vm_id", "vm_name"],
    ),
    snapshotVmLastVerify: g(
      "snapshot_vm_last_verify",
      "The verify status of the last backup of a VM.",
      ["datastore", "namespace", "vm_id", "vm_name"],
    ),
    subscriptionStatus: g(
      "host_subscription_status",
      "The subscription status of the host.",
      ["status"],
    ),
    subscriptionInfo: g(
      "host_subscription_info",
      "The subscription info of the host.",
      ["productname", "status"],
    ),
    subscriptionDueTimestamp: g(
      "host_subscription_due_timestamp_seconds",
      "The subscription next due timestamp (unix seconds) of the host.",
      ["productname"],
    ),
    hostCpuUsage: g("host_cpu_usage", "The CPU usage of the host."),
    hostMemoryFree: g("host_memory_free", "The free memory of the host."),
    hostMemoryTotal: g("host_memory_total", "The total memory of the host."),
    hostMemoryUsed: g("host_memory_used", "The used memory of the host."),
    hostSwapFree: g("host_swap_free", "The free swap of the host."),
    hostSwapTotal: g("host_swap_total", "The total swap of the host."),
    hostSwapUsed: g("host_swap_used", "The used swap of the host."),
    hostDiskAvailable: g(
      "host_disk_available",
      "The available disk of the local root disk in bytes.",
    ),
    hostDiskTotal: g(
      "host_disk_total",
      "The total disk of the local root disk in bytes.",
    ),
    hostDiskUsed: g(
      "host_disk_used",
      "The used disk of the local root disk in bytes.",
    ),
    hostUptime: g("host_uptime", "The uptime of the host."),
    hostIoWait: g("host_io_wait", "The io wait of the host."),
    hostLoad1: g("host_load1", "The load for 1 minute of the host."),
    hostLoad5: g("host_load5", "The load for 5 minutes of the host."),
    hostLoad15: g("host_load15", "The load for 15 minutes of the host."),
  };
}

type Metrics = ReturnType<typeof buildMetrics>;

// ---------------------------------------------------------------------------
// Exporter
// ---------------------------------------------------------------------------

class Exporter {
  private readonly endpoint: string;
  private readonly authorizationHeader: string;

  constructor(
    endpoint: string,
    username: string,
    apitoken: string,
    apitokenname: string,
  ) {
    this.endpoint = endpoint;
    this.authorizationHeader = `PBSAPIToken=${username}!${apitokenname}:${apitoken}`;
  }

  /** Perform an authenticated GET and return the parsed JSON body. */
  private async request<T>(
    path: string,
  ): Promise<{ status: number; body: string; json: () => T }> {
    const url = this.endpoint + path;
    log.debug(`Request URL: ${sanitize(url)}`);

    const resp = await fetch(url, {
      headers: { Authorization: this.authorizationHeader },
      signal: AbortSignal.timeout(timeoutMs),
      dispatcher,
    } as RequestInit);

    const body = await resp.text();
    log.debug(
      `Status code ${resp.status} returned from endpoint: ${sanitize(this.endpoint)}`,
    );
    return { status: resp.status, body, json: () => JSON.parse(body) as T };
  }

  async collect(m: Metrics): Promise<void> {
    try {
      await this.collectFromAPI(m);
      m.up.set(1);
    } catch (err) {
      m.up.set(0);
      log.error(err instanceof Error ? err.message : String(err));
    }
  }

  private async collectFromAPI(m: Metrics): Promise<void> {
    await this.getVersion(m);

    const usage = await this.request<DatastoreResponse>(DATASTORE_USAGE_API);
    if (usage.status !== 200) {
      throw new Error(
        `Status code ${usage.status} returned from endpoint: ${this.endpoint}`,
      );
    }

    for (const datastore of usage.json().data) {
      await this.getDatastoreMetric(datastore, m);
    }

    await this.getNodeMetrics(m);
    await this.getNodeSubscriptionMetrics(m);
  }

  private async getVersion(m: Metrics): Promise<void> {
    const resp = await this.request<VersionResponse>(VERSION_API);
    if (resp.status !== 200) {
      throw new Error(
        `Status code ${resp.status} returned from endpoint: ${this.endpoint}`,
      );
    }
    const d = resp.json().data;
    m.version.set(
      { version: d.version, repoid: d.repoid, release: d.release },
      1,
    );
  }

  private async getNodeSubscriptionMetrics(m: Metrics): Promise<void> {
    const resp = await this.request<{ data: Record<string, unknown> }>(
      `${NODE_API}/localhost/subscription`,
    );
    if (resp.status !== 200) {
      throw new Error(
        `Status code ${resp.status} returned from endpoint: ${this.endpoint}`,
      );
    }

    const data = resp.json().data ?? {};
    let statusStr = "";
    let productName = "unknown";
    let dueTs = 0;

    if (data.status != null) statusStr = String(data.status);
    if (data.productname != null) productName = String(data.productname);
    if (typeof data.nextduedate === "string") {
      const parsed = Date.parse(`${data.nextduedate}T00:00:00Z`);
      if (!Number.isNaN(parsed)) dueTs = Math.floor(parsed / 1000);
    }

    m.subscriptionInfo.set({ productname: productName, status: statusStr }, 1);
    m.subscriptionDueTimestamp.set({ productname: productName }, dueTs);

    const statuses = [
      "new",
      "notfound",
      "active",
      "invalid",
      "expired",
      "suspended",
    ];
    for (const s of statuses) {
      m.subscriptionStatus.set({ status: s }, statusStr === s ? 1 : 0);
    }
  }

  private async getNodeMetrics(m: Metrics): Promise<void> {
    // NOTE: The API requires a node name (not the IP), but any name works, so we use "localhost".
    // see: https://pbs.proxmox.com/docs/api-viewer/index.html#/nodes/{node}
    const resp = await this.request<HostResponse>(
      `${NODE_API}/localhost/status`,
    );
    if (resp.status !== 200) {
      throw new Error(
        `Status code ${resp.status} returned from endpoint: ${this.endpoint}`,
      );
    }

    const d = resp.json().data;
    m.hostCpuUsage.set(d.cpu);
    m.hostMemoryFree.set(d.memory.free);
    m.hostMemoryTotal.set(d.memory.total);
    m.hostMemoryUsed.set(d.memory.used);
    m.hostSwapFree.set(d.swap.free);
    m.hostSwapTotal.set(d.swap.total);
    m.hostSwapUsed.set(d.swap.used);
    m.hostDiskAvailable.set(d.root.avail);
    m.hostDiskTotal.set(d.root.total);
    m.hostDiskUsed.set(d.root.used);
    m.hostUptime.set(d.uptime);
    m.hostIoWait.set(d.wait);
    m.hostLoad1.set(d.loadavg[0]);
    m.hostLoad5.set(d.loadavg[1]);
    m.hostLoad15.set(d.loadavg[2]);
  }

  private async getDatastoreMetric(
    datastore: DatastoreEntry,
    m: Metrics,
  ): Promise<void> {
    log.debug(`--Store ${datastore.store}`);
    log.debug(`--Avail ${datastore.avail}`);
    log.debug(`--Total ${datastore.total}`);
    log.debug(`--Used ${datastore.used}`);

    m.available.set({ datastore: datastore.store }, datastore.avail);
    m.size.set({ datastore: datastore.store }, datastore.total);
    m.used.set({ datastore: datastore.store }, datastore.used);

    const resp = await this.request<NamespaceResponse>(
      `${DATASTORE_API}/${datastore.store}/namespace`,
    );

    if (resp.status !== 200) {
      if (
        resp.status === 400 &&
        /datastore is being deleted/i.test(resp.body)
      ) {
        log.info(
          `Datastore: ${datastore.store} is being deleted, Skip scrape datastore metric`,
        );
        return;
      }
      throw new Error(
        `--Status code ${resp.status} returned from endpoint: ${this.endpoint}`,
      );
    }

    for (const namespace of resp.json().data) {
      await this.getNamespaceMetric(datastore.store, namespace.ns, m);
    }
  }

  private async getNamespaceMetric(
    datastore: string,
    namespace: string,
    m: Metrics,
  ): Promise<void> {
    log.debug(`----Namespace ${namespace}`);

    const resp = await this.request<SnapshotResponse>(
      `${DATASTORE_API}/${datastore}/snapshots?ns=${namespace}`,
    );
    if (resp.status !== 200) {
      throw new Error(
        `----Status code ${resp.status} returned from endpoint: ${this.endpoint}`,
      );
    }

    const snapshots = resp.json().data;
    m.snapshotCount.set({ datastore, namespace }, snapshots.length);

    // Aggregate per VM.
    const vmNameMapping = new Map<string, string>();
    const vmCount = new Map<string, number>();
    for (const snapshot of snapshots) {
      const vmID = snapshot["backup-id"];
      vmNameMapping.set(vmID, snapshot.comment ?? "");
      vmCount.set(vmID, (vmCount.get(vmID) ?? 0) + 1);
    }

    for (const [vmID, count] of vmCount) {
      const vmName = vmNameMapping.get(vmID) ?? "";
      const labels = { datastore, namespace, vm_id: vmID, vm_name: vmName };
      m.snapshotVmCount.set(labels, count);

      const last = findLastSnapshotWithBackupID(snapshots, vmID);
      if (last === null) {
        throw new Error(`No snapshot found with backupID ${vmID}`);
      }
      m.snapshotVmLastTimestamp.set(labels, last.timestamp);
      m.snapshotVmLastAge.set(
        labels,
        Math.floor(Date.now() / 1000) - last.timestamp,
      );
      m.snapshotVmLastVerify.set(labels, last.verify === "ok" ? 1 : 0);
    }
  }
}

function findLastSnapshotWithBackupID(
  snapshots: SnapshotEntry[],
  backupID: string,
): { timestamp: number; verify: string } | null {
  let lastTimestamp = 0;
  let lastVerify = "";
  for (const snapshot of snapshots) {
    if (
      snapshot["backup-id"] === backupID &&
      snapshot["backup-time"] > lastTimestamp
    ) {
      lastTimestamp = snapshot["backup-time"];
      lastVerify = snapshot.verification?.state ?? "";
    }
  }
  return lastTimestamp !== 0
    ? { timestamp: lastTimestamp, verify: lastVerify }
    : null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const config = loadConfig();

  if (config.showVersion) {
    console.log(
      `PBS Exporter Version: ${Version}, Commit: ${Commit}, Build Time: ${BuildTime}`,
    );
    process.exit(0);
  }

  loglevel = config.loglevel;

  log.info(
    `Starting PBS Exporter ${Version}, commit ${Commit}, built at ${BuildTime}`,
  );

  // Register default Node.js process/runtime metrics once.
  collectDefaultMetrics({ register: defaultRegistry });

  let insecureBool: boolean;
  try {
    insecureBool = parseBool(config.insecure);
  } catch (err) {
    log.error(
      `Unable to parse insecure: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  try {
    timeoutMs = parseDuration(config.timeout);
  } catch (err) {
    log.error(
      `Unable to parse timeout: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  // Configure the TLS dispatcher (allow self-signed certs when insecure).
  dispatcher = new Agent({
    connect: { rejectUnauthorized: !insecureBool, minVersion: "TLSv1.2" },
  });

  if (loglevel === "debug") {
    log.debug(`Using connection endpoint: ${sanitize(config.endpoint)}`);
    log.debug(`Using connection username: ${config.username}`);
    log.debug(`Using connection apitoken: ${config.apitoken}`);
    log.debug(`Using connection apitokenname: ${config.apitokenname}`);
    log.debug(`Using connection timeout: ${timeoutMs}ms`);
    log.debug(`Using connection insecure: ${insecureBool}`);
    log.debug(`Using metrics path: ${config.metricsPath}`);
    log.debug(`Using listen address: ${config.listenAddress}`);
  }

  if (config.endpoint !== "") {
    log.info(`Using fix connection endpoint: ${sanitize(config.endpoint)}`);
  }
  log.info(`Listening on: ${config.listenAddress}`);
  log.info(`Metrics path: ${config.metricsPath}`);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, config);
  });

  // Go's WriteTimeout/ReadTimeout were 10s.
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;

  // ":10019" -> listen on all interfaces, port 10019.
  const { host, port } = parseListenAddress(config.listenAddress);
  server.listen(port, host);
}

function parseListenAddress(addr: string): {
  host: string | undefined;
  port: number;
} {
  const idx = addr.lastIndexOf(":");
  const host = idx > 0 ? addr.slice(0, idx) : undefined;
  const port = Number.parseInt(addr.slice(idx + 1), 10);
  return { host, port };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === config.metricsPath) {
    // Determine the target endpoint.
    let target: string;
    if (config.endpoint !== "") {
      target = config.endpoint;
    } else {
      target = url.searchParams.get("target") ?? "http://localhost:8007";
    }

    log.debug(`Using connection endpoint ${sanitize(target)}`);

    // Fresh registry per scrape so old label series are not retained.
    const registry = new Registry();
    const metrics = buildMetrics(registry);
    const exporter = new Exporter(
      target,
      config.username,
      config.apitoken,
      config.apitokenname,
    );
    await exporter.collect(metrics);

    // Combine PBS scrape metrics with the persistent Node.js process metrics.
    const merged = Registry.merge([defaultRegistry, registry]);
    res.setHeader("Content-Type", merged.contentType);
    res.end(await merged.metrics());
    return;
  }

  if (url.pathname === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end(`<html>
			<head><title>PBS Exporter</title></head>
			<body>
			<h1>Proxmox Backup Server Exporter</h1>
			<p><a href='${config.metricsPath}'>Metrics</a></p>
			</body>
			</html>`);
    return;
  }

  res.statusCode = 404;
  res.end("404 page not found");
}

main();
