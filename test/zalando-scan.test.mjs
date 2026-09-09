import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import {
  extractProductsFromListing,
  scan,
  validateZalandoOutput
} from "../scripts/scan-zalando.mjs";

function listingGrid(cards) {
  return `<main id="main-content"><ul role="list"><li>${cards}</li></ul></main>`;
}

const LISTING_HTML = listingGrid(`
  <article>
    <a data-card-type="media" href="/test-trousers-brand-tt123a456-q11.html" title="Test trousers">
      <img src="https://img01.ztat.net/test-trousers.jpg" alt="Test trousers">
    </a>
    <span>Test trousers 700,00 kr Oprindeligt: 1.000,00 kr -30%</span>
  </article>
  <article>
    <a data-card-type="media" href="/full-price-trousers-brand-ff123a456-q11.html" title="Full-price trousers">
      <img src="https://img01.ztat.net/full-price-trousers.jpg" alt="Full-price trousers">
    </a>
    <span>Full-price trousers 900,00 kr</span>
  </article>
`);

function listingCard(pathname, title, priceText = "500,00 kr") {
  return `<article><a data-card-type="media" href="${pathname}"><h3><span>Test</span><span>${title} - blue</span></h3><span>${priceText}</span></a></article>`;
}

const configuredMonitor = {
  id: "zalando-test-monitor",
  source: "zalando",
  enabled: true,
  filters: {
    listingPath: "/herretoej-bukser/__stoerrelse-46/?upper_material=pure_linen",
    targetSize: "46",
    minDiscountPercent: 25
  },
  pages: 1
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
  const listingHtml = listingGrid(await fs.readFile(
    new URL("./fixtures/zalando-listing-card.html", import.meta.url),
    "utf8"
  ));
  const products = extractProductsFromListing(
    listingHtml,
    "https://www.zalando.dk/herretoej-bukser/",
    "2026-09-01T10:00:00.000Z",
    { monitorId: configuredMonitor.id, targetSize: "46", upperMaterials: ["pure_linen"] }
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
    listingGrid(`<article><a data-card-type="media" href="/unidentified-zz123a456-q11.html"><img alt="A model wearing trousers in a studio"></a><span>700,00 kr</span></article>`),
    "https://www.zalando.dk/herretoej-bukser/",
    "2026-09-01T10:00:00.000Z",
    { monitorId: configuredMonitor.id, targetSize: "46", upperMaterials: ["pure_linen"] }
  );

  assert.equal(products[0].title, "Unknown product");
  for (const field of ["brand", "product_name", "product_type", "color"]) {
    assert.equal(Object.hasOwn(products[0], field), false);
  }
});

