# API reference

This document describes the APIs implemented in this repository. Firebase callable functions are defined in `../functions/src/index.ts`; Angular client code is under `src/app/`.

## At a glance

| API | Used for | Authentication |
|---|---|---|
| Binance Spot public REST API | Market tickers, order books, and candles | None |
| Firebase Authentication and Cloud Firestore | Sign-in, favorites, portfolio, and simulated wallet | Firebase user session; Firestore rules scope user data |
| Firebase callable functions | Per-user Binance account linking and buys; watchlist analysis; CoinGecko market metadata | Signed-in Firebase user |
| Firebase HTTPS `binanceApi` function | Shared Binance account status, balances, diagnostic IP, and confirmed market buy/sell orders | Revocation-checked Firebase ID token |
| Binance Spot signed API | Read shared account and submit confirmed real market buys/sells | Server-side Binance credentials |
| CoinGecko Pro API | Market-cap data and crypto category metadata | Server-side API key |
| OpenAI Responses API | Watchlist analysis | Server-side API key |

## Binance Spot public market data

The Angular `MarketDataService` calls `https://api.binance.com/api/v3` directly. These public requests do not need a Binance account or API key.

| Request | Purpose |
|---|---|
| `GET /ticker/24hr` | Loads 24-hour ticker data; the app filters USDT pairs and ranks them by quote volume. |
| `GET /depth?symbol={symbol}&limit=5` | Loads the top five bids and asks for a market pair. |
| `GET /klines?symbol={symbol}&interval={interval}&limit={limit}` | Loads candle history. The UI uses daily candles for indicators and 4-hour candles for trend metrics. |

Trend screening currently analyzes up to 80 pairs, with up to five concurrent candle requests. EMA and RSI calculations are performed in the frontend from returned candle data.

## Firebase callable functions

The backend exports the following Firebase **callable** functions. Invoke these with the Firebase Functions SDK (`httpsCallable`), not by treating them as arbitrary REST routes. Requests require a signed-in Firebase user unless otherwise noted; the backend also checks the Firebase authentication context.

| Function | Input | Result / behavior |
|---|---|---|
| `getBinanceStatus` | `{}` | `{ connected: boolean }` for the signed-in user's linked Binance credentials. |
| `connectBinance` | `{ apiKey, apiSecret }` | Verifies the key with Binance, encrypts and stores credentials for that user, and returns `{ connected, assetCount }`. |
| `disconnectBinance` | `{}` | Deletes that user's Binance integration and returns `{ connected: false }`. |
| `getBinanceAccount` | `{}` | Returns `{ connected, balances }`; balances include non-zero `asset`, `free`, and `locked` amounts, sorted by balance and limited to 50. |
| `buyBinanceMarket` | `{ symbol, quoteOrderQty, expectedAsk, confirmRealOrder }` | After explicit confirmation and backend checks, submits a real Binance USDT-quoted market buy and records the result in that user's portfolio. Maximum spend is 1,000 USDT per order. |
| `analyzeWatchlist` | `{ coins, requestedAt, instruction }` | Sends validated market data to OpenAI and returns `{ analysis }`. The backend accepts 1–20 coins. |
| `getMarketCapData` | `{}` | Returns cached CoinGecko market-cap/rank buckets, meme-token rows, recent coins, and fetch time. Cache lifetime: 15 minutes. |
| `getCryptoCategories` | `{}` | Returns category tags keyed by unambiguous token symbol, ambiguous symbols, category metadata, and fetch time. Cache lifetime: 24 hours. |

`getMarketCapData` and `getCryptoCategories` are present in the backend source; the current dashboard's market-trends view uses Binance ticker/candle data instead.

Real Binance buys through the user-key callable are **not simulated**. They check the reviewed ask against the live ask (maximum 1% movement), check visible top-five ask depth and available USDT plus a fee reserve, then submit a real market order. The shared-account HTTP order API below is a separate execution path and uses server-side shared credentials.

## Shared Binance HTTP API

The Firebase HTTPS function `binanceApi` is deployed in `asia-east1`; its base URL is `https://asia-east1-mytradingapp-50d29.cloudfunctions.net/binanceApi`. It requires `Authorization: Bearer <Firebase ID token>` on every API route, verifies the token including revocation, and uses the decoded UID for the per-user status lookup. The account and order endpoints use one shared Binance account for all authenticated users.

| Method and route | Behavior |
|---|---|
| `GET /ip` | Returns the function runtime's observed egress IP via ipify. This diagnostic does not guarantee a fixed IP. |
| `GET /api/binance/status` | Returns whether the signed-in user's `users/{uid}/integrations/binance` document has `enabled: true`. This flag does not validate the shared Binance credentials. |
| `GET /api/binance/account` | Reads the shared Binance Spot account. Returns non-zero balances with free and locked quantities, sorted by quantity sum and capped at 100. No fiat conversion is provided. |
| `POST /api/binance/order` | Submits an explicitly confirmed shared-account market buy or sell after checking free balance. |

