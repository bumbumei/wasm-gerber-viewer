import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

// The viewer mixes two builds of the WASM package: wasm/pkg (wasm32) and
// wasm/pkg64 (memory64). These specs need both; build the second one with
// scripts/build-wasm64.sh.

const demoFile = (name) => fileURLToPath(new URL(`../../demo/${name}`, import.meta.url));
const demoFiles = [
  demoFile("gerber-feature-test.gbr"),
  demoFile("performance-test-region-72K.gbr"),
  demoFile("performance-test-stars-10K.gbr"),
];
const GIB = 2 ** 30;
const WASM32_BINARY = "/wasm/pkg/wasm_gerber_processor_bg.wasm";
const WASM64_BINARY = "/wasm/pkg64/wasm_gerber_processor_bg.wasm";
const WASM32_GLUE = "**/wasm/pkg/wasm_gerber_processor.js";

// One 8 mm pad in the middle of a 40 x 30 mm outline, so the centre of the
// fitted view is always on the pad.
const padSource = (marker = "") => `%FSLAX24Y24*%
%MOMM*%
G04 ${marker}*
%ADD10C,8.000*%
%ADD11C,0.200*%
D11*
X-200000Y-150000D02*
X200000D01*
Y150000D01*
X-200000D01*
Y-150000D01*
D10*
X000000Y000000D03*
M02*`;

// About 22,000 small pads on the same board that leave its middle free: enough
// picking data that it cannot hide in the gaps of a nearly empty heap.
function padGridSource(columns = 180, rows = 130) {
  const lines = ["%FSLAX24Y24*%", "%MOMM*%", "%ADD12C,0.100*%", "D12*"];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = -18 + (36 * column) / (columns - 1);
      const y = -13 + (26 * row) / (rows - 1);
      if (Math.abs(x) < 6 && Math.abs(y) < 6) continue;
      lines.push(`X${Math.round(x * 10000)}Y${Math.round(y * 10000)}D03*`);
    }
  }
  lines.push("M02*");
  return lines.join("\n");
}

const gerber = (name, source) => ({
  name,
  mimeType: "text/plain",
  buffer: Buffer.from(source),
});

function watchPage(page) {
  const watched = { errors: [], binaries: [] };
  page.on("pageerror", (error) => watched.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") watched.errors.push(message.text());
  });
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.endsWith("_bg.wasm")) watched.binaries.push(pathname);
  });
  return watched;
}

async function loadFiles(page, files, layerCount = files.length) {
  await page.locator("#file-input").setInputFiles(files);
  await expect(page.locator("#loading-modal")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator(".gerber-layer-item, .drill-layer-item")).toHaveCount(layerCount);
}

async function layerSummary(page) {
  const texts = await page.locator(".gerber-layer-item, .drill-layer-item").allInnerTexts();
  return texts.map((text) => text.replace(/\s+/g, " ").trim());
}

async function canvasPixels(page) {
  // Two frames so the fitted view has been drawn before the capture.
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.locator("#gerber-canvas").screenshot();
}

async function expectBuilds(page, main, worker) {
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-wasm-main", main);
  await expect(root).toHaveAttribute("data-wasm-worker", worker);
}

async function diagnosticsText(page) {
  await page.locator('[data-panel-tab="diagnostics"]').click();
  return page.locator("#diagnostic-list").innerText();
}

// Hides memory64 from the page the way a browser without it would: the
// viewer's feature probe is the only module it validates.
async function hideMemory64(page) {
  await page.addInitScript(() => {
    WebAssembly.validate = () => false;
  });
}

async function loadAndCapture(page, query, files = demoFiles) {
  const watched = watchPage(page);
  await page.goto(`/${query}`);
  await loadFiles(page, files);
  return {
    watched,
    layers: await layerSummary(page),
    pixels: await canvasPixels(page),
  };
}

test("a memory64 browser runs the main instance on memory64 and parses in wasm32 workers", async ({ page }) => {
  const { watched } = await loadAndCapture(page, "");
  await expectBuilds(page, "wasm64", "wasm32");

  // The main instance is the first to load its binary; every worker after it
  // loads the wasm32 one.
  expect(watched.binaries[0]).toBe(WASM64_BINARY);
  expect(watched.binaries.length).toBeGreaterThan(1);
  expect(watched.binaries.slice(1).every((path) => path === WASM32_BINARY)).toBe(true);
  expect(await page.evaluate(async () => {
    const main = await import("/wasm/pkg64/wasm_gerber_processor.js");
    return main.memory_address_bits();
  })).toBe(64);
  expect(watched.errors).toEqual([]);
});

