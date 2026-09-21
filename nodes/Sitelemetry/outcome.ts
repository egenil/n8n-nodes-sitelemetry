// Turn a raw audit outcome into one normalized model that downstream nodes can
// branch on. Plan, quota and verification gates are statuses, not errors.
import type { RunOutcome } from './audit';
import { isRecord, McpHttpError, McpRpcError } from './client';
import { kindLabel, t } from './i18n';
import { APP_URL } from './links';

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const STATUSES = [
	'completed',
	'partial',
	'running',
	'blocked',
	'quota_exhausted',
	'plan_required',
	'verification_required',
] as const;
export type AuditStatus = (typeof STATUSES)[number];

export const GATE_STATUSES: readonly AuditStatus[] = [
	'quota_exhausted',
	'plan_required',
	'verification_required',
];
export const isGate = (status: AuditStatus): boolean => GATE_STATUSES.includes(status);

// Pre-execution gates the server reports as status "action_required".
const REASON_STATUS: Record<string, AuditStatus> = {
	entitlement_required: 'plan_required',
	usage_limit_reached: 'quota_exhausted',
	target_verification_required: 'verification_required',
	target_reverification_required: 'verification_required',
	verification_scope_required: 'verification_required',
	authorization_consent_required: 'verification_required',
};
const PLAN_TEXT =
	/requires (?:starter|professional|enterprise)(?: or higher)? access|not included in (?:the connected|free|the current plan|your plan)|upgrade your plan/i;
const QUOTA_TEXT = /monthly .*limit reached|allowance is exhausted|usage limit reached/i;
const VERIFY_TEXT = /ownership|verif(?:y|ied|ication)|authorization terms/i;

export function statusFromText(text: string, code: string | null): AuditStatus {
	if (code === 'PLAN_UPGRADE_REQUIRED' || PLAN_TEXT.test(text)) return 'plan_required';
	if (code === 'COMMERCIAL_USAGE_LIMIT_REACHED' || QUOTA_TEXT.test(text)) return 'quota_exhausted';
	if (VERIFY_TEXT.test(text)) return 'verification_required';
	return 'blocked';
}

