# Deals output contract

This document is the authoritative producer contract for the JSON snapshots
published by this repository and consumed by DealRadar. The snapshots are
source-specific documents; this contract does not define a universal product
schema.

The published boundary is:

```text
public/deals/vinted-latest.json
public/deals/scarosso-latest.json
public/deals/zalando-latest.json
```

The files are committed snapshots. DealRadar imports the files from one exact
`main` revision, not from a mixture of revisions.

## Common snapshot semantics

Every snapshot identifies its retailer with `site`, records the observation
time in `checked_at`, and provides a `products` array. `product_count` is the
number of published products and equals `products.length`. Where present,
`scanned_product_count` describes products recognized during the scan before
publication filtering.

`checked_at` is the UTC ISO-8601 time for the scan output. A product's
`checked_at` is the observation time associated with that product; for normal
scans it equals the snapshot timestamp.

`scan_mode` identifies the kind of retailer scan and is source-specific. A
`start_urls` array identifies the listing requests for Vinted and Zalando.
Scarosso instead records its requested listing routes in `debug.pages`.

A published snapshot contains a validated usable result for the publication
policy of that source. A complete scan may publish, and a source that supports
degraded scans may also publish a validated partial result with its request
failures retained in `scan_status`. A fatal or implausible scan preserves the
last known-good committed snapshot rather than replacing it. Source workflows
publish through a temporary file and atomic replacement where the scanner
supports publication.

`scan_status` is diagnostic metadata. Its common fields are:

| Field | Meaning |
| --- | --- |
| `attempted_pages` | Listing pages requested for this scan |
| `successful_pages` | Requests that returned a usable page response |
| `failed_pages` | Requests that failed |
| `failures` | Failed request URL and sanitized error summary |
| `scanned_product_count` | Products recognized before publication filtering |
| `published_product_count` | Legacy source-specific result count: `products.length` for Vinted and `matches.length` for Scarosso and Zalando |

For a source with page status, `successful_pages + failed_pages =
attempted_pages`. A route-level failure is not automatically proof that the
whole source scan is invalid. Vinted and Zalando may publish a validated
degraded scan when their source-specific validation passes. Scarosso may publish
a snapshot with missing sale categories.

## Common product concepts

The concepts below are shared, although the JSON keys are not always shared:

| Concept | Producer meaning |
| --- | --- |
| Product identity | The canonical HTTPS retailer product URL in `url`; URLs are unique within a source snapshot |
| Display name | `title`, the retailer or parser-provided product title |
| Current observed price | The sale/listing price observed at scan time (`price` for Vinted, `current_price` for Scarosso and Zalando) |
| Original/reference price | A source-reported regular or reference price, when reliably available; it is not the current price |
| Currency | A source-reported or safely parsed ISO-style currency code; it is not application-wide normalized currency |
| Image | `image`, the image associated with the product URL, or `null` when association is not reliable |
| Observation time | `checked_at` on the product |
| Availability | Source-specific size or availability signals; these must not be interpreted as a universal availability field |
| Provenance | `source_url` or `source_urls` identifies the listing request(s) where the product was observed |

The current-price key is intentionally source-specific:

- Vinted: `price`
- Scarosso: `current_price`
- Zalando: `current_price`

No universal price field is added merely to align names. Prices are finite
non-negative numbers when present. Missing or conflicting values are represented
as `null` where the source parser supports that state; values are not guessed
from magnitude or unrelated text.

Product URLs must be HTTPS URLs for the expected retailer and must be unique
within a published source snapshot. Counts must match their corresponding
arrays, timestamps must parse as dates, and numeric values must be finite and
plausible for the source.

## Vinted

### Snapshot fields

| Field | Meaning |
| --- | --- |
| `site` | `vinted.com` |
| `scan_mode` | `vinted-listing-pages-only` |
| `start_urls` | Listing URLs requested across all enabled monitors |
| `catalog_id` | Retailer catalog identifier used in the listing filter; present only for one enabled monitor |
| `target_size_id` | Retailer size identifier used in the listing filter; present only for one enabled monitor |
| `checked_at` | Scan observation time |
| `scanned_page_count` | Number of requested listing pages |
| `scanned_product_count` | Recognized products |
| `product_count` | Published product count |
| `products` | Published Vinted product objects |
| `monitors` | Monitor summaries: ID, catalog ID, size ID, required pages, and unique observed product count |
| `scan_status` | Listing-page outcome and published count metadata |
| `debug.pages` | Per-page product counts, JSON-LD counts, and request errors |
| `debug.products_with_price` | Recognized products with a parsed price |
| `debug.products_without_price` | Recognized products without a parsed price |
| `debug.products_with_brand` | Recognized products with a parsed brand |
| `debug.products_with_size_guess` | Recognized products with an inferred size |

