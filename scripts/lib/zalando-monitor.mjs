const ZALANDO_BASE_URL = new URL("https://www.zalando.dk/");
const MAX_TARGET_SIZE_LENGTH = 20;

function resolveListingUrl(listingPath) {
  let decodedListingPath;
  try {
    decodedListingPath = decodeURI(listingPath);
  } catch {
    throw new Error("Invalid enabled Zalando monitor configuration");
  }

  if (
    typeof listingPath !== "string" ||
    listingPath !== listingPath.trim() ||
    !listingPath.startsWith("/") ||
    listingPath.startsWith("//") ||
    listingPath.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(listingPath) ||
    decodedListingPath.split("?")[0].split("/").some(
      (segment) => segment === "." || segment === ".."
    )
  ) {
    throw new Error("Invalid enabled Zalando monitor configuration");
  }

  let listingUrl;
  try {
    listingUrl = new URL(listingPath, ZALANDO_BASE_URL);
  } catch {
    throw new Error("Invalid enabled Zalando monitor configuration");
  }

  if (
    listingUrl.origin !== ZALANDO_BASE_URL.origin ||
    listingUrl.pathname === "/" ||
    listingUrl.hash ||
    [...listingUrl.searchParams.keys()].some((key) => key.toLowerCase() === "p")
  ) {
    throw new Error("Invalid enabled Zalando monitor configuration");
  }

  return listingUrl;
}

function validateZalandoConfiguration(monitor) {
  const listingPath = monitor?.filters?.listingPath;
  const targetSize = monitor?.filters?.targetSize;
  const minDiscountPercent = monitor?.filters?.minDiscountPercent;
  const pages = monitor?.pages;

  if (
    monitor?.source !== "zalando" ||
    monitor.enabled !== true ||
    typeof monitor.id !== "string" ||
    monitor.id.length === 0 ||
    typeof targetSize !== "string" ||
    targetSize !== targetSize.trim() ||
    targetSize.length === 0 ||
    targetSize.length > MAX_TARGET_SIZE_LENGTH ||
    !Number.isSafeInteger(minDiscountPercent) ||
    minDiscountPercent < 0 ||
    minDiscountPercent > 100 ||
    !Number.isSafeInteger(pages) ||
    pages < 1 ||
    pages > 10
  ) {
    throw new Error("Invalid enabled Zalando monitor configuration");
  }

  const listingUrl = resolveListingUrl(listingPath);
  return { listingUrl, targetSize, minDiscountPercent, pages };
}

function createZalandoScanPlan(monitor) {
  const { listingUrl, targetSize, minDiscountPercent, pages } =
    validateZalandoConfiguration(monitor);

  const upperMaterial = listingUrl.searchParams.get("upper_material");
  const listingUrls = Array.from({ length: pages }, (_, index) => {
    const pageUrl = new URL(listingUrl);
    const pageNumber = index + 1;
    if (pageNumber > 1) pageUrl.searchParams.set("p", String(pageNumber));
    return pageUrl.toString();
  });

  return {
    monitorId: monitor.id,
    listingUrls,
    targetSize,
    upperMaterials: upperMaterial ? upperMaterial.split(".").filter(Boolean) : [],
    minDiscountPercent,
    pages
  };
}

export function validateZalandoMonitor(monitor) {
  validateZalandoConfiguration({ ...monitor, enabled: true });
}

export async function loadEnabledZalandoMonitors(options = {}) {
  const { loadValidatedEnabledMonitors } = await import(
    "./validated-monitor-loader.mjs"
  );
  return loadValidatedEnabledMonitors("zalando", options);
}

export function buildZalandoScanPlan(monitor) {
  return createZalandoScanPlan(monitor);
}
