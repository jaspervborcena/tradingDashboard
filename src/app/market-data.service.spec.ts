import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketDataService } from './market-data.service';

describe('MarketDataService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads public Binance tickers directly and ranks USDT pairs by quote volume', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { symbol: 'ETHUSDT', lastPrice: '2000', priceChangePercent: '2', quoteVolume: '200', highPrice: '2100', lowPrice: '1900' },
      { symbol: 'BTCUSDT', lastPrice: '60000', priceChangePercent: '1', quoteVolume: '500', highPrice: '61000', lowPrice: '59000' },
      { symbol: 'BTCFDUSD', lastPrice: '60000', priceChangePercent: '1', quoteVolume: '900', highPrice: '61000', lowPrice: '59000' },
      { symbol: 'BADUSDT', lastPrice: 'invalid', priceChangePercent: '1', quoteVolume: '1000', highPrice: '2', lowPrice: '1' },
    ]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new MarketDataService();

    await expect(service.getTickers()).resolves.toEqual([
      { symbol: 'BTCUSDT', base: 'BTC', name: 'Bitcoin', price: 60000, change: 1, quoteVolume: 500, high: 61000, low: 59000 },
      { symbol: 'ETHUSDT', base: 'ETH', name: 'Ethereum', price: 2000, change: 2, quoteVolume: 200, high: 2100, low: 1900 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('https://api.binance.com/api/v3/ticker/24hr');
  });
});
