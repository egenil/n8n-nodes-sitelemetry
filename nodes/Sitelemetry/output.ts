// The item returned by the node: one flat, stable object per audit.
import type { AuditModel } from './outcome';
import type { PlanFacts } from './plans';

export interface OutputExtras {
	polls: number;
	elapsedMs: number;
	raw?: unknown;
}

export function buildOutput(
	model: AuditModel,
	plan: PlanFacts,
	extras: OutputExtras,
): Record<string, unknown> {
	return {
		status: model.status,
		reason: model.reason,
		heading: model.heading,
		message: model.message,
		nextStep: model.nextStep,
		kind: model.kind,
		tool: model.tool,
		target: model.target,
		jobId: model.jobId,
		score: model.score,
		grade: model.grade,
		counts: model.counts,
		total: model.total,
		returnedFindings: model.returnedFindings,
		truncated: model.truncated,
		passingChecks: model.passingChecks,
		findings: model.findings,
		pillars: model.pillars,
		notMeasured: model.notMeasured,
		plan,
		reportUrl: model.reportUrl,
		links: { report: model.reportUrl, pricing: plan.pricingUrl, app: plan.appUrl },
		pollArguments: model.pollArguments,
		retryAfterMs: model.retryAfterMs,
		polls: extras.polls,
		elapsedMs: extras.elapsedMs,
		...(extras.raw !== undefined ? { raw: extras.raw } : {}),
	};
}
