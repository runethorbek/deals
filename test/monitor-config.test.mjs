import assert from "node:assert/strict";
import test from "node:test";
import { loadEnabledMonitor } from "../scripts/lib/monitor-config.mjs";

const vintedMonitor = {
  id: "vinted-monitor",
  source: "vinted",
  enabled: true,
  filters: { catalogIds: ["1786"], sizeIds: ["207"] },
  pages: 3
};
const scarossoMonitor = {
  id: "scarosso-monitor",
  source: "scarosso",
  enabled: true,
  filters: {
    listingUrls: ["/sales/men/?prefn1=c_size&prefv1=42"],
    minDiscountPercent: 30
  }
};
const zalandoMonitor = {
  id: "zalando-monitor",
  source: "zalando",
  enabled: true,
  filters: {
    categorySlug: "herretoej-bukser",
    size: "46",
    upperMaterials: ["pure_linen"],
    minDiscountPercent: 30
  }
};

function load(source, monitors) {
  return loadEnabledMonitor(source, {
    readFile: async () => JSON.stringify(monitors)
  });
}

test("selects source monitors from one shared configuration", async () => {
  const monitors = [vintedMonitor, scarossoMonitor, zalandoMonitor];

  assert.deepEqual(await load("vinted", monitors), vintedMonitor);
  assert.deepEqual(await load("scarosso", monitors), scarossoMonitor);
  assert.deepEqual(await load("zalando", monitors), zalandoMonitor);
});

test("requires a JSON array and exactly one enabled monitor per source", async () => {
  await assert.rejects(
    loadEnabledMonitor("scarosso", {
      readFile: async () => JSON.stringify({ monitors: [] })
    }),
    /must be a JSON array/
  );
  await assert.rejects(
    load("scarosso", [{ ...scarossoMonitor, enabled: false }]),
    /exactly one enabled Scarosso monitor/
  );
  await assert.rejects(
    load("scarosso", [
      scarossoMonitor,
      { ...scarossoMonitor, id: "another-scarosso-monitor" }
    ]),
    /exactly one enabled Scarosso monitor/
  );
});

test("validates the shared monitor envelope", async () => {
  for (const monitor of [
    { ...scarossoMonitor, id: "" },
    { ...scarossoMonitor, filters: null },
    { ...scarossoMonitor, filters: [] }
  ]) {
    await assert.rejects(
      load("scarosso", [monitor]),
      /Invalid enabled Scarosso monitor configuration/
    );
  }
});
