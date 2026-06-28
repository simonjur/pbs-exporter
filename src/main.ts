/**
 * PBS Exporter — Proxmox Backup Server metrics for Prometheus.
 *
 * TypeScript/Node.js 24+ rewrite of the original Go exporter.
 * Uses the native `fetch`/`undici` HTTP stack and the `prom-client` library.
 *
 * This module exposes `main(config)`: it wires up the collaborators and starts
 * the HTTP server. CLI parsing and config loading happen in the entrypoint
 * (`run.ts`); the testable logic lives in `exporter.ts` (PBS API client),
 * `server.ts` (HTTP layer), `metrics.ts`, `config.ts` and `status.ts`.
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Agent } from "undici";
import { Registry, collectDefaultMetrics } from "prom-client";
import { type Config, parseBool } from "./config.ts";
import {
  log,
  sanitize,
  setLogLevel,
  setLogFormat,
  getLogLevel,
} from "./log.ts";
import {
  assertPublicDir,
  handleRequest,
  parseListenAddress,
} from "./server.ts";
import { seedTarget } from "./status.ts";
import { Version, Commit, BuildTime } from "./buildinfo.ts";

// Persistent registry for Node.js process/runtime metrics (process_*, nodejs_*).
// Collected once at startup — NOT rebuilt per scrape, unlike the PBS metrics.
const defaultRegistry = new Registry();

export function main(config: Config): void {
  if (config.showVersion) {
    console.log(
      `PBS Exporter Version: ${Version}, Commit: ${Commit}, Build Time: ${BuildTime}`,
    );
    process.exit(0);
  }

  setLogLevel(config.loglevel);
  setLogFormat(config.logFormat);

  // Fail fast if the pre-built status-UI assets are missing.
  try {
    assertPublicDir();
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

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

  const timeoutMs = config.timeout;

  // Configure the TLS dispatcher (allow self-signed certs when insecure).
  const dispatcher = new Agent({
    connect: { rejectUnauthorized: !insecureBool, minVersion: "TLSv1.2" },
  });

  if (getLogLevel() === "debug") {
    log.debug(`Using connection endpoint: ${sanitize(config.endpoint)}`);
    log.debug(`Using connection username: (hidden)`);
    log.debug(`Using connection apitoken: ${config.apiToken}`);
    log.debug(`Using connection apitokenname: ${config.apiTokenName}`);
    log.debug(`Using connection timeout: ${timeoutMs}ms`);
    log.debug(`Using connection insecure: ${insecureBool}`);
    log.debug(`Using metrics path: ${config.metricsPath}`);
    log.debug(`Using listen address: ${config.listenAddress}`);
  }

  if (config.endpoint !== "") {
    log.info(`Using fix connection endpoint: ${sanitize(config.endpoint)}`);
    // Show the fixed endpoint on the status page before its first scrape.
    seedTarget(config.endpoint);
  }
  log.info(`Listening on: ${config.listenAddress}`);
  log.info(`Metrics path: ${config.metricsPath}`);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, {
      config,
      defaultRegistry,
      timeoutMs,
      dispatcher,
    });
  });

  // Go's WriteTimeout/ReadTimeout were 10s.
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;

  // ":10019" -> listen on all interfaces, port 10019.
  const { host, port } = parseListenAddress(config.listenAddress);
  server.listen(port, host);
}
