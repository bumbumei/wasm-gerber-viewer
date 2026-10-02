// Generates a Gerber layer that needs more than 4 GiB once it is loaded:
//   demo/memory64-test-pads-24M.gbr   (24,025,000 pads from a 15 KiB file)
//
// The file is a 40 x 25 block of 10 um pads stepped over a grid with %SR%, so
// it stays tiny while the viewer expands it. With 24 million pads a wasm32
// parser runs out of address space, a memory64 worker parses the layer in
// 6 GiB and hands over a 2 GiB payload, and the main instance ends up holding
// 5.1 GiB of picking data. Loading it took 37 s on a laptop with 16 GiB of
// RAM; the browser needs most of that while it loads.
//
// Usage: node scripts/generate-memory64-sample.mjs [million pads] [output file]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BLOCK_COLUMNS = 40;
const BLOCK_ROWS = 25;
const BLOCK_PADS = BLOCK_COLUMNS * BLOCK_ROWS;
const PAD_PITCH_MM = 0.02;
const PAD_DIAMETER_MM = 0.01;
const BLOCK_STEP_MM = 1;
// The parser accepts at most 100,000 step-and-repeat copies.
const MAX_COPIES = 100_000;

/**
 * Source of a layer with about `millionPads` million flashed pads, the exact
 * number it expands to and where the last one lands.
 */
export function densePadGerber(millionPads = 24) {
  const copies = Math.round(millionPads * 1_000_000 / BLOCK_PADS);
  if (!(copies >= 1 && copies <= MAX_COPIES)) {
    throw new Error(`Pad count must be between 0.001 and ${(MAX_COPIES * BLOCK_PADS) / 1e6} million`);
  }
  const columns = Math.ceil(Math.sqrt(copies));
  const rows = Math.ceil(copies / columns);
  const coordinate = (mm) => String(Math.round(mm * 1e4));
  const lines = [
    `G04 ${columns * rows * BLOCK_PADS} pads: a ${BLOCK_COLUMNS} x ${BLOCK_ROWS} block stepped ${columns} x ${rows} times*`,
    "%FSLAX34Y34*%",
    "%MOMM*%",
    `%ADD10C,${PAD_DIAMETER_MM.toFixed(3)}*%`,
    `%SRX${columns}Y${rows}I${BLOCK_STEP_MM.toFixed(1)}J${BLOCK_STEP_MM.toFixed(1)}*%`,
    "D10*",
  ];
  for (let pad = 0; pad < BLOCK_PADS; pad += 1) {
    const x = (pad % BLOCK_COLUMNS) * PAD_PITCH_MM;
    const y = Math.floor(pad / BLOCK_COLUMNS) * PAD_PITCH_MM;
    lines.push(`X${coordinate(x)}Y${coordinate(y)}D03*`);
  }
  lines.push("%SR*%", "M02*");
  return {
    text: lines.join("\n"),
    pads: columns * rows * BLOCK_PADS,
    columns,
    rows,
    // Centre of the pad that is flashed last, in millimetres.
    lastPad: {
      x: (columns - 1) * BLOCK_STEP_MM + (BLOCK_COLUMNS - 1) * PAD_PITCH_MM,
      y: (rows - 1) * BLOCK_STEP_MM + (BLOCK_ROWS - 1) * PAD_PITCH_MM,
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const millionPads = Number(process.argv[2] ?? 24);
  const here = dirname(fileURLToPath(import.meta.url));
  const output = resolve(
    process.argv[3] ?? resolve(here, `../demo/memory64-test-pads-${millionPads}M.gbr`),
  );
  const { text, pads, columns, rows } = densePadGerber(millionPads);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, text);
  console.log(
    `${output}: ${text.length} bytes, ${pads.toLocaleString("en-US")} pads (${columns} x ${rows} blocks)`,
  );
}
