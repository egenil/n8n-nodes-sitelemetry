// Minimal MCP client over Streamable HTTP (JSON-RPC 2.0). The HTTP transport is
// injected so the same code runs inside n8n (this.helpers.httpRequest) and in
// plain Node tests against a mock server. No dependencies.

export const CLIENT_NAME = 'n8n-nodes-sitelemetry';
export const CLIENT_VERSION = '0.1.0';
export const PROTOCOL_VERSION = '2025-06-18';
export const DEFAULT_BASE_URL = 'https://sitelemetry.com';

export interface TransportRequest {
	url: string;
	method: 'GET' | 'POST';
	headers: Record<string, string>;
	body?: string;
	timeoutMs: number;
	/** true: send with the Sitelemetry credential (Bearer API key); false: anonymous. */
	authenticated: boolean;
}

export interface TransportResponse {
	statusCode: number;
	headers: Record<string, unknown>;
	/** Parsed JSON, raw text (for example an SSE stream) or empty. */
	body: unknown;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export interface JsonRpcError {
	code?: number;
	message?: string;
	data?: unknown;
}

export interface JsonRpcMessage {
	jsonrpc?: string;
	id?: number | string | null;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	error?: JsonRpcError;
}

export interface ToolContent {
	type?: string;
	text?: string;
}

export interface ToolResult {
	content?: ToolContent[];
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
}

export interface McpClient {
	readonly endpoint: string;
	initialize(): Promise<unknown>;
	listTools(): Promise<unknown[]>;
	callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export class McpHttpError extends Error {
	readonly status: number;

	readonly code: string | null;

	readonly retryAfterMs: number | null;

	constructor(status: number, body: unknown, headers: Record<string, unknown> = {}) {
		const payload = isRecord(body) ? body : {};
		const nested = isRecord(payload.error) ? payload.error : {};
		let text = `HTTP ${status}`;
		if (typeof payload.error === 'string') text = payload.error;
		else if (typeof nested.message === 'string') text = nested.message;
		else if (typeof payload.message === 'string') text = payload.message;
		super(text);
		this.name = 'McpHttpError';
		this.status = status;
		let code: string | null = null;
		if (typeof payload.code === 'string') code = payload.code;
		else if (typeof nested.code === 'string') code = nested.code;
		this.code = code;
		this.retryAfterMs = parseRetryAfter(headerValue(headers, 'retry-after'));
	}
}

export class McpRpcError extends Error {
	readonly code: number | null;

	readonly data: unknown;

	constructor(error: JsonRpcError | undefined) {
		super(typeof error?.message === 'string' ? error.message : 'JSON-RPC error');
		this.name = 'McpRpcError';
		this.code = typeof error?.code === 'number' ? error.code : null;
		this.data = error?.data;
	}
}

export function headerValue(
	headers: Record<string, unknown> | undefined,
	name: string,
): string | null {
	if (!headers) return null;
	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() !== wanted) continue;
		const first = Array.isArray(value) ? value[0] : value;
		return first == null ? null : String(first);
	}
	return null;
}

