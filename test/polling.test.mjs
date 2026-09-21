import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startMockServer, TEST_API_KEY, TEST_SESSION_ID } from './mock-server.mjs';
import { audit, client, fetchTransport } from './helpers.mjs';

const { createMcpClient, McpHttpError } = client;
const { runAudit, AUDIT_TOOLS, isAuditKind, sleepWithAbort } = audit;
let server;

before(async () => {
	server = await startMockServer();
});
after(async () => {
	await server.close();
});

async function connectedClient(apiKey = TEST_API_KEY) {
	const mcp = createMcpClient({ baseUrl: server.url, transport: fetchTransport(apiKey) });
	await mcp.initialize();
	return mcp;
}

const sleeps = () => {
	const calls = [];
	return { calls, sleep: async (ms) => { calls.push(ms); } };
};

test('AUDIT_TOOLS maps every kind to its audit_* tool', () => {
	assert.deepEqual(Object.values(AUDIT_TOOLS), ['audit_security', 'audit_seo', 'audit_ai_visibility', 'audit_integrations', 'audit_accessibility', 'audit_performance', 'audit_full']);
	assert.ok(isAuditKind('security'));
	assert.equal(isAuditKind('constructor'), false);
});

test('initialize carries the Bearer key and the session id is re-sent on later calls', async () => {
	const mcp = await connectedClient();
	const tools = await mcp.listTools();
	assert.equal(tools.length, 7);
	const mcpCalls = server.calls.filter((call) => call.path === '/mcp');
	assert.ok(mcpCalls.every((call) => call.headers.authorization === `Bearer ${TEST_API_KEY}`));
	assert.equal(mcpCalls[0].body.method, 'initialize');
	assert.equal(mcpCalls[0].headers['mcp-session-id'], undefined);
	assert.equal(mcpCalls.at(-1).headers['mcp-session-id'], TEST_SESSION_ID);
	assert.equal(mcpCalls.at(-1).headers['user-agent'], 'n8n-nodes-sitelemetry/0.1.0');
	assert.ok(mcpCalls.some((call) => call.body.method === 'notifications/initialized'));
});

test('a rejected API key surfaces as McpHttpError 401 without retries', async () => {
	const mcp = createMcpClient({ baseUrl: server.url, transport: fetchTransport('wrong') });
	await assert.rejects(mcp.initialize(), (error) => error instanceof McpHttpError && error.status === 401);
	const before = server.toolCalls().length;
	const run = await runAudit({ client: mcp, kind: 'security', target: 'https://ok.example', deadline: Date.now() + 60_000, sleep: async () => {}, minWaitMs: 0 });
	assert.equal(run.outcome, 'error');
	assert.equal(run.error.status, 401);
	assert.equal(server.toolCalls().length, before + 1);
});

test('running jobs are polled with pollArguments re-sent unchanged and retryAfterMs honoured', async () => {
	const mcp = await connectedClient();
	const { calls, sleep } = sleeps();
	const before = server.toolCalls().length;
	const run = await runAudit({ client: mcp, kind: 'security', target: 'https://ok.example', profile: 'baseline', deadline: Date.now() + 60_000, sleep, minWaitMs: 10 });
	assert.equal(run.outcome, 'result');
	assert.equal(run.result.structuredContent.status, 'completed');
	assert.match(run.jobId, /^mj_/);
	// The mock answers "running" for the start call and for the first poll.
	assert.equal(run.polls, 2);
	const tool = server.toolCalls().slice(before);
	assert.equal(tool.length, 3);
	assert.deepEqual(tool[0].body.params, { name: 'audit_security', arguments: { target: 'https://ok.example', profile: 'baseline' } });
	assert.deepEqual(tool[1].body.params.arguments, { target: 'https://ok.example/', jobId: run.jobId });
	assert.deepEqual(tool[2].body.params, tool[1].body.params); // pollArguments re-sent unchanged
	assert.deepEqual(calls, [10, 10]); // server said 10ms each time; the floor is minWaitMs
});

test('profile is only sent for security and full audits', async () => {
	const mcp = await connectedClient();
	const before = server.toolCalls().length;
	await runAudit({ client: mcp, kind: 'seo', target: 'https://sync.example', profile: 'deep', deadline: Date.now() + 60_000, sleep: async () => {}, minWaitMs: 0 });
	await runAudit({ client: mcp, kind: 'full', target: 'https://sync.example', profile: 'deep', deadline: Date.now() + 60_000, sleep: async () => {}, minWaitMs: 0 });
	const tool = server.toolCalls().slice(before);
	assert.deepEqual(tool[0].body.params, { name: 'audit_seo', arguments: { target: 'https://sync.example' } });
	assert.deepEqual(tool[1].body.params, { name: 'audit_full', arguments: { target: 'https://sync.example', profile: 'deep' } });
});

