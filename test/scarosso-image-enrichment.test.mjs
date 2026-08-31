import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  extractProductPageImage,
  normalizeProductUrl,
  normalizeScarossoProductUrl,
  validateScarossoImageUrl
} from "../scripts/lib/scarosso-image.mjs";
import {
  buildPreviousImageIndex,
  loadPreviousImageIndex,
  reusePreviousImages
} from "../scripts/lib/scarosso-image-snapshot.mjs";
import { fetchProductPageImages } from "../scripts/lib/scarosso-image-fetcher.mjs";
import {
  extractProductsFromListing,
  scan
} from "../scripts/scan-scarosso.mjs";

const PRODUCT_URL =
  "https://www.scarosso.com/en-us/men/shoes/example-SKU.html";

test("normalizes product identity without changing its pathname", () => {
  assert.equal(
    normalizeProductUrl("/en-us/men/shoes/example-SKU.html?size=42#details"),
    PRODUCT_URL
  );
  assert.equal(normalizeProductUrl("http://[invalid"), null);
});

test("accepts only canonical Scarosso product URLs", () => {
  assert.equal(
    normalizeScarossoProductUrl(`${PRODUCT_URL}?size=42#details`),
    PRODUCT_URL
  );

  for (const invalidUrl of [
    "http://www.scarosso.com/en-us/men/shoes/example-SKU.html",
    "https://user:password@www.scarosso.com/en-us/men/shoes/example-SKU.html",
    "https://www.scarosso.com:8443/en-us/men/shoes/example-SKU.html"
  ]) {
    assert.equal(normalizeScarossoProductUrl(invalidUrl), null);
  }
});

test("accepts only HTTP(S) images on an explicitly allowed host", () => {
  assert.equal(
    validateScarossoImageUrl("/images/shoe.jpg", PRODUCT_URL),
    "https://www.scarosso.com/images/shoe.jpg"
  );
  assert.equal(validateScarossoImageUrl("data:image/gif;base64,abc"), null);
  assert.equal(validateScarossoImageUrl("https://cdn.scarosso.com/shoe.jpg"), null);
  assert.equal(validateScarossoImageUrl("https://example.com/shoe.jpg"), null);
  assert.equal(validateScarossoImageUrl("http://[invalid"), null);
});

test("extracts a validated primary product-media image", async () => {
  const html = await readFile(
    new URL("fixtures/scarosso-product-primary-image.html", import.meta.url),
    "utf8"
  );

  assert.equal(
    extractProductPageImage(html, PRODUCT_URL),
    "https://www.scarosso.com/on/demandware.static/product-primary.jpg"
  );
});

test("falls back to a relative image from Product JSON-LD", async () => {
  const html = await readFile(
    new URL("fixtures/scarosso-product-jsonld.html", import.meta.url),
    "utf8"
  );

  assert.equal(
    extractProductPageImage(html, PRODUCT_URL),
    "https://www.scarosso.com/images/product-jsonld.jpg"
  );
});

test("prefers primary product-media markup over Product JSON-LD", async () => {
  const html = await readFile(
    new URL(
      "fixtures/scarosso-product-image-precedence.html",
      import.meta.url
    ),
    "utf8"
  );

  assert.equal(
    extractProductPageImage(html, PRODUCT_URL),
    "https://www.scarosso.com/images/primary-markup.jpg"
  );
});

test("ignores unrelated images, unexpected hosts, and malformed JSON-LD", () => {
  const html = `
    <img src="https://www.scarosso.com/unrelated.jpg">
    <script type="application/ld+json">not json</script>
    <script type="application/ld+json">
      {"@type":"Product","image":"https://example.com/product.jpg"}
    </script>
  `;

  assert.equal(extractProductPageImage(html, PRODUCT_URL), null);
});

test("reuses a previous validated image by exact normalized product URL", () => {
  const previousImages = buildPreviousImageIndex({
    products: [
      {
        url: `${PRODUCT_URL}?old=true#details`,
        image: "https://www.scarosso.com/images/previous.jpg"
      },
      {
        url: "https://www.scarosso.com/en-us/other.html",
        image: "https://example.com/unapproved.jpg"
      }
    ]
  });
  const result = reusePreviousImages(
    [
      { url: `${PRODUCT_URL}?current=true`, image: null },
      {
        url: "https://www.scarosso.com/en-us/different.html",
        image: null
      }
    ],
    previousImages
  );

  assert.equal(result.reusedCount, 1);
  assert.equal(
    result.products[0].image,
    "https://www.scarosso.com/images/previous.jpg"
  );
  assert.equal(result.products[1].image, null);
});

