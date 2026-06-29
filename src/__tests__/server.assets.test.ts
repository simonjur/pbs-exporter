import { describe, expect, it, vi } from "vitest";
import type { ServerResponse } from "node:http";

// Force every asset file read to fail so we can exercise the 500 branch.
// Kept in its own file because the mock applies to the whole module.
vi.mock("node:fs/promises", () => ({
  readFile: () => Promise.reject(new Error("ENOENT")),
}));

import { serveStaticAsset } from "../server.ts";
import { testLogger } from "./pbs.fixtures.ts";

type MockResponse = ServerResponse & { statusCode: number; body: unknown };

function mockResponse(): MockResponse {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader() {},
    end(chunk?: unknown) {
      response.body = chunk;
    },
  };
  return response as unknown as MockResponse;
}

describe("serveStaticAsset — read failure", () => {
  it("responds 500 when the asset file cannot be read", async () => {
    const response = mockResponse();
    const handled = await serveStaticAsset(
      "/assets/app.js",
      response,
      testLogger,
    );

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(500);
    expect(String(response.body)).toContain("500");
  });
});
