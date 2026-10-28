# API reference

This document describes APIs implemented in the repository and the updated backend API contract consumed by the Angular client. Firebase callable/HTTP source is in `../functions/src/index.ts`; Angular client code is under `src/app/`.

## At a glance

### Requests the UI actually makes

| UI feature | API wired in the frontend |
|---|---|
| Market overview and Market Trends ticker list | Authenticated `GET /api/market-trends/tickers` on `binanceApi`, which proxies CoinGecko market data. |
| Asset charts and history | Authenticated `GET /api/coingecko/history/:id?days=...` proxies CoinGecko market chart data. |
| Order-book quote | Binance Spot public REST `GET /api/v3/depth` for top 5 bids and asks. |
| Market Trends price changes, volume, market cap, categories, and liquidity tiers | CoinGecko market data returned by the authenticated ticker endpoint. Binance is used for tradeable-pair availability only. |
| Sign-in and per-user favorites, paper portfolio, and play wallet | Firebase Authentication and direct Firestore SDK operations protected by Firestore rules; these are not REST endpoints. |
| Linked Binance connection, disconnect, linked-account balances, and per-user real buy | Firebase callable functions: `connectBinance`, `disconnectBinance`, `getBinanceAccount`, and `buyBinanceMarket`. |
| Binance connection status | Firebase callable `getBinanceStatus` and authenticated `GET /api/binance/status` in Settings. |
| Shared Binance balances and Functions egress diagnostic | Authenticated `GET /api/binance/account` and `GET /ip` on `binanceApi`. |
| Shared-account live buy/sell | Authenticated `POST /api/binance/order`, with review and explicit confirmation in Settings. It submits real market orders and is subject to the backend trading gate. |
| AI watchlist analysis | Authenticated `POST /api/analysis/watchlist` on `binanceApi`, sent by `BinanceApiService.analyzeWatchlist`. |
| Paper sell | Direct Firestore transaction; it is simulated and does not call a live exchange order API. |

### Wiring and deployment status

The endpoints in the table above are wired in the current frontend source. This indicates client integration, not proof that the production frontend and Functions have been deployed or verified together. Deploy the updated Angular app, Functions, and Firestore rules before expecting the deployed UI to use these changes.

The shared-order UI submits real orders only after a separate review and explicit confirmation. The backend configuration in `functions/config/trading.json` currently sets `live_spot_orders_enabled` to `false`, so the backend rejects shared live orders until an authorized operator intentionally enables the gate and deploys the change. The shared account is used by all authenticated users when enabled.

The browser sends watchlist analysis to `POST /api/analysis/watchlist`; it does not call OpenAI directly or require an OpenAI key in the frontend. The legacy callable `analyzeWatchlist` remains exported by the backend but is not called by the UI. Optional Binance endpoints such as `GET /api/v3/myTrades` and `GET /api/v3/exchangeInfo` are also not wired to the UI.

| API | Used for | Authentication |
|---|---|---|
| Authenticated CoinGecko proxy on Firebase HTTPS `binanceApi` | Market data and history | Firebase ID token; CoinGecko key remains server-side |
| Binance Spot public REST API | Top 5 order book | None |
| Firebase Authentication and Cloud Firestore | Sign-in, favorites, portfolio, and simulated wallet | Firebase user session; Firestore rules scope user data |
| Firebase callable functions in `asia-east1` | Per-user Binance account linking/status/account and buys | Signed-in Firebase user |
| Firebase HTTPS `binanceApi` function in `asia-east1` | Shared Binance account status, balances, diagnostic IP, CoinGecko market/history proxy, watchlist analysis, and confirmed market buy/sell orders | Revocation-checked Firebase ID token |
| Binance Spot signed API | Read shared account and submit confirmed real market buys/sells | Server-side Binance credentials |
| OpenAI Responses API | Watchlist analysis | Server-side API key |

## CoinGecko market data

`MarketDataService.getTickers()` requests the authenticated backend endpoint instead of calling Binance's all-symbol ticker endpoint from the browser:

```http
GET https://asia-east1-mytradingapp-50d29.cloudfunctions.net/binanceApi/api/market-trends/tickers
Authorization: Bearer <Firebase ID token>
```

The backend verifies Firebase authentication and proxies CoinGecko `GET /coins/markets` data. It may return a cached response to stay within CoinGecko rate limits. A response has this shape:

```json
{
  "source": "CoinGecko",
  "fetchedAt": "2026-10-28T12:00:00.000Z",
  "category": null,
  "tickers": [
    {
      "id": "bitcoin",
      "symbol": "BTCUSDT",
      "base": "BTC",
      "name": "Bitcoin",
      "lastPrice": 67000,
      "priceChangePercent": 1.5151515151515151,
      "quoteVolume": 8250000,
      "highPrice": 67500,
      "lowPrice": 65500,
      "marketCap": 1320000000000,
      "marketCapRank": 1,
      "circulatingSupply": 19800000,
      "categories": [],
      "tradeable": true,
      "sparkline": [66500, 67000]
    }
  ]
}
```

