// Start an audit (or resume one by job id) and poll it within the time budget.
import { sleepWithAbort as sleepOrCancel } from 'n8n-workflow';

import { isRecord, McpHttpError, McpRpcError, type McpClient, type ToolResult } from './client';

export const AUDIT_TOOLS = Object.freeze({
	security: 'audit_security',
	seo: 'audit_seo',
	ai_visibility: 'audit_ai_visibility',
	integrations: 'audit_integrations',
	accessibility: 'audit_accessibility',
	performance: 'audit_performance',
	full: 'audit_full',
});

export type AuditKind = keyof typeof AUDIT_TOOLS;
export const AUDIT_KINDS = Object.keys(AUDIT_TOOLS) as AuditKind[];
export const isAuditKind = (value: unknown): value is AuditKind =>
	typeof value === 'string' && Object.prototype.hasOwnProperty.call(AUDIT_TOOLS, value);

export type RunOutcome =
	| { outcome: 'result'; tool: string; result: ToolResult; jobId: string | null; polls: number }
	| {
			outcome: 'timeout';
			tool: string;
			jobId: string | null;
			polls: number;
			/** The arguments the server last asked to re-send, kept verbatim for a resume. */
			pollArguments?: Record<string, unknown>;
	  }
	| { outcome: 'cancelled'; tool: string; jobId: string | null; polls: number }
	| { outcome: 'error'; tool: string; error: unknown; jobId: string | null; polls: number };

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

// n8n's helper owns the timer, because community nodes may not call setTimeout
// themselves. It rejects with a cancellation error as soon as the signal aborts,
// while this wait resolves instead: the polling loop re-checks the signal at the
// top of every turn and reports the run as cancelled there. Any other rejection
// is a real failure and is passed on.
export async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
	const failure = await sleepOrCancel(ms, signal).then(
		() => undefined,
		(error: unknown) => ({ error }),
	);
	if (failure && !signal?.aborted) throw failure.error;
}

export function isTransientError(error: unknown): boolean {
	if (error instanceof McpRpcError) return false;
	if (error instanceof McpHttpError) return error.status >= 500 || error.status === 408;
	return true; // DNS/network failures and request timeouts
}

export interface RunAuditOptions {
	client: McpClient;
	kind: AuditKind;
	target: string;
	profile?: string | null;
	/** Resume an accepted job instead of starting a new audit. */
	jobId?: string | null;
	/** Absolute time (ms since epoch) after which polling stops. */
	deadline: number;
	/** false: return the first "running" answer instead of polling. */
	wait?: boolean;
	sleep?: Sleep;
	now?: () => number;
	minWaitMs?: number;
	signal?: AbortSignal;
	log?: (line: string) => void;
}

const errorText = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

// The server answers long audits with status "running", a jobId and pollArguments.
// Those arguments are re-sent unchanged to the same tool until the final result.
export async function runAudit(options: RunAuditOptions): Promise<RunOutcome> {
	const {
		client,
		kind,
		target,
		profile,
		deadline,
		wait = true,
		sleep = sleepWithAbort,
		now = () => Date.now(),
		minWaitMs = 1000,
		signal,
		log = () => {},
	} = options;
	const tool = AUDIT_TOOLS[kind];
	const supportsProfile = kind === 'security' || kind === 'full';
	let jobId: string | null = options.jobId || null;
	let args: Record<string, unknown> = jobId
		? { target, jobId }
		: { target, ...(profile && supportsProfile ? { profile } : {}) };
	const remaining = () => deadline - now();
	const pause = async (ms: number) => {
		const delay = Math.min(Math.max(Number(ms) || 0, minWaitMs), Math.max(0, remaining()));
		if (delay > 0) await sleep(delay, signal);
	};
	let polls = 0;
	let transient = 0;
	let busy = 0;
	let phase = '';
	for (;;) {
		if (signal?.aborted) return { outcome: 'cancelled', tool, jobId, polls };
		// Hand back the server's own pollArguments so a later resume re-sends them
		// unchanged; only fall back to the raw target when no job was accepted.
		if (remaining() <= 0) {
			return { outcome: 'timeout', tool, jobId, polls, pollArguments: jobId ? args : undefined };
		}
		let result: ToolResult;
		try {
			result = await client.callTool(tool, args);
		} catch (error) {
			const rateLimited =
				error instanceof McpHttpError &&
				error.status === 429 &&
				error.code !== 'COMMERCIAL_USAGE_LIMIT_REACHED';
			if (rateLimited && busy++ < 40) {
				const delay = error.retryAfterMs ?? 5000;
				log(
					`Sitelemetry asked to retry later (${error.message}); waiting ${Math.ceil(delay / 1000)}s.`,
				);
				await pause(delay);
				continue;
			}
			if (isTransientError(error) && transient++ < 3) {
				log(`Transient error (${errorText(error)}); retrying.`);
				await pause(2000 * 2 ** transient);
				continue;
			}
			return { outcome: 'error', tool, error, jobId, polls };
		}
		const structured = isRecord(result.structuredContent) ? result.structuredContent : {};
		if (structured.status === 'running' && typeof structured.jobId === 'string') {
			if (jobId !== structured.jobId) {
				log(`Audit accepted as job ${structured.jobId}; polling until it completes.`);
			}
			// The server says whether the job is queued for capacity or executing.
			const first = (Array.isArray(result.content) ? result.content : []).find(
				(entry) => entry?.type === 'text' && typeof entry.text === 'string',
			);
			const line = first?.text?.split('\n')[0]?.trim() || '';
			if (line && line !== phase) {
				phase = line;
				log(`Sitelemetry: ${line}`);
			}
			jobId = structured.jobId;
			polls += 1;
			args = isRecord(structured.pollArguments) ? structured.pollArguments : { target, jobId };
			if (!wait) return { outcome: 'result', tool, result, jobId, polls };
			const retryAfter =
				typeof structured.retryAfterMs === 'number' ? structured.retryAfterMs : 2000;
			await pause(retryAfter);
			continue;
		}
		if (
			structured.status === 'action_required' &&
			structured.reason === 'audit_job_busy' &&
			wait &&
			busy++ < 10
		) {
			log('Another audit is already running for this account; retrying shortly.');
			await pause(15_000);
			continue;
		}
		return { outcome: 'result', tool, result, jobId, polls };
	}
}
