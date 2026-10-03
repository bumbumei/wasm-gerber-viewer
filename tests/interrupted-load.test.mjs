import assert from "node:assert/strict";
import test from "node:test";

import {
  clearLoadInProgress,
  describeLoadedFiles,
  isAppleMobileDevice,
  markLoadInProgress,
  takeInterruptedLoad,
} from "../js/loading/interrupted-load.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    get size() {
      return values.size;
    },
  };
}

const MINUTE = 60 * 1000;

test("a load that never cleared its marker is reported once", () => {
  const storage = memoryStorage();
  markLoadInProgress(
    { names: ["pads.gbr"], sourceUrl: "https://example.test/pads.gbr" },
    { storage, now: 1_000 },
  );
  assert.deepEqual(takeInterruptedLoad({ storage, now: 2_000 }), {
    names: ["pads.gbr"],
    nameCount: 1,
    sourceUrl: "https://example.test/pads.gbr",
  });
  // Taking it removes it, so a reload loads the file again.
  assert.equal(takeInterruptedLoad({ storage, now: 3_000 }), null);
});

test("a finished load leaves nothing behind", () => {
  const storage = memoryStorage();
  markLoadInProgress({ names: ["a.gbr"] }, { storage, now: 0 });
  clearLoadInProgress({ storage });
  assert.equal(storage.size, 0);
  assert.equal(takeInterruptedLoad({ storage, now: 1 }), null);
});

test("old or malformed markers are dropped", () => {
  const storage = memoryStorage();
  markLoadInProgress({ names: ["a.gbr"] }, { storage, now: 0 });
  assert.equal(takeInterruptedLoad({ storage, now: 31 * MINUTE }), null);
  assert.equal(storage.size, 0);

  markLoadInProgress({ names: ["a.gbr"] }, { storage, now: 10 * MINUTE });
  // A clock that went backwards cannot date the marker.
  assert.equal(takeInterruptedLoad({ storage, now: 0 }), null);

  storage.setItem("gerber-viewer:load-in-progress", "{not json");
  assert.equal(takeInterruptedLoad({ storage, now: 0 }), null);
  assert.equal(storage.size, 0);
});

test("only the first names are kept, with the total", () => {
  const storage = memoryStorage();
  const names = Array.from({ length: 12 }, (_, index) => `layer-${index}.gbr`);
  markLoadInProgress({ names }, { storage, now: 0 });
  const load = takeInterruptedLoad({ storage, now: 1 });
  assert.equal(load.names.length, 5);
  assert.equal(load.nameCount, 12);
  assert.equal(load.sourceUrl, null);
  assert.equal(describeLoadedFiles(load), "layer-0.gbr, layer-1.gbr and 10 more files");
});

test("loads are described by name", () => {
  assert.equal(describeLoadedFiles({ names: ["a.gbr"] }), "a.gbr");
  assert.equal(describeLoadedFiles({ names: ["a.gbr", "b.gbr"] }), "a.gbr and b.gbr");
  assert.equal(
    describeLoadedFiles({ names: ["a.gbr", "b.gbr", "c.gbr"] }),
    "a.gbr, b.gbr and 1 more file",
  );
  assert.equal(describeLoadedFiles({ names: [] }), "The last load");
});

test("missing or failing storage only loses the marker", () => {
  const failing = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("quota");
    },
    removeItem() {
      throw new Error("denied");
    },
  };
  assert.doesNotThrow(() => markLoadInProgress({ names: ["a.gbr"] }, { storage: failing }));
  assert.doesNotThrow(() => clearLoadInProgress({ storage: failing }));
  assert.equal(takeInterruptedLoad({ storage: failing }), null);
  assert.equal(takeInterruptedLoad({ storage: null }), null);
});

test("iPhone and iPad are recognised, including iPadOS posing as a Mac", () => {
  const iPhone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
  const mac =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
  assert.equal(isAppleMobileDevice({ userAgent: iPhone, maxTouchPoints: 5 }), true);
  assert.equal(isAppleMobileDevice({ userAgent: mac, maxTouchPoints: 5 }), true);
  assert.equal(isAppleMobileDevice({ userAgent: mac, maxTouchPoints: 0 }), false);
  assert.equal(
    isAppleMobileDevice({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151.0 Safari/537.36",
      maxTouchPoints: 10,
    }),
    false,
  );
});