test("splits identity descriptors from the right", () => {
  const products = extractProductsFromListing(
    listingGrid(`<article><a data-card-type="media" href="/mango-adult-slim-mm123a456-q11.html" aria-label="Wrong ARIA label" title="Wrong anchor title"><img alt="A model in blue chinos"></a><h3><span>Mango</span><span>ADULT - SLIM - Chino - blue</span></h3><span>700,00 kr</span></article>`),
    "https://www.zalando.dk/herretoej-bukser/",
    "2026-09-01T10:00:00.000Z",
    { monitorId: configuredMonitor.id, targetSize: "46", upperMaterials: ["pure_linen"] }
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
    listingGrid(`<article><a data-card-type="media" href="/oversized-identity-oo123a456-q11.html"><img alt="Photo description"></a><h3><span>${oversized}</span><span>${oversized} - ${oversized} - ${oversized}</span></h3><span>700,00 kr</span></article>`),
    "https://www.zalando.dk/herretoej-bukser/",
    "2026-09-01T10:00:00.000Z",
    { monitorId: configuredMonitor.id, targetSize: "46", upperMaterials: ["pure_linen"] }
  );

  assert.equal(products[0].title, "Unknown product");
  assert.equal(Object.hasOwn(products[0], "brand"), false);

  const output = {
    site: "zalando.dk",
    scan_mode: "zalando-listing-page-only",
    start_urls: ["https://www.zalando.dk/herretoej-bukser/__stoerrelse-46/"],
    monitors: [{
      id: configuredMonitor.id,
      listing_url: "https://www.zalando.dk/herretoej-bukser/__stoerrelse-46/",
      target_size: "46",
      min_discount_percent: 25,
      pages: 1,
      product_count: 1,
      status: "success"
    }],
    target_size: "46",
    min_discount_percent: 25,
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
    listingGrid(`<article><a data-card-type="media" href="/long-product-name-ll123a456-q11.html"><img alt="Photo description"></a><h3><span>Mango</span><span>${nameSegment} - ${nameSegment} - Chino - blue</span></h3><span>700,00 kr</span></article>`),
    "https://www.zalando.dk/herretoej-bukser/",
    "2026-09-01T10:00:00.000Z",
    { monitorId: configuredMonitor.id, targetSize: "46", upperMaterials: ["pure_linen"] }
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
    loadMonitors: async () => [configuredMonitor],
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
      monitors: output.monitors,
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
      monitors: [{
        id: configuredMonitor.id,
        listing_url: expectedListingUrl,
        target_size: "46",
        min_discount_percent: 25,
        pages: 1,
        product_count: 2,
        status: "success"
      }],
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
      monitor_ids: output.products[0].monitor_ids,
      available: output.products[0].available,
      size_46_available: output.products[0].size_46_available,
      size_assumption: output.products[0].size_assumption,
      material_filter: output.products[0].material_filter
    },
    {
      target_size: "46",
      monitor_ids: [configuredMonitor.id],
      available: true,
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

test("scans and deduplicates pages while rejecting incoherent pagination metadata", async () => {
  const requestedListingUrls = [];
  const fsRecorder = createFsRecorder();
  const paginatedMonitor = { ...configuredMonitor, pages: 3 };
  const duplicate = listingCard(
    "/shared-trousers-sh123a456-q11.html",
    "Shared trousers",
    "700,00 kr Oprindeligt: 1.000,00 kr -30%"
  );
  const second = listingCard(
    "/second-trousers-se123a456-q11.html",
    "Second trousers"
  );

  await scan({
    apiKey: "test-api-key",
    fetchImpl: async (endpoint) => {
      const listingUrl = new URL(endpoint).searchParams.get("url");
      requestedListingUrls.push(listingUrl);
      const page = new URL(listingUrl).searchParams.get("p");
      return {
        ok: true,
        async text() {
          return listingGrid(page === "2" ? duplicate + second : duplicate);
        }
      };
    },
    fsImpl: fsRecorder.implementation,
    sleepImpl: async () => {},
    logger: { log() {}, error() {} },
    now: () => new Date("2026-09-01T10:00:00.000Z"),
    loadMonitors: async () => [paginatedMonitor],
    outputPath: "zalando-test-output.json"
  });

  const baseUrl =
    "https://www.zalando.dk/herretoej-bukser/__stoerrelse-46/" +
    "?upper_material=pure_linen";
  const output = JSON.parse(fsRecorder.writes[0].contents);

  assert.deepEqual(requestedListingUrls, [
    baseUrl,
    `${baseUrl}&p=2`,
    `${baseUrl}&p=3`
  ]);
  assert.equal(output.scanned_page_count, 3);
  assert.equal(output.scan_status.attempted_pages, 3);
  assert.deepEqual(output.debug.pages.map((page) => page.product_count), [1, 2, 1]);
  assert.equal(output.monitors[0].pages, 3);
  assert.equal(output.monitors[0].product_count, 2);
  assert.equal(output.products.length, 2);
  assert.equal(
    output.products.filter((product) => product.url.includes("shared-trousers")).length,
    1
  );

  const incoherentOutput = structuredClone(output);
  incoherentOutput.monitors[0].pages = 10;
  assert.throws(
    () => validateZalandoOutput(incoherentOutput),
    /Invalid Zalando output contract/
  );
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
      loadMonitors: async () => [{
        ...configuredMonitor,
        filters: { ...configuredMonitor.filters, listingPath: "/shoes/?p=2" }
      }],
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
      loadMonitors: async () => [configuredMonitor],
      outputPath: "zalando-test-output.json"
    }),
    /Zalando scan failed: 1 of 1 required pages failed/
  );

  assert.equal(fsRecorder.writes.length, 0);
  assert.equal(fsRecorder.renames.length, 0);
});

