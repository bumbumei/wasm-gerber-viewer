import { expect, test } from "@playwright/test";

// A layer of a million flashes: large enough that its worker parse lasts a
// second or more and reports several times along the way.
function flashLayerSource(count = 1_000_000) {
  const lines = ["%FSLAX34Y34*%", "%MOMM*%", "%ADD10C,0.250*%", "D10*"];
  for (let index = 0; index < count; index += 1) {
    lines.push(`X${(index % 1000) * 3000}Y${Math.floor(index / 1000) * 3000}D03*`);
  }
  lines.push("M02*");
  return lines.join("\n");
}

const padSource = `%FSLAX24Y24*%
%MOMM*%
%ADD10C,1.000*%
D10*
X000000Y000000D03*
M02*`;

const gerber = (name, source) => ({
  name,
  mimeType: "text/plain",
  buffer: Buffer.from(source),
});

// Records every change of what the loading modal shows.
function recordLoadingModal() {
  const snapshots = [];
  window.__loadingSnapshots = snapshots;
  new MutationObserver(() => {
    const modal = document.getElementById("loading-modal");
    if (!modal || modal.hidden) return;
    const snapshot = {
      stage: document.getElementById("loading-stage").textContent,
      fileName: document.getElementById("loading-file-name").textContent,
      percent: Number.parseInt(
        document.getElementById("loading-progress-value").textContent,
        10,
      ),
      bar: Number(document.getElementById("loading-progress-bar").value),
    };
    const last = snapshots.at(-1);
    if (
      !last ||
      last.stage !== snapshot.stage ||
      last.fileName !== snapshot.fileName ||
      last.percent !== snapshot.percent
    ) {
      snapshots.push(snapshot);
    }
  }).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["hidden", "value"],
  });
}

test("the loading modal shows how far a large layer's parse has got", async ({ page }) => {
  await page.addInitScript(recordLoadingModal);
  await page.goto("/");
  // The viewer takes files once its WASM instance is up.
  await expect(page.locator("html")).toHaveAttribute("data-wasm-main", /^wasm/);
  // Two files, so the browsers that parse a single file on the main instance
  // parse these in workers too.
  await page.locator("#file-input").setInputFiles([
    gerber("flashes.gtl", flashLayerSource()),
    gerber("pad.gbl", padSource),
  ]);
  await expect(page.locator("#loading-modal")).toBeHidden({ timeout: 60_000 });
  await expect(page.locator(".gerber-layer-item")).toHaveCount(2);

  const snapshots = await page.evaluate(() => window.__loadingSnapshots);
  const parsing = snapshots.filter(
    (snapshot) => snapshot.stage === "Parsing" && snapshot.fileName === "flashes.gtl",
  );
  const between = parsing.filter(({ percent }) => percent > 5 && percent < 90);
  expect(
    between.length,
    `parse progress between 5% and 90%: ${JSON.stringify(snapshots)}`,
  ).toBeGreaterThanOrEqual(3);

  // Loading the layers only ever moves forward. Preparing counts the files
  // checked before loading starts, and the picking index that is built
  // afterwards counts on its own.
  const loading = snapshots.filter(
    ({ stage }) =>
      stage !== "Preparing" &&
      stage !== "Building picking index" &&
      stage !== "Picking ready",
  );
  for (const [index, snapshot] of loading.entries()) {
    expect(snapshot.percent).toBe(Math.floor(snapshot.percent));
    expect(snapshot.bar).toBeGreaterThanOrEqual(snapshot.percent);
    if (index > 0) {
      expect(snapshot.percent, JSON.stringify(loading)).toBeGreaterThanOrEqual(
        loading[index - 1].percent,
      );
    }
  }
  expect(loading.at(-1).percent).toBe(100);
});
