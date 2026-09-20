// Generates demo/bga-test-patterns.gbr: ten dense pad arrays, each drawn the
// way a different CAD or CAM tool writes BGA pads, so the renderer can be
// checked when the pads shrink below a pixel. The layout of block A1 is the
// centre BGA of a real CircuitCAM stencil (0.8 mm pitch, 0.4 mm square
// apertures written as G36 regions, concentric ring depopulation); the other
// blocks vary pitch, pad shape and the geometry path they exercise.
// Usage: node scripts/generate-bga-sample.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = resolve(here, "../demo");
mkdirSync(demoDir, { recursive: true });

// Coordinates are integers in 1e-6 mm (%FSLAX46Y46*%).
const c = (mm) => Math.round(mm * 1e6);
const point = (x, y) => `X${c(x)}Y${c(y)}`;

// The real stencil's 20 x 20 grid; '#' is a populated pad.
const JABIL_RINGS = [
  "####################",
  "####################",
  "##................##",
  "##.##############.##",
  "##.##############.##",
  "##.##..........##.##",
  "##.##..######..##.##",
  "##.##.#.####.#.##.##",
  "##.##.##.##.##.##.##",
  "##.##.########.##.##",
  "##.##.########.##.##",
  "##.##.##.##.##.##.##",
  "##.##.#.####.#.##.##",
  "##.##..######..##.##",
  "##.##..........##.##",
  "##.##############.##",
  "##.##############.##",
  "##................##",
  "####################",
  "####################",
];

const lines = [];
const legend = [];
let apertureCode = 10;
const apertures = [];
function aperture(definition) {
  const code = apertureCode++;
  apertures.push(`%ADD${code}${definition}*%`);
  return code;
}

/** Iterate a grid centred on (cx, cy); `populated(col, row)` may skip cells. */
function grid(cx, cy, columns, rows, pitch, populated, emit) {
  const firstX = cx - ((columns - 1) / 2) * pitch;
  const firstY = cy - ((rows - 1) / 2) * pitch;
  let count = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (populated && !populated(column, row)) continue;
      emit(firstX + column * pitch, firstY + row * pitch);
      count++;
    }
  }
  return count;
}

function flashArray(label, code, cx, cy, columns, rows, pitch, populated) {
  lines.push(`G04 ${label}*`, `D${code}*`);
  return grid(cx, cy, columns, rows, pitch, populated, (x, y) => lines.push(`${point(x, y)}D03*`));
}

/** Square pad as a G36 region (straight edges: the triangle path). */
function squareRegion(x, y, size) {
  const h = size / 2;
  lines.push(
    "G36*",
    `${point(x - h, y - h)}D02*`,
    `${point(x + h, y - h)}D01*`,
    `${point(x + h, y + h)}D01*`,
    `${point(x - h, y + h)}D01*`,
    `${point(x - h, y - h)}D01*`,
    "G37*",
  );
}

/** Rounded rectangle as a G36 region with four G03 corner arcs (the exact
 *  path-region renderer), as CAM tools write stencil apertures. */
