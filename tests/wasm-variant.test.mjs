import assert from "node:assert/strict";
import test from "node:test";

import {
  MEMORY64_BROWSERS,
  WASM32_LINEAR_MEMORY_LIMIT_BYTES,
  WASM32_PICKING_INDEX_RESERVE_CUTOFF_BYTES,
  WASM64_LINEAR_MEMORY_LIMIT_BYTES,
  WASM_VARIANT_32,
  WASM_VARIANT_64,
  exceedsWasm32Memory,
  getLinearMemoryLimitBytes,
  getPickingIndexReserveBytes,
  getRequestedWasmVariant,
  getWasmAddressBits,
  isMemoryExhaustionError,
  isOutOfMemoryMessage,
  resolveWasmVariantPlan,
} from "../js/core/wasm-variant.js";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

test("only ?wasm=32 and ?wasm=64 pin a build", () => {
  assert.equal(getRequestedWasmVariant("?wasm=32"), WASM_VARIANT_32);
  assert.equal(getRequestedWasmVariant("?url=a.gbr&wasm=64"), WASM_VARIANT_64);
  for (const search of ["", "?wasm=", "?wasm=16", "?wasm=wasm64", "?url=a.gbr"]) {
    assert.equal(getRequestedWasmVariant(search), null, search);
  }
});

test("a memory64 browser mixes a memory64 main instance with wasm32 workers", () => {
  assert.deepEqual(resolveWasmVariantPlan({ requested: null, memory64: true }), {
    main: WASM_VARIANT_64,
    worker: WASM_VARIANT_32,
    fallbackWorker: WASM_VARIANT_64,
  });
});

test("a pinned build is used everywhere and leaves nothing to retry with", () => {
  assert.deepEqual(
    resolveWasmVariantPlan({ requested: WASM_VARIANT_64, memory64: true }),
    { main: WASM_VARIANT_64, worker: WASM_VARIANT_64, fallbackWorker: null },
  );
  assert.deepEqual(
    resolveWasmVariantPlan({ requested: WASM_VARIANT_32, memory64: true }),
    { main: WASM_VARIANT_32, worker: WASM_VARIANT_32, fallbackWorker: null },
  );
});

test("a browser without memory64 runs wasm32 whatever was requested", () => {
  for (const requested of [null, WASM_VARIANT_32, WASM_VARIANT_64]) {
    assert.deepEqual(resolveWasmVariantPlan({ requested, memory64: false }), {
      main: WASM_VARIANT_32,
      worker: WASM_VARIANT_32,
      fallbackWorker: null,
    });
  }
});

test("the main-instance memory limit follows the address width", () => {
  assert.equal(WASM32_LINEAR_MEMORY_LIMIT_BYTES, 3584 * MIB);
  assert.equal(WASM64_LINEAR_MEMORY_LIMIT_BYTES, 16 * GIB - 512 * MIB);
  assert.equal(getLinearMemoryLimitBytes(32, 8), WASM32_LINEAR_MEMORY_LIMIT_BYTES);
  assert.equal(getLinearMemoryLimitBytes(32, undefined), WASM32_LINEAR_MEMORY_LIMIT_BYTES);
  assert.equal(getLinearMemoryLimitBytes(64, 8), WASM64_LINEAR_MEMORY_LIMIT_BYTES);
  // Firefox and Safari do not report device memory.
  assert.equal(getLinearMemoryLimitBytes(64, undefined), WASM64_LINEAR_MEMORY_LIMIT_BYTES);
});

test("a device with little RAM keeps a memory64 instance within it", () => {
  assert.equal(getLinearMemoryLimitBytes(64, 4), 4 * GIB);
  // Never below what the wasm32 build is allowed.
  assert.equal(getLinearMemoryLimitBytes(64, 2), WASM32_LINEAR_MEMORY_LIMIT_BYTES);
  assert.equal(getLinearMemoryLimitBytes(64, 0.5), WASM32_LINEAR_MEMORY_LIMIT_BYTES);
});

test("a picking index reserves a multiple of its payload on both builds", () => {
  const payloadBytes = 100 * MIB;
  assert.equal(
    getPickingIndexReserveBytes({ addressBits: 32, payloadBytes, memoryBytes: 64 * MIB }),
    150 * MIB,
  );
  assert.equal(
    getPickingIndexReserveBytes({ addressBits: 64, payloadBytes, memoryBytes: 64 * MIB }),
    175 * MIB,
  );
  // A package built before memory_address_bits() existed counts as wasm32.
  assert.equal(
    getPickingIndexReserveBytes({ addressBits: undefined, payloadBytes, memoryBytes: null }),
    150 * MIB,
  );
});

