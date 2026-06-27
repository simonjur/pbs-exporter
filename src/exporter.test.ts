import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Registry } from "prom-client";
import { Exporter, findLastSnapshotWithBackupID } from "./exporter.ts";
import { buildMetrics, type Metrics } from "./metrics.ts";
import {
  datastoreUsageResponse,
  healthyRoutes,
  makeFetchMock,
  metricValue,
  nodeStatusResponse,
  subscriptionActiveResponse,
  versionResponse,
  type Routes,
} from "./pbs.fixtures.ts";

const realFetch = globalThis.fetch;

function installFetch(routes: Routes) {
  const mock = makeFetchMock(routes);
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

function newExporter() {
  return new Exporter({
    endpoint: "https://pbs.example:8007",
    username: "root@pam",
    apiToken: "secret-token",
    apiTokenName: "pbs-exporter",
    timeoutMs: 5000,
  });
}

function freshMetrics(): { registry: Registry; metrics: Metrics } {
  const registry = new Registry();
  return { registry, metrics: buildMetrics(registry) };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

describe("Exporter.collect — healthy server", () => {
  beforeEach(() => {
    // Fixed "now" so snapshot age is deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(1780900000000);
  });

  it("reports up and the PBS version", async () => {
    installFetch(healthyRoutes());
    const { registry, metrics } = freshMetrics();

    const result = await newExporter().collect(metrics);

    expect(result).toEqual({
      up: true,
      version: "4.2",
      release: "1",
      error: null,
    });
    expect(await metricValue(registry, "pbs_up")).toBe(1);
    expect(
      await metricValue(registry, "pbs_version", {
        version: "4.2",
        repoid: versionResponse.data.repoid,
        release: "1",
      }),
    ).toBe(1);
  });

  it("records datastore usage", async () => {
    installFetch(healthyRoutes());
    const { registry, metrics } = freshMetrics();
    await newExporter().collect(metrics);

    const ds = { datastore: "slow-xfs" };
    expect(await metricValue(registry, "pbs_available", ds)).toBe(
      datastoreUsageResponse.data[0]!.avail,
    );
    expect(await metricValue(registry, "pbs_size", ds)).toBe(
      datastoreUsageResponse.data[0]!.total,
    );
    expect(await metricValue(registry, "pbs_used", ds)).toBe(
      datastoreUsageResponse.data[0]!.used,
    );
  });

  it("aggregates snapshots per namespace and per VM", async () => {
    installFetch(healthyRoutes());
    const { registry, metrics } = freshMetrics();
    await newExporter().collect(metrics);

    // 4 snapshots in the root ns, 0 in proxmox-v2.
    expect(
      await metricValue(registry, "pbs_snapshot_count", {
        datastore: "slow-xfs",
        namespace: "",
      }),
    ).toBe(4);
    expect(
      await metricValue(registry, "pbs_snapshot_count", {
        datastore: "slow-xfs",
        namespace: "proxmox-v2",
      }),
    ).toBe(0);

    const vm503 = {
      datastore: "slow-xfs",
      namespace: "",
      vm_id: "503",
      vm_name: "mail-archover.home.arpa",
    };
    expect(await metricValue(registry, "pbs_snapshot_vm_count", vm503)).toBe(3);
    // Latest of the three 503 snapshots.
    expect(
      await metricValue(registry, "pbs_snapshot_vm_last_timestamp", vm503),
    ).toBe(1780683922);
    expect(await metricValue(registry, "pbs_snapshot_vm_last_age", vm503)).toBe(
      1780900000 - 1780683922,
    );
    expect(
      await metricValue(registry, "pbs_snapshot_vm_last_verify", vm503),
    ).toBe(1);
  });

  it("marks an unverified/failed last backup as not ok", async () => {
    installFetch(healthyRoutes());
    const { registry, metrics } = freshMetrics();
    await newExporter().collect(metrics);

    expect(
      await metricValue(registry, "pbs_snapshot_vm_last_verify", {
        datastore: "slow-xfs",
        namespace: "",
        vm_id: "100",
        vm_name: "minilab, homelab, 100",
      }),
    ).toBe(0);
  });

  it("records host status metrics", async () => {
    installFetch(healthyRoutes());
    const { registry, metrics } = freshMetrics();
    await newExporter().collect(metrics);

    const d = nodeStatusResponse.data;
    expect(await metricValue(registry, "pbs_host_cpu_usage")).toBe(d.cpu);
    expect(await metricValue(registry, "pbs_host_memory_free")).toBe(
      d.memory.free,
    );
    expect(await metricValue(registry, "pbs_host_memory_total")).toBe(
      d.memory.total,
    );
    expect(await metricValue(registry, "pbs_host_swap_total")).toBe(
      d.swap.total,
    );
    expect(await metricValue(registry, "pbs_host_disk_available")).toBe(
      d.root.avail,
    );
    expect(await metricValue(registry, "pbs_host_uptime")).toBe(d.uptime);
    expect(await metricValue(registry, "pbs_host_io_wait")).toBe(d.wait);
    expect(await metricValue(registry, "pbs_host_load1")).toBe(d.loadavg[0]);
    expect(await metricValue(registry, "pbs_host_load5")).toBe(d.loadavg[1]);
    expect(await metricValue(registry, "pbs_host_load15")).toBe(d.loadavg[2]);
  });

  it("records subscription status (notfound)", async () => {
    installFetch(healthyRoutes());
    const { registry, metrics } = freshMetrics();
    await newExporter().collect(metrics);

    expect(
      await metricValue(registry, "pbs_host_subscription_status", {
        status: "notfound",
      }),
    ).toBe(1);
    expect(
      await metricValue(registry, "pbs_host_subscription_status", {
        status: "active",
      }),
    ).toBe(0);
    expect(
      await metricValue(registry, "pbs_host_subscription_info", {
        productname: "unknown",
        status: "notfound",
      }),
    ).toBe(1);
    expect(
      await metricValue(
        registry,
        "pbs_host_subscription_due_timestamp_seconds",
        {
          productname: "unknown",
        },
      ),
    ).toBe(0);
  });

  it("sends the PBS API token in the Authorization header", async () => {
    const mock = installFetch(healthyRoutes());
    const { metrics } = freshMetrics();
    await newExporter().collect(metrics);

    const headers = mock.calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      "PBSAPIToken=root@pam!pbs-exporter:secret-token",
    );
    expect(mock.calls[0]?.path).toBe("/api2/json/version");
  });
});

describe("Exporter.collect — subscription with a due date", () => {
  it("computes the next-due timestamp from nextduedate", async () => {
    const routes = healthyRoutes();
    routes["/api2/json/nodes/localhost/subscription"] = {
      body: subscriptionActiveResponse,
    };
    installFetch(routes);
    const { registry, metrics } = freshMetrics();
    await newExporter().collect(metrics);

    const expected = Math.floor(Date.parse("2027-01-15T00:00:00Z") / 1000);
    const product = subscriptionActiveResponse.data.productname;
    expect(
      await metricValue(
        registry,
        "pbs_host_subscription_due_timestamp_seconds",
        {
          productname: product,
        },
      ),
    ).toBe(expected);
    expect(
      await metricValue(registry, "pbs_host_subscription_status", {
        status: "active",
      }),
    ).toBe(1);
  });
});

describe("Exporter.collect — error handling", () => {
  it("returns up=false when the version endpoint fails", async () => {
    const routes = healthyRoutes();
    routes["/api2/json/version"] = { status: 500, body: "boom" };
    installFetch(routes);
    const { registry, metrics } = freshMetrics();

    const result = await newExporter().collect(metrics);

    expect(result.up).toBe(false);
    expect(result.error).toMatch(/Status code 500/);
    expect(await metricValue(registry, "pbs_up")).toBe(0);
  });

  it("returns up=false when a fetch rejects", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error("network down"))) as unknown as typeof fetch;
    const { registry, metrics } = freshMetrics();

    const result = await newExporter().collect(metrics);

    expect(result.up).toBe(false);
    expect(result.error).toBe("network down");
    expect(await metricValue(registry, "pbs_up")).toBe(0);
  });

  it("skips a datastore that is being deleted without failing the scrape", async () => {
    const routes = healthyRoutes();
    routes["/api2/json/admin/datastore/slow-xfs/namespace"] = {
      status: 400,
      body: "datastore is being deleted",
    };
    const mock = installFetch(routes);
    const { registry, metrics } = freshMetrics();

    const result = await newExporter().collect(metrics);

    expect(result.up).toBe(true);
    // Usage gauges are still set, but no snapshot calls were made.
    expect(
      await metricValue(registry, "pbs_used", { datastore: "slow-xfs" }),
    ).toBe(datastoreUsageResponse.data[0]!.used);
    expect(mock.calls.some((c) => c.path.includes("/snapshots"))).toBe(false);
  });
});

describe("findLastSnapshotWithBackupID", () => {
  it("returns the most recent snapshot for the backup id", () => {
    const snapshots = [
      { "backup-id": "a", "backup-time": 100, verification: { state: "ok" } },
      {
        "backup-id": "a",
        "backup-time": 300,
        verification: { state: "failed" },
      },
      { "backup-id": "b", "backup-time": 500 },
    ];
    expect(findLastSnapshotWithBackupID(snapshots, "a")).toEqual({
      "backup-id": "a",
      "backup-time": 300,
      verification: { state: "failed" },
    });
  });

  it("returns null when no snapshot matches", () => {
    expect(findLastSnapshotWithBackupID([], "missing")).toBeNull();
  });
});
