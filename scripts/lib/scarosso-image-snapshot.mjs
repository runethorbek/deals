import {
  normalizeProductUrl,
  validateScarossoImageUrl
} from "./scarosso-image.mjs";

function validateAbsoluteImageUrl(value) {
  try {
    new URL(value);
  } catch {
    return null;
  }

  return validateScarossoImageUrl(value);
}

export function buildPreviousImageIndex(snapshot) {
  const index = new Map();

  if (!snapshot || !Array.isArray(snapshot.products)) {
    return index;
  }

  for (const product of snapshot.products) {
    const productUrl = normalizeProductUrl(product?.url);
    const imageUrl = validateAbsoluteImageUrl(product?.image);

    if (productUrl && imageUrl) {
      index.set(productUrl, imageUrl);
    }
  }

  return index;
}

export async function loadPreviousImageIndex(snapshotPath, readFile) {
  try {
    const contents = await readFile(snapshotPath, "utf8");

    return buildPreviousImageIndex(JSON.parse(contents));
  } catch {
    return new Map();
  }
}

export function reusePreviousImages(products, previousImages) {
  let reusedCount = 0;

  const enrichedProducts = products.map((product) => {
    const currentImage = validateScarossoImageUrl(
      product.image,
      product.url
    );

    if (currentImage) {
      return currentImage === product.image
        ? product
        : { ...product, image: currentImage };
    }

    const previousImage = previousImages.get(
      normalizeProductUrl(product.url)
    );

    if (previousImage) {
      reusedCount += 1;
      return { ...product, image: previousImage };
    }

    return product.image === null
      ? product
      : { ...product, image: null };
  });

  return { products: enrichedProducts, reusedCount };
}
