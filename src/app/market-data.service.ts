import { inject, Injectable } from '@angular/core';
import { BinanceApiService } from './binance-api.service';

export interface Coin { id: string; symbol: string; base: string; name: string; price: number; change: number; quoteVolume: number; high: number; low: number; marketCap: number | null; marketCapRank: number | null; circulatingSupply: number | null; categories: string[]; tradeable: boolean; sparkline: number[]; }
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; quoteVolume: number; }
export interface OrderBook { bids: Array<{ price: number; amount: number }>; asks: Array<{ price: number; amount: number }>; }
export interface TrendMetric { coin: Coin; volumeRatio: number; breakout: boolean; }

const api = 'https://api.binance.com/api/v3';

@Injectable({ providedIn: 'root' })
export class MarketDataService {
  private readonly binanceApi = inject(BinanceApiService);
  private cache: Coin[] = [];
  async getTickers(category?: string): Promise<Coin[]> {
    const response = await this.binanceApi.getMarketTrendTickers(category);
    const loaded=response.tickers.map(ticker=>({id:ticker.id,symbol:ticker.symbol,base:ticker.base,name:ticker.name,price:ticker.lastPrice,change:ticker.priceChangePercent,quoteVolume:ticker.quoteVolume,high:ticker.highPrice,low:ticker.lowPrice,marketCap:ticker.marketCap,marketCapRank:ticker.marketCapRank,circulatingSupply:ticker.circulatingSupply,categories:ticker.categories,tradeable:ticker.tradeable,sparkline:ticker.sparkline}));
    const merged=new Map([...this.cache,...loaded].map(coin=>[coin.symbol,coin]));
    this.cache=[...merged.values()];
    return loaded.sort((a,b)=>(a.marketCapRank??Number.MAX_SAFE_INTEGER)-(b.marketCapRank??Number.MAX_SAFE_INTEGER));
  }
  get cachedTickers(): Coin[] { return this.cache; }
  async getOrderBook(symbol: string): Promise<OrderBook> {
    const response = await fetch(`${api}/depth?symbol=${encodeURIComponent(symbol)}&limit=5`);
    if (!response.ok) throw new Error(`Order book for ${symbol} is unavailable.`);
    const data = await response.json() as { bids: Array<[string,string]>; asks: Array<[string,string]> };
    return { bids:data.bids.map(([price,amount]) => ({price:Number(price),amount:Number(amount)})), asks:data.asks.map(([price,amount]) => ({price:Number(price),amount:Number(amount)})) };
  }
  async getCandles(symbol: string, interval = '1d', limit = 90): Promise<Candle[]> {
    const coin=this.cache.find(item=>item.symbol===symbol);
    if(!coin)throw new Error(`CoinGecko history mapping for ${symbol} is unavailable. Refresh the market list.`);
    let days:number;
    if(interval==='1d'&&limit===90)days=1;
    else if(interval==='1w'&&limit===90)days=7;
    else if(interval==='1M'&&limit===90)days=30;
    else {
      const minutes=interval==='15m'?15:interval==='1h'?60:interval==='4h'?240:interval==='1d'?1440:interval==='1w'?10080:interval==='1M'?43200:1440;
      const requested=Math.ceil(minutes*limit/1440);
      days=requested<=1?1:requested<=7?7:requested<=30?30:requested<=90?90:365;
    }
    const response=await this.binanceApi.getCoinGeckoHistory(coin.id,days);
    return response.candles;
  }
  async getTrendMetrics(coins: Coin[]): Promise<TrendMetric[]> {
    const candidates = [...coins].sort((a,b)=>b.quoteVolume-a.quoteVolume).slice(0, 20);
    const output: TrendMetric[] = new Array(candidates.length);
    let cursor = 0;
    const workers = Array.from({ length: 5 }, async () => {
      while (cursor < candidates.length) {
        const index = cursor++;
        const coin = candidates[index];
        try {
          const candles = await this.getCandles(coin.symbol, '1d', 7);
          const baseline = candles.slice(0, -1).map(candle => candle.quoteVolume).filter(value => value > 0);
          const average = baseline.reduce((sum, value) => sum + value, 0) / (baseline.length || 1);
          const sparkline = coin.sparkline.slice(0, -1);
          output[index] = { coin, volumeRatio: average ? (candles.at(-1)?.quoteVolume ?? 0) / average : 0, breakout: sparkline.length > 0 && coin.price > Math.max(...sparkline) };
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
