import { afterEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Registry } from "prom-client";

// The status-UI assets live in the generated `public/` dir (built by
// `npm run build:fe`), which may not exist when running tests. Mock the file
// read so static-asset serving is exercised without depending on the real
// `public/` directory. (Kept module-wide: only the `/` asset test reads a file.)
vi.mock("node:fs/promises", () => ({
  readFile: () =>
    Promise.resolve(
      Buffer.from(
        '<!doctype html>\n<html><head><title>PBS Exporter — Status</title></head><body><div id="app"></div></body></html>',
      ),
    ),
}));
import {
  handleRequest,
  parseListenAddress,
  serveStaticAsset,
  type RequestContext,
} from "../server.ts";
import type { Config } from "../config.ts";
import { getStatuses, resetStatuses } from "../status.ts";
import {
  healthyRoutes,
  makeFetchMock,
  testLogger,
  type Routes,
} from "./pbs.fixtures.ts";

const realFetch = globalThis.fetch;

function installFetch(routes: Routes) {
  const mock = makeFetchMock(routes);
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

type MockRes = ServerResponse & {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
};

function mockRes(): MockRes {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    end(chunk?: unknown) {
      this.body = chunk;
    },
  };
  return res as unknown as MockRes;
}

function mockRequest(url: string): IncomingMessage {
  return { url } as IncomingMessage;
}

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    endpoint: "https://pbs.example:8007",
    username: "root@pam",
    apiToken: "secret-token",
    apiTokenName: "pbs-exporter",
    timeout: 5000,
    insecure: "true",
    metricsPath: "/metrics",
    listenAddress: ":10019",
    loglevel: "info",
    logFormat: "text",
    showVersion: false,
    ...overrides,
  };
}

function context(config: Config): RequestContext {
  return {
    config,
    defaultRegistry: new Registry(),
    timeoutMs: 5000,
    dispatcher: undefined,
    log: testLogger,
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  resetStatuses();
});

describe("handleRequest — /metrics", () => {
  it("scrapes the fixed endpoint and exposes PBS metrics", async () => {
    installFetch(healthyRoutes());
    const res = mockRes();

    await handleRequest(mockRequest("/metrics"), res, context(baseConfig()));

    const body = String(res.body);
    expect(res.headers["Content-Type"]).toContain("text/plain");
    expect(body).toContain("pbs_up 1");
    expect(body).toContain('pbs_version{version="4.2"');
    expect(body).toMatch(
      /pbs_snapshot_count\{datastore="slow-xfs",namespace=""\} 4/,
    );
  });

  it("records the scrape result in the status store", async () => {
    installFetch(healthyRoutes());
    await handleRequest(
      mockRequest("/metrics"),
      mockRes(),
      context(baseConfig()),
    );

    const [status] = getStatuses();
    expect(status).toMatchObject({
      target: "https://pbs.example:8007",
      up: true,
      version: "4.2",
      release: "1",
      error: null,
    });
  });

  it("uses the ?target= query param when no fixed endpoint is set", async () => {
    const mock = installFetch(healthyRoutes());
    await handleRequest(
      mockRequest("/metrics?target=https://other:8007"),
      mockRes(),
      context(baseConfig({ endpoint: "" })),
    );

    expect(mock.calls[0]?.path).toBe("/api2/json/version");
    expect(getStatuses()[0]?.target).toBe("https://other:8007");
  });

  it("exposes pbs_up 0 and records the error when the scrape fails", async () => {
    const routes = healthyRoutes();
    routes["/api2/json/version"] = { status: 503, body: "unavailable" };
    installFetch(routes);
    const res = mockRes();

    await handleRequest(mockRequest("/metrics"), res, context(baseConfig()));

    expect(String(res.body)).toContain("pbs_up 0");
    const [status] = getStatuses();
    expect(status?.up).toBe(false);
    expect(status?.error).toMatch(/Status code 503/);
  });

  it("rejects a disallowed ?target= scheme with HTTP 400 and no scrape", async () => {
    const mock = installFetch(healthyRoutes());
    const res = mockRes();

    await handleRequest(
      mockRequest("/metrics?target=file:///etc/passwd"),
      res,
      context(baseConfig({ endpoint: "" })),
    );

    expect(res.statusCode).toBe(400);
    expect(String(res.body)).toContain("invalid target");
    // No PBS request was made.
    expect(mock.calls).toHaveLength(0);
    expect(getStatuses()).toHaveLength(0);
  });

  it("honours a custom metrics path", async () => {
    installFetch(healthyRoutes());
    const res = mockRes();

    await handleRequest(
      mockRequest("/custom-metrics"),
      res,
      context(baseConfig({ metricsPath: "/custom-metrics" })),
    );

    expect(String(res.body)).toContain("pbs_up 1");
  });
});

describe("handleRequest — status UI feed", () => {
  it("serves /api/status as JSON", async () => {
    installFetch(healthyRoutes());
    // Seed a scrape so the summary/targets are populated.
    await handleRequest(
      mockRequest("/metrics"),
      mockRes(),
      context(baseConfig()),
    );

    const res = mockRes();
    await handleRequest(mockRequest("/api/status"), res, context(baseConfig()));

    expect(res.headers["Content-Type"]).toContain("application/json");
    const payload = JSON.parse(String(res.body));
    expect(payload.exporter).toHaveProperty("version");
    expect(payload.summary).toMatchObject({ total: 1, up: 1, down: 0 });
    expect(payload.targets[0]).toMatchObject({ up: true, version: "4.2" });
  });
});

describe("handleRequest — static assets and 404", () => {
  it("serves the status UI index.html on /", async () => {
    const res = mockRes();
    await handleRequest(mockRequest("/"), res, context(baseConfig()));

    expect(res.headers["Content-Type"]).toContain("text/html");
    expect(String(res.body)).toContain("<!doctype html>");
  });

  it("returns 404 for an unknown path", async () => {
    const res = mockRes();
    await handleRequest(mockRequest("/nope"), res, context(baseConfig()));

    expect(res.statusCode).toBe(404);
    expect(String(res.body)).toContain("404");
  });
});

describe("serveStaticAsset", () => {
  it("returns false for an unknown asset path", async () => {
    const res = mockRes();
    expect(await serveStaticAsset("/assets/missing.js", res, testLogger)).toBe(
      false,
    );
  });
});

describe("parseListenAddress", () => {
  it.each([
    [":10019", { host: undefined, port: 10_019 }],
    ["127.0.0.1:9000", { host: "127.0.0.1", port: 9000 }],
    ["0.0.0.0:8080", { host: "0.0.0.0", port: 8080 }],
  ])("parses %j", (input, expected) => {
    expect(parseListenAddress(input)).toEqual(expected);
  });
});
