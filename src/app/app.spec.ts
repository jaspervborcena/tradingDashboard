import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { App } from './app';
import { AuthService } from './auth.service';
import { firebaseConfigured } from './firebase-client';
import {
  candleCloseDate,
  eventDate,
  isoUtcQueryBound,
  normalizeProfileName,
  profileDisplayLabel,
  profileStrategySummary,
  type EventRecord,
  type RiskProfile,
} from './firestore-data.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{
        provide: AuthService,
        useValue: {
          user: signal(null),
          loading: signal(false),
          signIn: vi.fn(),
          createAccount: vi.fn(),
          signOut: vi.fn(),
        },
      }],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('renders the authenticated sign-in screen', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h2')?.textContent).toContain('Sign in');
    expect(compiled.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(!firebaseConfigured);

    const createAccountButton = [...compiled.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Create account'));
    createAccountButton?.click();
    fixture.detectChanges();
    expect(compiled.querySelector('h2')?.textContent).toContain('Create account');
    expect(compiled.querySelector('#confirm-password')).not.toBeNull();
  });

  it('creates inclusive UTC string bounds for captured_at ranges', () => {
    const date = new Date('2026-10-09T17:07:27.581Z');
    expect(isoUtcQueryBound(date)).toBe('2026-10-09T17:07:27.581+00:00');
    expect(isoUtcQueryBound(date, true)).toBe('2026-10-09T17:07:27.581999+00:00');
  });

  it('keeps observation capture time distinct from candle close time', () => {
    const observation: EventRecord = {
      id: 'observation-1',
      captured_at: '2026-10-09T13:07:53.718204+00:00',
      candle: { close_time: '2026-10-09T13:06:59.999000+00:00' },
    };

    expect(eventDate(observation)?.toISOString()).toBe('2026-10-09T13:07:53.718Z');
    expect(candleCloseDate(observation)?.toISOString()).toBe('2026-10-09T13:06:59.999Z');
  });

  it('normalizes risk profile names and summarises thresholds', () => {
    const profile: RiskProfile = {
      id: 'high',
      profile_name: 'High',
      enabled: true,
      symbols: ['SOLUSDT', 'AVAXUSDT'],
      strategy: {
        sma_fast: 3,
        sma_slow: 10,
        rsi_period: 14,
        min_confidence_score: 75,
      },
    };

    expect(normalizeProfileName(profile)).toBe('high');
    expect(profileDisplayLabel(profile)).toBe('High Risk');
    expect(profileStrategySummary(profile)).toBe('SMA 3/10 · RSI 14 · Min conf 75');

    const lowRisk: RiskProfile = { id: 'low', profile_name: 'low', enabled: true, symbols: ['BTCUSDT', 'ETHUSDT'] };
    expect(normalizeProfileName(lowRisk)).toBe('low');
    expect(profileDisplayLabel(lowRisk)).toBe('Low Risk');

    const legacyLowRisk: RiskProfile = { id: 'small', profile_name: 'small', enabled: true, symbols: ['BTCUSDT', 'ETHUSDT'] };
    expect(normalizeProfileName(legacyLowRisk)).toBe('low');
    expect(profileDisplayLabel(legacyLowRisk)).toBe('Low Risk');
  });
});