test('wait=false returns the first running answer; a job id resumes the same job', async () => {
	const mcp = await connectedClient();
	const first = await runAudit({ client: mcp, kind: 'security', target: 'https://ok.example', deadline: Date.now() + 60_000, wait: false, sleep: async () => {}, minWaitMs: 0 });
	assert.equal(first.outcome, 'result');
	assert.equal(first.result.structuredContent.status, 'running');
	assert.match(first.jobId, /^mj_/);
	const before = server.toolCalls().length;
	const resume = () => runAudit({ client: mcp, kind: 'security', target: 'https://ok.example/', jobId: first.jobId, deadline: Date.now() + 60_000, wait: false, sleep: async () => {}, minWaitMs: 0 });
	// A single poll: the mock keeps the job running for one more poll, then completes it.
	const second = await resume();
	assert.equal(second.result.structuredContent.status, 'running');
	assert.equal(second.jobId, first.jobId);
	const third = await resume();
	assert.equal(third.result.structuredContent.status, 'completed');
	assert.equal(third.jobId, first.jobId);
	const tool = server.toolCalls().slice(before);
	assert.equal(tool.length, 2);
	assert.deepEqual(tool[0].body.params.arguments, { target: 'https://ok.example/', jobId: first.jobId });
	assert.deepEqual(tool[1].body.params.arguments, { target: 'https://ok.example/', jobId: first.jobId });
});

test('the deadline stops polling and reports the running job id', async () => {
	const mcp = await connectedClient();
	let clock = 1_000_000;
	const run = await runAudit({ client: mcp, kind: 'security', target: 'https://ok.example', deadline: clock + 50, now: () => clock, sleep: async (ms) => { clock += ms + 100; }, minWaitMs: 10 });
	assert.equal(run.outcome, 'timeout');
	assert.match(run.jobId, /^mj_/);
	assert.equal(run.polls, 1);
	// The hand-off keeps the arguments the server sent (it normalized the target to
	// a trailing slash), not a reconstruction from the raw target.
	assert.deepEqual(run.pollArguments, { target: 'https://ok.example/', jobId: run.jobId });
});

test('an aborted signal ends polling as cancelled', async () => {
	const mcp = await connectedClient();
	const controller = new AbortController();
	const run = await runAudit({ client: mcp, kind: 'security', target: 'https://ok.example', deadline: Date.now() + 60_000, signal: controller.signal, minWaitMs: 10, sleep: async () => { controller.abort(); } });
	assert.equal(run.outcome, 'cancelled');
	assert.match(run.jobId, /^mj_/);
	const started = Date.now();
	await sleepWithAbort(5000, AbortSignal.abort());
	assert.ok(Date.now() - started < 1000);

	// n8n's own sleepWithAbort rejects with a cancellation error when the signal
	// aborts. The wrapper must resolve instead, so a cancel while the loop is
	// waiting between polls is reported as outcome "cancelled" rather than
	// escaping runAudit as a transport error.
	const midFlight = new AbortController();
	const pending = sleepWithAbort(5000, midFlight.signal);
	const abortedAt = Date.now();
	await sleepWithAbort(20);
	midFlight.abort();
	await assert.doesNotReject(() => pending);
	assert.ok(Date.now() - abortedAt < 1000);
});

test('HTTP 429 with retry-after is retried; SSE bodies and 402 gates are decoded', async () => {
	const mcp = await connectedClient();
	const { calls, sleep } = sleeps();
	const busy = await runAudit({ client: mcp, kind: 'security', target: 'https://busy.example', deadline: Date.now() + 60_000, sleep, minWaitMs: 5 });
	assert.equal(busy.outcome, 'result');
	assert.equal(busy.result.structuredContent.status, 'completed');
	assert.deepEqual(calls, [5]);
	const sse = await runAudit({ client: mcp, kind: 'security', target: 'https://sse.example', deadline: Date.now() + 60_000, sleep, minWaitMs: 0 });
	assert.equal(sse.result.structuredContent.score, 82);
	const plan = await runAudit({ client: mcp, kind: 'seo', target: 'https://plan.example', deadline: Date.now() + 60_000, sleep, minWaitMs: 0 });
	assert.equal(plan.outcome, 'error');
	assert.deepEqual([plan.error.status, plan.error.code], [402, 'PLAN_UPGRADE_REQUIRED']);
	const quota = await runAudit({ client: mcp, kind: 'security', target: 'https://quota-rpc.example', deadline: Date.now() + 60_000, sleep, minWaitMs: 0 });
	assert.equal(quota.outcome, 'error');
	assert.equal(quota.error.name, 'McpRpcError');
});
