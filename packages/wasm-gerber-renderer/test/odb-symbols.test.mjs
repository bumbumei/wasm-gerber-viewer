import assert from "node:assert/strict";
import test from "node:test";

import {
  ApertureTable,
  parseStandardSymbol,
  resizeShape,
} from "../../../js/loading/odb/symbols.js";

const MIL = 0.0254;
const MICRON = 0.001;

function approx(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ""} expected ${expected}, got ${actual}`);
}

test("symbol dimensions are thousandths of the file unit", () => {
  approx(parseStandardSymbol("r15.748", MIL).d, 0.4, "inch job round");
  approx(parseStandardSymbol("r1050", MICRON).d, 1.05, "mm job round");
  const square = parseStandardSymbol("s61.0236", MIL);
  assert.equal(square.kind, "rect");
  approx(square.w, 1.55);
  approx(square.h, 1.55);
});

test("rectangle families parse dimensions, radii, and corner masks", () => {
  const rect = parseStandardSymbol("rect961.8x1711.8", MICRON);
  assert.equal(rect.kind, "rect");
  approx(rect.w, 0.9618);
  approx(rect.h, 1.7118);

  const rounded = parseStandardSymbol("rect1550x1300xr250", MICRON);
  assert.equal(rounded.kind, "roundedRect");
  approx(rounded.r, 0.25);
  assert.deepEqual([...rounded.corners].sort(), [1, 2, 3, 4]);

  const chamfered = parseStandardSymbol("rect100x50xc8x13", MIL);
  assert.equal(chamfered.kind, "chamferedRect");
  approx(chamfered.c, 8 * MIL);
  assert.deepEqual([...chamfered.corners].sort(), [1, 3]);
});

test("other standard families and fallbacks", () => {
  assert.equal(parseStandardSymbol("oval210x170", MIL).kind, "oval");
  assert.equal(parseStandardSymbol("di100x80", MIL).kind, "diamond");
  assert.equal(parseStandardSymbol("oct100x100x20", MIL).kind, "octagon");
  assert.equal(parseStandardSymbol("donut_r100x60", MIL).kind, "donutRound");
  assert.equal(parseStandardSymbol("donut_sr100x60", MIL).kind, "donutSquareRound");
  assert.equal(parseStandardSymbol("donut_s100x60", MIL).kind, "donutSquare");
  assert.equal(parseStandardSymbol("hex_s100x80x10", MIL).vertical, true);
  assert.equal(parseStandardSymbol("tri100x80", MIL).kind, "triangle");
  assert.equal(parseStandardSymbol("el120x80", MIL).kind, "ellipse");
  const hole = parseStandardSymbol("hole40xpx0x0", MIL);
  assert.equal(hole.kind, "circle");
  approx(hole.d, 40 * MIL);
  const thermal = parseStandardSymbol("thr80x60x0x4x15", MIL);
  assert.equal(thermal.kind, "thermal");
  assert.equal(thermal.spokes, 4);
  assert.equal(thermal.angleDeg, 0);

  const moire = parseStandardSymbol("moire10x5x3x2x60x45", MIL);
  assert.equal(moire.kind, "unsupported");
  approx(moire.fallbackDiameter, 10 * MIL);

  assert.equal(parseStandardSymbol("CUSTOMD294", MIL), null, "user symbols are not standard");
  assert.equal(parseStandardSymbol("my_pad", MIL), null);
  assert.equal(parseStandardSymbol("rectangle", MIL), null, "letters after prefix");
});

test("resizeShape grows outer dimensions only", () => {
  const grown = resizeShape({ kind: "roundedRect", w: 1, h: 2, r: 0.2, corners: new Set([1]) }, 0.1);
  approx(grown.w, 1.1);
  approx(grown.h, 2.1);
  approx(grown.r, 0.2);
  const circle = { kind: "circle", d: 1 };
  assert.equal(resizeShape(circle, 0), circle, "zero resize returns the same shape");
  approx(resizeShape(circle, 0.2).d, 1.2);
});

test("ApertureTable deduplicates shapes and renders definitions in order", () => {
  const table = new ApertureTable();
  const round = table.dcodeFor({ kind: "circle", d: 0.4 });
  const roundAgain = table.dcodeFor({ kind: "circle", d: 0.4000000001 });
  const rect = table.dcodeFor({ kind: "rect", w: 1.55, h: 1.3 });
  const rounded = table.dcodeFor({ kind: "roundedRect", w: 1.55, h: 1.3, r: 0.25, corners: new Set([1, 2, 3, 4]) });
  const donut = table.dcodeFor({ kind: "donutRound", od: 1.2, id: 0.6 });
  const thermal = table.dcodeFor({ kind: "thermal", od: 1.6, id: 1, angleDeg: 45, spokes: 4, gap: 0.3, square: false });

  assert.equal(round, 10);
  assert.equal(roundAgain, 10);
  assert.equal(rect, 11);
  assert.equal(rounded, 12);
  assert.equal(donut, 13);
  assert.equal(thermal, 14);
  assert.equal(table.isSolidCircle(round), true);
  assert.equal(table.isSolidCircle(donut), false);

  const definitions = table.emitDefinitions();
  assert.ok(definitions[0].startsWith("%AMODB12*\n4,1,"), "macros come first");
  assert.ok(definitions.some((line) => line.startsWith("%AMODB14*\n7,0,0,1.6,1,0.3,45*")));
  assert.ok(definitions.includes("%ADD10C,0.4*%"));
  assert.ok(definitions.includes("%ADD11R,1.55X1.3*%"));
  assert.ok(definitions.includes("%ADD12ODB12*%"));
  assert.ok(definitions.includes("%ADD13C,1.2X0.6*%"));
  const outline = definitions[0].split("\n")[1];
  const vertexCount = Number(outline.split(",")[2]);
  assert.ok(vertexCount >= 32 && vertexCount <= 40, `rounded rect vertices ${vertexCount}`);
});
