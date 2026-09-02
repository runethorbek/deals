const ZALANDO_BASE_URL = new URL("https://www.zalando.dk/");
const SUPPORTED_CATEGORY_SLUG = "herretoej-bukser";
const SUPPORTED_TARGET_SIZE = "46";
const SUPPORTED_UPPER_MATERIALS = new Set([
  "pure_cashmere",
  "pure_linen",
  "pure_wool"
]);

function createZalandoScanPlan(monitor) {
  const categorySlug = monitor?.filters?.categorySlug;
  const targetSize = monitor?.filters?.size;
  const upperMaterials = monitor?.filters?.upperMaterials;
  const minDiscountPercent = monitor?.filters?.minDiscountPercent;

  if (
    monitor?.source !== "zalando" ||
    monitor.enabled !== true ||
    categorySlug !== SUPPORTED_CATEGORY_SLUG ||
    targetSize !== SUPPORTED_TARGET_SIZE ||
    !Array.isArray(upperMaterials) ||
    upperMaterials.length === 0 ||
    upperMaterials.some((material) => (
      typeof material !== "string" ||
      !SUPPORTED_UPPER_MATERIALS.has(material)
    )) ||
    new Set(upperMaterials).size !== upperMaterials.length ||
    !Number.isSafeInteger(minDiscountPercent) ||
    minDiscountPercent < 0 ||
    minDiscountPercent > 100
  ) {
    throw new Error("Invalid enabled Zalando monitor configuration");
  }

  const listingUrl = new URL(
    `${categorySlug}/__stoerrelse-${targetSize}/`,
    ZALANDO_BASE_URL
  );
  listingUrl.searchParams.set("upper_material", upperMaterials.join("."));

  return {
    listingUrls: [listingUrl.toString()],
    targetSize,
    upperMaterials: [...upperMaterials],
    minDiscountPercent
  };
}

export function validateZalandoMonitor(monitor) {
  createZalandoScanPlan({ ...monitor, enabled: true });
}

export async function loadEnabledZalandoMonitor(options = {}) {
  const { loadValidatedEnabledMonitor } = await import(
    "./validated-monitor-loader.mjs"
  );
  return loadValidatedEnabledMonitor("zalando", options);
}

export function buildZalandoScanPlan(monitor) {
  return createZalandoScanPlan(monitor);
}