The returned list contains CoinGecko market assets with USD prices, 24h changes, aggregate USD volume, market cap, rank, circulating supply, and 7-day sparkline data. The optional `category` query maps supported category filters to CoinGecko category IDs. `tradeable` indicates whether Binance Spot currently lists the asset's `BASEUSDT` pair. The `symbol` field is a UI/execution mapping and is not guaranteed to be a unique CoinGecko identifier; use the returned `id` for history requests. Market data is cached server-side to limit provider requests. Configure `COINGECKO_API_KEY` as a Firebase secret and keep it out of the browser bundle.

CoinGecko's market chart endpoint returns sampled prices, market caps, and total volumes. The app currently adapts price samples to the chart component's candle-shaped model; those points are not exchange OHLC candles. Supported history ranges are 1, 7, 30, 90, and 365 days, subject to the selected CoinGecko API plan's rate limits and granularity.

## Binance account and order APIs

The Angular `MarketDataService` calls Binance Spot public `GET /api/v3/depth` directly for the top 5 bids and asks when preparing a real order. CoinGecko, not Binance, supplies all displayed price history and chart inputs.

| Request | Purpose |
|---|---|
| `GET /depth?symbol={symbol}&limit=5` | Loads the top five bids and asks for a market pair. |
| `GET /api/coingecko/history/:id?days={days}` | Loads sampled CoinGecko market-chart history; the UI uses this for asset charts and rule-based indicators. These samples are not exchange OHLC candles. |

Trend screening currently analyzes up to 80 pairs, with up to five concurrent candle requests. EMA and RSI calculations are performed in the frontend from returned candle data.

## Firebase callable functions

The backend exports the following Firebase **callable** functions in `asia-east1`. Invoke these with the Firebase Functions SDK (`httpsCallable`), not by treating them as arbitrary REST routes. Requests require a signed-in Firebase user unless otherwise noted; the backend also checks the Firebase authentication context.

| Function | Input | Result / behavior |
|---|---|---|
| `getBinanceStatus` | `{}` | `{ connected: boolean }` for the signed-in user's linked Binance credentials. |
| `connectBinance` | `{ apiKey, apiSecret }` | Verifies the key with Binance, encrypts and stores credentials for that user, and returns `{ connected, assetCount }`. |
| `disconnectBinance` | `{}` | Deletes that user's Binance integration and returns `{ connected: false }`. |
| `getBinanceAccount` | `{}` | Returns `{ connected, balances }`; balances include non-zero `asset`, `free`, and `locked` amounts, sorted by balance and limited to 50. |
| `buyBinanceMarket` | `{ symbol, quoteOrderQty, expectedAsk, confirmRealOrder }` | After explicit confirmation and backend checks, submits a real Binance USDT-quoted market buy and records the result in that user's portfolio. Maximum spend is 1,000 USDT per order. |
| `analyzeWatchlist` (legacy callable) | `{ coins, requestedAt, instruction }` | Sends validated market data to OpenAI and returns `{ analysis }`. The current dashboard instead uses the HTTP analysis contract below. |

CoinGecko supplies discovery, watchlist prices, market chart history, and market metadata. Binance supplies account balances, order book quotes, and confirmed Spot orders. OpenAI receives the selected watchlist assets plus CoinGecko market data and derived indicators; it does not submit orders.

Real Binance buys through the user-key callable are **not simulated**. They check the reviewed ask against the live ask (maximum 1% movement), check visible top-five ask depth and available USDT plus a fee reserve, then submit a real market order. The shared-account HTTP order API below is a separate execution path and uses server-side shared credentials.

## Shared Binance HTTP API

The Firebase HTTPS function `binanceApi` is deployed in `asia-east1`; its base URL is `https://asia-east1-mytradingapp-50d29.cloudfunctions.net/binanceApi`. It requires `Authorization: Bearer <Firebase ID token>` on every API route, verifies the token including revocation, and uses the decoded UID for the per-user status lookup. The account and order endpoints use one shared Binance account for all authenticated users.

