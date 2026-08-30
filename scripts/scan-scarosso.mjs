import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import {
  extractPricesAndDiscountFromText
} from "./lib/scarosso-price.mjs";
import { mergeProduct } from "./lib/scarosso-product.mjs";
import {
  createScanStatus,
  safeErrorSummary
} from "./lib/scan-status.mjs";

export { createScanStatus, safeErrorSummary };

const API_KEY = process.env.SCRAPINGANT_API_KEY;

const BASE_URL = "https://www.scarosso.com";

const START_URLS = [
  "https://www.scarosso.com/en-us/sales/men/?prefn1=c_size&prefv1=42",
  "https://www.scarosso.com/en-us/sales/men/sneakers/?prefn1=c_size&prefv1=42",
  "https://www.scarosso.com/en-us/sales/men/loafers/?prefn1=c_size&prefv1=42",
  "https://www.scarosso.com/en-us/sales/men/flats/?prefn1=c_size&prefv1=42",
  "https://www.scarosso.com/en-us/sales/men/boots/?prefn1=c_size&prefv1=42",
  "https://www.scarosso.com/en-us/sales/men/last-pairs/?prefn1=c_size&prefv1=42"
];

const TARGET_SIZE = "42";
const MIN_DISCOUNT_PERCENT = 30;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getRenderedHtml(url) {
  const endpoint = new URL("https://api.scrapingant.com/v2/general");

  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("x-api-key", API_KEY);
  endpoint.searchParams.set("browser", "true");

  const res = await fetch(endpoint.toString(), {
    headers: {
      "user-agent": "scarosso-deal-watch/2.0"
    }
  });

  if (!res.ok) {
    throw new Error(
      "ScrapingAnt request failed with HTTP " + res.status
    );
  }

  return await res.text();
}

function absoluteUrl(value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeProductUrl(href) {
  const url = absoluteUrl(href);

  if (!url) {
    return null;
  }

  const parsed = new URL(url);

  parsed.search = "";
  parsed.hash = "";

  return parsed.toString();
}

function isProductUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);

    return (
      parsed.hostname.endsWith("scarosso.com") &&
      parsed.pathname.includes("/en-us/") &&
      parsed.pathname.endsWith(".html")
    );
  } catch {
    return false;
  }
}

function extractCategoryFromStartUrl(url) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const menIndex = parts.indexOf("men");

  if (menIndex === -1) {
    return null;
  }

  return parts[menIndex + 1] || "men";
}

function extractSizesFromText(text) {
  const sizes = new Set();

  const matches = text.matchAll(
    /(?<![\d.,])(3[5-9]|4[0-9]|5[0-2])(?:[.,]5)?(?![\d.,])/g
  );

  for (const match of matches) {
    sizes.add(match[0].replace(",", "."));
  }

  return [...sizes].sort((a, b) => Number(a) - Number(b));
}

function findProductContainer($, anchor) {
  const selectors = [
    "[data-product-id]",
    "[data-product]",
    ".product-item",
    ".product-card",
    ".product-tile",
    ".product",
    "article",
    "li"
  ];

  for (const selector of selectors) {
    const container = $(anchor).closest(selector);

    if (!container.length) {
      continue;
    }

    const containerText = normalizeText(container.text());

    if (containerText) {
      return container.first();
    }
  }

  return $(anchor).parent();
}

function extractProductTitle($, anchor, container) {
  const candidates = [
    $(anchor).attr("aria-label"),
    $(anchor).attr("title"),
    container.find("[data-product-name]").first().attr("data-product-name"),
    container.find(".product-name").first().text(),
    container.find(".product-title").first().text(),
    container.find("h2, h3, h4").first().text(),
    container.find("img[alt]").first().attr("alt"),
    $(anchor).text()
  ];

  for (const candidate of candidates) {
    const title = normalizeText(candidate);

    if (title) {
      return title;
    }
  }

  return "Unknown product";
}

function usableImageUrl(value) {
  const url = absoluteUrl(value);

  if (!url) {
    return null;
  }

  const { protocol } = new URL(url);

  return protocol === "http:" || protocol === "https:" ? url : null;
}

function imageUrlsFromSrcset(srcset) {
  if (!srcset || /(?:^|,)\s*data:/i.test(srcset)) {
    return [];
  }

  return srcset
    .split(",")
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter(Boolean)
    .map(usableImageUrl)
    .filter(Boolean)
    .reverse();
}

function extractImageUrl(image) {
  const lazySources = [
    image.attr("data-src"),
    image.attr("data-original"),
    image.attr("data-lazy-src")
  ];

  for (const source of lazySources) {
    const imageUrl = usableImageUrl(source);

    if (imageUrl) {
      return imageUrl;
    }
  }

  const srcsetCandidates = [
    ...imageUrlsFromSrcset(image.attr("data-srcset")),
    ...imageUrlsFromSrcset(image.attr("srcset"))
  ];

  if (srcsetCandidates.length) {
    return srcsetCandidates[0];
  }

  return usableImageUrl(image.attr("src"));
}

function extractFirstUsableImage($, images) {
  for (const imageElement of images.toArray()) {
    const imageUrl = extractImageUrl($(imageElement));

    if (imageUrl) {
      return imageUrl;
    }
  }

  return null;
}

