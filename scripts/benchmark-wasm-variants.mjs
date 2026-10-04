// Compares the three ways the viewer can combine its WASM builds:
//   wasm32  (?wasm=32)  every instance on wasm/pkg
//   wasm64  (?wasm=64)  every instance on wasm/pkg64 (memory64)
//   mixed   (default)   memory64 main instance, wasm32 parse workers
//
// It loads generated Gerber layers through the real viewer page and reports
// load time, per-layer worker time, main-thread time, memory and the time to
// draw the loaded scene, then times the parser, the main-instance add_layer
// path and a frame directly on each build. Run it on a hardware GPU; headless
// Chromium defaults to SwiftShader.
//
//   node scripts/benchmark-wasm-variants.mjs
//
// Environment:
//   WASM_BENCHMARK_ROUNDS    viewer loads per configuration (default 5)
//   WASM_BENCHMARK_CONFIGURATIONS  subset to load, e.g. "wasm32,mixed"
//   WASM_BENCHMARK_BASELINE_DIR  checkout of another version (with wasm/pkg
//                            built), such as main, to measure as "baseline"
//   WASM_BENCHMARK_SCALE     multiplies the generated layer sizes (default 1)
//   WASM_BENCHMARK_PORT      static server port (default 4186)
//   WASM_BENCHMARK_CHANNEL   Playwright browser channel (default bundled Chromium)
//   WASM_BENCHMARK_ALLOW_SOFTWARE=1  do not fail on a software renderer
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";

import { classifyWebGlRenderer } from "./webgl-renderer-classification.mjs";

const port = Number(process.env.WASM_BENCHMARK_PORT ?? 4186);
const rounds = Number(process.env.WASM_BENCHMARK_ROUNDS ?? 5);
const scale = Number(process.env.WASM_BENCHMARK_SCALE ?? 1);
const channel = process.env.WASM_BENCHMARK_CHANNEL;
const allowSoftware = process.env.WASM_BENCHMARK_ALLOW_SOFTWARE === "1";
const baseUrl = `http://127.0.0.1:${port}`;
const baselineDir = process.env.WASM_BENCHMARK_BASELINE_DIR;
const baselineUrl = `http://127.0.0.1:${port + 1}`;
const selectedConfigurations = (process.env.WASM_BENCHMARK_CONFIGURATIONS ?? "")
  .split(",")
  .filter(Boolean);
// A baseline checkout may have a single wasm32 build and no ?wasm= parameter.
const CONFIGURATIONS = [
  ...(baselineDir ? [{ name: "baseline", base: baselineUrl, query: "", baseline: true }] : []),
  { name: "wasm32", base: baseUrl, query: "?wasm=32" },
  { name: "wasm64", base: baseUrl, query: "?wasm=64" },
  { name: "mixed", base: baseUrl, query: "" },
].filter(
  ({ name }) => selectedConfigurations.length === 0 || selectedConfigurations.includes(name),
);
const BUILDS = [
  ...(baselineDir ? [{ name: "baseline", base: baselineUrl, dir: "pkg" }] : []),
  { name: "wasm32", base: baseUrl, dir: "pkg" },
  { name: "wasm64", base: baseUrl, dir: "pkg64" },
];

// --- Generated layers -------------------------------------------------------

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const coordinate = (mm) => String(Math.round(mm * 1e4));
const HEADER = ["%FSLAX34Y34*%", "%MOMM*%"];

function flashLayer(count) {
  const random = seededRandom(1);
  const lines = [...HEADER, "%ADD10C,0.250*%", "%ADD11R,0.300X0.180*%", "%ADD12O,0.400X0.200*%"];
  for (let index = 0; index < count; index += 1) {
    if (index % 5000 === 0) lines.push(`D${10 + ((index / 5000) % 3)}*`);
    lines.push(`X${coordinate(random() * 300)}Y${coordinate(random() * 200)}D03*`);
  }
  lines.push("M02*");
  return lines.join("\n");
}

