// Standard ODB++ symbol names → Gerber apertures.
//
// Symbol dimensions are written in thousandths of the job unit (mils in inch
// jobs, microns in mm jobs); callers pass `scale` = millimeters per thousandth.

const OUTLINE_ARC_SEGMENTS = 8;
const ELLIPSE_SEGMENTS = 64;
const MAX_OUTLINE_VERTICES = 5000;

// Longest prefixes first so `donut_sr` is not read as `donut_s` + "r...".
const PREFIXES = [
  "donut_sr",
  "donut_rc",
  "donut_r",
  "donut_s",
  "donut_o",
  "oval_h",
  "s_ths",
  "hex_l",
  "hex_s",
  "moire",
  "rect",
  "oval",
  "hole",
  "ths",
  "thr",
  "tri",
  "oct",
  "bfr",
  "bfs",
  "el",
  "di",
  "r",
  "s",
];

/**
 * Parse a standard symbol name. Returns a shape in millimeters, an
 * `{ kind: "unsupported" }` marker for standard families that only get a
 * circle approximation, or `null` when the name is not a standard symbol
 * (i.e. a user-defined symbol).
 */
export function parseStandardSymbol(rawName, scale) {
  const name = String(rawName ?? "").trim().toLowerCase();
  const prefix = PREFIXES.find(
    (candidate) => name.startsWith(candidate) && /^[0-9.]/.test(name.slice(candidate.length)),
  );
  if (!prefix) return null;

  const rest = name.slice(prefix.length);
  if (prefix === "hole") {
    // hole<d>x<plating>x<tol+>x<tol->: only the diameter matters here.
    const diameter = Number.parseFloat(rest) * scale;
    return Number.isFinite(diameter) && diameter > 0
      ? { kind: "circle", d: diameter }
      : unsupported(name, []);
  }
  const parts = rest.split("x");
  const dims = [];
  const flags = [];
  for (const part of parts) {
    if (part === "") continue;
    if (/^[0-9.]+$/.test(part)) {
      if (flags.length === 0) {
        dims.push(Number.parseFloat(part) * scale);
      } else {
        flags[flags.length - 1].value = part;
      }
    } else if (/^[rc][0-9.]+$/.test(part)) {
      flags.push({ kind: part[0], size: Number.parseFloat(part.slice(1)) * scale, value: "" });
    } else {
      return { kind: "unsupported", name, fallbackDiameter: dims[0] ?? null };
    }
  }
  if (dims.some((value) => !Number.isFinite(value))) {
    return { kind: "unsupported", name, fallbackDiameter: null };
  }

  switch (prefix) {
    case "r":
    case "hole":
      return dims.length >= 1 ? { kind: "circle", d: dims[0] } : unsupported(name, dims);
    case "s":
      return dims.length >= 1 ? { kind: "rect", w: dims[0], h: dims[0] } : unsupported(name, dims);
    case "rect": {
      if (dims.length < 2) return unsupported(name, dims);
      const [w, h] = dims;
      const corner = flags[0];
      if (!corner) return { kind: "rect", w, h };
      const corners = parseCorners(corner.value);
      return corner.kind === "r"
        ? { kind: "roundedRect", w, h, r: corner.size, corners }
        : { kind: "chamferedRect", w, h, c: corner.size, corners };
    }
    case "oval":
      return dims.length >= 2 ? { kind: "oval", w: dims[0], h: dims[1] } : unsupported(name, dims);
    case "di":
      return dims.length >= 2 ? { kind: "diamond", w: dims[0], h: dims[1] } : unsupported(name, dims);
    case "oct":
      return dims.length >= 3
        ? { kind: "octagon", w: dims[0], h: dims[1], r: dims[2] }
        : unsupported(name, dims);
    case "donut_r":
      return dims.length >= 2 ? { kind: "donutRound", od: dims[0], id: dims[1] } : unsupported(name, dims);
    case "donut_sr":
      return dims.length >= 2
        ? { kind: "donutSquareRound", od: dims[0], id: dims[1] }
        : unsupported(name, dims);
    case "donut_s":
      return dims.length >= 2 ? { kind: "donutSquare", od: dims[0], id: dims[1] } : unsupported(name, dims);
    case "donut_rc":
      return dims.length >= 3
        ? { kind: "donutRect", ow: dims[0], oh: dims[1], lw: dims[2] }
        : unsupported(name, dims);
    case "donut_o":
      return dims.length >= 3
        ? { kind: "donutOval", ow: dims[0], oh: dims[1], lw: dims[2] }
        : unsupported(name, dims);
    case "hex_l":
    case "hex_s":
      return dims.length >= 3
        ? { kind: "hexagon", w: dims[0], h: dims[1], r: dims[2], vertical: prefix === "hex_s" }
        : unsupported(name, dims);
    case "tri":
      return dims.length >= 2 ? { kind: "triangle", base: dims[0], h: dims[1] } : unsupported(name, dims);
    case "thr":
    case "ths":
    case "s_ths":
      return dims.length >= 5
        ? {
            kind: "thermal",
            od: dims[0],
            id: dims[1],
            angleDeg: dims[2] / scale,
            spokes: Math.round(dims[3] / scale),
            gap: dims[4],
            square: prefix === "s_ths",
          }
        : unsupported(name, dims);
    case "el":
      return dims.length >= 2 ? { kind: "ellipse", w: dims[0], h: dims[1] } : unsupported(name, dims);
    case "bfr":
      return dims.length >= 1 ? { kind: "butterflyRound", d: dims[0] } : unsupported(name, dims);
    case "bfs":
      return dims.length >= 1 ? { kind: "butterflySquare", s: dims[0] } : unsupported(name, dims);
    default:
      return unsupported(name, dims);
  }
}

