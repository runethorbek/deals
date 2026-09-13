# DealRadar Agent Instructions

## Repository purpose

This repository contains small Node.js scrapers for Scarosso, Vinted, and Zalando.

The scrapers:

1. Fetch retailer listing pages through ScrapingAnt.
2. Parse and normalize retailer-specific deal data.
3. Publish validated JSON snapshots under `public/deals/`.
4. Trigger the separate DealRadar import service.

Keep changes small, explicit, and proportional to this repository.

Do not move DealRadar application, persistence, cross-source, or rendering responsibilities into this repository.

---

## General engineering principles

* Inspect existing code, tests, contracts, workflows, and documentation before proposing substantial changes.
* Separate discovered facts from assumptions.
* Prefer the smallest change that satisfies the requested behavior.
* Do not introduce speculative abstractions or unrelated cleanup.
* Preserve existing behavior unless the task explicitly requires changing it.
* Treat published JSON as a repository boundary consumed by DealRadar.
* Prefer deterministic verification over confidence based on implementation reasoning alone.
* Tests passing is evidence, not proof that the requested behavior is correct.

---

# Implementation workflow

When asked to implement or fix an issue:

## 1. Verify Definition of Ready

Before changing code, inspect the issue and relevant repository context.

The issue is ready for implementation only when:

* the goal is clear;
* acceptance criteria describe observable behavior;
* relevant constraints are known;
* required product or contract decisions have been made;
* important dependencies and repository boundaries are understood;
* significant failure modes have been identified;
* there is a reasonable verification approach for both desired behavior and important failure modes.

Do not invent unresolved product, architecture, contract, or compatibility decisions.

If the issue is not ready:

* do not implement speculative behavior;
* identify the missing decision or ambiguity precisely;
* distinguish facts discovered from the repository from assumptions;
* request human input where required.

## 2. Inspect before implementing

Inspect the relevant:

* scraper;
* parser/normalizer;
* tests;
* workflow;
* published output sample;
* validators/contracts;
* documentation;
* related DealRadar behavior when the task crosses the published contract boundary.

State material assumptions before changing behavior concerning:

* published output fields;
* normalization semantics;
* scan failure behavior;
* publication behavior;
* DealRadar import expectations.

## 3. Plan the smallest change

Identify:

* the smallest implementation slice that satisfies the issue;
* the code paths that must change;
* relevant existing conventions;
* expected regression risks;
* the tests or other verification required.

Do not prescribe or introduce broader architecture changes unless they are required by the issue.

## 4. Implement

* Keep the change limited to the requested task.
* Keep parsing logic separable from network and filesystem side effects.
* Preserve source-specific behavior unless an approved contract change requires otherwise.
* Prefer safe failure over guessing when input is ambiguous.
* Avoid unrelated refactoring.

## 5. Test and verify

Choose tests based on the behavior and risk rather than adding tests mechanically.

Use the lowest useful level of verification:

* unit tests for isolated normalization or domain logic;
* integration/contract tests for component or output boundaries;
* regression tests for behavior that must remain unchanged;
* focused end-to-end or smoke checks only where they provide additional evidence;
* manual inspection where automated verification would not adequately validate the behavior.

Tests must cover significant identified failure modes where practical.

Do not weaken validation or change expected behavior merely to make tests pass.

## 6. Self-check Definition of Done

Before reporting completion, verify that:

* all acceptance criteria are satisfied;
* important failure modes have been tested or otherwise verified;
* relevant regression risks have been checked;
* required tests pass;
* the final diff contains no unrelated changes;
* documentation and contracts match the implemented behavior;
* no published contract or responsibility boundary changed without approval;
* remaining unverified risks or assumptions are explicitly reported.

The implementation agent performs this as a self-check. Final confirmation of Definition of Done belongs to an independent review when requested.

## 7. Report

Report:

* files changed;
* behavior changed;
* tests/checks run and their results;
* acceptance criteria verification;
* important failure modes verified;
* remaining risks or unverified assumptions;
* any manual verification still required.