Vinted attempts every configured page. A complete scan has no failed pages. A
degraded scan may publish when at least one page succeeds, every enabled monitor
still observes products, and the combined recognized product set is non-empty.
Its failed requests remain visible through `scan_status.failures`. All-page
failure, empty or implausible output, and configuration or execution failures
preserve the prior snapshot. The checked-in monitor uses catalog `1786`, size
`207`, and three pages; those values are monitoring intent, not universal
contract fields.

### Product fields

| Field | Meaning |
| --- | --- |
| `title` | Listing title |
| `url` | Canonical Vinted item URL and product identity |
| `image` | Vinted listing image |
| `site` | `vinted.com` |
| `source_url` | Listing page where this observation was found |
| `source_urls` | Listing pages retained when duplicate observations are merged |
| `monitor_ids` | Sorted, unique IDs of monitors that observed the item |
| `catalog_id` | Catalog filter used for the observation |
| `target_size_id` | Size filter used for the observation |
| `size_assumption` | Documents that the listing URL was filtered by the size ID |
| `brand` | Explicit `Varemærke:` listing brand text, or `null` when that metadata is absent |
| `size_guess` | Explicit `Størrelse:` listing size text when available; otherwise existing size inference, or `null` |
| `article_condition` | Additive Vinted-specific `Artiklens stand:` source text, or `null` when absent |
| `price` | Current observed listing price, or `null` when no price is parsed |
| `currency` | Parsed retailer-local currency (`DKK`, `EUR`, `USD`, or `null`) |
| `raw_price` | Source price text retained for diagnostics |
| `raw_card_text` | Bounded source card text retained for diagnostics |
| `checked_at` | Product observation time |

## Scarosso

### Snapshot fields

| Field | Meaning |
| --- | --- |
| `site` | `scarosso.com` |
| `scan_mode` | `listing-pages-only` |
| `target_size` | Configured size filter, currently `42` |
| `min_discount_percent` | Matching threshold, not a claim that every product has this discount |
| `checked_at` | Scan observation time |
| `scanned_page_count` | Configured listing routes requested |
| `scanned_product_count` | Products recognized across listing pages |
| `product_count` | Published product count |
| `products` | Published Scarosso product objects |
| `match_count` / `matches` | Products meeting the configured discount threshold |
| `scan_status` | Attempted, successful, and failed route counts |
| `debug.pages` | Per-route product count and error diagnostics |
| `debug.products_with_discount` | Products with a parsed discount |
| `debug.products_below_minimum_discount` | Products with a discount below the configured threshold |
| `debug.products_without_discount` | Products without a parsed discount |
| `debug.products_without_price` | Products without a parsed price |
| `debug.products_without_size_information` | Products without parsed size information |

A zero-product Scarosso snapshot is diagnostically ambiguous. A successful
page with zero recognized products is distinct from a request failure. Slice 1
captured six configured `en-dk` routes with two 404 failures and four
successful pages with zero recognized products; see
`docs/issue-12-slice-1.md` for that point-in-time evidence. This is documented
evidence, not a parser-root-cause claim. Missing sale categories remain
tolerated route-level observations; this contract does not change publication
policy or request/parsing behavior.

### Product fields

| Field | Meaning |
| --- | --- |
| `title` | Scarosso product title |
| `url` | Canonical Scarosso product URL and identity |
| `image` | Product image associated with the URL, or `null` |
| `category` | Category derived from the listing route |
| `source_url` | Listing route where the product was observed |
| `source_urls` | Listing routes retained when duplicate observations are merged |
| `categories` | Categories retained when duplicate observations are merged |
| `available_sizes` | Sizes visible in the listing card |
| `size_42_available` | Whether size 42 is explicitly visible; `null` when unavailable to determine |
| `original_price` | Parsed regular/reference price, or `null` |
| `current_price` | Parsed current observed price, or `null` |
| `currency` | Parsed source currency (`USD`, `EUR`, `GBP`, or `null`) |
| `price_candidates` | Numeric prices parsed from the listing card and retained for diagnostics; they are not interchangeable across conflicting currencies |
| `discount_percent` | Discount calculated from comparable prices, or `null` |
| `discount_status` | Source parser status describing how the discount was determined |
| `checked_at` | Product observation time |

