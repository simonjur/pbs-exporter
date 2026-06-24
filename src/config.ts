/**
 * Configuration loading for the PBS exporter.
 *
 * Resolution precedence (lowest → highest): built-in default → CLI flag → env var.
 * Flags are parsed with commander; environment variables override flags/defaults.
 */

import { readFileSync } from "node:fs";
import { Command } from "commander";
import parse from "parse-duration";

export type Config = {
  endpoint: string;
  username: string;
  apitoken: string;
  apitokenname: string;
  timeout: string;
  insecure: string;
  metricsPath: string;
  listenAddress: string;
  loglevel: string;
  showVersion: boolean;
};

/** Read the first line of a secret file (matches the Go bufio.Scanner behaviour). */
export function readSecretFile(filename: string): string {
  const content = readFileSync(filename, "utf8");
  return content.split(/\r?\n/, 1)[0] ?? "";
}

/** Parse a duration string ("5s", "1m30s", "500ms") into milliseconds. */
export function parseDuration(input: string): number {
  const ms = parse(input);
  if (ms === null) throw new Error(`invalid duration: ${input}`);
  return ms;
}

/** Parse a Go-style boolean string ("1"/"t"/"true" / "0"/"f"/"false"). */
export function parseBool(input: string): boolean {
  switch (input.toLowerCase()) {
    case "1":
    case "t":
    case "true":
      return true;
    case "0":
    case "f":
    case "false":
      return false;
    default:
      throw new Error(`invalid boolean: ${input}`);
  }
}

/**
 * Build the exporter configuration from CLI flags and environment variables.
 *
 * @param argv Full process-style argv (defaults to `process.argv`).
 * @param env  Environment map (defaults to `process.env`).
 */
export function loadConfig(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const program = new Command();
  program
    .name("pbs-exporter")
    .description("Export Proxmox Backup Server metrics for Prometheus")
    .option("--pbs.endpoint <endpoint>", "Proxmox Backup Server endpoint", "")
    .option(
      "--pbs.username <username>",
      "Proxmox Backup Server username",
      "root@pam",
    )
    .option("--pbs.api.token <token>", "Proxmox Backup Server API token", "")
    .option(
      "--pbs.api.token.name <name>",
      "Proxmox Backup Server API token name",
      "pbs-exporter",
    )
    .option("--pbs.timeout <duration>", "Proxmox Backup Server timeout", "5s")
    .option("--pbs.insecure <bool>", "Proxmox Backup Server insecure", "false")
    .option(
      "--pbs.metrics-path <path>",
      "Path under which to expose metrics",
      "/metrics",
    )
    .option(
      "--pbs.listen-address <address>",
      "Address on which to expose metrics",
      ":10019",
    )
    .option("--pbs.loglevel <level>", "Loglevel", "info")
    .option("--version", "Show version and exit", false)
    .parse(argv);

  const opts = program.opts();

  const config: Config = {
    endpoint: opts["pbs.endpoint"],
    username: opts["pbs.username"],
    apitoken: opts["pbs.api.token"],
    apitokenname: opts["pbs.api.token.name"],
    timeout: opts["pbs.timeout"],
    insecure: opts["pbs.insecure"],
    metricsPath: opts["pbs.metricsPath"],
    listenAddress: opts["pbs.listenAddress"],
    loglevel: opts["pbs.loglevel"],
    showVersion: opts["version"] === true,
  };

  // Environment variables override defaults/flags.
  if (env.PBS_LOGLEVEL) config.loglevel = env.PBS_LOGLEVEL;
  if (env.PBS_ENDPOINT) config.endpoint = env.PBS_ENDPOINT;

  if (env.PBS_USERNAME) config.username = env.PBS_USERNAME;
  else if (env.PBS_USERNAME_FILE)
    config.username = readSecretFile(env.PBS_USERNAME_FILE);

  if (env.PBS_API_TOKEN_NAME) config.apitokenname = env.PBS_API_TOKEN_NAME;
  else if (env.PBS_API_TOKEN_NAME_FILE)
    config.apitokenname = readSecretFile(env.PBS_API_TOKEN_NAME_FILE);

  if (env.PBS_API_TOKEN) config.apitoken = env.PBS_API_TOKEN;
  else if (env.PBS_API_TOKEN_FILE)
    config.apitoken = readSecretFile(env.PBS_API_TOKEN_FILE);

  if (env.PBS_TIMEOUT) config.timeout = env.PBS_TIMEOUT;
  if (env.PBS_INSECURE) config.insecure = env.PBS_INSECURE;
  if (env.PBS_METRICS_PATH) config.metricsPath = env.PBS_METRICS_PATH;
  if (env.PBS_LISTEN_ADDRESS) config.listenAddress = env.PBS_LISTEN_ADDRESS;

  return config;
}
