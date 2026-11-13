# n8n-nodes-newkwlab

An n8n community node for the **NewKwLab API bundle**: email, phone and card
validation, LEI lookup, airport data and sanctions screening — all behind a
single gateway, a single API key (`nkw_live_...`) and a single credit
balance.

- **One key** for every connected product
- **Credits, not per-API subscriptions** — buy a pack once, spend across tools
- **Not-found results are free** — lookups that come back "no record" cost 0 credits
- **Repeat calls are free for 24h** — same key + same parameters hit the cache, 0 credits
- **Upstream errors are free** — if we fail, you don't pay

> Status: pre-release. The package name `n8n-nodes-newkwlab` is a placeholder
> until the npm package is published.

## Install

### As an npm package (once published)

```bash
npm install n8n-nodes-newkwlab
```

### As a community node in n8n

1. In n8n, go to **Settings → Community Nodes → Install**.
2. Enter the package name: `n8n-nodes-newkwlab`.
3. Click **Install** and restart n8n if prompted.

For self-hosted n8n you can also install it manually:

```bash
cd ~/.n8n/custom   # or your n8n custom extensions folder
npm install n8n-nodes-newkwlab
```

### From source (development)

```bash
npm install
npm run build   # compiles TypeScript to dist/ and copies the node icon
```

## Credentials

Create a **NewKwLab API** credential in n8n (**Credentials → New → NewKwLab API**):

| Field | Value |
|---|---|
| API Key | Your aggregate key, starts with `nkw_live_` |
| Base URL | `https://api.newkwlab.com/gateway` (default; change only for staging/self-hosted gateways) |

Keys are issued by activating a credit-pack license purchased on Gumroad.
Use the credential's **Test** button after saving — it calls `GET /v1/usage`
and succeeds when the key is valid.

## The node

One node — **NewKwLab** — with a Resource dropdown. Every operation is a
single gateway call, and every output item includes the gateway's credit
headers under a `credits` field:

```json
{
  "valid": true,
  "network": "Visa",
  "credits": { "charged": 1, "balance": 999, "cache": "MISS", "requestId": "gw_..." }
}
```

### Resources and operations

| Resource | Operation | Input | Credits |
|---|---|---|---|
| EmailCheck | Validate Email | Email address | 1 per call |
| PhoneCheck | Validate Phone | Phone number (international format) | 1 per call |
| CardCheck | Validate Card | Card number | 1 per call |
| LEI Lookup | Lookup by LEI | 20-character LEI code | 2 per record found, 0 if no record |
| LEI Lookup | Search by Name | Entity name | 2 per call |
| AirportBase | Get Airport by Code | IATA/ICAO code | 2 per airport found, 0 if unknown |
| AirportBase | Search Airports | Name or city query | 2 per call |
| SanctionScreen | Screen Name | Person or entity name | 2 per screening ("clear" is a delivered result and is charged) |

## Errors

Gateway errors stop the item with an n8n `NodeOperationError` whose message
carries the HTTP status and the gateway error code, e.g.
`NewKwLab error 402: INSUFFICIENT_CREDITS`.

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or unknown API key |
| `INSUFFICIENT_CREDITS` | 402 | Balance below the product's credit price — nothing was called or charged |
| `UPGRADE_REQUIRED` | 402 | Account canceled and out of credits |
| `CAPABILITY_DENIED` | 403 | Your plan does not include this product or capability |
| `PRODUCT_NOT_FOUND` | 404 | Unknown product id |
| `PRODUCT_NOT_CONNECTED` | 503 | Product is priced but not yet connected to the gateway |
| `RATE_LIMITED` | 429 | Per-key minute limit for your plan reached |
| `UPSTREAM_ERROR` | 502 | The product's upstream failed — not charged |

## Development: live-chain test

`test/run-live-test.mjs` drives the compiled node through a minimal
`IExecuteFunctions` stub against a local gateway instance
(`gateway/ec2/server.mjs` on a throwaway SQLite DB, seeded trial customer):

```bash
npm install && npm run build
NKW_TEST_BASE_URL=http://127.0.0.1:8899 NKW_TEST_API_KEY=nkw_live_... npm run test:live
```

It asserts a real card validation (valid, 1 credit charged, ledger agrees),
a fake LEI lookup (`invalid_format`, 0 credits, ledger agrees) and the
401/`UNAUTHORIZED` error path.

## License

MIT