When price candidates contain conflicting currencies, numeric candidates may be
retained but prices are not compared across currencies. Consumers must preserve
that distinction rather than silently treating such values as one currency.

## Zalando

### Snapshot fields

| Field | Meaning |
| --- | --- |
| `site` | `zalando.dk` |
| `scan_mode` | `zalando-listing-page-only` |
| `start_urls` | Listing URLs for all enabled monitors |
| `monitors` | Per-monitor ID, listing URL, target size, threshold, page count, result count, and status |
| `target_size` | Legacy scalar retained only when exactly one monitor is active |
| `min_discount_percent` | Legacy scalar retained only when exactly one monitor is active |
| `checked_at` | Scan observation time |
| `scanned_page_count` | Total listing pages requested across monitors |
| `scanned_product_count` | Recognized products |
| `product_count` | Published product count |
| `products` | Published Zalando product objects |
| `matches` / `match_count` | Products meeting the discount threshold |
| `scan_status` | Listing request outcome and published count metadata |
| `debug.pages` | Per-page monitor ID, product count, request URL, and error |
| `debug.products_with_discount` | Products with a parsed discount |
| `debug.products_below_minimum_discount` | Products with a discount below the configured threshold |
| `debug.products_without_discount` | Products without a parsed discount |
| `debug.products_without_price` | Products without a parsed price |

Zalando attempts every configured page. A complete scan has no failed pages. A
degraded scan may publish when at least one page succeeds and every monitor
still produces at least one product across its successful pages. Failed pages
remain visible through `scan_status.failures`. All-page failure, an empty or
implausible monitor, and configuration or execution failures preserve the prior
snapshot. All enabled monitors contribute to one atomic snapshot. Products are
deduplicated by normalized URL across pages and monitors; a URL found through
different target sizes fails the scan. Configuration validates `pages` from 1
through 10. Page 1 uses the configured listing URL, and later pages preserve
its query parameters while adding `p=N`.

### Product fields

| Field | Meaning |
| --- | --- |
| `title` | Zalando product title or accessible listing description |
| `url` | Canonical Zalando product URL and identity |
| `image` | Product image |
| `site` | `zalando.dk` |
| `source_url` | Listing page where the product was observed |
| `monitor_ids` | Sorted IDs of monitors that observed the product |
| `target_size` | Size filter used for the listing |
| `available` | `true`, based on presence in the target-size-filtered listing |
| `size_46_available` | Legacy field emitted only for size-46 observations |
| `size_assumption` | Documents the configured size filter used by the listing |
| `material_filter` | Material identifiers used in the request |
| `raw_card_text` | Bounded source card text |
| `original_price` | Regular/reference price when reliably parsed |
| `current_price` | Current observed sale price |
| `currency` | `DKK` only when `current_price` was parsed from a supported explicit `DKK` or `kr` representation; otherwise `null`. This is source evidence, not an app-wide normalized currency: no conversion is performed and unknown currency is never guessed. |
| `discount_percent` | Calculated discount or reliable explicit discount |
| `discount_status` | Indicates how the discount was determined |
| `explicit_discount_percent` | Retailer-displayed discount, when present |
| `price_candidates` | Numeric prices parsed from the card for diagnostics |
| `checked_at` | Product observation time |

`original_price` is only comparable when it is higher than the current price.
`discount_percent` is not an application-wide normalized value.

## Consumer boundary and compatibility

DealRadar may normalize, persist, and render these source values, but it must
not redefine their producer meaning. The published JSON is a repository
boundary, and source-specific extensions may evolve independently when shared
semantics are preserved.

DealRadar follow-up work is tracked in:

- [DealRadar #16](https://github.com/runethorbek/dealradar/issues/16): link the
  consumer documentation to this producer contract and keep importer-owned
  behavior separate from producer field semantics.
- [DealRadar #17](https://github.com/runethorbek/dealradar/issues/17): define
  safe historical handling when a product's observed currency changes.

Any change to product identity, required fields, price or currency meaning,
timestamp meaning, scan-status meaning, source URLs, or importer expectations
requires explicit approval and coordination with DealRadar. Additive,
source-specific metadata is preferred where it does not alter existing meaning.
Do not introduce contract-version negotiation unless concurrent incompatible
versions are actually needed.

Diagnostic text is untrusted external data and must not contain credentials,
API keys, authorization headers, or access tokens.
