# DealRadar scrapers

This repository collects deal data for the separate DealRadar application. It
contains listing-page scrapers for:

- Scarosso
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

The workflows in `.github/workflows/` run each scraper on a daily schedule and
can also be started manually with `workflow_dispatch`. When an output file
changes, the workflow commits and pushes that source's JSON snapshot. It then
calls the authenticated DealRadar import endpoint with the resulting Git
revision so DealRadar can import the committed output.

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

## Monitoring configuration

Vinted, Scarosso, and Zalando read their monitoring intent from the shared
`config/monitors.json` file. Source-specific modules validate each monitor and
translate it into retailer listing requests.

The checked-in Vinted monitor preserves the current catalog, size, and
three-page scan. Vinted's base URL and query construction remain implementation
details of the scraper.

Slice 1 supports exactly one enabled Vinted monitor containing one numeric
`catalogIds` value, one numeric `sizeIds` value, and a `pages` value from 1 to
100. Invalid or ambiguous Vinted configuration stops the scanner before it
makes retailer requests or writes output.

The checked-in Scarosso monitor preserves the six current men's sale listings,
size 42, and the 30 percent match threshold. Its relative listing URLs include
the Scarosso size query. The Scarosso adapter owns the
`https://www.scarosso.com/en-dk/` storefront base URL, safely resolves the
configured listings against it, and currently accepts size 42 only to preserve
the published `size_42_available` field.

The checked-in Zalando monitor preserves the current men's trousers category,
size 46, cashmere/linen/wool material filters, and 30 percent match threshold.
The Zalando adapter owns its storefront base URL and taxonomy URL construction.
This tracer bullet accepts only the `herretoej-bukser` category and the three
listed material identifiers. Although `categorySlug` is stored as monitoring
intent, adding another category currently requires an explicit adapter change
so its Zalando taxonomy semantics can be validated. Size 46 is the only
supported size because the published product contract contains
`size_46_available`; supporting other sizes requires an approved contract
change. Invalid or ambiguous configuration stops the scanner before it makes
retailer requests or writes output. Broader category and size support is
deferred rather than implied by the initial JSON model.

Vinted ScrapingAnt requests time out after 30 seconds and transient failures
are attempted at most three times with bounded backoff. If any required listing
page still fails, or successful pages produce no products, the scan exits
without replacing the last known-good output. Valid snapshots are written to a
temporary file and atomically renamed into place.

Zalando treats its listing page as required and preserves the last known-good
snapshot when that request fails or a successful response contains no products.
Validated Zalando output is published through an atomic file replacement.
This is an intentional, approved exception to issue #1's current-behavior
preservation baseline: Slice 3 also replaced Zalando's previous behavior of
publishing failed or empty scans so the scanner follows the repository's
fail-closed publication policy. The workflow therefore exits before its normal
commit and import steps in those cases.

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
