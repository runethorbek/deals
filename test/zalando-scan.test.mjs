import assert from "node:assert/strict";
import test from "node:test";
import { scan } from "../scripts/scan-zalando.mjs";

const LISTING_HTML = `
  <article>
    <a href="/test-trousers-brand-z123.html" title="Test trousers">
      <img src="https://img01.ztat.net/test-trousers.jpg" alt="Test trousers">
    </a>
    <span>Test trousers 700,00 kr Oprindeligt: 1.000,00 kr -30%</span>
  </article>
`;

const configuredMonitor = {
  id: "zalando-test-monitor",
  source: "zalando",
  enabled: true,
  filters: {
    categorySlug: "herretoej-bukser",
    size: "46",
    upperMaterials: ["pure_linen"],
    minDiscountPercent: 25
  }
};

function createFsRecorder() {
  const writes = [];
  const renames = [];
  const removals = [];

  return {
    writes,
    renames,
    removals,
    implementation: {
      async mkdir() {},
      async writeFile(pathname, contents) {
        writes.push({ pathname, contents });
      },
      async rename(from, to) {
        renames.push({ from, to });
      },
      async rm(pathname, options) {
        removals.push({ pathname, options });
      }
    }
  };
}

test("scanner uses configured Zalando intent and preserves the output contract", async () => {
  const requestedListingUrls = [];
  const fsRecorder = createFsRecorder();
  const outputPath = "zalando-test-output.json";

  await scan({
    apiKey: "test-api-key",
    fetchImpl: async (endpoint) => {
      requestedListingUrls.push(new URL(endpoint).searchParams.get("url"));
      return {
        ok: true,
        async text() {
          return LISTING_HTML;
        }
      };
    },
    fsImpl: fsRecorder.implementation,
    sleepImpl: async () => {},
    logger: { log() {}, error() {} },
    now: () => new Date("2026-09-01T10:00:00.000Z"),
    loadMonitor: async () => configuredMonitor,
    outputPath
  });

  const expectedListingUrl =
    "https://www.zalando.dk/herretoej-bukser/__stoerrelse-46/" +
    "?upper_material=pure_linen";
  const output = JSON.parse(fsRecorder.writes[0].contents);

  assert.deepEqual(requestedListingUrls, [expectedListingUrl]);
  assert.deepEqual(
    {
      site: output.site,
      scan_mode: output.scan_mode,
      start_urls: output.start_urls,
      target_size: output.target_size,
      min_discount_percent: output.min_discount_percent,
      checked_at: output.checked_at,
      scanned_page_count: output.scanned_page_count,
      scanned_product_count: output.scanned_product_count,
      product_count: output.product_count,
      match_count: output.match_count,
      scan_status: output.scan_status
    },
    {
      site: "zalando.dk",
      scan_mode: "zalando-listing-page-only",
      start_urls: [expectedListingUrl],
      target_size: "46",
      min_discount_percent: 25,
      checked_at: "2026-09-01T10:00:00.000Z",
      scanned_page_count: 1,
      scanned_product_count: 1,
      product_count: 1,
      match_count: 1,
      scan_status: {
        attempted_pages: 1,
        successful_pages: 1,
        failed_pages: 0,
        failures: [],
        scanned_product_count: 1,
        published_product_count: 1
      }
    }
  );
  assert.deepEqual(
    {
      target_size: output.products[0].target_size,
      size_46_available: output.products[0].size_46_available,
      size_assumption: output.products[0].size_assumption,
      material_filter: output.products[0].material_filter
    },
    {
      target_size: "46",
      size_46_available: true,
      size_assumption: "listing-url-filtered-by-size-46",
      material_filter: ["pure_linen"]
    }
  );
  assert.deepEqual(
    fsRecorder.writes.map(({ pathname }) => pathname),
    [`${outputPath}.tmp`]
  );
  assert.deepEqual(fsRecorder.renames, [
    { from: `${outputPath}.tmp`, to: outputPath }
  ]);
});

test("invalid configuration stops before requests or output", async () => {
  let requestCount = 0;
  const fsRecorder = createFsRecorder();

  await assert.rejects(
    scan({
      apiKey: "test-api-key",
      fetchImpl: async () => {
        requestCount++;
      },
      fsImpl: fsRecorder.implementation,
      logger: { log() {}, error() {} },
      loadMonitor: async () => ({
        ...configuredMonitor,
        filters: { ...configuredMonitor.filters, size: "48" }
      }),
      outputPath: "zalando-test-output.json"
    }),
    /Invalid enabled Zalando monitor configuration/
  );

  assert.equal(requestCount, 0);
  assert.equal(fsRecorder.writes.length, 0);
  assert.equal(fsRecorder.renames.length, 0);
});

test("required-page failures preserve the previous Zalando output", async () => {
  const fsRecorder = createFsRecorder();

  await assert.rejects(
    scan({
      apiKey: "test-api-key",
      fetchImpl: async () => ({
        ok: false,
        status: 502,
        async text() {
          return "Bad Gateway";
        }
      }),
      fsImpl: fsRecorder.implementation,
      logger: { log() {}, error() {} },
      loadMonitor: async () => configuredMonitor,
      outputPath: "zalando-test-output.json"
    }),
    /Zalando scan failed: 1 of 1 required pages failed/
  );

  assert.equal(fsRecorder.writes.length, 0);
  assert.equal(fsRecorder.renames.length, 0);
});

test("empty successful scans preserve the previous Zalando output", async () => {
  const fsRecorder = createFsRecorder();

  await assert.rejects(
    scan({
      apiKey: "test-api-key",
      fetchImpl: async () => ({
        ok: true,
        async text() {
          return "<html><body>No products</body></html>";
        }
      }),
      fsImpl: fsRecorder.implementation,
      logger: { log() {}, error() {} },
      loadMonitor: async () => configuredMonitor,
      outputPath: "zalando-test-output.json"
    }),
    /Zalando scan produced no products/
  );

  assert.equal(fsRecorder.writes.length, 0);
  assert.equal(fsRecorder.renames.length, 0);
});
