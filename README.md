# n8n-nodes-sitelemetry

An [n8n](https://n8n.io) community node for [Sitelemetry](https://sitelemetry.com) website audits. It runs a security, technical SEO, AI visibility, integrations, accessibility, performance or full audit of a website you own, polls long audits until they finish and returns one normalized item per audit: status, score, grade, severity counts, findings with evidence and fixes, what was not measured, and neutral plan and usage facts. Downstream nodes branch on `status`.

The node is a thin client of the hosted Sitelemetry MCP endpoint. It has no runtime dependencies and sends only the target URL and the audit options you configure.

- [Install](#install)
- [Credentials](#credentials)
- [Ownership and authorization](#ownership-and-authorization)
- [Operations](#operations)
- [Output](#output)
- [Branching on status](#branching-on-status)
- [Plans and quota](#plans-and-quota)
- [Polling and time budget](#polling-and-time-budget)
- [What the node sends and stores](#what-the-node-sends-and-stores)
- [Translations](#translations)
- [Development](#development)

## Install

Community nodes are available on self-hosted n8n instances (and on n8n Cloud once a node is verified by n8n).

1. Open **Settings > Community nodes** in your n8n instance.
2. Select **Install**, enter `n8n-nodes-sitelemetry` as the npm package name, accept the risk notice and select **Install**.
3. The **Sitelemetry** node appears in the node panel. Search for "Sitelemetry".

Manual install (for example in a Docker image or a custom extensions folder):

```sh
cd ~/.n8n/nodes
npm install n8n-nodes-sitelemetry
```

Then restart n8n. The official guide is at <https://docs.n8n.io/integrations/community-nodes/installation/>.

## Credentials

Create a **Sitelemetry API** credential:

| Field | Description |
| --- | --- |
| API Key | Your Sitelemetry MCP API key. Sign in at <https://sitelemetry.com/app> (a Free account is enough to start), open **API key** and copy it. Stored encrypted by n8n; the node never writes it to the output or the log. |
| Base URL | `https://sitelemetry.com` unless you were told to use another host. |

The credential test performs the MCP `initialize` handshake with the key. A rejected key is reported as such.

## Ownership and authorization

Audit only websites you own or are explicitly authorized to test. Every audit is performed by Sitelemetry against the live target and is recorded on the connected account.

An unverified target on the Free plan runs the public posture checks (DNS and email posture, domain registration, TLS, HTTP headers, HTTPS/MITM posture, technology fingerprint). The additional checks included in your plan, such as HTTP methods, exposed files and API surfaces, require ownership verification of the domain (DNS or HTTP challenge) in the app: <https://sitelemetry.com/app>. When a result leaves checks unmeasured for this reason, the output lists them under `notMeasured`, `status` is `partial` and `nextStep` names the verification step. Unmeasured checks are not passes.

Protected checks on a verified target also require that the connected account has accepted the current Sitelemetry audit authorization terms. When the server reports that this is missing, the node returns `status: verification_required` with the missing step in `heading` and `nextStep`. No audit is started and no allowance is used in that case.

## Operations

Resource **Audit**.

### Run

Starts an audit and, by default, waits for the result.

| Parameter | Default | Description |
| --- | --- | --- |
| Target | | Website URL or domain to audit. |
| Audit Kind | Security | `security`, `seo`, `ai_visibility`, `integrations`, `accessibility`, `performance` or `full` (all pillars with one blended score). Kinds other than Security must be included in the connected plan. |
| Profile | Account default | Security depth profile (`passive`, `baseline`, `deep`, `all`) for Security and Full audits; must be included in the connected plan. |
| Wait for Result | on | Poll the audit until it finishes. When off, a long audit returns `status: running` with a `jobId` for **Get Status**. |
| Timeout (Minutes) | 20 | Total time budget for starting and polling. When it runs out, the audit keeps running on the Sitelemetry side and the node returns `status: running` with the `jobId`. |

### Get Status

Fetches the current result of a job that was started earlier (one poll, no waiting).

| Parameter | Description |
| --- | --- |
| Target | The same target the job was started with (as returned in `pollArguments.target`). |
| Audit Kind | The audit kind of the job. |
| Job ID | The `jobId` returned by **Run**. |

While the job is still running the item has `status: running` and `retryAfterMs`; a **Wait** node followed by another **Get Status** completes the loop. Polling a running job does not start another audit and does not use more allowance.

### Options

| Option | Default | Description |
| --- | --- | --- |
| Fail on Gate | off | Stop with an error when the account gate prevents the audit (`plan_required`, `quota_exhausted`, `verification_required`) instead of returning that status as data. |
| Include Raw Result | off | Add the unmodified tool result under `raw`. |
| Message Language | English | Language of `heading`, `message`, `nextStep`, `notMeasured` and `plan.explanation`. |
| Request Timeout (Seconds) | 90 | Time limit for each single HTTP request. |

## Output

One item per input item:

| Field | Description |
| --- | --- |
| `status` | `completed`, `partial`, `running`, `blocked`, `quota_exhausted`, `plan_required` or `verification_required`. |
| `reason` | Server reason or error code behind the status, for example `usage_limit_reached`, `entitlement_required`, `target_verification_required`, `authorization_consent_required`, `timeout`, `unauthorized`, `tool_error`. |
| `heading` | Short status heading, for example "Completed with partial coverage". |
| `message` | The text Sitelemetry returned, or the explanation of why the audit did not run. |
| `nextStep` | What to do in the app when verification or the authorization terms are missing; otherwise `null`. |
| `kind`, `tool`, `target`, `jobId` | Audit kind, MCP tool name, target and job id (when the server assigned one). |
| `score`, `grade` | 0 to 100 (blended for `full`) and the letter grade; `null` when not measured. |
| `counts`, `total`, `returnedFindings`, `truncated`, `passingChecks` | Findings by severity (`critical`, `high`, `medium`, `low`, `info`), the total, how many are included and whether the list was truncated. |
| `findings[]` | `id`, `severity`, `title`, `evidence`, `impact`, `fix`, `category`, `location`, `pillar`. |
| `pillars` | Per-pillar score and finding count for `full` audits. |
| `notMeasured[]` | Everything the result says was skipped, unavailable or gated. |
| `plan` | `connected` (plan id when the result names it), `remainingSecurityScans`, `explanation`, `free`, `paidPlans[]`, `pricingUrl`, `appUrl`. See [Plans and quota](#plans-and-quota). |
| `reportUrl`, `links` | Full report link when the result contains one; `links.pricing` and `links.app`. |
| `pollArguments`, `retryAfterMs` | Present while `status` is `running`: what to send to **Get Status** and when. |
| `polls`, `elapsedMs`, `raw` | Number of polls, elapsed time, and the raw result when the option is on. |

### Errors

- Gates (`plan_required`, `quota_exhausted`, `verification_required`) are data, not errors, unless **Fail on Gate** is on.
- `blocked` (rejected API key, unreachable host, tool error, cancelled execution, or a time budget that ran out before the audit was accepted) throws a node error. With the node setting **On Error: Continue** the item is returned with `status: blocked` and an `error` field instead.
- `running` after the time budget is not an error: the job keeps running on the Sitelemetry side and `jobId` is set.

## Branching on status

Typical IF conditions on the Sitelemetry output:

- Audit measured: `{{ $json.status }}` equals `completed` or `partial`.
- High or critical findings: `{{ $json.counts.critical + $json.counts.high }}` is greater than 0.
- Account gate: `{{ ['plan_required', 'quota_exhausted', 'verification_required'].includes($json.status) }}` is true.
- Still running: `{{ $json.status }}` equals `running`.

[examples/scheduled-audit-workflow.json](examples/scheduled-audit-workflow.json) is an importable workflow: a weekly **Schedule Trigger** runs a security audit, an **IF** node checks whether the audit was measured, a **Slack** message summarizes the score and findings, and otherwise an **Email** carries the explanation with the pricing and app links. Import it with **Workflow > Import from File**, select your credentials and adjust the target, channel and addresses.

## Plans and quota

The public plan catalogue at `https://sitelemetry.com/api/plans` is the source of truth; the node reads it when a plan or quota gate stops an audit or when the connected account is on the Free plan, and puts the facts in `plan`. At the time of writing:

| Plan | Audit kinds | Security modules | Security scans per month |
| --- | --- | --- | --- |
| Free | security | 10 | 10 |
| Starter | full, security, seo, ai, accessibility, performance, integrations, search-console | 13 | 100 |
| Professional | same seven audit kinds | 24 | 2500 |
| Enterprise | same seven audit kinds | 27 | 25000 |

Each completed audit uses one unit of the monthly allowance; polling a running audit does not use more. When an audit kind is not included in the connected plan the node returns `status: plan_required`; when the monthly allowance is used up, `status: quota_exhausted`. No audit is started in either case. `plan.explanation` states this in plain words, `plan.remainingSecurityScans` shows the remaining allowance when the result names it, `plan.paidPlans` lists what paid plans add, and `plan.pricingUrl` / `plan.appUrl` link to <https://sitelemetry.com/pricing> and <https://sitelemetry.com/app>.

## Polling and time budget

Long audits are accepted with `status: running`, a `jobId`, `pollArguments` and `retryAfterMs`. The node re-sends `pollArguments` unchanged to the same tool, waits at least `retryAfterMs` (never less than one second) between polls, honours `Retry-After` on HTTP 429 answers, retries transient network errors a few times and stops at the time budget or when the workflow execution is cancelled. Nothing is polled after the budget; the job continues on the Sitelemetry side and can be fetched with **Get Status**.

## What the node sends and stores

- To the Sitelemetry base URL: the target URL and the audit options you configure (`auditKind`, `profile`), authenticated with the API key through n8n's credential mechanism; the public plan catalogue is read without authentication. Nothing from other nodes or the n8n instance is sent.
- In n8n: the returned item. Findings can include URLs and response details of the audited site; treat executions that contain them as you would any security report.

## Translations

All run-time strings (headings, messages, next steps, not-measured lines, plan explanations) come from the catalogue in `nodes/Sitelemetry/i18n.ts` with English defaults. To add a language, export another catalogue with the same keys, register it in `locales` and add it to the **Message Language** option in `nodes/Sitelemetry/SitelemetryDescription.ts`. The output also carries the raw server values (`status`, `reason`, counts, finding fields) so any language can be rendered downstream.

## Development

```sh
npm install
npm run build      # tsc into dist/ plus the icon and codex file
npm run lint       # the rules n8n's verification scan applies to nodes, credentials and package.json
npm test           # builds, lints, then runs node:test against a local mock of the Sitelemetry endpoint
```

To try the node in a local n8n instance without publishing, link the package into the community nodes folder:

```sh
npm run build
npm link
cd ~/.n8n/nodes && npm link n8n-nodes-sitelemetry
```

Then start n8n. Publishing steps are in [docs/PUBLISHING.md](docs/PUBLISHING.md).

Requirements: Node.js 20.15 or newer (developed on Node.js 24), n8n 1.0 or newer.

## License

MIT, see [LICENSE](LICENSE).
