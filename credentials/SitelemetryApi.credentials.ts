import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

import { CLIENT_NAME, CLIENT_VERSION, PROTOCOL_VERSION } from '../nodes/Sitelemetry/client';

export class SitelemetryApi implements ICredentialType {
	name = 'sitelemetryApi';

	displayName = 'Sitelemetry API';

	documentationUrl = 'https://github.com/egenil/n8n-nodes-sitelemetry#credentials';

	icon = 'file:../nodes/Sitelemetry/sitelemetry.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Sitelemetry MCP API key. Sign in at https://sitelemetry.com/app, open API key and copy it. A Free account is enough to start.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://sitelemetry.com',
			description: 'Sitelemetry base URL; change it only when you are told to use another host',
		},
	];

	// The key travels as a Bearer token; it is never written to the output.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// The credential test is the MCP initialize handshake: a rejected key answers 401.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/mcp',
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
				'mcp-protocol-version': PROTOCOL_VERSION,
			},
			body: {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: {},
					clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
				},
			},
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message:
						'Sitelemetry rejected the API key. Copy the MCP API key from https://sitelemetry.com/app and try again.',
				},
			},
		],
	};
}
