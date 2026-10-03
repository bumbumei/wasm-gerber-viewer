import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { densePadGerber } from "../../scripts/generate-memory64-sample.mjs";

// Loads demo/memory64-test-pads-24M.gbr, a layer that really exhausts a wasm32
// parser instead of a simulated failure. It needs a hardware GPU, most of a
// 16 GiB machine's RAM and half a minute, so it only runs on request:
//
//   GERBER_VIEWER_TEST_HEAVY=1 npx playwright test --project=memory64 memory64-heavy

const GIB = 2 ** 30;
const WASM32_BINARY = "/wasm/pkg/wasm_gerber_processor_bg.wasm";
const WASM64_BINARY = "/wasm/pkg64/wasm_gerber_processor_bg.wasm";
const sampleFile = fileURLToPath(
  new URL("../../demo/memory64-test-pads-24M.gbr", import.meta.url),
);
const sample = densePadGerber();

test.use({
  launchOptions: {
    args: [
      // Headless Chromium on Windows only reaches the GPU through ANGLE's D3D11 backend.
      ...(process.platform === "win32" ? ["--use-angle=d3d11"] : []),
      "--enable-gpu",
      "--ignore-gpu-blocklist",
    ],
  },
});

test("the committed sample is what its generator writes", () => {
  // A checkout may have converted the line endings.
  expect(readFileSync(sampleFile, "utf8").replaceAll("\r\n", "\n")).toBe(sample.text);
  expect(sample.pads).toBe(24_025_000);
});

test.describe("loading the sample", () => {
  test.skip(
    process.env.GERBER_VIEWER_TEST_HEAVY !== "1",
    "set GERBER_VIEWER_TEST_HEAVY=1 to load the 24M-pad sample",
  );

  test("a layer too large for wasm32 is parsed by a memory64 worker and picked above 4 GiB", async ({ page }) => {
    test.setTimeout(600_000);
    const binaries = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith("_bg.wasm")) binaries.push(pathname);
    });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-wasm-main", "wasm64");

    // Remember the viewer's processor the next time it draws.
    await page.evaluate(async () => {
      const main = await import("/wasm/pkg64/wasm_gerber_processor.js");
      const prototype = main.GerberProcessor.prototype;
      for (const name of ["render", "render_with_clear_and_blend_modes"]) {
        const original = prototype[name];
        prototype[name] = function remember(...args) {
          window.__viewerProcessor = this;
          return original.apply(this, args);
        };
      }
    });

    await page.locator("#file-input").setInputFiles(sampleFile);
    await expect(page.locator(".gerber-layer-item")).toHaveCount(1, { timeout: 540_000 });
    await expect(page.locator("#loading-modal")).toBeHidden({ timeout: 540_000 });

    // Main instance, the wasm32 worker that failed, the memory64 worker.
    expect(binaries).toEqual([WASM64_BINARY, WASM32_BINARY, WASM64_BINARY]);
    await page.locator('[data-panel-tab="diagnostics"]').click();
    await expect(page.locator("#diagnostic-list")).toContainText(
      "Parsed with the memory64 build after the wasm32 parser ran out of memory",
    );

    await expect.poll(() => page.evaluate(() => Boolean(window.__viewerProcessor))).toBe(true);
    const result = await page.evaluate(async ({ lastPad }) => {
      const main = await import("/wasm/pkg64/wasm_gerber_processor.js");
      const wasm = await main.default();
      const pick = (x, y) => {
        const hit = window.__viewerProcessor.pick_interaction_feature(
          new Uint32Array([0]),
          x,
          y,
          0.001,
        );
        return hit ? { featureId: hit.featureId, aperture: hit.aperture } : null;
      };
      return {
        memoryBytes: wasm.memory.buffer.byteLength,
        lastPad: pick(lastPad.x, lastPad.y),
        // Between two blocks, where nothing is flashed.
        gap: pick(lastPad.x + 0.1, lastPad.y + 0.25),
      };
    }, { lastPad: sample.lastPad });
    expect(result.memoryBytes).toBeGreaterThan(4.5 * GIB);
    expect(result.lastPad).toEqual({ featureId: sample.pads - 1, aperture: "D10" });
    expect(result.gap).toBeNull();
  });
});
