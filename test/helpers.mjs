// Test helpers: the compiled modules, a fetch-based transport that behaves like
// n8n's httpRequest helper, and a fake IExecuteFunctions context.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dist = (file) => require(fileURLToPath(new URL(`../dist/${file}`, import.meta.url)));

export const client = dist('nodes/Sitelemetry/client.js');
export const audit = dist('nodes/Sitelemetry/audit.js');
export const outcome = dist('nodes/Sitelemetry/outcome.js');
export const plans = dist('nodes/Sitelemetry/plans.js');
export const output = dist('nodes/Sitelemetry/output.js');
export const i18n = dist('nodes/Sitelemetry/i18n.js');
export const links = dist('nodes/Sitelemetry/links.js');
export const nodeModule = dist('nodes/Sitelemetry/Sitelemetry.node.js');
export const credentialModule = dist('credentials/SitelemetryApi.credentials.js');
export const n8nWorkflow = require('n8n-workflow');

// Mirrors n8n's helper: JSON bodies come back parsed, anything else as text; with
// ignoreHttpStatusErrors the status is reported instead of thrown.
export async function n8nLikeRequest(options, apiKey = null) {
	const headers = { ...(options.headers || {}) };
	if (apiKey) headers.authorization = `Bearer ${apiKey}`;
	const response = await fetch(options.url, {
		method: options.method || 'GET',
		headers,
		body: options.body,
		signal: AbortSignal.timeout(options.timeout || 30_000),
	});
	const text = await response.text();
	let body = text;
	try {
		body = JSON.parse(text);
	} catch {
		// keep text
	}
	const responseHeaders = Object.fromEntries(response.headers.entries());
	if (!options.ignoreHttpStatusErrors && !response.ok) throw new Error(`HTTP ${response.status}`);
	if (!options.returnFullResponse) return body;
	return { statusCode: response.status, statusMessage: response.statusText, headers: responseHeaders, body };
}

export const fetchTransport = (apiKey) => async (request) => {
	const response = await n8nLikeRequest(
		{
			url: request.url,
			method: request.method,
			headers: request.headers,
			body: request.body,
			timeout: request.timeoutMs,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		},
		request.authenticated ? apiKey : null,
	);
	return { statusCode: response.statusCode, headers: response.headers, body: response.body };
};

export function fakeContext({
	params = {},
	credentials,
	items = [{ json: {} }],
	continueOnFail = false,
	signal,
}) {
	const logs = [];
	const context = {
		getInputData: () => items,
		getNodeParameter: (name, _index, fallback) => {
			if (Object.hasOwn(params, name)) return params[name];
			if (fallback !== undefined) return fallback;
			throw new Error(`Could not get parameter "${name}"`);
		},
		getCredentials: async () => credentials,
		getNode: () => ({
			id: 'node-1',
			name: 'Sitelemetry',
			type: 'n8n-nodes-sitelemetry.sitelemetry',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		continueOnFail: () => continueOnFail,
		getExecutionCancelSignal: () => signal,
		logger: {
			debug: (line) => logs.push(line),
			info: (line) => logs.push(line),
			warn: (line) => logs.push(line),
			error: (line) => logs.push(line),
		},
		helpers: {
			httpRequest: async (options) => n8nLikeRequest(options, null),
			httpRequestWithAuthentication: async function (type, options) {
				if (type !== 'sitelemetryApi') throw new Error(`Unexpected credential type ${type}`);
				return n8nLikeRequest(options, credentials.apiKey);
			},
		},
		logs,
	};
	return context;
}

export async function executeNode(options) {
	const context = fakeContext(options);
	const node = new nodeModule.Sitelemetry();
	const [items] = await node.execute.call(context);
	return { items, context };
}