function extractProductImage($, anchor, container, productUrl) {
  const directImage = extractFirstUsableImage(
    $,
    $(anchor).find("img")
  );

  if (directImage) {
    return directImage;
  }

  const matchingAnchorImages = container
    .find("a[href]")
    .filter((_, candidate) => {
      return normalizeProductUrl($(candidate).attr("href")) === productUrl;
    })
    .find("img");
  const matchingAnchorImage = extractFirstUsableImage(
    $,
    matchingAnchorImages
  );

  if (matchingAnchorImage) {
    return matchingAnchorImage;
  }

  const containerProductUrls = new Set();

  container.find("a[href]").each((_, candidate) => {
    const candidateUrl = normalizeProductUrl($(candidate).attr("href"));

    if (isProductUrl(candidateUrl)) {
      containerProductUrls.add(candidateUrl);
    }
  });

  if (
    containerProductUrls.size !== 1 ||
    !containerProductUrls.has(productUrl)
  ) {
    return null;
  }

  const unanchoredImages = container.find("img").filter((_, image) => {
    return $(image).closest("a[href]").length === 0;
  });

  if (unanchoredImages.length !== 1) {
    return null;
  }

  return extractFirstUsableImage($, unanchoredImages);
}

export function extractProductsFromListing(html, sourceUrl, checkedAt) {
  const $ = cheerio.load(html);
  const products = new Map();
  const category = extractCategoryFromStartUrl(sourceUrl);

  $("a[href]").each((_, anchor) => {
    const href = $(anchor).attr("href");
    const productUrl = normalizeProductUrl(href);

    if (!isProductUrl(productUrl)) {
      return;
    }

    const container = findProductContainer($, anchor);
    const text = normalizeText(container.text());

    const priceInfo = extractPricesAndDiscountFromText(text);
    const availableSizes = extractSizesFromText(text);

    const product = {
      title: extractProductTitle($, anchor, container),
      url: productUrl,
      image: extractProductImage($, anchor, container, productUrl),
      category,
      source_url: sourceUrl,
      available_sizes: availableSizes,
      size_42_available:
        availableSizes.length > 0
          ? availableSizes.includes(TARGET_SIZE)
          : null,
      ...priceInfo,
      checked_at: checkedAt
    };

    const existing = products.get(productUrl);

    products.set(
      productUrl,
      existing ? mergeProduct(existing, product) : product
    );
  });

  return [...products.values()];
}

async function scan() {
  if (!API_KEY) {
    throw new Error("Missing SCRAPINGANT_API_KEY environment variable");
  }

  const checkedAt = new Date().toISOString();
  const productMap = new Map();
  const pageResults = [];

  console.log("Fetching listing pages...");

  for (let i = 0; i < START_URLS.length; i++) {
    const url = START_URLS[i];

    console.log(`[${i + 1}/${START_URLS.length}] ${url}`);

    try {
      const html = await getRenderedHtml(url);

      const products = extractProductsFromListing(
        html,
        url,
        checkedAt
      );

      console.log(
        `Found ${products.length} products on listing page`
      );

      pageResults.push({
        url,
        product_count: products.length,
        error: null
      });

      for (const product of products) {
        const existing = productMap.get(product.url);

        productMap.set(
          product.url,
          mergeProduct(existing, product)
        );
      }
    } catch (error) {
      const errorSummary = safeErrorSummary(error);

      console.error(
        `Failed listing ${url}:`,
        errorSummary
      );

      pageResults.push({
        url,
        product_count: 0,
        error: errorSummary
      });
    }

    if (i < START_URLS.length - 1) {
      await sleep(1000);
    }
  }

  const products = [...productMap.values()].sort((a, b) => {
    const discountA =
      typeof a.discount_percent === "number"
        ? a.discount_percent
        : -1;

    const discountB =
      typeof b.discount_percent === "number"
        ? b.discount_percent
        : -1;

    if (discountB !== discountA) {
      return discountB - discountA;
    }

    return a.title.localeCompare(b.title);
  });

  console.log(`Total unique products: ${products.length}`);

  const matches = products.filter((product) => {
    return (
      typeof product.discount_percent === "number" &&
      product.discount_percent >= MIN_DISCOUNT_PERCENT
    );
  });

  const scanStatus = createScanStatus({
    pageResults,
    scannedProductCount: products.length,
    publishedProductCount: matches.length
  });

  const output = {
    site: "scarosso.com",
    scan_mode: "listing-pages-only",
    target_size: TARGET_SIZE,
    min_discount_percent: MIN_DISCOUNT_PERCENT,
    checked_at: checkedAt,
    scanned_page_count: START_URLS.length,
    scanned_product_count: products.length,

    product_count: products.length,
    products,

    match_count: matches.length,
    matches,

    scan_status: scanStatus,

    debug: {
      pages: pageResults,

      products_with_discount: products.filter(
        (product) =>
          typeof product.discount_percent === "number"
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
      ).length,

      products_without_size_information: products.filter(
        (product) => product.size_42_available === null
      ).length
    }
  };

  const outputPath = path.join(
    process.cwd(),
    "public",
    "deals",
    "scarosso-latest.json"
  );

  await fs.mkdir(path.dirname(outputPath), {
    recursive: true
  });

  await fs.writeFile(
    outputPath,
    JSON.stringify(output, null, 2)
  );

  console.log(`Wrote ${outputPath}`);
  console.log(`All products: ${products.length}`);
  console.log(
    `Products over ${MIN_DISCOUNT_PERCENT}% discount: ${matches.length}`
  );
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
