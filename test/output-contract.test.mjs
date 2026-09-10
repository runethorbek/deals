import assert from "node:assert/strict";
import test from "node:test";

import scarossoSnapshot from "./fixtures/scarosso-empty.json" with { type: "json" };
import scarossoFixture from "./fixtures/scarosso-populated.json" with { type: "json" };
import vintedSnapshot from "./fixtures/vinted-populated.json" with { type: "json" };
import zalandoSnapshot from "./fixtures/zalando-populated.json" with { type: "json" };

const MAX_REASONABLE_AMOUNT = 1_000_000;
const SOURCE_RULES = {
  vinted: {
    site: "vinted.com",
    scanMode: "vinted-listing-pages-only",
    hostname: "www.vinted.dk",
    productPath: /^\/items\//,
    currentPrice: "price"
  },
  scarosso: {
    site: "scarosso.com",
    scanMode: "listing-pages-only",
    hostname: "www.scarosso.com",
    productPath: /\/[^/]+\.html$/,
    currentPrice: "current_price"
  },
  zalando: {
    site: "zalando.dk",
    scanMode: "zalando-listing-page-only",
    hostname: "www.zalando.dk",
    productPath: /\.html$/,
    currentPrice: "current_price"
  }
};

function assertTimestamp(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  const parsed = new Date(value);
  assert.equal(
    Number.isNaN(parsed.valueOf()),
    false,
    `${label} must be a valid timestamp`
  );
  assert.equal(parsed.toISOString(), value, `${label} must be canonical UTC`);
}

function assertPlausibleNumber(value, label, { nullable = true } = {}) {
  if (nullable && value === null) return;

  assert.equal(typeof value, "number", `${label} must be numeric or null`);
  assert.equal(Number.isFinite(value), true, `${label} must be finite`);
  assert.ok(
    value >= 0 && value <= MAX_REASONABLE_AMOUNT,
    `${label} is implausible`
  );
}

function assertProductUrl(url, rules) {
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:", "product URL must use HTTPS");
  assert.equal(
    parsed.hostname,
    rules.hostname,
    "product URL has an invalid host"
  );
  assert.match(
    parsed.pathname,
    rules.productPath,
    "product URL has an invalid path"
  );
  assert.equal(parsed.search, "", "canonical product URL must not have a query");
  assert.equal(parsed.hash, "", "canonical product URL must not have a fragment");
}

function assertPriceRelationships(source, product) {
  const { current_price: current, original_price: original } = product;

  if (original !== undefined && original !== null) {
    assert.equal(typeof current, "number", "original price requires current price");
    assert.ok(original > current, "original price must exceed current price");
  }

  if (
    product.discount_status === "calculated" ||
    product.discount_status === "calculated-from-prices"
  ) {
    assert.equal(typeof original, "number", "calculated discount requires prices");
    assert.equal(typeof current, "number", "calculated discount requires prices");
    const expected = Math.round(((original - current) / original) * 1000) / 10;
    assert.equal(
      product.discount_percent,
      expected,
      "calculated discount must match prices"
    );
  }

  if (source === "scarosso" && current === null) {
    assert.equal(original, null, "missing Scarosso current price forbids original price");
    assert.equal(product.currency, null, "missing Scarosso price forbids currency");
    assert.equal(product.discount_percent, null, "missing Scarosso price forbids discount");
  }

  if (source === "scarosso") {
    if (current !== null) {
      assert.notEqual(product.currency, null, "Scarosso price requires currency");
    }
    if (product.discount_percent !== null) {
      assert.equal(
        product.discount_status,
        "calculated",
        "Scarosso discount requires calculated price relationship"
      );
    }
  }

  if (
    source === "zalando" &&
    product.discount_percent !== null &&
    original === null
  ) {
    assert.equal(
      product.discount_status,
      "explicit-discount-no-price",
      "Zalando discount without original price must be explicit"
    );
    assert.equal(product.discount_percent, product.explicit_discount_percent);
  }
}

