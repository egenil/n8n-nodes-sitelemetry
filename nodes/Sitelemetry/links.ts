// Public links used in the output. The pricing link names the integration.
export const APP_URL = 'https://sitelemetry.com/app';
export const UTM_SOURCE = 'n8n';
export const UTM_MEDIUM = 'integration';

export const pricingUrl = (source = UTM_SOURCE, medium = UTM_MEDIUM): string =>
	`https://sitelemetry.com/pricing?utm_source=${encodeURIComponent(source)}&utm_medium=${encodeURIComponent(medium)}`;

export const PRICING_URL = pricingUrl();
