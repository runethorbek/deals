# Issue #12 Slice 1: contract inventory and Scarosso discovery

This document records the point-in-time inventory and route evidence captured
for Slice 1 at commit `2c6e0fc` (2026-09-06). It does not change the
published JSON shape, parser behavior, URLs, or publication policy. The
authoritative current field semantics are in `docs/output-contract.md`; later
snapshots can legitimately contain different retailer inventory.

## Scope and non-goals

Slice 1 is limited to inventory and evidence gathering:

- record the fields and semantics currently published for Vinted, Scarosso, and Zalando;
- identify the actual DealRadar assumptions that are already documented in this repository;
- distinguish shared invariants from source-specific extensions;
- capture the current Scarosso zero-product state with deterministic evidence;
- leave any contract redesign or policy change for a separately approved follow-up.

Non-goals for this slice:

- no changes to JSON fields;
- no DealRadar importer-code changes;
- no changes to Scarosso URLs, parser logic, or publishing thresholds;
- no contract-versioning layer or universal scraper abstraction.

## Snapshot inventory

### Vinted snapshot

Snapshot inspected for Slice 1: `public/deals/vinted-latest.json` at `2c6e0fc`

Snapshot-level fields observed:

- `site`: retailer identity (`vinted.com`)
- `scan_mode`: `vinted-listing-pages-only`
- `start_urls`: three listing URLs for the configured catalog and size filter
- `catalog_id`: configured Vinted catalog identifier
- `target_size_id`: configured size filter
- `checked_at`: ISO-8601 timestamp
- `scanned_page_count`: number of listing pages requested
- `scanned_product_count`: total extracted product count across pages
- `product_count`: published product count
- `products`: array of product objects
- `scan_status`: page failure summary and published counts

Current product fields observed:

- `title`, `url`, `image`
- `site`, `source_url`
- `catalog_id`, `target_size_id`
- `size_assumption`
- `brand`, `size_guess`
- `price`, `currency`
- `raw_price`, `raw_card_text`
- `checked_at`
- `source_urls`

Observed semantics:

- `price` is the current observed listing price in the retailer-local currency.
- `currency` is normalized to a code like `DKK`.
- `size_assumption` records the retailer-side filtering intent used to build the request.
- `source_urls` preserves the page(s) where the product was observed, without changing product identity.

### Scarosso snapshot

Snapshot inspected for Slice 1: `public/deals/scarosso-latest.json` at `2c6e0fc`

Snapshot-level fields observed:

- `site`: retailer identity (`scarosso.com`)
- `scan_mode`: `listing-pages-only`
- `target_size`: size filter (`42`)
- `min_discount_percent`: threshold used for matching
- `checked_at`: ISO-8601 timestamp
- `scanned_page_count`: six configured listing pages
- `scanned_product_count`: zero recognized products
- `product_count`: zero
- `products`: empty array
- `match_count`: zero
- `matches`: empty array
- `scan_status`: attempted/successful/failed page counts and zero published count
- `debug.pages`: per-page product counts and the current route-level outcomes

The Slice 1 Scarosso product array was empty. The page-level evidence from
`debug.pages` showed two 404 failures and four successful page fetches that
still produced zero recognized products. This is historical route evidence for
the zero-product state the issue calls out explicitly; it is not a claim about
later retailer inventory.

### Zalando snapshot

Snapshot inspected for Slice 1: `public/deals/zalando-latest.json` at `2c6e0fc`

Snapshot-level fields observed:

- `site`: retailer identity (`zalando.dk`)
- `scan_mode`: `zalando-listing-page-only`
- `start_urls`: configured retailer listing URL
- `target_size`: size filter (`46`)
- `min_discount_percent`: threshold used for matching
- `checked_at`
- `scanned_page_count`
- `scanned_product_count`
- `product_count`
- `products`
- `scan_status`

Current product fields observed:

- `title`, `url`, `image`
- `site`, `source_url`
- `target_size`
- `size_46_available`
- `size_assumption`
- `material_filter`
- `raw_card_text`
- `original_price`, `current_price`
- `discount_percent`, `discount_status`, `explicit_discount_percent`
- `price_candidates`
- `checked_at`

Observed semantics:

- `current_price` is the observed sale price.
- `original_price` is the regular price if it is present and higher than the current price.
- `discount_percent` is computed from the available numeric prices and preserved with explicit discount markers when present.
- `size_46_available` reflects the size-specific listing filter; it is a source-specific availability signal, not a universal product model field.

## Shared invariants versus source-specific extensions

Shared invariants already documented in the repository and verified in the current snapshots:

- each snapshot is tied to a source (`site`)
- `checked_at` is a valid ISO-8601 timestamp
- `product_count` matches the length of `products`
- per-page and overall scan status counts remain internally consistent
- product URLs are expected to be valid HTTPS URLs for the retailer in question
- numeric values are finite and plausibly scoped to the source data
- Vinted and Zalando currently fail closed for required-page failures and implausible or empty scans; Scarosso records route-level failures in `scan_status` and may still publish a snapshot because a missing sale route can mean that category has no sale inventory

