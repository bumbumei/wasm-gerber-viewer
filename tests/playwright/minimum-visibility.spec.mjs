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

/** Canvas pixels that differ from the background: how many, and the summed
 *  colour distance from the background (brightness matters once edges are
 *  anti-aliased, because a sub-pixel pad shows as a dim pixel). */
async function ink(page) {
  return page.locator("#gerber-canvas").evaluate((canvas) => {
    const gl = canvas.getContext("webgl2");
    gl.finish();
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const [r, g, b] = pixels;
    let count = 0;
    let sum = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const dr = Math.abs(pixels[index] - r);
      const dg = Math.abs(pixels[index + 1] - g);
      const db = Math.abs(pixels[index + 2] - b);
      if (dr || dg || db) {
        count++;
        sum += dr + dg + db;
      }
    }
    return { count, sum };
  });
}

/** Number of canvas pixels that differ from the background. */
async function inkPixels(page) {
  return (await ink(page)).count;
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
    const inkOff = await ink(page);
    await setMinimumVisibility(page, 1);
    const inkOnePixel = await ink(page);
    await setMinimumVisibility(page, 2);
    const inkTwoPixels = await ink(page);

    expect(inkOff.count).toBeGreaterThan(0);
    // Without the clamp a sub-pixel pad is a dim anti-aliased pixel or, for
    // the multisampled shapes, missing altogether; holding every pad at one
    // pixel adds both lit pixels and brightness (measured 1.2x to 2x), and
    // two pixels adds more again.
    expect(inkOnePixel.count).toBeGreaterThan(inkOff.count * 1.1);
    expect(inkOnePixel.sum).toBeGreaterThan(inkOff.sum * 1.1);
    expect(inkTwoPixels.sum).toBeGreaterThan(inkOnePixel.sum * 1.05);
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

test("anti-aliasing is off by default and adds edge coverage when enabled", async ({ page }) => {
  await page.goto("/");
  await page
    .locator("#file-input")
    .setInputFiles(fileURLToPath(new URL("../../demo/bga-test-patterns.gbr", import.meta.url)));
  await expect(page.locator("#loading-modal")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("#visible-layer-count")).toHaveText("1 / 1");

  await page.locator("[data-panel-tab='options']").click();
  await expect(page.locator("#anti-aliasing-off")).toBeChecked();
  const inkOff = await ink(page);

  await page.locator("#anti-aliasing-on").check({ force: true });
  await page.waitForTimeout(400);
  const inkOn = await ink(page);

  // Point sampling lights whole pixels; anti-aliasing adds partially covered
  // edge pixels around every pad and outline, so more pixels differ from the
  // background while the picture stays the same shapes.
  expect(inkOn.count).toBeGreaterThan(inkOff.count * 1.1);
  expect(inkOn.sum).toBeGreaterThan(0);

  await page.locator("#anti-aliasing-off").check({ force: true });
  await page.waitForTimeout(400);
  expect((await ink(page)).count).toBe(inkOff.count);
});

test("pads held at the minimum width stay members of a composite", async ({ page }) => {
  // A composite is filled where its source mask says the geometry is
  // present. The minimum width dims an enlarged pad's displayed coverage;
  // that must not drop it out of the composite.
  await page.goto("/");
  await page.locator("#file-input").setInputFiles([
    { name: "pads.gtl", mimeType: "text/plain", buffer: Buffer.from(denseBgaGerber("round flashes")) },
    { name: "squares.gtl", mimeType: "text/plain", buffer: Buffer.from(denseBgaGerber("square regions")) },
  ]);
  await expect(page.locator("#loading-modal")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator(".gerber-layer-item")).toHaveCount(2);

  // Zoom out until the 0.25 mm pads are held at the minimum width and drawn
  // well below half coverage, and measure the source layers themselves.
  const canvas = page.locator("#gerber-canvas");
  const box = await canvas.boundingBox();
  for (let tick = 0; tick < 16; tick++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(500);
  await setMinimumVisibility(page, 2);
  const sourceInk = await ink(page);

  await page.locator("[data-panel-tab='layers']").click();
  await page.locator(".layer-create-composite button").click();
  const dialog = page.locator(".composite-layer-dialog");
  await dialog.locator("[data-composite-name]").fill("Pads union");
  for (const name of ["pads.gtl", "squares.gtl"]) {
    await dialog.locator(".composite-source-choice", { hasText: name }).locator("input").check();
  }
  await dialog.locator('[data-composite-preset="union"]').click();
  await dialog.locator("[data-composite-submit]").click();
  await expect(page.locator(".composite-layer-item")).toHaveCount(1);

  // Hide both Gerber sources so only the composite paints the canvas (the
  // composite row carries the gerber-layer-item class too).
  for (const row of await page.locator(".gerber-layer-item:not(.composite-layer-item)").all()) {
    await row.locator(".layer-checkbox").uncheck();
  }
  await expect(page.locator("#visible-layer-count")).toHaveText("1 / 3");
  await page.waitForTimeout(400);
  const compositeInk = await ink(page);

  // The composite (union of both arrays) must show them as densely as the
  // source layers themselves do.
  expect(sourceInk.count).toBeGreaterThan(1000);
  expect(compositeInk.count).toBeGreaterThan(sourceInk.count * 0.8);
});

// A 10 mm x 0.002 mm bar drawn as a G36 region, rotated about the board
// centre: far thinner than a pixel at any zoom, so only the minimum width
// can make it visible, and only if that width is judged across the bar's
// own thickness rather than the width and height of its bounding box.
function rotatedBarGerber(degrees) {
  const lines = ["G04 rotated thin bar*", "%FSLAX46Y46*%", "%MOMM*%", "%ADD99C,0.1*%", "G75*", "G01*", "%LPD*%"];
  const radians = (degrees * Math.PI) / 180;
  const corner = (u, v) => {
    const x = 20 + u * Math.cos(radians) - v * Math.sin(radians);
    const y = 18 + u * Math.sin(radians) + v * Math.cos(radians);
    return point(x, y);
  };
  lines.push(
    "G36*",
    `${corner(-5, -0.001)}D02*`,
    `${corner(5, -0.001)}D01*`,
    `${corner(5, 0.001)}D01*`,
    `${corner(-5, 0.001)}D01*`,
    `${corner(-5, -0.001)}D01*`,
    "G37*",
    "D99*",
  );
  [[0, 0, "D02"], [0, 36, "D01"], [40, 36, "D01"], [40, 0, "D01"], [0, 0, "D01"]].forEach(([x, y, op]) =>
    lines.push(`${point(x, y)}${op}*`),
  );
  lines.push("M02*");
  return `${lines.join("\n")}\n`;
}

for (const degrees of [15, 30, 45, 60]) {
  test(`minimum width keeps a thin bar rotated ${degrees} degrees visible`, async ({ page }) => {
    await page.goto("/");
    await page.locator("#file-input").setInputFiles({
      name: "bar.gbr",
      mimeType: "text/plain",
      buffer: Buffer.from(rotatedBarGerber(degrees)),
    });
    await expect(page.locator("#loading-modal")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#visible-layer-count")).toHaveText("1 / 1");

    await setMinimumVisibility(page, 0);
    const inkOff = await ink(page);
    await setMinimumVisibility(page, 2);
    const inkTwoPixels = await ink(page);

    // Off: at most a stray pixel or two of the bar besides the outline. With
    // 2 px the whole 10 mm length shows (hundreds of pixels at fit zoom).
    expect(inkTwoPixels.count - inkOff.count).toBeGreaterThan(150);
  });
}
