# CryptoIntel Angular frontend

See the [project README](../README.md) for Firebase setup, wallet behavior, Binance API-key permissions, real-order flow, and OpenAI function setup.

Run locally:

```sh
npm install
npm start
```

Email/Password Firebase Authentication is required for personal data and callable functions. Binance public market data works without linking an exchange account. The app starts in simulated-wallet mode; Binance account linking and real orders require the backend functions and secrets to be deployed.

Market trends use Binance Spot USDT ticker and candlestick data only. Volume tiers are based on relative 24-hour quote-volume rank, not market capitalization. Binance Spot does not provide market-cap, circulating-supply, meme-token, or recently-listed metadata.