function unsupported(name, dims) {
  return { kind: "unsupported", name, fallbackDiameter: dims[0] ?? null };
}

/** Corner mask from the spec: 1 = top-right, 2 = top-left, 3 = bottom-left, 4 = bottom-right. */
function parseCorners(value) {
  const set = new Set();
  for (const digit of String(value ?? "")) {
    if (digit >= "1" && digit <= "4") set.add(Number(digit));
  }
  return set.size === 0 ? new Set([1, 2, 3, 4]) : set;
}

/** Grow a shape's outer dimensions by `delta` millimeters (ODB resize). */
export function resizeShape(shape, delta) {
  if (!shape || !delta) return shape;
  const grown = { ...shape };
  for (const key of ["d", "w", "h", "od", "ow", "oh", "base", "s"]) {
    if (typeof grown[key] === "number") grown[key] = Math.max(grown[key] + delta, 0);
  }
  return grown;
}

export function isSolidCircleShape(shape) {
  return shape?.kind === "circle" && shape.d > 0;
}

/** Nominal size used when a non-round symbol has to be drawn as a round pen. */
export function shapePenDiameter(shape) {
  switch (shape?.kind) {
    case "circle":
      return shape.d;
    case "rect":
    case "roundedRect":
    case "chamferedRect":
    case "oval":
    case "diamond":
    case "octagon":
    case "hexagon":
    case "ellipse":
      return Math.min(shape.w, shape.h);
    case "donutRound":
    case "donutSquare":
    case "donutSquareRound":
      return shape.od;
    case "donutRect":
    case "donutOval":
      return Math.min(shape.ow, shape.oh);
    case "triangle":
      return Math.min(shape.base, shape.h);
    case "thermal":
      return shape.od;
    case "butterflyRound":
      return shape.d;
    case "butterflySquare":
      return shape.s;
    default:
      return 0;
  }
}

export function formatMm(value) {
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded === 0 ? 0 : rounded);
}

/**
 * Allocates Gerber D-codes for shapes and renders the `%AM`/`%ADD`
 * definitions. Identical shapes share one aperture.
 */
export class ApertureTable {
  constructor({ firstDcode = 10 } = {}) {
    this.nextDcode = firstDcode;
    this.entries = new Map();
    this.solidCircles = new Set();
  }

  dcodeFor(shape) {
    const key = shapeKey(shape);
    const existing = this.entries.get(key);
    if (existing) return existing.dcode;

    const dcode = this.nextDcode++;
    const definition = apertureDefinition(shape, dcode);
    this.entries.set(key, { dcode, ...definition });
    if (isSolidCircleShape(shape)) this.solidCircles.add(dcode);
    return dcode;
  }

  isSolidCircle(dcode) {
    return this.solidCircles.has(dcode);
  }

  get size() {
    return this.entries.size;
  }

