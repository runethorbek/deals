import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import {
  extractProductsFromListing,
  scan,
  validateZalandoOutput
} from "../scripts/scan-zalando.mjs";

const LISTING_HTML = `
  <article>
    <a href="/test-trousers-brand-z123.html" title="Test trousers">
      <img src="https://img01.ztat.net/test-trousers.jpg" alt="Test trousers">
    </a>
    <span>Test trousers 700,00 kr Oprindeligt: 1.000,00 kr -30%</span>
  </article>
  <article>
    <a href="/full-price-trousers-brand-z456.html" title="Full-price trousers">
      <img src="https://img01.ztat.net/full-price-trousers.jpg" alt="Full-price trousers">
    </a>
    <span>Full-price trousers 900,00 kr</span>
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

test("extracts Zalando listing-card identity instead of photo descriptions", async () => {
  const listingHtml = await fs.readFile(
    new URL("./fixtures/zalando-listing-card.html", import.meta.url),
    "utf8"
  );
  const products = extractProductsFromListing(
    listingHtml,
    "https://www.zalando.dk/herretoej-bukser/",
    "2026-09-01T10:00:00.000Z",
    { targetSize: "46", upperMaterials: ["pure_linen"] }
  );

  const boss = products.find((product) => product.brand === "BOSS");
  const boggi = products.find((product) => product.brand === "Boggi Milano");
  const polo = products.find((product) => product.brand === "Polo Ralph Lauren");

  assert.deepEqual(
    {
      brand: boss.brand,
      product_name: boss.product_name,
      product_type: boss.product_type,
      color: boss.color,
      title: boss.title,
      url: boss.url,
      current_price: boss.current_price
    },
    {
      brand: "BOSS",
      product_name: "LENON",
      product_type: "Bukser",
      color: "black",
      title: "BOSS LENON - Bukser - black",
      url: "https://www.zalando.dk/boss-lenon-habitbukser-black-bb122a0vj-q11.html",
      current_price: 1496
    }
  );
  assert.deepEqual(
    {
      brand: boggi.brand,
      product_name: boggi.product_name,
      product_type: boggi.product_type,
      color: boggi.color,
      title: boggi.title
    },
    {
      brand: "Boggi Milano",
      product_name: undefined,
      product_type: "Chino",
      color: "black",
      title: "Boggi Milano - Chino - black"
    }
  );
  assert.equal(polo.title, "Polo Ralph Lauren SLIM FIT WOOL TWILL TROUSER - Habitbukser - classic navy");
  assert.doesNotMatch(polo.title, /Mand iført marineblå/);
});

test("uses Unknown product when a listing card has no structured identity", () => {
  const products = extractProductsFromListing(
    `<article><a href="/unidentified-z123.html"><img alt="A model wearing trousers in a studio"></a><span>700,00 kr</span></article>`,
    "https://www.zalando.dk/herretoej-bukser/",
    "2026-09-01T10:00:00.000Z",
    { targetSize: "46", upperMaterials: ["pure_linen"] }
  );

  assert.equal(products[0].title, "Unknown product");
  for (const field of ["brand", "product_name", "product_type", "color"]) {
    assert.equal(Object.hasOwn(products[0], field), false);
  }
});

test("splits identity descriptors from the right", () => {
  const products = extractProductsFromListing(
    `<article><a href="/mango-adult-slim-z123.html" aria-label="Wrong ARIA label" title="Wrong anchor title"><img alt="A model in blue chinos"></a><h3><span>Mango</span><span>ADULT - SLIM - Chino - blue</span></h3><span>700,00 kr</span></article>`,
    "https://www.zalando.dk/herretoej-bukser/",
    "2026-09-01T10:00:00.000Z",
    { targetSize: "46", upperMaterials: ["pure_linen"] }
  );

  assert.deepEqual(
    {
      product_name: products[0].product_name,
      product_type: products[0].product_type,
      color: products[0].color,
      title: products[0].title
    },
    {
      product_name: "ADULT - SLIM",
      product_type: "Chino",
      color: "blue",
      title: "Mango ADULT - SLIM - Chino - blue"
    }
  );
});

test("bounds extracted identity text and rejects invalid published identity fields", () => {
  const oversized = "x".repeat(121);
  const products = extractProductsFromListing(
    `<article><a href="/oversized-identity-z123.html"><img alt="Photo description"></a><h3><span>${oversized}</span><span>${oversized} - ${oversized} - ${oversized}</span></h3><span>700,00 kr</span></article>`,
    "https://www.zalando.dk/herretoej-bukser/",
    "2026-09-01T10:00:00.000Z",
    { targetSize: "46", upperMaterials: ["pure_linen"] }
  );

  assert.equal(products[0].title, "Unknown product");
  assert.equal(Object.hasOwn(products[0], "brand"), false);

  const output = {
    site: "zalando.dk",
    scan_mode: "zalando-listing-page-only",
    start_urls: ["https://www.zalando.dk/herretoej-bukser/__stoerrelse-46/"],
    target_size: "46",
    checked_at: "2026-09-01T10:00:00.000Z",
    scanned_page_count: 1,
    scanned_product_count: 1,
    product_count: 1,
    products: [{ ...products[0], brand: oversized }],
    match_count: 0,
    matches: []
  };

  assert.throws(() => validateZalandoOutput(output), /Invalid Zalando output contract/);
});

test("omits a reassembled product name that exceeds the identity field limit", () => {
  const nameSegment = "x".repeat(120);
  const products = extractProductsFromListing(
    `<article><a href="/long-product-name-z123.html"><img alt="Photo description"></a><h3><span>Mango</span><span>${nameSegment} - ${nameSegment} - Chino - blue</span></h3><span>700,00 kr</span></article>`,
    "https://www.zalando.dk/herretoej-bukser/",
    "2026-09-01T10:00:00.000Z",
    { targetSize: "46", upperMaterials: ["pure_linen"] }
  );

  assert.equal(Object.hasOwn(products[0], "product_name"), false);
  assert.equal(products[0].title, "Mango - Chino - blue");
});

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
      scanned_product_count: 2,
      product_count: 2,
      match_count: 1,
      scan_status: {
        attempted_pages: 1,
        successful_pages: 1,
        failed_pages: 0,
        failures: [],
        scanned_product_count: 2,
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
