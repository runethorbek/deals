import * as cheerio from "cheerio";

export const SCAROSSO_BASE_URL = "https://www.scarosso.com";

const ALLOWED_IMAGE_HOSTS = new Set(["www.scarosso.com"]);

export function normalizeProductUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value, SCAROSSO_BASE_URL);

    url.search = "";
    url.hash = "";

    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeScarossoProductUrl(value) {
  const normalized = normalizeProductUrl(value);

  if (!normalized) {
    return null;
  }

  const url = new URL(normalized);

  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.scarosso.com" ||
    url.username ||
    url.password ||
    url.port ||
    !url.pathname.includes("/en-us/") ||
    !url.pathname.endsWith(".html")
  ) {
    return null;
  }

  return normalized;
}

export function validateScarossoImageUrl(value, baseUrl = SCAROSSO_BASE_URL) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value, baseUrl);

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !ALLOWED_IMAGE_HOSTS.has(url.hostname)
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function imageCandidates(image) {
  const candidates = [
    image.attr("data-src"),
    image.attr("data-original"),
    image.attr("data-lazy-src")
  ];

  for (const attribute of ["data-srcset", "srcset"]) {
    const srcset = image.attr(attribute);

    if (!srcset || /(?:^|,)\s*data:/i.test(srcset)) {
      continue;
    }

    candidates.push(
      ...srcset
        .split(",")
        .map((entry) => entry.trim().split(/\s+/)[0])
        .filter(Boolean)
        .reverse()
    );
  }

  candidates.push(image.attr("src"));

  return candidates;
}

function firstValidImage(images, baseUrl) {
  for (let index = 0; index < images.length; index += 1) {
    const image = images.eq(index);

    for (const candidate of imageCandidates(image)) {
      const imageUrl = validateScarossoImageUrl(candidate, baseUrl);

      if (imageUrl) {
        return imageUrl;
      }
    }
  }

  return null;
}

function jsonLdTypes(value) {
  const types = Array.isArray(value?.["@type"])
    ? value["@type"]
    : [value?.["@type"]];

  return types.filter((type) => typeof type === "string");
}

function productJsonLdObjects(value) {
  if (Array.isArray(value)) {
    return value.flatMap(productJsonLdObjects);
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const objects = jsonLdTypes(value).includes("Product") ? [value] : [];

  if (Array.isArray(value["@graph"])) {
    objects.push(...value["@graph"].flatMap(productJsonLdObjects));
  }

  return objects;
}

function jsonLdImageCandidates(image) {
  if (typeof image === "string") {
    return [image];
  }

  if (Array.isArray(image)) {
    return image.flatMap(jsonLdImageCandidates);
  }

  if (image && typeof image === "object") {
    return [image.url, image.contentUrl].filter(Boolean);
  }

  return [];
}

export function extractProductPageImage(html, productUrl) {
  if (typeof html !== "string" || !html) {
    return null;
  }

  const $ = cheerio.load(html);
  const primaryMediaSelectors = [
    "[data-product-media] [data-primary-image] img",
    "[data-product-media] img[data-primary-image]",
    ".product-media .primary img",
    ".product-media img.primary"
  ];

  for (const selector of primaryMediaSelectors) {
    const imageUrl = firstValidImage($(selector), productUrl);

    if (imageUrl) {
      return imageUrl;
    }
  }

  for (const script of $('script[type="application/ld+json"]').toArray()) {
    let value;

    try {
      value = JSON.parse($(script).text());
    } catch {
      continue;
    }

    for (const product of productJsonLdObjects(value)) {
      for (const candidate of jsonLdImageCandidates(product.image)) {
        const imageUrl = validateScarossoImageUrl(candidate, productUrl);

        if (imageUrl) {
          return imageUrl;
        }
      }
    }
  }

  return null;
}
