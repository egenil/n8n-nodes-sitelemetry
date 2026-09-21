import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startMockServer, TEST_API_KEY } from './mock-server.mjs';
import { credentialModule, executeNode, n8nWorkflow, nodeModule } from './helpers.mjs';

const { NodeOperationError } = n8nWorkflow;
const root = (file) => fileURLToPath(new URL(`../${file}`, import.meta.url));
let server;
const creds = () => ({ apiKey: TEST_API_KEY, baseUrl: `${server.url}/` });
const run = (params, extra = {}) =>
	executeNode({ credentials: creds(), params: { resource: 'audit', operation: 'run', auditKind: 'security', waitForResult: true, timeoutMinutes: 1, ...params }, ...extra });

before(async () => {
	server = await startMockServer();
});
after(async () => {
	await server.close();
});

test('package.json n8n block points at compiled files that exist, with the icon copied', () => {
	const pkg = JSON.parse(readFileSync(root('package.json'), 'utf8'));
	assert.ok(pkg.keywords.includes('n8n-community-node-package'));
	assert.equal(pkg.license, 'MIT');
	assert.equal(pkg.n8n.n8nNodesApiVersion, 1);
	for (const file of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) assert.ok(existsSync(root(file)), `${file} missing`);
	assert.ok(existsSync(root('dist/nodes/Sitelemetry/sitelemetry.svg')));
	assert.ok(existsSync(root('dist/nodes/Sitelemetry/Sitelemetry.node.json')));
	assert.equal(pkg.dependencies, undefined, 'a community node must not ship runtime dependencies');
	assert.deepEqual(Object.keys(pkg.peerDependencies), ['n8n-workflow']);
});

