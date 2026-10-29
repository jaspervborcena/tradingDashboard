import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { EMPTY, of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { BinanceApiService } from './binance-api.service';
import { DashboardPage } from './dashboard-page.component';
import { FirestoreDataService } from './firestore-data.service';
import { MarketDataService } from './market-data.service';

describe('DashboardPage Binance portfolio balances', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('uses synced balances instead of Binance buy entries and excludes their unknown basis from P&L', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ActivatedRoute, useValue: { data: of({ page: 'portfolio' }), paramMap: EMPTY } },
        { provide: BinanceApiService, useValue: {} },
        { provide: FirestoreDataService, useValue: {} },
        { provide: MarketDataService, useValue: {} },
      ],
    });
    const page = TestBed.runInInjectionContext(() => new DashboardPage());
    page.coins.set([{
      symbol: 'BTCUSDT',
      base: 'BTC',
      name: 'Bitcoin',
      price: 500,
      change: 0,
      quoteVolume: 0,
      high: 500,
      low: 500,
    }]);
    page.holdings.set([
      { id: 'paper-1', symbol: 'BTCUSDT', name: 'Bitcoin', quantity: 1, buyPrice: 400, boughtAt: '2026-01-01', source: 'paper' },
      { id: 'binance-1', symbol: 'BTCUSDT', name: 'Bitcoin', quantity: 0.1, buyPrice: 200, boughtAt: '2026-01-01', source: 'binance' },
    ]);
    page.binanceBalances.set([{ asset: 'BTC', free: 0.2, locked: 0 }]);
    page.binanceBalancesSyncedAt.set('2026-10-29T05:30:00.000Z');

    expect(page.portfolioTradeEntries.map(holding => holding.id)).toEqual(['paper-1']);
    expect(page.importedBinanceBalances).toHaveLength(1);
    expect(page.portfolioValue).toBe(600);
    expect(page.portfolioInvested).toBe(400);
    expect(page.portfolioPnl).toBe(100);
  });
});
