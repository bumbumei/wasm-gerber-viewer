import {
  ApertureTable,
  formatMm,
  isSolidCircleShape,
  parseStandardSymbol,
  resizeShape,
  shapePenDiameter,
} from "./symbols.js";
import { MAX_USER_SYMBOL_DEPTH, createPadPlacement, placeRecord } from "./user-symbols.js";

/** Upper bound on records produced by expanding user symbols in one layer. */
export const MAX_EXPANDED_RECORDS = 2_000_000;

/** Coordinates use the fixed %FSLAX46Y46 format: integer nanometres of mm. */
export function formatCoordinate(value) {
  const scaled = Math.round(value * 1e6);
  return String(scaled === 0 ? 0 : scaled);
}

export const NO_GEOMETRY_MESSAGE =
  "File does not contain valid Gerber data (no geometry found)";

/**
 * ODB++ rotates a pad clockwise first and mirrors second ("mirror in x-axis"
 * flips y). Gerber applies mirroring before rotation and rotates
 * counter-clockwise, and M · R(t) = R(-t) · M, so a mirrored pad keeps the
 * ODB angle while an unmirrored pad negates it.
 */
export function gerberTransformForOrient(angleDeg, mirror) {
  const angle = Number.isFinite(angleDeg) ? angleDeg : 0;
  const rotation = mirror ? angle : -angle;
  const normalized = ((rotation % 360) + 360) % 360;
  return { rotation: normalized, mirror: Boolean(mirror) };
}

/**
 * Convert parsed ODB++ features into RS-274X text. Returns `null` when the
 * layer has nothing drawable.
 */
/**
 * `surfaceMode` "fill" renders surfaces as filled regions; "outline" strokes
 * their contours with a thin round pen (used for the step profile so it
 * behaves like a conventional board-outline layer).
 *
 * `userSymbols` maps lower-cased user symbol names to their parsed
 * `symbols/<name>/features`; pads that reference them are expanded in place
 * (recursively for nested symbols). Symbols missing from the map are counted
 * and skipped.
 */
