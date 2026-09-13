import assert from "node:assert/strict";
import test from "node:test";

import { parseFeatures } from "../../../js/loading/odb/features.js";
import {
  featuresToGerber,
  gerberTransformForOrient,
} from "../../../js/loading/odb/gerber-emitter.js";
import { looksLikeGerberContent } from "../../../js/loading/file-utils.js";

function convert(text) {
  const features = parseFeatures(text);
  const result = featuresToGerber(features, { header: { job: "t", step: "pcb", layer: "top" } });
  return result;
}

function bodyOf(result) {
  const lines = result.text.split("\n");
  const start = lines.indexOf("%LPD*%") + 1;
  const end = lines.indexOf("M02*");
  return lines.slice(start, end);
}

test("gerberTransformForOrient composes ODB clockwise rotation with Gerber mirror-then-rotate", () => {
  assert.deepEqual(gerberTransformForOrient(0, false), { rotation: 0, mirror: false });
  assert.deepEqual(gerberTransformForOrient(90, false), { rotation: 270, mirror: false });
  assert.deepEqual(gerberTransformForOrient(30, false), { rotation: 330, mirror: false });
  assert.deepEqual(gerberTransformForOrient(30, true), { rotation: 30, mirror: true });
  assert.deepEqual(gerberTransformForOrient(270, true), { rotation: 270, mirror: true });
});

test("header, aperture definitions, and footer are valid RS-274X", () => {
  const result = convert("UNITS=MM\n$0 r600\nP 1 2 0 P 0 0\n");
  assert.ok(result);
  const lines = result.text.split("\n");
  assert.equal(lines[0], "G04 ODB++ t/pcb/top*");
  assert.equal(lines[1], "%FSLAX46Y46*%");
  assert.equal(lines[2], "%MOMM*%");
  assert.equal(lines[3], "%ADD10C,0.6*%");
  assert.deepEqual(lines.slice(4, 7), ["G75*", "G01*", "%LPD*%"]);
  assert.deepEqual(bodyOf(result), ["D10*", "X1000000Y2000000D03*"]);
  assert.equal(lines.at(-2), "M02*");
  assert.equal(looksLikeGerberContent(result.text), true);
});

test("pads emit polarity, rotation, and mirror changes only when they change", () => {
  const result = convert(`UNITS=MM
$0 rect1400x800
P 0 0 0 P 0 0
P 5 0 0 P 0 0
P 10 0 0 P 0 1
P 15 0 0 P 0 1
P 20 0 0 N 0 8 30
P 25 0 0 P 0 9 30
P 30 0 0 P 0 0
`);
  assert.deepEqual(bodyOf(result), [
    "D10*",
    "X0Y0D03*",
    "X5000000Y0D03*",
    "%LR270*%",
    "X10000000Y0D03*",
    "X15000000Y0D03*",
    "%LPC*%",
    "%LR330*%",
    "X20000000Y0D03*",
    "%LPD*%",
    "%LMY*%",
    "%LR30*%",
    "X25000000Y0D03*",
    "%LMN*%",
    "%LR0*%",
    "X30000000Y0D03*",
  ]);
});

test("transforms are reset before lines, arcs, and surfaces", () => {
  const result = convert(`UNITS=MM
$0 rect1400x800
$1 r200
P 0 0 0 P 0 9 45
L 0 0 10 0 1 P 0
`);
  assert.deepEqual(bodyOf(result), [
    "%LMY*%",
    "%LR45*%",
    "D10*",
    "X0Y0D03*",
    "%LMN*%",
    "%LR0*%",
    "D11*",
    "X0Y0D02*",
    "X10000000Y0D01*",
  ]);
});

test("round lines draw, square lines become regions, zero-length lines flash", () => {
  const result = convert(`UNITS=MM
$0 r200
$1 s400
L 0 0 10 0 0 P 0
L 0 5 10 5 1 P 0
L 3 3 3 3 0 P 0
`);
  const body = bodyOf(result);
  assert.deepEqual(body.slice(0, 3), ["D10*", "X0Y0D02*", "X10000000Y0D01*"]);
  const regionStart = body.indexOf("G36*");
  assert.ok(regionStart > 0);
  assert.deepEqual(body.slice(regionStart, regionStart + 7), [
    "G36*",
    "X-200000Y5200000D02*",
    "X10200000Y5200000D01*",
    "X10200000Y4800000D01*",
    "X-200000Y4800000D01*",
    "X-200000Y5200000D01*",
    "G37*",
  ]);
  assert.equal(body.at(-1), "X3000000Y3000000D03*");
  assert.equal(result.stats.lines, 3);

  // A zero-length line with a non-round symbol flashes that exact symbol, so
  // it is not reported as an approximation.
  const square = convert(`UNITS=MM
$0 s400
L 3 3 3 3 0 P 0
`);
  assert.match(square.text, /%ADD10R,0.4X0.4\*%/);
  assert.equal(bodyOf(square).at(-1), "X3000000Y3000000D03*");
  assert.equal(square.stats.nonRoundLines, 0);
});

