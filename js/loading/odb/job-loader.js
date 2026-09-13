import { decodeText } from "./archive/job-tree.js";
import { drillLayerToExcellon } from "./excellon-emitter.js";
import { NO_GEOMETRY_MESSAGE, featuresToGerber } from "./gerber-emitter.js";
import { parseFeatures } from "./features.js";
import { PROFILE_FILE_NAME, assignLayerFileNames } from "./layer-naming.js";
import { DRILL_LAYER_TYPES, isImportableBoardLayer, parseMatrix } from "./matrix.js";
import { parseStepHeader } from "./step-header.js";
import { parseStructuredText, unitsFromValue } from "./structured-text.js";
import { parseTools } from "./tools.js";
import { UserSymbolLibrary } from "./user-symbols.js";

/**
 * Read the job-level files of an ODB++ tree.
 */
export async function loadOdbJob(tree, { jobName = "job", onStage = () => {} } = {}) {
  if (!tree.has("matrix/matrix")) {
    throw new Error(`${jobName} is not an ODB++ job (matrix/matrix not found)`);
  }
  onStage("Reading ODB++ job");
  const matrix = parseMatrix(await tree.readText("matrix/matrix"));
  if (matrix.steps.length === 0) {
    throw new Error(`${jobName} has no steps in matrix/matrix`);
  }

  let units = "inch";
  let name = jobName;
  if (tree.has("misc/info")) {
    const info = parseStructuredText(await tree.readText("misc/info")).values;
    units = unitsFromValue(info.get("UNITS") ?? info.get("ODB_UNITS"), units);
    name = info.get("JOB_NAME") || info.get("ODB_JOB_NAME") || name;
  }

  return { name, units, matrix, tree };
}

/**
 * Pick the step to import: an explicit request, a step named like "pcb", the
 * first step that is not a panel (no STEP-REPEAT), else the first step.
 */
export async function selectDefaultStep(job, preferredName = null) {
  const steps = job.matrix.steps;
  if (preferredName) {
    const match = steps.find((step) => step.name.toLowerCase() === String(preferredName).toLowerCase());
    if (match) return match.name;
  }
  if (steps.length === 1) return steps[0].name;

  const pcbLike = steps.find((step) => /pcb/i.test(step.name));
  if (pcbLike) return pcbLike.name;

  for (const step of steps) {
    const headerPath = `steps/${step.name}/stephdr`;
    if (!job.tree.has(headerPath)) return step.name;
    const header = parseStepHeader(await job.tree.readText(headerPath));
    if (header.stepRepeats.length === 0) return step.name;
  }
  return steps[0].name;
}

/**
 * Build viewer layer sources for one step. Features are read up front (so the
 * archive byte budget applies) and converted to Gerber/Excellon lazily inside
 * `readText`, exactly once per source.
 */
export async function createOdbLayerSources(
  job,
  { stepName, onWarning = () => {}, onInfo = () => {}, onStage = () => {} } = {},
) {
  const sources = [];
  const stepPrefix = `steps/${stepName}`;
  const header = { job: job.name, step: stepName };
  const symbolLibrary = new UserSymbolLibrary(job.tree);

  const profilePath = `${stepPrefix}/profile`;
  if (job.tree.has(profilePath)) {
    onStage(`Reading ${PROFILE_FILE_NAME}`);
    const bytes = await job.tree.readBytes(profilePath);
    sources.push(
      createGerberSource(PROFILE_FILE_NAME, bytes, { ...header, layer: "profile" }, onWarning, {
        surfaceMode: "outline",
        symbolLibrary,
      }),
    );
  } else {
    onWarning(job.name, `Step ${stepName} has no profile; board outline unavailable`);
  }

  const names = assignLayerFileNames(job.matrix.layers);
  const skipped = new Map();
  for (const layer of job.matrix.layers) {
    if (!isImportableBoardLayer(layer)) {
      const key = layer.context === "BOARD" ? layer.type || "UNKNOWN" : `${layer.context}/${layer.type}`;
      skipped.set(key, (skipped.get(key) ?? 0) + 1);
      continue;
    }

    const naming = names.get(layer.name);
    const layerDir = `${stepPrefix}/layers/${layer.name.toLowerCase()}`;
    const featuresPath = `${layerDir}/features`;
    if (!job.tree.has(featuresPath)) {
      onWarning(job.name, `Layer ${layer.name} has no features file; skipped`);
      continue;
    }

    onStage(`Reading ${naming.fileName}`);
    const bytes = await job.tree.readBytes(featuresPath);
    if (!hasFeatureRecords(bytes)) {
      onWarning(naming.fileName, "Layer has no features; skipped");
      continue;
    }
    const layerHeader = { ...header, layer: layer.name };

    if (layer.polarity === "NEGATIVE") {
      onWarning(naming.fileName, "Negative-polarity layer rendered as positive");
    }

    if (DRILL_LAYER_TYPES.has(layer.type)) {
      const toolsPath = `${layerDir}/tools`;
      const toolsText = job.tree.has(toolsPath) ? await job.tree.readText(toolsPath) : "";
      sources.push(
        ...(await createDrillSources(naming.fileName, bytes, toolsText, {
          header: layerHeader,
          kind: layer.type === "ROUT" ? "rout" : "drill",
          defaultUnits: job.units,
          onWarning,
        })),
      );
    } else {
      sources.push(
        createGerberSource(naming.fileName, bytes, layerHeader, onWarning, { symbolLibrary }),
      );
    }
  }

  if (skipped.size > 0) {
    const summary = Array.from(skipped, ([type, count]) => `${type} x${count}`).join(", ");
    const total = Array.from(skipped.values()).reduce((sum, count) => sum + count, 0);
    onWarning(job.name, `Skipped ${total} non-board layer${total === 1 ? "" : "s"}: ${summary}`);
  }
  if (job.matrix.steps.length > 1) {
    const others = job.matrix.steps.filter((step) => step.name !== stepName).map((step) => step.name);
    onInfo(job.name, `Loaded step ${stepName}; other steps not imported: ${others.join(", ")}`);
    onWarning(job.name, `Loaded step ${stepName}; other steps not imported: ${others.join(", ")}`);
  }

  return sources;
}