export function featuresToGerber(
  features,
  {
    apertureTable = new ApertureTable(),
    header = {},
    symbolShapes,
    surfaceMode = "fill",
    outlineWidth = 0.1,
    userSymbols = null,
  } = {},
) {
  const stats = {
    pads: 0,
    lines: 0,
    arcs: 0,
    surfaces: 0,
    skippedText: features.counts?.texts ?? 0,
    skippedBarcodes: features.counts?.barcodes ?? 0,
    userSymbolPads: 0,
    userSymbols: new Set(),
    expandedPads: 0,
    expandedSymbols: new Set(),
    resizedUserSymbols: new Set(),
    unknownSymbols: new Set(),
    nonRoundLines: 0,
    expansionTruncated: false,
  };

  const shapes = symbolShapes ?? resolveSymbolShapes(features, stats);
  // Shape tables of user symbol files, resolved once each.
  const symbolShapeCache = new Map();
  const shapesOf = (symbolFeatures) => {
    if (!symbolShapeCache.has(symbolFeatures)) {
      symbolShapeCache.set(symbolFeatures, resolveSymbolShapes(symbolFeatures, stats));
    }
    return symbolShapeCache.get(symbolFeatures);
  };
  let expandedRecords = 0;
  const body = [];
  const state = { dcode: null, clear: false, rotation: 0, mirror: false, g: 1 };
  let drew = false;

  const setPolarity = (neg) => {
    if (state.clear !== neg) {
      state.clear = neg;
      body.push(neg ? "%LPC*%" : "%LPD*%");
    }
  };
  const setAperture = (dcode) => {
    if (state.dcode !== dcode) {
      state.dcode = dcode;
      body.push(`D${dcode}*`);
    }
  };
  const setTransform = (rotation, mirror) => {
    if (state.mirror !== mirror) {
      state.mirror = mirror;
      body.push(mirror ? "%LMY*%" : "%LMN*%");
    }
    if (state.rotation !== rotation) {
      state.rotation = rotation;
      body.push(`%LR${formatMm(rotation)}*%`);
    }
  };
  const resetTransform = () => setTransform(0, false);
  const setInterpolation = (g) => {
    if (state.g !== g) {
      state.g = g;
      body.push(g === 1 ? "G01*" : g === 2 ? "G02*" : "G03*");
    }
  };
  const move = (x, y) => body.push(`X${formatCoordinate(x)}Y${formatCoordinate(y)}D02*`);
  const lineTo = (x, y) => {
    setInterpolation(1);
    body.push(`X${formatCoordinate(x)}Y${formatCoordinate(y)}D01*`);
  };
  const arcTo = (x, y, cx, cy, fromX, fromY, cw) => {
    setInterpolation(cw ? 2 : 3);
    body.push(
      `X${formatCoordinate(x)}Y${formatCoordinate(y)}I${formatCoordinate(cx - fromX)}J${formatCoordinate(cy - fromY)}D01*`,
    );
  };
  const flash = (x, y) => body.push(`X${formatCoordinate(x)}Y${formatCoordinate(y)}D03*`);

  const penFor = ({ features, shapes }, symIndex, resize) => {
    const resolved = shapeFor(shapes, symIndex, resize, features.symbolScale);
    if (!resolved) return null;
    if (isSolidCircleShape(resolved)) {
      return { dcode: apertureTable.dcodeFor(resolved), shape: resolved, round: true };
    }
    return { dcode: null, shape: resolved, round: false };
  };

  for (const record of features.records) {
    emitRecord(record, { features, shapes }, 0);
  }

  function emitRecord(record, context, depth) {
    const { features, shapes } = context;
    switch (record.t) {
      case "P": {
        const shape = shapeFor(shapes, record.sym, record.resize, features.symbolScale);
        if (!shape) {
          const symbolName = features.symbols.get(record.sym)?.name ?? `#${record.sym}`;
          const symbolFeatures = userSymbols?.get(symbolName.toLowerCase()) ?? null;
          if (symbolFeatures && depth < MAX_USER_SYMBOL_DEPTH) {
            expandUserSymbol(record, symbolName, symbolFeatures, depth);
          } else {
            stats.userSymbolPads += 1;
            stats.userSymbols.add(symbolName);
          }
          break;
        }
        if (isEmptyShape(shape)) break;
        const dcode = apertureTable.dcodeFor(shape);
        const transform = gerberTransformForOrient(record.angleDeg, record.mirror);
        setPolarity(record.neg);
        setTransform(transform.rotation, transform.mirror);
        setAperture(dcode);
        flash(record.x, record.y);
        stats.pads += 1;
        drew = true;
        break;
      }
      case "L": {
        const pen = penFor(context, record.sym, 0);
        if (!pen) {
          stats.userSymbolPads += 1;
          break;
        }
        resetTransform();
        setPolarity(record.neg);
        const zeroLength = record.xs === record.xe && record.ys === record.ye;
        if (pen.round) {
          setAperture(pen.dcode);
          if (zeroLength) {
            flash(record.xs, record.ys);
          } else {
            move(record.xs, record.ys);
            lineTo(record.xe, record.ye);
          }
        } else if (pen.shape.kind === "rect" && pen.shape.w === pen.shape.h && !zeroLength) {
          emitSquareStroke(record, pen.shape.w);
        } else {
          const diameter = shapePenDiameter(pen.shape);
          if (diameter <= 0) break;
          if (zeroLength) {
            // A zero-length line is a flash of the symbol itself, so the
            // shape is exact and nothing is approximated.
            setAperture(apertureTable.dcodeFor(pen.shape));
            flash(record.xs, record.ys);
          } else {
            stats.nonRoundLines += 1;
            setAperture(apertureTable.dcodeFor({ kind: "circle", d: diameter }));
            move(record.xs, record.ys);
            lineTo(record.xe, record.ye);
          }
        }
        stats.lines += 1;
        drew = true;
        break;
      }
      case "A": {
        const pen = penFor(context, record.sym, 0);
        if (!pen) {
          stats.userSymbolPads += 1;
          break;
        }
        const diameter = pen.round ? pen.shape.d : shapePenDiameter(pen.shape);
        if (diameter <= 0) break;
        if (!pen.round) stats.nonRoundLines += 1;
        resetTransform();
        setPolarity(record.neg);
        setAperture(apertureTable.dcodeFor({ kind: "circle", d: diameter }));
        move(record.xs, record.ys);
        arcTo(record.xe, record.ye, record.xc, record.yc, record.xs, record.ys, record.cw);
        stats.arcs += 1;
        drew = true;
        break;
      }
      case "S": {
        resetTransform();
        setPolarity(record.neg);
        const emitted =
          surfaceMode === "outline" ? emitSurfaceOutline(record) : emitSurface(record);
        if (emitted) {
          stats.surfaces += 1;
          drew = true;
        }
        break;
      }
      default:
        break;
    }
  }

  /** Draw every record of a user symbol at the pad that references it. */
  function expandUserSymbol(pad, symbolName, symbolFeatures, depth) {
    if (expandedRecords + symbolFeatures.records.length > MAX_EXPANDED_RECORDS) {
      stats.expansionTruncated = true;
      stats.userSymbolPads += 1;
      stats.userSymbols.add(symbolName);
      return;
    }
    if (pad.resize) stats.resizedUserSymbols.add(symbolName);
    stats.expandedPads += 1;
    stats.expandedSymbols.add(symbolName);
    stats.skippedText += symbolFeatures.counts?.texts ?? 0;
    stats.skippedBarcodes += symbolFeatures.counts?.barcodes ?? 0;
    expandedRecords += symbolFeatures.records.length;
    const placement = createPadPlacement(pad);
    const context = { features: symbolFeatures, shapes: shapesOf(symbolFeatures) };
    for (const record of symbolFeatures.records) {
      emitRecord(placeRecord(record, placement), context, depth + 1);
    }
  }

  function emitSquareStroke(record, width) {
    const dx = record.xe - record.xs;
    const dy = record.ye - record.ys;
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    const half = width / 2;
    const nx = -uy * half;
    const ny = ux * half;
    const sx = record.xs - ux * half;
    const sy = record.ys - uy * half;
    const ex = record.xe + ux * half;
    const ey = record.ye + uy * half;
    body.push("G36*");
    move(sx + nx, sy + ny);
    lineTo(ex + nx, ey + ny);
    lineTo(ex - nx, ey - ny);
    lineTo(sx - nx, sy - ny);
    lineTo(sx + nx, sy + ny);
    body.push("G37*");
  }

  /** Stroke every island and hole contour instead of filling the surface. */
  function emitSurfaceOutline(surface) {
    let emitted = false;
    for (const polygon of surface.polygons) {
      if (polygon.segments.length === 0) continue;
      const loop = polygonLoop(polygon);
      if (loop.length < 2) continue;
      setAperture(apertureTable.dcodeFor({ kind: "circle", d: outlineWidth }));
      move(loop[0].x, loop[0].y);
      let cursor = loop[0];
      for (let index = 1; index <= loop.length; index++) {
        cursor = emitEdge(cursor, loop[index % loop.length]);
      }
      emitted = true;
    }
    return emitted;
  }

  function emitSurface(surface) {
    let emitted = false;
    let island = null;
    let holes = [];
    const flush = () => {
      if (island) {
        emitIsland(island, holes);
        emitted = true;
      }
      island = null;
      holes = [];
    };
    for (const polygon of surface.polygons) {
      if (polygon.segments.length === 0) continue;
      if (polygon.hole) {
        if (island) holes.push(polygon);
        continue;
      }
      flush();
      island = polygon;
    }
    flush();
    return emitted;
  }

  function emitIsland(island, holes) {
    const islandLoop = polygonLoop(island);
    const attached = new Map();
    for (const hole of holes) {
      let holeLoop = polygonLoop(hole);
      // A cut-in hole must run opposite to its island.
      if (Math.sign(signedArea(holeLoop)) === Math.sign(signedArea(islandLoop))) {
        holeLoop = reverseLoop(holeLoop);
      }
      const { islandIndex, holeIndex } = nearestVertices(islandLoop, holeLoop);
      const list = attached.get(islandIndex) ?? [];
      list.push(rotateLoop(holeLoop, holeIndex));
      attached.set(islandIndex, list);
    }

    body.push("G36*");
    const start = islandLoop[0];
    move(start.x, start.y);
    let cursor = start;
    const emitAttachedHoles = (index) => {
      for (const holeLoop of attached.get(index) ?? []) {
        const holeStart = holeLoop[0];
        lineTo(holeStart.x, holeStart.y);
        let holeCursor = holeStart;
        for (let step = 1; step <= holeLoop.length; step++) {
          const vertex = holeLoop[step % holeLoop.length];
          holeCursor = emitEdge(holeCursor, vertex);
        }
        lineTo(cursor.x, cursor.y);
      }
    };
    emitAttachedHoles(0);
    for (let index = 1; index <= islandLoop.length; index++) {
      const vertex = islandLoop[index % islandLoop.length];
      cursor = emitEdge(cursor, vertex);
      if (index < islandLoop.length) emitAttachedHoles(index);
    }
    body.push("G37*");
  }

  function emitEdge(from, vertex) {
    if (vertex.arc) {
      arcTo(vertex.x, vertex.y, vertex.arc.cx, vertex.arc.cy, from.x, from.y, vertex.arc.cw);
    } else if (vertex.x !== from.x || vertex.y !== from.y) {
      lineTo(vertex.x, vertex.y);
    }
    return vertex;
  }

  if (!drew) return null;

  const title = `${header.job ?? "job"}/${header.step ?? "step"}/${header.layer ?? "layer"}`
    .replace(/[*%]/g, "_");
  const text = [
    `G04 ODB++ ${title}*`,
    "%FSLAX46Y46*%",
    "%MOMM*%",
    ...apertureTable.emitDefinitions(),
    "G75*",
    "G01*",
    "%LPD*%",
    ...body,
    "M02*",
    "",
  ].join("\n");

  return { text, stats };
}

