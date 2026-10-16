/** One listing-page request outcome; `error` is null when the page succeeded. */
export interface PageResult {
  url: string;
  error: string | null;
}

/** A failed listing request in `scan_status.failures`. */
export interface ScanFailure {
  url: string;
  error_summary: string;
}

/** The common `scan_status` object documented in `docs/output-contract.md`. */
export interface ScanStatus {
  attempted_pages: number;
  successful_pages: number;
  failed_pages: number;
  failures: ScanFailure[];
  scanned_product_count: number;
  published_product_count: number;
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function redactAuthorizationValue(
  _: string,
  prefix: string,
  value: string
): string {
  const scheme = value.trim().match(
    /^([A-Za-z][A-Za-z0-9_-]*)\s+\S/
  )?.[1];

  return prefix + (scheme ? `${scheme} [REDACTED]` : "[REDACTED]");
}

export function safeErrorDiagnostic(error: unknown): string {
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

export function safeErrorSummary(error: unknown): string {
  return safeErrorDiagnostic(error).slice(0, 300);
}

export async function createScrapingAntHttpError(
  response: { status: number; text(): Promise<string> },
  url: string
): Promise<Error> {
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
}: {
  pageResults: PageResult[];
  scannedProductCount: number;
  publishedProductCount: number;
}): ScanStatus {
  const failures: ScanFailure[] = pageResults
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
