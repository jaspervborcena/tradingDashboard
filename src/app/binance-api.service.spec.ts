import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BinanceApiError, BinanceApiService, FIREBASE_API_USER } from './binance-api.service';

describe('BinanceApiService', () => {
  let service: BinanceApiService;
  let currentUser: { getIdToken: () => Promise<string> } | null;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    currentUser = { getIdToken: vi.fn().mockResolvedValue('test-firebase-id-token') };
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({
      providers: [
        BinanceApiService,
        { provide: FIREBASE_API_USER, useValue: () => currentUser },
      ],
    });
    service = TestBed.inject(BinanceApiService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('sends a fresh Firebase ID token to the deployed status endpoint', async () => {
    fetchMock.mockResolvedValue(new Response('{"connected":false}', { status: 200 }));

    await expect(service.getStatus()).resolves.toEqual({ connected: false });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://asia-east1-mytradingapp-50d29.cloudfunctions.net/binanceApi/api/binance/status',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer test-firebase-id-token' },
      },
    );
  });

  it('returns shared Binance balances without converting asset quantities', async () => {
    const account = {
      connected: true,
      balances: [
        { asset: 'BTC', free: 0.125, locked: 0 },
        { asset: 'USDT', free: 250, locked: 10 },
      ],
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(account), { status: 200 }));

    await expect(service.getAccount()).resolves.toEqual(account);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://asia-east1-mytradingapp-50d29.cloudfunctions.net/binanceApi/api/binance/account',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-firebase-id-token' },
      }),
    );
  });

  it('does not make a request without a signed-in Firebase user', async () => {
    currentUser = null;

    await expect(service.getAccount()).rejects.toThrow('Sign in before requesting Binance data.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns an expired Firebase session response into a sign-in message', async () => {
    fetchMock.mockResolvedValue(new Response(
      '{"statusCode":401,"message":"The Firebase ID token is invalid or expired.","error":"Unauthorized"}',
      { status: 401 },
    ));

    await expect(service.getStatus()).rejects.toMatchObject({
      name: 'BinanceApiError',
      status: 401,
      message: 'Your Firebase session expired. Sign in again and retry.',
    } satisfies Partial<BinanceApiError>);
  });
});
