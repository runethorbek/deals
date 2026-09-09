import assert from "node:assert/strict";
import test from "node:test";
import {
  buildZalandoScanPlan,
  loadEnabledZalandoMonitors
} from "../scripts/lib/zalando-monitor.mjs";

const validMonitor = {
  id: "zalando-dk-mens-trousers-size-46",
  source: "zalando",
  enabled: true,
  filters: {
    listingPath:
      "/herretoej-bukser/__stoerrelse-46/" +
      "?upper_material=pure_cashmere.pure_linen.pure_wool",
    targetSize: "46",
    minDiscountPercent: 30
  },
  pages: 1
};

const shoesMonitor = {
  id: "zalando-scarosso-shoes-42",
  source: "zalando",
  enabled: true,
  filters: {
    listingPath: "/herresko/scarosso__stoerrelse-42/",
    targetSize: "42",
    minDiscountPercent: 30
  },
  pages: 1
};

const load = (monitors) => loadEnabledZalandoMonitors({
  readFile: async () => JSON.stringify(monitors)
});

test("repository configuration preserves the current Zalando scan URL", async () => {
  const monitors = await loadEnabledZalandoMonitors();

  assert.deepEqual(monitors, [validMonitor, shoesMonitor]);
  assert.deepEqual(buildZalandoScanPlan(monitors[0]), {
    monitorId: validMonitor.id,
    listingUrls: [
      "https://www.zalando.dk/herretoej-bukser/__stoerrelse-46/" +
        "?upper_material=pure_cashmere.pure_linen.pure_wool"
    ],
    targetSize: "46",
    upperMaterials: ["pure_cashmere", "pure_linen", "pure_wool"],
    minDiscountPercent: 30,
    pages: 1
  });
});

test("loads multiple enabled Zalando monitors and ignores disabled ones", async () => {
  assert.deepEqual(await load([validMonitor, shoesMonitor]), [validMonitor, shoesMonitor]);
  assert.deepEqual(
    await load([validMonitor, { ...shoesMonitor, enabled: false }]),
    [validMonitor]
  );
  assert.deepEqual(await load([{ ...validMonitor, enabled: false }]), []);
});

test("builds arbitrary safe Zalando listing paths and target sizes", () => {
  assert.deepEqual(buildZalandoScanPlan(shoesMonitor), {
    monitorId: shoesMonitor.id,
    listingUrls: ["https://www.zalando.dk/herresko/scarosso__stoerrelse-42/"],
    targetSize: "42",
    upperMaterials: [],
    minDiscountPercent: 30,
    pages: 1
  });
});

test("rejects unsafe or ambiguous Zalando monitoring intent", async () => {
  const invalidMonitors = [
    { ...validMonitor, filters: { ...validMonitor.filters, listingPath: "https://example.com/shoes/" } },
    { ...validMonitor, filters: { ...validMonitor.filters, listingPath: "//example.com/shoes/" } },
    { ...validMonitor, filters: { ...validMonitor.filters, listingPath: "/shoes/?p=2" } },
    { ...validMonitor, filters: { ...validMonitor.filters, listingPath: "/shoes/?P=2" } },
    { ...validMonitor, filters: { ...validMonitor.filters, listingPath: "/shoes/#fragment" } },
    { ...validMonitor, filters: { ...validMonitor.filters, listingPath: "/shoes/%ZZ" } },
    { ...validMonitor, filters: { ...validMonitor.filters, listingPath: "/shoes/../sale/" } },
    { ...validMonitor, filters: { ...validMonitor.filters, listingPath: "/" } },
    { ...validMonitor, filters: { ...validMonitor.filters, targetSize: "" } },
    { ...validMonitor, filters: { ...validMonitor.filters, minDiscountPercent: -1 } },
    { ...validMonitor, filters: { ...validMonitor.filters, minDiscountPercent: 101 } },
    { ...validMonitor, filters: { ...validMonitor.filters, minDiscountPercent: 30.5 } },
    { ...validMonitor, pages: 0 },
    { ...validMonitor, pages: 11 },
    { ...validMonitor, pages: 1.5 }
  ];

  for (const monitor of invalidMonitors) {
    await assert.rejects(load([monitor]), /Invalid zalando monitor configuration/);
  }
});

test("accepts bounded future pagination intent but does not under-scan it", async () => {
  const futureMonitor = { ...validMonitor, pages: 2 };

  assert.deepEqual(await load([futureMonitor]), [futureMonitor]);
  assert.throws(
    () => buildZalandoScanPlan(futureMonitor),
    /requires Slice 2/
  );
});
