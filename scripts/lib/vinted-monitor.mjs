import fs from "node:fs/promises";

const DEFAULT_CONFIG_URL = new URL(
  "../../config/monitors.json",
  import.meta.url
);
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
    typeof monitor.id === "string" &&
    monitor.id.trim().length > 0 &&
    monitor.id.length <= 100 &&
    monitor.source === "vinted" &&
    monitor.enabled === true &&
    monitor.filters !== null &&
    typeof monitor.filters === "object" &&
    isSingleVintedId(monitor.filters.catalogIds) &&
    isSingleVintedId(monitor.filters.sizeIds) &&
    Number.isSafeInteger(monitor.pages) &&
    monitor.pages >= 1 &&
    monitor.pages <= MAX_PAGES
  );
}

export async function loadEnabledVintedMonitor({
  configPath = DEFAULT_CONFIG_URL,
  readFile = fs.readFile
} = {}) {
  const contents = await readFile(configPath, "utf8");
  const monitors = JSON.parse(contents);
  const enabledVintedMonitors = Array.isArray(monitors)
    ? monitors.filter((monitor) => (
      monitor?.source === "vinted" && monitor.enabled === true
    ))
    : [];

  if (enabledVintedMonitors.length !== 1) {
    throw new Error(
      "Monitor configuration must contain exactly one enabled Vinted monitor"
    );
  }

  const monitor = enabledVintedMonitors[0];

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
