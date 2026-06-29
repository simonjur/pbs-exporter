/**
 * Proxmox Backup Server API client and metric collection.
 *
 * One `Exporter` is created per scrape. It performs a series of authenticated
 * GET requests against the PBS API and populates a `Metrics` bundle. The
 * timeout and TLS dispatcher are injected so the class is decoupled from the
 * process-wide configuration (and easy to unit-test).
 */

import type { Dispatcher } from "undici";
import type { Logger } from "winston";
import { validateUrl } from "./config.ts";
import type { Metrics } from "./metrics.ts";

const VERSION_API = "/api2/json/version";
const DATASTORE_USAGE_API = "/api2/json/status/datastore-usage";
const DATASTORE_API = "/api2/json/admin/datastore";
const NODE_API = "/api2/json/nodes";

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

export type ScrapeResult = {
  up: boolean;
  version: string | null;
  release: string | null;
  error: string | null;
};

export type ExporterOptions = {
  endpoint: string;
  username: string;
  apiToken: string;
  apiTokenName: string;
  timeoutMs: number;
  dispatcher?: Dispatcher;
  log: Logger;
};

export class Exporter {
  private readonly endpoint: string;
  private readonly authorizationHeader: string;
  private readonly timeoutMs: number;
  private readonly dispatcher?: Dispatcher;
  private readonly log: Logger;
  // Captured during a scrape so the status UI can report the PBS version.
  private versionInfo: {
    version: string;
    release: string;
    repoId: string;
  } | null = null;

  constructor(options: ExporterOptions) {
    this.endpoint = options.endpoint;
    this.authorizationHeader = `PBSAPIToken=${options.username}!${options.apiTokenName}:${options.apiToken}`;
    this.timeoutMs = options.timeoutMs;
    this.dispatcher = options.dispatcher;
    this.log = options.log;
  }

  /** Perform an authenticated GET and return the parsed JSON body. */
  private async request<T>(
    path: string,
  ): Promise<{ status: number; body: string; json: () => T }> {
    // Re-validate the fully-resolved URL at the network boundary (SSRF guard):
    // `fetch` receives the parsed, scheme-checked `URL` object, not a raw string.
    const url = validateUrl(this.endpoint + path);
    this.log.debug(`Request URL: ${url.toString()}`);

    const resp = await fetch(url, {
      headers: { Authorization: this.authorizationHeader },
      signal: AbortSignal.timeout(this.timeoutMs),
      dispatcher: this.dispatcher,
    } as RequestInit);

    const body = await resp.text();
    this.log.debug(
      `Status code ${resp.status} returned from endpoint: ${this.endpoint}`,
    );
    return { status: resp.status, body, json: () => JSON.parse(body) as T };
  }

  async collect(m: Metrics): Promise<ScrapeResult> {
    try {
      await this.collectFromAPI(m);
      m.up.set(1);
      return {
        up: true,
        version: this.versionInfo?.version ?? null,
        release: this.versionInfo?.release ?? null,
        error: null,
      };
    } catch (error) {
      m.up.set(0);
      const message = error instanceof Error ? error.message : String(error);
      this.log.error(message);
      return {
        up: false,
        version: this.versionInfo?.version ?? null,
        release: this.versionInfo?.release ?? null,
        error: message,
      };
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
    this.versionInfo = {
      version: d.version,
      release: d.release,
      repoId: d.repoid,
    };
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
    let statusString = "";
    let productName = "unknown";
    let dueTs = 0;

    if (typeof data.status === "string") statusString = data.status;
    if (typeof data.productname === "string") productName = data.productname;
    if (typeof data.nextduedate === "string") {
      const parsed = Date.parse(`${data.nextduedate}T00:00:00Z`);
      if (!Number.isNaN(parsed)) dueTs = Math.floor(parsed / 1000);
    }

    m.subscriptionInfo.set(
      { productname: productName, status: statusString },
      1,
    );
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
      m.subscriptionStatus.set({ status: s }, statusString === s ? 1 : 0);
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
    this.log.debug(`--Store ${datastore.store}`);
    this.log.debug(`--Avail ${datastore.avail}`);
    this.log.debug(`--Total ${datastore.total}`);
    this.log.debug(`--Used ${datastore.used}`);

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
        this.log.info(
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
    this.log.debug(`----Namespace ${namespace}`);

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
      const lastTimestamp = last["backup-time"];
      m.snapshotVmLastTimestamp.set(labels, lastTimestamp);
      m.snapshotVmLastAge.set(
        labels,
        Math.floor(Date.now() / 1000) - lastTimestamp,
      );
      m.snapshotVmLastVerify.set(
        labels,
        last.verification?.state === "ok" ? 1 : 0,
      );
    }
  }
}

export function findLastSnapshotWithBackupID(
  snapshots: SnapshotEntry[],
  backupID: string,
): SnapshotEntry | null {
  let last: SnapshotEntry | null = null;
  for (const snapshot of snapshots) {
    if (
      snapshot["backup-id"] === backupID &&
      (last === null || snapshot["backup-time"] > last["backup-time"])
    ) {
      last = snapshot;
    }
  }
  return last;
}
