import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './mock-server.mjs';
import { client, outcome, plans, output, i18n, links } from './helpers.mjs';

const { McpHttpError, McpRpcError, parseRetryAfter, parseSse, selectResponse, headerValue, normalizeBaseUrl, decodeBody } = client;
const { interpretOutcome, normalizeFinding, exitCodeFor, hashText, isGate } = outcome;
const { normalizePlans, planFacts, needsPlanCatalogue } = plans;
const { buildOutput } = output;
const { t, kindLabel } = i18n;

const context = { kind: 'security', target: 'https://ok.example', locale: 'en', timeoutMinutes: 20 };
const completed = () =>
	interpretOutcome({ outcome: 'result', tool: 'audit_security', result: fixture('security-completed.json'), jobId: 'mj_1', polls: 1 }, context);
const catalogue = normalizePlans(fixture('plans.json').plans);

test('SSE bodies, JSON-RPC batches and headers resolve correctly', () => {
	const body = ': keep-alive\n\nevent: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n\nevent: message\ndata: not-json\n\n';
	const messages = parseSse(body);
	assert.equal(messages.length, 1);
	assert.deepEqual(selectResponse(messages, 7).result, { ok: true });
	assert.equal(selectResponse([{ jsonrpc: '2.0', id: 1, result: 'a' }, { jsonrpc: '2.0', id: 2, result: 'b' }], 2).result, 'b');
	assert.equal(selectResponse([[{ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }]], 3).error.code, -32700);
	assert.equal(parseRetryAfter('5'), 5000);
	assert.equal(parseRetryAfter(null), null);
	assert.equal(headerValue({ 'Retry-After': ['12'] }, 'retry-after'), '12');
	assert.equal(headerValue(undefined, 'x'), null);
	assert.equal(normalizeBaseUrl(' https://example.test/// '), 'https://example.test');
	assert.equal(normalizeBaseUrl(''), 'https://sitelemetry.com');
	assert.deepEqual(decodeBody({ a: 1 }, 'application/json'), [{ a: 1 }]);
	assert.deepEqual(decodeBody('{"a":1}', 'application/json'), [{ a: 1 }]);
	assert.deepEqual(decodeBody(body, 'text/event-stream'), [{ jsonrpc: '2.0', id: 7, result: { ok: true } }]);
	assert.deepEqual(decodeBody('', 'application/json'), []);
	assert.deepEqual(decodeBody('plain failure', 'text/plain'), [{ error: 'plain failure' }]);
});

test('McpHttpError reads message, code and retry-after from several body shapes', () => {
	const a = new McpHttpError(402, { error: 'Not included.', code: 'PLAN_UPGRADE_REQUIRED' }, {});
	assert.deepEqual([a.message, a.code, a.status], ['Not included.', 'PLAN_UPGRADE_REQUIRED', 402]);
	const b = new McpHttpError(429, { error: { message: 'Busy', code: 'BUSY' } }, { 'retry-after': '3' });
	assert.deepEqual([b.message, b.code, b.retryAfterMs], ['Busy', 'BUSY', 3000]);
	const c = new McpHttpError(500, 'oops', {});
	assert.equal(c.message, 'HTTP 500');
});

