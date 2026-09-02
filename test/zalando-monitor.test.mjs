import assert from "node:assert/strict";
import test from "node:test";
import {
  buildZalandoScanPlan,
  loadEnabledZalandoMonitor
} from "../scripts/lib/zalando-monitor.mjs";

const validMonitor = {
  id: "zalando-dk-mens-trousers-size-46",
  source: "zalando",
  enabled: true,
  filters: {
    categorySlug: "herretoej-bukser",
    size: "46",
    upperMaterials: [
      "pure_cashmere",
      "pure_linen",
      "pure_wool"
    ],
    minDiscountPercent: 30
  }
};

test("repository configuration preserves the current Zalando scan URL", async () => {
  const monitor = await loadEnabledZalandoMonitor();

  assert.deepEqual(monitor, validMonitor);
  assert.deepEqual(buildZalandoScanPlan(monitor), {
    listingUrls: [
      "https://www.zalando.dk/herretoej-bukser/__stoerrelse-46/" +
        "?upper_material=pure_cashmere.pure_linen.pure_wool"
    ],
    targetSize: "46",
    upperMaterials: [
      "pure_cashmere",
      "pure_linen",
      "pure_wool"
    ],
    minDiscountPercent: 30
  });
});

test("configuration requires exactly one enabled Zalando monitor", async () => {
  const load = (monitors) => loadEnabledZalandoMonitor({
    readFile: async () => JSON.stringify(monitors)
  });

  await assert.rejects(
    load([{ ...validMonitor, enabled: false }]),
    /exactly one enabled Zalando monitor/
  );
  await assert.rejects(
    load([validMonitor, { ...validMonitor, id: "another-monitor" }]),
    /exactly one enabled Zalando monitor/
  );
});

test("rejects unsafe or unsupported Zalando monitoring intent", async () => {
  const load = (monitor) => loadEnabledZalandoMonitor({
    readFile: async () => JSON.stringify([monitor])
  });
  const invalidMonitors = [
    {
      ...validMonitor,
      filters: { ...validMonitor.filters, categorySlug: "dametoej" }
    },
    {
      ...validMonitor,
      filters: { ...validMonitor.filters, size: "48" }
    },
    {
      ...validMonitor,
      filters: { ...validMonitor.filters, upperMaterials: [] }
    },
    {
      ...validMonitor,
      filters: {
        ...validMonitor.filters,
        upperMaterials: ["pure_linen", "pure_linen"]
      }
    },
    {
      ...validMonitor,
      filters: {
        ...validMonitor.filters,
        upperMaterials: ["pure_linen", "unsupported_material"]
      }
    },
    {
      ...validMonitor,
      filters: { ...validMonitor.filters, minDiscountPercent: -1 }
    },
    {
      ...validMonitor,
      filters: { ...validMonitor.filters, minDiscountPercent: 101 }
    },
    {
      ...validMonitor,
      filters: { ...validMonitor.filters, minDiscountPercent: 30.5 }
    }
  ];

  for (const monitor of invalidMonitors) {
    await assert.rejects(
      load(monitor),
      /Invalid enabled Zalando monitor configuration/
    );
  }
});