function trackLayer(count) {
  const random = seededRandom(2);
  const lines = [...HEADER, "%ADD10C,0.120*%", "D10*", "G01*"];
  let x = 150;
  let y = 100;
  lines.push(`X${coordinate(x)}Y${coordinate(y)}D02*`);
  for (let index = 0; index < count; index += 1) {
    if (index % 40 === 0) {
      x = random() * 300;
      y = random() * 200;
      lines.push(`X${coordinate(x)}Y${coordinate(y)}D02*`);
    }
    x = Math.min(300, Math.max(0, x + (random() - 0.5) * 2));
    y = Math.min(200, Math.max(0, y + (random() - 0.5) * 2));
    lines.push(`X${coordinate(x)}Y${coordinate(y)}D01*`);
  }
  lines.push("M02*");
  return lines.join("\n");
}

function regionLayer(count, vertices = 40) {
  const random = seededRandom(3);
  const lines = [...HEADER, "%ADD10C,0.100*%", "D10*", "G01*"];
  for (let index = 0; index < count; index += 1) {
    const centerX = 1 + random() * 298;
    const centerY = 1 + random() * 198;
    lines.push("G36*");
    for (let vertex = 0; vertex <= vertices; vertex += 1) {
      const angle = (2 * Math.PI * (vertex % vertices)) / vertices;
      // A star-like outline so the triangulation has concave corners to solve.
      const radius = vertex % 2 === 0 ? 0.6 : 0.3;
      const point = `X${coordinate(centerX + radius * Math.cos(angle))}Y${coordinate(centerY + radius * Math.sin(angle))}`;
      lines.push(`${point}${vertex === 0 ? "D02" : "D01"}*`);
    }
    lines.push("G37*");
  }
  lines.push("M02*");
  return lines.join("\n");
}

const drillLayer = () =>
  ["M48", "METRIC,LZ", "T01C0.800", "%", "T01", "X010000Y010000", "X150000Y100000", "X290000Y190000", "M30"].join("\n");

const dataDir = mkdtempSync(join(tmpdir(), "wasm-variant-benchmark-"));
const generated = {
  "bench-flashes.gtl": flashLayer(Math.round(400_000 * scale)),
  "bench-tracks.gbl": trackLayer(Math.round(300_000 * scale)),
  "bench-regions.gto": regionLayer(Math.round(20_000 * scale)),
  "bench-pads.gbo": flashLayer(Math.round(200_000 * scale)),
  "bench-holes.drl": drillLayer(),
};
const paths = {};
for (const [name, content] of Object.entries(generated)) {
  paths[name] = join(dataDir, name);
  writeFileSync(paths[name], content);
}
paths["region-72K"] = "demo/performance-test-region-72K.gbr";
const gerberNames = ["bench-flashes.gtl", "bench-tracks.gbl", "bench-regions.gto", "bench-pads.gbo"];
const WORKLOADS = [
  { name: "4 Gerber layers (parallel workers)", files: gerberNames },
  { name: "1 Gerber layer", files: ["bench-regions.gto"] },
  { name: "4 Gerber layers + drill (serial path)", files: [...gerberNames, "bench-holes.drl"] },
];

// --- Helpers ----------------------------------------------------------------

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length === 0 ? Number.NaN : sorted[sorted.length >> 1];
};
const round = (value, digits = 1) => Number(value.toFixed(digits));
const toMiB = (bytes) => round(bytes / 2 ** 20);

