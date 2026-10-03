// Remembers a load while it runs, so that a page the browser killed during
// the load can tell on its next start. A tab that runs out of memory is
// usually ended without any error reaching the page (iOS Safari then reloads
// it, and loading the same ?url= again ends it again), so the only trace is a
// marker the load never got to remove. Session storage outlives the killed
// page process and stays with the tab.

const STORAGE_KEY = "gerber-viewer:load-in-progress";
// A marker older than this belongs to some earlier visit, not to a crash the
// browser is recovering from.
const MAX_MARKER_AGE_MS = 30 * 60 * 1000;
const MAX_REMEMBERED_NAMES = 5;

function defaultStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch (_error) {
    return null;
  }
}

/** Notes that a load of `names` (from `sourceUrl`, if any) has started. */
export function markLoadInProgress(
  { names = [], sourceUrl = null } = {},
  { storage = defaultStorage(), now = Date.now() } = {},
) {
  try {
    storage?.setItem(
      STORAGE_KEY,
      JSON.stringify({
        names: names.slice(0, MAX_REMEMBERED_NAMES),
        nameCount: names.length,
        sourceUrl,
        startedAt: now,
      }),
    );
  } catch (_error) {
    // Without storage the page simply cannot tell afterwards.
  }
}

/** Notes that the load finished, or that the page is being left on purpose. */
export function clearLoadInProgress({ storage = defaultStorage() } = {}) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch (_error) {
    // Nothing was stored.
  }
}

/**
 * The load that was still running when the page last went away, if it is
 * recent; removes the marker so a reload tries the load again.
 */
export function takeInterruptedLoad({
  storage = defaultStorage(),
  now = Date.now(),
} = {}) {
  let raw = null;
  try {
    raw = storage?.getItem(STORAGE_KEY) ?? null;
    storage?.removeItem(STORAGE_KEY);
  } catch (_error) {
    return null;
  }
  if (!raw) return null;

  let marker;
  try {
    marker = JSON.parse(raw);
  } catch (_error) {
    return null;
  }
  const startedAt = Number(marker?.startedAt);
  if (
    !Number.isFinite(startedAt) ||
    now - startedAt < 0 ||
    now - startedAt > MAX_MARKER_AGE_MS
  ) {
    return null;
  }
  const names = Array.isArray(marker.names)
    ? marker.names.filter((name) => typeof name === "string")
    : [];
  return {
    names,
    nameCount: Math.max(names.length, Number(marker.nameCount) || 0),
    sourceUrl: typeof marker.sourceUrl === "string" ? marker.sourceUrl : null,
  };
}

/** "a.gbr", "a.gbr and b.gbr", "a.gbr, b.gbr and 3 more files". */
export function describeLoadedFiles({ names, nameCount = names.length }) {
  if (names.length === 0) return "The last load";
  const shown = names.slice(0, 2);
  const rest = Math.max(0, nameCount - shown.length);
  if (rest === 0) {
    return shown.length === 1 ? shown[0] : `${shown[0]} and ${shown[1]}`;
  }
  return `${shown.join(", ")} and ${rest} more ${rest === 1 ? "file" : "files"}`;
}

/** iPhone and iPad, including iPadOS reporting itself as a Mac. */
export function isAppleMobileDevice(navigatorLike = globalThis.navigator) {
  const userAgent = String(navigatorLike?.userAgent ?? "");
  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && Number(navigatorLike?.maxTouchPoints) > 1)
  );
}
