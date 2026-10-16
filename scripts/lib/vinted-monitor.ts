import type {
  MonitorConfigurationOptions,
  MonitorEnvelope
} from "./monitor-config.ts";

const MAX_PAGES = 100;

export interface VintedMonitor extends MonitorEnvelope {
  source: "vinted";
  filters: {
    catalogIds: [string];
    sizeIds: [string];
  };
  pages: number;
}

function isSingleVintedId(values: unknown): values is [string] {
  return (
    Array.isArray(values) &&
    values.length === 1 &&
    typeof values[0] === "string" &&
    /^\d+$/.test(values[0])
  );
}

export function validateVintedMonitor(
  monitor: MonitorEnvelope
): asserts monitor is VintedMonitor {
  if (
    monitor?.source !== "vinted" ||
    !isSingleVintedId(monitor.filters?.catalogIds) ||
    !isSingleVintedId(monitor.filters?.sizeIds) ||
    // The typeof checks only narrow for the comparisons below:
    // Number.isSafeInteger already rejects every non-number.
    typeof monitor.pages !== "number" ||
    !Number.isSafeInteger(monitor.pages) ||
    monitor.pages < 1 ||
    monitor.pages > MAX_PAGES
  ) {
    throw new Error("Invalid Vinted monitor configuration");
  }
}

function isValidVintedMonitor(
  monitor: MonitorEnvelope
): monitor is VintedMonitor {
  try {
    validateVintedMonitor(monitor);
    return true;
  } catch {
    return false;
  }
}

export async function loadEnabledVintedMonitor(
  options: MonitorConfigurationOptions = {}
): Promise<VintedMonitor | null> {
  const { loadValidatedEnabledMonitor } = await import(
    "./validated-monitor-loader.ts"
  );
  const monitor = await loadValidatedEnabledMonitor("vinted", options);

  if (monitor === null) return null;

  if (!isValidVintedMonitor(monitor)) {
    throw new Error("Invalid enabled Vinted monitor configuration");
  }

  return monitor;
}

export async function loadEnabledVintedMonitors(
  options: MonitorConfigurationOptions = {}
): Promise<VintedMonitor[]> {
  const { loadValidatedEnabledMonitors } = await import(
    "./validated-monitor-loader.ts"
  );
  const monitors = await loadValidatedEnabledMonitors("vinted", options);

  if (!monitors.every(isValidVintedMonitor)) {
    throw new Error("Invalid enabled Vinted monitor configuration");
  }

  return monitors;
}

export function buildVintedListingUrls(monitor: VintedMonitor): string[] {
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