  emitDefinitions() {
    const lines = [];
    for (const entry of this.entries.values()) {
      if (entry.macro) lines.push(entry.macro);
    }
    for (const entry of this.entries.values()) {
      lines.push(entry.add);
    }
    return lines;
  }
}

function shapeKey(shape) {
  const parts = [shape.kind];
  for (const key of Object.keys(shape).sort()) {
    if (key === "kind") continue;
    const value = shape[key];
    parts.push(
      `${key}=${value instanceof Set ? Array.from(value).sort().join("") : formatMm(Number(value))}`,
    );
  }
  return parts.join("|");
}

function apertureDefinition(shape, dcode) {
  const f = formatMm;
  switch (shape.kind) {
    case "circle":
      return { add: `%ADD${dcode}C,${f(shape.d)}*%` };
    case "rect":
      return { add: `%ADD${dcode}R,${f(shape.w)}X${f(shape.h)}*%` };
    case "oval":
      return { add: `%ADD${dcode}O,${f(shape.w)}X${f(shape.h)}*%` };
    case "donutRound":
      return { add: `%ADD${dcode}C,${f(shape.od)}X${f(shape.id)}*%` };
    case "donutSquareRound":
      return { add: `%ADD${dcode}R,${f(shape.od)}X${f(shape.od)}X${f(shape.id)}*%` };
    case "thermal":
      return macro(dcode, [
        `7,0,0,${f(shape.od)},${f(shape.id)},${f(shape.gap)},${f(shape.angleDeg)}*`,
      ]);
    case "donutSquare":
      return macro(dcode, [
        `21,1,${f(shape.od)},${f(shape.od)},0,0,0*`,
        `21,0,${f(shape.id)},${f(shape.id)},0,0,0*`,
      ]);
    case "donutRect":
      return macro(dcode, [
        `21,1,${f(shape.ow)},${f(shape.oh)},0,0,0*`,
        `21,0,${f(Math.max(shape.ow - 2 * shape.lw, 0))},${f(Math.max(shape.oh - 2 * shape.lw, 0))},0,0,0*`,
      ]);
    case "donutOval":
      return macro(dcode, [
        ...ovalPrimitives(shape.ow, shape.oh, 1),
        ...ovalPrimitives(shape.ow - 2 * shape.lw, shape.oh - 2 * shape.lw, 0),
      ]);
    case "roundedRect":
      return macro(dcode, [outlinePrimitive(roundedRectPoints(shape))]);
    case "chamferedRect":
      return macro(dcode, [outlinePrimitive(chamferedRectPoints(shape))]);
    case "diamond":
      return macro(dcode, [
        outlinePrimitive([
          [shape.w / 2, 0],
          [0, shape.h / 2],
          [-shape.w / 2, 0],
          [0, -shape.h / 2],
        ]),
      ]);
    case "octagon":
      return macro(dcode, [
        outlinePrimitive(chamferedRectPoints({ w: shape.w, h: shape.h, c: shape.r, corners: new Set([1, 2, 3, 4]) })),
      ]);
    case "hexagon": {
      const { w, h, r } = shape;
      const points = shape.vertical
        ? [[0, h / 2], [-w / 2, h / 2 - r], [-w / 2, -(h / 2 - r)], [0, -h / 2], [w / 2, -(h / 2 - r)], [w / 2, h / 2 - r]]
        : [[w / 2, 0], [w / 2 - r, h / 2], [-(w / 2 - r), h / 2], [-w / 2, 0], [-(w / 2 - r), -h / 2], [w / 2 - r, -h / 2]];
      return macro(dcode, [outlinePrimitive(points)]);
    }
    case "triangle":
      return macro(dcode, [
        outlinePrimitive([
          [-shape.base / 2, -shape.h / 2],
          [shape.base / 2, -shape.h / 2],
          [0, shape.h / 2],
        ]),
      ]);
    case "ellipse":
      return macro(dcode, [outlinePrimitive(ellipsePoints(shape.w, shape.h))]);
    case "butterflyRound": {
      const r = shape.d / 2;
      return macro(dcode, [
        outlinePrimitive([[0, 0], ...arcPoints(0, 0, r, 0, 90, OUTLINE_ARC_SEGMENTS)]),
        outlinePrimitive([[0, 0], ...arcPoints(0, 0, r, 180, 270, OUTLINE_ARC_SEGMENTS)]),
      ]);
    }
    case "butterflySquare": {
      const s = shape.s / 2;
      return macro(dcode, [
        outlinePrimitive([[0, 0], [s, 0], [s, s], [0, s]]),
        outlinePrimitive([[0, 0], [-s, 0], [-s, -s], [0, -s]]),
      ]);
    }
    default:
      throw new Error(`Unsupported symbol shape ${shape.kind}`);
  }
}

