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
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { Dispatcher } from "undici";
import { Registry } from "prom-client";
import { type Config, validateTarget } from "./config.ts";
import { log, sanitize } from "./log.ts";
import { buildMetrics } from "./metrics.ts";
import { Exporter } from "./exporter.ts";
import { getStatuses, getSummary, recordScrape } from "./status.ts";
import { Version, Commit, BuildTime } from "./buildinfo.ts";

// ---------------------------------------------------------------------------
// Static assets for the status UI (served on `/`).
// Vue and Vuetify browser builds are vendored from node_modules at runtime —
// no CDN, so the page works in air-gapped environments. Bodies are cached in
// memory after first read.
// ---------------------------------------------------------------------------

const requireFromHere = createRequire(import.meta.url);
const webDir = join(import.meta.dirname, "web");
const vueDir = dirname(requireFromHere.resolve("vue/package.json"));
const vuetifyDir = dirname(requireFromHere.resolve("vuetify/package.json"));

const JS_TYPE = "text/javascript; charset=utf-8";
const staticAssets: Record<string, { file: string; type: string }> = {
  "/": { file: join(webDir, "index.html"), type: "text/html; charset=utf-8" },
  "/assets/app.js": { file: join(webDir, "app.js"), type: JS_TYPE },
  "/assets/vue.global.prod.js": {
    file: join(vueDir, "dist", "vue.global.prod.js"),
    type: JS_TYPE,
  },
  "/assets/vuetify.min.js": {
    file: join(vuetifyDir, "dist", "vuetify.min.js"),
    type: JS_TYPE,
  },
  "/assets/vuetify.min.css": {
    file: join(vuetifyDir, "dist", "vuetify.min.css"),
    type: "text/css; charset=utf-8",
  },
};
const assetCache = new Map<string, Buffer>();

export type RequestContext = {
  config: Config;
  /** Persistent registry for Node.js process/runtime metrics. */
  defaultRegistry: Registry;
  timeoutMs: number;
  dispatcher?: Dispatcher;
};

export function parseListenAddress(addr: string): {
  host: string | undefined;
  port: number;
} {
  const idx = addr.lastIndexOf(":");
  const host = idx > 0 ? addr.slice(0, idx) : undefined;
  const port = Number.parseInt(addr.slice(idx + 1), 10);
  return { host, port };
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RequestContext,
): Promise<void> {
  const { config } = ctx;
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === config.metricsPath) {
    // Determine the target endpoint.
    let rawTarget: string;
    if (config.endpoint === "") {
      rawTarget = url.searchParams.get("target") ?? "http://localhost:8007";
    } else {
      rawTarget = config.endpoint;
    }

    log.debug(`Using connection endpoint ${sanitize(rawTarget)}`);

    // Validate before any request (SSRF guard): reject non-http(s) schemes and
    // unparseable URLs without performing a scrape.
    let target: string;
    try {
      target = validateTarget(rawTarget);
    } catch (err) {
      log.error(
        `Rejected target ${sanitize(rawTarget)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      res.statusCode = 400;
      res.end("400 invalid target");
      return;
    }

    // Fresh registry per scrape so old label series are not retained.
    const registry = new Registry();
    const metrics = buildMetrics(registry);
    const exporter = new Exporter({
      endpoint: target,
      username: config.username,
      apiToken: config.apiToken,
      apiTokenName: config.apiTokenName,
      timeoutMs: ctx.timeoutMs,
      dispatcher: ctx.dispatcher,
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
    const merged = Registry.merge([ctx.defaultRegistry, registry]);
    res.setHeader("Content-Type", merged.contentType);
    res.end(await merged.metrics());
    return;
  }

  // JSON feed powering the status UI.
  if (url.pathname === "/api/status") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        exporter: { version: Version, commit: Commit, buildTime: BuildTime },
        summary: getSummary(),
        targets: getStatuses(),
      }),
    );
    return;
  }

  // Status UI page and its vendored assets.
  if (await serveStaticAsset(url.pathname, res)) {
    return;
  }

  res.statusCode = 404;
  res.end("404 page not found");
}

/** Serve a known static asset (cached in memory). Returns false if no match. */
export async function serveStaticAsset(
  pathname: string,
  res: ServerResponse,
): Promise<boolean> {
  const asset = staticAssets[pathname];
  if (!asset) return false;

  try {
    let body = assetCache.get(pathname);
    if (!body) {
      body = await readFile(asset.file);
      assetCache.set(pathname, body);
    }
    res.setHeader("Content-Type", asset.type);
    res.end(body);
  } catch (err) {
    log.error(
      `Failed to serve asset ${sanitize(pathname)}: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.statusCode = 500;
    res.end("500 internal server error");
  }
  return true;
}