export const clip = (value: unknown, max = 400): string => {
	const text = String(value ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const numberOrNull = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) ? value : null;
const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const urlOrNull = (value: unknown): string | null =>
	typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const strings = (value: unknown): string[] =>
	asArray(value).filter(
		(entry): entry is string => typeof entry === 'string' && entry.trim() !== '',
	);

function pick(object: unknown, paths: string[]): unknown {
	for (const path of paths) {
		let value: unknown = object;
		for (const key of path.split('.')) value = isRecord(value) ? value[key] : undefined;
		if (value !== undefined && value !== null) return value;
	}
	return null;
}

// Stable short hash for findings without a server-side key (FNV-1a, no crypto module).
export function hashText(text: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

export interface Finding {
	id: string;
	severity: Severity;
	title: string;
	evidence: string;
	impact: string;
	fix: string;
	category: string;
	location: string;
	pillar: string;
}

export type SeverityCounts = Record<Severity, number>;

export function normalizeFinding(raw: unknown, index = 0, locale?: string): Finding {
	const row = asRecord(raw);
	const severity = (SEVERITIES as readonly string[]).includes(String(row.severity))
		? (row.severity as Severity)
		: 'info';
	const title = clip(row.title || t(locale, 'finding.untitled'), 200);
	const id =
		typeof row.findingKey === 'string' && row.findingKey
			? row.findingKey
			: `finding-${index}-${hashText(title)}`;
	return {
		id,
		severity,
		title,
		evidence: clip(row.evidence, 1000),
		impact: clip(row.impact, 600),
		fix: clip(row.remediation || row.fix || row.recommendation, 800),
		category: clip(row.category, 80),
		location: clip(row.location || row.url || row.path, 2048),
		pillar: clip(row.pillar, 40),
	};
}

export function countBySeverity(findings: Finding[]): SeverityCounts {
	const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as SeverityCounts;
	for (const finding of findings) counts[finding.severity] += 1;
	return counts;
}

// Everything the result says was skipped, unavailable or gated. Unmeasured is not a pass.
export function notMeasuredLines(structured: Record<string, unknown>, locale?: string): string[] {
	const lines: string[] = [];
	for (const entry of asArray(structured.failedPillars)) {
		const row = asRecord(entry);
		lines.push(
			t(locale, 'notMeasured.pillarFailed', {
				pillar: String(row.pillar ?? ''),
				error: String(row.error || t(locale, 'pillar.failed')),
			}),
		);
	}
	const details = asRecord(structured.auditDetails);
	const coverage = asRecord(details.planCoverage);
	for (const entry of asArray(coverage.skippedPillars)) {
		const row = asRecord(entry);
		const key =
			row.reason === 'not_in_plan' ? 'notMeasured.pillarNotInPlan' : 'notMeasured.pillarOutOfScope';
		lines.push(t(locale, key, { pillar: String(row.pillar ?? '') }));
	}
	const skippedModules = strings(coverage.skippedSecurityModules);
	if (skippedModules.length) {
		lines.push(t(locale, 'notMeasured.modulesNotInPlan', { modules: skippedModules.join(', ') }));
	}
	// A pillar that ran but could not measure (for example Performance without
	// PageSpeed data) keeps a null score; the server marks its scope unavailable.
	const pillars = asRecord(details.pillars);
	for (const [name, pillar] of Object.entries(pillars)) {
		if (asRecord(asRecord(pillar).scope).status === 'unavailable') {
			lines.push(t(locale, 'notMeasured.pillarUnavailable', { pillar: name }));
		}
	}
	const scopes = [
		details.scope,
		...Object.values(pillars).map((pillar) => asRecord(pillar).scope),
	].filter(isRecord);
	for (const scope of scopes) {
		const needVerification = strings(scope.verificationRequiredModules);
		if (needVerification.length) {
			lines.push(
				t(locale, 'notMeasured.modulesNeedVerification', { modules: needVerification.join(', ') }),
			);
		}
		for (const entry of asArray(scope.moduleResults)) {
			const row = asRecord(entry);
			if (row.status !== 'unavailable' && row.status !== 'partial') continue;
			// The server lists the skipped or errored checks of a module as "reasons".
			const reasons = strings(Array.isArray(row.reasons) ? row.reasons : [row.reason]);
			const vars = { module: String(row.module ?? ''), status: String(row.status) };
			lines.push(
				reasons.length
					? t(locale, 'notMeasured.moduleWithReasons', {
							...vars,
							reasons: clip(reasons.join('; '), 300),
						})
					: t(locale, 'notMeasured.module', vars),
			);
		}
	}
	return [...new Set(lines)];
}

export interface AuditModel {
	kind: string;
	target: string;
	tool: string | null;
	jobId: string | null;
	status: AuditStatus;
	reason: string | null;
	heading: string;
	message: string;
	nextStep: string | null;
	score: number | null;
	grade: string | null;
	counts: SeverityCounts;
	total: number;
	returnedFindings: number;
	truncated: boolean;
	findings: Finding[];
	pillars: Record<string, unknown> | null;
	notMeasured: string[];
	plan: string | null;
	remainingScans: number | null;
	reportUrl: string | null;
	passingChecks: number | null;
	pollArguments: Record<string, unknown> | null;
	retryAfterMs: number | null;
}

export interface InterpretContext {
	kind: string;
	target: string;
	locale?: string;
	timeoutMinutes?: number;
}

function emptyModel(
	context: InterpretContext,
	tool: string | null,
	jobId: string | null,
): AuditModel {
	return {
		kind: context.kind,
		target: context.target,
		tool: tool || null,
		jobId: jobId || null,
		status: 'blocked',
		reason: null,
		heading: '',
		message: '',
		nextStep: null,
		score: null,
		grade: null,
		counts: countBySeverity([]),
		total: 0,
		returnedFindings: 0,
		truncated: false,
		findings: [],
		pillars: null,
		notMeasured: [],
		plan: null,
		remainingScans: null,
		reportUrl: null,
		passingChecks: null,
		pollArguments: null,
		retryAfterMs: null,
	};
}

// verification_required covers several server-side prerequisites; the heading and
// the next step follow the reason the server reported.
export function statusHeading(
	model: Pick<AuditModel, 'status' | 'reason'>,
	locale?: string,
): string {
	if (model.status === 'verification_required') {
		const key = `verification.${model.reason ?? ''}`;
		if (key === 'verification.authorization_consent_required') return t(locale, key);
		if (key === 'verification.target_reverification_required') return t(locale, key);
		if (key === 'verification.verification_scope_required') return t(locale, key);
	}
	return t(locale, `status.${model.status}` as `status.${AuditStatus}`);
}

export function verificationStep(
	model: Pick<AuditModel, 'status' | 'reason' | 'notMeasured'>,
	locale?: string,
): string | null {
	if (
		model.status === 'verification_required' &&
		model.reason === 'authorization_consent_required'
	) {
		return t(locale, 'step.consent', { appUrl: APP_URL });
	}
	if (
		model.status === 'verification_required' ||
		model.notMeasured.some((line) => /verification/i.test(line))
	) {
		return t(locale, 'step.verify', { appUrl: APP_URL });
	}
	return null;
}

function finalize(model: AuditModel, locale?: string): AuditModel {
	return {
		...model,
		heading: statusHeading(model, locale),
		nextStep: verificationStep(model, locale),
	};
}

export function interpretOutcome(run: RunOutcome, context: InterpretContext): AuditModel {
	const { locale } = context;
	const model = emptyModel(context, run.tool, run.jobId);
	const minutes = context.timeoutMinutes ?? 0;
	if (run.outcome === 'timeout') {
		if (run.jobId) {
			return finalize(
				{
					...model,
					status: 'running',
					reason: 'timeout',
					message: t(locale, 'timeout.running', { minutes, jobId: run.jobId }),
					// The server owns the shape of these arguments (it may normalize the
					// target or add fields), so Get Status re-sends them unchanged.
					pollArguments: run.pollArguments ?? { target: context.target, jobId: run.jobId },
				},
				locale,
			);
		}
		return finalize(
			{ ...model, reason: 'timeout', message: t(locale, 'timeout.blocked', { minutes }) },
			locale,
		);
	}
	if (run.outcome === 'cancelled') {
		return finalize({ ...model, reason: 'cancelled', message: t(locale, 'cancelled') }, locale);
	}
	if (run.outcome === 'error') {
		const { error } = run;
		if (error instanceof McpHttpError) {
			if (error.status === 401 || error.status === 403) {
				return finalize(
					{
						...model,
						reason: 'unauthorized',
						message: t(locale, 'error.unauthorized', {
							status: error.status,
							message: error.message,
						}),
					},
					locale,
				);
			}
			const status =
				error.status === 402 ? 'plan_required' : statusFromText(error.message, error.code);
			return finalize(
				{
					...model,
					status: status === 'verification_required' ? 'blocked' : status,
					reason: error.code || `http_${error.status}`,
					message: error.message,
				},
				locale,
			);
		}
		if (error instanceof McpRpcError) {
			return finalize(
				{
					...model,
					status: statusFromText(error.message, null),
					reason: `rpc_${error.code ?? 'error'}`,
					message: error.message,
				},
				locale,
			);
		}
		const message = error instanceof Error ? error.message : String(error);
		return finalize(
			{ ...model, reason: 'transport', message: t(locale, 'error.transport', { message }) },
			locale,
		);
	}

	const result = run.result || {};
	const text = (Array.isArray(result.content) ? result.content : [])
		.filter((entry) => entry?.type === 'text' && typeof entry.text === 'string')
		.map((entry) => entry.text)
		.join('\n')
		.trim();
	const structured = asRecord(result.structuredContent);
	if (structured.status === 'action_required') {
		const reason = stringOrNull(structured.reason);
		return finalize(
			{
				...model,
				status: (reason && REASON_STATUS[reason]) || 'blocked',
				reason: reason || 'action_required',
				message: text || t(locale, 'error.notStarted'),
			},
			locale,
		);
	}
	if (result.isError) {
		return finalize(
			{
				...model,
				status: statusFromText(text, null),
				reason: 'tool_error',
				message: text || t(locale, 'error.toolError'),
			},
			locale,
		);
	}
	if (structured.status === 'running') {
		const jobId = stringOrNull(structured.jobId) || run.jobId;
		const retryAfterMs = numberOrNull(structured.retryAfterMs);
		return finalize(
			{
				...model,
				status: 'running',
				reason: null,
				jobId,
				message: t(locale, 'running.message', {
					jobId,
					seconds: Math.max(1, Math.ceil((retryAfterMs ?? 2000) / 1000)),
				}),
				pollArguments: isRecord(structured.pollArguments)
					? structured.pollArguments
					: { target: context.target, jobId },
				retryAfterMs,
			},
			locale,
		);
	}

	const findings = asArray(structured.findings).map((row, index) =>
		normalizeFinding(row, index, locale),
	);
	const notMeasured = notMeasuredLines(structured, locale);
	const coverageStatus = String(structured.coverageStatus ?? '');
	const partial =
		structured.status === 'partial' ||
		structured.complete === false ||
		coverageStatus === 'partial' ||
		coverageStatus === 'unavailable' ||
		notMeasured.length > 0;
	const serverCounts = isRecord(structured.counts) ? structured.counts : null;
	const counts = countBySeverity(findings);
	if (serverCounts) {
		for (const severity of SEVERITIES) {
			counts[severity] = numberOrNull(serverCounts[severity]) ?? counts[severity];
		}
	}
	const total = numberOrNull(structured.total) ?? findings.length;
	const details = asRecord(structured.auditDetails);
	const plan =
		pick(structured, ['auditDetails.scope.plan', 'auditDetails.planCoverage.plan']) ||
		Object.values(asRecord(details.pillars))
			.map((pillar) => asRecord(asRecord(pillar).scope).plan)
			.find((value) => typeof value === 'string') ||
		null;
	return finalize(
		{
			...model,
			status: partial ? 'partial' : 'completed',
			message: text,
			score: numberOrNull(structured.score ?? structured.blended),
			grade: stringOrNull(structured.grade),
			counts,
			total,
			returnedFindings: findings.length,
			truncated: structured.findingsTruncated === true || findings.length < total,
			findings,
			pillars: isRecord(structured.pillars) ? structured.pillars : null,
			notMeasured,
			plan: typeof plan === 'string' ? plan : null,
			remainingScans: numberOrNull(
				pick(structured, [
					'usage.remaining.securityScans',
					'remainingSecurityScans',
					'allowance.remaining.securityScans',
				]),
			),
			reportUrl: urlOrNull(pick(structured, ['reportUrl', 'report.url', 'links.report'])),
			passingChecks: numberOrNull(structured.passingChecks),
		},
		locale,
	);
}

export function describeKind(locale: string | undefined, kind: string): string {
	return kindLabel(locale, kind);
}
