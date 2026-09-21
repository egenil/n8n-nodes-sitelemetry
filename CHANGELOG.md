# Changelog

## 0.1.0 - 2026-09-21

Initial release.

- Credential `Sitelemetry API` (API key as a password field, base URL defaulting to `https://sitelemetry.com`); the credential test is the MCP `initialize` handshake.
- Node `Sitelemetry`, resource Audit, operations **Run** (target, audit kind, profile, wait for result, timeout minutes) and **Get Status** (job id plus target).
- Audit kinds `security`, `seo`, `ai_visibility`, `integrations`, `accessibility`, `performance` and `full` over the hosted Sitelemetry MCP endpoint (JSON-RPC over HTTP through `this.helpers.httpRequest`, the API key applied by n8n's credential mechanism).
- Polling of long audits with the server's `pollArguments` re-sent unchanged and `retryAfterMs` honoured, bounded by the time budget and the execution cancel signal; HTTP 429 `Retry-After` and transient errors are retried.
- Normalized output: `status`, `reason`, `heading`, `message`, `nextStep`, `score`, `grade`, `counts`, `total`, `findings[]` (`id`, `severity`, `title`, `evidence`, `impact`, `fix`, `category`, `location`, `pillar`), `pillars`, `notMeasured[]`, `plan`, `links`, `jobId`, `pollArguments`, `retryAfterMs`.
- Account gates `plan_required`, `quota_exhausted` and `verification_required` are returned as statuses with a neutral explanation and links (`utm_source=n8n`, `utm_medium=integration`); the **Fail on Gate** option turns them into errors.
- Neutral plan and usage facts from the public `/api/plans` catalogue when a gate applies or the connected account is on the Free plan.
- All run-time strings come from an English message catalogue (`i18n.ts`) selected by the **Message Language** option.
- Example workflow (scheduled audit, IF on status, Slack or email), publishing guide, node:test suite against a local mock of the service.
- Lint gate mirrors `@n8n/scan-community-package`, so `npm run lint` covers the rules n8n's verification scan applies; releases are published from GitHub Actions with npm provenance, which that scan requires.