test('interpretOutcome maps transport, plan, quota and verification outcomes to statuses', () => {
	const serverArgs = { target: 'https://ok.example/', jobId: 'mj_x' };
	const timeoutWithJob = interpretOutcome({ outcome: 'timeout', tool: 'audit_security', jobId: 'mj_x', polls: 3, pollArguments: serverArgs }, context);
	assert.deepEqual([timeoutWithJob.status, timeoutWithJob.reason], ['running', 'timeout']);
	assert.match(timeoutWithJob.message, /mj_x/);
	assert.match(timeoutWithJob.message, /20 minutes/);
	// The server's own pollArguments are handed back unchanged, not rebuilt from the raw target.
	assert.deepEqual(timeoutWithJob.pollArguments, serverArgs);
	const timeoutWithoutArgs = interpretOutcome({ outcome: 'timeout', tool: 'audit_security', jobId: 'mj_x', polls: 3 }, context);
	assert.deepEqual(timeoutWithoutArgs.pollArguments, { target: 'https://ok.example', jobId: 'mj_x' });
	const timeoutNoJob = interpretOutcome({ outcome: 'timeout', tool: 'audit_security', jobId: null, polls: 0 }, context);
	assert.deepEqual([timeoutNoJob.status, timeoutNoJob.reason], ['blocked', 'timeout']);
	const cancelled = interpretOutcome({ outcome: 'cancelled', tool: 'audit_security', jobId: null, polls: 0 }, context);
	assert.deepEqual([cancelled.status, cancelled.reason], ['blocked', 'cancelled']);

	const err = (error) => interpretOutcome({ outcome: 'error', tool: 'audit_security', error, jobId: null, polls: 0 }, context);
	const unauthorized = err(new McpHttpError(401, { error: 'Unauthorized.' }, {}));
	assert.deepEqual([unauthorized.status, unauthorized.reason], ['blocked', 'unauthorized']);
	assert.match(unauthorized.message, /HTTP 401/);
	const paymentRequired = err(new McpHttpError(402, { error: 'This feature is not included in Free.', code: 'PLAN_UPGRADE_REQUIRED' }, {}));
	assert.deepEqual([paymentRequired.status, paymentRequired.reason], ['plan_required', 'PLAN_UPGRADE_REQUIRED']);
	const quotaHttp = err(new McpHttpError(429, { error: 'Monthly security scan limit reached for this account (monthly allowance: 10).', code: 'COMMERCIAL_USAGE_LIMIT_REACHED' }, { 'retry-after': '60' }));
	assert.equal(quotaHttp.status, 'quota_exhausted');
	const quotaRpc = err(new McpRpcError({ code: -32603, message: 'Monthly security scan limit reached for this account (monthly allowance: 10).' }));
	assert.equal(quotaRpc.status, 'quota_exhausted');
	const planRpc = err(new McpRpcError({ code: -32603, message: 'The requested audit requires Starter or higher access and is not included in the connected Free account.' }));
	assert.equal(planRpc.status, 'plan_required');
	const transport = err(new Error('ECONNREFUSED'));
	assert.deepEqual([transport.status, transport.reason], ['blocked', 'transport']);
	assert.match(transport.message, /ECONNREFUSED/);

	const gate = (reason) =>
		interpretOutcome({ outcome: 'result', tool: 'audit_security', jobId: null, polls: 0, result: { content: [{ type: 'text', text: 'Audit not started.' }], structuredContent: { status: 'action_required', reason, auditExecuted: false, usageConsumed: false } } }, context);
	assert.equal(gate('entitlement_required').status, 'plan_required');
	assert.equal(gate('usage_limit_reached').status, 'quota_exhausted');
	assert.equal(gate('target_verification_required').status, 'verification_required');
	assert.equal(gate('authorization_consent_required').status, 'verification_required');
	assert.match(gate('authorization_consent_required').heading, /authorization terms/);
	assert.match(gate('authorization_consent_required').nextStep, /sitelemetry\.com\/app/);
	assert.match(gate('target_verification_required').nextStep, /DNS or HTTP challenge/);
	assert.equal(gate('audit_job_unavailable').status, 'blocked');
	const toolError = interpretOutcome({ outcome: 'result', tool: 'audit_security', jobId: null, polls: 0, result: { isError: true, content: [{ type: 'text', text: 'Error: audit failed' }] } }, context);
	assert.deepEqual([toolError.status, toolError.reason], ['blocked', 'tool_error']);

	const running = interpretOutcome({ outcome: 'result', tool: 'audit_security', jobId: 'mj_9', polls: 1, result: { content: [], structuredContent: { status: 'running', jobId: 'mj_9', pollArguments: { target: 'https://ok.example/', jobId: 'mj_9' }, retryAfterMs: 4000 } } }, context);
	assert.deepEqual([running.status, running.jobId, running.retryAfterMs], ['running', 'mj_9', 4000]);
	assert.deepEqual(running.pollArguments, { target: 'https://ok.example/', jobId: 'mj_9' });
	assert.match(running.message, /after 4 seconds/);
	assert.ok(['quota_exhausted', 'plan_required', 'verification_required'].every(isGate));
	assert.equal(isGate('completed'), false);
});

