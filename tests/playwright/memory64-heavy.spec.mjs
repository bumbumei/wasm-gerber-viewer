import { expect, test } from "@playwright/test";

// Loads a layer that really exhausts a wasm32 parser instead of a simulated
// failure. It needs about 10 GiB of free RAM, a hardware GPU and half a
// minute, so it only runs on request:
//
//   GERBER_VIEWER_TEST_HEAVY=1 npx playwright test --project=memory64 memory64-heavy

const GIB = 2 ** 30;
const WASM32_BINARY = "/wasm/pkg/wasm_gerber_processor_bg.wasm";
const WASM64_BINARY = "/wasm/pkg64/wasm_gerber_processor_bg.wasm";
const BLOCK_PADS = 1000;
const COLUMNS = 142;
const ROWS = 141;

// A 40 x 25 block of 10 um pads stepped over a 142 x 141 grid: 20,022,000
// flashes from a 20 KiB file.
function densePadSource() {
  const lines = [
    "%FSLAX34Y34*%",
    "%MOMM*%",
    "%ADD10C,0.010*%",
    `%SRX${COLUMNS}Y${ROWS}I1.0J1.0*%`,
    "D10*",
  ];
  for (let pad = 0; pad < BLOCK_PADS; pad += 1) {
    const x = Math.round((pad % 40) * 0.02 * 1e4);
    const y = Math.round(Math.floor(pad / 40) * 0.02 * 1e4);
    lines.push(`X${x}Y${y}D03*`);
  }
  lines.push("%SR*%", "M02*");
  return lines.join("\n");
}

test.skip(
  process.env.GERBER_VIEWER_TEST_HEAVY !== "1",
  "set GERBER_VIEWER_TEST_HEAVY=1 to run the 20M-flash load",
);
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

  await page.locator("#file-input").setInputFiles({
    name: "dense-pads.gtl",
    mimeType: "text/plain",
    buffer: Buffer.from(densePadSource()),
  });
  await expect(page.locator(".gerber-layer-item")).toHaveCount(1, { timeout: 540_000 });
  await expect(page.locator("#loading-modal")).toBeHidden({ timeout: 540_000 });

  // Main instance, the wasm32 worker that failed, the memory64 worker.
  expect(binaries).toEqual([WASM64_BINARY, WASM32_BINARY, WASM64_BINARY]);
  await page.locator('[data-panel-tab="diagnostics"]').click();
  await expect(page.locator("#diagnostic-list")).toContainText(
    "Parsed with the memory64 build after the wasm32 parser ran out of memory",
  );

  await expect.poll(() => page.evaluate(() => Boolean(window.__viewerProcessor))).toBe(true);
  const result = await page.evaluate(async () => {
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
      lastPad: pick(141.78, 140.48),
      gap: pick(70.9, 70.9),
    };
  });
  expect(result.memoryBytes).toBeGreaterThan(4 * GIB);
  expect(result.lastPad).toEqual({
    featureId: COLUMNS * ROWS * BLOCK_PADS - 1,
    aperture: "D10",
  });
  expect(result.gap).toBeNull();
});
