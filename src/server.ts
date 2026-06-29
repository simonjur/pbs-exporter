/**
 * HTTP layer for the exporter: the `/metrics` scrape endpoint, the status-UI
 * JSON feed (`/api/status`), and the vendored static assets served on `/`.
 *
 * The collaborators that vary at runtime (config, the persistent default
 * registry, timeout and TLS dispatcher) are passed in via `RequestContext` so
 * the request handler can be unit-tested without a live server.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Dispatcher } from "undici";
import { Registry } from "prom-client";
import type { Logger } from "winston";
import { type Config, validateUrl } from "./config.ts";
import { buildMetrics } from "./metrics.ts";
import { Exporter } from "./exporter.ts";
import { getStatuses, getSummary, recordScrape } from "./status.ts";
import { Version, Commit, BuildTime } from "./buildinfo.ts";

// ---------------------------------------------------------------------------
// Static assets for the status UI (served on `/`).
// The frontend is pre-built into the `public/` directory by `npm run build:fe`
// (Vue/Vuetify browser builds + the app shell — no CDN, works air-gapped). The
// server serves it as-is and requires it to exist (see `assertPublicDirectory`).
// Bodies are cached in memory after first read.
// ---------------------------------------------------------------------------

// `public/` lives at the repo root; this module is at `src/server.ts`.
const publicDirectory = path.join(import.meta.dirname, "..", "public");
const assetsDirectory = path.join(publicDirectory, "assets");

const JS_TYPE = "text/javascript; charset=utf-8";
const staticAssets: Record<string, { file: string; type: string }> = {
  "/": {
    file: path.join(publicDirectory, "index.html"),
    type: "text/html; charset=utf-8",
  },
  "/assets/app.js": {
    file: path.join(assetsDirectory, "app.js"),
    type: JS_TYPE,
  },
  "/assets/vue.global.prod.js": {
    file: path.join(assetsDirectory, "vue.global.prod.js"),
    type: JS_TYPE,
  },
  "/assets/vuetify.min.js": {
    file: path.join(assetsDirectory, "vuetify.min.js"),
    type: JS_TYPE,
  },
  "/assets/vuetify.min.css": {
    file: path.join(assetsDirectory, "vuetify.min.css"),
    type: "text/css; charset=utf-8",
  },
};
const assetCache = new Map<string, Buffer>();

/**
 * Verify the pre-built status-UI assets exist. The server assumes `public/` is
 * present (built by `npm run build:fe`, and by the Docker image at build time);
 * if it is missing we fail fast at startup with an actionable message rather
 * than serving 500s per request.
 */
export function assertPublicDirectory(): void {
  if (!existsSync(path.join(publicDirectory, "index.html"))) {
    throw new Error(
      `No public dir found at ${publicDirectory} — perhaps you forgot to run "npm run build:fe"?`,
    );
  }
}

export type RequestContext = {
  config: Config;
  /** Persistent registry for Node.js process/runtime metrics. */
  defaultRegistry: Registry;
  timeoutMs: number;
  dispatcher?: Dispatcher;
  log: Logger;
};

export function parseListenAddress(addr: string): {
  host: string | undefined;
  port: number;
} {
  const index = addr.lastIndexOf(":");
  const host = index > 0 ? addr.slice(0, index) : undefined;
  const port = Number(addr.slice(index + 1));
  return { host, port };
}

export async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): Promise<void> {
  const { config, log } = context;
  const url = new URL(request.url ?? "/", "http://localhost");

  if (url.pathname === config.metricsPath) {
    // Determine the target endpoint.
    const rawTarget =
      config.endpoint === ""
        ? (url.searchParams.get("target") ?? "http://localhost:8007")
        : config.endpoint;

    log.debug(`Using connection endpoint ${rawTarget}`);

    // Validate before any request (SSRF guard): reject non-http(s) schemes and
    // unparseable URLs with a 400, without performing a scrape. The exporter
    // re-validates the full URL at the fetch boundary.
    try {
      validateUrl(rawTarget);
    } catch (error) {
      log.error(
        `Rejected target ${rawTarget}: ${error instanceof Error ? error.message : String(error)}`,
      );
      response.statusCode = 400;
      response.end("400 invalid target");
      return;
    }
    const target = rawTarget;

    // Fresh registry per scrape so old label series are not retained.
    const registry = new Registry();
    const metrics = buildMetrics(registry);
    const exporter = new Exporter({
      endpoint: target,
      username: config.username,
      apiToken: config.apiToken,
      apiTokenName: config.apiTokenName,
      timeoutMs: context.timeoutMs,
      dispatcher: context.dispatcher,
      log,
    });
    const result = await exporter.collect(metrics);
    recordScrape({
      target,
      up: result.up,
      version: result.version,
      release: result.release,
      error: result.error,
      nowMs: Date.now(),
    });

    // Combine PBS scrape metrics with the persistent Node.js process metrics.
    const merged = Registry.merge([context.defaultRegistry, registry]);
    response.setHeader("Content-Type", merged.contentType);
    response.end(await merged.metrics());
    return;
  }

  // JSON feed powering the status UI.
  if (url.pathname === "/api/status") {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(
      JSON.stringify({
        exporter: { version: Version, commit: Commit, buildTime: BuildTime },
        summary: getSummary(),
        targets: getStatuses(),
      }),
    );
    return;
  }

  // Status UI page and its vendored assets.
  if (await serveStaticAsset(url.pathname, response, log)) {
    return;
  }

  response.statusCode = 404;
  response.end("404 page not found");
}

/** Serve a known static asset (cached in memory). Returns false if no match. */
export async function serveStaticAsset(
  pathname: string,
  response: ServerResponse,
  log: Logger,
): Promise<boolean> {
  const asset = staticAssets[pathname];
  if (!asset) {
    return false;
  }

  try {
    let body = assetCache.get(pathname);
    if (!body) {
      body = await readFile(asset.file);
      assetCache.set(pathname, body);
    }
    response.setHeader("Content-Type", asset.type);
    response.end(body);
  } catch (error) {
    log.error(
      `Failed to serve asset ${pathname}: ${error instanceof Error ? error.message : String(error)}`,
    );
    response.statusCode = 500;
    response.end("500 internal server error");
  }
  return true;
}