async function waitForServer(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(url, { method: "HEAD" })).ok) return;
    } catch (_error) {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Static server did not start at ${url}`);
}

// Runs in the page before the viewer: records every parse task a worker
// answers and gives the load a start and an end.
function installViewerProbes() {
  const bench = { tasks: [], load: null };
  window.__bench = bench;
  const NativeWorker = window.Worker;
  window.Worker = class BenchmarkWorker extends NativeWorker {
    constructor(...args) {
      super(...args);
      const started = new Map();
      const post = this.postMessage.bind(this);
      this.postMessage = (message, ...rest) => {
        if (message && message.id !== undefined) {
          started.set(message.id, { at: performance.now(), variant: message.wasmVariant });
        }
        return post(message, ...rest);
      };
      this.addEventListener("message", (event) => {
        const start = started.get(event.data?.id);
        if (!start) return;
        bench.tasks.push({
          ms: performance.now() - start.at,
          variant: start.variant,
          ok: Boolean(event.data.ok),
          workerBytes: event.data.workerMemory?.afterBytes ?? 0,
        });
      });
    }
  };
  document.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("file-input");
    const modal = document.getElementById("loading-modal");
    input.addEventListener(
      "change",
      () => {
        const startedAt = performance.now();
        bench.load = new Promise((resolve) => {
          let shown = !modal.hidden;
          new MutationObserver((_records, observer) => {
            if (!modal.hidden) {
              shown = true;
            } else if (shown) {
              observer.disconnect();
              resolve(performance.now() - startedAt);
            }
          }).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
        });
      },
      { capture: true, once: true },
    );
  });
}

async function measureViewerLoad(browser, configuration, workload) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(installViewerProbes);
  await page.goto(`${configuration.base}/${configuration.query}`, { waitUntil: "networkidle" });
  await page.waitForFunction((baseline) =>
    baseline
      ? performance.getEntriesByType("resource").some((entry) => entry.name.endsWith("_bg.wasm"))
      : document.documentElement.dataset.wasmMain,
  Boolean(configuration.baseline));

  // Time the main-instance calls that receive parsed layers or parse on the
  // main thread, and keep the last draw call to replay. The page-side import
  // returns the instance the viewer uses.
  await page.evaluate(async () => {
    const dir = document.documentElement.dataset.wasmMain === "wasm64" ? "pkg64" : "pkg";
    const main = await import(`/wasm/${dir}/wasm_gerber_processor.js`);
    const wasm = await main.default();
    const calls = {};
    const prototype = main.GerberProcessor.prototype;
    for (const name of [
      "add_render_payload",
      "add_interaction_payload",
      "add_layer",
      "add_drill_layer",
    ]) {
      const original = prototype[name];
      calls[name] = 0;
      prototype[name] = function timed(...args) {
        const startedAt = performance.now();
        try {
          return original.apply(this, args);
        } finally {
          calls[name] += performance.now() - startedAt;
        }
      };
    }
    for (const name of ["render", "render_with_clear_and_blend_modes"]) {
      const original = prototype[name];
      prototype[name] = function remember(...args) {
        window.__bench.lastRender = { name, original, processor: this, args };
        return original.apply(this, args);
      };
    }
    window.__bench.mainCalls = calls;
    window.__bench.mainMemory = () => wasm.memory.buffer.byteLength;
    window.__bench.mainMemoryBefore = wasm.memory.buffer.byteLength;
  });

  await page.locator("#file-input").setInputFiles(workload.files.map((name) => paths[name]));
  await page.waitForFunction(() => window.__bench.load, null, { timeout: 30_000 });
  const loadMs = await page.evaluate(() => window.__bench.load);
  await page.waitForFunction(
    (count) => document.querySelectorAll(".gerber-layer-item, .drill-layer-item").length === count,
    workload.files.length,
    { timeout: 30_000 },
  );
  const result = await page.evaluate(async () => {
    const { tasks, mainCalls, mainMemory, mainMemoryBefore } = window.__bench;
    // Draw the loaded scene again as the viewer last drew it, nudging the zoom
    // so that no frame repeats the one before, and wait for the GPU each time.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const last = window.__bench.lastRender;
    let frameMs = null;
    if (last) {
      const gl = document.getElementById("gerber-canvas").getContext("webgl2");
      const zoomIndex = last.name === "render" ? 2 : 3;
      const frames = [];
      for (let frame = 0; frame < 105; frame += 1) {
        const args = [...last.args];
        const zoom = 1 + (frame % 2) * 1e-4;
        args[zoomIndex] *= zoom;
        args[zoomIndex + 1] *= zoom;
        const startedAt = performance.now();
        last.original.apply(last.processor, args);
        gl.finish();
        if (frame >= 5) frames.push(performance.now() - startedAt);
      }
      frames.sort((left, right) => left - right);
      frameMs = frames[frames.length >> 1];
    }
    return {
      tasks,
      mainCalls,
      mainMemoryBytes: mainMemory(),
      mainMemoryBefore,
      frameMs,
      dataset: { ...document.documentElement.dataset },
      diagnostics: Number(document.getElementById("diagnostics-count").textContent),
    };
  });
  await context.close();
  if (errors.length > 0) {
    throw new Error(`${configuration.name} / ${workload.name}: ${errors.join(" | ")}`);
  }
  if (result.diagnostics !== 0 || result.tasks.some((task) => !task.ok)) {
    throw new Error(`${configuration.name} / ${workload.name}: a layer failed to load`);
  }
  return { loadMs, ...result };
}

function summarizeLoads(samples) {
  const workerMs = samples.map((sample) => sample.tasks.reduce((sum, task) => sum + task.ms, 0));
  const mainCall = (name) => round(median(samples.map((sample) => sample.mainCalls[name])));
  return {
    loadMs: round(median(samples.map((sample) => sample.loadMs)), 0),
    loadMsAll: samples.map((sample) => round(sample.loadMs, 0)),
    workerTaskMsTotal: round(median(workerMs), 0),
    workerTasks: samples[0].tasks.length,
    workerVariants: [...new Set(samples.flatMap((sample) => sample.tasks.map((task) => task.variant)))],
    workerPeakMiB: toMiB(
      median(samples.map((sample) => Math.max(0, ...sample.tasks.map((task) => task.workerBytes)))),
    ),
    mainMemoryMiB: toMiB(median(samples.map((sample) => sample.mainMemoryBytes))),
    sceneFrameMs: round(median(samples.map((sample) => sample.frameMs ?? Number.NaN)), 2),
    mainAddRenderPayloadMs: mainCall("add_render_payload"),
    mainAddInteractionPayloadMs: mainCall("add_interaction_payload"),
    mainAddDrillLayerMs: mainCall("add_drill_layer"),
    builds: samples[0].dataset.wasmMain
      ? `${samples[0].dataset.wasmMain} main / ${samples[0].dataset.wasmWorker} workers`
      : "single wasm32 build",
  };
}

// Times one build directly, outside the viewer: the parser as the workers
// call it, add_layer as the main-instance paths (screenshot export, renderer
// recovery, inverted layers) call it, and a rendered frame.
async function measureBuild(browser, build, texts) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${build.base}/tests/fixtures/benchmark.html`, { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(
    async ({ dir, texts }) => {
      const median = (values) => [...values].sort((left, right) => left - right)[values.length >> 1];
      const module = await import(`/wasm/${dir}/wasm_gerber_processor.js`);
      const wasm = await module.default();
      const width = 1400;
      const height = 900;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false });
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      const processor = new module.GerberProcessor();
      processor.init_with_size(gl, width, height);
      const out = {
        // Builds older than memory64 support have no such export.
        addressBits: module.memory_address_bits?.() ?? 32,
        vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        files: {},
      };
      for (const [name, text] of Object.entries(texts)) {
        const parse = [];
        for (let run = 0; run < 7; run += 1) {
          const startedAt = performance.now();
          module.parse_gerber_layer_payload_with_options(text, 0, 0, true, 1);
          parse.push(performance.now() - startedAt);
        }
        const addLayer = [];
        let layerId;
        for (let run = 0; run < 5; run += 1) {
          if (layerId !== undefined) processor.remove_layer(layerId);
          const startedAt = performance.now();
          layerId = processor.add_layer(text);
          gl.finish();
          addLayer.push(performance.now() - startedAt);
        }
        const bounds = processor.get_layer_boundary(layerId);
        const span = Math.max((bounds.max_x - bounds.min_x) / width, (bounds.max_y - bounds.min_y) / height) * 1.05;
        const frames = [];
        for (let frame = 0; frame < 105; frame += 1) {
          // Alternate the scale a little so no frame reuses the previous one.
          const zoom = 1 + (frame % 2) * 1e-4;
          const scaleX = (2 / (width * span)) * zoom;
          const scaleY = (2 / (height * span)) * zoom;
          const startedAt = performance.now();
          processor.render(
            new Uint32Array([layerId]),
            new Float32Array([0.9, 0.6, 0.2, 1]),
            scaleX,
            scaleY,
            -((bounds.min_x + bounds.max_x) / 2) * scaleX,
            -((bounds.min_y + bounds.max_y) / 2) * scaleY,
            1,
          );
          gl.finish();
          if (frame >= 5) frames.push(performance.now() - startedAt);
        }
        processor.remove_layer(layerId);
        out.files[name] = {
          parseMs: median(parse),
          addLayerMs: median(addLayer),
          frameMs: median(frames),
        };
      }
      // The instance never shrinks, so this is the high-water mark of the
      // same work on each build.
      out.memoryBytes = wasm.memory.buffer.byteLength;
      return out;
    },
    { dir: build.dir, texts },
  );
  await context.close();
  return result;
}

