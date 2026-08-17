import assert from "node:assert/strict";
import test from "node:test";
import {
  createScrapingAntHttpError,
  createScanStatus,
  safeErrorDiagnostic,
  safeErrorSummary
} from "../scripts/lib/scan-status.mjs";
import {
  createScanStatus as createScarossoScanStatus
} from "../scripts/scan-scarosso.mjs";

test("builds the shared scan status shape from execution results", () => {
  const pageResults = [
    {
      url: "https://example.com/page-1",
      product_count: 3,
      error: null
    },
    {
      url: "https://example.com/page-2",
      product_count: 0,
      error: "ScrapingAnt request failed with HTTP 502"
    }
  ];
  const status = createScanStatus({
    pageResults,
    scannedProductCount: 3,
    publishedProductCount: 2
  });

  assert.deepEqual(status, {
    attempted_pages: 2,
    successful_pages: 1,
    failed_pages: 1,
    failures: [
      {
        url: "https://example.com/page-2",
        error_summary: "ScrapingAnt request failed with HTTP 502"
      }
    ],
    scanned_product_count: 3,
    published_product_count: 2
  });

  assert.deepEqual(
    status,
    createScarossoScanStatus({
      pageResults,
      scannedProductCount: 3,
      publishedProductCount: 2
    })
  );
});

test("produces bounded credential-safe failure summaries", () => {
  const error = new Error(
    "Request failed\nfor https://api.scrapingant.com/v2/general" +
      "?x-api-key=secret-value&browser=true with Bearer another-secret " +
      "x".repeat(500)
  );
  const summary = safeErrorSummary(error);

  assert.equal(summary.length, 300);
  assert.doesNotMatch(summary, /secret-value|another-secret/);
  assert.match(summary, /x-api-key=\[REDACTED\]/);
  assert.match(summary, /Bearer \[REDACTED\]/);
});

test("redacts colon-form credentials while preserving safe context", () => {
  const cases = [
    [
      "colon-form x-api-key",
      "x-api-key: secret-value\nrequest_id=api-request",
      "x-api-key: [REDACTED] request_id=api-request"
    ],
    [
      "colon-form x-api-key with ampersand context",
      "x-api-key: secret-value&request_id=ok",
      "x-api-key: [REDACTED]&request_id=ok"
    ],
    [
      "colon-form api-key",
      "api-key: another-secret\nrequest_id=alias-request",
      "api-key: [REDACTED] request_id=alias-request"
    ],
    [
      "Basic authorization",
      "Authorization: Basic dXNlcjpwYXNz; request_id=basic-request",
      "Authorization: Basic [REDACTED]; request_id=basic-request"
    ],
    [
      "non-Bearer authorization",
      "Authorization: Token custom-secret; request_id=token-request",
      "Authorization: Token [REDACTED]; request_id=token-request"
    ],
    [
      "opaque authorization",
      "Authorization: opaque-secret; request_id=opaque-request",
      "Authorization: [REDACTED]; request_id=opaque-request"
    ],
    [
      "Bearer authorization",
      "Authorization: Bearer bearer-secret; request_id=bearer-request",
      "Authorization: Bearer [REDACTED]; request_id=bearer-request"
    ],
    [
      "Bearer authorization with ampersand context",
      "Authorization: Bearer abc123&request_id=ok",
      "Authorization: Bearer [REDACTED]&request_id=ok"
    ]
  ];

  for (const [name, diagnostic, expected] of cases) {
    assert.equal(safeErrorDiagnostic(diagnostic), expected, name);
  }
});

test("fully redacts assignment-form Authorization credentials", () => {
  const cases = [
    [
      "Basic",
      "Authorization=Basic dXNlcjpwYXNz; request_id=basic-assignment",
      "Authorization=Basic [REDACTED]; request_id=basic-assignment"
    ],
    [
      "Bearer",
      "Authorization=Bearer abc123; request_id=bearer-assignment",
      "Authorization=Bearer [REDACTED]; request_id=bearer-assignment"
    ],
    [
      "Bearer with ampersand context",
      "Authorization=Bearer abc123&request_id=ok",
      "Authorization=Bearer [REDACTED]&request_id=ok"
    ],
    [
      "custom scheme",
      "Authorization=CustomScheme secret; request_id=custom-assignment",
      "Authorization=CustomScheme [REDACTED]; request_id=custom-assignment"
    ]
  ];

  for (const [name, diagnostic, expected] of cases) {
    const redacted = safeErrorDiagnostic(diagnostic);

    assert.equal(redacted, expected, name);
    assert.doesNotMatch(
      redacted,
      /dXNlcjpwYXNz|abc123|\bsecret\b/,
      name
    );
  }
});

test("keeps query-string and assignment credential redaction", () => {
  const diagnostic =
    "request https://example.com/?x-api-key=query-secret&browser=true " +
    "api-key=assignment-api-secret password=assignment-secret";
  const redacted = safeErrorDiagnostic(diagnostic);

  assert.equal(
    redacted,
    "request https://example.com/?x-api-key=[REDACTED]&browser=true " +
      "api-key=[REDACTED] password=[REDACTED]"
  );
  assert.doesNotMatch(
    redacted,
    /query-secret|assignment-api-secret|assignment-secret/
  );
});

test("preserves a sanitized response-body diagnostic for HTTP failures", async () => {
  let bodyRead = false;
  const response = {
    status: 502,
    async text() {
      bodyRead = true;
      return (
        "Bad Gateway\nrequest_id=test-request " +
        "x-api-key=body-secret Authorization: Bearer body-bearer"
      );
    }
  };
  const url = "https://www.vinted.dk/catalog?page=2";
  const error = await createScrapingAntHttpError(response, url);

  assert.equal(bodyRead, true);
  assert.equal(
    error.message,
    `ScrapingAnt failed for ${url}: 502 ` +
      "Bad Gateway request_id=test-request " +
      "x-api-key=[REDACTED] Authorization: Bearer [REDACTED]"
  );

  const status = createScanStatus({
    pageResults: [{ url, product_count: 0, error: error.message }],
    scannedProductCount: 0,
    publishedProductCount: 0
  });

  assert.equal(status.failures[0].error_summary, error.message);
  assert.doesNotMatch(status.failures[0].error_summary, /body-secret|body-bearer/);
});
