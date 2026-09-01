import { loadEnabledMonitor } from "./monitor-config.mjs";

const SCAROSSO_BASE_URL = new URL("https://www.scarosso.com/en-dk/");
const SUPPORTED_TARGET_SIZE = "42";
const MAX_LISTING_URLS = 100;

function parseListingUrl(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/sales/men/") ||
    value.includes("\\")
  ) {
    return null;
  }

  let parsed;

  try {
    parsed = new URL(value, "https://monitor.invalid");
  } catch {
    return null;
  }

  const queryKeys = [...parsed.searchParams.keys()];

  if (
    parsed.origin !== "https://monitor.invalid" ||
    !parsed.pathname.startsWith("/sales/men/") ||
    !parsed.pathname.endsWith("/") ||
    parsed.hash !== "" ||
    queryKeys.length !== 2 ||
    parsed.searchParams.getAll("prefn1").length !== 1 ||
    parsed.searchParams.getAll("prefv1").length !== 1 ||
    parsed.searchParams.get("prefn1") !== "c_size" ||
    parsed.searchParams.get("prefv1") !== SUPPORTED_TARGET_SIZE
  ) {
    return null;
  }

  return parsed;
}

function createScarossoScanPlan(monitor) {
  const listingUrls = monitor?.filters?.listingUrls;
  const minDiscountPercent = monitor?.filters?.minDiscountPercent;

  if (
    monitor?.source !== "scarosso" ||
    monitor.enabled !== true ||
    !Array.isArray(listingUrls) ||
    listingUrls.length === 0 ||
    listingUrls.length > MAX_LISTING_URLS ||
    !Number.isSafeInteger(minDiscountPercent) ||
    minDiscountPercent < 0 ||
    minDiscountPercent > 100
  ) {
    throw new Error("Invalid enabled Scarosso monitor configuration");
  }

  const parsedListingUrls = listingUrls.map(parseListingUrl);

  if (parsedListingUrls.some((url) => url === null)) {
    throw new Error("Invalid enabled Scarosso monitor configuration");
  }

  const resolvedListingUrls = parsedListingUrls.map((url) => {
    const relativeUrl = `${url.pathname.slice(1)}${url.search}`;
    return new URL(relativeUrl, SCAROSSO_BASE_URL).toString();
  });

  const listingIdentities = parsedListingUrls.map((url) => (
    `${url.pathname}|${url.searchParams.get("prefn1")}|` +
    url.searchParams.get("prefv1")
  ));

  if (new Set(listingIdentities).size !== listingIdentities.length) {
    throw new Error("Invalid enabled Scarosso monitor configuration");
  }

  return {
    listingUrls: resolvedListingUrls,
    targetSize: parsedListingUrls[0].searchParams.get("prefv1"),
    minDiscountPercent
  };
}

export async function loadEnabledScarossoMonitor(options = {}) {
  const monitor = await loadEnabledMonitor("scarosso", options);

  createScarossoScanPlan(monitor);

  return monitor;
}

export function buildScarossoScanPlan(monitor) {
  return createScarossoScanPlan(monitor);
}