test('credential and node descriptions follow the n8n conventions', () => {
	const credential = new credentialModule.SitelemetryApi();
	assert.equal(credential.name, 'sitelemetryApi');
	assert.equal(credential.displayName, 'Sitelemetry API');
	const apiKey = credential.properties.find((property) => property.name === 'apiKey');
	assert.equal(apiKey.typeOptions.password, true);
	assert.equal(credential.properties.find((property) => property.name === 'baseUrl').default, 'https://sitelemetry.com');
	assert.equal(credential.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}');
	assert.deepEqual([credential.test.request.method, credential.test.request.url, credential.test.request.body.method], ['POST', '/mcp', 'initialize']);
	assert.equal(credential.test.rules[0].properties.value, 401);

	const node = new nodeModule.Sitelemetry();
	const { description } = node;
	assert.equal(description.name, 'sitelemetry');
	assert.equal(description.icon, 'file:sitelemetry.svg');
	assert.deepEqual(description.credentials, [{ name: 'sitelemetryApi', required: true }]);
	assert.equal(description.usableAsTool, true);
	const names = description.properties.map((property) => property.name);
	assert.deepEqual(names, ['resource', 'operation', 'target', 'auditKind', 'jobId', 'profile', 'waitForResult', 'timeoutMinutes', 'options']);
	const kinds = description.properties.find((property) => property.name === 'auditKind').options.map((option) => option.value).sort();
	assert.deepEqual(kinds, ['accessibility', 'ai_visibility', 'full', 'integrations', 'performance', 'security', 'seo']);
	const options = description.properties.find((property) => property.name === 'options').options.map((option) => option.name);
	assert.deepEqual(options, ['failOnGate', 'includeRaw', 'locale', 'requestTimeoutSeconds']);
	const source = readFileSync(root('dist/nodes/Sitelemetry/Sitelemetry.node.js'), 'utf8');
	assert.doesNotMatch(source, /process\.env|require\(["']fs["']\)|child_process/);
});

test('Run with wait: running job is polled to completion and normalized', async () => {
	const { items, context } = await run({ target: 'https://ok.example', profile: 'baseline' });
	assert.equal(items.length, 1);
	const json = items[0].json;
	assert.deepEqual(items[0].pairedItem, { item: 0 });
	assert.deepEqual([json.status, json.heading, json.score, json.grade, json.total, json.kind, json.tool], ['completed', 'Completed', 82, 'B', 4, 'security', 'audit_security']);
	assert.equal(json.counts.high, 1);
	assert.match(json.jobId, /^mj_/);
	assert.equal(json.findings.length, 4);
	assert.deepEqual(Object.keys(json.findings[0]), ['id', 'severity', 'title', 'evidence', 'impact', 'fix', 'category', 'location', 'pillar']);
	assert.equal(json.plan.connected, 'starter');
	assert.equal(json.plan.explanation, null);
	assert.equal(json.plan.pricingUrl, 'https://sitelemetry.com/pricing?utm_source=n8n&utm_medium=integration');
	assert.equal(json.links.app, 'https://sitelemetry.com/app');
	assert.equal(json.polls, 2); // the mock answers "running" twice before the result
	assert.ok(json.elapsedMs >= 0);
	assert.equal('raw' in json, false);
	assert.ok(context.logs.some((line) => /Audit accepted as job/.test(line)));
	const tool = server.toolCalls().slice(-3);
	assert.deepEqual(tool[0].body.params.arguments, { target: 'https://ok.example', profile: 'baseline' });
	assert.deepEqual(tool[1].body.params.arguments, { target: 'https://ok.example/', jobId: json.jobId });
	assert.deepEqual(tool[2].body.params.arguments, { target: 'https://ok.example/', jobId: json.jobId });
	assert.ok(server.calls.filter((call) => call.path === '/mcp').every((call) => call.headers.authorization === `Bearer ${TEST_API_KEY}`));
});

test('Run without wait returns running with a job id; Get Status resumes it', async () => {
	const first = await run({ target: 'https://ok.example', waitForResult: false });
	const started = first.items[0].json;
	assert.deepEqual([started.status, started.reason], ['running', null]);
	assert.match(started.jobId, /^mj_/);
	assert.deepEqual(started.pollArguments, { target: 'https://ok.example/', jobId: started.jobId });
	assert.equal(started.retryAfterMs, 10);
	assert.match(started.message, /Get Status/);

	const getStatus = () =>
		executeNode({ credentials: creds(), params: { resource: 'audit', operation: 'getStatus', auditKind: 'security', target: 'https://ok.example/', jobId: started.jobId } });
	// Get Status is one poll: the mock keeps the job running for one more poll, then completes it.
	const stillRunning = (await getStatus()).items[0].json;
	assert.deepEqual([stillRunning.status, stillRunning.jobId], ['running', started.jobId]);
	assert.deepEqual(server.toolCalls().at(-1).body.params.arguments, { target: 'https://ok.example/', jobId: started.jobId });
	const json = (await getStatus()).items[0].json;
	assert.equal(json.status, 'completed');
	assert.equal(json.jobId, started.jobId);
	assert.equal(json.score, 82);
	assert.deepEqual(server.toolCalls().at(-1).body.params.arguments, { target: 'https://ok.example/', jobId: started.jobId });
});

test('Free plan partial result carries the neutral plan facts from /api/plans', async () => {
	const plansBefore = server.plansCalls().length;
	const { items } = await run({ target: 'https://free.example' });
	const json = items[0].json;
	assert.equal(json.status, 'partial');
	assert.equal(json.heading, 'Completed with partial coverage');
	assert.equal(json.plan.connected, 'free');
	assert.match(json.plan.explanation, /Free plan: 10 public security modules and 10 security scans per month/);
	assert.equal(json.plan.paidPlans.length, 3);
	assert.equal(json.plan.paidPlans[0].id, 'starter');
	assert.ok(json.notMeasured.some((line) => /http-methods, exposure, api-exposure/.test(line)));
	assert.match(json.nextStep, /https:\/\/sitelemetry\.com\/app/);
	assert.equal(server.plansCalls().length, plansBefore + 1);
});

test('account gates are returned as statuses, not errors', async () => {
	const quota = (await run({ target: 'https://quota.example' })).items[0].json;
	assert.deepEqual([quota.status, quota.reason], ['quota_exhausted', 'usage_limit_reached']);
	assert.match(quota.heading, /allowance/);
	assert.match(quota.message, /No audit quota was used/);
	assert.match(quota.plan.explanation, /monthly audit allowance/);
	assert.equal(quota.plan.paidPlans.length, 3);
	assert.equal(quota.score, null);

	const plan = (await run({ target: 'https://plan-result.example', auditKind: 'seo' })).items[0].json;
	assert.deepEqual([plan.status, plan.reason], ['plan_required', 'entitlement_required']);
	assert.match(plan.plan.explanation, /Technical SEO audit is not included/);

	const http402 = (await run({ target: 'https://plan.example', auditKind: 'seo' })).items[0].json;
	assert.deepEqual([http402.status, http402.reason], ['plan_required', 'PLAN_UPGRADE_REQUIRED']);

	const verify = (await run({ target: 'https://verify.example' })).items[0].json;
	assert.deepEqual([verify.status, verify.reason], ['verification_required', 'target_verification_required']);
	assert.match(verify.nextStep, /DNS or HTTP challenge/);

	const consent = (await run({ target: 'https://consent.example' })).items[0].json;
	assert.equal(consent.status, 'verification_required');
	assert.match(consent.heading, /authorization terms/);
	assert.match(consent.nextStep, /accept the current audit authorization terms/);
});

test('Fail on Gate turns a gate into a NodeOperationError; continue-on-fail keeps the data', async () => {
	await assert.rejects(
		run({ target: 'https://quota.example', options: { failOnGate: true } }),
		(error) => error instanceof NodeOperationError && /allowance/.test(error.message),
	);
	const { items } = await run({ target: 'https://quota.example', options: { failOnGate: true } }, { continueOnFail: true });
	assert.equal(items[0].json.status, 'quota_exhausted');
	assert.match(items[0].json.error, /allowance/);
});

test('blocked outcomes throw NodeOperationError unless the node continues on fail', async () => {
	await assert.rejects(run({ target: 'https://error.example' }), (error) => error instanceof NodeOperationError && /audit failed/.test(error.message));
	const { items } = await run({ target: 'https://error.example' }, { continueOnFail: true });
	assert.deepEqual([items[0].json.status, items[0].json.reason], ['blocked', 'tool_error']);
	assert.match(items[0].json.error, /audit failed/);

	await assert.rejects(
		executeNode({ credentials: { apiKey: 'wrong', baseUrl: server.url }, params: { resource: 'audit', operation: 'run', auditKind: 'security', target: 'https://ok.example' } }),
		(error) => error instanceof NodeOperationError && /HTTP 401/.test(error.message),
	);
	const unauthorized = await executeNode({ credentials: { apiKey: 'wrong', baseUrl: server.url }, params: { resource: 'audit', operation: 'run', auditKind: 'security', target: 'https://ok.example' }, continueOnFail: true });
	assert.deepEqual([unauthorized.items[0].json.status, unauthorized.items[0].json.reason], ['blocked', 'unauthorized']);
	await assert.rejects(run({ target: '   ' }), (error) => error instanceof NodeOperationError && /Enter the website URL/.test(error.message));
	await assert.rejects(run({ target: 'https://ok.example', auditKind: 'nope' }), (error) => error instanceof NodeOperationError && /Unsupported audit kind/.test(error.message));
	await assert.rejects(
		executeNode({ credentials: creds(), params: { resource: 'audit', operation: 'getStatus', auditKind: 'security', target: 'https://ok.example', jobId: '' } }),
		(error) => error instanceof NodeOperationError && /job ID/.test(error.message),
	);
});

test('a cancelled execution ends as blocked/cancelled', async () => {
	const controller = new AbortController();
	controller.abort();
	const { items } = await run({ target: 'https://ok.example' }, { continueOnFail: true, signal: controller.signal });
	assert.deepEqual([items[0].json.status, items[0].json.reason], ['blocked', 'cancelled']);
});

test('several input items are processed in order with paired items and raw output on request', async () => {
	const { items } = await executeNode({
		credentials: creds(),
		items: [{ json: { site: 'a' } }, { json: { site: 'b' } }],
		params: { resource: 'audit', operation: 'run', auditKind: 'security', target: 'https://sync.example', options: { includeRaw: true } },
	});
	assert.equal(items.length, 2);
	assert.deepEqual(items.map((item) => item.pairedItem.item), [0, 1]);
	assert.equal(items[1].json.status, 'completed');
	assert.equal(items[1].json.raw.structuredContent.score, 82);
	assert.equal(server.calls.filter((call) => call.path === '/mcp' && call.body?.method === 'initialize').length >= 1, true);
});
