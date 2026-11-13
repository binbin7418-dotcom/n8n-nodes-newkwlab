import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * NewKwLab API credential: one aggregate API key (nkw_live_...) for the
 * whole product bundle, sent as a Bearer token to the gateway.
 * Production base URL: https://api.newkwlab.com/gateway
 */
export class NewKwLabApi implements ICredentialType {
	name = 'newKwLabApi';

	displayName = 'NewKwLab API';

	documentationUrl = 'https://api.newkwlab.com';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Aggregate API key (starts with nkw_live_). Get one by activating a credit pack license.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.newkwlab.com/gateway',
			description: 'Gateway base URL. Change only for self-hosted or staging gateways.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/usage',
			method: 'GET',
		},
	};
}
