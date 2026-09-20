import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Dense arrays of small pads, as a fine-pitch BGA produces, one array per
// geometry path so a clamp that silently stops working on one path fails its
// own case: 40 x 40 round pads of 0.25 mm at 0.5 mm pitch (circles), the same
// array flashed with a macro aperture (triangle templates), 30 x 30 squares
// of 0.25 mm drawn as G36 regions (triangles), and 20 x 20 rounded squares
// drawn as G36 regions with arc corners (the exact path-region renderer,
// which is how CAM tools such as CircuitCAM write stencil pads). Every file
// carries the same 40 x 36 mm outline so the board fits the view identically.
const PAD_ARRAYS = {
  "round flashes": (lines) => flashArray(lines, "D10", 40),
  "macro flashes": (lines) => flashArray(lines, "D11", 40),
  "square regions": (lines) => regionArray(lines, 30, squareRegion),
  "rounded regions": (lines) => regionArray(lines, 20, roundedRegion),
};

const coordinate = (v) => Math.round(v * 1e6);
const point = (x, y) => `X${coordinate(x)}Y${coordinate(y)}`;

function gridCentres(count, pitch) {
  // Centre the array on (20, 18) inside the 40 x 36 mm outline.
  const offset = ((count - 1) / 2) * pitch;
  const centres = [];
  for (let row = 0; row < count; row++) {
    for (let column = 0; column < count; column++) {
      centres.push([20 - offset + column * pitch, 18 - offset + row * pitch]);
    }
  }
  return centres;
}

function flashArray(lines, code, count) {
  lines.push(`${code}*`);
  for (const [x, y] of gridCentres(count, 0.5)) lines.push(`${point(x, y)}D03*`);
}

function regionArray(lines, count, emit) {
  for (const [x, y] of gridCentres(count, 0.5)) emit(lines, x, y);
  lines.push("G01*");
}

function squareRegion(lines, cx, cy) {
  const corner = (dx, dy, op) => `${point(cx + dx, cy + dy)}${op}*`;
  lines.push(
    "G36*",
    corner(-0.125, -0.125, "D02"),
    corner(0.125, -0.125, "D01"),
    corner(0.125, 0.125, "D01"),
    corner(-0.125, 0.125, "D01"),
    corner(-0.125, -0.125, "D01"),
    "G37*",
  );
}

function roundedRegion(lines, cx, cy) {
  const x0 = cx - 0.125;
  const y0 = cy - 0.125;
  const x1 = cx + 0.125;
  const y1 = cy + 0.125;
  const r = 0.05;
  const line = (x, y) => `G01${point(x, y)}D01*`;
  const arc = (x, y, i, j) => `G03${point(x, y)}I${coordinate(i)}J${coordinate(j)}D01*`;
  lines.push(
    "G36*",
    `${point(x0 + r, y0)}D02*`,
    line(x1 - r, y0),
    arc(x1, y0 + r, 0, r),
    line(x1, y1 - r),
    arc(x1 - r, y1, -r, 0),
    line(x0 + r, y1),
    arc(x0, y1 - r, 0, -r),
    line(x0, y0 + r),
    arc(x0 + r, y0, r, 0),
    "G37*",
  );
}

function denseBgaGerber(arrayName) {
  const lines = [
    "G04 dense pad array*",
    "%FSLAX46Y46*%",
    "%MOMM*%",
    "%AMOCTAGON*5,1,8,0,0,0.25,0*%",
    "%ADD10C,0.25*%",
    "%ADD11OCTAGON*%",
    "%ADD99C,0.1*%",
    "G75*",
    "G01*",
    "%LPD*%",
  ];
  PAD_ARRAYS[arrayName](lines);
  lines.push("D99*");
  [[0, 0, "D02"], [0, 36, "D01"], [40, 36, "D01"], [40, 0, "D01"], [0, 0, "D01"]].forEach(([x, y, op]) =>
    lines.push(`${point(x, y)}${op}*`),
  );
  lines.push("M02*");
  return `${lines.join("\n")}\n`;
}

/** Number of canvas pixels that differ from the background. */
async function inkPixels(page) {
  return page.locator("#gerber-canvas").evaluate((canvas) => {
    const gl = canvas.getContext("webgl2");
    gl.finish();
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const [r, g, b] = pixels;
    let ink = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] !== r || pixels[index + 1] !== g || pixels[index + 2] !== b) ink++;
    }
    return ink;
  });
}

async function setMinimumVisibility(page, value) {
  await page.locator("[data-panel-tab='options']").click();
  await page.locator(`#minimum-visibility-${value === 0 ? "off" : value}`).check({ force: true });
  await page.waitForTimeout(400);
}

for (const arrayName of Object.keys(PAD_ARRAYS)) {
  test(`minimum visibility keeps ${arrayName} visible when zoomed out`, async ({ page }) => {
    await page.goto("/");
    await page.locator("#file-input").setInputFiles({
      name: "dense-bga.gbr",
      mimeType: "text/plain",
      buffer: Buffer.from(denseBgaGerber(arrayName)),
    });
    await expect(page.locator("#loading-modal")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#visible-layer-count")).toHaveText("1 / 1");

    // Zoom out until a 0.25 mm pad is well under one pixel.
    const canvas = page.locator("#gerber-canvas");
    const box = await canvas.boundingBox();
    for (let tick = 0; tick < 16; tick++) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(500);

    await setMinimumVisibility(page, 0);
    const inkOff = await inkPixels(page);
    await setMinimumVisibility(page, 1);
    const inkOnePixel = await inkPixels(page);
    await setMinimumVisibility(page, 2);
    const inkTwoPixels = await inkPixels(page);

    expect(inkOff).toBeGreaterThan(0);
    // Without the clamp about half of the sub-pixel pads are not drawn at
    // all; with it every pad covers at least one pixel.
    expect(inkOnePixel).toBeGreaterThan(inkOff * 1.5);
    expect(inkTwoPixels).toBeGreaterThan(inkOnePixel);
  });
}

test("the BGA test patterns demo loads with every array visible", async ({ page }) => {
  await page.goto("/");
  await page
    .locator("#file-input")
    .setInputFiles(fileURLToPath(new URL("../../demo/bga-test-patterns.gbr", import.meta.url)));
  await expect(page.locator("#loading-modal")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("#visible-layer-count")).toHaveText("1 / 1");

  // Ten arrays of at least 256 pads each: even at fit zoom the canvas holds
  // far more ink than the 125 x 80 mm outline alone (about 1,300 pixels).
  expect(await inkPixels(page)).toBeGreaterThan(20_000);
});
