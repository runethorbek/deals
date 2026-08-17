# DealRadar Agent Instructions

## Repository purpose

This repository contains small Node.js scrapers for Scarosso, Vinted, and
Zalando.

The scrapers:

1. Fetch retailer listing pages through ScrapingAnt.
2. Parse retailer-specific deal data.
3. Write JSON files under `public/deals/`.
4. Trigger the separate DealRadar import service.

Keep changes small, explicit, and proportional to this repository.

---

## Implementation workflow

When asked to implement or fix something:

1. Inspect the relevant scraper, tests, workflow, output sample, and docs.
2. State assumptions before changing:
   - published output fields;
   - scan failure behavior;
   - DealRadar import behavior.
3. Keep the change limited to the requested task.
4. Add or update deterministic tests when parser behavior changes.
5. Run the relevant repository checks.
6. Inspect the final diff for unrelated changes.
7. Report:
   - files changed;
   - checks run;
   - remaining risks;
   - any manual verification needed.

Do not commit, push, or merge unless explicitly requested.

---

## Engineering rules

### Parsing

- Keep parsing logic separable from network and filesystem side effects.
- Treat retailer HTML and extracted strings as untrusted input.
- Preserve source-specific output fields unless a contract change is approved.
- Prefer safe failure over guessing when input is ambiguous.

### Publishing

- Do not run live scrapers or update `public/deals/*.json` unless requested.
- A failed or implausible scan must not replace the last known good output.
- Validate output before publishing it or triggering DealRadar import.

### Security

- Never log secrets.
- Never log complete request URLs containing credentials.
- Prefer Node.js built-ins over additional dependencies when they are sufficient.

---

## Review workflow

When asked to review:

- Use the current task, diff, relevant contracts, tests, and documentation.
- Do not modify files during the first review pass.
- Report findings by severity with file and line references.
- If there are no meaningful findings, say so explicitly.

Review for:

- correctness;
- regressions;
- edge cases;
- backwards compatibility;
- maintainability;
- data flow;
- input validation;
- secret handling;
- authentication;
- external API failure modes;
- whether the responsibility belongs in this scraper repository or DealRadar.

Independent review should use a separate Codex context when practical.

---

## Human approval required

Do not make these decisions without explicit human approval:

- change published JSON schemas;
- change DealRadar import semantics;
- change secrets or authentication;
- change repository permissions;
- change external endpoints;
- weaken validation or scan failure thresholds;
- change scraper schedules;
- add a new external service;
- merge a pull request.