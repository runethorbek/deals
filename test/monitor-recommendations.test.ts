import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import type { MonitorEnvelope } from "../scripts/lib/monitor-config.ts";
import {
  assertMonitorRecommendationsInSync,
  buildMonitorRecommendation,
  buildMonitorRecommendationsDocument,
  generateMonitorRecommendations,
  serializeMonitorRecommendationsDocument
} from "../scripts/lib/monitor-recommendations.ts";
import { loadValidatedEnabledMonitors } from "../scripts/lib/validated-monitor-loader.ts";

const CONFIG_URL = new URL("../config/monitors.json", import.meta.url);
const PUBLISHED_URL = new URL("../public/deals/monitor-recommendations.json", import.meta.url);

const zalandoMonitor: MonitorEnvelope = {
  id: "zalando-monitor",
  source: "zalando",
  enabled: true,
  displayName: "Zalando – shoes",
  filters: {
    listingPath: "/herresko/scarosso__stoerrelse-42/",
    targetSize: "42",
    minDiscountPercent: 30
  },
  pages: 2,
  recommendation: { strategy: "discount_threshold", minimumDiscountPercent: 20 }
};
const vintedMonitor: MonitorEnvelope = {
  id: "vinted-monitor",
  source: "vinted",
  enabled: true,
  displayName: "Vinted – blazers",
  filters: { catalogIds: ["1786"], sizeIds: ["207"] },
  pages: 3,
  recommendation: { strategy: "best_match", minimumOverallScore: 7 }
};

function withRecommendation(monitor: MonitorEnvelope, recommendation: unknown): MonitorEnvelope {
  return { ...monitor, recommendation };
}

function withDisplayName(monitor: MonitorEnvelope, displayName: unknown): MonitorEnvelope {
  return { ...monitor, displayName };
}

function assertRejected(monitor: MonitorEnvelope) {
  assert.throws(
    () => buildMonitorRecommendation(monitor),
    new RegExp(`Invalid recommendation configuration for monitor ${monitor.id}`)
  );
}

function generateFrom(monitors: unknown) {
  return generateMonitorRecommendations({
    readFile: async () => JSON.stringify(monitors)
  });
}

test("checked-in monitors carry the decided display names and recommendations", async () => {
  const monitors: unknown = JSON.parse(await fs.readFile(CONFIG_URL, "utf8"));
  assert.ok(Array.isArray(monitors));

  const byId = new Map(monitors.map((monitor) => [monitor.id, monitor]));
  assert.deepEqual(
    Object.fromEntries(
      [...byId].map(([id, monitor]) => [
        id,
        { displayName: monitor.displayName, recommendation: monitor.recommendation }
      ])
    ),
    {
      "zalando-scarosso-shoes-42": {
        displayName: "Zalando – Scarosso shoes",
        recommendation: { strategy: "discount_threshold", minimumDiscountPercent: 20 }
      },
      "zalando-dk-mens-trousers-size-46": {
        displayName: "Zalando – trousers",
        recommendation: { strategy: "discount_threshold", minimumDiscountPercent: 50 }
      },
      "vinted-mens-blazers-size-s": {
        displayName: "Vinted – blazers",
        recommendation: { strategy: "best_match", minimumOverallScore: 7 }
      },
      "vinted-mens-pants-size-46": {
        displayName: "Vinted – trousers",
        recommendation: { strategy: "best_match", minimumOverallScore: 7 }
      }
    }
  );
});

test("an absent recommendation is unconfigured and gets no default strategy", () => {
  const { recommendation: _omitted, ...unconfigured } = zalandoMonitor;
  assert.equal(buildMonitorRecommendation(unconfigured).recommendation, null);

  assertRejected(withRecommendation(zalandoMonitor, null));
  assertRejected(withRecommendation(zalandoMonitor, []));
  assertRejected(withRecommendation(zalandoMonitor, "best_match"));
});

