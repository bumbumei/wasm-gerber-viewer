// Chooses which build of the WASM package each part of the viewer loads.
//
// wasm/pkg is the wasm32 build and wasm/pkg64 the memory64 build. A memory64
// instance can grow past 4 GiB but parses up to a third slower (measure with
// scripts/benchmark-wasm-variants.mjs), so the viewer mixes the two: the main
// instance, which keeps every layer's picking data, runs memory64 where the
// browser supports it, while parse workers stay on wasm32 and a layer is
// parsed again in a memory64 worker only after wasm32 ran out of memory on
// it. A browser without memory64 uses wasm32 for everything.

export const WASM_VARIANT_32 = "wasm32";
export const WASM_VARIANT_64 = "wasm64";
export const WASM_VARIANT_QUERY_PARAM = "wasm";

const BYTES_PER_MIB = 1024 * 1024;
const BYTES_PER_GIB = 1024 * BYTES_PER_MIB;
// Both limits stop 512 MiB short of what the engine lets a memory grow to
// (4 GiB for wasm32, 16 GiB for memory64), so the next payload is refused
// before an allocation inside the module traps.
export const WASM32_LINEAR_MEMORY_LIMIT_BYTES = 3584 * BYTES_PER_MIB;
export const WASM64_LINEAR_MEMORY_LIMIT_BYTES = 16 * BYTES_PER_GIB - 512 * BYTES_PER_MIB;
// navigator.deviceMemory reports at most 8, meaning "8 GiB or more".
const DEVICE_MEMORY_REPORT_CAP_GIB = 8;
// On an empty heap, building a layer's picking index takes 1.5 to 2.4 times
// the size of its compact interaction payload on wasm32 and 2.0 to 2.8 times
// on memory64 (flash, track, region and arc-region layers). About one payload
// of that is working copies the next layer's build reuses, so the factors sit
// below those ranges: larger ones load no faster and leave up to a third of
// the instance unused, smaller ones give most of the speed back.
const PICKING_INDEX_RESERVE_FACTOR = { 32: 1.5, 64: 1.75 };
const MIN_PICKING_INDEX_RESERVE_BYTES = BYTES_PER_MIB;
// A wasm32 instance past this size grows only as far as each allocation needs,
// so reservations never bring it closer to its 4 GiB limit than before.
export const WASM32_PICKING_INDEX_RESERVE_CUTOFF_BYTES = 2 * BYTES_PER_GIB;

// Browsers whose WebAssembly supports memory64 (MDN compatibility data,
// 2026-10). Safari has it only in Technology Preview so far.
export const MEMORY64_BROWSERS = Object.freeze([
  Object.freeze({ name: "Chrome", version: 133 }),
  Object.freeze({ name: "Edge", version: 133 }),
  Object.freeze({ name: "Firefox", version: 134 }),
]);

// Why a main instance runs wasm32: the browser lacks memory64, `?wasm=32`
// pinned it, or the memory64 package failed to load.
export const WASM32_REASON_UNSUPPORTED = "unsupported";
export const WASM32_REASON_PINNED = "pinned";
export const WASM32_REASON_UNAVAILABLE = "unavailable";

// A wasm32 instance this large that traps has most likely run out of address
// space; a trap in a smaller one points at a bug instead.
const WASM32_EXHAUSTED_TRAP_MIN_BYTES = BYTES_PER_GIB;

/** Messages the module and the viewer raise when memory runs out. */
export function isOutOfMemoryMessage(message) {
  return /not enough (webassembly )?memory|too large to (parse|render)|supported limit of \d+ items|per-command limit|out of memory|memory limit reached|array buffer allocation failed/i.test(
    String(message ?? ""),
  );
}

/**
 * Whether more address space could fix a parse failure, in which case it is
 * worth parsing the layer again on memory64. A trap is how an allocation the
 * module cannot recover from surfaces, and a RangeError is the engine refusing
 * an output array. A count past u32 fails on any build.
 */
export function isMemoryExhaustionError(error, message = error?.message) {
  if (/u32 range/i.test(String(message ?? ""))) {
    return false;
  }
  return (
    (typeof WebAssembly !== "undefined" &&
      error instanceof WebAssembly.RuntimeError) ||
    error instanceof RangeError ||
    isOutOfMemoryMessage(message)
  );
}

/**
 * Whether a failure on a wasm32 instance means the data needs more than its
 * 4 GiB, judged strictly enough to tell the user so: an out-of-memory message,
 * or a trap once the instance has grown past 1 GiB.
 */
export function exceedsWasm32Memory({ message, trapped = false, memoryBytes = 0 }) {
  if (/u32 range/i.test(String(message ?? ""))) {
    return false;
  }
  return (
    isOutOfMemoryMessage(message) ||
    (trapped && Number(memoryBytes) >= WASM32_EXHAUSTED_TRAP_MIN_BYTES)
  );
}

