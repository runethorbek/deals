import assert from "node:assert/strict";
import test from "node:test";
import {
  createScanStatus,
  safeErrorSummary
} from "../scripts/scan-scarosso.mjs";

test("builds scan status from page execution results", () => {
  const status = createScanStatus({
    pageResults: [
      {
        url: "https://www.scarosso.com/en-us/sales/men/",
        product_count: 4,
        error: null
      },
      {
        url: "https://www.scarosso.com/en-us/sales/men/boots/",
        product_count: 0,
        error: "ScrapingAnt request failed with HTTP 502"
      },
      {
        url: "https://www.scarosso.com/en-us/sales/men/flats/",
        product_count: 2,
        error: null
      }
    ],
    scannedProductCount: 5,
    publishedProductCount: 4
  });

  assert.deepEqual(status, {
    attempted_pages: 3,
    successful_pages: 2,
    failed_pages: 1,
    failures: [
      {
        url: "https://www.scarosso.com/en-us/sales/men/boots/",
        error_summary: "ScrapingAnt request failed with HTTP 502"
      }
    ],
    scanned_product_count: 5,
    published_product_count: 4
  });
});

test("redacts credentials and normalizes failure summaries", () => {
  const error = new Error(
    "Request failed\nfor https://api.scrapingant.com/v2/general" +
      "?x-api-key=secret-value&browser=true with Bearer another-secret"
  );

  assert.equal(
    safeErrorSummary(error),
    "Request failed for https://api.scrapingant.com/v2/general" +
      "?x-api-key=[REDACTED]&browser=true with Bearer [REDACTED]"
  );
});

test("bounds failure summaries", () => {
  assert.equal(safeErrorSummary(new Error("x".repeat(500))).length, 300);
});