/**
 * Resolve every symbol of a features file to a shape (or null for user
 * symbols), recording unknown standard families that fall back to circles.
 */
export function resolveSymbolShapes(features, stats) {
  const shapes = new Map();
  for (const [index, symbol] of features.symbols) {
    const parsed = parseStandardSymbol(symbol.name, features.symbolScale);
    let shape = null;
    if (parsed?.kind === "unsupported") {
      if (parsed.fallbackDiameter > 0) {
        shape = { kind: "circle", d: parsed.fallbackDiameter };
      }
      stats?.unknownSymbols.add(symbol.name);
    } else if (parsed) {
      shape = parsed;
    }
    // User-defined symbols (parsed === null) stay null here; the records
    // that reference them decide whether they are expanded or reported.
    if (shape && symbol.resize) {
      shape = resizeShape(shape, symbol.resize * features.symbolScale);
    }
    shapes.set(index, shape);
  }
  return shapes;
}

/** Shapes with no area (e.g. the `r0` pen some CAM tools use) draw nothing. */
function isEmptyShape(shape) {
  switch (shape.kind) {
    case "circle":
      return !(shape.d > 0);
    case "rect":
    case "oval":
      return !(shape.w > 0 && shape.h > 0);
    default:
      return false;
  }
}

function shapeFor(shapes, symIndex, resize, scale) {
  const shape = shapes.get(symIndex) ?? null;
  if (!shape) return null;
  return resize ? resizeShape(shape, resize * scale) : shape;
}