test('interpretOutcome normalizes completed, partial and full results', () => {
	const model = completed();
	assert.equal(model.status, 'completed');
	assert.equal(model.heading, 'Completed');
	assert.deepEqual([model.score, model.grade, model.total, model.plan, model.jobId], [82, 'B', 4, 'starter', 'mj_1']);
	assert.deepEqual(model.counts, { critical: 0, high: 1, medium: 1, low: 1, info: 1 });
	assert.equal(model.findings[0].fix, 'Send Strict-Transport-Security: max-age=31536000; includeSubDomains on every HTTPS response.');
	assert.equal(model.findings[2].location, '/robots.txt');
	assert.equal(model.nextStep, null);

	const free = interpretOutcome({ outcome: 'result', tool: 'audit_security', jobId: null, polls: 0, result: fixture('security-partial-free.json') }, { ...context, target: 'https://free.example' });
	assert.equal(free.status, 'partial');
	assert.equal(free.plan, 'free');
	assert.ok(free.notMeasured.some((line) => line.includes('http-methods, exposure, api-exposure')));
	assert.ok(free.notMeasured.some((line) => line.includes('Module rdap: unavailable (registry_timeout)')));
	assert.match(free.nextStep, /Verify ownership/);

	const full = interpretOutcome({ outcome: 'result', tool: 'audit_full', jobId: null, polls: 0, result: fixture('full-partial.json') }, { ...context, kind: 'full', target: 'https://full.example' });
	assert.equal(full.status, 'partial');
	assert.equal(full.score, 71);
	assert.deepEqual(Object.keys(full.pillars), ['Security', 'SEO']);
	assert.deepEqual(full.notMeasured, ['Performance: PageSpeed Insights was unavailable for this target.']);
	assert.equal(full.findings[0].pillar, 'Security');
	assert.equal(full.plan, 'professional');
	assert.equal(normalizeFinding({ title: 'x', severity: 'bogus' }, 3).severity, 'info');
	assert.match(normalizeFinding({ title: 'x' }, 3).id, /^finding-3-[0-9a-f]{8}$/);
	assert.equal(normalizeFinding({}, 0).title, 'Untitled finding');
	assert.equal(hashText('abc'), hashText('abc'));
	assert.notEqual(hashText('abc'), hashText('abd'));

	const unmeasured = interpretOutcome({ outcome: 'result', tool: 'audit_full', jobId: null, polls: 0, result: { content: [], structuredContent: {
		status: 'partial', coverageStatus: 'partial', executionComplete: true, complete: true, blended: 70, failedPillars: [], findings: [],
		pillars: { Security: { score: 70, findings: 0 }, Performance: { score: null, findings: 0 } },
		auditDetails: { pillars: {
			Security: { scope: { status: 'partial', plan: 'enterprise', moduleResults: [{ module: 'tls', status: 'unavailable', checkCount: 1, findingCount: 0, reasons: ['The TLS certificate check requires an https:// target.'] }] } },
			Performance: { scope: { status: 'unavailable', method: 'lighthouse_crux' } },
		}, planCoverage: { plan: 'enterprise', skippedPillars: [], skippedSecurityModules: [] } },
	} } }, { ...context, kind: 'full', target: 'http://127.0.0.1:8080' });
	assert.equal(unmeasured.status, 'partial');
	assert.equal(unmeasured.score, 70);
	assert.deepEqual(unmeasured.notMeasured, ['Performance: unavailable (no measurement for this target)', 'Module tls: unavailable (The TLS certificate check requires an https:// target.)']);
	assert.equal(typeof exitCodeFor, 'undefined');
});

