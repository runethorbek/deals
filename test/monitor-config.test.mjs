import assert from "node:assert/strict";
import test from "node:test";
import { loadEnabledMonitor } from "../scripts/lib/monitor-config.mjs";
import {
  loadValidatedEnabledMonitor,
  loadValidatedEnabledMonitors
} from "../scripts/lib/validated-monitor-loader.mjs";

const vintedMonitor = {
  id: "vinted-monitor",
  source: "vinted",
  enabled: true,
  filters: { catalogIds: ["1786"], sizeIds: ["207"] },
  pages: 3
};
const zalandoMonitor = {
  id: "zalando-monitor",
  source: "zalando",
  enabled: true,
  filters: {
    listingPath: "/herretoej-bukser/__stoerrelse-46/?upper_material=pure_linen",
    targetSize: "46",
    minDiscountPercent: 30
  },
  pages: 1
};

function load(source, monitors) {
  return loadEnabledMonitor(source, {
    readFile: async () => JSON.stringify(monitors)
  });
}

test("selects source monitors from one shared configuration", async () => {
  const monitors = [vintedMonitor, zalandoMonitor];

  assert.deepEqual(await load("vinted", monitors), vintedMonitor);
  assert.deepEqual(await load("zalando", monitors), zalandoMonitor);
});

test("requires a JSON array and at most one enabled monitor per source", async () => {
  await assert.rejects(
    loadEnabledMonitor("vinted", {
      readFile: async () => JSON.stringify({ monitors: [] })
    }),
    /must be a JSON array/
  );
  assert.equal(
    await load("vinted", [{ ...vintedMonitor, enabled: false }]),
    null
  );
  await assert.rejects(
    load("vinted", [
      vintedMonitor,
      { ...vintedMonitor, id: "another-vinted-monitor" }
    ]),
    /at most one enabled Vinted monitor/
  );

  assert.deepEqual(
    await loadValidatedEnabledMonitors("vinted", {
      readFile: async () => JSON.stringify([
        vintedMonitor,
        { ...vintedMonitor, id: "another-vinted-monitor" }
      ])
    }),
    [vintedMonitor, { ...vintedMonitor, id: "another-vinted-monitor" }]
  );
});

test("validated plural selection allows multiple Zalando monitors only", async () => {
  const secondZalando = {
    ...zalandoMonitor,
    id: "zalando-shoes",
    filters: {
      ...zalandoMonitor.filters,
      listingPath: "/herresko/scarosso__stoerrelse-42/",
      targetSize: "42"
    }
  };
  const options = {
    readFile: async () => JSON.stringify([zalandoMonitor, secondZalando])
  };

  assert.deepEqual(
    await loadValidatedEnabledMonitors("zalando", options),
    [zalandoMonitor, secondZalando]
  );
});

test("validates the shared monitor envelope", async () => {
  for (const monitor of [
    { ...zalandoMonitor, id: "" },
    { ...zalandoMonitor, filters: null },
    { ...zalandoMonitor, filters: [] }
  ]) {
    await assert.rejects(
      load("zalando", [monitor]),
      /Invalid monitor configuration envelope/
    );
  }
});

test("validates every monitor before selecting a source", async () => {
  const invalidMonitors = [
    [{ ...vintedMonitor, source: "unknown" }],
    [{ ...vintedMonitor, id: "" }],
    [vintedMonitor, { ...zalandoMonitor, id: vintedMonitor.id }],
    [{ ...vintedMonitor, enabled: "true" }],
    [{ ...vintedMonitor, filters: null }],
    [{ ...zalandoMonitor, filters: null }],
    [{ ...zalandoMonitor, enabled: "false" }]
  ];

  for (const monitors of invalidMonitors) {
    await assert.rejects(load("vinted", monitors), /Invalid monitor configuration envelope/);
  }

  await assert.rejects(
    loadEnabledMonitor("vinted", { readFile: async () => "{" }),
    /malformed JSON/
  );
});

test("rejects the removed Scarosso source", async () => {
  const scarossoMonitor = {
    id: "scarosso-dk-mens-sale-size-42",
    source: "scarosso",
    enabled: false,
    filters: {
      listingUrls: ["/sales/men/?prefn1=c_size&prefv1=42"],
      minDiscountPercent: 30
    }
  };
  const options = {
    readFile: async () => JSON.stringify([vintedMonitor, zalandoMonitor, scarossoMonitor])
  };

  await assert.rejects(
    loadEnabledMonitor("vinted", options),
    /Invalid monitor configuration envelope/
  );
  await assert.rejects(
    loadValidatedEnabledMonitors("zalando", options),
    /Invalid monitor configuration envelope/
  );
  await assert.rejects(
    loadValidatedEnabledMonitors("scarosso", {
      readFile: async () => JSON.stringify([vintedMonitor])
    }),
    /Monitor source must be a known non-empty string/
  );
});

test("validates source-specific fields across the complete document", async () => {
  await assert.rejects(
    loadValidatedEnabledMonitor("vinted", {
      readFile: async () => JSON.stringify([
        vintedMonitor,
        {
          ...zalandoMonitor,
          enabled: false,
          filters: { ...zalandoMonitor.filters, listingPath: "/shoes/?p=2" }
        }
      ])
    }),
    /Invalid zalando monitor configuration/
  );
});
