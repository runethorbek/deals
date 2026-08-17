function normalizeText(value) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function redactAuthorizationValue(_, prefix, value) {
  const scheme = value.trim().match(
    /^([A-Za-z][A-Za-z0-9_-]*)\s+\S/
  )?.[1];

  return prefix + (scheme ? `${scheme} [REDACTED]` : "[REDACTED]");
}

export function safeErrorDiagnostic(error) {
  const rawMessage = error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");

  const redactedMessage = rawMessage
    .replace(
      /([?&](?:x-api-key|api[_-]?key|access[_-]?token|token|key)=)[^&\s]*/gi,
      "$1[REDACTED]"
    )
    .replace(
      /(\bAuthorization\s*:\s*)([^\r\n;&]+)/gi,
      redactAuthorizationValue
    )
    .replace(
      /(\bAuthorization\s*=\s*)([^\r\n;&]+)/gi,
      redactAuthorizationValue
    )
    .replace(
      /(["']?(?:x-api-key|api[_-]?key|access[_-]?token|token|client[_-]?secret|password|authorization)["']?\s*:\s*["'])[^"']*/gi,
      "$1[REDACTED]"
    )
    .replace(
      /(\b(?:x-api-key|api[_-]?key|access[_-]?token|token|client[_-]?secret|password)\s*:\s*)[^&\s,;}\]\r\n]+/gi,
      "$1[REDACTED]"
    )
    .replace(
      /(\b(?:x-api-key|api[_-]?key|access[_-]?token|token|client[_-]?secret|password)\s*=\s*)[^&\s]*/gi,
      "$1[REDACTED]"
    )
    .replace(
      /\bBearer\s+(?!\[REDACTED\](?=\s|[;,&]|$))[^\s;,&]+/gi,
      "Bearer [REDACTED]"
    );

  const diagnostic = normalizeText(redactedMessage);

  return diagnostic || "Unknown error";
}

export function safeErrorSummary(error) {
  return safeErrorDiagnostic(error).slice(0, 300);
}

export async function createScrapingAntHttpError(response, url) {
  const responseBody = await response.text().catch(() => "");
  const bodyDiagnostic = responseBody
    ? " " + responseBody.slice(0, 300)
    : "";
  const message =
    `ScrapingAnt failed for ${url}: ${response.status}` + bodyDiagnostic;

  return new Error(safeErrorDiagnostic(message));
}

export function createScanStatus({
  pageResults,
  scannedProductCount,
  publishedProductCount
}) {
  const failures = pageResults
    .filter((page) => page.error !== null)
    .map((page) => ({
      url: page.url,
      error_summary: safeErrorSummary(page.error)
    }));

  return {
    attempted_pages: pageResults.length,
    successful_pages: pageResults.length - failures.length,
    failed_pages: failures.length,
    failures,
    scanned_product_count: scannedProductCount,
    published_product_count: publishedProductCount
  };
}