test("strategy must be discount_threshold or best_match", () => {
  assert.deepEqual(buildMonitorRecommendation(zalandoMonitor).recommendation, {
    strategy: "discount_threshold",
    minimum_discount_percent: 20
  });
  assert.deepEqual(buildMonitorRecommendation(vintedMonitor).recommendation, {
    strategy: "best_match",
    minimum_overall_score: 7
  });
  assert.deepEqual(
    buildMonitorRecommendation(
      withRecommendation(zalandoMonitor, { strategy: "best_match", minimumOverallScore: 6.5 })
    ).recommendation,
    { strategy: "best_match", minimum_overall_score: 6.5 }
  );

  for (const strategy of [undefined, "", "Best_Match", "rules", 1]) {
    assertRejected(withRecommendation(vintedMonitor, { strategy, minimumOverallScore: 7 }));
  }
  assertRejected(withRecommendation(vintedMonitor, { minimumOverallScore: 7 }));
});

test("minimumDiscountPercent is an integer from 1 to 99 for zalando only", () => {
  for (const minimumDiscountPercent of [1, 50, 99]) {
    assert.deepEqual(
      buildMonitorRecommendation(
        withRecommendation(zalandoMonitor, { strategy: "discount_threshold", minimumDiscountPercent })
      ).recommendation,
      { strategy: "discount_threshold", minimum_discount_percent: minimumDiscountPercent }
    );
  }

  for (const minimumDiscountPercent of [0, 100, -5, 20.5, "20", null, undefined, Number.NaN]) {
    assertRejected(
      withRecommendation(zalandoMonitor, { strategy: "discount_threshold", minimumDiscountPercent })
    );
  }
  assertRejected(
    withRecommendation(vintedMonitor, { strategy: "discount_threshold", minimumDiscountPercent: 20 })
  );
});

test("minimumOverallScore is a finite number from 0 to 10 with at most one decimal", () => {
  for (const minimumOverallScore of [0, 7, 7.3, 9.9, 10]) {
    assert.deepEqual(
      buildMonitorRecommendation(
        withRecommendation(vintedMonitor, { strategy: "best_match", minimumOverallScore })
      ).recommendation,
      { strategy: "best_match", minimum_overall_score: minimumOverallScore }
    );
  }

  for (const minimumOverallScore of [
    -0.1,
    10.1,
    7.25,
    7.01,
    Number.POSITIVE_INFINITY,
    Number.NaN,
    "7",
    null,
    undefined
  ]) {
    assertRejected(withRecommendation(vintedMonitor, { strategy: "best_match", minimumOverallScore }));
  }
});

test("unknown keys inside recommendation are rejected", () => {
  assert.doesNotThrow(() => buildMonitorRecommendation(vintedMonitor));

  assertRejected(
    withRecommendation(vintedMonitor, { strategy: "best_match", minimumOverallScore: 7, minimumScore: 7 })
  );
  assertRejected(
    withRecommendation(vintedMonitor, { strategy: "best_match", minimumOverallScore: 7, rules: [] })
  );
  assertRejected(
    withRecommendation(zalandoMonitor, {
      strategy: "discount_threshold",
      minimumDiscountPercent: 20,
      minimumOverallScore: 7
    })
  );
  assertRejected(
    withRecommendation(zalandoMonitor, {
      strategy: "best_match",
      minimumOverallScore: 7,
      minimumDiscountPercent: 20
    })
  );
});

test("displayName is optional and, when present, a trimmed string of 1-80 characters", () => {
  const { displayName: _omitted, ...unnamed } = vintedMonitor;
  assert.equal(buildMonitorRecommendation(unnamed).display_name, null);
  assert.equal(buildMonitorRecommendation(vintedMonitor).display_name, "Vinted – blazers");
  assert.equal(
    buildMonitorRecommendation(withDisplayName(vintedMonitor, "x".repeat(80))).display_name,
    "x".repeat(80)
  );

  for (const displayName of ["", " ", " Vinted", "Vinted ", "x".repeat(81), null, 7, ["Vinted"]]) {
    assertRejected(withDisplayName(vintedMonitor, displayName));
  }
});