export function parseRetryAfter(raw: string | null | undefined, now = Date.now()): number | null {
	if (raw == null || raw === '') return null;
	const seconds = Number(raw);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
	const at = Date.parse(raw);
	return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

export function normalizeBaseUrl(raw: unknown): string {
	const text = typeof raw === 'string' ? raw.trim() : '';
	return (text || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

// Parse a text/event-stream body into the JSON payloads carried by its data lines.
export function parseSse(text: string): unknown[] {
	const messages: unknown[] = [];
	for (const block of String(text).split(/\r?\n\r?\n/)) {
		const data = block
			.split(/\r?\n/)
			.filter((line) => line.startsWith('data:'))
			.map((line) => line.slice(5).replace(/^ /, ''))
			.join('\n');
		if (!data.trim()) continue;
		try {
			messages.push(JSON.parse(data));
		} catch {
			// keep-alive or non-JSON event
		}
	}
	return messages;
}

// Pick the JSON-RPC response for a request id (batches and streams may carry several).
export function selectResponse(messages: unknown[], id: number | string): JsonRpcMessage | null {
	const flat: JsonRpcMessage[] = [];
	for (const entry of messages) {
		for (const message of Array.isArray(entry) ? entry : [entry]) {
			if (isRecord(message)) flat.push(message as JsonRpcMessage);
		}
	}
	const exact = flat.find((message) => message.id === id);
	if (exact) return exact;
	const responses = flat.filter((message) => 'result' in message || 'error' in message);
	return responses.length ? responses[responses.length - 1] : null;
}

function bodyText(body: unknown): string | null {
	if (typeof body === 'string') return body;
	if (ArrayBuffer.isView(body)) {
		return (body as unknown as { toString(encoding: string): string }).toString('utf8');
	}
	return null;
}

// n8n's HTTP helper hands back parsed JSON when the body is JSON and the raw text
// otherwise (for example an SSE stream); the test transport behaves the same way.
export function decodeBody(body: unknown, contentType: string | null): unknown[] {
	if (body == null) return [];
	const text = bodyText(body);
	if (text === null) return [body];
	if (!text.trim()) return [];
	if ((contentType || '').includes('text/event-stream')) return parseSse(text);
	try {
		return [JSON.parse(text)];
	} catch {
		return [{ error: text.slice(0, 300) }];
	}
}

export interface McpClientOptions {
	baseUrl: string;
	transport: Transport;
	requestTimeoutMs?: number;
}

export function createMcpClient({
	baseUrl,
	transport,
	requestTimeoutMs = 90_000,
}: McpClientOptions): McpClient {
	const endpoint = `${normalizeBaseUrl(baseUrl)}/mcp`;
	let nextId = 1;
	let sessionId: string | null = null;
	let protocolVersion: string = PROTOCOL_VERSION;

	async function post(message: JsonRpcMessage): Promise<JsonRpcMessage | null> {
		const headers: Record<string, string> = {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			'user-agent': `${CLIENT_NAME}/${CLIENT_VERSION}`,
			'mcp-protocol-version': protocolVersion,
			...(sessionId ? { 'mcp-session-id': sessionId } : {}),
		};
		const response = await transport({
			url: endpoint,
			method: 'POST',
			headers,
			body: JSON.stringify(message),
			timeoutMs: requestTimeoutMs,
			authenticated: true,
		});
		sessionId = headerValue(response.headers, 'mcp-session-id') || sessionId;
		const contentType = headerValue(response.headers, 'content-type');
		const messages = decodeBody(response.body, contentType);
		if (response.statusCode < 200 || response.statusCode >= 300) {
			const payload = messages.length ? messages[0] : { error: `HTTP ${response.statusCode}` };
			throw new McpHttpError(response.statusCode, payload, response.headers);
		}
		if (response.statusCode === 202 || !messages.length || message.id == null) return null;
		return selectResponse(messages, message.id);
	}

	async function rpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
		const response = await post({
			jsonrpc: '2.0',
			id: nextId++,
			method,
			...(params ? { params } : {}),
		});
		if (!response) throw new Error(`Empty response for ${method}.`);
		if (response.error) throw new McpRpcError(response.error);
		return response.result;
	}

	return {
		endpoint,
		async initialize() {
			const result = await rpc('initialize', {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
			});
			if (isRecord(result) && typeof result.protocolVersion === 'string') {
				protocolVersion = result.protocolVersion;
			}
			await post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => null);
			return result;
		},
		async listTools() {
			const result = await rpc('tools/list');
			return isRecord(result) && Array.isArray(result.tools) ? result.tools : [];
		},
		async callTool(name, args) {
			const result = await rpc('tools/call', { name, arguments: args });
			return isRecord(result) ? (result as ToolResult) : {};
		},
	};
}
