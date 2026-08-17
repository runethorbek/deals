const DKK_NUMBER = String.raw`(?:\d{1,3}(?:[.\s]\d{3})+|\d{1,5})(?:,\d{2})?`;

function parseDkkNumber(value) {
  const numeric = value.replace(/[.\s]/g, "").replace(",", ".");
  const parsed = Number.parseFloat(numeric);
  return Number.isFinite(parsed) && parsed > 20 && parsed < 20000 ? parsed : null;
}

function findDkkPrices(text) {
  const matches = [];
  const patterns = [
    new RegExp(`(?:DKK|kr\\.?)\\s*(${DKK_NUMBER})(?![\\d.,])`, "gi"),
    new RegExp(`(?<![\\d.,])(${DKK_NUMBER})\\s*(?:DKK|kr\\.?)`, "gi")
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = parseDkkNumber(match[1]);
      if (value !== null) matches.push({ value, index: match.index });
    }
  }

  return matches
    .sort((a, b) => a.index - b.index)
    .filter((match, index, all) =>
      index === 0 || match.index !== all[index - 1].index || match.value !== all[index - 1].value
    );
}

function labelBefore(text, match) {
  return text.slice(Math.max(0, match.index - 40), match.index);
}

export function extractDkkPriceCandidates(text) {
  const values = findDkkPrices(text).map(({ value }) => value);
  return [...new Set(values)].sort((a, b) => b - a);
}

export function extractExplicitDiscount(text) {
  const matches = [
    ...text.matchAll(/(?:-|−)\s?(\d{1,2})\s?%/g),
    ...text.matchAll(/(\d{1,2})\s?%\s?(?:rabat|off)/gi)
  ];
  const discounts = matches
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value) => Number.isFinite(value) && value > 0 && value < 95);
  return discounts.length ? Math.max(...discounts) : null;
}

export function extractPriceInfo(text) {
  const matches = findDkkPrices(text);
  const priceCandidates = extractDkkPriceCandidates(text);
  const explicitDiscount = extractExplicitDiscount(text);
  const originalMatch = matches.find((match) =>
    /(?:Normalpris|Oprindeligt)\s*:\s*$/i.test(labelBefore(text, match))
  );
  const lastLowestIndexes = new Set(matches
    .filter((match) => /Sidste laveste pris\s*:?\s*$/i.test(labelBefore(text, match)))
    .map((match) => match.index));
  const saleMatches = matches.filter(
    (match) => match !== originalMatch && !lastLowestIndexes.has(match.index)
  );

  if (originalMatch && saleMatches.length) {
    const current = saleMatches[0].value;
    if (originalMatch.value > current) {
      return priceResult(originalMatch.value, current, explicitDiscount, priceCandidates);
    }

    return currentPriceOnlyResult(current, priceCandidates);
  }

  const comparablePrices = saleMatches.map(({ value }) => value);
  if (lastLowestIndexes.size && comparablePrices.length) {
    return currentPriceOnlyResult(comparablePrices[0], priceCandidates);
  }

  if (comparablePrices.length >= 2) {
    return priceResult(
      Math.max(...comparablePrices),
      Math.min(...comparablePrices),
      explicitDiscount,
      priceCandidates
    );
  }

  if (comparablePrices.length === 1 && explicitDiscount !== null) {
    const current = comparablePrices[0];
    return {
      original_price: Math.round((current / (1 - explicitDiscount / 100)) * 100) / 100,
      current_price: current,
      discount_percent: explicitDiscount,
      discount_status: "explicit-discount",
      explicit_discount_percent: explicitDiscount,
      price_candidates: priceCandidates
    };
  }

  return {
    original_price: null,
    current_price: comparablePrices[0] ?? null,
    discount_percent: explicitDiscount,
    discount_status: explicitDiscount !== null ? "explicit-discount-no-price" : "no-discount-found",
    explicit_discount_percent: explicitDiscount,
    price_candidates: priceCandidates
  };
}

function priceResult(original, current, explicitDiscount, priceCandidates) {
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

function currentPriceOnlyResult(current, priceCandidates) {
  return {
    original_price: null,
    current_price: current,
    discount_percent: null,
    discount_status: "no-discount-found",
    explicit_discount_percent: null,
    price_candidates: priceCandidates
  };
}