test("the document lists every monitor by id, including disabled ones, without scan details", () => {
  const { recommendation: _omitted, ...rest } = zalandoMonitor;
  const unconfigured: MonitorEnvelope = { ...rest, id: "a-unconfigured", enabled: false };
  const document = buildMonitorRecommendationsDocument([zalandoMonitor, vintedMonitor, unconfigured]);

  assert.deepEqual(document, {
    contract_version: 1,
    monitor_count: 3,
    monitors: [
      {
        id: "a-unconfigured",
        source: "zalando",
        display_name: "Zalando – shoes",
        enabled: false,
        recommendation: null
      },
      {
        id: "vinted-monitor",
        source: "vinted",
        display_name: "Vinted – blazers",
        enabled: true,
        recommendation: { strategy: "best_match", minimum_overall_score: 7 }
      },
      {
        id: "zalando-monitor",
        source: "zalando",
        display_name: "Zalando – shoes",
        enabled: true,
        recommendation: { strategy: "discount_threshold", minimum_discount_percent: 20 }
      }
    ]
  });
  // deepEqual above already rules out extra keys; this states the intent.
  assert.doesNotMatch(JSON.stringify(document), /https?:|filters|pages|listing|checked_at/);
});

test("generation is deterministic regardless of configuration order", async () => {
  const first = await generateFrom([zalandoMonitor, vintedMonitor]);
  const second = await generateFrom([vintedMonitor, zalandoMonitor]);

  assert.equal(first, second);
  assert.equal(first, await generateFrom([zalandoMonitor, vintedMonitor]));
  assert.ok(first.endsWith("}\n"));
  assert.ok(!first.includes("\r"));
});

test("an invalid recommendation fails the generator", async () => {
  await assert.rejects(
    generateFrom([
      vintedMonitor,
      withRecommendation(zalandoMonitor, { strategy: "discount_threshold", minimumDiscountPercent: 0 })
    ]),
    /Invalid recommendation configuration for monitor zalando-monitor/
  );
  await assert.rejects(
    generateFrom([vintedMonitor, { ...vintedMonitor }]),
    /Invalid monitor configuration envelope/
  );
});

test("the committed monitor recommendation document equals the generator output", async () => {
  const generated = await generateMonitorRecommendations();
  const committed = await fs.readFile(PUBLISHED_URL, "utf8");

  assertMonitorRecommendationsInSync(generated, committed);
});

test("the sync check fails when the committed document drifts", () => {
  const generated = serializeMonitorRecommendationsDocument(
    buildMonitorRecommendationsDocument([zalandoMonitor, vintedMonitor])
  );

  assert.doesNotThrow(() => assertMonitorRecommendationsInSync(generated, generated));
  assert.doesNotThrow(() =>
    assertMonitorRecommendationsInSync(generated, generated.replace(/\n/g, "\r\n"))
  );
  for (const committed of [
    generated.replace("\"minimum_overall_score\": 7", "\"minimum_overall_score\": 8"),
    generated.replace("\n  ]\n}\n", "\n  ]\n}"),
    generated.replace("  \"monitor_count\"", "    \"monitor_count\""),
    ""
  ]) {
    assert.notEqual(committed, generated);
    assert.throws(
      () => assertMonitorRecommendationsInSync(generated, committed),
      /monitor-recommendations\.json is out of date/
    );
  }
});

test("scanner loaders ignore displayName and recommendation, even when invalid", async () => {
  const invalid = withDisplayName(
    withRecommendation(zalandoMonitor, { strategy: "unknown", extra: true }),
    ""
  );
  const options = { readFile: async () => JSON.stringify([invalid, vintedMonitor]) };

  assert.equal((await loadValidatedEnabledMonitors("zalando", options)).length, 1);
  assert.equal((await loadValidatedEnabledMonitors("vinted", options)).length, 1);

  // The checked-in configuration also still loads for both scanners.
  assert.equal((await loadValidatedEnabledMonitors("vinted")).length, 2);
  assert.equal((await loadValidatedEnabledMonitors("zalando")).length, 2);
});
