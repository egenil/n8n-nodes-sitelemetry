# n8n verified community node: submission text

Form: the "Submit your community node" page in the n8n docs
(<https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/>).
Submitted by the owner with the Sitelemetry contact address. Prerequisites checked on
2026-09-21: `n8n-nodes-sitelemetry@0.1.0` is on npm with provenance, and
`npx @n8n/scan-community-package n8n-nodes-sitelemetry` passes every stage
(provenance, attested source, tarball analysis) on the repository's Linux runner
(workflow "n8n package scan").

| Field | Value |
| --- | --- |
| npm package | `n8n-nodes-sitelemetry` |
| Version | 0.1.0 |
| Repository | https://github.com/egenil/n8n-nodes-sitelemetry |
| License | MIT |
| Author / contact | Sitelemetry, support@sitelemetry.com |
| Website | https://sitelemetry.com |
| Category | Development / Security / SEO |

**Short description (one paragraph)**

Sitelemetry audits websites their owners are authorized to test: security (included in the
Free plan), technical SEO, AI visibility, integrations, accessibility, performance and a full
audit on paid plans. This node runs an audit from n8n and returns the score, grade, findings
(severity, evidence, impact, fix) and coverage notes as JSON, so workflows can gate a deploy,
open a ticket or post a report. Long audits are polled with the service's own poll arguments;
a pre-execution gate (plan, allowance, target verification) is returned as a structured
`action_required` status instead of an error. The node speaks the public Sitelemetry MCP
endpoint over n8n's HTTP helpers with an API key credential; it has no runtime dependencies,
no file-system, process or eval usage, and is usable as an AI agent tool.

**Operations**

- Audit → Run: target, audit kind (security, seo, ai_visibility, integrations, accessibility,
  performance, full), optional security profile, wait for the result (with a timeout).
- Audit → Get Status: job id plus target, for workflows that poll themselves.

**Credential**

`Sitelemetry API`: API key (password field) and base URL (default https://sitelemetry.com).
The credential test performs the MCP `initialize` handshake. Keys come from the Sitelemetry
app (https://sitelemetry.com/app); a Free account is enough for the security audit.

**Why users want it**

Site owners already automate deploys, uptime checks and reporting in n8n; this node adds an
authorized audit step with concrete fixes without running a scanner on the n8n host.
