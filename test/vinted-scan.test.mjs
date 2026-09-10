import assert from "node:assert/strict";
import test from "node:test";
import monitorConfig from "../config/monitors.json" with { type: "json" };
import { buildVintedListingUrls } from "../scripts/lib/vinted-monitor.mjs";
import { scan } from "../scripts/scan-vinted.mjs";

const LISTING_HTML = `
  <article>
    <a href="/items/123456-test-blazer" title="Test blazer">
      <img src="/images/test-blazer.webp" alt="Test blazer">
    </a>
    <span>Test Brand, Size: S, 100 kr. in excellent condition</span>
  </article>
`;

function listingHtml(itemId, title = "Test blazer") {
  return `
    <article>
      <a href="/items/${itemId}-${title.toLowerCase().replaceAll(" ", "-")}" title="${title}">
        <img src="/images/${itemId}.webp" alt="${title}">
      </a>
      <span>Test Brand, Size: S, 100 kr.</span>
    </article>
  `;
}

const MULTI_MONITORS = [
  {
    id: "vinted-zeta",
    source: "vinted",
    enabled: true,
    filters: { catalogIds: ["1786"], sizeIds: ["207"] },
    pages: 1
  },
  {
    id: "vinted-alpha",
    source: "vinted",
    enabled: true,
    filters: { catalogIds: ["1234"], sizeIds: ["208"] },
    pages: 2
  }
];

test("disabled monitor skips before credentials, requests, or output", async () => {
  let requestCount = 0;
  let writeCount = 0;

  const result = await scan({
    loadMonitors: async () => [],
    fetchImpl: async () => {
      requestCount++;
    },
    fsImpl: {
      async mkdir() {},
      async writeFile() { writeCount++; }
    },
    logger: { log() {}, error() {} }
  });

  assert.deepEqual(result, { skipped: true });
  assert.equal(requestCount, 0);
  assert.equal(writeCount, 0);
});

test("scanner uses configured Vinted pages and writes the existing output contract", async () => {
  const requestedListingUrls = [];
  const requestedTimeouts = [];
  let writtenOutput = null;
  const configuredMonitors = monitorConfig
    .filter((monitor) => monitor.source === "vinted" && monitor.enabled)
    .sort((left, right) => left.id.localeCompare(right.id));
  const expectedUrls = configuredMonitors.flatMap(buildVintedListingUrls);
  const primaryMonitor = configuredMonitors[0];

  await scan({
    apiKey: "test-api-key",
    fetchImpl: async (endpoint) => {
      const requestUrl = new URL(endpoint);
      requestedListingUrls.push(requestUrl.searchParams.get("url"));
      requestedTimeouts.push(requestUrl.searchParams.get("timeout"));
      return {
        ok: true,
        async text() {
          return LISTING_HTML;
        }
      };
    },
    fsImpl: {
      async mkdir() {},
      async writeFile(_outputPath, contents) {
        writtenOutput = JSON.parse(contents);
      },
      async rename() {},
      async rm() {}
    },
    sleepImpl: async () => {},
    logger: { log() {}, error() {} },
    now: () => new Date("2026-09-01T10:00:00.000Z"),
    outputPath: "vinted-test-output.json"
  });

  assert.deepEqual(requestedListingUrls, expectedUrls);
  assert.deepEqual(requestedTimeouts, expectedUrls.map(() => "60"));
  assert.deepEqual(
    {
      site: writtenOutput.site,
      scan_mode: writtenOutput.scan_mode,
      start_urls: writtenOutput.start_urls,
      catalog_id: writtenOutput.catalog_id,
      target_size_id: writtenOutput.target_size_id,
      checked_at: writtenOutput.checked_at,
      scanned_page_count: writtenOutput.scanned_page_count,
      scanned_product_count: writtenOutput.scanned_product_count,
      product_count: writtenOutput.product_count,
      monitors: writtenOutput.monitors,
      scan_status: writtenOutput.scan_status
    },
    {
      site: "vinted.com",
      scan_mode: "vinted-listing-pages-only",
      start_urls: expectedUrls,
      catalog_id: undefined,
      target_size_id: undefined,
      checked_at: "2026-09-01T10:00:00.000Z",
      scanned_page_count: expectedUrls.length,
      scanned_product_count: 1,
      product_count: 1,
      monitors: configuredMonitors.map((monitor) => ({
        id: monitor.id,
        catalog_id: monitor.filters.catalogIds[0],
        size_id: monitor.filters.sizeIds[0],
        pages: monitor.pages,
        product_count: 1,
        status: "success"
      })),
      scan_status: {
        attempted_pages: expectedUrls.length,
        successful_pages: expectedUrls.length,
        failed_pages: 0,
        failures: [],
        scanned_product_count: 1,
        published_product_count: 1
      }
    }
  );
  assert.deepEqual(
    {
      title: writtenOutput.products[0].title,
      url: writtenOutput.products[0].url,
      price: writtenOutput.products[0].price,
      currency: writtenOutput.products[0].currency,
      catalog_id: writtenOutput.products[0].catalog_id,
      target_size_id: writtenOutput.products[0].target_size_id,
      size_assumption: writtenOutput.products[0].size_assumption,
      monitor_ids: writtenOutput.products[0].monitor_ids,
      source_urls: writtenOutput.products[0].source_urls
    },
    {
      title: "Test blazer",
      url: "https://www.vinted.dk/items/123456-test-blazer",
      price: 100,
      currency: "DKK",
      catalog_id: primaryMonitor.filters.catalogIds[0],
      target_size_id: primaryMonitor.filters.sizeIds[0],
      size_assumption: "listing-url-filtered-by-size-id-207",
      monitor_ids: configuredMonitors.map((monitor) => monitor.id),
      source_urls: expectedUrls
    }
  );
});

