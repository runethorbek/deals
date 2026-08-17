import { mergePriceInformation } from "./scarosso-price.mjs";

function scoreProduct(product) {
  let score = 0;

  if (product.title && product.title !== "Unknown product") {
    score += 2;
  }

  if (product.image) {
    score += 2;
  }

  score += product.price_candidates.length * 10;
  score += product.available_sizes.length;

  return score;
}

export function mergeProduct(existing, incoming) {
  if (!existing) {
    const categories = new Set([
      ...(incoming.categories ?? []),
      incoming.category
    ]);
    const sourceUrls = new Set([
      ...(incoming.source_urls ?? []),
      incoming.source_url
    ]);
    const mergedCategories = [...categories].filter(Boolean);
    const mergedSourceUrls = [...sourceUrls].filter(Boolean);

    return {
      ...incoming,
      category:
        mergedCategories.length === 1
          ? mergedCategories[0]
          : undefined,
      source_url:
        mergedSourceUrls.length === 1
          ? mergedSourceUrls[0]
          : undefined,
      categories: mergedCategories,
      source_urls: mergedSourceUrls
    };
  }

  const categories = new Set([
    ...(existing.categories ?? []),
    existing.category,
    ...(incoming.categories ?? []),
    incoming.category
  ]);

  const sourceUrls = new Set([
    ...(existing.source_urls ?? []),
    existing.source_url,
    ...(incoming.source_urls ?? []),
    incoming.source_url
  ]);
  const mergedCategories = [...categories].filter(Boolean);
  const mergedSourceUrls = [...sourceUrls].filter(Boolean);

  const availableSizes = new Set([
    ...(existing.available_sizes ?? []),
    ...(incoming.available_sizes ?? [])
  ]);

  const mergedSizes = [...availableSizes].sort(
    (a, b) => Number(a) - Number(b)
  );

  const best =
    scoreProduct(incoming) > scoreProduct(existing)
      ? incoming
      : existing;

  const mergedPriceInfo = mergePriceInformation(existing, incoming);

  return {
    ...best,
    category:
      mergedCategories.length === 1
        ? mergedCategories[0]
        : undefined,
    source_url:
      mergedSourceUrls.length === 1
        ? mergedSourceUrls[0]
        : undefined,
    categories: mergedCategories,
    source_urls: mergedSourceUrls,
    available_sizes: mergedSizes,
    size_42_available:
      mergedSizes.length > 0
        ? mergedSizes.includes("42")
        : null,
    ...mergedPriceInfo,
    checked_at: existing.checked_at
  };
}