function macro(dcode, primitives) {
  const name = `ODB${dcode}`;
  return {
    macro: [`%AM${name}*`, ...primitives, "%"].join("\n"),
    add: `%ADD${dcode}${name}*%`,
  };
}

function outlinePrimitive(points) {
  const closed = points.slice(0, MAX_OUTLINE_VERTICES - 1);
  const coordinates = [...closed, closed[0]]
    .map(([x, y]) => `${formatMm(x)},${formatMm(y)}`)
    .join(",");
  return `4,1,${closed.length},${coordinates},0*`;
}

function ovalPrimitives(w, h, exposure) {
  if (w <= 0 || h <= 0) return [];
  const f = formatMm;
  if (Math.abs(w - h) < 1e-9) {
    return [`1,${exposure},${f(w)},0,0*`];
  }
  if (w > h) {
    const offset = (w - h) / 2;
    return [
      `21,${exposure},${f(w - h)},${f(h)},0,0,0*`,
      `1,${exposure},${f(h)},${f(-offset)},0*`,
      `1,${exposure},${f(h)},${f(offset)},0*`,
    ];
  }
  const offset = (h - w) / 2;
  return [
    `21,${exposure},${f(w)},${f(h - w)},0,0,0*`,
    `1,${exposure},${f(w)},0,${f(-offset)}*`,
    `1,${exposure},${f(w)},0,${f(offset)}*`,
  ];
}

// Corner numbering: 1 = top-right, 2 = top-left, 3 = bottom-left, 4 = bottom-right.
const CORNER_SIGNS = { 1: [1, 1], 2: [-1, 1], 3: [-1, -1], 4: [1, -1] };
const CORNER_START_ANGLE = { 1: 0, 2: 90, 3: 180, 4: 270 };

function roundedRectPoints({ w, h, r, corners }) {
  const radius = Math.min(r, w / 2, h / 2);
  const points = [];
  for (const corner of [1, 2, 3, 4]) {
    const [sx, sy] = CORNER_SIGNS[corner];
    if (corners.has(corner) && radius > 0) {
      const cx = sx * (w / 2 - radius);
      const cy = sy * (h / 2 - radius);
      const start = CORNER_START_ANGLE[corner];
      points.push(...arcPoints(cx, cy, radius, start, start + 90, OUTLINE_ARC_SEGMENTS));
    } else {
      points.push([sx * (w / 2), sy * (h / 2)]);
    }
  }
  return points;
}

function chamferedRectPoints({ w, h, c, corners }) {
  const cut = Math.min(c, w / 2, h / 2);
  const points = [];
  for (const corner of [1, 2, 3, 4]) {
    const [sx, sy] = CORNER_SIGNS[corner];
    if (corners.has(corner) && cut > 0) {
      // Counter-clockwise order around the outline.
      const first = corner === 1 || corner === 3
        ? [sx * (w / 2), sy * (h / 2 - cut)]
        : [sx * (w / 2 - cut), sy * (h / 2)];
      const second = corner === 1 || corner === 3
        ? [sx * (w / 2 - cut), sy * (h / 2)]
        : [sx * (w / 2), sy * (h / 2 - cut)];
      points.push(first, second);
    } else {
      points.push([sx * (w / 2), sy * (h / 2)]);
    }
  }
  return points;
}

function ellipsePoints(w, h) {
  const points = [];
  for (let index = 0; index < ELLIPSE_SEGMENTS; index++) {
    const angle = (index / ELLIPSE_SEGMENTS) * Math.PI * 2;
    points.push([(w / 2) * Math.cos(angle), (h / 2) * Math.sin(angle)]);
  }
  return points;
}

function arcPoints(cx, cy, radius, startDeg, endDeg, segments) {
  const points = [];
  for (let index = 0; index <= segments; index++) {
    const angle = ((startDeg + ((endDeg - startDeg) * index) / segments) * Math.PI) / 180;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}
