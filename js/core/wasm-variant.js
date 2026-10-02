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
