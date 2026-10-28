import { Injectable } from '@angular/core';

export interface Coin { symbol: string; base: string; name: string; price: number; change: number; quoteVolume: number; high: number; low: number; }
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; quoteVolume: number; }
export interface OrderBook { bids: Array<{ price: number; amount: number }>; asks: Array<{ price: number; amount: number }>; }
export interface TrendMetric { coin: Coin; volumeRatio: number; breakout: boolean; }

const names: Record<string, string> = { BTC:'Bitcoin', ETH:'Ethereum', USDT:'Tether', BNB:'BNB', SOL:'Solana', XRP:'XRP', USDC:'USD Coin', DOGE:'Dogecoin', ADA:'Cardano', TRX:'TRON', AVAX:'Avalanche', LINK:'Chainlink', DOT:'Polkadot', LTC:'Litecoin', BCH:'Bitcoin Cash', SUI:'Sui', SHIB:'Shiba Inu', TON:'Toncoin', UNI:'Uniswap', XLM:'Stellar' };
const api = 'https://api.binance.com/api/v3';

@Injectable({ providedIn: 'root' })
export class MarketDataService {
  private cache: Coin[] = [];
  async getTickers(): Promise<Coin[]> {
    const response = await fetch(`${api}/ticker/24hr`);
    if (!response.ok) throw new Error(`Binance returned ${response.status}. Public market data is temporarily unavailable.`);
    const rows = await response.json() as Array<Record<string, string>>;
    this.cache = rows.filter(row => row['symbol'].endsWith('USDT') && !row['symbol'].includes('_')).map(row => {
      const base = row['symbol'].slice(0, -4);
      return { symbol: row['symbol'], base, name: names[base] ?? base, price: Number(row['lastPrice']), change: Number(row['priceChangePercent']), quoteVolume: Number(row['quoteVolume']), high: Number(row['highPrice']), low: Number(row['lowPrice']) };
    }).filter(row => Number.isFinite(row.price)).sort((a,b) => b.quoteVolume - a.quoteVolume);
    return this.cache;
  }
  get cachedTickers(): Coin[] { return this.cache; }
  async getOrderBook(symbol: string): Promise<OrderBook> {
    const response = await fetch(`${api}/depth?symbol=${encodeURIComponent(symbol)}&limit=5`);
    if (!response.ok) throw new Error(`Order book for ${symbol} is unavailable.`);
    const data = await response.json() as { bids: Array<[string,string]>; asks: Array<[string,string]> };
    return { bids:data.bids.map(([price,amount]) => ({price:Number(price),amount:Number(amount)})), asks:data.asks.map(([price,amount]) => ({price:Number(price),amount:Number(amount)})) };
  }
  async getCandles(symbol: string, interval = '1d', limit = 90): Promise<Candle[]> {
    const response = await fetch(`${api}/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
    if (!response.ok) throw new Error(`Candle history for ${symbol} is unavailable.`);
    const rows = await response.json() as Array<Array<number | string>>;
    return rows.map(row => ({ time:Number(row[0]), open:Number(row[1]), high:Number(row[2]), low:Number(row[3]), close:Number(row[4]), volume:Number(row[5]), quoteVolume:Number(row[7]) }));
  }
  async getTrendMetrics(coins: Coin[]): Promise<TrendMetric[]> {
    const candidates = coins.slice(0, 80);
    const output: TrendMetric[] = new Array(candidates.length);
    let cursor = 0;
    const workers = Array.from({ length: 5 }, async () => {
      while (cursor < candidates.length) {
        const index = cursor++;
        const coin = candidates[index];
        try {
          const candles = await this.getCandles(coin.symbol, '4h', 8);
          const baseline = candles.slice(0, -1).map(candle => candle.quoteVolume).filter(value => value > 0);
          const average = baseline.reduce((sum, value) => sum + value, 0) / (baseline.length || 1);
          output[index] = { coin, volumeRatio: average ? (candles.at(-1)?.quoteVolume ?? 0) / average : 0, breakout: candles.length >= 2 && coin.price > Math.max(...candles.slice(0, -1).map(candle => candle.high)) };
        } catch { output[index] = { coin, volumeRatio: 0, breakout: false }; }
      }
    });
    await Promise.all(workers);
    return output;
  }
  top(count = 10): Coin[] { return this.cache.slice(0, count); }
}

export function ema(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1); const result = [values[0]];
  for (let i = 1; i < values.length; i++) result.push(values[i] * k + result[i - 1] * (1 - k));
  return result;
}
export function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) { const change = values[i] - values[i - 1]; if (change > 0) gains += change; else losses -= change; }
  if (!losses) return 100;
  return 100 - 100 / (1 + gains / losses);
}
