# Security

## Assets and boundaries

The principal assets are `SCRAPINGANT_API_KEY`,
`DEALRADAR_INGEST_API_KEY`, the integrity of the checked-in deal JSON, and the
integrity of the DealRadar import trigger.

Retailer HTML and ScrapingAnt responses are untrusted input. DealRadar is a
separate authenticated system and must not assume that repository data is safe
to render without escaping.

## Secrets

- Store credentials only in GitHub Actions secrets or ignored local `.env`
  files.
- Never commit credentials, print their values, or log complete ScrapingAnt
  request URLs containing the API key.
- Do not expose secrets to pull-request checks.
- Rotate a credential after suspected disclosure.

## Authentication and permissions

- Authenticate DealRadar imports with the dedicated Bearer token.
- Give pull-request checks read-only repository permissions.
- Limit `contents: write` to jobs that publish generated deal data.
- Require human review for workflow permissions, authentication, secrets, and
  endpoint changes.

## Input and output validation

- Accept product URLs only over HTTPS and only for the expected retailer host.
- Bound response size, extracted text length, product count, and numeric values.
- Do not execute retailer scripts or trust embedded JSON-LD without validation.
- Reject duplicate product URLs, invalid timestamps, inconsistent counts, and
  impossible price or discount values.
- Escape extracted text in DealRadar before rendering it as HTML.

## External failure handling

- Use request timeouts and limited retries with backoff for transient failures.
- Treat authentication failures as terminal rather than retrying indefinitely.
- Do not publish empty or partial output after required-page failures.
- Make a failed import visible and safely retryable without rerunning a scan.

## Dependencies and automation

- Commit a dependency lockfile and use `npm ci` when deterministic CI is added.
- Keep required pull-request checks independent of live retailers and secrets.
- Review dependency and GitHub Actions updates like other code changes.

## When to request security review

Perform an explicit architecture/security review when a change touches secrets,
permissions, authentication, external URLs, network behavior, parsing trust
boundaries, output contracts, publishing, or downstream import behavior.
