import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import fetch from "node-fetch";

const API_KEY = process.env.SCRAPINGANT_API_KEY;

if (!API_KEY) {
  throw new Error("Missing SCRAPINGANT_API_KEY environment variable");
}

const BASE_URL = "https://www.scarosso.com";

const START_URLS = [
  "https://www.scarosso.com/en-us/sales/men/",
  "https://www.scarosso.com/en-us/sales/men/sneakers/",
  "https://www.scarosso.com/en-us/sales/men/loafers/",
  "https://www.scarosso.com/en-us/sales/men/flats/",
  "https://www.scarosso.com/en-us/sales/men/boots/",
  "https://www.scarosso.com/en-us/sales/men/last-pairs/"
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
      "user-agent": "scarosso-deal-watch/1.0"
    }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ScrapingAnt failed for ${url}: ${res.status} ${text.slice(0, 300)}`);
  }

  return await res.text();
}

function absoluteUrl(href) {
  return new URL(href, BASE_URL).toString();
}

function extractProductLinks(html) {
  const $ = cheerio.load(html);
  const links = new Set();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const url = absoluteUrl(href);

    if (
      url.includes("/en-us/sales/men/") &&
      url.endsWith(".html")
    ) {
      links.add(url.split("?")[0]);
    }
  });

  return [...links].sort();
}

function textFromHtml(html) {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

function extractTitle(html) {
  const $ = cheerio.load(html);

  const h1 = $("h1").first().text().replace(/\s+/g, " ").trim();
  if (h1) return h1;

  const title = $("title").first().text().replace(/\s+/g, " ").trim();
  return title || "Unknown product";
}

function extractImage(html) {
  const $ = cheerio.load(html);

  const ogImage = $('meta[property="og:image"]').attr("content");
  if (ogImage) return absoluteUrl(ogImage);

  const img = $("img[src]").first().attr("src");
  return img ? absoluteUrl(img) : null;
}

function extractAvailableSizes(html) {
  const text = textFromHtml(html);

  // Conservative first version. Scarosso usually exposes shoe sizes as plain tokens.
  const sizes = new Set();
  const matches = text.matchAll(/(?<!\d)(3[5-9]|4[0-9]|5[0-2])(?:[.,]5)?(?!\d)/g);

  for (const match of matches) {
    sizes.add(match[0].replace(",", "."));
  }

  return [...sizes].sort((a, b) => Number(a) - Number(b));
}

function extractPriceCandidates(html) {
  const text = textFromHtml(html);

  // Handles "$270", "$385.00", "270 €", "EUR 270", etc.
  const regex = /(?:[$€£]\s?\d+(?:[.,]\d{2})?|\b(?:EUR|USD|GBP)\s?\d+(?:[.,]\d{2})?|\b\d+(?:[.,]\d{2})?\s?(?:€|EUR|USD|GBP)\b)/gi;

  const values = [];
  for (const match of text.matchAll(regex)) {
    const raw = match[0];
    const numeric = raw.replace(/[^\d.,]/g, "").replace(",", ".");
    const value = Number.parseFloat(numeric);

    if (Number.isFinite(value) && value > 20 && value < 2000) {
      values.push(value);
    }
  }

  return [...new Set(values)].sort((a, b) => b - a);
}

function extractPricesAndDiscount(html) {
  const prices = extractPriceCandidates(html);

  if (prices.length < 2) {
    return {
      original_price: null,
      current_price: prices[0] ?? null,
      discount_percent: null,
      price_candidates: prices
    };
  }

  const original = prices[0];
  const current = prices[prices.length - 1];
  const discount = ((original - current) / original) * 100;

  return {
    original_price: original,
    current_price: current,
    discount_percent: Math.round(discount * 10) / 10,
    price_candidates: prices
  };
}

function extractCategoryFromUrl(url) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const index = parts.indexOf("men");
  return index >= 0 && parts[index + 1] ? parts[index + 1] : null;
}

async function scan() {
  const checkedAt = new Date().toISOString();

  console.log("Fetching category pages...");
  const productLinks = new Set();

  for (const url of START_URLS) {
    console.log(`Category: ${url}`);
    const html = await getRenderedHtml(url);
    const links = extractProductLinks(html);

    console.log(`Found ${links.length} product links`);
    links.forEach((link) => productLinks.add(link));

    await sleep(1000);
  }

  const products = [];
  const links = [...productLinks].sort();

  console.log(`Total unique product links: ${links.length}`);

  for (let i = 0; i < links.length; i++) {
    const url = links[i];
    console.log(`[${i + 1}/${links.length}] ${url}`);

    try {
      const html = await getRenderedHtml(url);

      const availableSizes = extractAvailableSizes(html);
      const priceInfo = extractPricesAndDiscount(html);
      const size42Available = availableSizes.includes(TARGET_SIZE);

      const product = {
        title: extractTitle(html),
        url,
        image: extractImage(html),
        category: extractCategoryFromUrl(url),
        available_sizes: availableSizes,
        size_42_available: size42Available,
        ...priceInfo,
        checked_at: checkedAt
      };

      products.push(product);

      await sleep(1000);
    } catch (error) {
      console.error(`Failed product ${url}:`, error.message);
    }
  }

  const matches = products.filter((product) => {
    return (
      product.size_42_available === true &&
      typeof product.discount_percent === "number" &&
      product.discount_percent >= MIN_DISCOUNT_PERCENT
    );
  });

  const output = {
    site: "scarosso.com",
    target_size: TARGET_SIZE,
    min_discount_percent: MIN_DISCOUNT_PERCENT,
    checked_at: checkedAt,
    scanned_product_count: products.length,
    match_count: matches.length,
    matches,
    debug: {
      products_without_discount: products.filter((p) => p.discount_percent === null).length
    }
  };

  const outputPath = path.join(process.cwd(), "public", "deals", "scarosso-latest.json");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2));

  console.log(`Wrote ${outputPath}`);
  console.log(`Matches: ${matches.length}`);
}

scan().catch((error) => {
  console.error(error);
  process.exit(1);
});