test("scanner combines sorted Vinted monitors with deduplicated provenance", async () => {
  const requestedListingUrls = [];
  let writtenOutput = null;

  await scan({
    apiKey: "test-api-key",
    loadMonitors: async () => MULTI_MONITORS,
    fetchImpl: async (endpoint) => {
      const listingUrl = new URL(endpoint).searchParams.get("url");
      requestedListingUrls.push(listingUrl);
      const page = new URL(listingUrl).searchParams.get("page");
      const catalog = new URL(listingUrl).searchParams.get("catalog[]");
      const html = catalog === "1234"
        ? (page === "1" ? listingHtml("shared") : listingHtml("alpha-only"))
        : listingHtml("shared");
      return { ok: true, async text() { return html; } };
    },
    fsImpl: {
      async mkdir() {},
      async writeFile(_outputPath, contents) { writtenOutput = JSON.parse(contents); },
      async rename() {},
      async rm() {}
    },
    sleepImpl: async () => {},
    logger: { log() {}, error() {} },
    outputPath: "vinted-test-output.json"
  });

  assert.deepEqual(requestedListingUrls, [
    "https://www.vinted.dk/catalog?catalog[]=1234&size_ids[]=208&page=1",
    "https://www.vinted.dk/catalog?catalog[]=1234&size_ids[]=208&page=2",
    "https://www.vinted.dk/catalog?catalog[]=1786&size_ids[]=207&page=1"
  ]);
  assert.equal("catalog_id" in writtenOutput, false);
  assert.equal("target_size_id" in writtenOutput, false);
  assert.deepEqual(writtenOutput.monitors, [
    { id: "vinted-alpha", catalog_id: "1234", size_id: "208", pages: 2, product_count: 2, status: "success" },
    { id: "vinted-zeta", catalog_id: "1786", size_id: "207", pages: 1, product_count: 1, status: "success" }
  ]);
  assert.equal(writtenOutput.products.length, 2);
  const shared = writtenOutput.products.find((product) => product.url.includes("shared"));
  assert.deepEqual(shared.monitor_ids, ["vinted-alpha", "vinted-zeta"]);
  assert.equal(shared.source_urls.length, 2);
});

