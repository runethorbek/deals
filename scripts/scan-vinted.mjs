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
import {
  buildVintedListingUrls,
  loadEnabledVintedMonitor
} from "./lib/vinted-monitor.mjs";

const API_KEY = process.env.SCRAPINGANT_API_KEY;

const BASE_URL = "https://www.vinted.dk";
const MAX_REQUEST_ATTEMPTS = 3;
const SCRAPINGANT_TIMEOUT_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 65_000;
const RETRY_BASE_DELAY_MS = 500;

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

  const parsed = new URL(url);
  parsed.hash = "";

  // Keep item URL clean. Remove tracking/search params.
  parsed.search = "";

  return parsed.toString();
}

async function getRenderedHtmlOnce(
  url,
  fetchImpl,
  apiKey,
  requestTimeoutMs
) {
  const endpoint = new URL("https://api.scrapingant.com/v2/general");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("x-api-key", apiKey);
  endpoint.searchParams.set("browser", "true");
  endpoint.searchParams.set("timeout", String(SCRAPINGANT_TIMEOUT_SECONDS));

  try {
    const res = await fetchImpl(endpoint.toString(), {
      headers: {
        "user-agent": "vinted-deal-watch/1.0"
      },
      signal: controller.signal
    });

    if (!res.ok) {
      const error = await createScrapingAntHttpError(res, url);
      error.retryable = (
        res.status === 408 ||
        res.status === 423 ||
        res.status === 429 ||
        res.status >= 500
      );
      throw error;
    }

    return await res.text();
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error(
        `ScrapingAnt request timed out for ${url} after ` +
        `${requestTimeoutMs}ms`
      );
      timeoutError.retryable = true;
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getRenderedHtml(
  url,
  fetchImpl,
  apiKey,
  sleepImpl,
  requestTimeoutMs
) {
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
    try {
      return await getRenderedHtmlOnce(
        url,
        fetchImpl,
        apiKey,
        requestTimeoutMs
      );
    } catch (error) {
      const shouldRetry = (
        error?.retryable !== false &&
        attempt < MAX_REQUEST_ATTEMPTS
      );

      if (!shouldRetry) {
        throw error;
      }

      await sleepImpl(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }

  throw new Error(`ScrapingAnt failed for ${url}`);
}

function isVintedItemUrl(url) {
  if (!url) return false;

  try {
    const parsed = new URL(url);

    return (
      parsed.hostname.endsWith("vinted.dk") &&
      (
        parsed.pathname.includes("/items/") ||
        /^\/items\/\d+/.test(parsed.pathname)
      )
    );
  } catch {
    return false;
  }
}

function findProductContainer($, anchor) {
  const selectors = [
    "[data-testid*='item']",
    "[data-testid*='Item']",
    "[class*='feed-grid__item']",
    "[class*='item-box']",
    "[class*='ItemBox']",
    "article",
    "li",
    "div"
  ];

  for (const selector of selectors) {
    const container = $(anchor).closest(selector);

    if (!container.length) continue;

    const text = normalizeText(container.text());

    if (text.length > 20) {
      return container.first();
    }
  }

  return $(anchor).parent();
}

function extractImage($, container, anchor) {
  const image =
    container.find("img").first().length
      ? container.find("img").first()
      : $(anchor).find("img").first();

  if (!image.length) return null;

  const directSource =
    image.attr("src") ||
    image.attr("data-src") ||
    image.attr("data-original") ||
    image.attr("data-testid-src");

  if (directSource) return absoluteUrl(directSource);

  const srcset = image.attr("srcset") || image.attr("data-srcset");

  if (!srcset) return null;

  const best = srcset
    .split(",")
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter(Boolean)
    .at(-1);

  return absoluteUrl(best);
}

function extractTitle($, anchor, container) {
  const candidates = [
    $(anchor).attr("title"),
    $(anchor).attr("aria-label"),
    container.find("[data-testid*='title']").first().text(),
    container.find("[class*='title']").first().text(),
    container.find("h2, h3, h4").first().text(),
    container.find("img[alt]").first().attr("alt"),
    $(anchor).text(),
    container.text()
  ];

  for (const candidate of candidates) {
    const title = normalizeText(candidate);

    if (
      title &&
      title.length >= 3 &&
      title.length <= 180 &&
      !/^heart$/i.test(title)
    ) {
      return title;
    }
  }

  return "Unknown item";
}

function extractPriceFromText(text) {
  const patterns = [
    /(?:€|EUR)\s?(\d+(?:[.,]\d{1,2})?)/i,
    /(\d+(?:[.,]\d{1,2})?)\s?(?:€|EUR)/i,
    /(?:kr\.?|DKK)\s?(\d+(?:[.,]\d{1,2})?)/i,
    /(\d+(?:[.,]\d{1,2})?)\s?(?:kr\.?|DKK)/i,
    /(?:\$|USD)\s?(\d+(?:[.,]\d{1,2})?)/i,
    /(\d+(?:[.,]\d{1,2})?)\s?(?:\$|USD)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (!match) continue;

    const value = Number.parseFloat(match[1].replace(",", "."));

    if (!Number.isFinite(value)) continue;

    let currency = null;

    if (/€|EUR/i.test(match[0])) currency = "EUR";
    if (/kr|DKK/i.test(match[0])) currency = "DKK";
    if (/\$|USD/i.test(match[0])) currency = "USD";

    return {
      price: value,
      currency,
      raw_price: match[0]
    };
  }

  return {
    price: null,
    currency: null,
    raw_price: null
  };
}

function extractBrandGuess(title, rawText) {
  const text = normalizeText(rawText);

  // Vinted listing cards often start with brand/title text, but not always.
  // This is deliberately conservative and can be improved after seeing JSON output.
  const knownSeparators = [
    " - ",
    " | ",
    " · ",
    ", "
  ];

  for (const sep of knownSeparators) {
    if (title.includes(sep)) {
      const candidate = normalizeText(title.split(sep)[0]);

      if (candidate.length >= 2 && candidate.length <= 40) {
        return candidate;
      }
    }
  }

  const words = text.split(" ").filter(Boolean);

  // Avoid using a very long image alt-description as brand.
  if (words.length > 0 && words[0].length >= 2 && words[0].length <= 30) {
    const first = words[0].replace(/[^\p{L}\p{N}&'.-]/gu, "");

    if (
      first &&
      !/^(heart|liked|size|new|item|€|kr|dkk|usd)$/i.test(first)
    ) {
      return first;
    }
  }

  return null;
}

function extractSizeGuess(text) {
  const normalized = normalizeText(text);

  const patterns = [
    /\bSize\s*:\s*([A-Za-z0-9./ -]{1,20})/i,
    /\bSize\s+([A-Za-z0-9./ -]{1,20})/i,
    /\bEU\s?(\d{2})\b/i,
    /\bW\s?(\d{2})\b/i,
    /\b(\d{2})\s?\/\s?(\d{2})\b/
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return normalizeText(match[1] ?? match[0]);
  }

  return null;
}

function extractMetadataFromJsonLd(html) {
  const $ = cheerio.load(html);
  const items = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();

    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      items.push(parsed);
    } catch {
      // Ignore invalid JSON-LD.
    }
  });

  return items;
}

function extractProductsFromListing(
  html,
  sourceUrl,
  checkedAt,
  { catalogId, sizeId }
) {
  const $ = cheerio.load(html);
  const products = new Map();

  $("a[href]").each((_, anchor) => {
    const href = $(anchor).attr("href");
    const url = normalizeProductUrl(href);

    if (!isVintedItemUrl(url)) return;

    const container = findProductContainer($, anchor);
    const rawCardText = normalizeText(container.text());

    const title = extractTitle($, anchor, container);
    const priceInfo = extractPriceFromText(rawCardText);

    const product = {
      title,
      url,
      image: extractImage($, container, anchor),
      site: "vinted.com",
      source_url: sourceUrl,
      catalog_id: catalogId,
      target_size_id: sizeId,
      size_assumption: `listing-url-filtered-by-size-id-${sizeId}`,
      brand: extractBrandGuess(title, rawCardText),
      size_guess: extractSizeGuess(rawCardText),
      ...priceInfo,
      raw_card_text: rawCardText,
      checked_at: checkedAt
    };

    const existing = products.get(url);

    if (!existing || scoreProduct(product) > scoreProduct(existing)) {
      products.set(url, product);
    }
  });

  return [...products.values()];
}

function scoreProduct(product) {
  let score = 0;

  if (product.title && product.title !== "Unknown item") score += 5;
  if (product.image) score += 5;
  if (typeof product.price === "number") score += 10;
  if (product.brand) score += 3;
  if (product.size_guess) score += 2;
  if (product.raw_card_text) score += Math.min(product.raw_card_text.length / 100, 5);

  return score;
}

function mergeProduct(existing, incoming) {
  if (!existing) {
    return {
      ...incoming,
      source_urls: incoming.source_url ? [incoming.source_url] : []
    };
  }

  const sourceUrls = new Set([
    ...(existing.source_urls ?? []),
    existing.source_url,
    ...(incoming.source_urls ?? []),
    incoming.source_url
  ]);

  const best = scoreProduct(incoming) > scoreProduct(existing)
    ? incoming
    : existing;

  return {
    ...best,
    source_url: undefined,
    source_urls: [...sourceUrls].filter(Boolean),
    checked_at: incoming.checked_at
  };
}

function validateVintedOutput(output) {
  if (
    output.site !== "vinted.com" ||
    output.scan_mode !== "vinted-listing-pages-only" ||
    !Array.isArray(output.start_urls) ||
    output.start_urls.length === 0 ||
    output.scanned_page_count !== output.start_urls.length ||
    !Array.isArray(output.products) ||
    output.products.length === 0 ||
    output.scanned_product_count !== output.products.length ||
    output.product_count !== output.products.length ||
    !Number.isFinite(Date.parse(output.checked_at))
  ) {
    throw new Error("Invalid Vinted scan output");
  }

  if (
    output.scan_status.attempted_pages !== output.start_urls.length ||
    output.scan_status.failed_pages !== 0 ||
    output.scan_status.scanned_product_count !== output.products.length ||
    output.scan_status.published_product_count !== output.products.length
  ) {
    throw new Error("Inconsistent Vinted scan output status");
  }

  const productUrls = new Set();

  for (const product of output.products) {
    if (!isVintedItemUrl(product.url) || productUrls.has(product.url)) {
      throw new Error("Invalid or duplicate Vinted product URL in scan output");
    }

    productUrls.add(product.url);
  }
}

async function publishOutput(outputPath, output, fsImpl) {
  validateVintedOutput(output);

  const temporaryOutputPath = `${outputPath}.tmp`;

  await fsImpl.mkdir(path.dirname(outputPath), {
    recursive: true
  });

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
  loadMonitor = loadEnabledVintedMonitor,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  outputPath = path.join(
    process.cwd(),
    "public",
    "deals",
    "vinted-latest.json"
  )
} = {}) {
  const monitor = await loadMonitor();

  if (monitor === null) {
    logger.log("No enabled Vinted monitor; skipping scan.");
    return { skipped: true };
  }

  if (!apiKey) {
    throw new Error("Missing SCRAPINGANT_API_KEY environment variable");
  }

  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
    throw new Error("Invalid Vinted request timeout");
  }

  const startUrls = buildVintedListingUrls(monitor);
  const catalogId = monitor.filters.catalogIds[0];
  const sizeId = monitor.filters.sizeIds[0];
  const checkedAt = now().toISOString();
  const productMap = new Map();
  const pageResults = [];

  logger.log("Fetching Vinted listing pages...");

  for (let i = 0; i < startUrls.length; i++) {
    const url = startUrls[i];

    logger.log(`[${i + 1}/${startUrls.length}] ${url}`);

    try {
      const html = await getRenderedHtml(
        url,
        fetchImpl,
        apiKey,
        sleepImpl,
        requestTimeoutMs
      );
      const products = extractProductsFromListing(
        html,
        url,
        checkedAt,
        { catalogId, sizeId }
      );
      const jsonLd = extractMetadataFromJsonLd(html);

      logger.log(`Found ${products.length} products on listing page`);

      pageResults.push({
        url,
        product_count: products.length,
        json_ld_blocks: jsonLd.length,
        error: null
      });

      for (const product of products) {
        const existing = productMap.get(product.url);
        productMap.set(product.url, mergeProduct(existing, product));
      }
    } catch (error) {
      const errorDiagnostic = safeErrorDiagnostic(error);

      logger.error(`Failed listing ${url}:`, errorDiagnostic);

      pageResults.push({
        url,
        product_count: 0,
        json_ld_blocks: 0,
        error: errorDiagnostic
      });
    }

    if (i < startUrls.length - 1) {
      await sleepImpl(1500);
    }
  }

  const products = [...productMap.values()].sort((a, b) => {
    if (a.price !== null && b.price !== null && a.price !== b.price) {
      return a.price - b.price;
    }

    return a.title.localeCompare(b.title);
  });

  const scanStatus = createScanStatus({
    pageResults,
    scannedProductCount: products.length,
    publishedProductCount: products.length
  });

  if (scanStatus.failed_pages > 0) {
    throw new Error(
      `Vinted scan failed: ${scanStatus.failed_pages} of ` +
      `${scanStatus.attempted_pages} required pages failed`
    );
  }

  if (products.length === 0) {
    throw new Error("Vinted scan produced no products");
  }

  const output = {
    site: "vinted.com",
    scan_mode: "vinted-listing-pages-only",
    start_urls: startUrls,
    catalog_id: catalogId,
    target_size_id: sizeId,
    checked_at: checkedAt,

    scanned_page_count: startUrls.length,
    scanned_product_count: products.length,

    product_count: products.length,
    products,

    scan_status: scanStatus,

    debug: {
      pages: pageResults,
      products_with_price: products.filter(
        (product) => typeof product.price === "number"
      ).length,
      products_without_price: products.filter(
        (product) => product.price === null
      ).length,
      products_with_brand: products.filter(
        (product) => Boolean(product.brand)
      ).length,
      products_with_size_guess: products.filter(
        (product) => Boolean(product.size_guess)
      ).length
    }
  };

  await publishOutput(outputPath, output, fsImpl);

  logger.log(`Wrote ${outputPath}`);
  logger.log(`Products: ${products.length}`);
  logger.log(`Products with price: ${output.debug.products_with_price}`);
  logger.log(`Products with brand: ${output.debug.products_with_brand}`);
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