function assertMatchesReferenceProducts(snapshot, productUrls) {
  assert.ok(Array.isArray(snapshot.matches));
  assert.equal(snapshot.match_count, snapshot.matches.length);

  const productsByUrl = new Map(
    snapshot.products.map((product) => [product.url, product])
  );
  for (const match of snapshot.matches) {
    assert.ok(productUrls.has(match.url), "match must reference a product URL");
    assert.deepEqual(match, productsByUrl.get(match.url), "match must equal product");
  }

  const expectedMatchUrls = snapshot.products
    .filter((product) =>
      typeof product.discount_percent === "number" &&
      product.discount_percent >= snapshot.min_discount_percent
    )
    .map((product) => product.url)
    .sort();
  assert.deepEqual(
    snapshot.matches.map((match) => match.url).sort(),
    expectedMatchUrls,
    "matches must exactly satisfy min_discount_percent"
  );
}

// This is deliberately test-only. Runtime publication continues to use each
// scanner's existing source-specific checks and failure policy.
function assertPublishedSnapshot(source, snapshot) {
  const rules = SOURCE_RULES[source];
  assert.ok(rules, `unsupported source ${source}`);
  assert.equal(snapshot.site, rules.site);
  assert.equal(snapshot.scan_mode, rules.scanMode);
  assertTimestamp(snapshot.checked_at, `${source} snapshot checked_at`);
  assert.ok(Array.isArray(snapshot.products));
  assert.equal(snapshot.product_count, snapshot.products.length);
  assert.ok(Number.isSafeInteger(snapshot.scanned_page_count));
  assert.ok(snapshot.scanned_page_count > 0);
  assert.ok(Number.isSafeInteger(snapshot.scanned_product_count));
  assert.equal(snapshot.scanned_product_count, snapshot.products.length);
  assert.ok(snapshot.debug && typeof snapshot.debug === "object");
  assert.ok(Array.isArray(snapshot.debug.pages));
  assert.equal(snapshot.debug.pages.length, snapshot.scanned_page_count);

  const productUrls = new Set();
  for (const product of snapshot.products) {
    assert.equal(typeof product.title, "string");
    assert.ok(product.title.length > 0);
    assertProductUrl(product.url, rules);
    assert.equal(
      productUrls.has(product.url),
      false,
      "product URLs must be unique"
    );
    productUrls.add(product.url);
    assert.ok(product.image === null || typeof product.image === "string");
    assertTimestamp(product.checked_at, `${source} product checked_at`);
    assert.equal(product.checked_at, snapshot.checked_at);
    assertPlausibleNumber(product[rules.currentPrice], rules.currentPrice);

    if (Object.hasOwn(product, "original_price")) {
      assertPlausibleNumber(product.original_price, "original_price");
    }
    if (Object.hasOwn(product, "discount_percent")) {
      assertPlausibleNumber(product.discount_percent, "discount_percent");
      if (product.discount_percent !== null) {
        assert.ok(
          product.discount_percent <= 100,
          "discount_percent must not exceed 100"
        );
      }
    }
    if (Array.isArray(product.price_candidates)) {
      for (const candidate of product.price_candidates) {
        assertPlausibleNumber(candidate, "price candidate", { nullable: false });
      }
    }
    assertPriceRelationships(source, product);
  }

  const status = snapshot.scan_status;
  assert.ok(status && typeof status === "object");
  assert.equal(
    status.successful_pages + status.failed_pages,
    status.attempted_pages,
    "scan_status page counts must be consistent"
  );
  assert.equal(
    status.attempted_pages,
    snapshot.scanned_page_count,
    "attempted_pages must equal scanned_page_count"
  );
  assert.equal(status.failures.length, status.failed_pages);
  assert.equal(status.scanned_product_count, snapshot.scanned_product_count);
  const failedPages = snapshot.debug.pages.filter((page) => page.error !== null);
  assert.equal(failedPages.length, status.failed_pages);
  assert.equal(
    snapshot.debug.pages.length - failedPages.length,
    status.successful_pages
  );
  assert.deepEqual(
    status.failures.map((failure) => failure.url),
    failedPages.map((page) => page.url)
  );

  if (source === "vinted") {
    assert.equal(status.published_product_count, snapshot.products.length);
    assert.equal(snapshot.scanned_page_count, snapshot.start_urls.length);
    assert.deepEqual(
      snapshot.debug.pages.map((page) => page.url),
      snapshot.start_urls,
      "debug page URLs must match start_urls"
    );
    assert.equal(status.failed_pages, 0);
    assert.ok(Array.isArray(snapshot.monitors));
    assert.ok(snapshot.monitors.length > 0);
    const monitorById = new Map(
      snapshot.monitors.map((monitor) => [monitor.id, monitor])
    );
    assert.equal(monitorById.size, snapshot.monitors.length);
    if (snapshot.monitors.length > 1) {
      assert.equal(Object.hasOwn(snapshot, "catalog_id"), false);
      assert.equal(Object.hasOwn(snapshot, "target_size_id"), false);
    }

    for (const product of snapshot.products) {
      assert.equal(product.site, rules.site);
      assert.ok(["DKK", "EUR", "USD", null].includes(product.currency));
      assert.equal(product.price === null, product.currency === null);
      assert.equal(typeof product.catalog_id, "string");
      assert.equal(typeof product.target_size_id, "string");
      assert.equal(typeof product.size_assumption, "string");
      assert.ok(Array.isArray(product.source_urls));
      assert.ok(product.source_urls.length > 0);
      assert.ok(Array.isArray(product.monitor_ids));
      assert.ok(product.monitor_ids.length > 0);
      assert.ok(product.monitor_ids.every((id) => monitorById.has(id)));
    }
  } else {
    if (source === "scarosso") {
      assertPlausibleNumber(
        snapshot.min_discount_percent,
        "min_discount_percent",
        { nullable: false }
      );
      assert.ok(snapshot.min_discount_percent <= 100);
      for (const product of snapshot.products) {
        assert.ok(Array.isArray(product.available_sizes));
        const expectedAvailability = product.available_sizes.length > 0
          ? product.available_sizes.includes(snapshot.target_size)
          : null;
        assert.equal(
          product.size_42_available,
          expectedAvailability,
          "Scarosso availability must match available_sizes"
        );
        assert.ok(["USD", "EUR", "GBP", null].includes(product.currency));
        assert.ok(Array.isArray(product.source_urls));
        assert.ok(product.source_urls.length > 0);
      }
    } else {
      assert.equal(snapshot.scanned_page_count, snapshot.start_urls.length);
      assert.deepEqual(
        snapshot.debug.pages.map((page) => page.url),
        snapshot.start_urls,
        "debug page URLs must match start_urls"
      );
      assert.equal(status.failed_pages, 0);
      if (Array.isArray(snapshot.monitors)) {
        assert.ok(snapshot.monitors.length > 0);
        const monitorById = new Map(
          snapshot.monitors.map((monitor) => [monitor.id, monitor])
        );
        assert.equal(monitorById.size, snapshot.monitors.length);
        if (snapshot.monitors.length > 1) {
          assert.equal(Object.hasOwn(snapshot, "target_size"), false);
          assert.equal(Object.hasOwn(snapshot, "min_discount_percent"), false);
        }

        for (const product of snapshot.products) {
          assert.equal(product.site, rules.site);
          assert.equal(product.available, true);
          assert.ok(Array.isArray(product.monitor_ids));
          assert.ok(product.monitor_ids.length > 0);
          assert.ok(product.monitor_ids.every((id) => (
            monitorById.get(id)?.target_size === product.target_size
          )));
          assert.equal(
            product.target_size === "46",
            product.size_46_available === true
          );
          assert.equal(typeof product.size_assumption, "string");
          assert.ok(Array.isArray(product.material_filter));
        }

        const expectedMatches = snapshot.products.filter((product) => (
          typeof product.discount_percent === "number" &&
          product.monitor_ids.some((id) => (
            product.discount_percent >= monitorById.get(id).min_discount_percent
          ))
        ));
        assert.deepEqual(snapshot.matches, expectedMatches);
      } else {
        assertPlausibleNumber(
          snapshot.min_discount_percent,
          "min_discount_percent",
          { nullable: false }
        );
        assert.ok(snapshot.min_discount_percent <= 100);
        for (const product of snapshot.products) {
          assert.equal(product.site, rules.site);
          assert.equal(product.target_size, snapshot.target_size);
          assert.equal(product.size_46_available, true);
          assert.equal(typeof product.size_assumption, "string");
          assert.ok(Array.isArray(product.material_filter));
        }
        assertMatchesReferenceProducts(snapshot, productUrls);
      }
    }

    if (source === "scarosso") assertMatchesReferenceProducts(snapshot, productUrls);
    assert.equal(status.published_product_count, snapshot.matches.length);
  }
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

// Mirrors the field selection in DealRadar's normalizeProducts importer. It
// intentionally stops before DealRadar-owned currency normalization.
function projectForDealRadar(source, snapshot, product) {
  const currentPriceField = SOURCE_RULES[source].currentPrice;
  const targetSize = source === "vinted"
    ? optionalString(product.size_guess) ??
      optionalString(snapshot.target_size_id)
    : optionalString(product.target_size) ??
      optionalString(snapshot.target_size);
  let available = optionalBoolean(product.available);

  if (available === null && targetSize) {
    available = optionalBoolean(product[`size_${targetSize}_available`]);
  }
  if (available === null && source === "vinted") available = true;

  const categories = Array.isArray(product.categories) ? product.categories : [];
  return {
    source: optionalString(snapshot.site),
    externalUrl: optionalString(product.url),
    title: optionalString(product.title),
    imageUrl: optionalString(product.image),
    currentPrice: optionalNumber(product[currentPriceField]),
    originalPrice: optionalNumber(product.original_price),
    currency: optionalString(product.currency),
    discountPercent: optionalNumber(product.discount_percent),
    targetSize,
    available,
    brand: optionalString(product.brand),
    category: optionalString(product.category) ?? optionalString(categories[0]),
    observedAt: !Number.isNaN(Date.parse(product.checked_at))
      ? new Date(product.checked_at).toISOString()
      : new Date(snapshot.checked_at).toISOString(),
    rawData: product
  };
}

test("representative source outputs satisfy the producer contract", () => {
  assertPublishedSnapshot("vinted", vintedSnapshot);
  assertPublishedSnapshot("scarosso", scarossoFixture);
  assertPublishedSnapshot("zalando", zalandoSnapshot);
});

test("the empty Scarosso snapshot remains a separate snapshot-level case", () => {
  assert.equal(scarossoSnapshot.products.length, 0);
  assertPublishedSnapshot("scarosso", scarossoSnapshot);
});

test("published_product_count preserves source-specific match semantics", () => {
  assert.equal(scarossoFixture.products.length, 2);
  assert.equal(scarossoFixture.matches.length, 1);
  assert.equal(scarossoFixture.scan_status.published_product_count, 1);
  assert.equal(zalandoSnapshot.products.length, 2);
  assert.equal(zalandoSnapshot.matches.length, 1);
  assert.equal(zalandoSnapshot.scan_status.published_product_count, 1);
});

test("Vinted contract checks retain nullable and USD price behavior", () => {
  const withoutPrice = structuredClone(vintedSnapshot);
  withoutPrice.products[0].price = null;
  withoutPrice.products[0].currency = null;
  assertPublishedSnapshot("vinted", withoutPrice);

  const usdPrice = structuredClone(vintedSnapshot);
  usdPrice.products[0].price = 25;
  usdPrice.products[0].currency = "USD";
  assertPublishedSnapshot("vinted", usdPrice);
});

test("contract checks reject invalid retailer URLs deterministically", () => {
  const invalidHost = structuredClone(scarossoFixture);
  invalidHost.products[0].url = "https://example.com/en-us/test-penny-loafer.html";
  assert.throws(
    () => assertPublishedSnapshot("scarosso", invalidHost),
    /invalid host/
  );

  const invalidProtocol = structuredClone(zalandoSnapshot);
  invalidProtocol.products[0].url = invalidProtocol.products[0].url.replace(
    "https:",
    "http:"
  );
  assert.throws(
    () => assertPublishedSnapshot("zalando", invalidProtocol),
    /must use HTTPS/
  );
});

test("contract checks reject duplicate URLs and invalid numeric values", () => {
  const duplicate = structuredClone(vintedSnapshot);
  duplicate.products.push(structuredClone(duplicate.products[0]));
  duplicate.product_count++;
  duplicate.scanned_product_count++;
  duplicate.scan_status.scanned_product_count++;
  duplicate.scan_status.published_product_count++;
  assert.throws(
    () => assertPublishedSnapshot("vinted", duplicate),
    /product URLs must be unique/
  );

  const negativePrice = structuredClone(scarossoFixture);
  negativePrice.products[0].current_price = -1;
  assert.throws(
    () => assertPublishedSnapshot("scarosso", negativePrice),
    /implausible/
  );

  const infinitePrice = structuredClone(zalandoSnapshot);
  infinitePrice.products[0].current_price = Number.POSITIVE_INFINITY;
  assert.throws(
    () => assertPublishedSnapshot("zalando", infinitePrice),
    /must be finite/
  );
});

test("contract checks reject inconsistent scan status and discounts", () => {
  const inconsistentStatus = structuredClone(zalandoSnapshot);
  inconsistentStatus.scan_status.successful_pages++;
  assert.throws(
    () => assertPublishedSnapshot("zalando", inconsistentStatus),
    /scan_status page counts must be consistent/
  );

  const invalidDiscount = structuredClone(scarossoFixture);
  invalidDiscount.products[0].discount_percent = 101;
  assert.throws(
    () => assertPublishedSnapshot("scarosso", invalidDiscount),
    /discount_percent must not exceed 100/
  );
});

test("contract checks connect scan status to requested and debug pages", () => {
  const disconnectedStatus = structuredClone(scarossoSnapshot);
  disconnectedStatus.scanned_page_count++;
  disconnectedStatus.debug.pages.push({
    url: "https://www.scarosso.com/en-dk/sales/men/boots/?prefn1=c_size&prefv1=42",
    product_count: 0,
    error: null
  });
  assert.throws(
    () => assertPublishedSnapshot("scarosso", disconnectedStatus),
    /attempted_pages must equal scanned_page_count/
  );

  const mismatchedStartUrls = structuredClone(vintedSnapshot);
  mismatchedStartUrls.debug.pages[0].url =
    "https://www.vinted.dk/catalog?catalog[]=1786&size_ids[]=207&page=2";
  assert.throws(
    () => assertPublishedSnapshot("vinted", mismatchedStartUrls),
    /debug page URLs must match start_urls/
  );
});

test("contract checks reject contradictory source-specific relationships", () => {
  const invalidAvailability = structuredClone(scarossoFixture);
  invalidAvailability.products[0].available_sizes = ["41"];
  assert.throws(
    () => assertPublishedSnapshot("scarosso", invalidAvailability),
    /availability must match available_sizes/
  );

  const invalidPrices = structuredClone(scarossoFixture);
  invalidPrices.products[0].original_price = 100;
  assert.throws(
    () => assertPublishedSnapshot("scarosso", invalidPrices),
    /original price must exceed current price/
  );

  const inconsistentDiscount = structuredClone(zalandoSnapshot);
  inconsistentDiscount.products[0].discount_percent = 29;
  assert.throws(
    () => assertPublishedSnapshot("zalando", inconsistentDiscount),
    /calculated discount must match prices/
  );

  const discountWithoutPrices = structuredClone(scarossoFixture);
  discountWithoutPrices.products[0].original_price = null;
  discountWithoutPrices.products[0].discount_status = "single-price";
  assert.throws(
    () => assertPublishedSnapshot("scarosso", discountWithoutPrices),
    /Scarosso discount requires calculated price relationship/
  );

  const belowThresholdMatch = structuredClone(scarossoFixture);
  belowThresholdMatch.min_discount_percent = 50;
  assert.throws(
    () => assertPublishedSnapshot("scarosso", belowThresholdMatch),
    /matches must exactly satisfy min_discount_percent/
  );
});

test("DealRadar mapping remains compatible for every consumed field", () => {
  const vintedProduct = vintedSnapshot.products[0];
  const scarossoProduct = scarossoFixture.products[0];
  const zalandoProduct = zalandoSnapshot.products[0];

  assert.deepEqual(projectForDealRadar("vinted", vintedSnapshot, vintedProduct), {
    source: vintedSnapshot.site,
    externalUrl: vintedProduct.url,
    title: vintedProduct.title,
    imageUrl: vintedProduct.image,
    currentPrice: vintedProduct.price,
    originalPrice: null,
    currency: vintedProduct.currency,
    discountPercent: null,
    targetSize: vintedProduct.size_guess ?? vintedSnapshot.target_size_id,
    available: true,
    brand: vintedProduct.brand,
    category: null,
    observedAt: vintedProduct.checked_at,
    rawData: vintedProduct
  });

  assert.deepEqual(
    projectForDealRadar("scarosso", scarossoFixture, scarossoProduct),
    {
      source: scarossoFixture.site,
      externalUrl: scarossoProduct.url,
      title: scarossoProduct.title,
      imageUrl: scarossoProduct.image,
      currentPrice: scarossoProduct.current_price,
      originalPrice: scarossoProduct.original_price,
      currency: scarossoProduct.currency,
      discountPercent: scarossoProduct.discount_percent,
      targetSize: scarossoFixture.target_size,
      available: scarossoProduct.size_42_available,
      brand: null,
      category: scarossoProduct.category,
      observedAt: scarossoProduct.checked_at,
      rawData: scarossoProduct
    }
  );

  assert.deepEqual(
    projectForDealRadar("zalando", zalandoSnapshot, zalandoProduct),
    {
      source: zalandoSnapshot.site,
      externalUrl: zalandoProduct.url,
      title: zalandoProduct.title,
      imageUrl: zalandoProduct.image,
      currentPrice: zalandoProduct.current_price,
      originalPrice: zalandoProduct.original_price,
      currency: null,
      discountPercent: zalandoProduct.discount_percent,
      targetSize: zalandoProduct.target_size,
      available: zalandoProduct.size_46_available,
      brand: null,
      category: null,
      observedAt: zalandoProduct.checked_at,
      rawData: zalandoProduct
    }
  );
});

test("DealRadar mapping accepts the additive Zalando multi-monitor fields", () => {
  const snapshot = structuredClone(zalandoSnapshot);
  delete snapshot.target_size;
  delete snapshot.min_discount_percent;
  snapshot.monitors = [
    {
      id: "zalando-scarosso-shoes-42",
      listing_url: "https://www.zalando.dk/herresko/scarosso__stoerrelse-42/",
      target_size: "42",
      min_discount_percent: 30,
      pages: 1,
      product_count: 1,
      status: "success"
    }
  ];
  const product = structuredClone(snapshot.products[0]);
  product.monitor_ids = [snapshot.monitors[0].id];
  product.target_size = "42";
  product.available = true;
  delete product.size_46_available;

  const projected = projectForDealRadar("zalando", snapshot, product);
  assert.equal(projected.targetSize, "42");
  assert.equal(projected.available, true);
  assert.deepEqual(projected.rawData.monitor_ids, [snapshot.monitors[0].id]);
});

test("DealRadar category and timestamp fallbacks remain compatible", () => {
  const product = structuredClone(scarossoFixture.products[1]);
  product.checked_at = "not-a-timestamp";

  const projected = projectForDealRadar("scarosso", scarossoFixture, product);
  assert.equal(projected.category, "flats");
  assert.equal(projected.targetSize, scarossoFixture.target_size);
  assert.equal(projected.available, null);
  assert.equal(projected.observedAt, scarossoFixture.checked_at);
});