test("treats missing, malformed, and incompatible snapshots as empty", async () => {
  const failures = [
    async () => {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    },
    async () => "not json",
    async () => JSON.stringify({ products: "not an array" })
  ];

  for (const readFile of failures) {
    const index = await loadPreviousImageIndex("ignored.json", readFile);
    assert.equal(index.size, 0);
  }
});

test("does not replace an already valid current image", () => {
  const previousImages = new Map([
    [PRODUCT_URL, "https://www.scarosso.com/images/previous.jpg"]
  ]);
  const result = reusePreviousImages(
    [
      {
        url: PRODUCT_URL,
        image: "https://www.scarosso.com/images/current.jpg"
      }
    ],
    previousImages
  );

  assert.equal(result.reusedCount, 0);
  assert.equal(
    result.products[0].image,
    "https://www.scarosso.com/images/current.jpg"
  );
});

test("direct fetching deduplicates URLs and never uses ScrapingAnt", async () => {
  const requestedUrls = [];
  const fetchImpl = async (url, options) => {
    requestedUrls.push({ url, options });
    return {
      ok: true,
      async text() {
        return `
          <div class="product-media">
            <div class="primary">
              <img src="/images/fetched.jpg">
            </div>
          </div>
        `;
      }
    };
  };

  const results = await fetchProductPageImages(
    [PRODUCT_URL, `${PRODUCT_URL}?duplicate=true`, PRODUCT_URL],
    { fetchImpl }
  );

  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0].url, PRODUCT_URL);
  assert.equal(requestedUrls[0].options.redirect, "manual");
  assert.equal(requestedUrls[0].options.signal.aborted, false);
  assert.ok(
    requestedUrls.every(({ url }) => !url.includes("api.scrapingant.com"))
  );
  assert.equal(
    results.get(PRODUCT_URL),
    "https://www.scarosso.com/images/fetched.jpg"
  );
});

test("direct fetching skips non-canonical product URLs", async () => {
  const requestedUrls = [];
  const invalidUrls = [
    "http://www.scarosso.com/en-us/men/shoes/http-SKU.html",
    "https://user:password@www.scarosso.com/en-us/men/shoes/credentials-SKU.html",
    "https://www.scarosso.com:8443/en-us/men/shoes/port-SKU.html"
  ];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    return {
      ok: true,
      async text() {
        return '<div class="product-media"><img class="primary" src="/images/valid.jpg"></div>';
      }
    };
  };

  const results = await fetchProductPageImages(
    [...invalidUrls, PRODUCT_URL],
    { fetchImpl }
  );

  assert.deepEqual(requestedUrls, [PRODUCT_URL]);
  assert.equal(results.size, 1);
  assert.equal(
    results.get(PRODUCT_URL),
    "https://www.scarosso.com/images/valid.jpg"
  );
});

test("listing extraction skips non-canonical product URLs", () => {
  const html = `
    <article>
      <a href="http://www.scarosso.com/en-us/men/shoes/http-SKU.html">HTTP</a>
      <a href="https://user:password@www.scarosso.com/en-us/men/shoes/credentials-SKU.html">Credentials</a>
      <a href="https://www.scarosso.com:8443/en-us/men/shoes/port-SKU.html">Port</a>
      <a href="${PRODUCT_URL}?size=42#details">Canonical</a>
      <div>Original $200.00 Sale $140.00 Size 42</div>
    </article>
  `;
  const products = extractProductsFromListing(
    html,
    "https://www.scarosso.com/en-us/sales/men/sneakers/",
    "2026-08-31T00:00:00.000Z"
  );

  assert.equal(products.length, 1);
  assert.equal(products[0].url, PRODUCT_URL);
});

test("direct fetching treats non-2xx and no-image pages as misses", async () => {
  const non2xxUrl = PRODUCT_URL;
  const noImageUrl =
    "https://www.scarosso.com/en-us/men/shoes/no-image-SKU.html";
  const fetchImpl = async (url) => ({
    ok: url !== non2xxUrl,
    async text() {
      return '<img src="https://www.scarosso.com/unrelated.jpg">';
    }
  });

  const results = await fetchProductPageImages([non2xxUrl, noImageUrl], {
    fetchImpl
  });

  assert.equal(results.get(non2xxUrl), null);
  assert.equal(results.get(noImageUrl), null);
});

