import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import {
  createScrapingAntHttpError,
  createScanStatus,
  safeErrorDiagnostic
} from "./lib/scan-status.mjs";
import { extractPriceInfo } from "./lib/zalando-price.mjs";
import {
  buildZalandoScanPlan,
  loadEnabledZalandoMonitors
} from "./lib/zalando-monitor.mjs";

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeIdentityText(value) {
  const text = normalizeText(value);
  return text.length <= MAX_IDENTITY_FIELD_LENGTH ? text : "";
}

function isBoundedOptionalString(value, maximumLength) {
  return (
    value === undefined ||
    isBoundedString(value, maximumLength)
  );
}

function isBoundedString(value, maximumLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength;
}

function buildExpectedPaginationUrls(listingUrl, pages) {
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

function boundedDiagnosticValue(value) {
  return safeErrorDiagnostic(value).slice(0, MAX_DIAGNOSTIC_VALUE_LENGTH);
}

function createConflictingTargetSizeError(
  conflictingProductUrls,
  productObservations
) {
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

function absoluteUrl(value) {
  if (!value) return null;

  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return null;
  }
}

export function normalizeProductUrl(href) {
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

export function isZalandoProductUrl(url) {
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

export async function getRenderedHtml(url, fetchImpl, apiKey) {
  const endpoint = new URL("https://api.scrapingant.com/v2/general");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("x-api-key", apiKey);
  endpoint.searchParams.set("browser", "true");

  const res = await fetchImpl(endpoint.toString(), {
    headers: {
      "user-agent": "deal-watch-zalando/1.0"
    }
  });

  if (!res.ok) {
    throw await createScrapingAntHttpError(res, url);
  }

  return await res.text();
}

function visibleText($, node) {
  const clone = $(node).clone();
  clone.find("script, style, noscript").remove();
  return normalizeText(clone.text());
}

function findProductContainer($, anchor) {
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

function extractImage($, container) {
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

function extractProductIdentity($, container) {
  const spans = container.find("h3").first().children("span");
  const brand = normalizeIdentityText(spans.eq(0).text());
  const descriptor = normalizeText(spans.eq(1).text());

  if (!brand && !descriptor) return { title: "Unknown product" };

  const identity = {};
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

function findListingProductAnchors($) {
  const productList = $("main#main-content ul[role='list']")
    .filter((_, list) => (
      $(list).children("li").find(PRODUCT_ANCHOR_SELECTOR).length > 0
    ))
    .first();

  if (!productList.length) return $([]);
  return productList.children("li").find(PRODUCT_ANCHOR_SELECTOR);
}

function productLinkMatchesTargetSize(href, targetSize) {
  if (!targetSize) return true;

  const url = absoluteUrl(href);
  if (!url) return false;
  const linkedSizes = new URL(url).searchParams.getAll("size");
  return linkedSizes.length === 0 || (
    linkedSizes.length === 1 && linkedSizes[0] === targetSize
  );
}

export function extractProductUrlOccurrences(html, targetSize) {
  const $ = cheerio.load(html);
  const productUrls = [];

  findListingProductAnchors($).each((_, anchor) => {
    const href = $(anchor).attr("href");
    if (!productLinkMatchesTargetSize(href, targetSize)) return;
    const url = normalizeProductUrl(href);
    if (isZalandoProductUrl(url)) productUrls.push(url);
  });

  return productUrls;
}

function scoreProduct(product) {
  let score = 0;
  if (product.title && product.title !== "Unknown product") score += 2;
  if (product.image) score += 2;
  score += product.price_candidates.length * 10;
  if (typeof product.discount_percent === "number") score += 20;
  return score;
}

export function extractProductsFromListing(
  html,
  sourceUrl,
  checkedAt,
  { monitorId, targetSize, upperMaterials = [] }
) {
  const $ = cheerio.load(html);
  const products = new Map();

  findListingProductAnchors($).each((_, anchor) => {
    const href = $(anchor).attr("href");
    if (!productLinkMatchesTargetSize(href, targetSize)) return;
    const url = normalizeProductUrl(href);

    if (!isZalandoProductUrl(url)) return;

    const container = findProductContainer($, anchor);
    const text = visibleText($, container);
    const priceInfo = extractPriceInfo(text);

    const product = {
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

export function validateZalandoOutput(output) {
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
      page.error !== null
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

  const monitorById = new Map();
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

  if (
    expectedPageCount !== output.start_urls.length ||
    output.debug.pages.some((page) => !monitorById.has(page.monitor_id))
  ) {
    throw new Error("Invalid Zalando output contract");
  }

  if (
    output.monitors.length === 1
      ? output.target_size !== output.monitors[0].target_size ||
        output.min_discount_percent !== output.monitors[0].min_discount_percent
      : Object.hasOwn(output, "target_size") ||
        Object.hasOwn(output, "min_discount_percent")
  ) {
    throw new Error("Invalid Zalando output contract");
  }

  const productUrls = new Set();

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
      product.monitor_ids.some((id, index, ids) => index > 0 && ids[index - 1] > id) ||
      productMonitors.some((monitor) => monitor.target_size !== product.target_size) ||
      (product.target_size === "46"
        ? product.size_46_available !== true
        : Object.hasOwn(product, "size_46_available")) ||
      product.checked_at !== output.checked_at ||
      !isBoundedString(product.title, MAX_TITLE_LENGTH) ||
      !isBoundedOptionalString(product.brand, MAX_IDENTITY_FIELD_LENGTH) ||
      !isBoundedOptionalString(product.product_name, MAX_IDENTITY_FIELD_LENGTH) ||
      !isBoundedOptionalString(product.product_type, MAX_IDENTITY_FIELD_LENGTH) ||
      !isBoundedOptionalString(product.color, MAX_IDENTITY_FIELD_LENGTH) ||
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
        product.discount_percent >= monitorById.get(id).min_discount_percent
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

async function publishOutput(outputPath, output, fsImpl) {
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
} = {}) {
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
  const productMap = new Map();
  const productObservations = new Map();
  const matchingProductUrls = new Set();
  const conflictingProductUrls = new Set();
  const pageResults = [];
  const monitorSummaries = [];

  logger.log("Fetching Zalando listing pages...");

  let requestIndex = 0;
  for (const plan of plans) {
    const monitorProductUrls = new Set();
    let monitorFailed = false;

    for (const url of plan.listingUrls) {
      requestIndex++;
      logger.log(
        `[${requestIndex}/${startUrls.length}] ${plan.monitorId} ${url}`
      );

      try {
        const html = await getRenderedHtml(url, fetchImpl, apiKey);
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
      } catch (error) {
        monitorFailed = true;
        const errorDiagnostic = safeErrorDiagnostic(error);

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

      if (requestIndex < startUrls.length) await sleepImpl(1000);
    }

    monitorSummaries.push({
      id: plan.monitorId,
      listing_url: plan.listingUrls[0],
      target_size: plan.targetSize,
      min_discount_percent: plan.minDiscountPercent,
      pages: plan.pages,
      product_count: monitorProductUrls.size,
      status: monitorFailed ? "failed" : "success"
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

  if (scanStatus.failed_pages > 0) {
    throw new Error(
      `Zalando scan failed: ${scanStatus.failed_pages} of ` +
      `${scanStatus.attempted_pages} required pages failed`
    );
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

  const output = {
    site: SITE,
    scan_mode: "zalando-listing-page-only",
    start_urls: startUrls,
    monitors: monitorSummaries,
    ...(plans.length === 1 ? {
      target_size: plans[0].targetSize,
      min_discount_percent: plans[0].minDiscountPercent
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
