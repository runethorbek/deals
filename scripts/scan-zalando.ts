import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import {
  createScrapingAntHttpError,
  createScanStatus,
  safeErrorDiagnostic,
  safeErrorSummary
} from "./lib/scan-status.ts";
import type { PageResult, ScanStatus } from "./lib/scan-status.ts";
import { extractPriceInfo } from "./lib/zalando-price.ts";
import type { ZalandoPriceInfo } from "./lib/zalando-price.ts";
import {
  buildZalandoScanPlan,
  loadEnabledZalandoMonitors
} from "./lib/zalando-monitor.ts";
import type { MonitorEnvelope } from "./lib/monitor-config.ts";

/**
 * Identity fields parsed from a listing card. Each optional field is absent
 * (never `null`) when the card does not provide it.
 */
interface ZalandoProductIdentity {
  brand?: string;
  product_name?: string;
  product_type?: string;
  color?: string;
}

/** A published Zalando product; see the Zalando tables in `docs/output-contract.md`. */
export interface ZalandoProduct extends ZalandoProductIdentity, ZalandoPriceInfo {
  title: string;
  url: string;
  image: string | null;
  site: "zalando.dk";
  source_url: string;
  monitor_ids: string[];
  target_size: string;
  available: true;
  size_assumption: string;
  material_filter: string[];
  raw_card_text: string;
  checked_at: string;
  /** Present, and `true`, only when `target_size` is `"46"`. */
  size_46_available?: true;
}

/** A `monitors` entry in the Zalando snapshot. */
export interface ZalandoMonitorSummary {
  id: string;
  listing_url: string;
  target_size: string;
  min_discount_percent: number;
  pages: number;
  product_count: number;
  status: "success";
}

/** A `debug.pages` entry in the Zalando snapshot. */
export interface ZalandoPageResult extends PageResult {
  monitor_id: string;
  product_count: number;
}

/** The published Zalando snapshot; see the Zalando snapshot table in `docs/output-contract.md`. */
export interface ZalandoSnapshot {
  site: "zalando.dk";
  scan_mode: "zalando-listing-page-only";
  start_urls: string[];
  monitors: ZalandoMonitorSummary[];
  /** Present only when exactly one monitor is enabled. */
  target_size?: string;
  /** Present only when exactly one monitor is enabled. */
  min_discount_percent?: number;
  checked_at: string;
  scanned_page_count: number;
  scanned_product_count: number;
  product_count: number;
  products: ZalandoProduct[];
  match_count: number;
  matches: ZalandoProduct[];
  scan_status: ScanStatus;
  debug: {
    pages: ZalandoPageResult[];
    products_with_discount: number;
    products_below_minimum_discount: number;
    products_without_discount: number;
    products_without_price: number;
  };
}

export interface ScanResult {
  skipped: boolean;
}

/**
 * An error from a ScrapingAnt request. The original error object is kept and
 * marked, so its class and message are unchanged.
 */
export interface RetailerRequestError extends Error {
  retailerRequestFailure: true;
}

/** The parts of a fetch response the scanner reads. */
export interface FetchResponseLike {
  ok: boolean;
  /** Read only when `ok` is false. */
  status: number;
  text(): Promise<string>;
}

export interface FetchInit {
  headers: Record<string, string>;
}

/**
 * The injected fetch. Its result is untrusted: `ok` and `text` are checked at
 * runtime, so it may resolve to a partial response or to nothing.
 */
export type FetchLike = (
  url: string,
  init: FetchInit
) => Promise<Partial<FetchResponseLike> | void>;

/**
 * The injected file system. `rm` is optional: cleanup of the temporary file
 * is skipped when it is missing.
 */
export interface FsLike {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  writeFile(path: string, data: string): Promise<unknown>;
  rename(oldPath: string, newPath: string): Promise<unknown>;
  rm?(path: string, options: { force: true }): Promise<unknown>;
}

export interface Logger {
  log(...data: unknown[]): void;
  error(...data: unknown[]): void;
}

interface ScanOptions {
  apiKey?: string | undefined;
  fetchImpl?: FetchLike;
  fsImpl?: FsLike;
  sleepImpl?: (ms: number) => Promise<unknown>;
  logger?: Logger;
  now?: () => Date;
  loadMonitors?: () => Promise<MonitorEnvelope[]>;
  outputPath?: string;
}