// --- Run --------------------------------------------------------------------

const server = spawn(process.execPath, ["scripts/static-server.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    GERBER_VIEWER_TEST_PORT: String(port),
    GERBER_VIEWER_TEST_WASM: "",
    GERBER_VIEWER_TEST_WASM_PKG_DIR: "",
  },
  stdio: ["ignore", "ignore", "inherit"],
});
// The same static server, rooted at the other checkout.
const baselineServer = baselineDir
  ? spawn(process.execPath, [join(process.cwd(), "scripts/static-server.mjs")], {
      cwd: baselineDir,
      env: { ...process.env, GERBER_VIEWER_TEST_PORT: String(port + 1) },
      stdio: ["ignore", "ignore", "inherit"],
    })
  : null;

let browser;
try {
  await waitForServer(`${baseUrl}/index.html`);
  if (baselineServer) await waitForServer(`${baselineUrl}/index.html`);
  browser = await chromium.launch({
    ...(channel ? { channel } : {}),
    args: [
      // Headless Chromium on Windows only reaches the GPU through ANGLE's D3D11 backend.
      ...(process.platform === "win32" ? ["--use-angle=d3d11"] : []),
      "--enable-gpu",
      "--ignore-gpu-blocklist",
    ],
  });

  const texts = Object.fromEntries(
    [...gerberNames, "region-72K"].map((name) => [name, readFileSync(paths[name], "utf8")]),
  );
  const buildRounds = Object.fromEntries(BUILDS.map(({ name }) => [name, []]));
  for (let roundIndex = 0; roundIndex < 3; roundIndex += 1) {
    for (const build of roundIndex % 2 === 0 ? BUILDS : [...BUILDS].reverse()) {
      buildRounds[build.name].push(await measureBuild(browser, build, texts));
    }
  }
  const gpu = buildRounds.wasm32[0];
  const classification = classifyWebGlRenderer(gpu.vendor, gpu.renderer);
  if (classification.softwareRenderer && !allowSoftware) {
    throw new Error(
      `Refusing to benchmark on a software renderer (${gpu.renderer}); set WASM_BENCHMARK_ALLOW_SOFTWARE=1 to run anyway`,
    );
  }

  const builds = {};
  for (const build of BUILDS) {
    builds[build.name] = {
      memoryMiB: toMiB(median(buildRounds[build.name].map((sample) => sample.memoryBytes))),
      files: Object.fromEntries(
        Object.keys(texts).map((name) => {
          const samples = buildRounds[build.name].map((sample) => sample.files[name]);
          return [
            name,
            {
              parseMs: round(median(samples.map((sample) => sample.parseMs))),
              addLayerMs: round(median(samples.map((sample) => sample.addLayerMs))),
              frameMs: round(median(samples.map((sample) => sample.frameMs)), 2),
            },
          ];
        }),
      ),
    };
  }

  const loads = {};
  for (const workload of WORKLOADS) {
    const samples = Object.fromEntries(CONFIGURATIONS.map(({ name }) => [name, []]));
    for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
      // Rotate the order so no configuration always runs first or last.
      for (let offset = 0; offset < CONFIGURATIONS.length; offset += 1) {
        const configuration = CONFIGURATIONS[(roundIndex + offset) % CONFIGURATIONS.length];
        samples[configuration.name].push(await measureViewerLoad(browser, configuration, workload));
      }
    }
    loads[workload.name] = Object.fromEntries(
      CONFIGURATIONS.map(({ name }) => [name, summarizeLoads(samples[name])]),
    );
  }

  const fileSizes = Object.fromEntries(
    Object.entries(texts).map(([name, text]) => [name, `${toMiB(text.length)} MiB`]),
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        browser: `Chromium ${browser.version()}`,
        gpu: { vendor: gpu.vendor, renderer: gpu.renderer, ...classification },
        rounds,
        scale,
        fileSizes,
        builds,
        loads,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await browser?.close();
  server.kill();
  baselineServer?.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
