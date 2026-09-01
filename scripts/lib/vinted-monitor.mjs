import { loadEnabledMonitor } from "./monitor-config.mjs";

const MAX_PAGES = 100;

function isSingleVintedId(values) {
  return (
    Array.isArray(values) &&
    values.length === 1 &&
    typeof values[0] === "string" &&
    /^\d+$/.test(values[0])
  );
}

function isValidVintedMonitor(monitor) {
  return (
    monitor.source === "vinted" &&
    monitor.enabled === true &&
    isSingleVintedId(monitor.filters.catalogIds) &&
    isSingleVintedId(monitor.filters.sizeIds) &&
    Number.isSafeInteger(monitor.pages) &&
    monitor.pages >= 1 &&
    monitor.pages <= MAX_PAGES
  );
}

export async function loadEnabledVintedMonitor(options = {}) {
  const monitor = await loadEnabledMonitor("vinted", options);

  if (!isValidVintedMonitor(monitor)) {
    throw new Error("Invalid enabled Vinted monitor configuration");
  }

  return monitor;
}

export function buildVintedListingUrls(monitor) {
  const catalogQuery = monitor.filters.catalogIds
    .map((id) => `catalog[]=${encodeURIComponent(id)}`)
    .join("&");
  const sizeQuery = monitor.filters.sizeIds
    .map((id) => `size_ids[]=${encodeURIComponent(id)}`)
    .join("&");

  return Array.from(
    { length: monitor.pages },
    (_, index) => (
      `https://www.vinted.dk/catalog?${catalogQuery}&${sizeQuery}` +
      `&page=${index + 1}`
    )
  );
}
