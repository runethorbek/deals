import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import fetch from "node-fetch";

const API_KEY = process.env.SCRAPINGANT_API_KEY;

if (!API_KEY) {
  throw new Error("Missing SCRAPINGANT_API_KEY environment variable");
}

const BASE_URL = "https://www.vinted.com";

const START_URLS = [
  "https://www.vinted.com/catalog?catalog[]=1786&size_ids[]=207&page=1",
  "https://www.vinted.com/catalog?catalog[]=1786&size_ids[]=207&page=2",
  "https://www.vinted.com/catalog?catalog[]=1786&size_ids[]=207&page=3"
];

const TARGET_SIZE_ID = "207";
const TARGET_CATALOG_ID = "1786";

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

async function getRenderedHtml(url) {
  const endpoint = new URL("https://api.scrapingant.com/v2/general");

  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("x-api-key", API_KEY);
  endpoint.searchParams.set("browser", "true");

  const res = await fetch(endpoint.toString(), {
    headers: {
      "user-agent": "vinted-deal-watch/1.0"
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

function isVintedItemUrl(url) {
  if (!url) return false;

  try {
    const parsed = new URL(url);

    return (
      parsed.hostname.endsWith("vinted.com") &&
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

function extractProductsFromListing(html, sourceUrl, checkedAt) {
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
      catalog_id: TARGET_CATALOG_ID,
      target_size_id: TARGET_SIZE_ID,
      size_assumption: "listing-url-filtered-by-size-id-207",
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

async function scan() {
  const checkedAt = new Date().toISOString();
  const productMap = new Map();
  const pageResults = [];

  console.log("Fetching Vinted listing pages...");

  for (let i = 0; i < START_URLS.length; i++) {
    const url = START_URLS[i];

    console.log(`[${i + 1}/${START_URLS.length}] ${url}`);

    try {
      const html = await getRenderedHtml(url);
      const products = extractProductsFromListing(html, url, checkedAt);
      const jsonLd = extractMetadataFromJsonLd(html);

      console.log(`Found ${products.length} products on listing page`);

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
      console.error(`Failed listing ${url}:`, error.message);

      pageResults.push({
        url,
        product_count: 0,
        json_ld_blocks: 0,
        error: error.message
      });
    }

    if (i < START_URLS.length - 1) {
      await sleep(1500);
    }
  }

  const products = [...productMap.values()].sort((a, b) => {
    if (a.price !== null && b.price !== null && a.price !== b.price) {
      return a.price - b.price;
    }

    return a.title.localeCompare(b.title);
  });

  const output = {
    site: "vinted.com",
    scan_mode: "vinted-listing-pages-only",
    start_urls: START_URLS,
    catalog_id: TARGET_CATALOG_ID,
    target_size_id: TARGET_SIZE_ID,
    checked_at: checkedAt,

    scanned_page_count: START_URLS.length,
    scanned_product_count: products.length,

    product_count: products.length,
    products,

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

  const outputPath = path.join(
    process.cwd(),
    "public",
    "deals",
    "vinted-latest.json"
  );

  await fs.mkdir(path.dirname(outputPath), {
    recursive: true
  });

  await fs.writeFile(
    outputPath,
    JSON.stringify(output, null, 2)
  );

  console.log(`Wrote ${outputPath}`);
  console.log(`Products: ${products.length}`);
  console.log(`Products with price: ${output.debug.products_with_price}`);
  console.log(`Products with brand: ${output.debug.products_with_brand}`);
}

scan().catch((error) => {
  console.error(error);
  process.exit(1);
});
