// Public plan catalogue (GET /api/plans) and the neutral plan/usage facts that
// accompany a gate (plan_required, quota_exhausted) or a Free-plan result.
import { isRecord, normalizeBaseUrl, type Transport } from './client';
import { kindLabel, t } from './i18n';
import { APP_URL, PRICING_URL } from './links';
import type { AuditModel } from './outcome';

export interface PlanSummary {
	id: string;
	label: string;
	monthly: number | null;
	currency: string;
	price: string;
	auditKinds: string[];
	moduleCount: number | null;
	securityScans: number | null;
}

export function formatPrice(monthly: number | null, currency: string, locale?: string): string {
	if (monthly == null) return t(locale, 'price.seePricing');
	if (monthly === 0) return t(locale, 'price.free');
	const amount = currency === 'USD' ? `$${monthly}` : `${currency} ${monthly}`;
	return t(locale, 'price.monthly', { amount });
}

export function normalizePlans(list: unknown, locale?: string): PlanSummary[] | null {
	if (!Array.isArray(list)) return null;
	const plans: PlanSummary[] = [];
	for (const entry of list) {
		if (!isRecord(entry) || typeof entry.id !== 'string') continue;
		const price = isRecord(entry.price) ? entry.price : {};
		const commercial = isRecord(entry.commercial) ? entry.commercial : {};
		const monthly =
			typeof price.monthly === 'number' && Number.isFinite(price.monthly) ? price.monthly : null;
		const currency = typeof price.currency === 'string' ? price.currency : 'USD';
		let moduleCount: number | null = null;
		if (typeof entry.moduleCount === 'number' && Number.isFinite(entry.moduleCount)) {
			moduleCount = entry.moduleCount;
		} else if (Array.isArray(entry.modules)) {
			moduleCount = entry.modules.length;
		}
		plans.push({
			id: entry.id,
			label: typeof entry.label === 'string' ? entry.label : entry.id,
			monthly,
			currency,
			price: formatPrice(monthly, currency, locale),
			auditKinds: Array.isArray(entry.auditKinds) ? entry.auditKinds.map(String) : [],
			moduleCount,
			securityScans:
				typeof commercial.securityScans === 'number' && Number.isFinite(commercial.securityScans)
					? commercial.securityScans
					: null,
		});
	}
	return plans.length ? plans : null;
}

export async function fetchPlans(
	baseUrl: string,
	transport: Transport,
	locale?: string,
): Promise<PlanSummary[] | null> {
	try {
		const response = await transport({
			url: `${normalizeBaseUrl(baseUrl)}/api/plans`,
			method: 'GET',
			headers: { accept: 'application/json' },
			timeoutMs: 15_000,
			authenticated: false,
		});
		if (response.statusCode < 200 || response.statusCode >= 300) return null;
		let body: unknown = response.body;
		if (typeof body === 'string') body = JSON.parse(body);
		return normalizePlans(isRecord(body) ? body.plans : null, locale);
	} catch {
		return null;
	}
}

export interface PlanFacts {
	/** Plan id of the connected account when the result names it. */
	connected: string | null;
	remainingSecurityScans: number | null;
	/** Neutral explanation; null when no plan or quota context applies. */
	explanation: string | null;
	free: { securityScans: number | null; moduleCount: number | null } | null;
	/** Paid plans from the public catalogue; empty when not fetched. */
	paidPlans: PlanSummary[];
	pricingUrl: string;
	appUrl: string;
}

export const needsPlanCatalogue = (model: Pick<AuditModel, 'status' | 'plan'>): boolean =>
	model.status === 'quota_exhausted' || model.status === 'plan_required' || model.plan === 'free';

export function planFacts(
	model: Pick<AuditModel, 'status' | 'plan' | 'kind' | 'remainingScans'>,
	plans: PlanSummary[] | null,
	locale?: string,
): PlanFacts {
	const facts: PlanFacts = {
		connected: model.plan,
		remainingSecurityScans: model.remainingScans,
		explanation: null,
		free: null,
		paidPlans: [],
		pricingUrl: PRICING_URL,
		appUrl: APP_URL,
	};
	if (!needsPlanCatalogue(model)) return facts;
	const free = plans?.find((plan) => plan.id === 'free') || null;
	const paid = (plans || []).filter((plan) => plan.id !== 'free');
	const lines: string[] = [];
	if (model.status === 'quota_exhausted') {
		lines.push(t(locale, 'plan.quota'));
	} else if (model.status === 'plan_required') {
		lines.push(t(locale, 'plan.required', { kind: kindLabel(locale, model.kind) }));
	} else if (free) {
		lines.push(
			t(locale, 'plan.free', { moduleCount: free.moduleCount, securityScans: free.securityScans }),
		);
	} else {
		lines.push(t(locale, 'plan.freeUnknown'));
	}
	if (model.remainingScans != null) {
		lines.push(t(locale, 'plan.remaining', { count: model.remainingScans }));
	}
	if (paid.length) lines.push(t(locale, 'plan.paid', { pricingUrl: PRICING_URL }));
	facts.explanation = lines.join(' ');
	facts.free = free ? { securityScans: free.securityScans, moduleCount: free.moduleCount } : null;
	facts.paidPlans = paid;
	return facts;
}
