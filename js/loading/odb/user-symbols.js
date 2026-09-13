import { parseFeatures } from "./features.js";
import { parseStandardSymbol } from "./symbols.js";

/** Nested user symbols deeper than this are reported instead of expanded. */
export const MAX_USER_SYMBOL_DEPTH = 8;

/**
 * User-defined symbols live in `symbols/<name>/features`, an ordinary
 * features file whose coordinates are relative to the symbol origin. The
 * library reads each one once and returns every symbol a layer needs, so the
 * emitter can expand pads that reference them.
 */
export class UserSymbolLibrary {
  constructor(tree) {
    this.tree = tree;
    this.cache = new Map();
  }

  /** Whether a symbol name is a user-defined symbol present in the job. */
  isUserSymbol(name) {
    return parseStandardSymbol(name, 1) === null && this.tree.has(symbolPath(name));
  }

  /** Parsed features of one user symbol, or null when the job has none by that name. */
  load(name) {
    const key = String(name).toLowerCase();
    if (!this.cache.has(key)) {
      const path = symbolPath(name);
      const promise = this.tree.has(path)
        ? this.tree.readText(path).then((text) => parseFeatures(text))
        : Promise.resolve(null);
      this.cache.set(key, promise);
    }
    return this.cache.get(key);
  }

  /**
   * Every user symbol referenced by `features`, directly or through nested
   * symbols, keyed by lower-cased name.
   */
  async collect(features) {
    const result = new Map();
    const queue = [features];
    while (queue.length > 0) {
      const current = queue.pop();
      for (const symbol of current.symbols.values()) {
        const key = symbol.name.toLowerCase();
        if (result.has(key) || parseStandardSymbol(symbol.name, 1) !== null) continue;
        const loaded = await this.load(symbol.name);
        if (!loaded) continue;
        result.set(key, loaded);
        queue.push(loaded);
      }
    }
    return result;
  }
}

function symbolPath(name) {
  return `symbols/${name}/features`;
}

/**
 * The placement of a pad that references a user symbol. ODB++ rotates the
 * symbol clockwise about its origin first, mirrors it about the x-axis
 * second, and then moves it to the pad position.
 */
export function createPadPlacement({ x, y, angleDeg = 0, mirror = false, neg = false }) {
  const radians = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const point = (px, py) => {
    const rx = px * cos + py * sin;
    const ry = -px * sin + py * cos;
    return { x: x + rx, y: y + (mirror ? -ry : ry) };
  };
  return { x, y, angleDeg, mirror, neg, point };
}

/**
 * Move one record of a user symbol into the coordinate system of the pad that
 * flashes it. Polarity is relative to the pad, arc direction flips under
 * mirroring, and nested pad orientations compose as
 * `M^m · R(θ) · M^mi · R(θi) = M^(m⊕mi) · R(mi ? θi − θ : θi + θ)`.
 */
export function placeRecord(record, placement) {
  const neg = record.neg !== placement.neg;
  switch (record.t) {
    case "P": {
      const { x, y } = placement.point(record.x, record.y);
      const angle = placement.mirror
        ? record.angleDeg - placement.angleDeg
        : record.angleDeg + placement.angleDeg;
      return {
        ...record,
        x,
        y,
        neg,
        angleDeg: ((angle % 360) + 360) % 360,
        mirror: record.mirror !== placement.mirror,
      };
    }
    case "L": {
      const start = placement.point(record.xs, record.ys);
      const end = placement.point(record.xe, record.ye);
      return { ...record, xs: start.x, ys: start.y, xe: end.x, ye: end.y, neg };
    }
    case "A": {
      const start = placement.point(record.xs, record.ys);
      const end = placement.point(record.xe, record.ye);
      const center = placement.point(record.xc, record.yc);
      return {
        ...record,
        xs: start.x,
        ys: start.y,
        xe: end.x,
        ye: end.y,
        xc: center.x,
        yc: center.y,
        neg,
        cw: placement.mirror ? !record.cw : record.cw,
      };
    }
    case "S": {
      return {
        ...record,
        neg,
        polygons: record.polygons.map((polygon) => {
          const start = placement.point(polygon.x0, polygon.y0);
          return {
            ...polygon,
            x0: start.x,
            y0: start.y,
            segments: polygon.segments.map((segment) => {
              const end = placement.point(segment.x, segment.y);
              if (segment.cx === undefined) return { x: end.x, y: end.y };
              const center = placement.point(segment.cx, segment.cy);
              return {
                x: end.x,
                y: end.y,
                cx: center.x,
                cy: center.y,
                cw: placement.mirror ? !segment.cw : segment.cw,
              };
            }),
          };
        }),
      };
    }
    default:
      return { ...record, neg };
  }
}
