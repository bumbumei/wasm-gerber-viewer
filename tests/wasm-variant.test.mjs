import assert from "node:assert/strict";
import test from "node:test";

import {
  WASM32_LINEAR_MEMORY_LIMIT_BYTES,
  WASM32_PICKING_INDEX_RESERVE_CUTOFF_BYTES,
  WASM64_LINEAR_MEMORY_LIMIT_BYTES,
  WASM_VARIANT_32,
  WASM_VARIANT_64,
  getLinearMemoryLimitBytes,
  getPickingIndexReserveBytes,
  getRequestedWasmVariant,
  getWasmAddressBits,
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

test("the address width comes from the loaded package", () => {
  assert.equal(getWasmAddressBits({ memory_address_bits: () => 64 }), 64);
  assert.equal(getWasmAddressBits({ memory_address_bits: () => 32 }), 32);
  // A package built before the export existed is wasm32.
  assert.equal(getWasmAddressBits({}), 32);
  assert.equal(getWasmAddressBits(null), 32);
});