test("?wasm=32 and ?wasm=64 pin every instance to one build", async ({ browser }) => {
  for (const [query, variant, binary] of [
    ["?wasm=32", "wasm32", WASM32_BINARY],
    ["?wasm=64", "wasm64", WASM64_BINARY],
  ]) {
    const page = await browser.newPage();
    const { watched } = await loadAndCapture(page, query);
    await expectBuilds(page, variant, variant);
    expect(watched.binaries.length).toBeGreaterThan(1);
    expect(watched.binaries.every((path) => path === binary)).toBe(true);
    expect(watched.errors).toEqual([]);
    await page.close();
  }
});

test("wasm32, memory64 and the mixed setup draw the same pixels", async ({ browser }) => {
  const captures = [];
  for (const query of ["?wasm=32", "?wasm=64", ""]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const capture = await loadAndCapture(page, query);
    expect(capture.watched.errors).toEqual([]);
    captures.push(capture);
    await page.close();
  }
  const [wasm32, wasm64, mixed] = captures;
  expect(wasm64.layers).toEqual(wasm32.layers);
  expect(mixed.layers).toEqual(wasm32.layers);
  expect(wasm64.pixels.equals(wasm32.pixels)).toBe(true);
  expect(mixed.pixels.equals(wasm32.pixels)).toBe(true);
});

test("a single file and a drill job still parse Gerber layers in a wasm32 worker", async ({ browser }) => {
  for (const files of [
    [demoFile("performance-test-stars-10K.gbr")],
    [demoFile("gerber-feature-test.gbr"), demoFile("smoke-test.drl")],
  ]) {
    const mixedPage = await browser.newPage();
    const mixed = await loadAndCapture(mixedPage, "", files);
    await expectBuilds(mixedPage, "wasm64", "wasm32");
    // The main instance never parses these layers itself: one worker does.
    expect(mixed.watched.binaries).toEqual([WASM64_BINARY, WASM32_BINARY]);
    expect(mixed.watched.errors).toEqual([]);

    const wasm32Page = await browser.newPage();
    const wasm32 = await loadAndCapture(wasm32Page, "?wasm=32", files);
    // wasm32 keeps parsing them on the main instance, without a worker.
    expect(wasm32.watched.binaries).toEqual([WASM32_BINARY]);
    expect(mixed.layers).toEqual(wasm32.layers);
    expect(mixed.pixels.equals(wasm32.pixels)).toBe(true);
    await mixedPage.close();
    await wasm32Page.close();
  }
});

test("a browser without memory64 runs wasm32 only and never requests the memory64 package", async ({ browser }) => {
  const reference = await browser.newPage();
  const wasm32 = await loadAndCapture(reference, "?wasm=32");

  const page = await browser.newPage();
  await hideMemory64(page);
  const fallback = await loadAndCapture(page, "");
  await expectBuilds(page, "wasm32", "wasm32");
  expect(fallback.watched.binaries.every((path) => path === WASM32_BINARY)).toBe(true);
  expect(fallback.watched.binaries).toEqual(wasm32.watched.binaries);
  expect(fallback.layers).toEqual(wasm32.layers);
  expect(fallback.pixels.equals(wasm32.pixels)).toBe(true);
  expect(fallback.watched.errors).toEqual([]);
  await expect(page.locator("#diagnostics-count")).toHaveText("0");
});

test("?wasm=64 without memory64 falls back to wasm32 and says so", async ({ page }) => {
  await hideMemory64(page);
  const { watched } = await loadAndCapture(page, "?wasm=64");
  await expectBuilds(page, "wasm32", "wasm32");
  expect(watched.binaries.every((path) => path === WASM32_BINARY)).toBe(true);
  expect(await diagnosticsText(page)).toContain("memory64 unavailable");
});

test("a deployment without wasm/pkg64 falls back to wasm32", async ({ page }) => {
  await page.route("**/wasm/pkg64/**", (route) => route.fulfill({ status: 404, body: "Not found" }));
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await expectBuilds(page, "wasm32", "wasm32");
  await loadFiles(page, demoFiles);
  expect(pageErrors).toEqual([]);
  await expect(page.locator("#diagnostics-count")).toHaveText("0");
});

