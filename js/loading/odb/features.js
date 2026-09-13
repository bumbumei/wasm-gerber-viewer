import { symbolScale, unitScale, unitsFromValue } from "./structured-text.js";

/**
 * Parse an ODB++ `features` file (layer features, profile, or symbol
 * definition). Coordinates are converted to millimeters; symbol dimensions
 * stay in the symbol table as names plus a `symbolScale` (mm per thousandth
 * of the file unit) for the symbol resolver.
 *
 * Record shapes (all lengths in mm):
 *   { t: "P", x, y, sym, resize, neg, dcode, angleDeg, mirror }
 *   { t: "L", xs, ys, xe, ye, sym, neg, dcode }
 *   { t: "A", xs, ys, xe, ye, xc, yc, sym, neg, dcode, cw }
 *   { t: "S", neg, polygons: [{ hole, x0, y0, segments: [{ x, y } | { x, y, cx, cy, cw }] }] }
 *   { t: "T" } and { t: "B" } are counted only.
 */
export function parseFeatures(text) {
  const lines = String(text ?? "").split("\n");
  let units = "inch";
  let unitsDeclared = false;
  let scale = unitScale(units);
  const symbols = new Map();
  const records = [];
  const counts = {
    pads: 0,
    lines: 0,
    arcs: 0,
    surfaces: 0,
    texts: 0,
    barcodes: 0,
    unknown: 0,
  };

  let surface = null;
  let polygon = null;

  const finishPolygon = () => {
    if (surface && polygon) {
      surface.polygons.push(polygon);
    }
    polygon = null;
  };
  const finishSurface = () => {
    finishPolygon();
    if (surface) {
      if (surface.polygons.length > 0) {
        records.push(surface);
        counts.surfaces += 1;
      }
      surface = null;
    }
  };

  for (let rawLine of lines) {
    if (rawLine.length === 0) continue;
    if (rawLine.charCodeAt(rawLine.length - 1) === 13) {
      rawLine = rawLine.slice(0, -1);
    }
    const line = rawLine.trim();
    if (line === "" || line.charCodeAt(0) === 35 /* # */) continue;

    const first = line.charCodeAt(0);

    if (first === 36 /* $ */) {
      const tokens = splitTokens(stripAttributes(line));
      const index = Number.parseInt(tokens[0].slice(1), 10);
      if (Number.isSafeInteger(index) && tokens.length >= 2) {
        const resize = tokens.length >= 3 ? Number.parseFloat(tokens[2]) : 0;
        symbols.set(index, {
          name: tokens[1],
          resize: Number.isFinite(resize) ? resize : 0,
        });
      }
      continue;
    }
    if (first === 64 /* @ */ || first === 38 /* & */) continue;

    if (line.startsWith("UNITS=")) {
      units = unitsFromValue(line.slice(6), units);
      unitsDeclared = true;
      scale = unitScale(units);
      continue;
    }
    if (line.startsWith("ID=") || line.startsWith("F ") || line === "F") continue;

    const tokens = splitTokens(stripAttributes(line));
    const type = tokens[0];

    switch (type) {
      case "P": {
        finishSurface();
        // P x y apt polarity dcode orient   where apt = sym | -1 sym resize
        let index = 1;
        const x = num(tokens[index++]) * scale;
        const y = num(tokens[index++]) * scale;
        let sym;
        let resize = 0;
        if (tokens[index] === "-1") {
          sym = int(tokens[index + 1]);
          resize = num(tokens[index + 2]);
          index += 3;
        } else {
          sym = int(tokens[index++]);
        }
        const neg = tokens[index++] === "N";
        const dcode = int(tokens[index++]);
        const orient = parseOrient(tokens, index);
        records.push({
          t: "P",
          x,
          y,
          sym,
          resize,
          neg,
          dcode,
          angleDeg: orient.angleDeg,
          mirror: orient.mirror,
        });
        counts.pads += 1;
        break;
      }
      case "L": {
        finishSurface();
        records.push({
          t: "L",
          xs: num(tokens[1]) * scale,
          ys: num(tokens[2]) * scale,
          xe: num(tokens[3]) * scale,
          ye: num(tokens[4]) * scale,
          sym: int(tokens[5]),
          neg: tokens[6] === "N",
          dcode: int(tokens[7]),
        });
        counts.lines += 1;
        break;
      }
      case "A": {
        finishSurface();
        records.push({
          t: "A",
          xs: num(tokens[1]) * scale,
          ys: num(tokens[2]) * scale,
          xe: num(tokens[3]) * scale,
          ye: num(tokens[4]) * scale,
          xc: num(tokens[5]) * scale,
          yc: num(tokens[6]) * scale,
          sym: int(tokens[7]),
          neg: tokens[8] === "N",
          dcode: int(tokens[9]),
          cw: tokens[10] === "Y",
        });
        counts.arcs += 1;
        break;
      }
      case "S": {
        finishSurface();
        surface = { t: "S", neg: tokens[1] === "N", polygons: [] };
        break;
      }
      case "OB": {
        if (!surface) break;
        finishPolygon();
        polygon = {
          hole: tokens[3] === "H",
          x0: num(tokens[1]) * scale,
          y0: num(tokens[2]) * scale,
          segments: [],
        };
        break;
      }
      case "OS": {
        if (!polygon) break;
        polygon.segments.push({ x: num(tokens[1]) * scale, y: num(tokens[2]) * scale });
        break;
      }
      case "OC": {
        if (!polygon) break;
        polygon.segments.push({
          x: num(tokens[1]) * scale,
          y: num(tokens[2]) * scale,
          cx: num(tokens[3]) * scale,
          cy: num(tokens[4]) * scale,
          cw: tokens[5] === "Y",
        });
        break;
      }
      case "OE": {
        finishPolygon();
        break;
      }
      case "SE": {
        finishSurface();
        break;
      }
      case "T": {
        finishSurface();
        counts.texts += 1;
        break;
      }
      case "B": {
        finishSurface();
        counts.barcodes += 1;
        break;
      }
      default: {
        counts.unknown += 1;
        break;
      }
    }
  }
  finishSurface();

  return {
    units,
    unitsDeclared,
    symbolScale: symbolScale(units),
    symbols,
    records,
    counts,
  };
}

