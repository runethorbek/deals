import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fetch from "node-fetch";
import { safeErrorDiagnostic } from "./lib/scan-status.mjs";
import {
  extractProductsFromListing,
  extractProductUrlOccurrences,
  getRenderedHtml
} from "./scan-zalando.mjs";

const DEFAULT_OUTPUT_PATH = path.join(
  process.cwd(),
  "zalando-pagination-report.json.tmp"
);

const LISTINGS = [
  {
    id: "trousers-size-46-natural-materials",
    listingUrl:
      "https://www.zalando.dk/herretoej-bukser/__stoerrelse-46/" +
      "?upper_material=pure_cashmere.pure_linen.pure_wool",
    targetSize: "46",
    upperMaterials: ["pure_cashmere", "pure_linen", "pure_wool"],
    renderedFilterMarkers: [
      "__stoerrelse-46",
      "pure_cashmere",
      "pure_linen",
      "pure_wool"
    ],
    expectedProductUrlText: null
  },
  {
    id: "scarosso-shoes-size-42",
    listingUrl: "https://www.zalando.dk/herresko/scarosso__stoerrelse-42/",
    targetSize: "42",
    upperMaterials: [],
    renderedFilterMarkers: ["scarosso__stoerrelse-42"],
    expectedProductUrlText: "/scarosso-"
  }
];

const PAGES = [1, 2, 3];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildPaginationUrl(listingUrl, page) {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error("Pagination investigation page must be a positive integer");
  }

  const url = new URL(listingUrl);
  if (url.hostname !== "www.zalando.dk" || url.protocol !== "https:") {
    throw new Error("Pagination investigation requires a Zalando Denmark URL");
  }

  if (page === 1) url.searchParams.delete("p");
  else url.searchParams.set("p", String(page));
  return url.toString();
}

export function buildInvestigationPlan(listings = LISTINGS, pages = PAGES) {
  return listings.flatMap((listing) => pages.map((page) => ({
    ...listing,
    page,
    requestedUrl: buildPaginationUrl(listing.listingUrl, page)
  })));
}

function queryEntriesWithoutPage(url) {
  const parsed = new URL(url);
  return [...parsed.searchParams.entries()]
    .filter(([key]) => key !== "p")
    .sort(([keyA, valueA], [keyB, valueB]) => (
      keyA.localeCompare(keyB) || valueA.localeCompare(valueB)
    ));
}

export function filtersRemainInRequestedUrl(listingUrl, requestedUrl) {
  const listing = new URL(listingUrl);
  const requested = new URL(requestedUrl);
  return (
    requested.origin === listing.origin &&
    requested.pathname === listing.pathname &&
    JSON.stringify(queryEntriesWithoutPage(requested)) ===
      JSON.stringify(queryEntriesWithoutPage(listing))
  );
}

