// Message catalogue for every user-facing string the node produces at run time.
// English is the default. To add a locale, export another catalogue with the same
// keys, list it in `locales` below and add it to the node's "Message Language"
// option in SitelemetryDescription.ts.

export const en = {
	'status.completed': 'Completed',
	'status.partial': 'Completed with partial coverage',
	'status.running': 'Running',
	'status.blocked': 'Not completed',
	'status.quota_exhausted':
		'Not run: the monthly audit allowance of the connected account is used up',
	'status.plan_required': 'Not run: this audit kind is not included in the connected plan',
	'status.verification_required': 'Not run: ownership verification of the target is required',
	'verification.authorization_consent_required':
		'Not run: the connected account must accept the current audit authorization terms',
	'verification.target_reverification_required':
		'Not run: ownership verification of the target must be renewed',
	'verification.verification_scope_required':
		'Not run: the current verification of the target does not cover the requested host-level checks',
	'step.verify':
		'Verify ownership of the target in the Sitelemetry app (DNS or HTTP challenge) to include the protected checks: {appUrl}',
	'step.consent':
		'Review and accept the current audit authorization terms for the connected account in the Sitelemetry app, then run the audit again: {appUrl}',
	'plan.quota':
		'The connected account has used its monthly audit allowance. It resets at the start of the next billing period. No audit was started and no allowance was used.',
	'plan.required':
		'The {kind} audit is not included in the plan of the connected account. No audit was started and no allowance was used.',
	'plan.free':
		'The connected account is on the Free plan: {moduleCount} public security modules and {securityScans} security scans per month.',
	'plan.freeUnknown': 'The connected account is on the Free plan.',
	'plan.remaining': 'Remaining security scans in the current period: {count}.',
	'plan.paid':
		'Paid plans include further audit kinds and security modules; see paidPlans in this output and {pricingUrl}.',
	'running.message':
		'The audit is still running as job {jobId}. Use the Get Status operation with this job ID after {seconds} seconds.',
	'timeout.running':
		'The audit did not finish within {minutes} minutes. Sitelemetry keeps running job {jobId}; use the Get Status operation with this job ID later.',
	'timeout.blocked': 'The audit did not start within {minutes} minutes.',
	cancelled: 'The workflow execution was cancelled while the audit was running.',
	'error.unauthorized': 'Sitelemetry rejected the request (HTTP {status}): {message}',
	'error.transport': 'Sitelemetry could not be reached: {message}',
	'error.toolError': 'The audit tool returned an error.',
	'error.notStarted': 'The audit was not started.',
	'error.incomplete': 'The audit is still running.',
	'error.targetMissing': 'Enter the website URL or domain to audit.',
	'error.jobIdMissing': 'Enter the job ID returned by a Run operation.',
	'error.kindUnsupported': 'Unsupported audit kind: {kind}',
	'error.gate': '{heading}. {message}',
	'kind.security': 'Security',
	'kind.seo': 'Technical SEO',
	'kind.ai_visibility': 'AI visibility',
	'kind.integrations': 'Integrations',
	'kind.accessibility': 'Accessibility',
	'kind.performance': 'Performance',
	'kind.full': 'Full',
	'notMeasured.pillarFailed': '{pillar}: {error}',
	'notMeasured.pillarNotInPlan': '{pillar}: not included in the connected plan',
	'notMeasured.pillarOutOfScope': '{pillar}: outside the connected account scope',
	'notMeasured.modulesNotInPlan': 'Security modules outside the connected plan: {modules}',
	'notMeasured.pillarUnavailable': '{pillar}: unavailable (no measurement for this target)',
	'notMeasured.modulesNeedVerification':
		'Security modules that require ownership verification of the target: {modules}',
	'notMeasured.module': 'Module {module}: {status}',
	'notMeasured.moduleWithReasons': 'Module {module}: {status} ({reasons})',
	'finding.untitled': 'Untitled finding',
	'pillar.failed': 'failed',
	'price.free': 'Free',
	'price.seePricing': 'see pricing',
	'price.monthly': '{amount}/month',
} as const;

export type MessageKey = keyof typeof en;
export type Catalogue = Partial<Record<MessageKey, string>>;

export const DEFAULT_LOCALE = 'en';
export const locales: Record<string, Catalogue> = { en };

export type MessageVars = Record<string, string | number | null | undefined>;

export function t(locale: string | undefined, key: MessageKey, vars: MessageVars = {}): string {
	const catalogue = (locale && locales[locale]) || en;
	const template: string = catalogue[key] ?? en[key] ?? key;
	return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
		const value = vars[name];
		return value == null ? '' : String(value);
	});
}

export function kindLabel(locale: string | undefined, kind: string): string {
	const key = `kind.${kind}`;
	return Object.prototype.hasOwnProperty.call(en, key) ? t(locale, key as MessageKey) : kind;
}
