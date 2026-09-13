import assert from "node:assert/strict";
import test from "node:test";

import { parseFeatures, parseOrient } from "../../../js/loading/odb/features.js";
import { isImportableBoardLayer, parseMatrix } from "../../../js/loading/odb/matrix.js";
import { parseStepHeader } from "../../../js/loading/odb/step-header.js";
import { parseTools } from "../../../js/loading/odb/tools.js";

function approx(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ""} expected ${expected}, got ${actual}`);
}

test("parseFeatures defaults to inch and converts coordinates to mm", () => {
  const features = parseFeatures(`#Layer_Color=1
#
#Feature symbol names
#
$0 r15.748
$1 s61.0236
#
#Feature attribute names
#
@0 .geometry
#
#Layer features
#
P 0.1574803 0.1574803 0 P 0 0 ;0=1,1=0
P 1 2 1 N 5 3;ID=7
L -0.0000002 1.2204724 0 0.1574803 0 P 0
A 0 0.1574803 0.1574803 0 0.1574803 0.1574803 0 P 0 N
`);
  assert.equal(features.units, "inch");
  assert.equal(features.unitsDeclared, false);
  approx(features.symbolScale, 0.0254);
  assert.equal(features.symbols.get(0).name, "r15.748");
  assert.equal(features.records.length, 4);

  const [pad, negPad, line, arc] = features.records;
  assert.equal(pad.t, "P");
  approx(pad.x, 4, "pad x");
  approx(pad.y, 4, "pad y");
  assert.equal(pad.sym, 0);
  assert.equal(pad.neg, false);
  assert.equal(pad.dcode, 0);
  assert.equal(pad.angleDeg, 0);

  assert.equal(negPad.neg, true);
  assert.equal(negPad.dcode, 5);
  assert.equal(negPad.angleDeg, 270);
  assert.equal(negPad.mirror, false);

  assert.equal(line.t, "L");
  approx(line.xe, 0);
  approx(line.ye, 4);

  assert.equal(arc.t, "A");
  assert.equal(arc.cw, false);
  approx(arc.xc, 4);
  assert.deepEqual(features.counts, { pads: 2, lines: 1, arcs: 1, surfaces: 0, texts: 0, barcodes: 0, unknown: 0 });
});

test("parseFeatures honors UNITS=MM, resize apt_def, free angles, and surfaces", () => {
  const features = parseFeatures(`UNITS=MM
ID=10697
#
#Num Features
#
F 5
$0 r1050
$1 rect1550x1300 0.5
P 116.25 122 -1 0 200 P 0 8 45
P 1 1 1 P 0 9 30.5
S N 0;;ID=10685
OB 317 0.378 I
OS 3 0.376
OC 2 1 2.5 0.5 Y
OS 317 0.378
OE
OB 10 10 H
OS 11 10
OS 11 11
OE
SE
T 4 1 standard P 0 1 1 1 'text' 1
B 1 2 UPC39 standard P 8 0 E 0.008 0.2 'x' 1
`);
  assert.equal(features.units, "mm");
  approx(features.symbolScale, 0.001);
  assert.equal(features.symbols.get(1).resize, 0.5);

  const [resized, mirrored, surface] = features.records;
  assert.equal(resized.sym, 0);
  assert.equal(resized.resize, 200);
  assert.equal(resized.angleDeg, 45);
  assert.equal(resized.mirror, false);
  assert.equal(mirrored.angleDeg, 30.5);
  assert.equal(mirrored.mirror, true);

  assert.equal(surface.t, "S");
  assert.equal(surface.neg, true);
  assert.equal(surface.polygons.length, 2);
  assert.equal(surface.polygons[0].hole, false);
  assert.equal(surface.polygons[1].hole, true);
  assert.equal(surface.polygons[0].segments.length, 3);
  assert.deepEqual(surface.polygons[0].segments[1], { x: 2, y: 1, cx: 2.5, cy: 0.5, cw: true });
  assert.equal(features.counts.texts, 1);
  assert.equal(features.counts.barcodes, 1);
});

test("parseOrient maps legacy codes and free angles", () => {
  assert.deepEqual(parseOrient(["0"], 0), { angleDeg: 0, mirror: false });
  assert.deepEqual(parseOrient(["1"], 0), { angleDeg: 90, mirror: false });
  assert.deepEqual(parseOrient(["6"], 0), { angleDeg: 180, mirror: true });
  assert.deepEqual(parseOrient(["8", "-30"], 0), { angleDeg: 330, mirror: false });
  assert.deepEqual(parseOrient(["9", "400"], 0), { angleDeg: 40, mirror: true });
});

test("parseMatrix orders steps and layers and classifies importable layers", () => {
  const matrix = parseMatrix(`
STEP {
    COL=2
    NAME=PANEL
}
STEP {
    COL=1
    NAME=PCB
}
LAYER {
    ROW=2
    CONTEXT=BOARD
    TYPE=SIGNAL
    NAME=BOTTOM
    POLARITY=POSITIVE
}
LAYER {
    ROW=1
    CONTEXT=BOARD
    TYPE=SIGNAL
    NAME=TOP
    POLARITY=NEGATIVE
}
LAYER {
    ROW=3
    CONTEXT=BOARD
    TYPE=DRILL
    NAME=DRILL
    START_NAME=TOP
    END_NAME=BOTTOM
}
LAYER {
    ROW=4
    CONTEXT=MISC
    TYPE=DOCUMENT
    NAME=NOTES
}
LAYER {
    ROW=5
    CONTEXT=BOARD
    TYPE=COMPONENT
    NAME=COMP_+_TOP
}
`);
  assert.deepEqual(matrix.steps.map((step) => step.name), ["PCB", "PANEL"]);
  assert.deepEqual(matrix.layers.map((layer) => layer.name), ["TOP", "BOTTOM", "DRILL", "NOTES", "COMP_+_TOP"]);
  assert.equal(matrix.layers[0].polarity, "NEGATIVE");
  assert.equal(matrix.layers[2].startName, "TOP");
  assert.deepEqual(matrix.layers.map(isImportableBoardLayer), [true, true, true, false, false]);
});

test("parseStepHeader exposes STEP-REPEAT blocks", () => {
  const header = parseStepHeader(`X_DATUM=1.5
Y_DATUM=2.5
STEP-REPEAT {
    NAME=1UP
    X=1.5
    Y=1.6
    DX=1.2
    DY=1.2
    NX=6
    NY=6
    ANGLE=0
    FLIP=NO
    MIRROR=YES
}
`);
  assert.equal(header.xDatum, 1.5);
  assert.equal(header.stepRepeats.length, 1);
  assert.equal(header.stepRepeats[0].name, "1UP");
  assert.equal(header.stepRepeats[0].nx, 6);
  assert.equal(header.stepRepeats[0].mirror, true);
});

test("parseTools converts thousandth sizes to mm using the declared or default units", () => {
  const mm = parseTools(`UNITS=MM
TOOLS {
    NUM=1
    TYPE=NON_PLATED
    FINISH_SIZE=254
    DRILL_SIZE=254
}
`);
  assert.equal(mm.units, "mm");
  approx(mm.tools[0].finishSize, 0.254);
  assert.equal(mm.tools[0].type, "NON_PLATED");

  const inch = parseTools(`TOOLS {
    NUM=3
    TYPE=PLATED
    FINISH_SIZE=40.1575
}
`);
  assert.equal(inch.units, "inch");
  approx(inch.tools[0].finishSize, 1.02);
  assert.equal(inch.tools[0].num, 3);
});
