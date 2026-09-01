import assert from "node:assert/strict";
import test from "node:test";
import {
  extractPriceCandidatesFromText,
  extractPricesAndDiscountFromText,
  mergePriceInformation
} from "../scripts/lib/scarosso-price.mjs";
import { mergeProduct } from "../scripts/lib/scarosso-product.mjs";
import { extractProductsFromListing } from "../scripts/scan-scarosso.mjs";

test("normalizes supported currency symbols and codes", () => {
  const cases = [
    ["$129.99", 129.99, "USD"],
    ["129.99 USD", 129.99, "USD"],
    ["EUR 149,50", 149.5, "EUR"],
    ["149,50 €", 149.5, "EUR"],
    ["£80.00", 80, "GBP"],
    ["80 GBP", 80, "GBP"]
  ];

  for (const [text, currentPrice, currency] of cases) {
    const result = extractPricesAndDiscountFromText(text);

    assert.equal(result.current_price, currentPrice);
    assert.equal(result.currency, currency);
    assert.equal(result.discount_status, "single-price");
  }
});

test("keeps numeric price candidates and calculates a same-currency discount", () => {
  const result = extractPricesAndDiscountFromText(
    "Original price USD 250.00 Sale price $175.00"
  );

  assert.deepEqual(result, {
    original_price: 250,
    current_price: 175,
    currency: "USD",
    discount_percent: 30,
    discount_status: "calculated",
    price_candidates: [250, 175]
  });

  assert.deepEqual(
    extractPriceCandidatesFromText("USD 250.00 and $175.00 and $175.00"),
    [250, 175]
  );
});

test("parses thousands-grouped USD, EUR, and GBP prices", () => {
  const cases = [
    ["$1,050.00", "USD"],
    ["USD 1,050.00", "USD"],
    ["1,050.00 USD", "USD"],
    ["€1.050,00", "EUR"],
    ["EUR 1.050,00", "EUR"],
    ["1.050,00 EUR", "EUR"],
    ["£1,050.00", "GBP"],
    ["GBP 1,050.00", "GBP"],
    ["1,050.00 GBP", "GBP"]
  ];

  for (const [text, currency] of cases) {
    const result = extractPricesAndDiscountFromText(text);

    assert.equal(result.current_price, 1050, text);
    assert.equal(result.currency, currency, text);
    assert.deepEqual(result.price_candidates, [1050], text);
  }

  assert.equal(
    extractPricesAndDiscountFromText("USD 1,050").discount_status,
    "no-price-found"
  );
});

test("does not compare prices when currencies conflict", () => {
  const result = extractPricesAndDiscountFromText(
    "US price $200.00 EU price €150.00"
  );

  assert.deepEqual(result, {
    original_price: null,
    current_price: null,
    currency: null,
    discount_percent: null,
    discount_status: "conflicting-currencies",
    price_candidates: [200, 150]
  });
});

test("detects contradictory currency markers around one price", () => {
  for (const text of ["EUR $100.00", "$100.00 EUR"]) {
    assert.deepEqual(extractPricesAndDiscountFromText(text), {
      original_price: null,
      current_price: null,
      currency: null,
      discount_percent: null,
      discount_status: "conflicting-currencies",
      price_candidates: [100]
    });
  }

  assert.equal(
    extractPricesAndDiscountFromText("USD $100.00").currency,
    "USD"
  );
});

test("detects currency conflicts while merging listing observations", () => {
  const result = mergePriceInformation(
    {
      currency: "USD",
      discount_status: "single-price",
      price_candidates: [300]
    },
    {
      currency: "EUR",
      discount_status: "single-price",
      price_candidates: [225]
    }
  );

  assert.equal(result.currency, null);
  assert.equal(result.current_price, null);
  assert.equal(result.original_price, null);
  assert.equal(result.discount_status, "conflicting-currencies");
  assert.deepEqual(result.price_candidates, [300, 225]);
});