/** Vertices of a polygon loop; each vertex carries the arc that leads into it, if any. */
function polygonLoop(polygon) {
  const loop = [{ x: polygon.x0, y: polygon.y0, arc: null }];
  for (const segment of polygon.segments) {
    const previous = loop[loop.length - 1];
    const isClosing =
      segment.x === polygon.x0 &&
      segment.y === polygon.y0 &&
      segment.cx === undefined;
    if (isClosing) {
      // Explicit return to the start point closes the loop implicitly.
      continue;
    }
    if (segment.x === previous.x && segment.y === previous.y && segment.cx === undefined) {
      continue;
    }
    loop.push({
      x: segment.x,
      y: segment.y,
      arc: segment.cx === undefined ? null : { cx: segment.cx, cy: segment.cy, cw: segment.cw },
    });
  }
  if (loop.length > 1) {
    const closing = polygon.segments[polygon.segments.length - 1];
    if (closing?.cx !== undefined && closing.x === polygon.x0 && closing.y === polygon.y0) {
      // The final segment is an arc back to the start: keep it as the arc into vertex 0.
      loop[0].arc = { cx: closing.cx, cy: closing.cy, cw: closing.cw };
      loop.pop();
    }
  }
  return loop;
}

function signedArea(loop) {
  let area = 0;
  for (let index = 0; index < loop.length; index++) {
    const a = loop[index];
    const b = loop[(index + 1) % loop.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/** Reverse a loop, moving each arc to the edge it now leads into and flipping its direction. */
function reverseLoop(loop) {
  const count = loop.length;
  const reversed = [];
  for (let index = 0; index < count; index++) {
    const vertex = loop[(count - index) % count];
    const nextInOriginal = loop[(count - index + 1) % count];
    const arc = nextInOriginal.arc ? { ...nextInOriginal.arc, cw: !nextInOriginal.arc.cw } : null;
    reversed.push({ x: vertex.x, y: vertex.y, arc });
  }
  return reversed;
}

function rotateLoop(loop, startIndex) {
  return loop.slice(startIndex).concat(loop.slice(0, startIndex));
}

function nearestVertices(islandLoop, holeLoop) {
  let best = { islandIndex: 0, holeIndex: 0, distance: Number.POSITIVE_INFINITY };
  const islandStep = Math.max(1, Math.floor(islandLoop.length / 512));
  const holeStep = Math.max(1, Math.floor(holeLoop.length / 128));
  for (let h = 0; h < holeLoop.length; h += holeStep) {
    const hv = holeLoop[h];
    for (let i = 0; i < islandLoop.length; i += islandStep) {
      const iv = islandLoop[i];
      const distance = (iv.x - hv.x) ** 2 + (iv.y - hv.y) ** 2;
      if (distance < best.distance) {
        best = { islandIndex: i, holeIndex: h, distance };
      }
    }
  }
  return best;
}
