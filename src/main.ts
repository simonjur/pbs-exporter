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
import type { Logger } from "winston";
import { Registry, collectDefaultMetrics } from "prom-client";
import type { Config } from "./config.ts";
import { createLogger } from "./log.ts";
import {
  assertPublicDirectory,
  handleRequest,
  parseListenAddress,
} from "./server.ts";
import { seedTarget } from "./status.ts";
import { Version, Commit, BuildTime } from "./buildinfo.ts";

// Persistent registry for Node.js process/runtime metrics (process_*, nodejs_*).
// Collected once at startup — NOT rebuilt per scrape, unlike the PBS metrics.
const defaultRegistry = new Registry();

function startServer(
  config: Config,
  timeoutMs: number,
  dispatcher: Agent,
  log: Logger,
) {
  log.info(`Listening on: ${config.listenAddress}`);
  log.info(`Metrics path: ${config.metricsPath}`);

  const server = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      void handleRequest(request, response, {
        config,
        defaultRegistry,
        timeoutMs,
        dispatcher,
        log,
      });
    },
  );

  // Go's WriteTimeout/ReadTimeout were 10s.
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;

  // ":10019" -> listen on all interfaces, port 10019.
  const { host, port } = parseListenAddress(config.listenAddress);
  server.listen(port, host);
}

export function main(config: Config): void {
  if (config.showVersion) {
    console.log(
      `PBS Exporter Version: ${Version}, Commit: ${Commit}, Build Time: ${BuildTime}`,
    );
    return;
  }

  const logger = createLogger(config.loglevel, config.logFormat);

  // Fail fast if the pre-built status-UI assets are missing.
  try {
    assertPublicDirectory();
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    throw error;
  }

  logger.info(
    `Starting PBS Exporter ${Version}, commit ${Commit}, built at ${BuildTime}`,
  );

  // Register default Node.js process/runtime metrics once.
  collectDefaultMetrics({ register: defaultRegistry });

  const timeoutMs = config.timeout;

  // Configure the TLS dispatcher (allow self-signed certs when insecure).
  const dispatcher = new Agent({
    connect: { rejectUnauthorized: !config.insecure, minVersion: "TLSv1.2" },
  });

  if (config.loglevel === "debug") {
    logger.debug(`Using connection endpoint: ${config.endpoint}`);
    logger.debug(`Using connection username: (hidden)`);
    logger.debug(`Using connection apitoken: (hidden)`);
    logger.debug(`Using connection apitokenname: (hidden)`);
    logger.debug(`Using connection timeout: ${timeoutMs}ms`);
    logger.debug(`Using connection insecure: ${config.insecure}`);
    logger.debug(`Using metrics path: ${config.metricsPath}`);
    logger.debug(`Using listen address: ${config.listenAddress}`);
  }

  if (config.endpoint !== "") {
    logger.info(`Using fix connection endpoint: ${config.endpoint}`);
    // Show the fixed endpoint on the status page before its first scrape.
    seedTarget(config.endpoint);
  }

  startServer(config, timeoutMs, dispatcher, logger);
}
