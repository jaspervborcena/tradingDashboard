import { inject, Injectable, InjectionToken } from '@angular/core';
import { environment } from '../environments/environment';
import { firebaseAuth } from './firebase-client';

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
    return this.get<BinanceApiStatus>('/api/binance/status');
  }

  async getAccount(): Promise<BinanceApiAccount> {
    return this.get<BinanceApiAccount>('/api/binance/account');
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

    if (!response.ok) {
      let body: { message?: string | string[] } = {};
      try {
        body = await response.json() as typeof body;
      } catch {
        body = {};
      }

      const message = response.status === 401
        ? 'Your Firebase session expired. Sign in again and retry.'
        : response.status === 503
          ? 'Binance account credentials are unavailable on the server. Contact support.'
          : response.status === 502
            ? 'Binance could not return account data. Try again.'
            : Array.isArray(body.message)
              ? body.message.join(' ')
              : body.message ?? `Binance API request failed (${response.status}).`;
      throw new BinanceApiError(message, response.status);
    }

    return await response.json() as T;
  }
}
