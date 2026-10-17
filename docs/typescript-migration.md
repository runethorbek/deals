# TypeScript migration plan (issue #24, Slice 1)

This is the Slice 1 investigation for #24 (tracked as #25). It is a
recommendation only: Slice 2 starts after a human approves it. It changes no
code, tests, workflows, dependencies, or published output. Facts below were
read from the repository at commit `176aed1`; recommendations and assumptions
are marked as such.

Update (#27): the deprecated direct Scarosso scanner was removed before Slice 3,
together with its workflow, tests, fixtures, monitor, and published snapshot.
The repository now has two sources, Vinted and Zalando. Sections 1 to 7 are
updated to that state; the test counts recorded for Slices 1 and 2 are
historical.

Update (#32): Slice 7 deleted the one-off Zalando pagination investigation
script (written for #14, which is closed), together with its test and its
`package.json` script. No workflow used it and it published no deals; it
remains in git history. Sections 1 to 7 no longer list it.

## 1. Current state

### Commands and baseline

| Item | Fact |
| --- | --- |
| Runtime | ESM (`"type": "module"`), `engines.node` `>=24`; local Node v24.18.0, npm 11.16.0 |
| Dependencies | `cheerio` `^1.0.0` (1.2.0 installed locally), `node-fetch` `^3.3.2`; no devDependencies, no lockfile, no build step |
| Scripts (`package.json`) | `test`: `node --test` |
| Typecheck / lint | None |
| CI for tests | None. No workflow runs `npm test`; the workflows only scan and import |
| Type declarations | `cheerio` and `node-fetch` both ship their own `.d.ts` files; Node types would need `@types/node` |

Test baseline, recorded for AC3: `npm test` at HEAD
`176aed1c33499789c0b8ae882624b5a5a2235b2f` on branch
`slice/25-typescript-migration-plan` (only this document is uncommitted) with
Node v24.18.0 gave **tests 122, pass 122, fail 0**, cancelled 0, skipped 0,
todo 0. No warnings were printed. The suite has 16 test files
(`test/*.test.mjs`) and 11 fixtures in `test/fixtures/`. Issue #25 says 18
test files; the real number is 16.

### Workflow invocations

| Workflow | Repo code invoked |
| --- | --- |
| `daily-vinted.yml` | `node scripts/monitor-enabled.mjs vinted`, then `node scripts/scan-vinted.mjs` |
| `daily-zalando.yml` | `node scripts/monitor-enabled.mjs zalando`, then `node scripts/scan-zalando.mjs` |
| `daily-dealradar-import.yml` | None (checkout and `curl` only) |

Both scan workflows use `actions/setup-node@v5` with `node-version: "24"`
and install with `npm install`. Other path references to `.mjs` files are in
`README.md` (run commands) and in `test/monitor-enabled.test.mjs:16`, which
spawns `scripts/monitor-enabled.mjs` by path.

### Module dependency map

Edges come from the actual `import` statements. Every module also uses `node:`
built-ins, which are not shown. Third-party imports are in brackets.

```text
Entrypoints
  monitor-enabled.mjs ............ -> lib/validated-monitor-loader
  scan-vinted.mjs [cheerio, node-fetch]
                                 -> lib/scan-status, lib/vinted-monitor
  scan-zalando.mjs [cheerio, node-fetch]
                                 -> lib/scan-status, lib/zalando-price, lib/zalando-monitor

scripts/lib (6 modules)
  Leaves:  scan-status, monitor-config, zalando-price
  Cycle:   validated-monitor-loader -> monitor-config, vinted-monitor, zalando-monitor (static)
           vinted-monitor, zalando-monitor -> validated-monitor-loader
             (dynamic `await import(...)`; vinted-monitor.mjs:35,50; zalando-monitor.mjs:101)
```

Tests import `scripts/` directly: `scan-zalando.mjs`, `scan-vinted.mjs`,
and all 6 lib modules. Tests also import JSON with `with { type: "json" }`:
`config/monitors.json`, `public/deals/{vinted,zalando}-latest.json`, and
fixtures (`test/issue-12-slice-1.test.mjs`, `test/output-contract.test.mjs`,
`test/vinted-scan.test.mjs`).

One fact matters for ordering: `validated-monitor-loader` validates **every**
configured monitor, disabled ones included (`validated-monitor-loader.mjs:25-27`).
So the Vinted path also runs the Zalando monitor validator, and the reverse.

### External-data entry points (untrusted at runtime)

| Input | Where it enters |
| --- | --- |
| `process.env.SCRAPINGANT_API_KEY` | `scan-vinted.mjs:16`, `scan-zalando.mjs:18`; checked with `if (!apiKey) throw` |
| `process.env.GITHUB_OUTPUT`, `process.argv[2]` | `monitor-enabled.mjs:4-8` |
| `config/monitors.json` | `monitor-config.mjs:23-47` (`JSON.parse` plus envelope validation), then the per-source validators |
| ScrapingAnt and retailer HTML | `getRenderedHtml*` in each scanner (`res.ok`, `res.status`, `res.text()`), parsed with `cheerio.load` |
| Embedded JSON-LD | `scan-vinted.mjs:364-381` (`JSON.parse` inside try/catch) |

## 2. Runtime strategy

Recommendation: **run `.ts` files directly with Node 24's built-in type
stripping, and typecheck separately with `tsc --noEmit`.** Of the three options
this one adds the fewest moving parts. Tests, workflows, and local runs execute
the same files, and stack traces need no source maps.

| Criterion | A. `tsc` build, run output | B. Native type stripping + `tsc --noEmit` (recommended) | C. `tsx` loader |
| --- | --- | --- | --- |
| GitHub Actions | Every scan workflow needs a build step before running, and paths change to `dist/` | No build. Only the file path changes (`node scripts/scan-vinted.ts`) [L] | `npx tsx …` or `node --import tsx …`; the loader must be installed at scan time |
| Local use | Build or watch before every run and test | `node file.ts` works directly [L] | `tsx file.ts` works directly; it also accepts non-erasable syntax [D] |
| Stack traces | Point at emitted JS unless `sourceMap` and `--enable-source-maps` are used | Exact `.ts` line **and column**, because types are replaced with whitespace [L] | Source-mapped by tsx [D] |
| `node --test` discovery | Tests run from `dist/` (and fixtures must be copied) or from source, which needs B or C anyway | Default discovery finds `*.test.ts` and `*.test.mjs` side by side [L] | Needs `--import tsx`; discovery as in B [D] |
| Production scrapers | Run compiled output, which can drift from source if the build is skipped | Run the reviewed source. No runtime typecheck: a type error still runs [L] | Third-party transform at runtime; no typecheck either [D] |
| Dependency overhead | `typescript`, `@types/node` (dev) plus a build artefact policy | `typescript`, `@types/node` (dev only); zero runtime additions | `tsx` (pulls in esbuild with platform-specific binaries) plus `typescript` for typechecking [D] |
| Repo-specific risk | `new URL("../../config/monitors.json", import.meta.url)` (`monitor-config.mjs:3`) and relative fixture imports in tests resolve differently from an `outDir` | None found | Floating transitive binaries with no lockfile |

[L] = verified by a local experiment (below). [D] = from tool documentation,
not verified locally. `tsc` and `tsx` are not installed on this machine, and
installing them was out of scope.

Not recommended: Node's `--experimental-transform-types`. Locally it does run
enums, but it prints `ExperimentalWarning: Transform Types is an experimental
feature` [L].

### Syntax constraints that option B imposes

All of these were verified locally on Node v24.18.0:

- **Erasable syntax only.** `enum`, `namespace`, constructor parameter
  properties (`constructor(private x: number)`), and angle-bracket assertions
  (`<T>x`) fail with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Use string-literal
  unions and `as`. `satisfies`, `as const`, and `!` definite assignment work.
- **Explicit `.ts` extensions in relative imports.** Extensionless imports and
  `.js` imports both fail with `ERR_MODULE_NOT_FOUND`. Dynamic
  `await import("./x.ts")` works, and so does the loader cycle.
- **Type-only imports must say `import type`.** `import { Monitor }` of an
  interface fails at runtime with `does not provide an export named 'Monitor'`.
- **No `.ts` under `node_modules`** (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`).
  This does not affect this repository.
- Node ignores `tsconfig.json`, so `paths` aliases are not available [D].

### Local experiment record

All experiments ran on Node v24.18.0 (`process.features.typescript` is
`"strip"`), in a scratch directory outside the repository, with a
`package.json` of `{ "type": "module" }`.

| Command | Result |
| --- | --- |
| `node scripts/entry.ts` (a `.ts` entry importing a `.ts` lib, a `.mjs` lib that itself imports a `.ts` lib, and JSON `with { type: "json" }`) | Ran with no warning. The `import.meta.url === pathToFileURL(process.argv[1])` entrypoint check was true |
| `node scripts/entry.ts throw` | Trace pointed at `leaf.ts:10:9` and `entry.ts:14:36`: the correct line and column |
| `node --test` with `test/leaf.test.ts`, `test/old.test.mjs`, and a non-test `test/helper.ts` | All three files ran (3 pass). The helper was executed as a test file |
| `node enum.ts`, `paramprop.ts`, `ns.ts`, `anglecast.ts` | `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` |
| `node noext.ts`, `jsext.ts` | `ERR_MODULE_NOT_FOUND` |
| `node valueimport-of-type.ts` | `SyntaxError … does not provide an export named 'Monitor'` |
| `node typeerr.ts` (`const n: number = "not a number"`) | Ran and printed the string: there is no runtime type checking |
| `node main.ts` and `node main.mjs` over a `.ts` static/dynamic import cycle | Both printed `loaded` |
| `node --experimental-transform-types enum.ts` | Ran, with an `ExperimentalWarning` |

## 3. Proposed `tsconfig.json` (to be added in Slice 2)

In Slice 1 this was documentation-based, because it could not be checked
without installing `typescript`; Slice 2 verified it (below). It requires
TypeScript 5.8 or newer for `erasableSyntaxOnly`.

Slice 2 (#26) added it unchanged as the root `tsconfig.json`, with
`typescript` 7.0.2 and `@types/node` 24.19.2 pinned exactly. `npm run
typecheck` (`tsc`) exits 0 and includes every `.mjs` file under `scripts/` and
`test/` plus the imported JSON files, with no errors [L].

```jsonc
{
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024"],
    "module": "nodenext",
    "types": ["node"],
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "allowJs": true,
    "checkJs": false
  },
  "include": ["scripts/**/*", "test/**/*"]
}
```

Rationale, tied to this repository:

- `erasableSyntaxOnly`, `verbatimModuleSyntax`, and
  `allowImportingTsExtensions` make `tsc` reject the syntax that Node's
  stripper rejects at runtime (section 2), so the typecheck catches it first.
  Verified in Slice 2 with `tsc` 7.0.2 [L]: `enum`, `namespace`, constructor
  parameter properties, and `<T>x` all fail with TS1294 ("This syntax is not
  allowed when 'erasableSyntaxOnly' is enabled"). A value import of an
  interface fails with TS1484 and an extensionless relative import with
  TS2835. One gap remains: `tsc` accepts `import … from "./x.js"` for a `.ts`
  file, but Node fails with `ERR_MODULE_NOT_FOUND`. Use `.ts` specifiers;
  `npm test` catches the mistake for any module that tests import.
- `strict: true` with no exceptions. `noUncheckedIndexedAccess` is added
  because the parsers index into regex matches and arrays all the time (for
  example `source[0]` at `monitor-config.mjs:54`).
- `exactOptionalPropertyTypes` is deliberately **left off**. The code sets
  `source_url: undefined` on purpose so that `JSON.stringify` drops the key
  (`scan-vinted.mjs:478`). The types model
  this as `source_url?: string`, and the flag would add noise without catching
  a real defect.
- `forceConsistentCasingInFileNames` is on because development happens on
  Windows (case-insensitive) while CI runs on `ubuntu-latest`.
- `skipLibCheck` avoids typechecking the `.d.ts` files of `cheerio`, `undici`,
  and `node-fetch`.
- Add `typecheck: "tsc"` to the `package.json` scripts.

**JS/TS coexistence.** `allowJs: true` with `checkJs: false` lets `.ts` files
import not-yet-migrated `.mjs` files during the transition. The cost is that
types imported from those files are loose (`any`-like). Slice 2 confirmed this
[L]: `tsc` infers a return type for `extractPriceInfo` from
`zalando-price.mjs`, but its unannotated parameters are `any`, so
`current_price` is `any` and assigning it to a `boolean` is not reported.
Because migration goes leaf-first, `.ts` code rarely imports `.mjs`. In the
other direction, `.mjs` code importing `.ts` works at runtime [L] and is
simply not typechecked. Slice 8 removes `allowJs`. Never keep a `.mjs` and a
`.ts` with the same basename: rename each file with `git mv` and update all of
its importers in the same change.

## 4. Migration order mapped to #24 Slices 2–8

The order follows the dependency map in section 1. Renaming a module means
changing every importer's specifier, tests included, in the same slice, because
specifiers carry the extension. Tests may stay `.mjs` until Slice 7, since
`.mjs` can import `.ts`.

| Slice | Modules (source files) | Also must change in the same slice | Adjustment to #24 and reason |
| --- | --- | --- | --- |
| 2 Infrastructure | none migrated; add a test-only `test/typescript-runtime.test.ts` that imports a `.mjs` lib | `package.json` (devDeps, `typecheck`), `tsconfig.json` | As in #24. Pin exact devDependency versions (section 7) |
| 3 Contracts + monitor/status modules | `scripts/lib/scan-status.mjs` first; then, as one unit, `monitor-config.mjs`, `vinted-monitor.mjs`, `zalando-monitor.mjs`, `validated-monitor-loader.mjs` | Importers: `scan-{vinted,zalando}.mjs`, the pagination investigation script (deleted in Slice 7), `monitor-enabled.mjs`, and the tests importing them | **Changed.** Contract types are defined together with the module that produces them, so the compiler checks them against real code. A standalone types file would have no consumer to check against. The monitor modules move together because of the static/dynamic import cycle |
| 4 Small shared modules | `scripts/lib/zalando-price.mjs` | `scan-zalando.mjs`, `test/zalando-price.test.mjs` | **Shrunk.** The only leaf not migrated in Slice 3. Can be merged into Slice 6 |
| 5 Vinted | `scripts/scan-vinted.mjs` (plus `VintedSnapshot`/`VintedProduct` types) | `.github/workflows/daily-vinted.yml` run line, `README.md`, `test/vinted-scan.test.mjs` import | **Changed.** The workflow path changes here, not in Slice 8 (section 7) |
| 6 Zalando | `scripts/scan-zalando.mjs` (plus `ZalandoSnapshot`/`ZalandoProduct` types) | `daily-zalando.yml`, `README.md`, `test/zalando-scan.test.mjs`, **and** the pagination investigation script, which imported `./scan-zalando.mjs` | **Changed**, for the same reason. The investigation script had to be edited even though Slice 7 later deleted it |
| 7 Remaining code and tests | `monitor-enabled.mjs` (with both workflow lines and `test/monitor-enabled.test.mjs:16`); the pagination investigation script **deleted** with its test, `package.json` script, and README section (decision in section 7); test files to `.test.ts` | Whatever path references the renames touch | **Shrunk.** The deprecated direct scanner removed in #27 is not migrated, and the investigation script is deleted rather than migrated |
| 8 Cleanup | Remove `allowJs`/`checkJs`, check no `.mjs` remains on active paths, update `AGENTS.md` and docs | — | **Shrunk.** Workflows are already updated in 5–7, and no removed-scanner code is left to freeze or migrate |

## 5. Contract types worth making explicit

Each type is exported from the module that produces it. Use string-literal
unions, not enums, and add no universal product type, because
`docs/output-contract.md` states that the "contract does not define a
universal product schema".

| Type | Grounded in | Runtime guard that stays |
| --- | --- | --- |
| `MonitorSource = "vinted" \| "zalando"` | `KNOWN_SOURCES`, `monitor-config.mjs:4` | `KNOWN_SOURCES.has` |
| `MonitorEnvelope` (`id`, `source`, `enabled`, `filters`) | `hasValidMonitor`, `monitor-config.mjs:10-21`; `config/monitors.json` | `loadMonitorConfiguration` (parse as `unknown`, then validate) |
| `VintedMonitor`, `ZalandoMonitor`, union `Monitor` discriminated by `source` | `validateVintedMonitor` (`vinted-monitor.mjs:12-23`), `validateZalandoConfiguration` (`zalando-monitor.mjs:45-72`); `validators[monitor.source]` (`validated-monitor-loader.mjs:9-20`) | The validators become `asserts monitor is …` functions with unchanged bodies |
| `ZalandoScanPlan` | Return value at `zalando-monitor.mjs:86-93` | Produced only from validated input |
| `PageResult` (input) and `ScanStatus` / `ScanFailure` (output) | `createScanStatus`, `scan-status.mjs:68-88`; `scan_status` table in `docs/output-contract.md` | `validateVintedOutput` / `validateZalandoOutput` invariants |
| `VintedSnapshot`, `VintedProduct` | Output literal and `validateVintedOutput` in `scan-vinted.mjs` (lines 488-567, 735-772); Vinted tables in `docs/output-contract.md` | `validateVintedOutput` before publication |
| `ZalandoSnapshot`, `ZalandoProduct` | `validateZalandoOutput` (`scan-zalando.mjs:377`) and the output literal; Zalando tables in `docs/output-contract.md` | `validateZalandoOutput` |
| `ZalandoPriceInfo`, with `discount_status` `"explicit-discount" \| "explicit-discount-no-price" \| "calculated-from-prices" \| "no-discount-found"` and `currency` `"DKK" \| null` | `zalando-price.mjs:50-134`; Zalando `currency` row in the contract | Parser rules |
| `ScanResult = { skipped: boolean }` | `scan()` returns in `scan-vinted.mjs`, `scan-zalando.mjs` | — |
| Narrow injected ports: `FetchLike` (needs only `ok`, `status`, `text()`), `FsLike` (`mkdir`, `writeFile`, `rename`, optional `rm`, `readFile`), `Logger` (`log`, `error`) | `scan()` parameters (`scan-vinted.mjs:590`, `scan-zalando.mjs:550`); test doubles such as `{ ok: true, async text() {…} }` (`test/vinted-scan.test.mjs:114`) | — |
| A retailer request error carrying `retailerRequestFailure` and `retryable` | `scan-vinted.mjs:28-39,157`; `scan-zalando.mjs:34-43` | Behaviour unchanged. An `Error` subclass is erasable syntax |

Types never replace these runtime guards: `JSON.parse` of the config, JSON-LD,
and previous snapshots; the monitor validators; the output validators; the
URL, host, and image checks; and the `apiKey` presence check. The local
experiment confirms that Node executes ill-typed code without complaint.

## 6. Expected strictness hotspots

- **Implicit `any`.** No parameter in the codebase is annotated. The
  destructured `options = {}` defaults (`monitor-config.mjs:75`, all `load*`
  functions) and the cheerio callbacks `(_, anchor)` need types.
- **Nullability.** `.attr()` returns `string | undefined` (dozens of call
  sites in the scanners). Other cases: `match?.[1]`, `selectEnabledMonitor`
  returning `null`, and `noUncheckedIndexedAccess` on `source[0]`. Also `[...monitorIds].at(-1) > monitor.id`
  (`scan-vinted.mjs:529`).
- **Untyped JSON.** `JSON.parse` returns `any`, which `strict` does **not**
  flag. Annotate each result as `unknown` explicitly (`monitor-config.mjs:30`,
  `scan-vinted.mjs:374`). JSON imports in
  tests infer widened types (for example `site: string`), so they will not
  satisfy literal-typed snapshot types without a runtime check.
- **Catch variables.** `useUnknownInCatchVariables` (part of `strict`) affects
  `error.retryable` (`scan-vinted.mjs:157`) and `error?.retailerRequestFailure`.
  `safeErrorDiagnostic` already accepts `unknown`.
- **Cheerio values.** Helpers take `$` and nodes (`findProductContainer`,
  `extractImage`, `visibleText`), so they need `CheerioAPI` and
  `Cheerio<AnyNode>`/`Element` types from cheerio's bundled declarations.
- **Env vars and argv.** `process.env.SCRAPINGANT_API_KEY` is
  `string | undefined` and already guarded. `process.argv[2]` in
  `monitor-enabled.mjs:4` is passed unchecked as a source. Runtime validation
  in `selectEnabledMonitors` covers it, but the type must be narrowed or
  declared `string | undefined`.
- **Config.** The `validators[monitor.source]` index
  (`validated-monitor-loader.mjs:16`) only typechecks after the envelope is
  narrowed to `MonitorSource`.
- **Injected fetch and fs.** node-fetch's full `fetch` type would force casts
  in tests that pass partial doubles. The narrow structural ports in section 5
  avoid `as unknown as`. The optional call `fsImpl.rm?.(…)`
  (`scan-vinted.mjs:585`) belongs in `FsLike` as an optional member.

## 7. Risks

| Risk | Evidence | Mitigation (decision owner) |
| --- | --- | --- |
| New dev tooling with no lockfile | `package.json` has caret ranges; workflows run `npm install`, which also installs devDependencies; `docs/security.md` says to commit a lockfile and use `npm ci` once deterministic CI is added | Slice 2: pin exact `typescript` and `@types/node` versions. Committing `package-lock.json` and switching workflows to `npm ci` changes CI install semantics and needs a **human decision** in Slice 2. Dev tooling cannot change scan behaviour, because scans never load it. But a failed devDependency install would still fail the scan job (the last known-good snapshot is kept). Using `npm install --omit=dev` in the scan workflows is an option for that Slice 2 decision. **Resolved (#26):** decided and done. `package-lock.json` is committed; CI and the three scan workflows use plain `npm ci` with devDependencies installed; `--omit=dev` is deferred until runtime dependency needs are verified. Trade-off: transitive fixes (for example `undici`) now arrive only through deliberate lockfile updates |
| Test discovery after renames | Default `node --test` runs both `.test.ts` and `.test.mjs`, and any non-test `.ts`/`.mjs` under `test/` [L] | Keep the `.test.ts` suffix. Never leave both forms of one test. Put no helpers in `test/` without accounting for discovery. Compare the **test count** (the previous slice's count plus new tests), not just "0 fail" |
| Workflow paths must change in the same slice as the file they invoke | Section 1 invocations. `npm test` does not exercise workflows. A stale path makes the scheduled job fail, and the last known-good snapshot is kept (`docs/output-contract.md`), so the failure is safe but silent until someone looks | In each renaming slice: `grep -rn "<old>.mjs" .github package.json README.md test scripts` must return nothing. Run `node scripts/monitor-enabled.<ext> <source>` locally (reads config only, no network). A manual `workflow_dispatch` is a live scan and needs **human approval** |
| Types are not enforced anywhere automatically | No CI runs tests; Node runs ill-typed code [L] | `npm run typecheck` goes into every slice's Definition of Done. Adding a PR check workflow is a separate **human decision** (new workflow and permissions). **Resolved (#26):** `.github/workflows/ci.yml` runs `npm ci`, `npm test`, and `npm run typecheck` on `push` and `pull_request` |
| Status of the investigation script | The one-off Zalando pagination investigation script for #14 imported `scan-zalando` and had its own test. The deprecated direct scanner, disabled since #15, was removed in #27 and is no longer part of this decision | Options for **Slice 7**: (a) migrate; (b) freeze as `.mjs` (works at runtime by importing migrated `.ts` modules, is not typechecked, and needs `allowJs` kept or the files excluded); (c) remove. **Resolved (#32):** owner decision on 2026-10-16 to delete it in Slice 7, with its test (3 tests), `package.json` script, and README section. #14 is closed, no workflow used the script, and it published no deals; it remains in git history |
| Node 24 minor drift | `setup-node` `"24"` floats; `engines` is `>=24` | Type stripping has been on by default since v23.6 [D], so every 24.x has it. Re-check the stability notes for Node 24 in Slice 2 [D]. **Slice 2 (#26):** on v24.18.0, `process.features.typescript` is `"strip"` and `npm test` (including the `.ts` test) printed no `ExperimentalWarning` [L]. Node's documented stability label for type stripping was **not** re-checked; this is deferred to a later slice |
| TypeScript major-version defaults | TS majors may change defaults [D] | Every relevant option is explicit in `tsconfig.json` |

## 8. Rollback and verification per slice

Rollback: every slice is one revertable commit, or a short series of them, made
of `git mv` renames, specifier updates, and type annotations. No slice changes
`public/deals/*.json`, the output contract, or runtime dependencies, so
`git revert` fully restores behaviour. If a workflow path breaks after merge,
the scan fails before publication, the last known-good snapshot stays, and a
revert fixes it.

| Slice | Verification |
| --- | --- |
| All | `npm test` count equals the previous count plus any intentional new tests, with 0 fail; `npm run typecheck` is clean (from Slice 2 on); `git diff --check`; no `any`, `as unknown as`, or `@ts-ignore` added without a stated reason; no live scans |
| 2 | Typecheck runs. `test/typescript-runtime.test.ts` is discovered (count 123). In a scratch check, confirm with `tsc` which of `enum`, `namespace`, parameter properties, and `<T>x` it rejects. Record any syntax that only Node rejects. **Done (#26):** 123 pass; a deliberate `const n: number = "…"` fails `npm run typecheck` (TS2322); `tsc` rejects all four constructs (section 3); only Node rejects `.js` specifiers for `.ts` files. `npm ci` from a clean `node_modules` leaves `package-lock.json` unchanged and fails when the lockfile is out of sync. The `CI` workflow runs `npm ci`, `npm test`, `npm run typecheck`; the scan workflows use `npm ci` |
| 3 | `test/monitor-config`, `test/*-monitor`, `test/retailer-scan-status`, and `test/monitor-enabled` all pass. `node scripts/monitor-enabled.mjs vinted` prints the same line as before. No `.mjs` specifier for renamed files remains. **Done (#28):** 83 pass, typecheck clean; `monitor-enabled.mjs vinted` and `zalando` print and write the same output as before. Validators are assertion functions (`asserts monitor is VintedMonitor`) and the config is parsed as `unknown`; a scratch comparison of the old and new modules (645 calls over 23 valid and invalid configurations) found no difference in results or error messages |
| 4 | `test/zalando-price.test.mjs` and `test/zalando-scan.test.mjs` pass. **Done (#29):** 83 pass, typecheck clean; every return site is checked against `ZalandoPriceInfo`, and a scratch `const bad: boolean = result.current_price` now fails (TS2322). A scratch comparison of the old and new modules (about 20,000 inputs, test strings included) found no difference in results or key order |
| 5, 6 | Source tests and `test/output-contract.test.mjs` pass. Representative output is unchanged: in a scratch run, capture the JSON written by `scan()` with the existing fixture fetch doubles before and after, then diff (expect no difference except `checked_at` when `now` is not fixed). The workflow and README paths are updated. **Done (#30, Vinted):** 83 pass, typecheck clean; `node scripts/scan-vinted.ts` without `SCRAPINGANT_API_KEY` fails with the same error. With a fixed `now`, the JSON written for four scenarios (configured monitor, metadata parsing, merged multi-monitor provenance, partial scan) is byte-identical before and after. The injected ports accept every fetch, fs, and logger double in `test/vinted-scan.test.mjs` without casts. **Done (#31, Zalando):** 83 pass (including `test/zalando-pagination-investigation.test.mjs`), typecheck clean; `node scripts/scan-zalando.ts` without `SCRAPINGANT_API_KEY` fails with the same error. With a fixed `now`, the JSON written for eight scenarios (configured monitor, two card fixtures, three-page deduplication, two monitors, merged provenance, two paginated monitors, partial scan) is byte-identical before and after, as are the `scan()` results and logger calls apart from the output path |
| 7 | As above for whatever is migrated. Every workflow, `package.json`, and README path resolves. **Done (#32):** 80 pass (83 before, minus the 3 deleted investigation tests), typecheck clean; `git ls-files 'test/*.mjs' 'scripts/*.mjs' 'scripts/**/*.mjs'` is empty. `node scripts/monitor-enabled.ts vinted` and `zalando` write `enabled=true` and print the same line as before; an unknown or missing source still exits 1 with `Monitor source must be a known non-empty string` and writes nothing. Test doubles and inputs are typed with the production ports and monitor types; deliberately invalid inputs use `@ts-expect-error` with a reason. `output-contract.test.ts` uses its own structural snapshot view, because the fixture keeps the legacy single-monitor Zalando shape that `ZalandoSnapshot` does not describe |
| 8 | `git ls-files '*.mjs'` lists only files that Slice 7 deliberately froze. `allowJs` is removed and typecheck is still clean. Docs and `AGENTS.md` describe run, test, and typecheck |

## Learning notes (Slice 1)

- **Caught without TypeScript yet:** the experiments showed that Node runs
  `const n: number = "…"` without complaint. Type annotations are only checked
  if `tsc` runs, so the typecheck has to be an explicit gate.
- **Important modeling decision:** define each contract type next to the code
  that produces it, and model injected dependencies as narrow structural ports
  (`FetchLike`), not as library types. Tests can then keep passing partial
  doubles without casts.
- **Where static types cannot help:** config, ScrapingAnt HTML, JSON-LD, and
  previous snapshots stay untrusted, and `JSON.parse` returns `any` even under
  `strict`. The existing validators remain the guard, typed as assertion
  functions.
- **Trade-off:** native stripping gives exact stack traces and no build step,
  but restricts code to erasable syntax and requires explicit `.ts` import
  specifiers.
- **Concepts shown:** erasable syntax vs. transformed syntax (`enum` and
  parameter properties); `import type` together with `verbatimModuleSyntax`.