function intersection(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function summarizePage({ item, html, previousProductUrls, checkedAt }) {
  const occurrences = extractProductUrlOccurrences(html);
  const products = extractProductsFromListing(
    html,
    item.requestedUrl,
    checkedAt,
    { targetSize: item.targetSize, upperMaterials: item.upperMaterials }
  );
  const productUrls = products.map((product) => product.url).sort();
  const overlapUrls = previousProductUrls === null
    ? []
    : intersection(productUrls, previousProductUrls).sort();
  const newProductUrls = previousProductUrls === null
    ? [...productUrls]
    : productUrls.filter((url) => !previousProductUrls.includes(url));
  const renderedFilterMarkerCounts = Object.fromEntries(
    (item.renderedFilterMarkers ?? []).map((marker) => [
      marker,
      html.toLowerCase().split(marker.toLowerCase()).length - 1
    ])
  );
  const expectedProductUrlMatches = item.expectedProductUrlText === null ||
    item.expectedProductUrlText === undefined
    ? null
    : productUrls.filter((url) => (
      url.toLowerCase().includes(item.expectedProductUrlText.toLowerCase())
    )).length;

  return {
    page: item.page,
    requested_url: item.requestedUrl,
    requested_filters_preserved: filtersRemainInRequestedUrl(
      item.listingUrl,
      item.requestedUrl
    ),
    status: "success",
    rendered_html_bytes: Buffer.byteLength(html),
    product_link_occurrences: occurrences.length,
    unique_product_count: productUrls.length,
    duplicate_link_occurrences: occurrences.length - new Set(occurrences).size,
    rendered_filter_marker_counts: renderedFilterMarkerCounts,
    expected_product_url_text: item.expectedProductUrlText ?? null,
    products_matching_expected_url_text: expectedProductUrlMatches,
    overlap_with_previous_count: previousProductUrls === null
      ? null
      : overlapUrls.length,
    repeats_previous_page: previousProductUrls === null
      ? null
      : (
        productUrls.length === previousProductUrls.length &&
        overlapUrls.length === productUrls.length
      ),
    overlap_with_previous_urls: overlapUrls,
    new_product_urls: newProductUrls,
    product_urls: productUrls,
    error: null
  };
}

export async function investigateZalandoPagination({
  apiKey = process.env.SCRAPINGANT_API_KEY,
  fetchImpl = fetch,
  fsImpl = fs,
  waitImpl = sleep,
  now = () => new Date(),
  outputPath = DEFAULT_OUTPUT_PATH,
  logger = console,
  listings = LISTINGS,
  pages = PAGES
} = {}) {
  if (!apiKey) {
    throw new Error("Missing SCRAPINGANT_API_KEY environment variable");
  }

  const plan = buildInvestigationPlan(listings, pages);
  const checkedAt = now().toISOString();
  const monitorReports = new Map(listings.map((listing) => [
    listing.id,
    {
      monitor_id: listing.id,
      base_listing_url: listing.listingUrl,
      target_size: listing.targetSize,
      pages: []
    }
  ]));

  for (let index = 0; index < plan.length; index++) {
    const item = plan[index];
    const monitorReport = monitorReports.get(item.id);
    const previousPage = monitorReport.pages.at(-1);
    const previousProductUrls = previousPage?.status === "success"
      ? previousPage.product_urls
      : null;

    logger.log(`[${index + 1}/${plan.length}] ${item.requestedUrl}`);

    try {
      const html = await getRenderedHtml(item.requestedUrl, fetchImpl, apiKey);
      const pageReport = summarizePage({
        item,
        html,
        previousProductUrls,
        checkedAt
      });
      monitorReport.pages.push(pageReport);
      logger.log(`Found ${pageReport.unique_product_count} unique products`);
    } catch (error) {
      const diagnostic = safeErrorDiagnostic(error);
      monitorReport.pages.push({
        page: item.page,
        requested_url: item.requestedUrl,
        requested_filters_preserved: filtersRemainInRequestedUrl(
          item.listingUrl,
          item.requestedUrl
        ),
        status: "failed",
        rendered_html_bytes: null,
        product_link_occurrences: 0,
        unique_product_count: 0,
        duplicate_link_occurrences: 0,
        rendered_filter_marker_counts: null,
        expected_product_url_text: item.expectedProductUrlText ?? null,
        products_matching_expected_url_text: null,
        overlap_with_previous_count: null,
        repeats_previous_page: null,
        overlap_with_previous_urls: [],
        new_product_urls: [],
        product_urls: [],
        error: diagnostic
      });
      logger.error(`Request failed: ${diagnostic}`);
    }

    if (index < plan.length - 1) await waitImpl(1000);
  }

  const monitors = [...monitorReports.values()];
  const failedRequests = monitors.flatMap((monitor) => monitor.pages)
    .filter((page) => page.status === "failed").length;
  const report = {
    investigation: "issue-14-slice-0-zalando-pagination",
    checked_at: checkedAt,
    request_mode: "scrapingant-rendered-browser",
    requested_page_count: plan.length,
    successful_request_count: plan.length - failedRequests,
    failed_request_count: failedRequests,
    monitors
  };

  await fsImpl.mkdir(path.dirname(outputPath), { recursive: true });
  await fsImpl.writeFile(outputPath, JSON.stringify(report, null, 2));
  logger.log(`Wrote sanitized report to ${outputPath}`);
  return report;
}

const entryPointUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;

if (import.meta.url === entryPointUrl) {
  investigateZalandoPagination()
    .then((report) => {
      if (report.failed_request_count > 0) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(safeErrorDiagnostic(error));
      process.exitCode = 1;
    });
}
