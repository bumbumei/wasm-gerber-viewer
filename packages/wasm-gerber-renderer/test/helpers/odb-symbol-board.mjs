// A synthetic but board-like ODB++ job (mm) that uses most standard symbol
// families in realistic roles, committed as `demo/odb-symbol-board.tgz` and
// used by the Playwright ODB spec:
//   - QFP-44 (`rect` pads, orient 0/1, `di` pin-1 mark), BGA 6x6 (`r` balls,
//     dog-bone vias), 0805 chips (`rect..xr`), a diode with chamfered pin-1
//     corners (`rect..xc..x23` / `x14`)
//   - a mixed pad row: `hex_l`, `hex_s`, `oct`, `el`, `tri`, `di`, `s`, `r`,
//     `oval` (0 and 90 degrees), `rect..xr400x13`
//   - donut test points (`donut_r/s/sr/rc/o`) over 1.0 mm plated holes
//   - `moire` fiducials and `bfr` / `bfs` alignment marks
//   - an edge connector of `oval_h` fingers (round end outwards), mirrored on
//     the bottom side (orient 4)
//   - four 3.2 mm mounting holes relieved with `thr`, `ths`, `s_ths`, `sr_ths`
//     and a power pad using `rc_ths` (45 degrees on top, 0 on the bottom) over
//     a drill slot
//   - round and square pens, arcs, a full circle, copper pours with holes,
//     a user-defined `logo` symbol on the silkscreen (one placed with `8 30`),
//     and solder masks built with `-1 <sym> <resize>`
// Board: 60 x 40 mm, origin bottom-left, 3 mm rounded corners. Coordinates in
// mm, symbol dimensions in microns. Islands are clockwise, holes
// counter-clockwise, as the specification requires. No real design data.
import { featuresFile, matrixFile, toolsFile } from "./odb-fixture.mjs";

const f = (v) => Number(v.toFixed(4));

class Layer {
  constructor() {
    this.symbols = [];
    this.index = new Map();
    this.records = [];
  }
  sym(name) {
    if (!this.index.has(name)) {
      this.index.set(name, this.symbols.length);
      this.symbols.push(name);
    }
    return this.index.get(name);
  }
  pad(x, y, name, { orient = "0", neg = false, resize = 0 } = {}) {
    const apt = resize ? `-1 ${this.sym(name)} ${resize}` : `${this.sym(name)}`;
    this.records.push(
      `P ${f(x)} ${f(y)} ${apt} ${neg ? "N" : "P"} 0 ${orient}`,
    );
  }
  line(x1, y1, x2, y2, name) {
    this.records.push(
      `L ${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${this.sym(name)} P 0`,
    );
  }
  arc(x1, y1, x2, y2, cx, cy, cw, name) {
    this.records.push(
      `A ${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(cx)} ${f(cy)} ${this.sym(name)} P 0 ${cw ? "Y" : "N"}`,
    );
  }
  // polygons: [{ hole, points: [[x,y],...] , arcs?: [{at index, cx, cy, cw}] }]
  surface(polygons, { neg = false } = {}) {
    this.records.push(`S ${neg ? "N" : "P"} 0`);
    for (const polygon of polygons) {
      const pts = polygon.points;
      this.records.push(
        `OB ${f(pts[0][0])} ${f(pts[0][1])} ${polygon.hole ? "H" : "I"}`,
      );
      for (let i = 1; i < pts.length; i++) {
        const arc = polygon.arcs?.find((a) => a.at === i);
        if (arc) {
          this.records.push(
            `OC ${f(pts[i][0])} ${f(pts[i][1])} ${f(arc.cx)} ${f(arc.cy)} ${arc.cw ? "Y" : "N"}`,
          );
        } else {
          this.records.push(`OS ${f(pts[i][0])} ${f(pts[i][1])}`);
        }
      }
      this.records.push(`OS ${f(pts[0][0])} ${f(pts[0][1])}`);
      this.records.push("OE");
    }
    this.records.push("SE");
  }
  file() {
    return featuresFile({
      units: "MM",
      symbols: this.symbols,
      records: this.records,
    });
  }
}

// Clockwise rectangle (ODB islands are clockwise) and counter-clockwise hole.
const rectCW = (x0, y0, x1, y1) => [
  [x0, y0],
  [x0, y1],
  [x1, y1],
  [x1, y0],
];
const rectCCW = (x0, y0, x1, y1) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const octagonCCW = (cx, cy, r) =>
  Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * 2 * Math.PI + Math.PI / 8;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

