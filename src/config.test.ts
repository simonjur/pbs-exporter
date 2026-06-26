import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Config,
  loadConfig,
  parseBool,
  readSecretFile,
  validateTarget,
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
      apiToken: "",
      apiTokenName: "pbs-exporter",
      timeout: 5000,
      insecure: "false",
      metricsPath: "/metrics",
      listenAddress: ":10019",
      loglevel: "info",
      logformat: "text",
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
    expect(c.apiTokenName).toBe("mytoken");
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
    expect(c.apiToken).toBe("file-token");
    expect(c.username).toBe("file-user");
    expect(c.apiTokenName).toBe("file-token-name");
  });

  it("prefers the direct env var over its *_FILE counterpart", () => {
    const c = loadConfig(argv(), {
      PBS_API_TOKEN: "direct-token",
      PBS_API_TOKEN_FILE: secretFile("file-token"),
    });
    expect(c.apiToken).toBe("direct-token");
  });

  it("parses the timeout duration into milliseconds", () => {
    expect(loadConfig(argv("--pbs.timeout=1m30s"), noEnv).timeout).toBe(90000);
    expect(loadConfig(argv(), { PBS_TIMEOUT: "250ms" }).timeout).toBe(250);
  });

  it("throws on an invalid timeout duration", () => {
    expect(() => loadConfig(argv(), { PBS_TIMEOUT: "nonsense" })).toThrow(
      /invalid duration/,
    );
  });

  it("reads the log format from flag and env", () => {
    expect(loadConfig(argv("--pbs.logformat=json"), noEnv).logformat).toBe(
      "json",
    );
    expect(loadConfig(argv(), { PBS_LOGFORMAT: "json" }).logformat).toBe(
      "json",
    );
    // Env overrides flag.
    expect(
      loadConfig(argv("--pbs.logformat=json"), { PBS_LOGFORMAT: "text" })
        .logformat,
    ).toBe("text");
  });

  it("throws on an invalid log format", () => {
    expect(() => loadConfig(argv(), { PBS_LOGFORMAT: "xml" })).toThrow(
      /invalid log format/,
    );
  });

  it("validates a configured endpoint scheme (SSRF guard)", () => {
    expect(
      loadConfig(argv(), { PBS_ENDPOINT: "https://pbs:8007" }).endpoint,
    ).toBe("https://pbs:8007");
    expect(() =>
      loadConfig(argv(), { PBS_ENDPOINT: "file:///etc/passwd" }),
    ).toThrow(/disallowed target URL scheme/);
    expect(() => loadConfig(argv(), { PBS_ENDPOINT: "not-a-url" })).toThrow(
      /invalid target URL/,
    );
  });

  it("leaves an empty endpoint unvalidated (dynamic target mode)", () => {
    expect(loadConfig(argv(), noEnv).endpoint).toBe("");
  });
});

describe("validateTarget", () => {
  it.each([
    "http://localhost:8007",
    "https://192.168.1.164:8007",
    "https://pbs.example.com",
  ])("accepts http(s) URL %j", (url) => {
    expect(validateTarget(url)).toBe(url);
  });

  it.each([
    "file:///etc/passwd",
    "gopher://x",
    "ftp://h/f",
    "data:text/plain,x",
  ])("rejects disallowed scheme %j", (url) => {
    expect(() => validateTarget(url)).toThrow(/disallowed target URL scheme/);
  });

  it.each(["", "not-a-url", "//no-scheme"])(
    "rejects unparseable URL %j",
    (url) => {
      expect(() => validateTarget(url)).toThrow(/invalid target URL/);
    },
  );
});