test('plans: catalogue normalization and neutral facts with n8n utm links', () => {
	assert.equal(catalogue.length, 4);
	assert.deepEqual(catalogue.map((plan) => plan.id), ['free', 'starter', 'professional', 'enterprise']);
	assert.deepEqual([catalogue[0].price, catalogue[1].price, catalogue[0].securityScans, catalogue[0].moduleCount], ['Free', '$49/month', 10, 10]);
	assert.equal(links.PRICING_URL, 'https://sitelemetry.com/pricing?utm_source=n8n&utm_medium=integration');
	assert.equal(links.APP_URL, 'https://sitelemetry.com/app');

	const model = completed();
	assert.equal(needsPlanCatalogue(model), false);
	const none = planFacts(model, catalogue, 'en');
	assert.deepEqual([none.connected, none.explanation, none.paidPlans.length, none.pricingUrl], ['starter', null, 0, links.PRICING_URL]);

	const quota = planFacts({ ...model, status: 'quota_exhausted', plan: null, remainingScans: 0 }, catalogue, 'en');
	assert.match(quota.explanation, /monthly audit allowance/);
	assert.match(quota.explanation, /Remaining security scans in the current period: 0\./);
	assert.match(quota.explanation, /utm_source=n8n&utm_medium=integration/);
	assert.equal(quota.paidPlans.length, 3);
	assert.doesNotMatch(quota.explanation, /hurry|now|limited|act/i);

	const plan = planFacts({ ...model, status: 'plan_required', kind: 'seo' }, catalogue, 'en');
	assert.match(plan.explanation, /The Technical SEO audit is not included/);

	const free = planFacts({ ...model, status: 'partial', plan: 'free', remainingScans: null }, catalogue, 'en');
	assert.match(free.explanation, /Free plan: 10 public security modules and 10 security scans per month/);
	assert.deepEqual(free.free, { securityScans: 10, moduleCount: 10 });

	const offline = planFacts({ ...model, status: 'partial', plan: 'free' }, null, 'en');
	assert.equal(offline.explanation, 'The connected account is on the Free plan.');
	assert.equal(normalizePlans('nope'), null);
	assert.equal(normalizePlans([]), null);
});

test('i18n interpolates, falls back to English and labels kinds', () => {
	assert.equal(t('en', 'plan.remaining', { count: 3 }), 'Remaining security scans in the current period: 3.');
	assert.equal(t('xx', 'status.completed'), 'Completed');
	assert.equal(t(undefined, 'error.kindUnsupported', { kind: 'zzz' }), 'Unsupported audit kind: zzz');
	assert.equal(t('en', 'timeout.blocked', {}), 'The audit did not start within  minutes.');
	assert.equal(kindLabel('en', 'ai_visibility'), 'AI visibility');
	assert.equal(kindLabel('en', 'unknown'), 'unknown');
	for (const value of Object.values(i18n.en)) assert.doesNotMatch(value, /upgrade now|hurry|limited time/i);
});

test('buildOutput exposes a stable shape for downstream nodes', () => {
	const model = completed();
	const json = buildOutput(model, planFacts(model, catalogue, 'en'), { polls: 2, elapsedMs: 1234 });
	for (const key of ['status', 'reason', 'heading', 'message', 'nextStep', 'kind', 'tool', 'target', 'jobId', 'score', 'grade', 'counts', 'total', 'findings', 'notMeasured', 'plan', 'links', 'pollArguments', 'retryAfterMs', 'polls', 'elapsedMs']) {
		assert.ok(key in json, `missing ${key}`);
	}
	assert.equal(json.links.pricing, links.PRICING_URL);
	assert.equal('raw' in json, false);
	assert.equal('raw' in buildOutput(model, planFacts(model, null), { polls: 0, elapsedMs: 0, raw: { x: 1 } }), true);
});
