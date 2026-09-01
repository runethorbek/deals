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

Vinted reads its monitoring intent from `config/monitors.json`. The checked-in
monitor preserves the current catalog, size, and three-page scan. Vinted's base
URL and query construction remain implementation details of the scraper.

Slice 1 supports exactly one enabled Vinted monitor containing one numeric
`catalogIds` value, one numeric `sizeIds` value, and a `pages` value from 1 to
100. Invalid or ambiguous Vinted configuration stops the scanner before it
makes retailer requests or writes output.

Vinted ScrapingAnt requests time out after 30 seconds and transient failures
are attempted at most three times with bounded backoff. If any required listing
page still fails, or successful pages produce no products, the scan exits
without replacing the last known-good output. Valid snapshots are written to a
temporary file and atomically renamed into place.

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