test("merges same-currency duplicates without changing numeric price fields", () => {
  const common = {
    title: "Test shoe",
    url: "https://www.scarosso.com/en-us/test-shoe.html",
    image: null,
    category: "sneakers",
    source_url: "https://www.scarosso.com/en-us/sales/men/sneakers/",
    available_sizes: ["42"],
    size_42_available: true,
    currency: "USD",
    checked_at: "2026-08-17T00:00:00.000Z"
  };
  const merged = mergeProduct(
    {
      ...common,
      original_price: null,
      current_price: 300,
      discount_percent: null,
      discount_status: "single-price",
      price_candidates: [300]
    },
    {
      ...common,
      original_price: null,
      current_price: 225,
      discount_percent: null,
      discount_status: "single-price",
      price_candidates: [225]
    }
  );

  assert.equal(merged.original_price, 300);
  assert.equal(merged.current_price, 225);
  assert.equal(merged.currency, "USD");
  assert.deepEqual(merged.price_candidates, [300, 225]);
  assert.equal(merged.category, "sneakers");
  assert.equal(
    merged.source_url,
    "https://www.scarosso.com/en-us/sales/men/sneakers/"
  );
  assert.deepEqual(merged.categories, ["sneakers"]);
  assert.deepEqual(merged.source_urls, [
    "https://www.scarosso.com/en-us/sales/men/sneakers/"
  ]);
});

test("keeps a priced observation when merging a no-price observation", () => {
  const result = mergePriceInformation(
    {
      currency: "EUR",
      discount_status: "single-price",
      price_candidates: [250]
    },
    {
      currency: null,
      discount_status: "no-price-found",
      price_candidates: []
    }
  );

  assert.equal(result.current_price, 250);
  assert.equal(result.currency, "EUR");
  assert.equal(result.discount_status, "single-price");
  assert.deepEqual(result.price_candidates, [250]);
});

test("preserves provenance and currency conflicts across duplicate merges", () => {
  const common = {
    title: "Test shoe",
    url: "https://www.scarosso.com/en-us/test-shoe.html",
    image: null,
    available_sizes: ["42"],
    size_42_available: true,
    checked_at: "2026-08-17T00:00:00.000Z"
  };
  const usdObservation = {
    ...common,
    category: "sneakers",
    source_url: "https://www.scarosso.com/en-us/sales/men/sneakers/",
    original_price: null,
    current_price: 300,
    currency: "USD",
    discount_percent: null,
    discount_status: "single-price",
    price_candidates: [300]
  };
  const eurObservation = {
    ...common,
    category: "last-pairs",
    source_url: "https://www.scarosso.com/en-us/sales/men/last-pairs/",
    original_price: null,
    current_price: 225,
    currency: "EUR",
    discount_percent: null,
    discount_status: "single-price",
    price_candidates: [225]
  };

  const samePageMerge = mergeProduct(usdObservation, eurObservation);
  const scanMerge = mergeProduct(undefined, samePageMerge);

  assert.deepEqual(scanMerge.categories, ["sneakers", "last-pairs"]);
  assert.deepEqual(scanMerge.source_urls, [
    "https://www.scarosso.com/en-us/sales/men/sneakers/",
    "https://www.scarosso.com/en-us/sales/men/last-pairs/"
  ]);
  assert.equal(scanMerge.currency, null);
  assert.equal(scanMerge.current_price, null);
  assert.equal(scanMerge.discount_status, "conflicting-currencies");
  assert.deepEqual(scanMerge.price_candidates, [300, 225]);
});

test("returns an explicit empty price result", () => {
  assert.deepEqual(extractPricesAndDiscountFromText("Price unavailable"), {
    original_price: null,
    current_price: null,
    currency: null,
    discount_percent: null,
    discount_status: "no-price-found",
    price_candidates: []
  });
});

test("listing extraction emits normalized currency", () => {
  const html = `
    <article data-product-id="test-shoe">
      <a href="/en-us/test-shoe.html">
        <img alt="Test Shoe" src="/images/test-shoe.jpg">
      </a>
      <div class="price">Original $300.00 Sale $225.00</div>
      <div class="sizes">42</div>
    </article>
  `;
  const products = extractProductsFromListing(
    html,
    "https://www.scarosso.com/en-us/sales/men/sneakers/",
    "2026-08-17T00:00:00.000Z",
    { targetSize: "42" }
  );

  assert.equal(products.length, 1);
  assert.equal(products[0].currency, "USD");
  assert.equal(products[0].original_price, 300);
  assert.equal(products[0].current_price, 225);
  assert.deepEqual(products[0].price_candidates, [300, 225]);
});