test("direct fetching treats a timeout as a safe miss", async () => {
  const fetchImpl = async (_url, { signal }) => {
    await new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true
      });
    });
  };

  const results = await fetchProductPageImages([PRODUCT_URL], {
    fetchImpl,
    timeoutMs: 5
  });

  assert.equal(results.get(PRODUCT_URL), null);
});

test("scanner keeps six ScrapingAnt calls and isolates enrichment outcomes", async () => {
  const listingHtml = `
    <article data-product-id="existing-image">
      <a href="/en-us/men/shoes/existing-EXISTING.html">
        <img src="/images/existing.jpg" alt="Existing">
      </a>
      <div>Original $200.00 Sale $140.00 Size 42</div>
    </article>
    <article data-product-id="missing-image">
      <a href="/en-us/men/shoes/missing-MISSING.html">Missing</a>
      <div>Original $200.00 Sale $140.00 Size 42</div>
    </article>
    <article data-product-id="fetched-image">
      <a href="/en-us/men/shoes/fetched-FETCHED.html">Fetched</a>
      <div>Original $200.00 Sale $140.00 Size 42</div>
    </article>
  `;
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);

    if (url.startsWith("https://api.scrapingant.com/")) {
      return {
        ok: true,
        async text() {
          return listingHtml;
        }
      };
    }

    if (url.endsWith("/fetched-FETCHED.html")) {
      return {
        ok: true,
        async text() {
          return `
            <div class="product-media">
              <div class="primary">
                <img src="/images/fetched-from-product-page.jpg">
              </div>
            </div>
          `;
        }
      };
    }

    return {
      ok: false,
      async text() {
        return "not used";
      }
    };
  };
  let writtenOutput;
  const fsImpl = {
    async readFile() {
      const error = new Error("missing snapshot");
      error.code = "ENOENT";
      throw error;
    },
    async mkdir() {},
    async writeFile(_outputPath, contents) {
      writtenOutput = JSON.parse(contents);
    }
  };
  const logger = { log() {}, error() {} };

  await scan({
    apiKey: "test-key",
    fetchImpl,
    fsImpl,
    sleepImpl: async () => {},
    logger,
    outputPath: "memory/scarosso-latest.json"
  });

  const scrapingAntCalls = requestedUrls.filter((url) =>
    url.startsWith("https://api.scrapingant.com/")
  );
  const directCalls = requestedUrls.filter((url) =>
    url.startsWith("https://www.scarosso.com/")
  );

  assert.equal(scrapingAntCalls.length, 6);
  assert.deepEqual(
    directCalls.sort(),
    [
      "https://www.scarosso.com/en-us/men/shoes/fetched-FETCHED.html",
      "https://www.scarosso.com/en-us/men/shoes/missing-MISSING.html"
    ]
  );
  assert.equal(writtenOutput.scan_mode, "listing-pages-only");
  assert.equal(writtenOutput.scan_status.successful_pages, 6);
  assert.equal(writtenOutput.scan_status.failed_pages, 0);

  const productsByUrl = new Map(
    writtenOutput.products.map((product) => [product.url, product])
  );
  const matchesByUrl = new Map(
    writtenOutput.matches.map((product) => [product.url, product])
  );
  const existingUrl =
    "https://www.scarosso.com/en-us/men/shoes/existing-EXISTING.html";
  const missingUrl =
    "https://www.scarosso.com/en-us/men/shoes/missing-MISSING.html";
  const fetchedUrl =
    "https://www.scarosso.com/en-us/men/shoes/fetched-FETCHED.html";

  assert.equal(
    productsByUrl.get(existingUrl).image,
    "https://www.scarosso.com/images/existing.jpg"
  );
  assert.equal(productsByUrl.get(missingUrl).image, null);
  assert.equal(
    productsByUrl.get(fetchedUrl).image,
    "https://www.scarosso.com/images/fetched-from-product-page.jpg"
  );
  assert.equal(
    matchesByUrl.get(existingUrl).image,
    "https://www.scarosso.com/images/existing.jpg"
  );
  assert.equal(matchesByUrl.get(missingUrl).image, null);
  assert.equal(
    matchesByUrl.get(fetchedUrl).image,
    "https://www.scarosso.com/images/fetched-from-product-page.jpg"
  );
});
