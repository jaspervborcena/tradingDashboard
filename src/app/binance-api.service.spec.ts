import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BinanceApiError, BinanceApiService, FIREBASE_API_USER } from './binance-api.service';

const { getFunctionsMock, httpsCallableMock, callableMock } = vi.hoisted(() => ({
  getFunctionsMock: vi.fn(),
  httpsCallableMock: vi.fn(),
  callableMock: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: getFunctionsMock,
  httpsCallable: httpsCallableMock,
}));

describe('BinanceApiService', () => {
  let service: BinanceApiService;
  let currentUser: { getIdToken: () => Promise<string> } | null;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    currentUser = { getIdToken: vi.fn().mockResolvedValue('test-firebase-id-token') };
    fetchMock = vi.fn();
    getFunctionsMock.mockClear();
    httpsCallableMock.mockClear();
    getFunctionsMock.mockReturnValue('functions-instance');
    httpsCallableMock.mockReturnValue(callableMock);
    callableMock.mockReset();
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

  it('calls the status function in asia-east1', async () => {
    callableMock.mockResolvedValue({ data: { connected: false } });

    await expect(service.getStatus()).resolves.toEqual({ connected: false });
    expect(getFunctionsMock.mock.calls[0]?.[1]).toBe('asia-east1');
    expect(httpsCallableMock.mock.calls[0]?.[1]).toBe('getBinanceStatus');
    expect(callableMock).toHaveBeenCalledOnce();
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
        method: 'GET',
        headers: { Authorization: expect.stringMatching(/^Bearer /) },
      }),
    );
  });

  it('uses the authenticated shared-account status and egress diagnostic routes', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"connected":true}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"ip":"203.0.113.1"}', { status: 200 }));

    await expect(service.getHttpStatus()).resolves.toEqual({ connected: true });
    await expect(service.getEgressIp()).resolves.toEqual({ ip: '203.0.113.1' });
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      'https://asia-east1-mytradingapp-50d29.cloudfunctions.net/binanceApi/api/binance/status',
      'https://asia-east1-mytradingapp-50d29.cloudfunctions.net/binanceApi/ip',
    ]);
  });

  it('gets Binance Spot tickers through the authenticated Market Trends API', async () => {
    const marketData = {
      source: 'Binance Spot',
      fetchedAt: '2026-10-28T12:00:00.000Z',
      tickers: [{
        symbol: 'BTCUSDT',
        lastPrice: 67000,
        openPrice: 66000,
        priceChangePercent: 1.25,
        volume: 123.45,
        quoteVolume: 12345.6,
        highPrice: 67500,
        lowPrice: 66000,
        closeTime: '2026-10-28T12:00:00.000Z',
      }],
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(marketData), { status: 200 }));

    await expect(service.getMarketTrendTickers()).resolves.toEqual(marketData);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://asia-east1-mytradingapp-50d29.cloudfunctions.net/binanceApi/api/market-trends/tickers',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: expect.stringMatching(/^Bearer test-firebase-id-token$/) },
      }),
    );
  });

  it('posts the selected watchlist symbols to the analysis endpoint', async () => {
    const report = { requestId: 'request-1', overview: 'Market overview', results: [] };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(report), { status: 200 }));

    await expect(service.analyzeWatchlist(['BTCUSDT'])).resolves.toEqual(report);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://asia-east1-mytradingapp-50d29.cloudfunctions.net/binanceApi/api/analysis/watchlist',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: expect.stringMatching(/^Bearer /),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ symbols: ['BTCUSDT'] }),
      }),
    );
  });

  it('submits a shared live order to the authenticated order endpoint', async () => {
    const request = {
      symbol: 'BTCUSDT',
      side: 'SELL' as const,
      quantity: '0.01',
      clientOrderId: '550e8400-e29b-41d4-a716-446655440001',
      confirm: true as const,
    };
    const order = {
      symbol: 'BTCUSDT',
      orderId: 123,
      clientOrderId: request.clientOrderId,
      side: 'SELL',
      type: 'MARKET',
      status: 'FILLED',
      executedQty: '0.01',
      cummulativeQuoteQty: '650',
      replayed: false,
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(order), { status: 200 }));

    await expect(service.placeSharedOrder(request)).resolves.toEqual(order);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://asia-east1-mytradingapp-50d29.cloudfunctions.net/binanceApi/api/binance/order',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: expect.stringMatching(/^Bearer /) }),
        body: JSON.stringify(request),
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

    await expect(service.getAccount()).rejects.toMatchObject({
      name: 'BinanceApiError',
      status: 401,
      message: 'Your Firebase session expired. Sign in again and retry.',
    } satisfies Partial<BinanceApiError>);
  });
});
