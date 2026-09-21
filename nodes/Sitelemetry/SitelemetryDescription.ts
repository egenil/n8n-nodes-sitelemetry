import type { INodeProperties } from 'n8n-workflow';

export const sitelemetryProperties: INodeProperties[] = [
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Audit',
				value: 'audit',
			},
		],
		default: 'audit',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['audit'],
			},
		},
		options: [
			{
				name: 'Get Status',
				value: 'getStatus',
				description: 'Fetch the result of an audit job that was started earlier',
				action: 'Get the status of an audit job',
			},
			{
				name: 'Run',
				value: 'run',
				description: 'Start an audit of a website you own or are authorized to test',
				action: 'Run an audit',
			},
		],
		default: 'run',
	},
	{
		displayName: 'Target',
		name: 'target',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'https://www.example.com',
		description:
			'Website URL or domain to audit. Audit only websites you own or are explicitly authorized to test.',
		displayOptions: {
			show: {
				resource: ['audit'],
			},
		},
	},
	{
		displayName: 'Audit Kind',
		name: 'auditKind',
		type: 'options',
		options: [
			{
				name: 'Accessibility',
				value: 'accessibility',
				description: 'Accessibility checks of the public pages',
			},
			{
				name: 'AI Visibility',
				value: 'ai_visibility',
				description: 'How AI assistants and crawlers see the site',
			},
			{
				name: 'Full',
				value: 'full',
				description: 'All pillars with one blended score',
			},
			{
				name: 'Integrations',
				value: 'integrations',
				description: 'Third-party integrations and tracking on the site',
			},
			{
				name: 'Performance',
				value: 'performance',
				description: 'Page performance measurements',
			},
			{
				name: 'Security',
				value: 'security',
				description: 'Security posture of the live site (included in the Free plan)',
			},
			{
				name: 'Technical SEO',
				value: 'seo',
				description: 'Technical SEO checks of the public pages',
			},
		],
		default: 'security',
		description:
			'Which audit to run. Kinds other than Security must be included in the connected plan; otherwise the node returns status plan_required.',
		displayOptions: {
			show: {
				resource: ['audit'],
			},
		},
	},
	{
		displayName: 'Job ID',
		name: 'jobId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'mj_00000000000000000000000000000000',
		description: 'The job ID returned by a Run operation whose result was still running',
		displayOptions: {
			show: {
				resource: ['audit'],
				operation: ['getStatus'],
			},
		},
	},
	{
		displayName: 'Profile',
		name: 'profile',
		type: 'options',
		options: [
			{
				name: 'Account Default',
				value: '',
			},
			{
				name: 'All',
				value: 'all',
			},
			{
				name: 'Baseline',
				value: 'baseline',
			},
			{
				name: 'Deep',
				value: 'deep',
			},
			{
				name: 'Passive',
				value: 'passive',
			},
		],
		default: '',
		description: 'Security depth profile; it must be included in the connected plan',
		displayOptions: {
			show: {
				resource: ['audit'],
				operation: ['run'],
				auditKind: ['security', 'full'],
			},
		},
	},
	{
		displayName: 'Wait for Result',
		name: 'waitForResult',
		type: 'boolean',
		default: true,
		description:
			'Whether to poll the audit until it finishes. When off, a long audit returns status "running" with a job ID for the Get Status operation.',
		displayOptions: {
			show: {
				resource: ['audit'],
				operation: ['run'],
			},
		},
	},
	{
		displayName: 'Timeout (Minutes)',
		name: 'timeoutMinutes',
		type: 'number',
		default: 20,
		typeOptions: {
			minValue: 1,
			maxValue: 180,
		},
		description:
			'Total time budget for starting and polling the audit. When it runs out the job keeps running on the Sitelemetry side and the node returns status "running" with the job ID.',
		displayOptions: {
			show: {
				resource: ['audit'],
				operation: ['run'],
				waitForResult: [true],
			},
		},
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: {
			show: {
				resource: ['audit'],
			},
		},
		options: [
			{
				displayName: 'Fail on Gate',
				name: 'failOnGate',
				type: 'boolean',
				default: false,
				description:
					'Whether to stop with an error when the account gate prevents the audit (plan_required, quota_exhausted or verification_required) instead of returning that status as data',
			},
			{
				displayName: 'Include Raw Result',
				name: 'includeRaw',
				type: 'boolean',
				default: false,
				description: 'Whether to add the unmodified tool result under "raw"',
			},
			{
				displayName: 'Message Language',
				name: 'locale',
				type: 'options',
				options: [
					{
						name: 'English',
						value: 'en',
					},
				],
				default: 'en',
				description: 'Language of the status headings, messages and explanations in the output',
			},
			{
				displayName: 'Request Timeout (Seconds)',
				name: 'requestTimeoutSeconds',
				type: 'number',
				default: 90,
				typeOptions: {
					minValue: 5,
					maxValue: 600,
				},
				description: 'Time limit for each single HTTP request to Sitelemetry',
			},
		],
	},
];