### Market order request

Every order request must include `confirm: true` and a unique UUID `clientOrderId`. Send a buy amount as a positive decimal string `quoteOrderQty` (USDT), or a sell amount as a positive decimal string `quantity` (base asset). Do not include the other amount field.

```json
{
  "symbol": "BTCUSDT",
  "side": "BUY",
  "quoteOrderQty": "25.00",
  "clientOrderId": "550e8400-e29b-41d4-a716-446655440000",
  "confirm": true
}
```

```json
{
  "symbol": "BTCUSDT",
  "side": "SELL",
  "quantity": "0.001",
  "clientOrderId": "550e8400-e29b-41d4-a716-446655440001",
  "confirm": true
}
```

Symbols must be uppercase USDT-quoted Spot pairs; leveraged-token pairs are rejected. Buy orders check free USDT, and sells check the free base-asset balance immediately before submission. Binance applies its own precision, minimum-notional, and market-order filters. Market execution price can differ from any quote shown in the UI.

Successful responses contain `symbol`, `orderId`, `clientOrderId`, `side`, `type`, `status`, `executedQty`, `cummulativeQuoteQty`, optional `transactTime`, and `replayed`. Idempotency records are stored in `binance_order_requests/{clientOrderId}`. A successful retry using the same UID and identical order returns the recorded response with `replayed: true`; a conflicting or pending/uncertain request returns `409`. Once a valid UUID is accepted, rejected attempts also consume that ID; use a new UUID only for a newly reviewed order. After a timeout or uncertain response, check Binance order history before creating a new ID. Never automatically resubmit with a new ID.

The server-side order gate is `functions/config/trading.json`. It defaults to `live_spot_orders_enabled: false`; change it to `true` and redeploy only after the shared-account trading policy and API key permissions have been reviewed. Any authenticated Firebase user can submit real orders against the same account when enabled. `confirm: true` is a deliberate-submit check, not an authorization boundary. Keep withdrawals, margin, and futures permissions disabled.

Configure these Firebase Secret Manager secrets for the shared HTTP API:

```sh
firebase functions:secrets:set BINANCE_API_KEY
firebase functions:secrets:set BINANCE_SECRET
```

They are distinct from `BINANCE_CREDENTIALS_KEK`, which is used by per-user callable integration. The shared API key needs account-read and Spot Trading permissions for account reads and orders.

### Errors and CORS

The HTTP API returns JSON `{ "statusCode": number, "message": string, "error": string }`. Statuses include `401` for missing/invalid/revoked Firebase tokens; `400` for invalid requests or insufficient balance; `409` for duplicate/conflicting or pending/uncertain order IDs; `503` for unavailable credentials or disabled/missing live-order configuration; `502` for Binance/network failures; and `500` for unexpected failures.

The HTTP and callable CORS allowlists include localhost ports, the Firebase Hosting origins, and `https://tradingdashboard--mytradingapp-50d29.asia-east1.hosted.app`. The HTTP API is explicitly in `asia-east1`. Existing callable functions without a region option use the Firebase default region (normally `us-central1`); their CORS allowlist includes the hosted dashboard origin as well.

## Firebase Authentication and Firestore

The app uses Firebase Email/Password Authentication. Signed-in user data is stored under:

| Firestore path | Data |
|---|---|
| `users/{uid}/favorites/{symbol}` | Favorite symbol and added timestamp. |
| `users/{uid}/portfolio/{entryId}` | Simulated holding or server-recorded Binance buy. |
| `users/{uid}/wallet/main` | Simulated USDT play-funds balance. |
| `users/{uid}/integrations/binance` | Encrypted Binance credentials, accessed by trusted backend code. |

Favorites, wallet, and simulated portfolio operations use the Firebase client SDK and Firestore security rules; they are not HTTP API endpoints. Simulated sells update the holding quantity and credit sale proceeds to the simulated wallet in a Firestore transaction. They do not submit Binance sell orders.

The shared HTTP API has a separate real Binance `SELL` route at `POST /api/binance/order`; there is no corresponding per-user Firebase callable sell function. The callable `buyBinanceMarket` continues to use the signed-in user's individually linked Binance credentials, while the HTTP order route uses the shared server-side account.

## External service credentials

OpenAI, CoinGecko Pro, and Binance secrets are used server-side by Cloud Functions. The per-user callable Binance API secret is encrypted before it is stored in Firestore. The shared HTTP API uses separate `BINANCE_API_KEY` and `BINANCE_SECRET` Secret Manager values. Do not put these secrets in the Angular environment or expose them to the browser. The Firebase web-app configuration in `src/environments/environment.ts` identifies the client app; it is not a Firebase service-account key.
