/**
 * Logging via winston.
 *
 * Exposes a single factory, {@link createLogger}, returning a configured winston
 * logger. The `text` format (default) emits `LEVEL: message` lines; the `json`
 * format emits one JSON object per entry for log aggregators (ELK etc.). Output
 * goes to stdout — except `error`, which goes to stderr.
 *
 * Log injection is handled centrally: a format step strips CR/LF from every
 * message, so callers never need to sanitize user-controlled values themselves.
 */

import winston from "winston";
import type { LogFormat } from "./config.ts";

// Strip CR/LF from every message to prevent log injection from user-controlled
// values (resolved targets, error text, …). Applied to both output formats.
const stripNewlines = winston.format((info) => {
  if (typeof info.message === "string") {
    info.message = info.message.replaceAll(/[\n\r]/g, "");
  }
  return info;
});

// Human-readable: "LEVEL: message".
const textFormat = winston.format.combine(
  stripNewlines(),
  winston.format.printf(
    (info) => `${info.level.toUpperCase()}: ${String(info.message)}`,
  ),
);

// Single-line JSON with a timestamp, e.g. for ELK / log aggregators.
const jsonFormat = winston.format.combine(
  stripNewlines(),
  winston.format.timestamp(),
  winston.format.json(),
);

/** Create a winston logger at the given level and output format. */
export function createLogger(level: string, format: LogFormat): winston.Logger {
  return winston.createLogger({
    level,
    levels: winston.config.npm.levels,
    format: format === "json" ? jsonFormat : textFormat,
    transports: [new winston.transports.Console({ stderrLevels: ["error"] })],
  });
}
