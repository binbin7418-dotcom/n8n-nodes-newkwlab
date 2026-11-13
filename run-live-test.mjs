// Live-chain test for the compiled NewKwLab n8n node.
//
// Drives the REAL compiled node (dist/) through a minimal IExecuteFunctions
// stub whose helpers.httpRequest is a faithful stand-in for n8n's helper:
// it injects the credential's Bearer header (the credential's generic-auth
// definition) and performs a real HTTP request with global fetch.
//
// Target: a LOCAL gateway instance running the production code
// (gateway/ec2/server.mjs) on a throwaway SQLite DB, seeded with a trial
// customer (1,000 credits) via gateway/ec2/seed-customer.mjs. The instance
// is expected to be running already; this script does not start it.
//
// Required env:
//   NKW_TEST_BASE_URL   e.g. http://127.0.0.1:8899   (local gateway instance)
//   NKW_TEST_API_KEY    the seeded aggregate key (nkw_live_...)
// Optional:
//   NKW_TEST_NODE_PATH  override path to the compiled node module
//
// Assertions:
//   1. cardcheck 4242424242424242 -> valid=true, credits.charged=1,
//      credits.balance=999, /v1/usage agrees (cardcheck calls=1 charged=1)
//   2. leilookup fake LEI -> status=invalid_format, credits.charged=0,
//      balance unchanged; /v1/usage agrees (leilookup charged=0)
//   3. bad API key -> execute throws NodeOperationError carrying 401/UNAUTHORIZED
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const nodePath =
	process.env.NKW_TEST_NODE_PATH ?? path.join(here, '..', 'dist', 'nodes', 'NewKwLab', 'NewKwLab.node.js');
const { NewKwLab } = require(nodePath);
const { NodeOperationError } = require('n8n-workflow');

const BASE = process.env.NKW_TEST_BASE_URL;
const KEY = process.env.NKW_TEST_API_KEY;
if (!BASE || !KEY) {
	console.error('NKW_TEST_BASE_URL and NKW_TEST_API_KEY are required');
	process.exit(2);
}

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
	if (cond) {
		passed++;
		console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
	} else {
		failed++;
		console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
}

// ---- minimal IExecuteFunctions stub -------------------------------------
function makeContext({ params, credentials }) {
	const nodeStub = {
		name: 'NewKwLab',
		displayName: 'NewKwLab',
		type: 'n8n-nodes-newkwlab.newKwLab',
		typeVersion: 1,
		position: [0, 0],
		parameters: params,
	};
	const ctx = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name, _index) => params[name],
		getNode: () => nodeStub,
		getCredentials: async (type) => {
			if (type !== 'newKwLabApi') throw new Error(`unknown credential type ${type}`);
			return credentials;
		},
		helpers: {
			// Faithful to n8n: resolves the credential's generic auth
			// (Authorization: Bearer <apiKey>) and issues the HTTP request.
			httpRequestWithAuthentication: async function (credentialType, options) {
				const creds = await ctx.getCredentials(credentialType);
				const url = new URL(options.url);
				for (const [k, v] of Object.entries(options.qs ?? {})) {
					if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
				}
				const res = await fetch(url, {
					method: options.method ?? 'GET',
					headers: {
						Authorization: `Bearer ${creds.apiKey}`,
						Accept: 'application/json',
					},
				});
				const headers = {};
				res.headers.forEach((v, k) => {
					headers[k] = v;
				});
				const text = await res.text();
				let body;
				try {
					body = JSON.parse(text);
				} catch {
					body = text;
				}
				if (options.returnFullResponse) {
					return { statusCode: res.status, headers, body };
				}
				return body;
			},
		},
	};
	return ctx;
}

async function runNode(params, credentials) {
	const node = new NewKwLab();
	const ctx = makeContext({ params, credentials });
	return node.execute.call(ctx);
}

async function usage(apiKey) {
	const res = await fetch(`${BASE}/v1/usage`, {
		headers: { Authorization: `Bearer ${apiKey}` },
	});
	if (!res.ok) throw new Error(`usage -> HTTP ${res.status}`);
	return res.json();
}

function usageRow(u, product) {
	const rows = u.usage_by_product;
	if (Array.isArray(rows)) return rows.find((r) => r.product_id === product || r.product === product);
	return rows?.[product];
}

const goodCreds = { apiKey: KEY, baseUrl: BASE };

// ---- 1. cardcheck: real charge of 1 credit ------------------------------
const cardOut = await runNode(
	{ resource: 'cardcheck', operation: 'validate', number: '4242424242424242' },
	goodCreds,
);
const card = cardOut[0][0].json;
console.log('cardcheck out:', JSON.stringify(card));
check('cardcheck valid=true', card.valid === true);
check('cardcheck credits.charged=1', card.credits?.charged === 1, `charged=${card.credits?.charged}`);
check('cardcheck credits.balance=999', card.credits?.balance === 999, `balance=${card.credits?.balance}`);
check('cardcheck credits.cache=MISS', card.credits?.cache === 'MISS', `cache=${card.credits?.cache}`);

const u1 = await usage(KEY);
const cardRow = usageRow(u1, 'cardcheck');
check('usage balance=999 after cardcheck', u1.balance === 999, `balance=${u1.balance}`);
check(
	'usage cardcheck row calls=1 charged=1',
	cardRow && Number(cardRow.calls) === 1 && Number(cardRow.charged) === 1,
	JSON.stringify(cardRow),
);

// ---- 2. leilookup fake LEI: not-found signal, 0 credits ------------------
const leiOut = await runNode(
	{ resource: 'leilookup', operation: 'lookup', lei: '984500ABCDEF12345678' },
	goodCreds,
);
const lei = leiOut[0][0].json;
console.log('leilookup out:', JSON.stringify(lei));
check('leilookup status=invalid_format', lei.status === 'invalid_format', `status=${lei.status}`);
check('leilookup credits.charged=0', lei.credits?.charged === 0, `charged=${lei.credits?.charged}`);
check('leilookup credits.balance still 999', lei.credits?.balance === 999, `balance=${lei.credits?.balance}`);

const u2 = await usage(KEY);
const leiRow = usageRow(u2, 'leilookup');
check('usage balance still 999 after leilookup', u2.balance === 999, `balance=${u2.balance}`);
check(
	'usage leilookup row charged=0',
	leiRow && Number(leiRow.charged) === 0,
	JSON.stringify(leiRow),
);

// ---- 3. bad key: NodeOperationError carrying the gateway error code ------
let threw = null;
try {
	await runNode(
		{ resource: 'cardcheck', operation: 'validate', number: '4242424242424242' },
		{ apiKey: 'nkw_live_forged_test_key', baseUrl: BASE },
	);
} catch (e) {
	threw = e;
}
check('bad key throws', threw !== null);
check(
	'bad key error is NodeOperationError',
	threw instanceof NodeOperationError,
	threw ? threw.constructor.name : 'none',
);
check(
	'bad key error carries 401 + UNAUTHORIZED',
	!!threw && /401/.test(threw.message) && /UNAUTHORIZED/.test(threw.message),
	threw ? threw.message : 'none',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
