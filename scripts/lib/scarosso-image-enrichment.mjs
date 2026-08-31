import { fetchProductPageImages } from "./scarosso-image-fetcher.mjs";
import { normalizeProductUrl } from "./scarosso-image.mjs";
import { reusePreviousImages } from "./scarosso-image-snapshot.mjs";

export async function enrichMissingProductImages(
  products,
  previousImages,
  fetchImpl
) {
  const reused = reusePreviousImages(products, previousImages);
  const missingUrls = reused.products
    .filter((product) => !product.image)
    .map((product) => product.url);
  const fetchedImages = await fetchProductPageImages(missingUrls, {
    fetchImpl
  });
  let fetchedImageCount = 0;

  const enrichedProducts = reused.products.map((product) => {
    if (product.image) {
      return product;
    }

    const image = fetchedImages.get(normalizeProductUrl(product.url));

    if (!image) {
      return product;
    }

    fetchedImageCount += 1;
    return { ...product, image };
  });

  return {
    products: enrichedProducts,
    reusedCount: reused.reusedCount,
    fetchedPageCount: fetchedImages.size,
    fetchedImageCount,
    missingCount: enrichedProducts.filter((product) => !product.image).length
  };
}
