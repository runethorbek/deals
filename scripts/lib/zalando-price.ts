/** Price fields `extractPriceInfo` adds to a Zalando product; see `docs/output-contract.md`. */
export interface ZalandoPriceInfo {
  original_price: number | null;
  current_price: number | null;
  discount_percent: number | null;
  discount_status:
    | "explicit-discount"
    | "explicit-discount-no-price"
    | "calculated-from-prices"
    | "no-discount-found";
  explicit_discount_percent: number | null;
  price_candidates: number[];
  currency: "DKK" | null;
}

interface DkkPriceMatch {
  value: number;
  index: number;
}

const DKK_NUMBER = String.raw`(?:\d{1,3}(?:[.\s]\d{3})+|\d{1,5})(?:,\d{2})?`;

function parseDkkNumber(value: string): number | null {
  const numeric = value.replace(/[.\s]/g, "").replace(",", ".");
  const parsed = Number.parseFloat(numeric);
  return Number.isFinite(parsed) && parsed > 20 && parsed < 20000 ? parsed : null;
}

function findDkkPrices(text: string): DkkPriceMatch[] {
  const matches: DkkPriceMatch[] = [];
  const patterns = [
    new RegExp(`(?:DKK|kr\\.?)\\s*(${DKK_NUMBER})(?![\\d.,])`, "gi"),
    new RegExp(`(?<![\\d.,])(${DKK_NUMBER})\\s*(?:DKK|kr\\.?)`, "gi")
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      // Group 1 is not optional, so it is always set when the pattern matches.
      const amount = match[1];
      if (amount === undefined) continue;
      const value = parseDkkNumber(amount);
      if (value !== null) matches.push({ value, index: match.index });
    }
  }

  return matches
    .sort((a, b) => a.index - b.index)
    .filter((match, index, all) => {
      // Only the first element has no previous one.
      const previous = all[index - 1];
      return previous === undefined || match.index !== previous.index || match.value !== previous.value;
    });
}

function labelBefore(text: string, match: DkkPriceMatch): string {
  return text.slice(Math.max(0, match.index - 40), match.index);
}

export function extractDkkPriceCandidates(text: string): number[] {
  const values = findDkkPrices(text).map(({ value }) => value);
  return [...new Set(values)].sort((a, b) => b - a);
}

export function extractExplicitDiscount(text: string): number | null {
  const matches = [
    ...text.matchAll(/(?:-|−)\s?(\d{1,2})\s?%/g),
    ...text.matchAll(/(\d{1,2})\s?%\s?(?:rabat|off)/gi)
  ];
  const discounts = matches
    // Group 1 is always set; parseInt("") is NaN, which the filter drops.
    .map((match) => Number.parseInt(match[1] ?? "", 10))
    .filter((value) => Number.isFinite(value) && value > 0 && value < 95);
  return discounts.length ? Math.max(...discounts) : null;
}

export function extractPriceInfo(text: string): ZalandoPriceInfo {
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
  // Elements are objects, so this is undefined exactly when saleMatches is empty.
  const firstSale = saleMatches[0];

  if (originalMatch && firstSale) {
    const current = firstSale.value;
    if (originalMatch.value > current) {
      return priceResult(originalMatch.value, current, explicitDiscount, priceCandidates);
    }

    return currentPriceOnlyResult(current, priceCandidates);
  }

  const comparablePrices = saleMatches.map(({ value }) => value);
  // Elements are numbers, so this is undefined exactly when comparablePrices is empty.
  const firstPrice = comparablePrices[0];
  if (lastLowestIndexes.size && firstPrice !== undefined) {
    return currentPriceOnlyResult(firstPrice, priceCandidates);
  }

  if (comparablePrices.length >= 2) {
    return priceResult(
      Math.max(...comparablePrices),
      Math.min(...comparablePrices),
      explicitDiscount,
      priceCandidates
    );
  }

  // With length 1, firstPrice is always defined; the check narrows its type.
  if (comparablePrices.length === 1 && firstPrice !== undefined && explicitDiscount !== null) {
    const current = firstPrice;
    return {
      original_price: Math.round((current / (1 - explicitDiscount / 100)) * 100) / 100,
      current_price: current,
      discount_percent: explicitDiscount,
      discount_status: "explicit-discount",
      explicit_discount_percent: explicitDiscount,
      price_candidates: priceCandidates,
      currency: "DKK"
    };
  }

  return {
    original_price: null,
    current_price: firstPrice ?? null,
    discount_percent: explicitDiscount,
    discount_status: explicitDiscount !== null ? "explicit-discount-no-price" : "no-discount-found",
    explicit_discount_percent: explicitDiscount,
    price_candidates: priceCandidates,
    currency: comparablePrices.length ? "DKK" : null
  };
}

function priceResult(
  original: number,
  current: number,
  explicitDiscount: number | null,
  priceCandidates: number[]
): ZalandoPriceInfo {
  const calculated = ((original - current) / original) * 100;
  return {
    original_price: original,
    current_price: current,
    discount_percent: Math.round(calculated * 10) / 10,
    discount_status: "calculated-from-prices",
    explicit_discount_percent: explicitDiscount,
    price_candidates: priceCandidates,
    currency: "DKK"
  };
}

function currentPriceOnlyResult(current: number, priceCandidates: number[]): ZalandoPriceInfo {
  return {
    original_price: null,
    current_price: current,
    discount_percent: null,
    discount_status: "no-discount-found",
    explicit_discount_percent: null,
    price_candidates: priceCandidates,
    currency: "DKK"
  };
}
