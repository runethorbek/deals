# DealRadar scrapers

This repository collects deal data for the separate DealRadar application. It
contains listing-page scrapers for:

- Scarosso (deprecated/inactive direct source)
- Vinted
- Zalando

Each scraper fetches rendered retailer pages through ScrapingAnt, extracts
product data, and writes its latest snapshot to `public/deals/`:

```text
public/deals/scarosso-latest.json
public/deals/vinted-latest.json
public/deals/zalando-latest.json
```

These generated JSON files are intentionally committed to the repository.

## Automated scans and import

The three source workflows in `.github/workflows/` run each scraper on its own
daily schedule and can also be started manually with `workflow_dispatch`. When
an output file changes, its source workflow commits and pushes that source's
JSON snapshot. This keeps scans independently observable and failure-isolated.

The separate `daily-dealradar-import.yml` workflow runs at 05:00 UTC, 83
minutes after the latest source scan is scheduled to start at 03:37 UTC. It can
also be started manually with `workflow_dispatch`, checks out `main`, resolves
its exact Git revision, and calls the authenticated DealRadar import endpoint
once. DealRadar therefore imports the latest committed source snapshots at one
specific repository revision; a failed or disabled source continues to
contribute its last known-good committed snapshot.

GitHub Actions uses these repository secrets:

- `SCRAPINGANT_API_KEY`
- `DEALRADAR_INGEST_API_KEY`

## Run locally

Node.js 24 or newer is required. Install dependencies and set
`SCRAPINGANT_API_KEY` in your environment before running a scraper:

```sh
npm install
npm run scan:scarosso
node scripts/scan-vinted.mjs
node scripts/scan-zalando.mjs
```

Running a scraper writes directly to its file in `public/deals/`. Review the
generated diff before keeping or committing it. Local scraper runs do not call
the DealRadar import endpoint.

Issue #14's Slice 0 pagination investigation is separate from a normal scan.
It makes six bounded rendered ScrapingAnt requests for the trousers and
Scarosso-shoe examples (pages 1 through 3), does not publish deal output, and
writes a sanitized, git-ignored `zalando-pagination-report.json.tmp`:

```sh
npm run investigate:zalando-pagination
```

Review the report's per-page product counts, duplicate links, adjacent-page
overlap, requested-filter preservation, rendered filter markers, and product
URLs. The report contains neither the ScrapingAnt API key nor raw HTML.

## Monitoring configuration

Vinted, Scarosso, and Zalando read their monitoring intent from the shared
`config/monitors.json` file. Before a scanner selects a monitor, the loader
parses and validates the complete document: known sources, unique non-empty
IDs, boolean `enabled`, object `filters`, and the supported source-specific
fields. Scanners receive the resulting validated monitor object rather than
depending on file-reading behavior.

Vinted and Zalando may have multiple enabled monitors; Scarosso may have at
most one. A scheduled workflow with no enabled monitor for its source exits
successfully and skips scanning, publishing, and committing. Disabled monitors
are still validated so an
invalid document cannot be partially used.

The checked-in Vinted monitor preserves the current catalog, size, and
three-page scan. Vinted's base URL and query construction remain implementation
details of the scraper.

Each Vinted monitor contains one numeric `catalogIds` value, one numeric
`sizeIds` value, and a `pages` value from 1 to 100. All enabled Vinted monitors
are scanned in ID order and merged into one atomic snapshot. Invalid
configuration stops the scanner before it makes retailer requests or writes
output.

The checked-in direct Scarosso monitor is disabled: current Scarosso monitoring
has moved to Zalando. The direct scanner, workflow, tests, and its last
known-good `public/deals/scarosso-latest.json` snapshot are retained temporarily
as a fallback and for compatibility with existing consumers. Its preserved
configuration covers the six current men's sale listings, size 42, and the 30
percent match threshold. Its relative listing URLs include the Scarosso size
query. The Scarosso adapter owns the
`https://www.scarosso.com/en-dk/` storefront base URL, safely resolves the
configured listings against it, and currently accepts size 42 only to preserve
the published `size_42_available` field.

Each Zalando monitor stores a stable `id`, a Zalando-relative `listingPath`, an
explicit `targetSize`, a `minDiscountPercent`, and `pages`. The adapter owns the
`https://www.zalando.dk/` storefront base URL and safely resolves the configured
path, so categories, brands, sizes, and Zalando query filters do not require
dedicated scraper code. Absolute/cross-host paths, fragments, configured `p`
parameters, missing target sizes, and invalid thresholds are rejected. `pages`
is validated from 1 through 10. Each monitor requests its base listing as page 1
and adds `p=N` with URL search-parameter handling for pages 2 through `pages`,
preserving existing listing filters.

All enabled Zalando monitors are scanned and merged into one
`public/deals/zalando-latest.json`. Products are deduplicated by normalized URL
and carry sorted `monitor_ids`, their configured `target_size`, and
`available: true`. Size-46 observations retain `size_46_available`; other sizes
do not emit that legacy field. A duplicate URL observed through different target
sizes fails the complete scan instead of publishing ambiguous data. A failed
required page or empty monitor also prevents publication, although remaining
pages and monitors are still attempted for diagnostics. Products are
deduplicated across pagination pages before the monitors are combined. Monitor
configuration remains repository-owned;
moving it to DealRadar is a possible future change, not part of this slice.

Zalando products expose listing-card identity fields when available: `brand`,
`product_name`, `product_type`, and `color`. Their display `title` is derived
from those fields (`brand product_name - product_type - color`, omitting
missing parts). The primary image alt text describes the photograph and is not
used as product identity; a card without structured identity receives the
title `Unknown product`.

Vinted ScrapingAnt requests time out after 30 seconds and transient failures
are attempted at most three times with bounded backoff. If any required listing
page still fails, or any successful monitor produces no products, the scan exits
without replacing the last known-good output. Products are deduplicated by
canonical item URL and include sorted `monitor_ids` provenance. Valid snapshots
are written to a temporary file and atomically renamed into place.

Zalando treats every configured listing page as required and preserves the
last known-good snapshot when any request fails or a monitor's successful pages
collectively contain no products.
Validated Zalando output is published through an atomic file replacement.
This is an intentional, approved exception to issue #1's current-behavior
preservation baseline: Slice 3 also replaced Zalando's previous behavior of
publishing failed or empty scans so the scanner follows the repository's
fail-closed publication policy. The workflow therefore exits before its normal
commit step in those cases.

Run the deterministic test suite with:

```sh
npm test
```

## Development workflow

1. Read `AGENTS.md` and the relevant scraper, workflow, and output sample.
2. Make a focused change without running live scrapers unless the task requires
   it.
3. Add deterministic coverage when changing parser or output behavior.
4. Run the applicable checks and inspect the complete diff, including generated
   JSON.
5. Use an independent review pass, let CI run when available, and obtain human
   approval before merging.

Repository design and data flow are documented in `docs/architecture.md`.
Security boundaries and review triggers are documented in `docs/security.md`.