Source-specific extensions currently remain distinct:

- Vinted: `catalog_id`, `target_size_id`, `size_assumption`, `brand`, `size_guess`, `raw_card_text`, `source_urls`
- Scarosso: `target_size`, `min_discount_percent`, `size_42_available`, `match_count`, `matches`, `debug.pages`, `products_with_discount`, etc.
- Zalando: `material_filter`, `size_46_available`, `discount_status`, `explicit_discount_percent`, `price_candidates`

These are not yet a universal product schema. They are current source-specific semantics that should remain source-owned until a separately approved contract change is made.

## DealRadar assumptions observed in this repository

This repository does not include the DealRadar importer code, so the mapping below is intentionally limited to the assumptions already documented here and the producer-side fields currently published in the checked-in snapshots.

The architecture documentation states that:

- DealRadar imports a committed snapshot at one exact repository revision;
- the source snapshot remains the published contract boundary;
- the importer is a separate consumer that may normalize or persist fields without redefining producer semantics;
- source-specific extensions may differ and should remain documented rather than forced into a universal product model.

The checked-in snapshots also show the current producer-side assumptions already relied on by the repo:

- Vinted exposes `price` and `currency` as the current observed listing price in the retailer-local currency.
- Scarosso exposes `target_size`, source-specific size availability when products are present, and zero-product page metadata without a universal product schema.
- Zalando exposes `current_price`, `original_price`, `discount_percent`, and `size_46_available` as source-specific semantics.

In practical terms, the current producer contract is therefore:

- the published JSON snapshot is the source of field semantics;
- consumer assumptions are downstream and must not silently redefine the producer contract;
- a producer-side change requires explicit coordination before any importer assumption changes.

## Scarosso zero-product evidence

The Slice 1 evidence from `public/deals/scarosso-latest.json` at `2c6e0fc`
shows the configured size-filtered `en-dk` sales routes resolved as follows:

| Route | product_count | error | observation |
| --- | ---: | --- | --- |
| `https://www.scarosso.com/en-dk/sales/men/?prefn1=c_size&prefv1=42` | 0 | `ScrapingAnt request failed with HTTP 404` | request failed |
| `https://www.scarosso.com/en-dk/sales/men/sneakers/?prefn1=c_size&prefv1=42` | 0 | `ScrapingAnt request failed with HTTP 404` | request failed |
| `https://www.scarosso.com/en-dk/sales/men/loafers/?prefn1=c_size&prefv1=42` | 0 | null | page loaded but zero products recognized |
| `https://www.scarosso.com/en-dk/sales/men/flats/?prefn1=c_size&prefv1=42` | 0 | null | page loaded but zero products recognized |
| `https://www.scarosso.com/en-dk/sales/men/boots/?prefn1=c_size&prefv1=42` | 0 | null | page loaded but zero products recognized |
| `https://www.scarosso.com/en-dk/sales/men/last-pairs/?prefn1=c_size&prefv1=42` | 0 | null | page loaded but zero products recognized |

This matters because the captured zero-product state was not a uniform failure:
two route requests 404, while the remaining four pages loaded and still yielded
zero recognized products. That combination is the strongest deterministic
evidence captured for Slice 1.

The repo also contains the current request plan logic, which makes the current route contract explicit:

- `config/monitors.json` defines exactly those six relative listing URLs under `listingUrls` for the enabled Scarosso monitor.
- `scripts/lib/scarosso-monitor.mjs` resolves each relative URL against `https://www.scarosso.com/en-dk/` and rejects any path that does not match the supported `en-dk` `sales/men` pattern with `prefn1=c_size&prefv1=42`.
- `scripts/lib/scarosso-monitor.mjs` resolves listing routes against the `https://www.scarosso.com/en-dk/` base. Product URLs are a separate identity: `scripts/lib/scarosso-image.mjs` accepts canonical HTTPS product URLs under either `/en-dk/` or `/en-us/`, so neither locale is required for product identity.

The equivalent unfiltered routes are the same paths without the `?prefn1=c_size&prefv1=42` query, such as:

- `/sales/men/`
- `/sales/men/sneakers/`
- `/sales/men/loafers/`
- `/sales/men/flats/`
- `/sales/men/boots/`
- `/sales/men/last-pairs/`

No checked-in historical `en-us` fixture or zero-product comparison exists in this repository. The repo therefore has deterministic evidence for the Slice 1 `en-dk` size-filtered configuration and zero-product result, but it does not yet contain a verified historical `en-us` comparison, an unfiltered route response comparison, or a retailer-side response log proving the root cause. Those gaps are explicitly recorded here as follow-up items rather than being hidden as solved facts.

## Verified facts for this slice

The following facts are independently supported by the repository state:

- Vinted, Scarosso, and Zalando currently publish different but internally coherent source-specific product shapes.
- The repository already documents the need to preserve those differences without forcing a universal schema.
- The Slice 1 Scarosso snapshot was a deterministic zero-product result for all six configured `en-dk` sale routes.
- No JSON field or publication-policy change is made as part of this slice.
- Any future contract change remains subject to explicit approval and DealRadar coordination.
