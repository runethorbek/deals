# Architecture

## Purpose

This repository produces deal snapshots for DealRadar. It does not own the
DealRadar application, database, ingestion logic, or user-facing rendering.

## Data flow

1. A scheduled or manually dispatched GitHub Actions workflow starts a scan.
2. A source-specific Node.js scraper calls ScrapingAnt with a fixed retailer
   listing URL.
3. ScrapingAnt returns rendered retailer HTML.
4. The scraper extracts and normalizes products into a source-specific JSON
   document under `public/deals/`.
5. The workflow commits a changed document and calls the authenticated
   DealRadar import endpoint with the resulting Git revision.

## Responsibilities

- **GitHub Actions:** scheduling, secret injection, execution, committing
  validated output, and triggering import.
- **Scraper entry points:** network orchestration, timeout and retry policy,
  source parsing, and scan-level failure handling.
- **Source parsers:** retailer-specific selectors and normalization rules.
- **Shared contract validation:** common invariants such as valid URLs, counts,
  numeric ranges, uniqueness, and timestamps.
- **DealRadar:** ingestion, persistence, cross-source deduplication, and safe
  rendering of extracted text.

Retailer-specific DOM knowledge should remain in its source scraper. Generic
validation and safe publication behavior may be shared. Application and
database concerns belong in DealRadar.

## Trust boundaries

ScrapingAnt and retailer responses are external and untrusted. Extracted data
becomes publishable only after validation. The DealRadar import endpoint is a
separate authenticated service boundary.

## Output contracts

The three sources currently have related but different product shapes. Vinted
uses `price` and `currency`; Scarosso and Zalando expose original price, current
price, and discount fields. These differences must be documented and tested
before treating the formats as a single schema.

Contract changes require explicit approval and coordination with DealRadar.
Counts must match their arrays, product URLs must be unique HTTPS URLs for the
expected retailer, timestamps must be valid, and numeric values must be finite
and plausible.

## Failure semantics

The intended publication policy is fail closed:

- A required-page failure or implausible result must preserve the last known
  good JSON file.
- Output should be written to a temporary file, validated, and then replaced
  atomically.
- DealRadar import should run only after validation and a successful push.
- External requests should have bounded timeouts and limited retries.
- Errors must contain useful context without exposing credentials.

The current scrapers do not yet enforce all of these rules; they describe the
direction for future implementation.
