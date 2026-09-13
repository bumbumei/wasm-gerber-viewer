import assert from "node:assert/strict";
import test from "node:test";

import { createTarJobTree } from "../../../js/loading/odb/archive/job-tree.js";
import { parseTar } from "../../../js/loading/odb/archive/tar.js";
import { parseFeatures } from "../../../js/loading/odb/features.js";
import { featuresToGerber } from "../../../js/loading/odb/gerber-emitter.js";
import {
  MAX_USER_SYMBOL_DEPTH,
  UserSymbolLibrary,
  createPadPlacement,
  placeRecord,
} from "../../../js/loading/odb/user-symbols.js";
import { featuresFile, writeTar } from "./helpers/odb-fixture.mjs";

const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""} expected ${expected}, got ${actual}`);

function library(files) {
  return new UserSymbolLibrary(createTarJobTree(parseTar(writeTar(files), { archiveName: "job.tar" })));
}

function bodyOf(result) {
  const lines = result.text.split("\n");
  return lines.slice(lines.indexOf("%LPD*%") + 1, lines.indexOf("M02*"));
}

test("pad placement rotates clockwise, then mirrors about the x-axis, then translates", () => {
  const rotated = createPadPlacement({ x: 10, y: 20, angleDeg: 90, mirror: false });
  const p = rotated.point(1, 0);
  close(p.x, 10, "x");
  close(p.y, 19, "clockwise 90 sends +x to -y");

  const mirrored = createPadPlacement({ x: 0, y: 0, angleDeg: 90, mirror: true });
  const q = mirrored.point(1, 0);
  close(q.x, 0);
  close(q.y, 1, "mirroring after the rotation flips y");
});

test("placeRecord composes nested pad orientation and flips arc direction under mirroring", () => {
  const symbol = parseFeatures(`UNITS=MM
$0 rect1000x500
$1 r100
P 1 0 0 P 0 8 30
L 0 0 1 0 1 P 0
A 1 0 0 1 0 0 1 P 0 N
S P 0
OB 0 0 I
OS 0 1
OC 1 0 0 0 Y
OS 0 0
OE
SE
`);
  const [pad, line, arc, surface] = symbol.records;

  const plain = createPadPlacement({ x: 5, y: 5, angleDeg: 90, mirror: false, neg: false });
  const placedPad = placeRecord(pad, plain);
  close(placedPad.x, 5, "pad x");
  close(placedPad.y, 4, "pad y");
  assert.equal(placedPad.angleDeg, 120, "unmirrored: angles add");
  assert.equal(placedPad.mirror, false);
  assert.equal(placeRecord(arc, plain).cw, false, "direction kept without mirroring");

  const mirrored = createPadPlacement({ x: 0, y: 0, angleDeg: 90, mirror: true, neg: true });
  const mirroredPad = placeRecord(pad, mirrored);
  assert.equal(mirroredPad.angleDeg, 300, "mirrored: inner angle minus outer angle");
  assert.equal(mirroredPad.mirror, true);
  assert.equal(mirroredPad.neg, true, "polarity is relative to the pad");
  const mirroredLine = placeRecord(line, mirrored);
  close(mirroredLine.xe, 0);
  close(mirroredLine.ye, 1);
  const mirroredArc = placeRecord(arc, mirrored);
  assert.equal(mirroredArc.cw, true, "mirroring reverses the arc direction");
  close(mirroredArc.xc, 0);
  close(mirroredArc.yc, 0);
  const mirroredSurface = placeRecord(surface, mirrored);
  assert.equal(mirroredSurface.polygons[0].segments[1].cw, false);
  close(mirroredSurface.polygons[0].segments[0].x, 1, "segment x");
  close(mirroredSurface.polygons[0].segments[0].y, 0, "segment y");
});

test("pads referencing user symbols are expanded in place, nested symbols included", () => {
  const files = {
    "job/matrix/matrix": "STEP {\nNAME=pcb\n}\n",
    "job/symbols/ring/features": featuresFile({
      units: "MM",
      symbols: ["r200"],
      records: ["A 1 0 1 0 0 0 0 P 0 Y"],
    }),
    "job/symbols/fid/features": featuresFile({
      units: "MM",
      symbols: ["r500", "ring", "r0"],
      records: ["P 0 0 0 P 0 0", "P 0 0 1 P 0 0", "L 0 0 0.5 0 2 P 0", "T 0 0 standard P 0 1 1 1 'x' 1"],
    }),
  };
  const lib = library(files);
  const layer = parseFeatures(`UNITS=MM
