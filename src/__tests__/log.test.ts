import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import winston from "winston";
import { createLogger } from "../log.ts";

/**
 * Replace the logger's Console transport with one writing to an in-memory
 * stream, so we can assert on the formatted output. The capturing transport
 * still goes through the logger's format (incl. the CR/LF stripping).
 */
function capture(log: ReturnType<typeof createLogger>): string[] {
  const lines: string[] = [];
  log.clear();
  log.add(
    new winston.transports.Stream({
      stream: new Writable({
        write(chunk, _encoding, callback) {
          lines.push(String(chunk));
          callback();
        },
      }),
    }),
  );
  return lines;
}

describe("createLogger", () => {
  it("returns a logger at the requested level", () => {
    expect(createLogger("debug", "text").level).toBe("debug");
    expect(createLogger("warn", "json").level).toBe("warn");
  });

  it("strips CR/LF from messages (log-injection guard)", () => {
    const log = createLogger("info", "json");
    const lines = capture(log);

    log.info("a\nb\r\nc");

    const out = lines.join("");
    // The injected newlines are gone; the message survives as a single token.
    expect(out).toContain("abc");
    expect(out).not.toContain("a\nb");
  });
});
