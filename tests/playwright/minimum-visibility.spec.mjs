import { expect, test } from "@playwright/test";

// Dense arrays of small pads, as a fine-pitch BGA produces: 40 x 40 round
// pads of 0.25 mm at 0.5 mm pitch, the same array flashed with a macro
// aperture (drawn through the triangle-template path), a 30 x 30 array of
// 0.25 mm squares drawn as G36 regions (the triangle path), and a 20 x 20
// array of rounded squares drawn as G36 regions with arc corners (the exact
// path-region renderer, which is how CAM tools such as CircuitCAM write
// stencil pads), inside a 40 x 36 mm outline so the board fits the view the
// same way every time.
function denseBgaGerber() {
  const lines = [
    "G04 dense pad arrays*",
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
  const flash = (x, y) => `X${Math.round(x * 1e6)}Y${Math.round(y * 1e6)}D03*`;
  const array = (code, cx, cy) => {
    lines.push(`${code}*`);
    const first = -((40 - 1) / 2) * 0.5;
    for (let row = 0; row < 40; row++) {
      for (let column = 0; column < 40; column++) {
        lines.push(flash(cx + first + column * 0.5, cy + first + row * 0.5));
      }
    }
  };
  array("D10", 12, 18);
  array("D11", 30, 18);
  // Region pads: 30 x 30 squares of 0.25 mm at 0.5 mm pitch around (30, 8).
  const first = -((30 - 1) / 2) * 0.5;
  for (let row = 0; row < 30; row++) {
    for (let column = 0; column < 30; column++) {
      const cx = 30 + first + column * 0.5;
      const cy = 8 + first + row * 0.5;
      const corner = (dx, dy, op) => `X${Math.round((cx + dx) * 1e6)}Y${Math.round((cy + dy) * 1e6)}${op}*`;
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
  }
  // Rounded region pads: 20 x 20 squares of 0.25 mm with 0.05 mm corner
  // arcs at 0.5 mm pitch around (12, 8).
  const roundedFirst = -((20 - 1) / 2) * 0.5;
  const coordinate = (v) => Math.round(v * 1e6);
  for (let row = 0; row < 20; row++) {
    for (let column = 0; column < 20; column++) {
      const x0 = 12 + roundedFirst + column * 0.5 - 0.125;
      const y0 = 8 + roundedFirst + row * 0.5 - 0.125;
      const x1 = x0 + 0.25;
      const y1 = y0 + 0.25;
      const r = 0.05;
      const line = (x, y) => `G01X${coordinate(x)}Y${coordinate(y)}D01*`;
      const arc = (x, y, i, j) => `G03X${coordinate(x)}Y${coordinate(y)}I${coordinate(i)}J${coordinate(j)}D01*`;
      lines.push(
        "G36*",
        `X${coordinate(x0 + r)}Y${coordinate(y0)}D02*`,
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
  }
  lines.push("G01*", "D99*");
  [[0, 0, "D02"], [0, 36, "D01"], [40, 36, "D01"], [40, 0, "D01"], [0, 0, "D01"]].forEach(([x, y, op]) =>
    lines.push(`X${Math.round(x * 1e6)}Y${Math.round(y * 1e6)}${op}*`),
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

test("minimum visibility keeps dense pad arrays visible when zoomed out", async ({ page }) => {
  await page.goto("/");
  await page.locator("#file-input").setInputFiles({
    name: "dense-bga.gbr",
    mimeType: "text/plain",
    buffer: Buffer.from(denseBgaGerber()),
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
  // Without the clamp about half of the 4,500 sub-pixel pads are not drawn at
  // all; with it every pad covers at least one pixel.
  expect(inkOnePixel).toBeGreaterThan(inkOff * 1.5);
  expect(inkTwoPixels).toBeGreaterThan(inkOnePixel);
});
