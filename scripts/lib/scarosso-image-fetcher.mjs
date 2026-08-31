import {
  extractProductPageImage,
  normalizeScarossoProductUrl
} from "./scarosso-image.mjs";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 4;

function directProductUrl(value) {
  return normalizeScarossoProductUrl(value);
}

async function fetchOneProductImage(url, fetchImpl, timeoutMs) {
  try {
    const response = await fetchImpl(url, {
      headers: {
        "user-agent": "scarosso-deal-watch/2.0"
      },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
      return null;
    }

    return extractProductPageImage(await response.text(), url);
  } catch {
    return null;
  }
}

export async function fetchProductPageImages(
  productUrls,
  {
    fetchImpl,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    concurrency = DEFAULT_CONCURRENCY
  }
) {
  const uniqueUrls = [
    ...new Set(productUrls.map(directProductUrl).filter(Boolean))
  ];
  const results = new Map();
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < uniqueUrls.length) {
      const url = uniqueUrls[nextIndex];
      nextIndex += 1;

      results.set(
        url,
        await fetchOneProductImage(url, fetchImpl, timeoutMs)
      );
    }
  }

  const workerCount = Math.min(
    Math.max(1, concurrency),
    uniqueUrls.length
  );

  await Promise.all(
    Array.from({ length: workerCount }, () => worker())
  );

  return results;
}