/** Where a product was observed; used only for the conflict diagnostic. */
interface ProductObservation {
  monitorId: string;
  targetSize: string;
  pageUrl: string;
}

// cheerio does not re-export domhandler's node type; take it from its API.
type AnyNode = Parameters<typeof cheerio.contains>[0];

const API_KEY = process.env.SCRAPINGANT_API_KEY;

const SITE = "zalando.dk";
const BASE_URL = "https://www.zalando.dk";
const MAX_IDENTITY_FIELD_LENGTH = 120;
const MAX_TITLE_LENGTH = 500;
const MAX_CONFLICTS_IN_DIAGNOSTIC = 5;
const MAX_OBSERVATIONS_IN_DIAGNOSTIC = 6;
const MAX_DIAGNOSTIC_VALUE_LENGTH = 300;
const PRODUCT_ANCHOR_SELECTOR =
  "article a[data-card-type='media'][href]";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function markRetailerRequestFailure(error: unknown): RetailerRequestError {
  const requestError = error instanceof Error
    ? error
    : new Error(String(error ?? "Unknown retailer request failure"));
  // Same property assignment as before.
  return Object.assign(requestError, { retailerRequestFailure: true as const });
}

function isRetailerRequestFailure(
  error: unknown
): error is RetailerRequestError {
  // The object/function check only narrows `unknown`: the previous
  // `error?.retailerRequestFailure === true` was false for null and undefined,
  // and for primitives unless a built-in prototype was patched.
  return (
    (typeof error === "object" || typeof error === "function") &&
    error !== null &&
    "retailerRequestFailure" in error &&
    error.retailerRequestFailure === true
  );
}

function isFetchResponse(
  res: Partial<FetchResponseLike> | void
): res is FetchResponseLike {
  // The existing guard. `status` is not checked, as before; it is read only
  // when `ok` is false.
  return !(!res || typeof res.ok !== "boolean" || typeof res.text !== "function");
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeIdentityText(value: string): string {
  const text = normalizeText(value);
  return text.length <= MAX_IDENTITY_FIELD_LENGTH ? text : "";
}

function isBoundedOptionalString(value: unknown, maximumLength: number): boolean {
  return (
    value === undefined ||
    isBoundedString(value, maximumLength)
  );
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength;
}

function buildExpectedPaginationUrls(
  listingUrl: string,
  pages: number
): string[] | null {
  try {
    const baseUrl = new URL(listingUrl);
    return Array.from({ length: pages }, (_, index) => {
      const pageUrl = new URL(baseUrl);
      const pageNumber = index + 1;
      if (pageNumber > 1) pageUrl.searchParams.set("p", String(pageNumber));
      return pageUrl.toString();
    });
  } catch {
    return null;
  }
}

function boundedDiagnosticValue(value: string): string {
  return safeErrorDiagnostic(value).slice(0, MAX_DIAGNOSTIC_VALUE_LENGTH);
}

function createConflictingTargetSizeError(
  conflictingProductUrls: Set<string>,
  productObservations: Map<string, ProductObservation[]>
): Error {
  const urls = [...conflictingProductUrls].sort();
  const details = urls
    .slice(0, MAX_CONFLICTS_IN_DIAGNOSTIC)
    .map((productUrl) => {
      const observations = (productObservations.get(productUrl) ?? [])
        .toSorted((left, right) => (
          left.monitorId.localeCompare(right.monitorId) ||
          left.targetSize.localeCompare(right.targetSize) ||
          left.pageUrl.localeCompare(right.pageUrl)
        ))
        .slice(0, MAX_OBSERVATIONS_IN_DIAGNOSTIC)
        .map((observation) => (
          `${boundedDiagnosticValue(observation.monitorId)} ` +
          `target_size=${boundedDiagnosticValue(observation.targetSize)} ` +
          `page=${boundedDiagnosticValue(observation.pageUrl)}`
        ));

      return `${boundedDiagnosticValue(productUrl)} [${observations.join("; ")}]`;
    });
  const omittedCount = urls.length - details.length;
  const omittedSuffix = omittedCount > 0
    ? `; ${omittedCount} additional conflict(s) omitted`
    : "";

  return new Error(
    "Zalando scan found the same product through monitors with conflicting " +
    `target sizes: ${details.join(" | ")}${omittedSuffix}`
  );
}

function absoluteUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return null;
  }
}