Do not commit, push, or merge unless explicitly requested.

---

# Engineering rules

## Parsing and normalization

* Keep parsing and normalization logic separable from network and filesystem side effects.
* Treat retailer HTML and extracted strings as untrusted input.
* Preserve source-specific output fields unless a contract change is approved.
* Define normalization semantics explicitly where they form part of the published contract.
* Prefer safe failure over guessing when input is ambiguous.

## Publishing

* Do not run live scrapers or update `public/deals/*.json` unless requested.
* A failed, partial, or implausible scan must not replace the last known-good published output unless explicitly specified otherwise.
* Validate output before publishing it or triggering DealRadar import.
* Published snapshots must satisfy the documented output contract.

## Security

* Never log secrets.
* Never log complete request URLs containing credentials.
* Prefer Node.js built-ins over additional dependencies when they are sufficient.

---

# Review workflow

When asked to review an implementation or issue:

## 1. Use an independent context

When practical, perform review in a separate context from implementation.

Do not rely on the implementation agent's explanation as evidence.

Use:

* the issue/specification;
* acceptance criteria;
* identified failure modes;
* the actual diff;
* relevant contracts;
* existing code and conventions;
* tests and test results;
* documentation.

## 2. First pass must be read-only

Do not modify files during the first review pass.

Attempt to determine whether the implementation is correct before proposing fixes.

## 3. Verify Definition of Done

Explicitly verify:

* each acceptance criterion;
* significant failure modes;
* test adequacy;
* regression risk;
* compatibility with published contracts;
* consistency between implementation, tests, and documentation.

Do not consider an issue complete merely because the test suite passes.

## 4. Review the actual diff

Review for:

### Correctness

* incorrect assumptions;
* edge cases;
* failure handling;
* unexpected behavior changes;
* invalid data handling.

### Regression risk

* existing behavior unintentionally changed;
* missing regression tests;
* public contract changes;
* changed scan or publication semantics.

### Test quality

* missing important tests;
* tests that mirror implementation rather than desired behavior;
* missing negative/failure cases;
* tests that would still pass if the implementation were wrong;
* excessive mocking that removes the behavior being verified.

### Design and maintainability

* unnecessary complexity;
* overengineering;
* premature abstractions;
* duplication;
* dead code;
* code smells;
* inconsistent conventions;
* responsibility leakage between `deals` and DealRadar.

### Scope

* unrelated cleanup;
* hidden feature additions;
* architectural changes not required by the issue;
* contract changes without approval.

### Security

* secret exposure;
* unsafe logging;
* authentication changes;
* untrusted input handling;
* external API failure handling.

## 5. Report findings

Report findings by severity with file and line references where possible.

Prioritize:

1. Blocking correctness or safety problems.
2. Important regressions, contract violations, or maintainability issues.
3. Minor or optional improvements.

If there are no meaningful findings, say so explicitly.

Do not manufacture findings simply to produce feedback.

---

# Human approval required

Do not make these decisions without explicit human approval:

* change published JSON schemas or semantics;
* change DealRadar import semantics;
* change repository responsibility boundaries;
* weaken validation or failure thresholds;
* change secrets or authentication;
* change repository permissions;
* change external endpoints;
* change scraper schedules;
* add a new external service;
* introduce a major architectural abstraction;
* merge a pull request.

---

# GitHub issue access

When asked to read a GitHub issue:

* Use `gh` as the source of truth.
* Do not attempt `gh` inside the sandbox.
* Use the approved host execution path directly.
* Read-only GitHub commands such as `gh issue view` and `gh issue list` may be used without asking first when permitted by Codex rules.

When asked to create or modify a GitHub issue:

* Use `gh` for the requested GitHub write operation.
* Do not attempt `gh` inside the sandbox.
* Request permission before executing the write operation unless the user explicitly requested that exact operation and the Codex permission system already allows it.
* Before execution, state briefly what will change on GitHub.
* Do not modify additional issues beyond the explicit request.
* After execution, report the issue number and the change performed.