/**
 * ODB++ pad orientation: 0-7 are legacy quarter turns (4-7 mirrored), 8 and 9
 * are followed by a free angle (9 mirrored). Angles are clockwise degrees.
 */
export function parseOrient(tokens, index) {
  const code = tokens[index];
  if (code === "8" || code === "9") {
    return { angleDeg: normalizeAngle(num(tokens[index + 1])), mirror: code === "9" };
  }
  const legacy = Number.parseInt(code ?? "0", 10);
  if (!Number.isSafeInteger(legacy) || legacy < 0 || legacy > 7) {
    return { angleDeg: 0, mirror: false };
  }
  return { angleDeg: (legacy & 3) * 90, mirror: legacy >= 4 };
}

function normalizeAngle(angle) {
  if (!Number.isFinite(angle)) return 0;
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function stripAttributes(line) {
  const index = line.indexOf(";");
  return index === -1 ? line : line.slice(0, index);
}

export function splitTokens(line) {
  const tokens = [];
  let start = -1;
  for (let index = 0; index <= line.length; index++) {
    const code = index < line.length ? line.charCodeAt(index) : 32;
    const isSpace = code === 32 || code === 9;
    if (isSpace) {
      if (start !== -1) {
        tokens.push(line.slice(start, index));
        start = -1;
      }
    } else if (start === -1) {
      start = index;
    }
  }
  return tokens;
}

function num(token) {
  const value = Number.parseFloat(token ?? "");
  return Number.isFinite(value) ? value : 0;
}

function int(token) {
  const value = Number.parseInt(token ?? "", 10);
  return Number.isSafeInteger(value) ? value : -1;
}