function roundedRegion(x, y, width, height, radius) {
  const x0 = x - width / 2;
  const x1 = x + width / 2;
  const y0 = y - height / 2;
  const y1 = y + height / 2;
  const r = radius;
  const line = (px, py) => `G01${point(px, py)}D01*`;
  const arc = (px, py, i, j) => `G03${point(px, py)}I${c(i)}J${c(j)}D01*`;
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

function regionArray(label, cx, cy, columns, rows, pitch, populated, emit) {
  lines.push(`G04 ${label}*`);
  const count = grid(cx, cy, columns, rows, pitch, populated, emit);
  lines.push("G01*");
  return count;
}

function describe(id, cx, cy, count, text) {
  legend.push(`G04   ${id} at (${cx}, ${cy}) mm: ${count} pads, ${text}*`);
}

// Apertures ---------------------------------------------------------------
const outline = aperture("C,0.100000");
const round020 = aperture("C,0.200000");
const round025 = aperture("C,0.250000");
const round018 = aperture("C,0.180000");
const round050 = aperture("C,0.500000");
const round040 = aperture("C,0.400000");
const round022 = aperture("C,0.220000");
const rect030 = aperture("R,0.300000X0.300000");
const oval = aperture("O,0.250000X0.450000");
const octagon = aperture("OCTAGON");

// Row A (y = 58): stencil-style regions and round pads --------------------
let n;
n = regionArray("A1 CircuitCAM stencil BGA replica", 15, 58, 20, 20, 0.8,
  (col, row) => JABIL_RINGS[19 - row][col] === "#",
  (x, y) => squareRegion(x, y, 0.4));
describe("A1", 15, 58, n, "0.8 mm pitch, 0.4 mm square G36 regions, concentric ring depopulation (real stencil layout)");

n = regionArray("A2 rounded stencil apertures", 40, 58, 20, 20, 0.8, null,
  (x, y) => roundedRegion(x, y, 0.4, 0.4, 0.08));
describe("A2", 40, 58, n, "0.8 mm pitch, 0.4 mm squares with 0.08 mm arc corners as G36 regions (exact path renderer)");

n = flashArray("A3 fine pitch round", round020, 65, 58, 40, 40, 0.4);
describe("A3", 65, 58, n, "0.4 mm pitch, 0.2 mm round flashes, full array");

n = flashArray("A4 depopulated centre", round025, 90, 58, 32, 32, 0.5,
  (col, row) => Math.min(col, row, 31 - col, 31 - row) < 5);
describe("A4", 90, 58, n, "0.5 mm pitch, 0.25 mm round flashes, five perimeter rows only");

n = flashArray("A5 coarse pitch round", round050, 111, 58, 16, 16, 1.0);
describe("A5", 111, 58, n, "1.0 mm pitch, 0.5 mm round flashes");

// Row B (y = 22): other pad shapes and paths ------------------------------
n = regionArray("B1 square regions", 15, 22, 32, 32, 0.5, null,
  (x, y) => squareRegion(x, y, 0.25));
describe("B1", 15, 22, n, "0.5 mm pitch, 0.25 mm square G36 regions (triangle path)");

n = flashArray("B2 octagon macro", octagon, 40, 22, 32, 32, 0.5);
describe("B2", 40, 22, n, "0.5 mm pitch, 0.25 mm octagon macro flashes (triangle-template path)");

lines.push("G04 B3 rectangle and oval flashes*", `D${rect030}*`);
n = grid(65, 22, 24, 24, 0.65, (col, row) => (col + row) % 2 === 0, (x, y) => lines.push(`${point(x, y)}D03*`));
lines.push(`D${oval}*`);
n += grid(65, 22, 24, 24, 0.65, (col, row) => (col + row) % 2 === 1, (x, y) => lines.push(`${point(x, y)}D03*`));
describe("B3", 65, 22, n, "0.65 mm pitch, checkerboard of 0.3 mm rectangle and 0.25 x 0.45 mm oval flashes");

lines.push("G04 B4 staggered hex array*", `D${round018}*`);
{
  const pitch = 0.35;
  const rowPitch = pitch * Math.sqrt(3) / 2;
  const columns = 45;
  const rows = 52;
  const firstX = 90 - ((columns - 1) / 2) * pitch;
  const firstY = 22 - ((rows - 1) / 2) * rowPitch;
  n = 0;
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 === 0 ? 0 : pitch / 2;
    for (let column = 0; column < columns - (row % 2); column++) {
      lines.push(`${point(firstX + offset + column * pitch, firstY + row * rowPitch)}D03*`);
      n++;
    }
  }
}
describe("B4", 90, 22, n, "0.35 mm hex (staggered) pitch, 0.18 mm round flashes");

lines.push("G04 B5 mixed pad sizes*", `D${round040}*`);
n = grid(111, 22, 20, 20, 0.8, (col, row) => (col + row) % 2 === 0, (x, y) => lines.push(`${point(x, y)}D03*`));
lines.push(`D${round022}*`);
n += grid(111, 22, 20, 20, 0.8, (col, row) => (col + row) % 2 === 1, (x, y) => lines.push(`${point(x, y)}D03*`));
describe("B5", 111, 22, n, "0.8 mm pitch, checkerboard of 0.4 mm and 0.22 mm round flashes");

// Board outline -------------------------------------------------------------
lines.push("G04 board outline*", `D${outline}*`);
[[0, 0, "D02"], [0, 80, "D01"], [125, 80, "D01"], [125, 0, "D01"], [0, 0, "D01"]].forEach(([x, y, op]) =>
  lines.push(`${point(x, y)}${op}*`),
);

const header = [
  "G04 BGA test patterns: dense pad arrays drawn through every geometry path*",
  "G04 Generated by scripts/generate-bga-sample.mjs; units mm, 125 x 80 mm outline*",
  "G04 Blocks (row A y=58, row B y=22):*",
  ...legend,
  "%FSLAX46Y46*%",
  "%MOMM*%",
  "%AMOCTAGON*5,1,8,0,0,0.25,0*%",
  ...apertures,
  "G75*",
  "G01*",
  "%LPD*%",
];

const text = `${[...header, ...lines, "M02*"].join("\n")}\n`;
const out = resolve(demoDir, "bga-test-patterns.gbr");
writeFileSync(out, text);
console.log(`demo/bga-test-patterns.gbr ${text.length} bytes, ${lines.length} lines`);
