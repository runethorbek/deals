# DealRadar Agent Instructions

## Scope

This repository contains small Node.js scrapers that fetch retailer listing
pages through ScrapingAnt, extract deal data, write JSON under `public/deals/`,
and trigger the separate DealRadar import service.

Keep changes narrow and proportional to this repository.

## Working process

1. Read the relevant scraper, workflow, output sample, and documentation before
   editing.
2. State assumptions before changing output fields, scan failure behavior, or
   downstream import behavior.
3. Add or update deterministic tests when parser behavior changes.
4. Run the repository checks that apply to the change.
5. Inspect the final diff for unrelated changes, especially generated JSON.
6. Report checks run, remaining risks, and any manual verification needed.

## Implementation rules

- Keep parsing logic separable from network and filesystem side effects.
- Do not run live scrapers or update `public/deals/*.json` unless requested.
- Treat retailer HTML and extracted strings as untrusted input.
- Never log secrets or complete request URLs containing credentials.
- Preserve source-specific output fields unless a contract change is approved.
- Prefer Node.js built-ins over new dependencies when they are sufficient.
- A failed or implausible scan must not replace the last known good output.
- Validate output before publishing or triggering the DealRadar import.

## Review rules

Use a separate Codex context or review agent for independent review. On its
first pass, the reviewer should not edit files. It should inspect the task,
diff, relevant contracts, and checks, then report findings by severity with
file and line references.

Review for correctness, regressions, edge cases, maintainability, data flow,
secret handling, authentication, input validation, external API failure modes,
and whether responsibilities belong in the scraper or DealRadar service.

## Human approval required

Obtain human approval before:

- changing published JSON schemas or DealRadar import semantics;
- changing secrets, authentication, repository permissions, or endpoints;
- weakening validation or scan failure thresholds;
- changing schedules or adding an external service; or
- merging a pull request.
