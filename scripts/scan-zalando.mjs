import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import fetch from "node-fetch";

const API_KEY = process.env.SCRAPINGANT_API_KEY;

if (!API_KEY) {
  throw new Error("Missing SCRAPINGANT_API_KEY environment variable");
}

const SITE = "zalando.dk";
const BASE_URL = "https://www.zalando.dk";
const TARGET_SIZE = "46";
const MIN_DISCOUNT_PERCENT = 30;

const START_URLS = [
  "https://www.zalando.dk/herretoej-bukser/__stoerrelse-46/?upper_material=pure_cashmere.pure_linen.pure_wool"
];

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

async function getRenderedHtml(url) {
  const endpoint = new URL("https://api.scrapingant.com/v2/general");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("x-api-key", API_KEY);
  endpoint.searchParams.set("browser", "true");

  const res = await fetch(endpoint.toString(), {
    headers: {
      "user-agent": "deal-watch-zalando/1.0"
    }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `ScrapingAnt failed for ${url}: ${res.status} ${text.slice(0, 300)}`
    );
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

function extractExplicitDiscount(text) {
  const matches = [
    ...text.matchAll(/(?:-|−)\s?(\d{1,2})\s?%/g),
    ...text.matchAll(/(\d{1,2})\s?%\s?(?:rabat|off)/gi)
  ];

  const discounts = matches
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value) => Number.isFinite(value) && value > 0 && value < 95);

  return discounts.length ? Math.max(...discounts) : null;
}

function extractDkkPriceCandidates(text) {
  const values = [];

  const patterns = [
    /(?:DKK|kr\.?|kr)\s?(\d{1,5}(?:[.,]\d{2})?)/gi,
    /(\d{1,5}(?:[.,]\d{2})?)\s?(?:DKK|kr\.?|kr)/gi
  ];

  for (const regex of patterns) {
    for (const match of text.matchAll(regex)) {
      const numeric = match[1].replace(".", "").replace(",", ".");
      const value = Number.parseFloat(numeric);

      if (Number.isFinite(value) && value > 20 && value < 20000) {
        values.push(value);
      }
    }
  }

  return [...new Set(values)].sort((a, b) => b - a);
}

function extractPriceInfo(text) {
  const priceCandidates = extractDkkPriceCandidates(text);
  const explicitDiscount = extractExplicitDiscount(text);

  if (priceCandidates.length >= 2) {
    const original = Math.max(...priceCandidates);
    const current = Math.min(...priceCandidates);
    const calculated = ((original - current) / original) * 100;

    return {
      original_price: original,
      current_price: current,
      discount_percent: Math.round(calculated * 10) / 10,
      discount_status: "calculated-from-prices",
      explicit_discount_percent: explicitDiscount,
      price_candidates: priceCandidates
    };
  }

  if (priceCandidates.length === 1 && explicitDiscount !== null) {
    const current = priceCandidates[0];
    const original = current / (1 - explicitDiscount / 100);

    return {
      original_price: Math.round(original * 100) / 100,
      current_price: current,
      discount_percent: explicitDiscount,
      discount_status: "explicit-discount",
      explicit_discount_percent: explicitDiscount,
      price_candidates: priceCandidates
    };
  }

  return {
    original_price: null,
    current_price: priceCandidates[0] ?? null,
    discount_percent: explicitDiscount,
    discount_status: explicitDiscount !== null ? "explicit-discount-no-price" : "no-discount-found",
    explicit_discount_percent: explicitDiscount,
    price_candidates: priceCandidates
  };
}

function scoreProduct(product) {
  let score = 0;
  if (product.title && product.title !== "Unknown product") score += 2;
  if (product.image) score += 2;
  score += product.price_candidates.length * 10;
  if (typeof product.discount_percent === "number") score += 20;
  return score;
}

function extractProductsFromListing(html, sourceUrl, checkedAt) {
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
      target_size: TARGET_SIZE,
      size_46_available: true,
      size_assumption: "listing-url-filtered-by-size-46",
      material_filter: ["pure_cashmere", "pure_linen", "pure_wool"],
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

async function scan() {
  const checkedAt = new Date().toISOString();
  const productMap = new Map();
  const pageResults = [];

  console.log("Fetching Zalando listing pages...");

  for (let i = 0; i < START_URLS.length; i++) {
    const url = START_URLS[i];
    console.log(`[${i + 1}/${START_URLS.length}] ${url}`);

    try {
      const html = await getRenderedHtml(url);
      const products = extractProductsFromListing(html, url, checkedAt);

      console.log(`Found ${products.length} product links on listing page`);

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
      console.error(`Failed listing ${url}:`, error.message);
      pageResults.push({
        url,
        product_count: 0,
        error: error.message
      });
    }

    if (i < START_URLS.length - 1) await sleep(1000);
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
      product.discount_percent >= MIN_DISCOUNT_PERCENT
    );
  });

  const output = {
    site: SITE,
    scan_mode: "zalando-listing-page-only",
    start_urls: START_URLS,
    target_size: TARGET_SIZE,
    min_discount_percent: MIN_DISCOUNT_PERCENT,
    checked_at: checkedAt,
    scanned_page_count: START_URLS.length,
    scanned_product_count: products.length,
    product_count: products.length,
    products,
    match_count: matches.length,
    matches,
    debug: {
      pages: pageResults,
      products_with_discount: products.filter(
        (product) => typeof product.discount_percent === "number"
      ).length,
      products_below_minimum_discount: products.filter(
        (product) =>
          typeof product.discount_percent === "number" &&
          product.discount_percent < MIN_DISCOUNT_PERCENT
      ).length,
      products_without_discount: products.filter(
        (product) => product.discount_percent === null
      ).length,
      products_without_price: products.filter(
        (product) => product.current_price === null
      ).length
    }
  };

  const outputPath = path.join(
    process.cwd(),
    "public",
    "deals",
    "zalando-latest.json"
  );

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2));

  console.log(`Wrote ${outputPath}`);
  console.log(`All products: ${products.length}`);
  console.log(`Matches over ${MIN_DISCOUNT_PERCENT}% discount: ${matches.length}`);
}

scan().catch((error) => {
  console.error(error);
  process.exit(1);
});
