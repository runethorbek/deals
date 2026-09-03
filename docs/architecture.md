# Architecture

## Purpose

This repository produces deal snapshots for DealRadar. It does not own the
DealRadar application, database, ingestion logic, or user-facing rendering.

## Data flow

1. A scheduled or manually dispatched GitHub Actions workflow starts a scan.
2. A source-specific Node.js scraper translates monitoring intent from the
   shared `config/monitors.json` into retailer listing URLs and calls
   ScrapingAnt.
3. ScrapingAnt returns rendered retailer HTML.
4. The scraper extracts and normalizes products into a source-specific JSON
   document under `public/deals/`.
5. The source workflow commits a changed document.
6. A separate daily import workflow checks out `main`, resolves its exact Git
   revision, and calls the authenticated DealRadar import endpoint once for
   that revision.

The Scarosso scanner discovers products only through its six listing-page
ScrapingAnt requests. As best-effort image enrichment, it reuses validated
images from the previous snapshot by exact normalized product URL, then fetches
still-missing product pages directly from Scarosso with bounded concurrency.
Those product-page requests never go through ScrapingAnt and do not affect
listing scan status.

## Responsibilities

- **GitHub Actions:** independently schedule source scans, inject secrets,
  execute scanners, commit validated output, and run one separate daily import
  of the latest committed `main` revision.
- **Scraper entry points:** network orchestration, timeout and retry policy,
  source parsing, and scan-level failure handling.
- **Monitoring configuration:** source selection and source-specific filter
  values describing what should be monitored.
- **Monitor configuration loader:** JSON-backed storage adapter that validates
  the complete monitor document and returns validated monitor objects.
  Request construction remains in each retailer adapter, so a future
  DealRadar/Neon loader can return the same objects without changing scanners.
- **Source parsers:** retailer-specific selectors and normalization rules.
- **Shared contract validation:** common invariants such as valid URLs, counts,
  numeric ranges, uniqueness, and timestamps.
- **DealRadar:** ingestion, persistence, cross-source deduplication, and safe
  rendering of extracted text.

Retailer-specific DOM knowledge should remain in its source scraper. Generic
validation and safe publication behavior may be shared. Application and
database concerns belong in DealRadar.

Configuration describes requested monitoring intent, while each retailer
adapter defines the subset it can translate safely. The initial Zalando adapter
supports only the `herretoej-bukser` category, size 46, and the established
cashmere, linen, and wool material identifiers. Consequently, changing the
configured Zalando category still requires an adapter change. This restriction
is an explicit tracer-bullet capability boundary, not a claim that Zalando's
full taxonomy is configurable. Supporting other sizes also requires an approved
published-contract change because products currently expose
`size_46_available`.

## Trust boundaries

ScrapingAnt and retailer responses are external and untrusted. Extracted data
becomes publishable only after validation. The DealRadar import endpoint is a
separate authenticated service boundary.

## Output contracts

The three sources currently have related but different product shapes. Vinted
uses `price` and `currency`. Scarosso exposes original price, current price,
discount fields, and a normalized `currency` of `USD`, `EUR`, `GBP`, or `null`.
Its `conflicting-currencies` status means numeric candidates were retained but
prices were not compared across currencies. Zalando exposes original price,
current price, and discount fields. These differences must be documented and
tested before treating the formats as a single schema.

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
- DealRadar imports one exact `main` revision after the source workflow window.
  Each source snapshot at that revision is either its newly validated output or
  its last known-good committed output when that source failed or was disabled.
- External requests should have bounded timeouts and limited retries.
- Errors must contain useful context without exposing credentials.

The current scrapers do not yet enforce all of these rules; they describe the
direction for future implementation. Vinted fails closed on required-page
failures and empty successful scans, validates its output, atomically publishes
validated snapshots, and uses bounded request timeouts and retries. Zalando now
fails closed on its required listing-page failure and empty successful scans,
validates its output, and atomically publishes validated snapshots.

Zalando's fail-closed behavior was added as an explicitly approved Slice 3
scope expansion. It intentionally differs from the pre-Slice 3 behavior, which
could publish a failed or empty scan, even though issue #1 otherwise called for
preserving existing scan behavior. A failed or empty Zalando scan now exits
before the workflow's commit step.
