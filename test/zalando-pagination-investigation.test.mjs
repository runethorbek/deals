import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInvestigationPlan,
  buildPaginationUrl,
  filtersRemainInRequestedUrl,
  investigateZalandoPagination
} from "../scripts/investigate-zalando-pagination.mjs";

const LISTINGS = [
  {
    id: "test-listing",
    listingUrl:
      "https://www.zalando.dk/herretoej-bukser/__stoerrelse-46/" +
      "?upper_material=pure_wool",
    targetSize: "46",
    upperMaterials: ["pure_wool"],
    renderedFilterMarkers: ["pure_wool"],
    expectedProductUrlText: "/alpha-"
  }
];

function htmlFor(...productIds) {
  const cards = productIds.map((id) => (
    `<article><a data-card-type="media" href="/${id}-aa123a456-q11.html">` +
    `${id} product listing text</a></article>`
  )).join("");
  return `<main id="main-content"><ul role="list"><li>${cards}</li></ul></main>`;
}

test("builds bounded page URLs while preserving configured filters", () => {
  const base = LISTINGS[0].listingUrl;
  const plan = buildInvestigationPlan(LISTINGS, [1, 2, 3]);

  assert.deepEqual(plan.map((item) => item.requestedUrl), [
    base,
    `${base}&p=2`,
    `${base}&p=3`
  ]);
  assert.ok(plan.every((item) => (
    filtersRemainInRequestedUrl(base, item.requestedUrl)
  )));
  assert.equal(
    buildPaginationUrl(`${base}&p=9`, 1),
    base
  );
  assert.throws(() => buildPaginationUrl(base, 0), /positive integer/);
  assert.throws(
    () => buildPaginationUrl("https://example.com/listing", 2),
    /Zalando Denmark URL/
  );
});

test("writes a sanitized overlap report using rendered ScrapingAnt requests", async () => {
  const requestedListingUrls = [];
  const writtenFiles = [];
  const htmlByPage = new Map([
    ["1", htmlFor("alpha-z1", "bravo-z2", "bravo-z2")],
    ["2", htmlFor("bravo-z2", "charlie-z3")],
    ["3", htmlFor("bravo-z2", "charlie-z3")]
  ]);

  const report = await investigateZalandoPagination({
    apiKey: "secret-test-key",
    listings: LISTINGS,
    pages: [1, 2, 3],
    now: () => new Date("2026-09-08T10:00:00.000Z"),
    waitImpl: async () => {},
    logger: { log() {}, error() {} },
    fetchImpl: async (endpoint) => {
      const request = new URL(endpoint);
      const listingUrl = new URL(request.searchParams.get("url"));
      requestedListingUrls.push(listingUrl.toString());
      assert.equal(request.searchParams.get("browser"), "true");
      assert.equal(request.searchParams.get("x-api-key"), "secret-test-key");
      const page = listingUrl.searchParams.get("p") ?? "1";
      return {
        ok: true,
        async text() {
          return htmlByPage.get(page);
        }
      };
    },
    fsImpl: {
      async mkdir() {},
      async writeFile(pathname, contents) {
        writtenFiles.push({ pathname, contents });
      }
    },
    outputPath: "zalando-pagination-report.json.tmp"
  });

  assert.equal(requestedListingUrls.length, 3);
  assert.equal(report.requested_page_count, 3);
  assert.equal(report.failed_request_count, 0);
  assert.deepEqual(
    report.monitors[0].pages.map((page) => ({
      unique: page.unique_product_count,
      duplicates: page.duplicate_link_occurrences,
      overlap: page.overlap_with_previous_count,
      repeats: page.repeats_previous_page
    })),
    [
      { unique: 2, duplicates: 1, overlap: null, repeats: null },
      { unique: 2, duplicates: 0, overlap: 1, repeats: false },
      { unique: 2, duplicates: 0, overlap: 2, repeats: true }
    ]
  );
  assert.equal(writtenFiles.length, 1);
  assert.equal(
    report.monitors[0].pages[0].rendered_filter_marker_counts.pure_wool,
    0
  );
  assert.equal(report.monitors[0].pages[0].products_matching_expected_url_text, 1);
  assert.doesNotMatch(writtenFiles[0].contents, /secret-test-key/);
});

test("continues after a failed page and records a redacted diagnostic", async () => {
  let requestCount = 0;
  let writtenReport;

  const report = await investigateZalandoPagination({
    apiKey: "secret-test-key",
    listings: LISTINGS,
    pages: [1, 2, 3],
    waitImpl: async () => {},
    logger: { log() {}, error() {} },
    fetchImpl: async (endpoint) => {
      requestCount++;
      const listingUrl = new URL(new URL(endpoint).searchParams.get("url"));
      if (listingUrl.searchParams.get("p") === "2") {
        throw new Error(`failed ${endpoint}`);
      }
      return { ok: true, async text() { return htmlFor(`product-${requestCount}`); } };
    },
    fsImpl: {
      async mkdir() {},
      async writeFile(_pathname, contents) {
        writtenReport = contents;
      }
    },
    outputPath: "zalando-pagination-report.json.tmp"
  });

  assert.equal(requestCount, 3);
  assert.equal(report.failed_request_count, 1);
  assert.equal(report.monitors[0].pages[1].status, "failed");
  assert.doesNotMatch(report.monitors[0].pages[1].error, /secret-test-key/);
  assert.doesNotMatch(writtenReport, /secret-test-key/);
});