test("the memory64 main instance picks features stored above 4 GiB", async ({ page }) => {
  test.setTimeout(180_000);
  const watched = watchPage(page);
  await page.goto("/");
  await expectBuilds(page, "wasm64", "wasm32");

  // Pin 4.25 GiB of the main heap. The block is never freed, so the picking
  // data built afterwards can only live above the 32-bit address range.
  const pinned = await page.evaluate(async (bytes) => {
    const main = await import("/wasm/pkg64/wasm_gerber_processor.js");
    const wasm = await main.default();
    const pointer = wasm.__wbindgen_malloc(bytes, 1);
    return { pointer, memoryBytes: wasm.memory.buffer.byteLength };
  }, 4.25 * GIB);
  expect(pinned.pointer).toBeGreaterThan(0);
  expect(pinned.memoryBytes).toBeGreaterThan(4.25 * GIB);

  await loadFiles(page, [
    gerber("grid.gbl", padGridSource()),
    gerber("pad.gtl", padSource()),
  ]);
  const afterLoad = await page.evaluate(async () => {
    const main = await import("/wasm/pkg64/wasm_gerber_processor.js");
    return (await main.default()).memory.buffer.byteLength;
  });
  // The picking index did not fit below the pinned block.
  expect(afterLoad).toBeGreaterThan(pinned.memoryBytes);

  const box = await page.locator("#gerber-canvas").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#bounds-readout")).toContainText("pad.gtl");
  await expect(page.locator("#bounds-readout")).toContainText("D10");
  expect(watched.errors).toEqual([]);
  await expect(page.locator("#diagnostics-count")).toHaveText("0");
});

test("the wasm32 main instance still refuses layers once its memory is nearly full", async ({ page }) => {
  await page.goto("/?wasm=32");
  await expectBuilds(page, "wasm32", "wasm32");
  await page.evaluate(async () => {
    const main = await import("/wasm/pkg/wasm_gerber_processor.js");
    const { memory } = await main.default();
    const targetPages = (3600 * 2 ** 20) / 65536;
    memory.grow(targetPages - memory.buffer.byteLength / 65536);
  });
  await page.locator("#file-input").setInputFiles([
    gerber("first.gtl", padSource()),
    gerber("second.gbl", padSource()),
  ]);
  await expect(page.locator("#loading-modal")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator(".gerber-layer-item")).toHaveCount(0);
  expect(await diagnosticsText(page)).toContain("WASM memory limit reached");
});

// Serves the wasm32 glue to the workers with a parser that fails the way an
// exhausted wasm32 instance does for sources carrying a marker comment.
async function failWasm32Parser(page) {
  await page.route(WASM32_GLUE, (route) => {
    if (new URL(route.request().url()).searchParams.has("real")) {
      return route.continue();
    }
    return route.fulfill({
      contentType: "text/javascript",
      body: `
        import init, * as real from "/wasm/pkg/wasm_gerber_processor.js?real";
        export * from "/wasm/pkg/wasm_gerber_processor.js?real";
        export default init;
        function fail(content) {
          if (content.includes("WASM32-OUT-OF-MEMORY")) {
            throw new Error(
              "Gerber layer is too large to parse: not enough memory for primitives (forced)",
            );
          }
          if (content.includes("WASM32-TRAP")) {
            throw new WebAssembly.RuntimeError("unreachable (forced)");
          }
          if (content.includes("WASM32-ITEM-LIMIT")) {
            throw new Error(
              "Gerber generated geometry exceeds the supported limit of 60000000 items while processing flash (forced)",
            );
          }
        }
        export function parse_gerber_layer_payload_with_options(content, ...rest) {
          fail(content);
          return real.parse_gerber_layer_payload_with_options(content, ...rest);
        }
        export function parse_gerber_layer_with_options(content, a, b, c, d) {
          fail(content);
          return real.parse_gerber_layer_with_options(content, a, b, c, d);
        }
        export function parse_gerber_layer(content, a, b) {
          fail(content);
          return real.parse_gerber_layer(content, a, b);
        }
      `,
    });
  });
}

