import { describe, expect, it, vi } from "vitest";
import type { ServerResponse } from "node:http";

// Force every asset file read to fail so we can exercise the 500 branch.
// Kept in its own file because the mock applies to the whole module.
vi.mock("node:fs/promises", () => ({
  readFile: () => Promise.reject(new Error("ENOENT")),
}));

import { serveStaticAsset } from "../server.ts";
import { testLogger } from "./pbs.fixtures.ts";

type MockRes = ServerResponse & { statusCode: number; body: unknown };

function mockRes(): MockRes {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader() {},
    end(chunk?: unknown) {
      res.body = chunk;
    },
  };
  return res as unknown as MockRes;
}

describe("serveStaticAsset — read failure", () => {
  it("responds 500 when the asset file cannot be read", async () => {
    const res = mockRes();
    const handled = await serveStaticAsset("/assets/app.js", res, testLogger);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(500);
    expect(String(res.body)).toContain("500");
  });
});