| Method and route | Behavior |
|---|---|
| `GET /ip` | Returns the function runtime's observed egress IP via ipify. This diagnostic does not guarantee a fixed IP. |
| `GET /api/binance/status` | Returns whether the signed-in user's `users/{uid}/integrations/binance` document has `enabled: true`. This flag does not validate the shared Binance credentials. |
| `GET /api/binance/account` | Reads the shared Binance Spot account. Returns non-zero balances with free and locked quantities, sorted by quantity sum and capped at 100. No fiat conversion is provided. |
| `GET /api/market-trends/tickers` | Returns CoinGecko market rows with source, category, and fetch-time metadata. Use `?category=DeFi` (or another supported UI category) to filter. |
| `GET /api/coingecko/history/:id?days=7` | Returns sampled CoinGecko price/volume history for a known market or watchlist coin. Supported `days`: 1, 7, 30, 90, 365. |
| `POST /api/analysis/watchlist` | Analyzes 1–20 symbols from the signed-in user's saved watchlist. Request body: `{ "symbols": ["BTCUSDT"] }`; omit `symbols` to analyze the full saved watchlist if it contains at most 20 symbols. |
| `POST /api/binance/order` | Submits an explicitly confirmed shared-account market buy or sell after checking free balance. The Settings UI calls this route after the user reviews and confirms a real order. |

The analysis response contains `requestId`, `generatedAt`, `source`, `timeframe`, `informationalOnly`, `overview`, and `results`. Each result includes the symbol, trend, momentum summary, supporting indicators, risks, timeframe summaries, explanation, data completeness, and freshness metadata. Market data is fetched server-side from CoinGecko using market rows and sampled market-chart history. Partial/unavailable data is marked in the result. Backend-generated commentary is informational only.

The route reads the authenticated user's `watchlist` array from `users/{uid}` and verifies requested symbols against it. For existing accounts, it reconciles this field from the legacy `users/{uid}/favorites/{symbol}` documents before analysis. The frontend keeps the profile array and favorites subcollection in sync when a favorite is added or removed.

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

The server-side order gate is `functions/config/trading.json`. It defaults to `live_spot_orders_enabled: false`; the UI can send a reviewed order, but the backend rejects it until that flag is explicitly enabled and redeployed. Any authenticated Firebase user can submit real orders against the same account when enabled. `confirm: true` is a deliberate-submit check, not an authorization boundary. Keep withdrawals, margin, and futures permissions disabled.

Market discovery and watchlist data require a CoinGecko API key stored as the `COINGECKO_API_KEY` Firebase secret. Binance data remains limited to exchange/account and order paths.

The watchlist analysis endpoint is the OpenAI-backed backend route `POST /api/analysis/watchlist`; the Angular app does not need an OpenAI key, does not send one, and does not expose one in the browser. `BINANCE_API_KEY` and `BINANCE_SECRET` are distinct from `BINANCE_CREDENTIALS_KEK`, which is used by per-user callable integration. The shared Binance API key needs account-read and Spot Trading permissions for account reads and orders.

### Errors and CORS

The HTTP API returns JSON `{ "statusCode": number, "message": string, "error": string }`. Statuses include `401` for missing/invalid/revoked Firebase tokens; `400` for invalid requests or insufficient balance; `409` for duplicate/conflicting or pending/uncertain order IDs; `503` for unavailable credentials or disabled/missing live-order configuration; `502` for Binance/network failures; and `500` for unexpected failures.

The HTTP and callable CORS allowlists include localhost ports, the Firebase Hosting origins, and `https://tradingdashboard--mytradingapp-50d29.asia-east1.hosted.app`. Callable Functions use the `asia-east1` default region. CORS and region changes take effect only after deploying the updated Functions.

## Firebase Authentication and Firestore

The app uses Firebase Email/Password Authentication. Signed-in user data is stored under:

| Firestore path | Data |
|---|---|
| `users/{uid}` field `watchlist` | Array of saved symbols used by the analysis API; synchronized with the favorites subcollection. |
| `users/{uid}/favorites/{symbol}` | Favorite symbol and added timestamp. |
| `users/{uid}/portfolio/{entryId}` | Simulated holding or server-recorded Binance buy. |
| `users/{uid}/wallet/main` | Simulated USDT play-funds balance. |
| `users/{uid}/integrations/binance` | Encrypted Binance credentials, accessed by trusted backend code. |

Favorites, wallet, and simulated portfolio operations use the Firebase client SDK and Firestore security rules; they are not HTTP API endpoints. Simulated sells update the holding quantity and credit sale proceeds to the simulated wallet in a Firestore transaction. They do not submit Binance sell orders.

The shared HTTP API has a separate real Binance `SELL` route at `POST /api/binance/order`; there is no corresponding per-user Firebase callable sell function. The callable `buyBinanceMarket` continues to use the signed-in user's individually linked Binance credentials, while the HTTP order route uses the shared server-side account.

## External service credentials

The OpenAI-backed watchlist analysis route is server-side by Cloud Functions. The per-user callable Binance API secret is encrypted before it is stored in Firestore. The shared HTTP API uses separate `BINANCE_API_KEY` and `BINANCE_SECRET` Secret Manager values. Do not put any backend keys in the Angular environment or expose them to the browser. The Firebase web-app configuration in `src/environments/environment.ts` identifies the client app; it is not a Firebase service-account key.