test("a failed page does not prevent later page attempts or publication failure", async () => {
  const requestedListingUrls = [];
  const fsRecorder = createFsRecorder();
  const paginatedMonitor = { ...configuredMonitor, pages: 3 };

  await assert.rejects(scan({
    apiKey: "test-api-key",
    fetchImpl: async (endpoint) => {
      const listingUrl = new URL(endpoint).searchParams.get("url");
      requestedListingUrls.push(listingUrl);
      if (new URL(listingUrl).searchParams.get("p") === "2") {
        return { ok: false, status: 502, async text() { return "Bad Gateway"; } };
      }
      return { ok: true, async text() { return LISTING_HTML; } };
    },
    fsImpl: fsRecorder.implementation,
    sleepImpl: async () => {},
    logger: { log() {}, error() {} },
    loadMonitors: async () => [paginatedMonitor],
    outputPath: "zalando-test-output.json"
  }), /Zalando scan failed: 1 of 3 required pages failed/);

  assert.equal(requestedListingUrls.length, 3);
  assert.equal(new URL(requestedListingUrls[2]).searchParams.get("p"), "3");
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
      loadMonitors: async () => [configuredMonitor],
      outputPath: "zalando-test-output.json"
    }),
    /Zalando monitor zalando-test-monitor produced no products/
  );

  assert.equal(fsRecorder.writes.length, 0);
  assert.equal(fsRecorder.renames.length, 0);
});

test("extracts only genuine Zalando result-card product links", () => {
  const products = extractProductsFromListing(
    `<main id="main-content">
       <a href="/help/faq.html">FAQ</a>
       <ul role="list">
         <li><article><a data-card-type="media" href="/real-product-rp123a456-q11.html?size=42"><h3><span>Real</span><span>Product - blue</span></h3><span>500,00 kr</span></a></article></li>
         <li><article><a data-card-type="media" href="/gant-bukser-shadow-brown-ga322e05w-o11.html?size=46"><h3><span>GANT</span><span>Trousers - brown</span></h3><span>700,00 kr</span></a></article></li>
       </ul>
       <section aria-label="Recommendations">
         <article><a data-card-type="media" href="/outside-grid-oo123a456-q11.html?size=42"><h3><span>Outside</span><span>Grid - black</span></h3><span>600,00 kr</span></a></article>
       </section>
     </main>`,
    "https://www.zalando.dk/herresko/",
    "2026-09-01T10:00:00.000Z",
    { monitorId: "shoes", targetSize: "42" }
  );

  assert.deepEqual(products.map((product) => product.url), [
    "https://www.zalando.dk/real-product-rp123a456-q11.html"
  ]);
  assert.equal(products[0].available, true);
  assert.equal(Object.hasOwn(products[0], "size_46_available"), false);
});

test("combines multiple monitors into one snapshot with truthful provenance", async () => {
  const fsRecorder = createFsRecorder();
  const shoesMonitor = {
    id: "zalando-shoes-size-42",
    source: "zalando",
    enabled: true,
    filters: {
      listingPath: "/herresko/scarosso__stoerrelse-42/",
      targetSize: "42",
      minDiscountPercent: 30
    },
    pages: 1
  };
  const shoeHtml = listingGrid(`<article><a data-card-type="media" href="/scarosso-shoe-ss123a456-q11.html"><h3><span>Scarosso</span><span>Oxford - brown</span></h3><span>600,00 kr Oprindeligt: 1.000,00 kr -40%</span></a></article>`);

  await scan({
    apiKey: "test-api-key",
    fetchImpl: async (endpoint) => ({
      ok: true,
      async text() {
        const listingUrl = new URL(endpoint).searchParams.get("url");
        return listingUrl.includes("herresko") ? shoeHtml : LISTING_HTML;
      }
    }),
    fsImpl: fsRecorder.implementation,
    sleepImpl: async () => {},
    logger: { log() {}, error() {} },
    now: () => new Date("2026-09-01T10:00:00.000Z"),
    loadMonitors: async () => [configuredMonitor, shoesMonitor],
    outputPath: "zalando-test-output.json"
  });

  const output = JSON.parse(fsRecorder.writes[0].contents);
  assert.equal(output.monitors.length, 2);
  assert.equal(output.products.length, 3);
  assert.equal(output.matches.length, 2);
  assert.equal(Object.hasOwn(output, "target_size"), false);
  assert.equal(Object.hasOwn(output, "min_discount_percent"), false);

  const shoe = output.products.find((product) => product.target_size === "42");
  assert.deepEqual(shoe.monitor_ids, [shoesMonitor.id]);
  assert.equal(shoe.available, true);
  assert.equal(Object.hasOwn(shoe, "size_46_available"), false);
  assert.ok(output.debug.pages.every((page) => typeof page.monitor_id === "string"));
});

