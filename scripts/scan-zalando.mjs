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
  loadEnabledZalandoMonitor
} from "./lib/zalando-monitor.mjs";

const API_KEY = process.env.SCRAPINGANT_API_KEY;

const SITE = "zalando.dk";
const BASE_URL = "https://www.zalando.dk";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function absoluteUrl(value) {
  if (!value) return null;

  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return null;
  }
}

function normalizeProductUrl(href) {
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

function isZalandoProductUrl(url) {
  if (!url) return false;

  try {
    const parsed = new URL(url);

    return (
      parsed.hostname === "www.zalando.dk" &&
      parsed.pathname.endsWith(".html") &&
      !parsed.pathname.includes("/herretoej-bukser/")
    );
  } catch {
    return false;
  }
}

async function getRenderedHtml(url, fetchImpl, apiKey) {
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

function extractTitle($, anchor, container) {
  const candidates = [
    $(anchor).attr("aria-label"),
    $(anchor).attr("title"),
    container.find("img[alt]").first().attr("alt"),
    container.find("h2, h3, h4").first().text(),
    $(anchor).text()
  ];

  for (const candidate of candidates) {
    const title = normalizeText(candidate);
    if (title && title.length > 2) return title;
  }

  const text = visibleText($, container);
  return text.split(" kr")[0]?.slice(0, 140) || "Unknown product";
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
  { targetSize, upperMaterials }
) {
  const $ = cheerio.load(html);
  const products = new Map();

  $("a[href]").each((_, anchor) => {
    const href = $(anchor).attr("href");
    const url = normalizeProductUrl(href);

    if (!isZalandoProductUrl(url)) return;

    const container = findProductContainer($, anchor);
    const text = visibleText($, container);
    const priceInfo = extractPriceInfo(text);

    const product = {
      title: extractTitle($, anchor, container),
      url,
      image: extractImage($, container),
      site: SITE,
      source_url: sourceUrl,
      target_size: targetSize,
      size_46_available: true,
      size_assumption: `listing-url-filtered-by-size-${targetSize}`,
      material_filter: [...upperMaterials],
      raw_card_text: text.slice(0, 500),
      ...priceInfo,
      checked_at: checkedAt
    };

    const existing = products.get(product.url);
    if (!existing || scoreProduct(product) > scoreProduct(existing)) {
      products.set(product.url, product);
    }
  });

  return [...products.values()];
}

function validateZalandoOutput(output) {
  if (
    output?.site !== SITE ||
    output.scan_mode !== "zalando-listing-page-only" ||
    !Array.isArray(output.start_urls) ||
    output.start_urls.length === 0 ||
    output.scanned_page_count !== output.start_urls.length ||
    !Array.isArray(output.products) ||
    output.product_count !== output.products.length ||
    output.scanned_product_count !== output.products.length ||
    !Array.isArray(output.matches) ||
    output.match_count !== output.matches.length ||
    Number.isNaN(Date.parse(output.checked_at))
  ) {
    throw new Error("Invalid Zalando output contract");
  }

  const productUrls = new Set();

  for (const product of output.products) {
    if (
      !isZalandoProductUrl(product?.url) ||
      product.site !== SITE ||
      product.target_size !== output.target_size ||
      product.size_46_available !== true ||
      product.checked_at !== output.checked_at ||
      productUrls.has(product.url)
    ) {
      throw new Error("Invalid Zalando output contract");
    }

    productUrls.add(product.url);
  }

  if (output.matches.some((product) => !productUrls.has(product?.url))) {
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
  loadMonitor = loadEnabledZalandoMonitor,
  outputPath = path.join(
    process.cwd(),
    "public",
    "deals",
    "zalando-latest.json"
  )
} = {}) {
  if (!apiKey) {
    throw new Error("Missing SCRAPINGANT_API_KEY environment variable");
  }

  const monitor = await loadMonitor();
  const {
    listingUrls: startUrls,
    targetSize,
    upperMaterials,
    minDiscountPercent
  } = buildZalandoScanPlan(monitor);
  const checkedAt = now().toISOString();
  const productMap = new Map();
  const pageResults = [];

  logger.log("Fetching Zalando listing pages...");

  for (let i = 0; i < startUrls.length; i++) {
    const url = startUrls[i];
    logger.log(`[${i + 1}/${startUrls.length}] ${url}`);

    try {
      const html = await getRenderedHtml(url, fetchImpl, apiKey);
      const products = extractProductsFromListing(
        html,
        url,
        checkedAt,
        { targetSize, upperMaterials }
      );

      logger.log(`Found ${products.length} product links on listing page`);

      pageResults.push({
        url,
        product_count: products.length,
        error: null
      });

      for (const product of products) {
        const existing = productMap.get(product.url);
        if (!existing || scoreProduct(product) > scoreProduct(existing)) {
          productMap.set(product.url, product);
        }
      }
    } catch (error) {
      const errorDiagnostic = safeErrorDiagnostic(error);

      logger.error(`Failed listing ${url}:`, errorDiagnostic);
      pageResults.push({
        url,
        product_count: 0,
        error: errorDiagnostic
      });
    }

    if (i < startUrls.length - 1) await sleepImpl(1000);
  }

  const products = [...productMap.values()].sort((a, b) => {
    const discountA = typeof a.discount_percent === "number" ? a.discount_percent : -1;
    const discountB = typeof b.discount_percent === "number" ? b.discount_percent : -1;

    if (discountB !== discountA) return discountB - discountA;
    return a.title.localeCompare(b.title);
  });

  const matches = products.filter((product) => {
    return (
      product.size_46_available === true &&
      typeof product.discount_percent === "number" &&
      product.discount_percent >= minDiscountPercent
    );
  });

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

  if (products.length === 0) {
    throw new Error("Zalando scan produced no products");
  }

  const output = {
    site: SITE,
    scan_mode: "zalando-listing-page-only",
    start_urls: startUrls,
    target_size: targetSize,
    min_discount_percent: minDiscountPercent,
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
        (product) =>
          typeof product.discount_percent === "number" &&
          product.discount_percent < minDiscountPercent
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
  logger.log(`Matches over ${minDiscountPercent}% discount: ${matches.length}`);
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
