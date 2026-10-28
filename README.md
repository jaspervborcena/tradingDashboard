# CryptoIntel Angular frontend

See the [project README](../README.md) for Firebase setup, wallet behavior, Binance API-key permissions, real-order flow, and OpenAI function setup.

Run locally:

```sh
npm install
npm start
```

Email/Password Firebase Authentication is required for personal data and callable functions. Binance public market data works without linking an exchange account. The app starts in simulated-wallet mode; Binance account linking and real orders require the backend functions and secrets to be deployed.

Market trends use Binance Spot USDT ticker and candlestick data only. Volume tiers are based on relative 24-hour quote-volume rank, not market capitalization. Binance Spot does not provide market-cap, circulating-supply, meme-token, or recently-listed metadata.

## Shared Binance account API

The read-only `binanceApi` HTTPS function in `asia-east1` is configured in `src/environments/environment.ts`. The Settings page sends a fresh Firebase ID token to its `/api/binance/status` and `/api/binance/account` routes. Status reflects the signed-in user's Firestore Binance integration flag; account balances come from the server's shared Binance account and are visible to every authenticated user. The Binance API credentials stay server-side. The UI displays free and locked quantities separately and does not convert or sum them into an account value.

Run the API client tests with:

```sh
npm test -- --watch=false
```
