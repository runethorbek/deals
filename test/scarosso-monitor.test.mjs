import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScarossoScanPlan,
  loadEnabledScarossoMonitor
} from "../scripts/lib/scarosso-monitor.mjs";

const expectedListingUrls = [
  "https://www.scarosso.com/en-dk/sales/men/?prefn1=c_size&prefv1=42",
  "https://www.scarosso.com/en-dk/sales/men/sneakers/?prefn1=c_size&prefv1=42",
  "https://www.scarosso.com/en-dk/sales/men/loafers/?prefn1=c_size&prefv1=42",
  "https://www.scarosso.com/en-dk/sales/men/flats/?prefn1=c_size&prefv1=42",
  "https://www.scarosso.com/en-dk/sales/men/boots/?prefn1=c_size&prefv1=42",
  "https://www.scarosso.com/en-dk/sales/men/last-pairs/?prefn1=c_size&prefv1=42"
];

const validMonitor = {
  id: "scarosso-dk-mens-sale-size-42",
  source: "scarosso",
  enabled: true,
  filters: {
    listingUrls: expectedListingUrls.map((url) => {
      const parsed = new URL(url);
      return `${parsed.pathname.replace("/en-dk", "")}${parsed.search}`;
    }),
    minDiscountPercent: 30
  }
};

test("repository configuration preserves the configured Scarosso scan", async () => {
  const monitor = await loadEnabledScarossoMonitor();

  assert.deepEqual(monitor, validMonitor);
  assert.deepEqual(buildScarossoScanPlan(monitor), {
    listingUrls: expectedListingUrls,
    targetSize: "42",
    minDiscountPercent: 30
  });
});

test("configuration skips when no Scarosso monitor is enabled and rejects multiples", async () => {
  const load = (monitors) => loadEnabledScarossoMonitor({
    readFile: async () => JSON.stringify(monitors)
  });

  assert.equal(await load([{ ...validMonitor, enabled: false }]), null);
  await assert.rejects(
    load([validMonitor, { ...validMonitor, id: "another-monitor" }]),
    /at most one enabled Scarosso monitor/
  );
});

test("rejects unsafe or unsupported Scarosso monitoring intent", async () => {
  const load = (monitor) => loadEnabledScarossoMonitor({
    readFile: async () => JSON.stringify([monitor])
  });
  const firstListing = validMonitor.filters.listingUrls[0];
  const invalidMonitors = [
    {
      ...validMonitor,
      filters: { ...validMonitor.filters, listingUrls: [] }
    },
    {
      ...validMonitor,
      filters: {
        ...validMonitor.filters,
        listingUrls: [firstListing, firstListing]
      }
    },
    {
      ...validMonitor,
      filters: {
        ...validMonitor.filters,
        listingUrls: [
          firstListing,
          "/sales/men/?prefv1=42&prefn1=c_size"
        ]
      }
    },
    {
      ...validMonitor,
      filters: {
        ...validMonitor.filters,
        listingUrls: ["https://example.com/sales/men/?prefn1=c_size&prefv1=42"]
      }
    },
    {
      ...validMonitor,
      filters: {
        ...validMonitor.filters,
        listingUrls: ["/sales/women/?prefn1=c_size&prefv1=42"]
      }
    },
    {
      ...validMonitor,
      filters: {
        ...validMonitor.filters,
        listingUrls: ["/sales/men/../women/?prefn1=c_size&prefv1=42"]
      }
    },
    {
      ...validMonitor,
      filters: {
        ...validMonitor.filters,
        listingUrls: [`${firstListing}#products`]
      }
    },
    {
      ...validMonitor,
      filters: {
        ...validMonitor.filters,
        listingUrls: ["/sales/men/?prefn1=c_size&prefv1=43"]
      }
    },
    {
      ...validMonitor,
      filters: {
        ...validMonitor.filters,
        listingUrls: [`${firstListing}&page=2`]
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
      /Invalid scarosso monitor configuration/
    );
  }
});