$0 fid
$1 missing
P 10 10 0 P 0 0
P 20 20 0 N 0 8 45
P 30 30 1 P 0 0
P 40 40 -1 0 100 P 0 0
`);

  return lib.collect(layer).then((userSymbols) => {
    assert.deepEqual([...userSymbols.keys()].sort(), ["fid", "ring"], "nested symbol collected");
    const result = featuresToGerber(layer, { userSymbols, header: {} });
    const body = bodyOf(result);

    assert.equal(result.stats.expandedPads, 6, "three fid pads, each nesting one ring");
    assert.deepEqual([...result.stats.expandedSymbols], ["fid", "ring"]);
    assert.equal(result.stats.userSymbolPads, 1, "unknown symbol still skipped");
    assert.deepEqual([...result.stats.userSymbols], ["missing"]);
    assert.deepEqual([...result.stats.resizedUserSymbols], ["fid"]);
    assert.equal(result.stats.skippedText, 3, "text inside the symbol counted per flash");
    assert.equal(result.stats.pads, 3, "one r500 flash per expansion; r0 draws nothing");

    assert.ok(body.includes("X10000000Y10000000D03*"), "dot at the first pad");
    assert.ok(body.includes("X11000000Y10000000D02*"), "ring arc starts at pad + 1 mm");
    assert.ok(body.some((line) => /^X11000000Y10000000I-1000000J0D01\*$/.test(line)), "full circle");
    assert.ok(body.includes("%LPC*%"), "negative pad makes its symbol clear");
    assert.match(result.text, /%ADD1\dC,0\.5\*%/);
    assert.ok(!result.text.includes("C,0*"), "zero-diameter pens never define apertures");
  });
});

test("expansion stops at the depth limit and reports the symbol instead", () => {
  const files = { "job/matrix/matrix": "STEP {\nNAME=pcb\n}\n" };
  const total = MAX_USER_SYMBOL_DEPTH + 2;
  for (let level = 0; level < total; level++) {
    files[`job/symbols/lvl${level}/features`] = featuresFile({
      units: "MM",
      symbols: [level + 1 < total ? `lvl${level + 1}` : "r100"],
      records: ["P 0 0 0 P 0 0"],
    });
  }
  const lib = library(files);
  const layer = parseFeatures("UNITS=MM\n$0 lvl0\nP 0 0 0 P 0 0\n");
  return lib.collect(layer).then((userSymbols) => {
    assert.equal(userSymbols.size, total);
    const result = featuresToGerber(layer, { userSymbols, header: {} });
    assert.equal(result, null, "nothing drawable once the chain is cut");
  });
});

test("the library resolves symbol directories case-insensitively and caches parses", async () => {
  const lib = library({
    "job/matrix/matrix": "STEP {\nNAME=pcb\n}\n",
    "job/symbols/customd294/features": featuresFile({ units: "MM", symbols: ["r100"], records: ["P 0 0 0 P 0 0"] }),
  });
  assert.equal(lib.isUserSymbol("CUSTOMD294"), true);
  assert.equal(lib.isUserSymbol("r100"), false, "standard names are never user symbols");
  assert.equal(lib.isUserSymbol("nothere"), false);
  const first = await lib.load("CUSTOMD294");
  assert.equal(first.records.length, 1);
  assert.equal(await lib.load("customd294"), first, "same parsed object on the second load");
  assert.equal(await lib.load("nothere"), null);
});