// (module (table i64 0 funcref) (memory i64 0)): valid only with memory64.
const MEMORY64_PROBE_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x04, 0x04, 0x01, 0x70, 0x04, 0x00,
  0x05, 0x03, 0x01, 0x04, 0x00,
]);

let memory64Supported = null;

export function supportsMemory64() {
  if (memory64Supported === null) {
    try {
      memory64Supported =
        typeof WebAssembly === "object" &&
        WebAssembly.validate(MEMORY64_PROBE_MODULE);
    } catch (_error) {
      memory64Supported = false;
    }
  }
  return memory64Supported;
}

/**
 * `?wasm=32` runs everything on wasm32 and `?wasm=64` everything on memory64;
 * without the parameter the viewer mixes the two builds.
 */
export function getRequestedWasmVariant(
  search = globalThis.location?.search ?? "",
) {
  const value = new URLSearchParams(search).get(WASM_VARIANT_QUERY_PARAM);
  if (value === "32") return WASM_VARIANT_32;
  if (value === "64") return WASM_VARIANT_64;
  return null;
}

/**
 * Builds the main instance, the parse workers and the out-of-memory retry
 * should use. `fallbackWorker` is null when there is no second build to retry
 * with.
 */
export function resolveWasmVariantPlan({
  requested = getRequestedWasmVariant(),
  memory64 = supportsMemory64(),
} = {}) {
  if (requested === WASM_VARIANT_32 || !memory64) {
    return {
      main: WASM_VARIANT_32,
      worker: WASM_VARIANT_32,
      fallbackWorker: null,
    };
  }
  if (requested === WASM_VARIANT_64) {
    return {
      main: WASM_VARIANT_64,
      worker: WASM_VARIANT_64,
      fallbackWorker: null,
    };
  }
  return {
    main: WASM_VARIANT_64,
    worker: WASM_VARIANT_32,
    fallbackWorker: WASM_VARIANT_64,
  };
}

/**
 * Linear-memory size at which the main instance stops accepting layers.
 * A device that reports less than 8 GiB of RAM keeps a memory64 instance
 * within that amount, and never below the wasm32 limit.
 */
export function getLinearMemoryLimitBytes(
  addressBits,
  deviceMemoryGib = globalThis.navigator?.deviceMemory,
) {
  if (addressBits !== 64) {
    return WASM32_LINEAR_MEMORY_LIMIT_BYTES;
  }
  const deviceMemory = Number(deviceMemoryGib);
  if (
    Number.isFinite(deviceMemory) &&
    deviceMemory > 0 &&
    deviceMemory < DEVICE_MEMORY_REPORT_CAP_GIB
  ) {
    return Math.max(
      WASM32_LINEAR_MEMORY_LIMIT_BYTES,
      Math.min(WASM64_LINEAR_MEMORY_LIMIT_BYTES, deviceMemory * BYTES_PER_GIB),
    );
  }
  return WASM64_LINEAR_MEMORY_LIMIT_BYTES;
}

/**
 * Bytes to grow the main instance by, in one step, before it builds a picking
 * index from `payloadBytes` of compact interaction data; 0 when a reservation
 * is not worth it or would take a wasm32 instance past the cutoff.
 */
export function getPickingIndexReserveBytes({
  addressBits,
  payloadBytes,
  memoryBytes,
}) {
  const is64 = addressBits === 64;
  const reserveBytes = Math.ceil(
    payloadBytes * PICKING_INDEX_RESERVE_FACTOR[is64 ? 64 : 32],
  );
  if (!(reserveBytes >= MIN_PICKING_INDEX_RESERVE_BYTES)) {
    return 0;
  }
  if (
    !is64 &&
    (Number(memoryBytes) || 0) + reserveBytes >
      WASM32_PICKING_INDEX_RESERVE_CUTOFF_BYTES
  ) {
    return 0;
  }
  return reserveBytes;
}

/** Address width of a loaded package: 64 for the memory64 build. */
export function getWasmAddressBits(wasmModule) {
  return typeof wasmModule?.memory_address_bits === "function" &&
    wasmModule.memory_address_bits() === 64
    ? 64
    : 32;
}

export async function loadWasmPackage(variant) {
  const wasmModule =
    variant === WASM_VARIANT_64
      ? await import("../../wasm/pkg64/wasm_gerber_processor.js")
      : await import("../../wasm/pkg/wasm_gerber_processor.js");
  const wasmExports = await wasmModule.default();
  wasmModule.init_panic_hook?.();
  return { wasmModule, wasmExports };
}