test("merges duplicate same-size product provenance deterministically", async () => {
  const fsRecorder = createFsRecorder();
  const secondMonitor = {
    ...configuredMonitor,
    id: "zalando-a-second-monitor",
    filters: { ...configuredMonitor.filters, listingPath: "/another-listing/" }
  };

  await scan({
    apiKey: "test-api-key",
    fetchImpl: async () => ({ ok: true, async text() { return LISTING_HTML; } }),
    fsImpl: fsRecorder.implementation,
    sleepImpl: async () => {},
    logger: { log() {}, error() {} },
    loadMonitors: async () => [configuredMonitor, secondMonitor],
    outputPath: "zalando-test-output.json"
  });

  const output = JSON.parse(fsRecorder.writes[0].contents);
  assert.equal(output.products.length, 2);
  assert.deepEqual(output.products[0].monitor_ids, [
    secondMonitor.id,
    configuredMonitor.id
  ].sort());
});

test("conflicting target sizes fail after all monitors are attempted", async () => {
  const fsRecorder = createFsRecorder();
  let requestCount = 0;
  const secondMonitor = {
    ...configuredMonitor,
    id: "zalando-size-42",
    filters: {
      ...configuredMonitor.filters,
      listingPath: "/herresko/scarosso__stoerrelse-42/",
      targetSize: "42"
    }
  };

  await assert.rejects(scan({
    apiKey: "test-api-key",
    fetchImpl: async () => {
      requestCount++;
      return { ok: true, async text() { return LISTING_HTML; } };
    },
    fsImpl: fsRecorder.implementation,
    sleepImpl: async () => {},
    logger: { log() {}, error() {} },
    loadMonitors: async () => [configuredMonitor, secondMonitor],
    outputPath: "zalando-test-output.json"
  }), (error) => {
    assert.match(error.message, /conflicting target sizes/);
    assert.match(
      error.message,
      /https:\/\/www\.zalando\.dk\/test-trousers-brand-tt123a456-q11\.html/
    );
    assert.match(error.message, /zalando-test-monitor target_size=46/);
    assert.match(error.message, /zalando-size-42 target_size=42/);
    assert.match(
      error.message,
      /page=https:\/\/www\.zalando\.dk\/herretoej-bukser\/__stoerrelse-46\//
    );
    assert.match(
      error.message,
      /page=https:\/\/www\.zalando\.dk\/herresko\/scarosso__stoerrelse-42\//
    );
    return true;
  });

  assert.equal(requestCount, 2);
  assert.equal(fsRecorder.writes.length, 0);
});

test("a failed monitor does not prevent remaining monitor attempts or publish", async () => {
  const fsRecorder = createFsRecorder();
  let requestCount = 0;
  const failingMonitor = { ...configuredMonitor, id: "zalando-a-failing" };
  const succeedingMonitor = {
    ...configuredMonitor,
    id: "zalando-b-succeeding",
    filters: { ...configuredMonitor.filters, listingPath: "/another-listing/" }
  };

  await assert.rejects(scan({
    apiKey: "test-api-key",
    fetchImpl: async () => {
      requestCount++;
      if (requestCount === 1) return { ok: false, status: 502, async text() { return "Bad Gateway"; } };
      return { ok: true, async text() { return LISTING_HTML; } };
    },
    fsImpl: fsRecorder.implementation,
    sleepImpl: async () => {},
    logger: { log() {}, error() {} },
    loadMonitors: async () => [failingMonitor, succeedingMonitor],
    outputPath: "zalando-test-output.json"
  }), /1 of 2 required pages failed/);

  assert.equal(requestCount, 2);
  assert.equal(fsRecorder.writes.length, 0);
});

test("zero enabled monitors is a successful no-op", async () => {
  let requestCount = 0;
  const result = await scan({
    apiKey: null,
    fetchImpl: async () => { requestCount++; },
    logger: { log() {}, error() {} },
    loadMonitors: async () => []
  });

  assert.deepEqual(result, { skipped: true });
  assert.equal(requestCount, 0);
});