test("a layer the wasm32 worker runs out of memory on is parsed again by a memory64 worker", async ({ browser }) => {
  const reference = await browser.newPage();
  const files = [
    gerber("exhausted.gtl", padSource("WASM32-OUT-OF-MEMORY")),
    gerber("trapped.gbl", padSource("WASM32-TRAP")),
    gerber("over-limit.gto", padSource("WASM32-ITEM-LIMIT")),
    gerber("ordinary.gbo", padSource("ordinary")),
  ];
  const expected = await loadAndCapture(reference, "", files);
  expect(expected.watched.binaries.filter((path) => path === WASM64_BINARY)).toHaveLength(1);

  const page = await browser.newPage();
  await failWasm32Parser(page);
  const retried = await loadAndCapture(page, "", files);
  await expectBuilds(page, "wasm64", "wasm32");

  // Main instance plus one memory64 worker per failed layer; the ordinary
  // layer stayed on wasm32.
  expect(retried.watched.binaries.filter((path) => path === WASM64_BINARY)).toHaveLength(4);
  expect(retried.layers).toEqual(expected.layers);
  expect(retried.pixels.equals(expected.pixels)).toBe(true);

  const diagnostics = await diagnosticsText(page);
  for (const name of ["exhausted.gtl", "trapped.gbl", "over-limit.gto"]) {
    expect(diagnostics).toContain(name);
  }
  expect(diagnostics).not.toContain("ordinary.gbo");
  expect(diagnostics).toContain("Parsed with the memory64 build");
  await expect(page.locator("#diagnostics-count")).toHaveText("3");

  // The re-parsed layers carry picking data like any other layer.
  const box = await page.locator("#gerber-canvas").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#bounds-readout")).toContainText("D10");
});

test("the memory64 retry also covers the single-worker path that drill files force", async ({ page }) => {
  await failWasm32Parser(page);
  const { watched } = await loadAndCapture(page, "", [
    gerber("exhausted.gtl", padSource("WASM32-OUT-OF-MEMORY")),
    {
      name: "smoke-test.drl",
      mimeType: "text/plain",
      buffer: readFileSync(demoFile("smoke-test.drl")),
    },
  ]);
  expect(watched.binaries).toEqual([WASM64_BINARY, WASM32_BINARY, WASM64_BINARY]);
  expect(await diagnosticsText(page)).toContain("Parsed with the memory64 build");
});

test("errors that more memory cannot fix are not retried on memory64", async ({ page }) => {
  const watched = watchPage(page);
  await page.goto("/");
  await page.locator("#file-input").setInputFiles([
    gerber("empty.gtl", "%FSLAX24Y24*%\n%MOMM*%\nM02*"),
    gerber("pad.gbl", padSource()),
  ]);
  await expect(page.locator("#loading-modal")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator(".gerber-layer-item")).toHaveCount(1);
  expect(watched.binaries.filter((path) => path === WASM64_BINARY)).toHaveLength(1);
  expect(await diagnosticsText(page)).toContain("no geometry found");
});

test("a layer that fails on both builds reports both failures", async ({ page }) => {
  await failWasm32Parser(page);
  await page.goto("/");
  await page.locator("#file-input").setInputFiles([
    gerber("broken.gtl", "%FSLAX24Y24*%\n%MOMM*%\nG04 WASM32-OUT-OF-MEMORY*\nM02*"),
    gerber("pad.gbl", padSource()),
  ]);
  await expect(page.locator("#loading-modal")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator(".gerber-layer-item")).toHaveCount(1);
  const diagnostics = await diagnosticsText(page);
  expect(diagnostics).toContain("no geometry found");
  expect(diagnostics).toContain("wasm64 retry after wasm32 failed");
});

test("with every instance on wasm32 a memory failure is final", async ({ page }) => {
  await failWasm32Parser(page);
  const watched = watchPage(page);
  await page.goto("/?wasm=32");
  await page.locator("#file-input").setInputFiles([
    gerber("exhausted.gtl", padSource("WASM32-OUT-OF-MEMORY")),
    gerber("pad.gbl", padSource()),
  ]);
  await expect(page.locator("#loading-modal")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator(".gerber-layer-item")).toHaveCount(1);
  expect(watched.binaries.every((path) => path === WASM32_BINARY)).toBe(true);
  expect(await diagnosticsText(page)).toContain("not enough memory");
});