test("arcs use G75 multi-quadrant with I/J offsets from the start point", () => {
  const result = convert(`UNITS=MM
$0 r200
A 0 2 2 4 2 2 0 P 0 N
A 10 0 12 2 12 0 0 P 0 Y
A 20 0 20 0 21 0 0 P 0 N
L 30 0 31 0 0 P 0
`);
  assert.deepEqual(bodyOf(result), [
    "D10*",
    "X0Y2000000D02*",
    "G03*",
    "X2000000Y4000000I2000000J0D01*",
    "X10000000Y0D02*",
    "G02*",
    "X12000000Y2000000I2000000J0D01*",
    "X20000000Y0D02*",
    "G03*",
    "X20000000Y0I1000000J0D01*",
    "X30000000Y0D02*",
    "G01*",
    "X31000000Y0D01*",
  ]);
  assert.equal(result.stats.arcs, 3);
});

test("surface islands with holes become one cut-in contour; separate islands get separate blocks", () => {
  const result = convert(`UNITS=MM
S P 0
OB 0 0 I
OS 10 0
OS 10 10
OS 0 10
OS 0 0
OE
OB 4 4 H
OS 4 6
OS 6 6
OS 6 4
OS 4 4
OE
SE
S N 0
OB 20 0 I
OS 30 0
OS 25 5
OE
SE
`);
  const body = bodyOf(result);
  const blocks = body.join("\n").split("G37*").filter((block) => block.includes("G36*"));
  assert.equal(blocks.length, 2, "one block per island");

  const first = blocks[0].split("\n").filter(Boolean);
  assert.equal(first[0], "G36*");
  assert.equal(first[1], "X0Y0D02*");
  // The hole is entered from its nearest island vertex (0,0) → (4,4), walked once, and left again.
  assert.equal(first[2], "X4000000Y4000000D01*");
  assert.equal(first.filter((line) => line === "X4000000Y4000000D01*").length, 2);
  assert.equal(first.filter((line) => line === "X0Y0D01*").length, 2);
  assert.equal(first.filter((line) => line.endsWith("D02*")).length, 1, "single contour");
  assert.ok(first.includes("X10000000Y0D01*") && first.includes("X10000000Y10000000D01*") && first.includes("X0Y10000000D01*"));

  assert.ok(body.includes("%LPC*%"), "negative surface uses clear polarity");
  assert.equal(result.stats.surfaces, 2);
});

test("hole orientation is corrected and arc segments stay arcs inside regions", () => {
  const result = convert(`UNITS=MM
S P 0
OB 0 0 I
OS 10 0
OS 10 10
OC 0 10 5 10 N
OS 0 0
OE
OB 4 4 H
OS 6 4
OS 6 6
OS 4 6
OS 4 4
OE
SE
`);
  const body = bodyOf(result);
  assert.ok(body.some((line) => /^G0[23]\*$/.test(line)), "region arc emitted");
  assert.ok(body.some((line) => /^X0Y10000000I-5000000J0D01\*$/.test(line)), "arc I/J from the previous vertex");
  const holeIndex = body.indexOf("X4000000Y4000000D01*");
  // Island (0,0)→(10,0) is counter-clockwise here, so the hole must run clockwise: (4,4)→(4,6)→(6,6)→(6,4).
  assert.deepEqual(body.slice(holeIndex, holeIndex + 5), [
    "X4000000Y4000000D01*",
    "X4000000Y6000000D01*",
    "X6000000Y6000000D01*",
    "X6000000Y4000000D01*",
    "X4000000Y4000000D01*",
  ]);
});

test("user-defined symbols and text are counted, and empty layers return null", () => {
  const result = convert(`UNITS=MM
$0 CUSTOMD294
$1 moire10x5x3x2x60x45
P 0 0 0 P 0 0
P 1 1 1 P 0 0
T 4 1 standard P 0 1 1 1 'x' 1
`);
  assert.equal(result.stats.userSymbolPads, 1);
  assert.deepEqual([...result.stats.userSymbols], ["CUSTOMD294"]);
  assert.deepEqual([...result.stats.unknownSymbols], ["moire10x5x3x2x60x45"]);
  assert.equal(result.stats.skippedText, 1);
  assert.equal(result.stats.pads, 1);

  assert.equal(convert("UNITS=MM\n$0 CUSTOM\nP 0 0 0 P 0 0\n"), null);
  assert.equal(convert("UNITS=MM\n"), null);
});