test("scanner writes a validated snapshot through an atomic replacement", async () => {
  const temporaryWrites = [];
  const renames = [];
  const outputPath = "vinted-test-output.json";

  await scan({
    apiKey: "test-api-key",
    fetchImpl: async () => ({
      ok: true,
      async text() {
        return LISTING_HTML;
      }
    }),
    fsImpl: {
      async mkdir() {},
      async writeFile(pathname, contents) {
        temporaryWrites.push({ pathname, contents });
      },
      async rename(from, to) {
        renames.push({ from, to });
      },
      async rm() {}
    },
    sleepImpl: async () => {},
    logger: { log() {}, error() {} },
    outputPath
  });

  assert.deepEqual(
    temporaryWrites.map(({ pathname }) => pathname),
    [`${outputPath}.tmp`]
  );
  assert.deepEqual(renames, [
    { from: `${outputPath}.tmp`, to: outputPath }
  ]);
});

test("scanner preserves the last good output when a required page fails", async () => {
  let outputWrites = 0;

  await assert.rejects(
    scan({
      apiKey: "test-api-key",
      fetchImpl: async (endpoint) => {
        const listingUrl = new URL(endpoint).searchParams.get("url");

        if (listingUrl.endsWith("page=2")) {
          return {
            ok: false,
            status: 502,
            async text() {
              return "Bad Gateway";
            }
          };
        }

        return {
          ok: true,
          async text() {
            return LISTING_HTML;
          }
        };
      },
      fsImpl: {
        async mkdir() {},
        async writeFile() {
          outputWrites++;
        }
      },
      sleepImpl: async () => {},
      logger: { log() {}, error() {} },
      outputPath: "vinted-test-output.json"
    }),
    /Vinted scan failed: 2 of 6 required pages failed/
  );

  assert.equal(outputWrites, 0);
});

test("scanner attempts remaining monitor pages but does not publish after any failure", async () => {
  const attemptedUrls = [];
  let outputWrites = 0;

  await assert.rejects(
    scan({
      apiKey: "test-api-key",
      loadMonitors: async () => MULTI_MONITORS,
      fetchImpl: async (endpoint) => {
        const listingUrl = new URL(endpoint).searchParams.get("url");
        attemptedUrls.push(listingUrl);
        if (listingUrl.includes("catalog[]=1234") && listingUrl.endsWith("page=1")) {
          return { ok: false, status: 502, async text() { return "Bad Gateway"; } };
        }
        return { ok: true, async text() { return LISTING_HTML; } };
      },
      fsImpl: { async mkdir() {}, async writeFile() { outputWrites++; } },
      sleepImpl: async () => {},
      logger: { log() {}, error() {} },
      outputPath: "vinted-test-output.json"
    }),
    /Vinted scan failed: 1 of 3 required pages failed/
  );

  assert.ok(attemptedUrls.includes("https://www.vinted.dk/catalog?catalog[]=1234&size_ids[]=208&page=2"));
  assert.ok(attemptedUrls.includes("https://www.vinted.dk/catalog?catalog[]=1786&size_ids[]=207&page=1"));
  assert.equal(outputWrites, 0);
});

test("scanner preserves the last good output when successful pages contain no products", async () => {
  let outputWrites = 0;

  await assert.rejects(
    scan({
      apiKey: "test-api-key",
      fetchImpl: async () => ({
        ok: true,
        async text() {
          return "<html><body>No items</body></html>";
        }
      }),
      fsImpl: {
        async mkdir() {},
        async writeFile() {
          outputWrites++;
        }
      },
      sleepImpl: async () => {},
      logger: { log() {}, error() {} },
      outputPath: "vinted-test-output.json"
    }),
    /Vinted scan produced no products/
  );

  assert.equal(outputWrites, 0);
});

test("scanner fails closed when one successful monitor is empty", async () => {
  let outputWrites = 0;

  await assert.rejects(
    scan({
      apiKey: "test-api-key",
      loadMonitors: async () => MULTI_MONITORS,
      fetchImpl: async (endpoint) => {
        const listingUrl = new URL(endpoint).searchParams.get("url");
        return {
          ok: true,
          async text() {
            return listingUrl.includes("catalog[]=1234")
              ? LISTING_HTML
              : "<html><body>No items</body></html>";
          }
        };
      },
      fsImpl: { async mkdir() {}, async writeFile() { outputWrites++; } },
      sleepImpl: async () => {},
      logger: { log() {}, error() {} },
      outputPath: "vinted-test-output.json"
    }),
    /Vinted monitor vinted-zeta produced no products/
  );

  assert.equal(outputWrites, 0);
});

