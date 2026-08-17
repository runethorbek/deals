const NORMALIZED_CURRENCIES = new Set(["USD", "EUR", "GBP"]);

const PRICE_NUMBER_SOURCE = String.raw`(?<![\d.,])(?:\d{1,3}(?:,\d{3})+\.\d{2}|\d{1,3}(?:\.\d{3})+,\d{2}|\d+(?:[.,]\d{2})?)(?![\d.,])`;
const PRICE_NUMBER_PATTERN = new RegExp(PRICE_NUMBER_SOURCE);
const PRICE_TOKEN_PATTERN = new RegExp(
  `(?:[$€£]\\s*${PRICE_NUMBER_SOURCE}|\\b(?:EUR|USD|GBP)\\s*${PRICE_NUMBER_SOURCE}|${PRICE_NUMBER_SOURCE}\\s*(?:[$€£]|EUR\\b|USD\\b|GBP\\b))`,
  "gi"
);

function currencyFromToken(token) {
  if (token.includes("$")) {
    return "USD";
  }

  if (token.includes("€")) {
    return "EUR";
  }

  if (token.includes("£")) {
    return "GBP";
  }

  return token.match(/\b(?:USD|EUR|GBP)\b/i)?.[0].toUpperCase() ?? null;
}

function currenciesFromText(text) {
  const currencies = new Set();

  for (const match of text.matchAll(/[$€£]|\b(?:USD|EUR|GBP)\b/gi)) {
    const currency = currencyFromToken(match[0]);

    if (currency) {
      currencies.add(currency);
    }
  }

  return currencies;
}

function extractPriceEntriesFromText(text) {
  const entries = [];

  for (const match of text.matchAll(PRICE_TOKEN_PATTERN)) {
    const token = match[0];
    const rawNumber = token.match(PRICE_NUMBER_PATTERN)?.[0];
    let normalizedNumber = rawNumber;

    if (rawNumber?.includes(",") && rawNumber.includes(".")) {
      normalizedNumber =
        rawNumber.lastIndexOf(",") < rawNumber.lastIndexOf(".")
          ? rawNumber.replaceAll(",", "")
          : rawNumber.replaceAll(".", "").replace(",", ".");
    } else if (rawNumber?.includes(",")) {
      normalizedNumber = rawNumber.replace(",", ".");
    }

    const value = Number.parseFloat(normalizedNumber);
    const currency = currencyFromToken(token);

    if (
      Number.isFinite(value) &&
      value > 20 &&
      value < 2000 &&
      NORMALIZED_CURRENCIES.has(currency)
    ) {
      entries.push({ value, currency });
    }
  }

  return entries;
}

function normalizePriceCandidates(priceCandidates) {
  return [...new Set(priceCandidates)]
    .filter((value) => Number.isFinite(value) && value > 20 && value < 2000)
    .sort((a, b) => b - a);
}

export function summarizePriceCandidates(
  priceCandidates,
  { currency = null, conflictingCurrencies = false } = {}
) {
  const prices = normalizePriceCandidates(priceCandidates);
  const normalizedCurrency = NORMALIZED_CURRENCIES.has(currency)
    ? currency
    : null;

  if (conflictingCurrencies) {
    return {
      original_price: null,
      current_price: null,
      currency: null,
      discount_percent: null,
      discount_status: "conflicting-currencies",
      price_candidates: prices
    };
  }

  if (prices.length === 0) {
    return {
      original_price: null,
      current_price: null,
      currency: null,
      discount_percent: null,
      discount_status: "no-price-found",
      price_candidates: []
    };
  }

  if (prices.length === 1) {
    return {
      original_price: null,
      current_price: prices[0],
      currency: normalizedCurrency,
      discount_percent: null,
      discount_status: "single-price",
      price_candidates: prices
    };
  }

  const original = Math.max(...prices);
  const current = Math.min(...prices);

  if (original <= current) {
    return {
      original_price: null,
      current_price: current,
      currency: normalizedCurrency,
      discount_percent: null,
      discount_status: "no-valid-discount",
      price_candidates: prices
    };
  }

  const discount = ((original - current) / original) * 100;

  return {
    original_price: original,
    current_price: current,
    currency: normalizedCurrency,
    discount_percent: Math.round(discount * 10) / 10,
    discount_status: "calculated",
    price_candidates: prices
  };
}

export function extractPriceCandidatesFromText(text) {
  return normalizePriceCandidates(
    extractPriceEntriesFromText(text).map(({ value }) => value)
  );
}

export function extractPricesAndDiscountFromText(text) {
  const entries = extractPriceEntriesFromText(text);
  const currencies = currenciesFromText(text);

  return summarizePriceCandidates(
    entries.map(({ value }) => value),
    {
      currency: currencies.size === 1 ? [...currencies][0] : null,
      conflictingCurrencies: currencies.size > 1
    }
  );
}

export function mergePriceInformation(existing, incoming) {
  const priceCandidates = new Set([
    ...(existing.price_candidates ?? []),
    ...(incoming.price_candidates ?? [])
  ]);
  const currencies = new Set(
    [existing.currency, incoming.currency].filter(Boolean)
  );
  const conflictingCurrencies =
    existing.discount_status === "conflicting-currencies" ||
    incoming.discount_status === "conflicting-currencies" ||
    currencies.size > 1;

  return summarizePriceCandidates([...priceCandidates], {
    currency: currencies.size === 1 ? [...currencies][0] : null,
    conflictingCurrencies
  });
}
