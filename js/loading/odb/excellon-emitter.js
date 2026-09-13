import { formatMm, isSolidCircleShape, shapePenDiameter } from "./symbols.js";
import { resolveSymbolShapes } from "./gerber-emitter.js";

const TOOL_MATCH_TOLERANCE_MM = 0.001;

/**
 * Convert an ODB++ DRILL or ROUT layer into Excellon text. Returns one entry
 * per plating class present (`-pth`, `-npth`), or a single entry with an empty
 * suffix when the layer has one class only. Returns an empty array when the
 * layer has no drill features.
 */
export function drillLayerToExcellon(features, toolsInfo, { header = {}, kind = "drill" } = {}) {
  const stats = {
    hits: 0,
    slots: 0,
    routArcs: 0,
    skippedSurfaces: features.counts?.surfaces ?? 0,
    skippedText: features.counts?.texts ?? 0,
    userSymbols: new Set(),
    unknownSymbols: new Set(),
  };
  const shapes = resolveSymbolShapes(features, stats);
  const tools = toolsInfo?.tools ?? [];
  const groups = new Map(); // plating class -> { toolByDiameter: Map, commands: [] }

  const diameterFor = (record) => {
    const shape = shapes.get(record.sym);
    if (!shape) {
      stats.userSymbols.add(features.symbols.get(record.sym)?.name ?? `#${record.sym}`);
      return null;
    }
    const diameter = isSolidCircleShape(shape) ? shape.d : shapePenDiameter(shape);
    return diameter > 0 ? diameter : null;
  };
  const platingFor = (record, diameter) => {
    const byNumber = tools.find((tool) => tool.num === record.dcode && record.dcode > 0);
    const bySize =
      byNumber ??
      tools.find(
        (tool) =>
          tool.finishSize != null &&
          Math.abs(tool.finishSize - diameter) <= TOOL_MATCH_TOLERANCE_MM,
      );
    return bySize?.type === "NON_PLATED" ? "npth" : "pth";
  };
  const groupFor = (plating) => {
    let group = groups.get(plating);
    if (!group) {
      group = { toolByDiameter: new Map(), commands: [] };
      groups.set(plating, group);
    }
    return group;
  };
  const toolFor = (group, diameter) => {
    const key = formatMm(diameter);
    let tool = group.toolByDiameter.get(key);
    if (!tool) {
      tool = { number: group.toolByDiameter.size + 1, diameter };
      group.toolByDiameter.set(key, tool);
    }
    return tool;
  };

  for (const record of features.records) {
    if (record.t !== "P" && record.t !== "L" && record.t !== "A") continue;
    const diameter = diameterFor(record);
    if (diameter == null) continue;
    const group = groupFor(platingFor(record, diameter));
    const tool = toolFor(group, diameter);

    if (record.t === "P") {
      group.commands.push({ tool: tool.number, text: `X${f(record.x)}Y${f(record.y)}` });
      stats.hits += 1;
    } else if (record.t === "L") {
      if (record.xs === record.xe && record.ys === record.ye) {
        group.commands.push({ tool: tool.number, text: `X${f(record.xs)}Y${f(record.ys)}` });
        stats.hits += 1;
      } else {
        group.commands.push({
          tool: tool.number,
          text: `X${f(record.xs)}Y${f(record.ys)}G85X${f(record.xe)}Y${f(record.ye)}`,
        });
        stats.slots += 1;
      }
    } else {
      const gcode = record.cw ? "G02" : "G03";
      group.commands.push({
        tool: tool.number,
        text: [
          `G00X${f(record.xs)}Y${f(record.ys)}`,
          "M15",
          `${gcode}X${f(record.xe)}Y${f(record.ye)}I${f(record.xc - record.xs)}J${f(record.yc - record.ys)}`,
          "M16",
          "G05",
        ].join("\n"),
      });
      stats.routArcs += 1;
    }
  }

  const platings = Array.from(groups.keys());
  const outputs = [];
  for (const plating of platings) {
    const group = groups.get(plating);
    const suffix = platings.length > 1 || plating === "npth" ? `-${plating}` : "";
    outputs.push({
      suffix,
      plating,
      hitCount: group.commands.length,
      toolCount: group.toolByDiameter.size,
      text: renderExcellon(group, { header, kind, plating }),
    });
  }

  return { outputs, stats };
}

function renderExcellon(group, { header, kind, plating }) {
  const title = `${header.job ?? "job"}/${header.step ?? "step"}/${header.layer ?? "layer"}`
    .replace(/[;\r\n]/g, "_");
  const lines = [
    "M48",
    `; ODB++ ${kind} ${title} (${plating})`,
    "METRIC,TZ",
  ];
  for (const tool of group.toolByDiameter.values()) {
    lines.push(`T${String(tool.number).padStart(2, "0")}C${f(tool.diameter)}`);
  }
  lines.push("%", "G90", "G05");
  let currentTool = null;
  for (const command of group.commands) {
    if (command.tool !== currentTool) {
      currentTool = command.tool;
      lines.push(`T${String(currentTool).padStart(2, "0")}`);
    }
    lines.push(command.text);
  }
  lines.push("M30", "");
  return lines.join("\n");
}

/** Excellon coordinates always carry a decimal point so no zero-suppression format applies. */
function f(value) {
  const text = formatMm(value);
  return text.includes(".") ? text : `${text}.0`;
}
