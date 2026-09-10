import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVintedListingUrls,
  loadEnabledVintedMonitor,
  loadEnabledVintedMonitors
} from "../scripts/lib/vinted-monitor.mjs";

test("repository configuration preserves the current Vinted scan URLs", async () => {
  const monitors = await loadEnabledVintedMonitors();

  assert.deepEqual(monitors.map((monitor) => monitor.id), [
    "vinted-mens-blazers-size-s",
    "vinted-mens-pants-size-46"
  ]);
  assert.deepEqual(monitors.flatMap(buildVintedListingUrls), [
    "https://www.vinted.dk/catalog?catalog[]=1786&size_ids[]=207&page=1",
    "https://www.vinted.dk/catalog?catalog[]=1786&size_ids[]=207&page=2",
    "https://www.vinted.dk/catalog?catalog[]=1786&size_ids[]=207&page=3",
    "https://www.vinted.dk/catalog?catalog[]=34&size_ids[]=1637&page=1",
    "https://www.vinted.dk/catalog?catalog[]=34&size_ids[]=1637&page=2",
    "https://www.vinted.dk/catalog?catalog[]=34&size_ids[]=1637&page=3"
  ]);
});

test("configuration skips when no Vinted monitor is enabled and permits multiples", async () => {
  const load = (monitors) => loadEnabledVintedMonitors({
    readFile: async () => JSON.stringify(monitors)
  });
  const monitor = {
    id: "vinted-mens-shoes-42",
    source: "vinted",
    enabled: true,
    filters: {
      catalogIds: ["1786"],
      sizeIds: ["207"]
    },
    pages: 3
  };

  assert.deepEqual(await load([{ ...monitor, enabled: false }]), []);
  await assert.rejects(
    load([null]),
    /Invalid monitor configuration envelope/
  );
  assert.deepEqual(
    await load([monitor, { ...monitor, id: "another-vinted-monitor" }]),
    [monitor, { ...monitor, id: "another-vinted-monitor" }]
  );
});

test("configuration rejects an invalid enabled Vinted monitor", async () => {
  const validMonitor = {
    id: "vinted-mens-shoes-42",
    source: "vinted",
    enabled: true,
    filters: {
      catalogIds: ["1786"],
      sizeIds: ["207"]
    },
    pages: 3
  };
  const invalidMonitors = [
    { ...validMonitor, id: "" },
    {
      ...validMonitor,
      filters: { ...validMonitor.filters, catalogIds: [] }
    },
    {
      ...validMonitor,
      filters: { ...validMonitor.filters, catalogIds: ["1786", "1234"] }
    },
    {
      ...validMonitor,
      filters: { ...validMonitor.filters, sizeIds: ["not-a-vinted-id"] }
    },
    { ...validMonitor, pages: 0 },
    { ...validMonitor, pages: 101 }
  ];

  for (const monitor of invalidMonitors) {
    await assert.rejects(
      loadEnabledVintedMonitor({
        readFile: async () => JSON.stringify([monitor])
      }),
      /Invalid (monitor configuration envelope|vinted monitor configuration)/
    );
  }
});