export function normalizeProductUrl(
  href: string | null | undefined
): string | null {
  const url = absoluteUrl(href);
  if (!url) return null;

  try {
    const parsed = new URL(url);
    parsed.hash = "";

    // Keep no listing/search params on product URLs.
    parsed.search = "";

    return parsed.toString();
  } catch {
    return null;
  }
}

export function isZalandoProductUrl(
  url: string | null | undefined
): url is string {
  if (!url) return false;

  try {
    const parsed = new URL(url);

    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "www.zalando.dk" &&
      /-[a-z0-9]{9}-[a-z0-9]{3}\.html$/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

export async function getRenderedHtml(
  url: string,
  fetchImpl: FetchLike,
  apiKey: string
): Promise<string> {
  const endpoint = new URL("https://api.scrapingant.com/v2/general");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("x-api-key", apiKey);
  endpoint.searchParams.set("browser", "true");

  let res: Partial<FetchResponseLike> | void;
  try {
    res = await fetchImpl(endpoint.toString(), {
      headers: {
        "user-agent": "deal-watch-zalando/1.0"
      }
    });
  } catch (error) {
    throw markRetailerRequestFailure(error);
  }

  if (!isFetchResponse(res)) {
    throw new Error("Invalid ScrapingAnt response");
  }

  if (!res.ok) {
    throw markRetailerRequestFailure(
      await createScrapingAntHttpError(res, url)
    );
  }

  try {
    return await res.text();
  } catch (error) {
    throw markRetailerRequestFailure(error);
  }
}

function visibleText(
  $: cheerio.CheerioAPI,
  node: cheerio.Cheerio<AnyNode>
): string {
  const clone = $(node).clone();
  clone.find("script, style, noscript").remove();
  return normalizeText(clone.text());
}

function findProductContainer(
  $: cheerio.CheerioAPI,
  anchor: AnyNode
): cheerio.Cheerio<AnyNode> {
  const selectors = [
    "article",
    "[data-testid]",
    "[data-zalon-partner-target]",
    "li",
    "div"
  ];

  for (const selector of selectors) {
    const container = $(anchor).closest(selector);
    if (!container.length) continue;

    const text = visibleText($, container);
    if (text.length > 20) return container.first();
  }

  return $(anchor).parent();
}

function extractImage(
  $: cheerio.CheerioAPI,
  container: cheerio.Cheerio<AnyNode>
): string | null {
  const img = container.find("img").first();
  if (!img.length) return null;

  const src =
    img.attr("src") ||
    img.attr("data-src") ||
    img.attr("data-original") ||
    img.attr("data-lazy-src");

  if (src) return absoluteUrl(src);

  const srcset = img.attr("srcset") || img.attr("data-srcset");
  if (!srcset) return null;

  const lastCandidate = srcset
    .split(",")
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter(Boolean)
    .at(-1);

  return absoluteUrl(lastCandidate);
}

function extractProductIdentity(
  $: cheerio.CheerioAPI,
  container: cheerio.Cheerio<AnyNode>
): ZalandoProductIdentity & { title: string } {
  const spans = container.find("h3").first().children("span");
  const brand = normalizeIdentityText(spans.eq(0).text());
  const descriptor = normalizeText(spans.eq(1).text());

  if (!brand && !descriptor) return { title: "Unknown product" };

  const identity: ZalandoProductIdentity = {};
  if (brand) identity.brand = brand;

  const parts = descriptor.split(" - ").map(normalizeIdentityText);
  if (parts.length >= 3 && parts.at(-1) && parts.at(-2)) {
    const productName = normalizeIdentityText(parts.slice(0, -2).join(" - "));
    if (productName) identity.product_name = productName;
    identity.product_type = parts.at(-2);
    identity.color = parts.at(-1);
  } else if (parts.length === 2 && parts[0] && parts[1]) {
    identity.product_type = parts[0];
    identity.color = parts[1];
  }

  const title = [
    identity.brand && [identity.brand, identity.product_name].filter(Boolean).join(" "),
    identity.product_type,
    identity.color
  ]
    .filter(Boolean)
    .join(" - ");

  return title && title.length <= MAX_TITLE_LENGTH
    ? { ...identity, title }
    : { title: "Unknown product" };
}

function findListingProductAnchors(
  $: cheerio.CheerioAPI
): cheerio.Cheerio<AnyNode> {
  const productList = $("main#main-content ul[role='list']")
    .filter((_, list) => (
      $(list).children("li").find(PRODUCT_ANCHOR_SELECTOR).length > 0
    ))
    .first();

  if (!productList.length) return $([]);

  return productList.children("li")
    .filter((_, item) => $(item).find("#view-tracker-wrapper").length === 0)
    .map((_, item) => $(item).find(PRODUCT_ANCHOR_SELECTOR)
      .filter((_, anchor) => $(anchor).closest("li").is(item))
      .toArray()
    );
}

function productLinkMatchesTargetSize(
  href: string | undefined,
  targetSize: string
): boolean {
  if (!targetSize) return true;

  const url = absoluteUrl(href);
  if (!url) return false;
  const linkedSizes = new URL(url).searchParams.getAll("size");
  return linkedSizes.length === 0 || (
    linkedSizes.length === 1 && linkedSizes[0] === targetSize
  );
}

export function extractProductUrlOccurrences(
  html: string,
  targetSize: string
): string[] {
  const $ = cheerio.load(html);
  const productUrls: string[] = [];

  findListingProductAnchors($).each((_, anchor) => {
    const href = $(anchor).attr("href");
    if (!productLinkMatchesTargetSize(href, targetSize)) return;
    const url = normalizeProductUrl(href);
    if (isZalandoProductUrl(url)) productUrls.push(url);
  });

  return productUrls;
}

function scoreProduct(product: ZalandoProduct): number {
  let score = 0;
  if (product.title && product.title !== "Unknown product") score += 2;
  if (product.image) score += 2;
  score += product.price_candidates.length * 10;
  if (typeof product.discount_percent === "number") score += 20;
  return score;
}

export function extractProductsFromListing(
  html: string,
  sourceUrl: string,
  checkedAt: string,
  { monitorId, targetSize, upperMaterials = [] }: {
    /** Omitted by the pagination investigation script. */
    monitorId?: string;
    targetSize: string;
    upperMaterials?: string[];
  }
): ZalandoProduct[] {
  const $ = cheerio.load(html);
  const products = new Map<string, ZalandoProduct>();

  findListingProductAnchors($).each((_, anchor) => {
    const href = $(anchor).attr("href");
    if (!productLinkMatchesTargetSize(href, targetSize)) return;
    const url = normalizeProductUrl(href);

    if (!isZalandoProductUrl(url)) return;

    const container = findProductContainer($, anchor);
    const text = visibleText($, container);
    const priceInfo = extractPriceInfo(text);

    const product: ZalandoProduct = {
      ...extractProductIdentity($, container),
      url,
      image: extractImage($, container),
      site: SITE,
      source_url: sourceUrl,
      monitor_ids: monitorId ? [monitorId] : [],
      target_size: targetSize,
      available: true,
      size_assumption: `listing-url-filtered-by-size-${targetSize}`,
      material_filter: [...upperMaterials],
      raw_card_text: text.slice(0, 500),
      ...priceInfo,
      checked_at: checkedAt
    };

    if (targetSize === "46") product.size_46_available = true;

    const existing = products.get(product.url);
    if (!existing || scoreProduct(product) > scoreProduct(existing)) {
      products.set(product.url, product);
    }
  });

  return [...products.values()];
}

export function validateZalandoOutput(output: ZalandoSnapshot): void {
  if (
    output?.site !== SITE ||
    output.scan_mode !== "zalando-listing-page-only" ||
    !Array.isArray(output.monitors) ||
    output.monitors.length === 0 ||
    !Array.isArray(output.start_urls) ||
    output.start_urls.length === 0 ||
    output.scanned_page_count !== output.start_urls.length ||
    !Array.isArray(output.debug?.pages) ||
    output.debug.pages.length !== output.start_urls.length ||
    output.debug.pages.some((page, index) => (
      page?.url !== output.start_urls[index] ||
      typeof page.monitor_id !== "string" ||
      !Number.isSafeInteger(page.product_count) ||
      page.product_count < 0 ||
      (page.error !== null && !isBoundedString(page.error, 300))
    )) ||
    !Array.isArray(output.products) ||
    output.product_count !== output.products.length ||
    output.scanned_product_count !== output.products.length ||
    !Array.isArray(output.matches) ||
    output.match_count !== output.matches.length ||
    Number.isNaN(Date.parse(output.checked_at))
  ) {
    throw new Error("Invalid Zalando output contract");
  }

  const monitorById = new Map<string, ZalandoMonitorSummary>();
  let expectedPageCount = 0;
  for (const monitor of output.monitors) {
    const monitorPages = output.debug.pages.filter(
      (page) => page.monitor_id === monitor?.id
    );
    const expectedUrls = Number.isSafeInteger(monitor?.pages)
      ? buildExpectedPaginationUrls(monitor?.listing_url, monitor.pages)
      : null;
    if (
      typeof monitor?.id !== "string" ||
      monitor.id.length === 0 ||
      monitorById.has(monitor.id) ||
      !isBoundedString(monitor.target_size, 20) ||
      !Number.isSafeInteger(monitor.min_discount_percent) ||
      monitor.min_discount_percent < 0 ||
      monitor.min_discount_percent > 100 ||
      !Number.isSafeInteger(monitor.pages) ||
      monitor.pages < 1 ||
      monitor.pages > 10 ||
      monitor.status !== "success" ||
      !Number.isSafeInteger(monitor.product_count) ||
      monitor.product_count <= 0 ||
      !expectedUrls ||
      monitorPages.length !== monitor.pages ||
      monitorPages.some((page, index) => page.url !== expectedUrls[index])
    ) {
      throw new Error("Invalid Zalando output contract");
    }
    monitorById.set(monitor.id, monitor);
    expectedPageCount += monitor.pages;
  }

  const expectedFailures = output.debug.pages
    .filter((page) => page.error !== null)
    .map((page) => ({
      url: page.url,
      error_summary: safeErrorDiagnostic(page.error).slice(0, 300)
    }));

  if (
    expectedPageCount !== output.start_urls.length ||
    output.debug.pages.some((page) => !monitorById.has(page.monitor_id)) ||
    !Number.isSafeInteger(output.scan_status?.attempted_pages) ||
    !Number.isSafeInteger(output.scan_status?.successful_pages) ||
    !Number.isSafeInteger(output.scan_status?.failed_pages) ||
    output.scan_status.attempted_pages !== output.start_urls.length ||
    output.scan_status.successful_pages < 0 ||
    output.scan_status.failed_pages < 0 ||
    output.scan_status.successful_pages + output.scan_status.failed_pages !==
      output.scan_status.attempted_pages ||
    !Array.isArray(output.scan_status.failures) ||
    output.scan_status.failures.length !== output.scan_status.failed_pages ||
    output.scan_status.scanned_product_count !== output.products.length ||
    output.scan_status.published_product_count !== output.matches.length ||
    JSON.stringify(output.scan_status.failures) !== JSON.stringify(expectedFailures)
  ) {
    throw new Error("Invalid Zalando output contract");
  }

  if (
    // monitors[0] exists when the length is 1; `?.` only narrows.
    output.monitors.length === 1
      ? output.target_size !== output.monitors[0]?.target_size ||
        output.min_discount_percent !== output.monitors[0]?.min_discount_percent
      : Object.hasOwn(output, "target_size") ||
        Object.hasOwn(output, "min_discount_percent")
  ) {
    throw new Error("Invalid Zalando output contract");
  }

  const productUrls = new Set<string>();

  for (const product of output.products) {
    const productMonitors = Array.isArray(product?.monitor_ids)
      ? product.monitor_ids.map((id) => monitorById.get(id))
      : [];
    if (
      !isZalandoProductUrl(product?.url) ||
      normalizeProductUrl(product.url) !== product.url ||
      product.site !== SITE ||
      product.available !== true ||
      productMonitors.length === 0 ||
      productMonitors.some((monitor) => !monitor) ||
      new Set(product.monitor_ids).size !== product.monitor_ids.length ||
      // The previous id exists when index > 0; `?? ""` only narrows, and
      // `"" > id` is false, as `undefined > id` was.
      product.monitor_ids.some((id, index, ids) => index > 0 && (ids[index - 1] ?? "") > id) ||
      // Every monitor is set here: a missing one already made the
      // `!monitor` check above true, so `?.` only narrows.
      productMonitors.some((monitor) => monitor?.target_size !== product.target_size) ||
      (product.target_size === "46"
        ? product.size_46_available !== true
        : Object.hasOwn(product, "size_46_available")) ||
      product.checked_at !== output.checked_at ||
      !isBoundedString(product.title, MAX_TITLE_LENGTH) ||
      !isBoundedOptionalString(product.brand, MAX_IDENTITY_FIELD_LENGTH) ||
      !isBoundedOptionalString(product.product_name, MAX_IDENTITY_FIELD_LENGTH) ||
      !isBoundedOptionalString(product.product_type, MAX_IDENTITY_FIELD_LENGTH) ||
      !isBoundedOptionalString(product.color, MAX_IDENTITY_FIELD_LENGTH) ||
      !["DKK", null].includes(product.currency) ||
      (product.current_price === null
        ? product.currency !== null
        : product.currency !== "DKK") ||
      productUrls.has(product.url)
    ) {
      throw new Error("Invalid Zalando output contract");
    }

    productUrls.add(product.url);
  }

  const expectedMatchUrls = output.products
    .filter((product) => (
      typeof product.discount_percent === "number" &&
      product.monitor_ids.some((id) => (
        // Repeats the check above: a property narrowing does not carry into
        // a callback. Every product monitor ID was found in monitorById
        // above, so `?.` and `?? Infinity` only narrow.
        typeof product.discount_percent === "number" &&
        product.discount_percent >=
          (monitorById.get(id)?.min_discount_percent ?? Infinity)
      ))
    ))
    .map((product) => product.url)
    .sort();
  const actualMatchUrls = output.matches.map((product) => product?.url).sort();

  if (
    output.matches.some((product) => !productUrls.has(product?.url)) ||
    JSON.stringify(actualMatchUrls) !== JSON.stringify(expectedMatchUrls)
  ) {
    throw new Error("Invalid Zalando output contract");
  }
}

async function publishOutput(
  outputPath: string,
  output: ZalandoSnapshot,
  fsImpl: FsLike
): Promise<void> {
  validateZalandoOutput(output);

  const temporaryOutputPath = `${outputPath}.tmp`;

  await fsImpl.mkdir(path.dirname(outputPath), { recursive: true });

  try {
    await fsImpl.writeFile(
      temporaryOutputPath,
      JSON.stringify(output, null, 2)
    );
    await fsImpl.rename(temporaryOutputPath, outputPath);
  } catch (error) {
    await fsImpl.rm?.(temporaryOutputPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function scan({
  apiKey = API_KEY,
  fetchImpl = fetch,
  fsImpl = fs,
  sleepImpl = sleep,
  logger = console,
  now = () => new Date(),
  loadMonitors = loadEnabledZalandoMonitors,
  outputPath = path.join(
    process.cwd(),
    "public",
    "deals",
    "zalando-latest.json"
  )
}: ScanOptions = {}): Promise<ScanResult> {
  const monitors = await loadMonitors();

  if (monitors.length === 0) {
    logger.log("No enabled Zalando monitor; skipping scan.");
    return { skipped: true };
  }

  if (!apiKey) {
    throw new Error("Missing SCRAPINGANT_API_KEY environment variable");
  }

  const plans = monitors
    .map(buildZalandoScanPlan)
    .sort((left, right) => left.monitorId.localeCompare(right.monitorId));
  const startUrls = plans.flatMap((plan) => plan.listingUrls);
  const checkedAt = now().toISOString();
  const productMap = new Map<string, ZalandoProduct>();
  const productObservations = new Map<string, ProductObservation[]>();
  const matchingProductUrls = new Set<string>();
  const conflictingProductUrls = new Set<string>();
  const pageResults: ZalandoPageResult[] = [];
  const monitorSummaries: ZalandoMonitorSummary[] = [];

  logger.log("Fetching Zalando listing pages...");

  let requestIndex = 0;
  for (const plan of plans) {
    const monitorProductUrls = new Set<string>();

    for (const url of plan.listingUrls) {
      requestIndex++;
      logger.log(
        `[${requestIndex}/${startUrls.length}] ${plan.monitorId} ${url}`
      );

      let html: string | undefined;
      try {
        html = await getRenderedHtml(url, fetchImpl, apiKey);
      } catch (error) {
        if (!isRetailerRequestFailure(error)) throw error;
        const errorDiagnostic = safeErrorSummary(error);

        logger.error(
          `Failed monitor ${plan.monitorId} listing ${url}:`,
          errorDiagnostic
        );
        pageResults.push({
          monitor_id: plan.monitorId,
          url,
          product_count: 0,
          error: errorDiagnostic
        });
      }

      if (html !== undefined) {
        const products = extractProductsFromListing(
          html,
          url,
          checkedAt,
          {
            monitorId: plan.monitorId,
            targetSize: plan.targetSize,
            upperMaterials: plan.upperMaterials
          }
        );

        logger.log(`Found ${products.length} product links on listing page`);

        pageResults.push({
          monitor_id: plan.monitorId,
          url,
          product_count: products.length,
          error: null
        });

        for (const product of products) {
          monitorProductUrls.add(product.url);
          const observations = productObservations.get(product.url) ?? [];
          observations.push({
            monitorId: plan.monitorId,
            targetSize: plan.targetSize,
            pageUrl: url
          });
          productObservations.set(product.url, observations);

          const existing = productMap.get(product.url);
          if (existing && existing.target_size !== product.target_size) {
            conflictingProductUrls.add(product.url);
            continue;
          }

          const monitorIds = [
            ...(existing?.monitor_ids ?? []),
            ...product.monitor_ids
          ].sort();
          const preferred = !existing || scoreProduct(product) > scoreProduct(existing)
            ? product
            : existing;
          productMap.set(product.url, {
            ...preferred,
            monitor_ids: [...new Set(monitorIds)]
          });

          if (
            typeof product.discount_percent === "number" &&
            product.discount_percent >= plan.minDiscountPercent
          ) {
            matchingProductUrls.add(product.url);
          }
        }
      }

      if (requestIndex < startUrls.length) await sleepImpl(1000);
    }

    monitorSummaries.push({
      id: plan.monitorId,
      // A plan has 1 to 10 pages, so the first URL is always set; `?? ""`
      // only narrows (validateZalandoOutput rejects both "" and undefined).
      listing_url: plan.listingUrls[0] ?? "",
      target_size: plan.targetSize,
      min_discount_percent: plan.minDiscountPercent,
      pages: plan.pages,
      product_count: monitorProductUrls.size,
      status: "success"
    });
  }

  const products = [...productMap.values()].sort((a, b) => {
    const discountA = typeof a.discount_percent === "number" ? a.discount_percent : -1;
    const discountB = typeof b.discount_percent === "number" ? b.discount_percent : -1;

    if (discountB !== discountA) return discountB - discountA;
    return a.title.localeCompare(b.title);
  });

  const matches = products.filter((product) => matchingProductUrls.has(product.url));

  const scanStatus = createScanStatus({
    pageResults,
    scannedProductCount: products.length,
    publishedProductCount: matches.length
  });

  if (scanStatus.successful_pages === 0) {
    throw new Error("Zalando scan produced no successful listing pages");
  }

  const emptyMonitor = monitorSummaries.find((monitor) => monitor.product_count === 0);
  if (emptyMonitor) {
    throw new Error(`Zalando monitor ${emptyMonitor.id} produced no products`);
  }

  if (conflictingProductUrls.size > 0) {
    throw createConflictingTargetSizeError(
      conflictingProductUrls,
      productObservations
    );
  }

  const output: ZalandoSnapshot = {
    site: SITE,
    scan_mode: "zalando-listing-page-only",
    start_urls: startUrls,
    monitors: monitorSummaries,
    ...(plans.length === 1 ? {
      // plans[0] exists when the length is 1; `?.` only narrows.
      target_size: plans[0]?.targetSize,
      min_discount_percent: plans[0]?.minDiscountPercent
    } : {}),
    checked_at: checkedAt,
    scanned_page_count: startUrls.length,
    scanned_product_count: products.length,
    product_count: products.length,
    products,
    match_count: matches.length,
    matches,
    scan_status: scanStatus,
    debug: {
      pages: pageResults,
      products_with_discount: products.filter(
        (product) => typeof product.discount_percent === "number"
      ).length,
      products_below_minimum_discount: products.filter(
        (product) => typeof product.discount_percent === "number" &&
          !matchingProductUrls.has(product.url)
      ).length,
      products_without_discount: products.filter(
        (product) => product.discount_percent === null
      ).length,
      products_without_price: products.filter(
        (product) => product.current_price === null
      ).length
    }
  };

  await publishOutput(outputPath, output, fsImpl);

  logger.log(`Wrote ${outputPath}`);
  logger.log(`All products: ${products.length}`);
  logger.log(`Matches: ${matches.length}`);
  return { skipped: false };
}

const entryPointUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;

if (import.meta.url === entryPointUrl) {
  scan().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
