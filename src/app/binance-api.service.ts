import { inject, Injectable, InjectionToken } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { environment } from '../environments/environment';
import { firebaseApp, firebaseAuth } from './firebase-client';

interface FirebaseTokenUser {
  getIdToken(): Promise<string>;
}

export const FIREBASE_API_USER = new InjectionToken<() => FirebaseTokenUser | null>(
  'FIREBASE_API_USER',
  { providedIn: 'root', factory: () => () => firebaseAuth?.currentUser ?? null },
);

export interface BinanceApiStatus {
  connected: boolean;
}

export interface BinanceBalance {
  asset: string;
  free: number;
  locked: number;
}

export interface BinanceApiAccount {
  connected: true;
  balances: BinanceBalance[];
}

export interface CoinGeckoMarketRow {
  id: string;
  symbol: string;
  name: string;
  marketCap: number | null;
  rank: number | null;
  price: number | null;
  change24h: number | null;
  volume24h: number | null;
  updatedAt: string | null;
}

export interface CoinGeckoMarketData {
  largeCap: CoinGeckoMarketRow[];
  midCap: CoinGeckoMarketRow[];
  smallCap: CoinGeckoMarketRow[];
  meme: CoinGeckoMarketRow[];
  newCoins: Array<{ id: string; symbol: string; name: string }>;
  fetchedAt: string;
}

export interface CryptoCategoryData {
  tagsBySymbol: Record<string, string[]>;
  ambiguousSymbols: string[];
  categories: Array<{ tag: string; categoryId: string | null }>;
  fetchedAt: string;
}

export interface SharedBinanceOrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  quoteOrderQty?: string;
  quantity?: string;
  clientOrderId: string;
  confirm: true;
}

export interface SharedBinanceOrder {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET';
  status: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  transactTime?: number;
  replayed: boolean;
}

export interface WatchlistAnalysisResult {
  symbol: string;
  trend: 'bullish' | 'neutral' | 'bearish' | 'unavailable';
  momentumSummary: string;
  supportingIndicators: {
    lastPrice: number | null;
    change24hPercent: number | null;
    volume24h: number | null;
    ema20: number | null;
    ema50: number | null;
    rsi14: number | null;
    latestCandleClose: number | null;
  };
  risks: string[];
  timeframeSummaries: Array<{ timeframe: string; summary: string }>;
  explanation: string;
  dataStatus: 'complete' | 'partial' | 'unavailable';
  dataFreshness: {
    source: string;
    fetchedAt: string;
    tickerAsOf: string | null;
    candlesAsOf: string | null;
    stale: boolean;
    candleCount: number;
  };
}

export interface WatchlistAnalysis {
  requestId: string;
  generatedAt: string;
  source: string;
  timeframe: string;
  informationalOnly: boolean;
  overview: string;
  results: WatchlistAnalysisResult[];
}

export class BinanceApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'BinanceApiError';
  }
}

@Injectable({ providedIn: 'root' })
export class BinanceApiService {
  private readonly currentUser = inject(FIREBASE_API_USER);

  async getStatus(): Promise<BinanceApiStatus> {
    if (!firebaseApp || !this.currentUser()) {
      throw new Error('Sign in before requesting Binance data.');
    }
    const result = await httpsCallable<void, BinanceApiStatus>(
      getFunctions(firebaseApp, 'asia-east1'),
      'getBinanceStatus',
    )();
    return result.data;
  }

  async getHttpStatus(): Promise<BinanceApiStatus> {
    return this.get<BinanceApiStatus>('/api/binance/status');
  }

  async getEgressIp(): Promise<{ ip: string }> {
    return this.get<{ ip: string }>('/ip');
  }

  async getAccount(): Promise<BinanceApiAccount> {
    return this.get<BinanceApiAccount>('/api/binance/account');
  }

  async placeSharedOrder(order: SharedBinanceOrderRequest): Promise<SharedBinanceOrder> {
    return this.post<SharedBinanceOrder>('/api/binance/order', order);
  }

  async getMarketCapData(): Promise<CoinGeckoMarketData> {
    return this.call<CoinGeckoMarketData>('getMarketCapData');
  }

  async getCryptoCategories(): Promise<CryptoCategoryData> {
    return this.call<CryptoCategoryData>('getCryptoCategories');
  }

  async analyzeWatchlist(symbols: string[]): Promise<WatchlistAnalysis> {
    if (symbols.length < 1 || symbols.length > 20) {
      throw new Error('Choose between 1 and 20 watchlist assets to analyze.');
    }
    return this.post<WatchlistAnalysis>('/api/analysis/watchlist', { symbols });
  }

  private async call<T>(name: string): Promise<T> {
    if (!firebaseApp || !this.currentUser()) {
      throw new Error('Sign in before requesting market data.');
    }
    const result = await httpsCallable<void, T>(getFunctions(firebaseApp, 'asia-east1'), name)();
    return result.data;
  }

  private async get<T>(path: string): Promise<T> {
    const user = this.currentUser();
    if (!user) throw new Error('Sign in before requesting Binance data.');

    const token = await user.getIdToken();
    let response: Response;
    try {
      response = await fetch(`${environment.binanceApiUrl.replace(/\/+$/, '')}${path}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      throw new Error('Could not connect to the Binance account service. Check your connection and retry.');
    }

    return this.readResponse<T>(response, 'Binance account credentials are unavailable on the server. Contact support.');
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const user = this.currentUser();
    if (!user) throw new Error('Sign in before requesting watchlist analysis.');

    const token = await user.getIdToken();
    let response: Response;
    try {
      response = await fetch(`${environment.binanceApiUrl.replace(/\/+$/, '')}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('Could not connect to the analysis service. Check your connection and retry.');
    }
    return this.readResponse<T>(response);
  }

  private async readResponse<T>(response: Response, unavailableMessage?: string): Promise<T> {
    if (!response.ok) {
      let body: { message?: string | string[] } = {};
      try {
        body = await response.json() as typeof body;
      } catch {
        body = {};
      }
      const message = response.status === 401
        ? 'Your Firebase session expired. Sign in again and retry.'
        : Array.isArray(body.message)
          ? body.message.join(' ')
          : body.message ?? (response.status === 503
            ? unavailableMessage ?? 'The requested service is temporarily unavailable.'
            : `API request failed (${response.status}).`);
      throw new BinanceApiError(message, response.status);
    }
    return await response.json() as T;
  }
}
