import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { AUDIT_TOOLS, isAuditKind, runAudit, sleepWithAbort, type RunOutcome } from './audit';
import { createMcpClient, normalizeBaseUrl, type Transport } from './client';
import { DEFAULT_LOCALE, t } from './i18n';
import { interpretOutcome, isGate } from './outcome';
import { buildOutput } from './output';
import { fetchPlans, needsPlanCatalogue, planFacts } from './plans';
import { sitelemetryProperties } from './SitelemetryDescription';

interface NodeOptions {
	failOnGate?: boolean;
	includeRaw?: boolean;
	locale?: string;
	requestTimeoutSeconds?: number;
}

// Every HTTP call goes through n8n's request helpers: the API key is applied by
// the credential's authenticate block and never enters this code.
function createTransport(context: IExecuteFunctions): Transport {
	return async (request) => {
		const options: IHttpRequestOptions = {
			url: request.url,
			method: request.method,
			headers: request.headers,
			body: request.body,
			timeout: request.timeoutMs,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		};
		const response = (
			request.authenticated
				? await context.helpers.httpRequestWithAuthentication.call(
						context,
						'sitelemetryApi',
						options,
					)
				: await context.helpers.httpRequest(options)
		) as IN8nHttpFullResponse;
		return {
			statusCode: response.statusCode,
			headers: (response.headers ?? {}) as Record<string, unknown>,
			body: response.body,
		};
	};
}

export class Sitelemetry implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sitelemetry',
		name: 'sitelemetry',
		icon: 'file:sitelemetry.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Run Sitelemetry website audits (security, SEO, AI visibility, integrations, accessibility, performance) and get normalized findings',
		defaults: {
			name: 'Sitelemetry',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'sitelemetryApi',
				required: true,
			},
		],
		properties: sitelemetryProperties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('sitelemetryApi');
		const baseUrl = normalizeBaseUrl(credentials.baseUrl);
		const transport = createTransport(this);
		const signal =
			typeof this.getExecutionCancelSignal === 'function'
				? this.getExecutionCancelSignal()
				: undefined;
		const log = (line: string) => this.logger.debug(`[Sitelemetry] ${line}`);
		let client: ReturnType<typeof createMcpClient> | null = null;
		let initialized = false;

		for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
			try {
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				const target = String(this.getNodeParameter('target', itemIndex, '')).trim();
				const kindRaw = this.getNodeParameter('auditKind', itemIndex) as string;
				const options = this.getNodeParameter('options', itemIndex, {}) as NodeOptions;
				const locale =
					typeof options.locale === 'string' && options.locale ? options.locale : DEFAULT_LOCALE;
				if (!target) {
					throw new NodeOperationError(this.getNode(), t(locale, 'error.targetMissing'), {
						itemIndex,
					});
				}
				if (!isAuditKind(kindRaw)) {
					throw new NodeOperationError(
						this.getNode(),
						t(locale, 'error.kindUnsupported', { kind: kindRaw }),
						{ itemIndex },
					);
				}
				const kind = kindRaw;
				const isStatus = operation === 'getStatus';
				const jobId = isStatus
					? String(this.getNodeParameter('jobId', itemIndex, '')).trim()
					: null;
				if (isStatus && !jobId) {
					throw new NodeOperationError(this.getNode(), t(locale, 'error.jobIdMissing'), {
						itemIndex,
					});
				}
				const profile = isStatus ? '' : String(this.getNodeParameter('profile', itemIndex, ''));
				const wait = isStatus
					? false
					: (this.getNodeParameter('waitForResult', itemIndex, true) as boolean);
				const timeoutMinutes = wait
					? Math.max(1, Number(this.getNodeParameter('timeoutMinutes', itemIndex, 20)) || 20)
					: 0;
				const requestTimeoutMs =
					Math.max(5, Math.min(600, Number(options.requestTimeoutSeconds) || 90)) * 1000;

				const startedAt = Date.now();
				// A single call still gets a small budget so a "retry later" answer can be honoured.
				const deadline = startedAt + (wait ? timeoutMinutes * 60_000 : 5 * 60_000);
				if (!client) client = createMcpClient({ baseUrl, transport, requestTimeoutMs });
				let run: RunOutcome;
				try {
					// The MCP handshake runs once per execution; a rejected key or an
					// unreachable host is reported through the same normalized model.
					if (!initialized) {
						await client.initialize();
						initialized = true;
					}
					run = await runAudit({
						client,
						kind,
						target,
						profile: profile || null,
						jobId,
						deadline,
						wait,
						signal,
						sleep: sleepWithAbort,
						log,
					});
				} catch (error) {
					run = { outcome: 'error', tool: AUDIT_TOOLS[kind], error, jobId: null, polls: 0 };
				}
				const model = interpretOutcome(run, { kind, target, locale, timeoutMinutes });
				const plans = needsPlanCatalogue(model)
					? await fetchPlans(baseUrl, transport, locale)
					: null;
				const facts = planFacts(model, plans, locale);
				const json = buildOutput(model, facts, {
					polls: run.polls,
					elapsedMs: Date.now() - startedAt,
					raw: options.includeRaw && run.outcome === 'result' ? run.result : undefined,
				}) as IDataObject;

				const gateFailure = options.failOnGate === true && isGate(model.status);
				if (model.status === 'blocked' || gateFailure) {
					const error = new NodeOperationError(
						this.getNode(),
						gateFailure
							? t(locale, 'error.gate', { heading: model.heading, message: model.message })
							: model.message || model.heading,
						{
							itemIndex,
							description: model.nextStep ?? facts.explanation ?? undefined,
						},
					);
					if (this.continueOnFail()) {
						returnData.push({
							json: { ...json, error: error.message },
							pairedItem: { item: itemIndex },
						});
						continue;
					}
					throw error;
				}
				returnData.push({ json, pairedItem: { item: itemIndex } });
			} catch (error) {
				if (this.continueOnFail()) {
					const message = error instanceof Error ? error.message : String(error);
					returnData.push({
						json: { status: 'blocked', error: message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				// Errors raised above are already NodeOperationErrors; only wrap the rest.
				throw error instanceof NodeOperationError
					? error
					: new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}
		return [returnData];
	}
}
