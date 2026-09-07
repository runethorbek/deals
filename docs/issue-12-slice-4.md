# Issue #12 Slice 4: verification and compatibility review

## Verification result

On 2026-09-07, the deterministic suite was run with `node --test` (the
underlying command for `npm test`; PowerShell policy prevents loading
`npm.ps1`). After the dispositions below, all 87 tests pass. The contract
checks cover populated Vinted, Scarosso, and Zalando fixtures, plus a separate
empty Scarosso fixture, through `test/output-contract.test.mjs`.

`git diff --check` passes. The final diff is limited to the contract evidence,
its deterministic assertion, and this verification record; it does not change
scraper requests, parsing, publication policy, published fields, or DealRadar
import behavior.

## Mismatch disposition

| Mismatch | Evidence | Disposition |
| --- | --- | --- |
| Slice 1 described its Scarosso zero-product observation as the current checked-in snapshot, but the later committed 2026-09-07 snapshot has 40 products and one route-level 404. | `public/deals/scarosso-latest.json`; the first full-suite run failed `test/issue-12-slice-1.test.mjs` because it expected zero products. | Documentation and test correction. `docs/issue-12-slice-1.md` and `docs/output-contract.md` now identify the zero-product state as the point-in-time `2c6e0fc` observation; the test validates current snapshot invariants instead of stale inventory. No producer contract or publication-policy change. |
| The Slice 1 evidence has no verified historical `en-us` or equivalent unfiltered-route comparison. | `docs/issue-12-slice-1.md`, “Scarosso zero-product evidence”. | Follow-up remains required if a root-cause or Scarosso publication-policy decision is needed. This slice makes no request/parsing or publication-policy change. |
| The producer suite mirrors DealRadar field selection for a compatibility regression check; it is not a substitute for testing the importer itself. | `test/output-contract.test.mjs`, `projectForDealRadar`. | Follow-up: keep the mapping aligned with DealRadar’s documented importer until the consumer repository owns an equivalent fixture-based check. No producer-field or importer behavior change. |
| Scarosso `price_candidates` was present in representative output and validated by the test helper but omitted from its source-specific field table. | Independent compatibility review; `public/deals/scarosso-latest.json`; `test/output-contract.test.mjs`. | Documentation correction. `docs/output-contract.md` now identifies it as diagnostic numeric candidates that must not be compared across conflicting currencies. No JSON, importer, or scraper change. |

## Compatibility conclusion

The producer contract remains source-specific and unchanged. Existing
DealRadar field mapping coverage in `test/output-contract.test.mjs` verifies
the consumed producer fields for all three sources. Any finding requiring a
contract change must be separately approved and coordinated with DealRadar.