/** Build the symbol board job. Returns `{ files }` (path -> content). */
export function buildSymbolBoardJobFiles({ root = "symbol_board" } = {}) {
  const top = new Layer();
  const bottom = new Layer();
  const smt = new Layer();
  const smb = new Layer();
  const sst = new Layer();
  const drill = new Layer();

  // Drill tools (mm) -> tool number is the record dcode, size from symbol.
  const drillHit = (x, y, d) =>
    drill.records.push(
      `P ${f(x)} ${f(y)} ${drill.sym(`r${Math.round(d * 1000)}`)} P ${d === 0.3 ? 1 : d === 1.0 ? 2 : 3} 0`,
    );

  // --- Mounting holes: 3.2 mm non-plated, thermal relief in copper -----------
  const mounts = [
    [4, 4, "thr6000x3800x45x4x500"],
    [56, 4, "ths6000x3800x45x4x500"],
    [4, 36, "s_ths6000x3800x45x4x500"],
    [56, 36, "sr_ths6000x3800x45x4x500"],
  ];
  for (const [x, y, sym] of mounts) {
    top.pad(x, y, sym);
    bottom.pad(x, y, sym, { orient: "4" });
    smt.pad(x, y, "r6400");
    smb.pad(x, y, "r6400");
    drillHit(x, y, 3.2);
  }

  // --- QFP-44 at (15, 22): 0.8 mm pitch, rect pads, pin 1 diamond ----------
  const qfp = { x: 15, y: 22, pitch: 0.8, count: 11, span: 5.2 };
  for (let i = 0; i < qfp.count; i++) {
    const o = (i - (qfp.count - 1) / 2) * qfp.pitch;
    for (const [x, y, orient] of [
      [qfp.x - qfp.span, qfp.y + o, "0"],
      [qfp.x + qfp.span, qfp.y - o, "0"],
      [qfp.x - o, qfp.y + qfp.span, "1"],
      [qfp.x + o, qfp.y - qfp.span, "1"],
    ]) {
      top.pad(x, y, "rect1600x450", { orient });
      smt.pad(x, y, "rect1600x450", { orient, resize: 100 });
    }
  }
  top.pad(qfp.x - 6.6, qfp.y + 5.2, "di700x700");
  // silkscreen body outline and pin 1 dot
  const b = 4.2;
  for (const [x1, y1, x2, y2] of [
    [qfp.x - b, qfp.y - b, qfp.x + b, qfp.y - b],
    [qfp.x + b, qfp.y - b, qfp.x + b, qfp.y + b],
    [qfp.x + b, qfp.y + b, qfp.x - b, qfp.y + b],
    [qfp.x - b, qfp.y + b, qfp.x - b, qfp.y - b],
  ])
    sst.line(x1, y1, x2, y2, "r150");
  sst.pad(qfp.x - 3.3, qfp.y + 3.3, "r500");

  // --- BGA 6x6 at (32, 22): 1.0 mm pitch, round pads, via fan-out -----------
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      const x = 29.5 + i;
      const y = 19.5 + j;
      top.pad(x, y, "r450");
      smt.pad(x, y, "r450", { resize: 100 });
      if (i < 5 && j < 5) {
        // dog-bone via between four balls, short 45 degree trace
        top.line(x, y, x + 0.5, y + 0.5, "r200");
        top.pad(x + 0.5, y + 0.5, "r500");
        drillHit(x + 0.5, y + 0.5, 0.3);
        bottom.pad(x + 0.5, y + 0.5, "r500");
      }
    }
  }
  // silkscreen BGA outline with chamfered pin 1 corner (arc corner)
  sst.line(28.5, 18.5, 28.5, 25.5, "r150");
  sst.line(28.5, 25.5, 35.5, 25.5, "r150");
  sst.line(35.5, 25.5, 35.5, 18.5, "r150");
  sst.line(35.5, 18.5, 28.5, 18.5, "r150");
  sst.pad(27.8, 26.2, "tri600x600", { orient: "1" });

  // --- Chip footprints row (y = 8) -----------------------------------------
  // 0805 capacitors: rounded rects; diode: chamfered pin 1 end.
  for (const cx of [10, 14, 18]) {
    for (const dx of [-1, 1]) {
      top.pad(cx + dx, 8, "rect1200x1400xr250");
      smt.pad(cx + dx, 8, "rect1200x1400xr250", { resize: 100 });
    }
    sst.line(cx - 1.9, 8.9, cx + 1.9, 8.9, "r150");
    sst.line(cx - 1.9, 7.1, cx + 1.9, 7.1, "r150");
  }
  top.pad(24, 8, "rect1200x1400xc350x23"); // chamfered corners 2,3 (left side)
  top.pad(26, 8, "rect1200x1400xc350x14"); // chamfered corners 1,4 (right side)
  smt.pad(24, 8, "rect1200x1400xc350x23", { resize: 100 });
  smt.pad(26, 8, "rect1200x1400xc350x14", { resize: 100 });
  sst.line(23, 9.2, 23, 6.8, "r250"); // cathode bar

  // --- Mixed pad row (y = 12): hex, oct, ellipse, triangle, diamond, ... -----
  const mixed = [
    [10, "hex_l1800x1600x300", "0"],
    [13.5, "hex_s1600x1800x300", "0"],
    [17, "oct1800x1800x400", "0"],
    [20.5, "el2000x1200", "0"],
    [24, "tri1800x1600", "0"],
    [27.5, "di1800x1800", "0"],
    [31, "s1500", "0"],
    [34.5, "r1500", "0"],
    [38.5, "oval2600x1200", "0"],
    [42, "oval2600x1200", "1"],
    [45.5, "rect2200x1200xr400x13", "0"],
  ];
  for (const [x, sym, orient] of mixed) {
    top.pad(x, 12, sym, { orient });
    smt.pad(x, 12, sym, { orient, resize: 100 });
  }

  // --- Test points (y = 33): donuts ----------------------------------------
  const donuts = [
    [22, "donut_r1800x900"],
    [25, "donut_s1800x900"],
    [28, "donut_sr1800x900"],
    [31.5, "donut_rc2400x1400x300"],
    [35, "donut_o2400x1400x300"],
  ];
  for (const [x, sym] of donuts) {
    top.pad(x, 33, sym);
    smt.pad(x, 33, sym, { resize: 100 });
    drillHit(x, 33, 1.0);
    bottom.pad(x, 33, "r1800");
    smb.pad(x, 33, "r2000");
  }

  // --- Fiducials: moire on copper, butterflies as alignment marks -----------
  for (const [x, y] of [
    [8, 33],
    [30, 4],
  ]) {
    top.pad(x, y, "moire200x300x3x100x2600x0");
    smt.pad(x, y, "r3800");
  }
  top.pad(50, 12, "bfr2200");
  top.pad(50, 28, "bfs2200");
  smt.pad(50, 12, "r2600");
  smt.pad(50, 28, "s2600");

  // --- Edge connector at x = 55: half-oval fingers, round end outwards ------
  for (let i = 0; i < 12; i++) {
    const y = 9 + i * 2;
    top.pad(55, y, "oval_h2600x1200", { orient: "0" });
    bottom.pad(55, y, "oval_h2600x1200", { orient: "4" }); // mirrored copy
    smt.pad(55, y, "oval_h2600x1200", { resize: 120 });
    smb.pad(55, y, "oval_h2600x1200", { orient: "4", resize: 120 });
  }
  // trace from a finger to the bfr mark region with a square pen
  top.line(53.7, 15, 51, 15, "s300");
  top.line(51, 15, 51, 13.3, "s300");

  // --- Power pad with rectangular thermal + slot (top right) ----------------
  top.pad(44, 34, "rc_ths6400x3200x45x4x500x600");
  smt.pad(44, 34, "rect6800x3600");
  drill.records.push(`L 43 34 45 34 ${drill.sym("r1000")} P 2`);
  bottom.pad(44, 34, "rc_ths6400x3200x0x4x500x600");
  smb.pad(44, 34, "rect6800x3600");

  // --- Copper pour on TOP (x 40..48, y 16..30) with two holes ----------------
  top.surface([
    { points: rectCW(40, 16, 48, 30) },
    { hole: true, points: octagonCCW(44, 23, 1.2) },
    { hole: true, points: rectCCW(41, 27, 43.5, 29) },
  ]);
  top.pad(44, 23, "r900");
  drillHit(44, 23, 0.3);
  bottom.pad(44, 23, "r900");
  top.pad(42.25, 28, "r700"); // isolated pad inside the rectangular hole

  // --- Traces and arcs -------------------------------------------------------
  // QFP right side pads to BGA left column
  for (let i = 0; i < 6; i++) {
    const y = qfp.y - 2 + i * 0.8;
    top.line(qfp.x + qfp.span + 0.8, y, 24, y, "r250");
    top.line(24, y, 27, y + (i - 2.5) * 0.2, "r250");
  }
  // arcs around the BGA corner and a full circle
  top.arc(36.5, 18.5, 36.5, 25.5, 36.5, 22, false, "r250");
  top.arc(28, 27, 36, 27, 32, 27, true, "r200");
  top.arc(20, 4.5, 20, 4.5, 21, 4.5, false, "r200"); // full circle, 2 mm diameter
  // bottom traces between the donut test points
  for (let i = 0; i < donuts.length - 1; i++) {
    bottom.line(donuts[i][0], 33, donuts[i + 1][0], 33, "r300");
  }
  // bottom copper pour with a hole around the via column
  bottom.surface([
    { points: rectCW(28, 16, 36, 27) },
    { hole: true, points: octagonCCW(32, 22, 3.4) },
  ]);

  // --- User-defined logo symbol on silkscreen -------------------------------
  const logo = new Layer();
  logo.arc(1.5, 0, -1.5, 0, 0, 0, false, "r200"); // upper half circle
  logo.line(-1.5, 0, 1.5, 0, "r200");
  logo.line(0, 0, 0, -1.4, "r200");
  logo.pad(0, -1.8, "tri800x600", { orient: "2" });
  sst.pad(12, 36, "logo");
  sst.pad(20, 36, "logo", { orient: "8 30" });
  // silkscreen frame
  const inset = 1.5;
  sst.line(inset, 3, inset, 40 - 3, "r200");
  sst.line(3, 40 - inset, 60 - 3, 40 - inset, "r200");
  sst.line(60 - inset, 40 - 3, 60 - inset, 3, "r200");
  sst.line(60 - 3, inset, 3, inset, "r200");
  sst.arc(inset, 3, 3, inset, 3, 3, false, "r200");
  sst.arc(60 - 3, inset, 60 - inset, 3, 60 - 3, 3, false, "r200");
  sst.arc(
    60 - inset,
    40 - 3,
    60 - 3,
    40 - inset,
    60 - 3,
    40 - 3,
    false,
    "r200",
  );
  sst.arc(3, 40 - inset, inset, 40 - 3, 3, 40 - 3, false, "r200");

  // --- Profile: 60 x 40 with 3 mm rounded corners (clockwise island) ---------
  const profile = new Layer();
  profile.surface([
    {
      points: [
        [0, 3],
        [0, 37],
        [3, 40],
        [57, 40],
        [60, 37],
        [60, 3],
        [57, 0],
        [3, 0],
      ],
      arcs: [
        { at: 2, cx: 3, cy: 37, cw: true },
        { at: 4, cx: 57, cy: 37, cw: true },
        { at: 6, cx: 57, cy: 3, cw: true },
        // closing segment (3,0) -> (0,3) is written by surface() as OS; add arc below
      ],
    },
  ]);
  // replace the closing straight segment with an arc
  {
    const idx = profile.records.lastIndexOf("OS 0 3");
    profile.records[idx] = "OC 0 3 3 3 Y";
  }

  const files = {
    [`${root}/matrix/matrix`]: matrixFile({
      steps: ["pcb"],
      layers: [
        { type: "SILK_SCREEN", name: "SST" },
        { type: "SOLDER_MASK", name: "SMT" },
        { type: "SIGNAL", name: "TOP" },
        { type: "SIGNAL", name: "BOTTOM" },
        { type: "SOLDER_MASK", name: "SMB" },
        { type: "DRILL", name: "DRILL", startName: "TOP", endName: "BOTTOM" },
      ],
    }),
    [`${root}/steps/pcb/stephdr`]:
      "X_DATUM=0\nY_DATUM=0\nX_ORIGIN=0\nY_ORIGIN=0\n",
    [`${root}/steps/pcb/profile`]: profile.file(),
    [`${root}/steps/pcb/layers/sst/features`]: sst.file(),
    [`${root}/steps/pcb/layers/smt/features`]: smt.file(),
    [`${root}/steps/pcb/layers/top/features`]: top.file(),
    [`${root}/steps/pcb/layers/bottom/features`]: bottom.file(),
    [`${root}/steps/pcb/layers/smb/features`]: smb.file(),
    [`${root}/steps/pcb/layers/drill/features`]: drill.file(),
    [`${root}/steps/pcb/layers/drill/tools`]: toolsFile(
      [
        { type: "VIA", size: 0.3 },
        { type: "PLATED", size: 1.0 },
        { type: "NON_PLATED", size: 3.2 },
      ],
      { units: "MM" },
    ),
    [`${root}/symbols/logo/features`]: logo.file(),
  };
  return { files };
}