test("small picking indexes are not worth a reservation", () => {
  for (const addressBits of [32, 64]) {
    assert.equal(
      getPickingIndexReserveBytes({ addressBits, payloadBytes: 0, memoryBytes: 0 }),
      0,
    );
    assert.equal(
      getPickingIndexReserveBytes({ addressBits, payloadBytes: MIB / 4, memoryBytes: 0 }),
      0,
    );
    assert.equal(
      getPickingIndexReserveBytes({ addressBits, payloadBytes: Number.NaN, memoryBytes: 0 }),
      0,
    );
  }
});

test("a wasm32 instance stops reserving once that would take it past 2 GiB", () => {
  assert.equal(WASM32_PICKING_INDEX_RESERVE_CUTOFF_BYTES, 2 * GIB);
  const payloadBytes = 100 * MIB;
  const reserveBytes = 150 * MIB;
  assert.equal(
    getPickingIndexReserveBytes({
      addressBits: 32,
      payloadBytes,
      memoryBytes: 2 * GIB - reserveBytes,
    }),
    reserveBytes,
  );
  assert.equal(
    getPickingIndexReserveBytes({
      addressBits: 32,
      payloadBytes,
      memoryBytes: 2 * GIB - reserveBytes + 1,
    }),
    0,
  );
  assert.equal(
    getPickingIndexReserveBytes({ addressBits: 32, payloadBytes, memoryBytes: 3 * GIB }),
    0,
  );
  // memory64 has the room, and its largest layers gain the most.
  assert.equal(
    getPickingIndexReserveBytes({ addressBits: 64, payloadBytes, memoryBytes: 12 * GIB }),
    175 * MIB,
  );
});

test("memory64 browsers are listed with the first version that supports it", () => {
  assert.deepEqual(
    MEMORY64_BROWSERS.map(({ name, version }) => `${name} ${version}`),
    ["Chrome 133", "Edge 133", "Firefox 134"],
  );
  assert.ok(Object.isFrozen(MEMORY64_BROWSERS));
});

test("out-of-memory messages from the module and the viewer are recognised", () => {
  for (const message of [
    "Not enough WebAssembly memory to load file input (300.0 MB)",
    "Gerber layer is too large to parse: not enough memory for primitives",
    "Gerber region is too large to render: not enough memory for region points",
    "Gerber generated geometry exceeds the supported limit of 60000000 items while processing flash",
    "Gerber flash expands to 95000000 items, exceeding the per-command limit of 90000000",
    "WASM memory limit reached",
    "RangeError: Array buffer allocation failed",
  ]) {
    assert.equal(isOutOfMemoryMessage(message), true, message);
  }
  for (const message of [
    "File does not contain valid Gerber data (no geometry found)",
    "Gerber step-repeat count 200000 exceeds the supported limit of 100000",
    "unreachable",
    undefined,
  ]) {
    assert.equal(isOutOfMemoryMessage(message), false, String(message));
  }
});

test("any trap may be worth a memory64 retry, but a u32 overflow never is", () => {
  assert.equal(isMemoryExhaustionError(new WebAssembly.RuntimeError("unreachable")), true);
  assert.equal(isMemoryExhaustionError(new RangeError("Invalid array length")), true);
  assert.equal(isMemoryExhaustionError(new Error("no geometry found")), false);
  assert.equal(
    isMemoryExhaustionError(
      new Error("Gerber region is too large to parse: path region wedge vertex offsets exceed the u32 range"),
    ),
    false,
  );
});

test("only a memory message or a trap in a large instance means wasm32 is too small", () => {
  assert.equal(exceedsWasm32Memory({ message: "WASM memory limit reached" }), true);
  assert.equal(
    exceedsWasm32Memory({ message: "unreachable", trapped: true, memoryBytes: GIB }),
    true,
  );
  // A trap in a small instance points at a bug, not at the data's size.
  assert.equal(
    exceedsWasm32Memory({ message: "unreachable", trapped: true, memoryBytes: GIB - 1 }),
    false,
  );
  assert.equal(
    exceedsWasm32Memory({ message: "unreachable", trapped: false, memoryBytes: 3 * GIB }),
    false,
  );
  assert.equal(
    exceedsWasm32Memory({
      message: "Gerber layer is too large: a parsed geometry array holds 4,294,967,296 values, exceeding the u32 range",
      trapped: false,
    }),
    false,
  );
});

test("the address width comes from the loaded package", () => {
  assert.equal(getWasmAddressBits({ memory_address_bits: () => 64 }), 64);
  assert.equal(getWasmAddressBits({ memory_address_bits: () => 32 }), 32);
  // A package built before the export existed is wasm32.
  assert.equal(getWasmAddressBits({}), 32);
  assert.equal(getWasmAddressBits(null), 32);
});
