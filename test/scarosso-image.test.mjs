import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractProductsFromListing } from "../scripts/scan-scarosso.mjs";

const SOURCE_URL =
  "https://www.scarosso.com/en-us/sales/men/sneakers/";
const CHECKED_AT = "2026-08-17T00:00:00.000Z";

test("associates shared-card images by exact product URL", async () => {
  const html = await readFile(
    new URL("fixtures/scarosso-shared-variants.html", import.meta.url),
    "utf8"
  );
  const products = extractProductsFromListing(
    html,
    SOURCE_URL,
    CHECKED_AT
  );
  const byUrl = new Map(products.map((product) => [product.url, product]));

  const alpha = byUrl.get("https://www.scarosso.com/en-us/alpha-brown.html");
  const beta = byUrl.get("https://www.scarosso.com/en-us/beta-blue.html");
  const gamma = byUrl.get("https://www.scarosso.com/en-us/gamma-green.html");

  assert.equal(products.length, 3);
  assert.equal(
    alpha.image,
    "https://www.scarosso.com/images/alpha-brown-large.jpg"
  );
  assert.equal(
    beta.image,
    "https://www.scarosso.com/images/beta-blue.jpg"
  );
  assert.equal(gamma.image, null);

  for (const product of [alpha, beta, gamma]) {
    assert.equal(product.original_price, 300);
    assert.equal(product.current_price, 210);
    assert.equal(product.category, "sneakers");
  }
});

test("uses a sole unanchored image only for a single-product card", () => {
  const html = `
    <article data-product-id="single-product">
      <picture>
        <img data-src="/images/single-product.jpg" alt="Single Product">
      </picture>
      <a href="/en-us/single-product.html">Single Product</a>
      <div>Original $200.00 Sale $140.00 Size 42</div>
    </article>
  `;
  const [product] = extractProductsFromListing(
    html,
    SOURCE_URL,
    CHECKED_AT
  );

  assert.equal(
    product.image,
    "https://www.scarosso.com/images/single-product.jpg"
  );
});
