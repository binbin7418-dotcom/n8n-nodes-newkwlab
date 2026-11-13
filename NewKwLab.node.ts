import {
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type IHttpRequestOptions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';

/**
 * NewKwLab bundle node.
 *
 * One node, one credential, six connected products of the NewKwLab API
 * bundle. Calls go to the gateway exactly like the JS SDK does:
 *   GET {baseUrl}/v1/<product>/<endpoint>?<params>
 * with the aggregate API key as a Bearer token (injected by the
 * NewKwLab API credential via httpRequestWithAuthentication).
 *
 * Every successful output item carries the gateway's credit headers:
 *   credits: { charged, balance, cache, requestId }
 * "Not found" results (e.g. an LEI with no record) are never charged by
 * the gateway, so charged will be 0 for them.
 */

interface Route {
	path: string;
	qs: IDataObject;
}

function routeFor(
	resource: string,
	operation: string,
	get: (name: string) => string,
): Route {
	switch (resource) {
		case 'emailcheck':
			return { path: '/v1/emailcheck/validate', qs: { email: get('email') } };
		case 'phonecheck':
			return { path: '/v1/phonecheck/validate', qs: { phone: get('phone') } };
		case 'cardcheck':
			return { path: '/v1/cardcheck/validate', qs: { number: get('number') } };
		case 'leilookup':
			if (operation === 'search') {
				return { path: '/v1/leilookup/search', qs: { name: get('name') } };
			}
			return { path: `/v1/leilookup/lei/${encodeURIComponent(get('lei'))}`, qs: {} };
		case 'airportbase':
			if (operation === 'search') {
				return { path: '/v1/airportbase/search', qs: { q: get('query') } };
			}
			return { path: '/v1/airportbase/airport', qs: { code: get('code') } };
		case 'sanctionscreen':
			return { path: '/v1/sanctionscreen/screen', qs: { name: get('name') } };
		default:
			throw new Error(`Unknown resource: ${resource}`);
	}
}

function headerValue(headers: IDataObject | undefined, name: string): string | null {
	if (!headers) return null;
	const raw = headers[name] ?? headers[name.toLowerCase()];
	if (raw === undefined || raw === null) return null;
	return Array.isArray(raw) ? String(raw[0]) : String(raw);
}

function toNumberOrNull(value: string | null): number | null {
	if (value === null) return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

export class NewKwLab implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'NewKwLab',
		name: 'newKwLab',
		icon: 'file:newkwlab.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Email, phone and card validation, LEI lookup, airport data and sanctions screening — one API key, one credit balance',
		defaults: { name: 'NewKwLab' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'newKwLabApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'emailcheck',
				options: [
					{ name: 'AirportBase', value: 'airportbase', description: 'Airport data by IATA/ICAO code (2 credits)' },
					{ name: 'CardCheck', value: 'cardcheck', description: 'Card number checks: Luhn, brand, BIN (1 credit)' },
					{ name: 'EmailCheck', value: 'emailcheck', description: 'Email validation verdict and score (1 credit)' },
					{ name: 'LEI Lookup', value: 'leilookup', description: 'Legal Entity Identifier records from GLEIF (2 credits)' },
					{ name: 'PhoneCheck', value: 'phonecheck', description: 'Phone number validity and line details (1 credit)' },
					{ name: 'SanctionScreen', value: 'sanctionscreen', description: 'Sanctions and watchlist screening (2 credits)' },
				],
			},
			// ---- EmailCheck ----
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['emailcheck'] } },
				default: 'validate',
				options: [
					{ name: 'Validate Email', value: 'validate', action: 'Validate an email address' },
				],
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'alice@example.com',
				description: 'The email address to validate',
				displayOptions: { show: { resource: ['emailcheck'], operation: ['validate'] } },
			},
			// ---- PhoneCheck ----
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['phonecheck'] } },
				default: 'validate',
				options: [
					{ name: 'Validate Phone', value: 'validate', action: 'Validate a phone number' },
				],
			},
			{
				displayName: 'Phone Number',
				name: 'phone',
				type: 'string',
				required: true,
				default: '',
				placeholder: '+14155552671',
				description: 'The phone number to validate, in international format',
				displayOptions: { show: { resource: ['phonecheck'], operation: ['validate'] } },
			},
			// ---- CardCheck ----
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['cardcheck'] } },
				default: 'validate',
				options: [
					{ name: 'Validate Card', value: 'validate', action: 'Validate a card number' },
				],
			},
			{
				displayName: 'Card Number',
				name: 'number',
				type: 'string',
				required: true,
				default: '',
				placeholder: '4242424242424242',
				description: 'The card number to check (digits; spaces and dashes are tolerated)',
				displayOptions: { show: { resource: ['cardcheck'], operation: ['validate'] } },
			},
			// ---- LEI Lookup ----
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['leilookup'] } },
				default: 'lookup',
				options: [
					{ name: 'Lookup by LEI', value: 'lookup', action: 'Look up an entity by its LEI code' },
					{ name: 'Search by Name', value: 'search', action: 'Search entities by legal name' },
				],
			},
			{
				displayName: 'LEI Code',
				name: 'lei',
				type: 'string',
				required: true,
				default: '',
				placeholder: '5493006MFDD84DZ89524',
				description: 'The 20-character Legal Entity Identifier. No record found costs 0 credits',
				displayOptions: { show: { resource: ['leilookup'], operation: ['lookup'] } },
			},
			{
				displayName: 'Entity Name',
				name: 'name',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'Apple Inc',
				description: 'Legal entity name (or part of it) to search for',
				displayOptions: { show: { resource: ['leilookup'], operation: ['search'] } },
			},
			// ---- AirportBase ----
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['airportbase'] } },
				default: 'airport',
				options: [
					{ name: 'Get Airport by Code', value: 'airport', action: 'Get one airport by IATA or ICAO code' },
					{ name: 'Search Airports', value: 'search', action: 'Search airports by name or city' },
				],
			},
			{
				displayName: 'Airport Code',
				name: 'code',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'LAX',
				description: 'IATA (3-letter) or ICAO (4-letter) airport code. Unknown codes cost 0 credits',
				displayOptions: { show: { resource: ['airportbase'], operation: ['airport'] } },
			},
			{
				displayName: 'Search Query',
				name: 'query',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'Los Angeles',
				description: 'Airport name or city to search for',
				displayOptions: { show: { resource: ['airportbase'], operation: ['search'] } },
			},
			// ---- SanctionScreen ----
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['sanctionscreen'] } },
				default: 'screen',
				options: [
					{ name: 'Screen Name', value: 'screen', action: 'Screen a name against sanctions lists' },
				],
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'John Smith',
				description: 'Person or entity name to screen against sanctions and watchlists',
				displayOptions: { show: { resource: ['sanctionscreen'], operation: ['screen'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const resource = this.getNodeParameter('resource', i) as string;
			const operation = this.getNodeParameter('operation', i) as string;
			const route = routeFor(resource, operation, (name) =>
				String(this.getNodeParameter(name, i) ?? ''),
			);
			const credentials = await this.getCredentials('newKwLabApi');
			const baseUrl = String(credentials.baseUrl ?? 'https://api.newkwlab.com/gateway').replace(
				/\/+$/,
				'',
			);

			const options: IHttpRequestOptions = {
				method: 'GET',
				url: `${baseUrl}${route.path}`,
				qs: route.qs,
				json: true,
				returnFullResponse: true,
				ignoreHttpStatusErrors: true,
			};

			let response;
			try {
				response = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'newKwLabApi',
					options,
				);
			} catch (error) {
				throw new NodeOperationError(
					this.getNode(),
					`NewKwLab request failed before a response was received: ${(error as Error).message}`,
					{ itemIndex: i },
				);
			}

			const statusCode = Number(response.statusCode ?? 0);
			const body = response.body as IDataObject | string | undefined;

			if (statusCode < 200 || statusCode >= 300) {
				// Gateway errors: { error: { code, detail } }; upstream passthrough
				// errors can be flat: { code, error }. Accept both shapes.
				let code = `HTTP_${statusCode}`;
				let detail = '';
				if (body && typeof body === 'object') {
					const errObj = (body as IDataObject).error;
					if (errObj && typeof errObj === 'object') {
						const e = errObj as IDataObject;
						if (e.code) code = String(e.code);
						detail = String(e.detail ?? e.reason ?? e.message ?? '');
					} else {
						if ((body as IDataObject).code) code = String((body as IDataObject).code);
						if (typeof errObj === 'string') detail = errObj;
					}
				} else if (typeof body === 'string' && body.length > 0 && body.length < 300) {
					detail = body;
				}
				throw new NodeOperationError(
					this.getNode(),
					`NewKwLab error ${statusCode}: ${code}${detail ? ` — ${detail}` : ''}`,
					{ itemIndex: i },
				);
			}

			const headers = response.headers as IDataObject | undefined;
			const credits = {
				charged: toNumberOrNull(headerValue(headers, 'x-credits-charged')),
				balance: toNumberOrNull(headerValue(headers, 'x-credits-balance')),
				cache: headerValue(headers, 'x-cache'),
				requestId: headerValue(headers, 'x-request-id'),
			};

			const json: IDataObject =
				body && typeof body === 'object' && !Array.isArray(body)
					? { ...(body as IDataObject), credits }
					: { result: (body ?? null) as IDataObject, credits };

			out.push({ json, pairedItem: { item: i } });
		}

		return [out];
	}
}
