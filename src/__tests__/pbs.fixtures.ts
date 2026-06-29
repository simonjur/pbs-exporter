/**
 * Mock Proxmox Backup Server API responses, derived from the real shapes
 * returned by a PBS 4.2 instance. Used by the exporter/server unit tests.
 *
 * Large/irrelevant fields (gc-status, history, file lists, …) are trimmed to
 * only what the exporter actually reads.
 */

import type { Registry } from "prom-client";
import type { Logger } from "winston";
import { createLogger } from "../log.ts";

/** A silent logger for injecting into the exporter/server under test. */
export const testLogger: Logger = createLogger("debug", "text");
testLogger.silent = true;

export const versionResponse = {
  data: {
    release: "1",
    repoid: "04249710f076bea8966c4e60ce32198d626ad9d6",
    version: "4.2",
  },
};

export const datastoreUsageResponse = {
  data: [
    {
      avail: 7_589_931_560_960,
      store: "slow-xfs",
      total: 7_999_425_155_072,
      used: 409_493_594_112,
      "backend-type": "filesystem",
    },
  ],
};

export const namespaceResponse = {
  data: [{ ns: "" }, { ns: "proxmox-v2" }],
};

// Two VMs in the root namespace:
//  - "503": three snapshots; the latest is verified "ok".
//  - "100": one snapshot; verification "failed".
export const snapshotsRootResponse = {
  data: [
    {
      "backup-type": "ct",
      "backup-id": "503",
      "backup-time": 1_779_474_301,
      comment: "mail-archover.home.arpa",
    },
    {
      "backup-type": "ct",
      "backup-id": "503",
      "backup-time": 1_780_683_922,
      comment: "mail-archover.home.arpa",
      verification: { state: "ok" },
    },
    {
      "backup-type": "ct",
      "backup-id": "503",
      "backup-time": 1_780_597_498,
      comment: "mail-archover.home.arpa",
      verification: { state: "ok" },
    },
    {
      "backup-type": "vm",
      "backup-id": "100",
      "backup-time": 1_780_867_436,
      comment: "minilab, homelab, 100",
      verification: { state: "failed" },
    },
  ],
};

export const snapshotsEmptyResponse = { data: [] };

export const nodeStatusResponse = {
  data: {
    cpu: 0.004284949116229231,
    memory: { free: 7_356_518_400, total: 8_195_104_768, used: 598_495_232 },
    swap: { free: 8_191_471_616, total: 8_191_471_616, used: 0 },
    root: {
      avail: 208_426_250_240,
      total: 224_872_357_888,
      used: 4_948_684_800,
    },
    loadavg: [0.02, 0.03, 0.04],
    uptime: 803,
    wait: 0.5,
  },
};

export const subscriptionNotFoundResponse = {
  data: {
    message: "There is no subscription key",
    serverid: "8FEC8E829988402B81903A1D5A003418",
    status: "notfound",
    url: "https://www.proxmox.com/en/proxmox-backup-server/pricing",
  },
};

export const subscriptionActiveResponse = {
  data: {
    status: "active",
    productname: "Proxmox Backup Server Standard Subscription 1 CPU/year",
    nextduedate: "2027-01-15",
    serverid: "8FEC8E829988402B81903A1D5A003418",
  },
};

export type FetchRoute = { status?: number; body: unknown };
export type Routes = Record<string, FetchRoute>;

/** A route table for a fully healthy PBS server (the `slow-xfs` datastore). */
export function healthyRoutes(): Routes {
  return {
    "/api2/json/version": { body: versionResponse },
    "/api2/json/status/datastore-usage": { body: datastoreUsageResponse },
    "/api2/json/admin/datastore/slow-xfs/namespace": {
      body: namespaceResponse,
    },
    "/api2/json/admin/datastore/slow-xfs/snapshots?ns=": {
      body: snapshotsRootResponse,
    },
    "/api2/json/admin/datastore/slow-xfs/snapshots?ns=proxmox-v2": {
      body: snapshotsEmptyResponse,
    },
    "/api2/json/nodes/localhost/status": { body: nodeStatusResponse },
    "/api2/json/nodes/localhost/subscription": {
      body: subscriptionNotFoundResponse,
    },
  };
}

/** A record of one intercepted fetch call. */
export type FetchCall = { path: string; init?: RequestInit };

/**
 * Build a stand-in for the global `fetch` that resolves requests against a
 * route table keyed by request path (origin stripped). Unknown paths get a
 * 404. The returned function also exposes the list of intercepted calls.
 */
export function makeFetchMock(routes: Routes) {
  const calls: FetchCall[] = [];
  const function_ = async (
    input: string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    calls.push({ path, init });
    const route = routes[path];
    if (!route) {
      return new Response("not found", { status: 404 });
    }
    const body =
      typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    return new Response(body, { status: route.status ?? 200 });
  };
  return Object.assign(function_, { calls });
}

/**
 * Read a single metric value (by metric name and optional label match) from a
 * prom-client registry. Returns `undefined` when no matching series exists.
 */
export async function metricValue(
  registry: Registry,
  name: string,
  labels: Record<string, string> = {},
): Promise<number | undefined> {
  const all = await registry.getMetricsAsJSON();
  const metric = all.find((m) => m.name === name);
  if (!metric) {
    return undefined;
  }
  const entry = metric.values.find((v) =>
    Object.entries(labels).every(([k, value]) => String(v.labels[k]) === value),
  );
  return entry?.value;
}
