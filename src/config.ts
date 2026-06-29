/**
 * Configuration building for the PBS exporter.
 *
 * Resolution precedence (lowest → highest): built-in default → CLI flag → env var.
 * CLI flags are parsed with commander in the entrypoint ([`run.ts`](./run.ts));
 * this module is pure — it maps the already-parsed options plus the environment
 * into a {@link Config}, and never touches `process.argv` or commander.
 */

import { readFileSync } from "node:fs";
import parse from "parse-duration";

export type Config = {
  endpoint: string;
  username: string;
  apiToken: string;
  apiTokenName: string;
  timeout: number;
  insecure: string;
  metricsPath: string;
  listenAddress: string;
  loglevel: string;
  logFormat: LogFormat;
  showVersion: boolean;
};

export type LogFormat = "text" | "json";

/**
 * Parsed CLI options as produced by commander's `program.opts()` in `run.ts`.
 * Keys match the commander option names: the segment after the last hyphen group
 * is camel-cased (`--pbs.metrics-path` → `pbs.metricsPath`), dots are preserved.
 */
export type CliOptions = {
  "pbs.endpoint": string;
  "pbs.username": string;
  "pbs.api.token": string;
  "pbs.api.token.name": string;
  "pbs.timeout": string;
  "pbs.insecure": string;
  "pbs.metricsPath": string;
  "pbs.listenAddress": string;
  "pbs.loglevel": string;
  "pbs.logformat": string;
  version?: boolean;
};

/** Read the first line of a secret file (matches the Go bufio.Scanner behaviour). */
export function readSecretFile(filename: string): string {
  const content = readFileSync(filename, "utf8");
  return content.split(/\r?\n/, 1)[0] ?? "";
}

const ALLOWED_TARGET_SCHEMES = new Set(["http:", "https:"]);

/**
 * Validate a target/endpoint URL before it is used for an HTTP request, and
 * return it as a parsed `URL` object.
 *
 * It must be a parseable absolute URL using an `http:`/`https:` scheme; any
 * other scheme (`file:`, `gopher:`, …) or an unparseable value throws. This
 * mitigates SSRF from the operator-supplied endpoint and the `?target=` query
 * parameter. Callers should use the returned `URL` (or pass it straight to
 * `fetch`) so the value used for the network request is the validated one.
 */
export function validateUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`invalid target URL: ${rawUrl}`);
  }
  if (!ALLOWED_TARGET_SCHEMES.has(url.protocol)) {
    throw new Error(`disallowed target URL scheme: ${url.protocol}`);
  }
  return url;
}

/** Parse a Go-style boolean string ("1"/"t"/"true" / "0"/"f"/"false"). */
export function isInsecureBoolean(input: string): boolean {
  switch (input.toLowerCase()) {
    case "1":
    case "t":
    case "true": {
      return true;
    }
    case "0":
    case "f":
    case "false": {
      return false;
    }
    default: {
      throw new Error(`invalid boolean: ${input}`);
    }
  }
}

/**
 * Build the exporter configuration from parsed CLI options and the environment.
 *
 * Pure: commander parsing happens in `run.ts`; this only applies the env-var
 * overrides and validation on top of the supplied {@link CliOptions}.
 *
 * @param opts Parsed CLI options (from `program.opts()` in `run.ts`).
 * @param env  Environment map (defaults to `process.env`).
 */
export function loadConfig(
  opts: CliOptions,
  env: NodeJS.ProcessEnv = process.env,
): Config {
  // Resolve the raw timeout string (default → flag → env), then parse to ms.
  const timeoutRaw = env.PBS_TIMEOUT || opts["pbs.timeout"];
  const timeout = parse(timeoutRaw);
  if (timeout === null) {
    throw new Error(`invalid duration: ${timeoutRaw}`);
  }

  // Resolve and validate the log format (default → flag → env).
  const logformatRaw = env.PBS_LOGFORMAT || opts["pbs.logformat"];
  if (logformatRaw !== "text" && logformatRaw !== "json") {
    throw new Error(`invalid log format: ${logformatRaw}`);
  }
  const logFormat: LogFormat = logformatRaw;

  const config: Config = {
    endpoint: opts["pbs.endpoint"],
    username: opts["pbs.username"],
    apiToken: opts["pbs.api.token"],
    apiTokenName: opts["pbs.api.token.name"],
    timeout,
    insecure: opts["pbs.insecure"],
    metricsPath: opts["pbs.metricsPath"],
    listenAddress: opts["pbs.listenAddress"],
    loglevel: opts["pbs.loglevel"],
    logFormat: logFormat,
    showVersion: opts["version"] === true,
  };

  // Environment variables override defaults/flags.
  if (env.PBS_LOGLEVEL) {
    config.loglevel = env.PBS_LOGLEVEL;
  }
  if (env.PBS_ENDPOINT) {
    config.endpoint = env.PBS_ENDPOINT;
  }

  if (env.PBS_USERNAME) {
    config.username = env.PBS_USERNAME;
  } else if (env.PBS_USERNAME_FILE) {
    config.username = readSecretFile(env.PBS_USERNAME_FILE);
  }

  if (env.PBS_API_TOKEN_NAME) {
    config.apiTokenName = env.PBS_API_TOKEN_NAME;
  } else if (env.PBS_API_TOKEN_NAME_FILE) {
    config.apiTokenName = readSecretFile(env.PBS_API_TOKEN_NAME_FILE);
  }

  if (env.PBS_API_TOKEN) {
    config.apiToken = env.PBS_API_TOKEN;
  } else if (env.PBS_API_TOKEN_FILE) {
    config.apiToken = readSecretFile(env.PBS_API_TOKEN_FILE);
  }

  if (env.PBS_INSECURE) {
    config.insecure = env.PBS_INSECURE;
  }
  if (env.PBS_METRICS_PATH) {
    config.metricsPath = env.PBS_METRICS_PATH;
  }
  if (env.PBS_LISTEN_ADDRESS) {
    config.listenAddress = env.PBS_LISTEN_ADDRESS;
  }

  // Validate a configured endpoint up front (SSRF guard), whether it came from
  // the `--pbs.endpoint` flag or the `PBS_ENDPOINT` env var; empty = dynamic
  // `?target=` mode, validated per-request in the HTTP layer. The endpoint
  // string is kept as-is (the exporter re-validates the full URL before fetch).
  if (config.endpoint !== "") {
    validateUrl(config.endpoint);
  }

  return config;
}
