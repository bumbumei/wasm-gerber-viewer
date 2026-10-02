import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

const testServerPort = Number(process.env.GERBER_VIEWER_TEST_PORT ?? 4173);
const serverUrl = (offset) => `http://127.0.0.1:${testServerPort + offset}`;
const memory64Specs = /memory64.*\.spec\.mjs$/;
// The memory64 specs need the second build from scripts/build-wasm64.sh.
const hasMemory64Package = existsSync(
  new URL("./wasm/pkg64/wasm_gerber_processor.js", import.meta.url),
);
// Opt-in: the specs written for wasm32 run again with the memory64 binary
// served in place of wasm/pkg.
const runSpecsOnMemory64Binary =
  hasMemory64Package && process.env.GERBER_VIEWER_TEST_MEMORY64_BINARY === "1";

function testServer(offset, env = {}) {
  return {
    command: "node scripts/static-server.mjs",
    url: serverUrl(offset),
    env: { GERBER_VIEWER_TEST_PORT: String(testServerPort + offset), ...env },
    reuseExistingServer: true,
    timeout: 30_000,
  };
}

export default defineConfig({
  testDir: "./tests/playwright",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
  projects: [
    {
      // The viewer as browsers without memory64 run it: wasm32 everywhere.
      name: "wasm32",
      testIgnore: memory64Specs,
      use: { baseURL: serverUrl(0) },
    },
    ...(hasMemory64Package
      ? [
          {
            // Build selection, the mixed setup and the memory64 retry.
            name: "memory64",
            testMatch: memory64Specs,
            use: { baseURL: serverUrl(1) },
          },
        ]
      : []),
    ...(runSpecsOnMemory64Binary
      ? [
          {
            name: "memory64-binary",
            testIgnore: memory64Specs,
            use: { baseURL: serverUrl(2) },
          },
        ]
      : []),
  ],
  webServer: [
    testServer(0, { GERBER_VIEWER_TEST_WASM: "32" }),
    ...(hasMemory64Package ? [testServer(1)] : []),
    ...(runSpecsOnMemory64Binary
      ? [
          testServer(2, {
            GERBER_VIEWER_TEST_WASM: "32",
            GERBER_VIEWER_TEST_WASM_PKG_DIR: "pkg64",
          }),
        ]
      : []),
  ],
});