test("scanner retries transient ScrapingAnt failures before publishing", async () => {
  const attemptsByListingUrl = new Map();
  let writtenOutput = null;

  await scan({
    apiKey: "test-api-key",
    fetchImpl: async (endpoint) => {
      const listingUrl = new URL(endpoint).searchParams.get("url");
      const attempts = (attemptsByListingUrl.get(listingUrl) ?? 0) + 1;
      attemptsByListingUrl.set(listingUrl, attempts);

      if (listingUrl.endsWith("page=1") && attempts < 3) {
        throw new Error("Temporary network failure");
      }

      return {
        ok: true,
        async text() {
          return LISTING_HTML;
        }
      };
    },
    fsImpl: {
      async mkdir() {},
      async writeFile(_outputPath, contents) {
        writtenOutput = JSON.parse(contents);
      },
      async rename() {},
      async rm() {}
    },
    sleepImpl: async () => {},
    logger: { log() {}, error() {} },
    outputPath: "vinted-test-output.json"
  });

  const firstPageUrl =
    "https://www.vinted.dk/catalog?catalog[]=1786&size_ids[]=207&page=1";

  assert.equal(attemptsByListingUrl.get(firstPageUrl), 3);
  assert.equal(writtenOutput.scan_status.failed_pages, 0);
});

test("scanner retries a ScrapingAnt 423 browser-detection response", async () => {
  const attemptsByListingUrl = new Map();
  let writtenOutput = null;

  await scan({
    apiKey: "test-api-key",
    fetchImpl: async (endpoint) => {
      const listingUrl = new URL(endpoint).searchParams.get("url");
      const attempts = (attemptsByListingUrl.get(listingUrl) ?? 0) + 1;
      attemptsByListingUrl.set(listingUrl, attempts);

      if (listingUrl.endsWith("page=2") && attempts === 1) {
        return {
          ok: false,
          status: 423,
          async text() {
            return "Browser detected";
          }
        };
      }

      return {
        ok: true,
        async text() {
          return LISTING_HTML;
        }
      };
    },
    fsImpl: {
      async mkdir() {},
      async writeFile(_outputPath, contents) {
        writtenOutput = JSON.parse(contents);
      },
      async rename() {},
      async rm() {}
    },
    sleepImpl: async () => {},
    logger: { log() {}, error() {} },
    outputPath: "vinted-test-output.json"
  });

  const secondPageUrl =
    "https://www.vinted.dk/catalog?catalog[]=1786&size_ids[]=207&page=2";

  assert.equal(attemptsByListingUrl.get(secondPageUrl), 2);
  assert.equal(writtenOutput.scan_status.failed_pages, 0);
});

test("scanner aborts timed-out ScrapingAnt requests and does not publish", async () => {
  let requestAttempts = 0;
  let abortedRequests = 0;
  let outputWrites = 0;

  await assert.rejects(
    scan({
      apiKey: "test-api-key",
      fetchImpl: async (_endpoint, options) => {
        requestAttempts++;

        return await new Promise((_, reject) => {
          const fallback = setTimeout(() => {
            reject(new Error("Request was not aborted"));
          }, 25);

          options.signal?.addEventListener("abort", () => {
            clearTimeout(fallback);
            abortedRequests++;
            reject(new Error("Request aborted by timeout"));
          }, { once: true });
        });
      },
      fsImpl: {
        async mkdir() {},
        async writeFile() {
          outputWrites++;
        }
      },
      sleepImpl: async () => {},
      logger: { log() {}, error() {} },
      requestTimeoutMs: 5,
      outputPath: "vinted-test-output.json"
    }),
    /Vinted scan failed: 6 of 6 required pages failed/
  );

  assert.equal(requestAttempts, 18);
  assert.equal(abortedRequests, 18);
  assert.equal(outputWrites, 0);
});
