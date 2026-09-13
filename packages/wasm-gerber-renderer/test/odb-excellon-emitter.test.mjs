import assert from "node:assert/strict";
import test from "node:test";

import { drillLayerToExcellon } from "../../../js/loading/odb/excellon-emitter.js";
import { parseFeatures } from "../../../js/loading/odb/features.js";
import { parseTools } from "../../../js/loading/odb/tools.js";
import { looksLikeDrillContent } from "../../../js/loading/file-utils.js";

const DRILL = `UNITS=MM
$0 r300
$1 r1000
$2 r600
P 1 1 0 P 1 0
P 2 2 0 P 1 0
P 5 5 1 P 2 0
L 10 10 14 10 2 P 3 0
A 20 0 22 2 22 0 2 P 3 Y
S P 0
OB 0 0 I
OS 1 0
OS 1 1
OE
SE
`;

const TOOLS = `UNITS=MM
TOOLS {
    NUM=1
    TYPE=VIA
    FINISH_SIZE=300
}
TOOLS {
    NUM=2
    TYPE=NON_PLATED
    FINISH_SIZE=1000
}
TOOLS {
    NUM=3
    TYPE=PLATED
    FINISH_SIZE=600
}
`;

test("drill layers split into plated and non-plated Excellon files", () => {
  const { outputs, stats } = drillLayerToExcellon(parseFeatures(DRILL), parseTools(TOOLS), {
    header: { job: "t", step: "pcb", layer: "drill" },
  });
  assert.deepEqual(outputs.map((output) => output.suffix), ["-pth", "-npth"]);

  const pth = outputs[0].text.split("\n");
  assert.equal(pth[0], "M48");
  assert.ok(pth.includes("METRIC,TZ"));
  assert.ok(pth.includes("T01C0.3"));
  assert.ok(pth.includes("T02C0.6"));
  assert.ok(pth.includes("X1.0Y1.0"));
  assert.ok(pth.includes("X10.0Y10.0G85X14.0Y10.0"), "slot");
  assert.ok(pth.includes("G02X22.0Y2.0I2.0J0.0"), "rout arc");
  assert.ok(pth.includes("M15") && pth.includes("M16"));
  assert.equal(pth.at(-2), "M30");
  assert.equal(looksLikeDrillContent(outputs[0].text), true);

  const npth = outputs[1].text.split("\n");
  assert.ok(npth.includes("T01C1.0"));
  assert.ok(npth.includes("X5.0Y5.0"));
  assert.equal(outputs[1].hitCount, 1);

  assert.equal(stats.hits, 3);
  assert.equal(stats.slots, 1);
  assert.equal(stats.routArcs, 1);
  assert.equal(stats.skippedSurfaces, 1);
});

test("without a tools file everything is plated and tools follow first use", () => {
  const { outputs } = drillLayerToExcellon(parseFeatures(DRILL), null, {});
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].suffix, "");
  const lines = outputs[0].text.split("\n");
  assert.deepEqual(
    lines.filter((line) => /^T\d+C/.test(line)),
    ["T01C0.3", "T02C1.0", "T03C0.6"],
  );
});

test("all non-plated tools yield a single -npth file; empty layers yield nothing", () => {
  const { outputs } = drillLayerToExcellon(
    parseFeatures("UNITS=MM\n$0 r1000\nP 0 0 0 P 1 0\n"),
    parseTools("UNITS=MM\nTOOLS {\nNUM=1\nTYPE=NON_PLATED\nFINISH_SIZE=1000\n}\n"),
    {},
  );
  assert.deepEqual(outputs.map((output) => output.suffix), ["-npth"]);
  assert.equal(drillLayerToExcellon(parseFeatures("UNITS=MM\n"), null, {}).outputs.length, 0);
});