const FEATURE_RECORD_PATTERN = /^[PLAST] |^B /m;

/** Cheap check for at least one feature record before converting a layer. */
export function hasFeatureRecords(bytes) {
  return FEATURE_RECORD_PATTERN.test(decodeText(bytes));
}

function createGerberSource(fileName, bytes, header, onWarning, options = {}) {
  const { symbolLibrary = null, ...emitterOptions } = options;
  let promise = null;
  return {
    name: fileName,
    kind: "gerber",
    sizeBytes: bytes.byteLength,
    readText: (onProgress = () => {}) => {
      if (!promise) {
        promise = (async () => {
          const features = parseFeatures(decodeText(bytes));
          const userSymbols = symbolLibrary ? await symbolLibrary.collect(features) : null;
          const result = featuresToGerber(features, { header, userSymbols, ...emitterOptions });
          bytes = null;
          if (!result) {
            throw new Error(NO_GEOMETRY_MESSAGE);
          }
          reportGerberStats(fileName, result.stats, onWarning);
          return result.text;
        })();
      }
      promise.then(
        () => onProgress(1),
        () => onProgress(1),
      );
      return promise;
    },
  };
}

async function createDrillSources(fileName, bytes, toolsText, { header, kind, defaultUnits, onWarning }) {
  // Drill layers are converted eagerly: the plating split decides how many
  // sources exist, which the caller needs before parsing starts.
  const features = parseFeatures(decodeText(bytes));
  const toolsInfo = toolsText ? parseTools(toolsText, { defaultUnits }) : null;
  const { outputs, stats } = drillLayerToExcellon(features, toolsInfo, { header, kind });
  reportDrillStats(fileName, stats, onWarning);
  if (outputs.length === 0) {
    onWarning(fileName, "Drill layer has no holes; skipped");
    return [];
  }
  const stem = fileName.replace(/\.drl$/i, "");
  return outputs.map((output) => ({
    name: `${stem}${output.suffix}.drl`,
    kind: "drill",
    sizeBytes: output.text.length,
    readText: async (onProgress = () => {}) => {
      onProgress(1);
      return output.text;
    },
  }));
}

function reportGerberStats(fileName, stats, onWarning) {
  const notes = [];
  if (stats.skippedText) notes.push(`${stats.skippedText} text record${plural(stats.skippedText)}`);
  if (stats.skippedBarcodes) notes.push(`${stats.skippedBarcodes} barcode${plural(stats.skippedBarcodes)}`);
  if (stats.userSymbolPads) {
    const reason = stats.expansionTruncated ? "expansion limit reached" : "symbol not found in job";
    notes.push(
      `${stats.userSymbolPads} feature${plural(stats.userSymbolPads)} using user-defined symbols (${listNames(stats.userSymbols)}; ${reason})`,
    );
  }
  if (stats.resizedUserSymbols.size) {
    notes.push(`resize ignored on user-defined symbols (${listNames(stats.resizedUserSymbols)})`);
  }
  if (stats.unknownSymbols.size) {
    notes.push(`unknown symbols approximated as circles (${listNames(stats.unknownSymbols)})`);
  }
  if (stats.nonRoundLines) {
    notes.push(`${stats.nonRoundLines} line${plural(stats.nonRoundLines)} with non-round symbols drawn round`);
  }
  if (notes.length) onWarning(fileName, `Skipped or approximated: ${notes.join("; ")}`);
}

function reportDrillStats(fileName, stats, onWarning) {
  const notes = [];
  if (stats.skippedSurfaces) notes.push(`${stats.skippedSurfaces} surface${plural(stats.skippedSurfaces)}`);
  if (stats.skippedText) notes.push(`${stats.skippedText} text record${plural(stats.skippedText)}`);
  if (stats.userSymbols.size) notes.push(`user-defined symbols (${listNames(stats.userSymbols)})`);
  if (stats.unknownSymbols.size) notes.push(`unknown symbols approximated (${listNames(stats.unknownSymbols)})`);
  if (notes.length) onWarning(fileName, `Skipped or approximated: ${notes.join("; ")}`);
}

function listNames(set, limit = 5) {
  const names = Array.from(set);
  const shown = names.slice(0, limit).join(", ");
  return names.length > limit ? `${shown}, +${names.length - limit} more` : shown;
}

function plural(count) {
  return count === 1 ? "" : "s";
}
