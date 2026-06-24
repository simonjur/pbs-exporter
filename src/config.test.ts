import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Config,
  loadConfig,
  parseBool,
  readSecretFile,
} from "./config.ts";

/** Build a process-style argv ("node", "script", ...flags) for loadConfig. */
function argv(...flags: string[]): string[] {
  return ["node", "main.ts", ...flags];
}

// Temp files created during tests, cleaned up afterwards.
const tmpFiles: string[] = [];
function secretFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pbs-exporter-test-"));
  const path = join(dir, "secret");
  writeFileSync(path, contents);
  tmpFiles.push(dir);
  return path;
}

afterEach(() => {
  while (tmpFiles.length)
    rmSync(tmpFiles.pop()!, { recursive: true, force: true });
});

describe("parseBool", () => {
  it.each([
    ["true", true],
    ["TRUE", true],
    ["t", true],
    ["1", true],
    ["false", false],
    ["F", false],
    ["0", false],
  ])("parses %j -> %s", (input, expected) => {
    expect(parseBool(input)).toBe(expected);
  });

  it.each(["", "yes", "no", "2"])("throws on invalid boolean %j", (input) => {
    expect(() => parseBool(input)).toThrow(/invalid boolean/);
  });
});

describe("readSecretFile", () => {
  it("returns only the first line", () => {
    expect(readSecretFile(secretFile("topsecret\nsecondline\n"))).toBe(
      "topsecret",
    );
  });

  it("handles a file without a trailing newline", () => {
    expect(readSecretFile(secretFile("just-one-line"))).toBe("just-one-line");
  });

  it("handles CRLF line endings", () => {
    expect(readSecretFile(secretFile("windows\r\nline"))).toBe("windows");
  });
});

describe("loadConfig", () => {
  const noEnv: NodeJS.ProcessEnv = {};

  it("applies built-in defaults with no flags or env", () => {
    const c = loadConfig(argv(), noEnv);
    expect(c).toEqual<Config>({
      endpoint: "",
      username: "root@pam",
      apitoken: "",
      apitokenname: "pbs-exporter",
      timeout: "5s",
      insecure: "false",
      metricsPath: "/metrics",
      listenAddress: ":10019",
      loglevel: "info",
      showVersion: false,
    });
  });

  it("reads flags (space form)", () => {
    const c = loadConfig(
      argv("--pbs.endpoint", "https://pbs:8007", "--pbs.metrics-path", "/m"),
      noEnv,
    );
    expect(c.endpoint).toBe("https://pbs:8007");
    expect(c.metricsPath).toBe("/m");
  });

  it("reads flags (= form) including dotted and hyphenated names", () => {
    const c = loadConfig(
      argv("--pbs.api.token.name=mytoken", "--pbs.listen-address=:9999"),
      noEnv,
    );
    expect(c.apitokenname).toBe("mytoken");
    expect(c.listenAddress).toBe(":9999");
  });

  it("sets showVersion when --version is passed", () => {
    expect(loadConfig(argv("--version"), noEnv).showVersion).toBe(true);
    expect(loadConfig(argv(), noEnv).showVersion).toBe(false);
  });

  it("lets environment variables override flags", () => {
    const c = loadConfig(
      argv("--pbs.metrics-path=/flag", "--pbs.endpoint=http://flag"),
      {
        PBS_METRICS_PATH: "/env",
        PBS_ENDPOINT: "http://env",
      },
    );
    expect(c.metricsPath).toBe("/env");
    expect(c.endpoint).toBe("http://env");
  });

  it("reads secrets from *_FILE env vars when the direct var is unset", () => {
    const c = loadConfig(argv(), {
      PBS_API_TOKEN_FILE: secretFile("file-token\nignored"),
      PBS_USERNAME_FILE: secretFile("file-user"),
      PBS_API_TOKEN_NAME_FILE: secretFile("file-token-name"),
    });
    expect(c.apitoken).toBe("file-token");
    expect(c.username).toBe("file-user");
    expect(c.apitokenname).toBe("file-token-name");
  });

  it("prefers the direct env var over its *_FILE counterpart", () => {
    const c = loadConfig(argv(), {
      PBS_API_TOKEN: "direct-token",
      PBS_API_TOKEN_FILE: secretFile("file-token"),
    });
    expect(c.apitoken).toBe("direct-token");
  });
});
