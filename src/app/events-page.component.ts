import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import {
  asRecord,
  candleCloseDate,
  describeFirestoreError,
  eventDate,
  FirestoreDataService,
  isObservation,
  type EventFilters,
  type EventKind,
  type EventRecord,
} from './firestore-data.service';

@Component({
  selector: 'app-events-page',
  imports: [CommonModule, FormsModule],
  templateUrl: './events-page.component.html',
  styleUrl: './events-page.component.css',
})
export class EventsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(FirestoreDataService);
  readonly kind = signal<EventKind>('markets');
  readonly records = signal<EventRecord[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly hasMore = signal(false);
  symbol = '';
  profile = '';
  timeframe = '';
  side = '';
  strategy = '';
  status = '';
  rangeDays = '7';
  private cursor: QueryDocumentSnapshot<DocumentData> | null = null;

  constructor() {
    this.route.data.subscribe((data) => {
      const kind = data['kind'];
      this.kind.set(kind === 'signals' ? 'signals' : 'markets');
      void this.load(true);
    });
    this.route.queryParamMap.subscribe((params) => {
      this.symbol = params.get('symbol') ?? '';
      this.profile = params.get('profile') ?? '';
      this.side = params.get('side') ?? '';
      this.status = params.get('status') ?? '';
      this.rangeDays = params.get('days') ?? '7';
      if (this.kind()) void this.load(true);
    });
  }

  get isSignals(): boolean {
    return this.kind() === 'signals';
  }

  get title(): string {
    return this.isSignals ? 'Signals' : 'Markets';
  }

  async load(reset: boolean): Promise<void> {
    if (reset) {
      this.cursor = null;
      this.records.set([]);
    }
    this.loading.set(true);
    this.error.set('');
    try {
      const filters: EventFilters = {
        symbol: this.symbol.trim() || undefined,
        profile: this.profile.trim() || undefined,
        timeframe: this.timeframe || undefined,
        side: this.side || undefined,
        strategy: this.strategy.trim() || undefined,
        status: this.status || undefined,
        from: new Date(Date.now() - Number(this.rangeDays) * 24 * 60 * 60 * 1000),
        to: new Date(),
      };
      const page = await this.data.getEventPage(this.kind(), filters, this.cursor);
      this.cursor = page.cursor;
      this.records.update((records) => [...records, ...page.records]);
      this.hasMore.set(page.hasMore);
    } catch (error) {
      this.error.set(describeFirestoreError(error));
    } finally {
      this.loading.set(false);
    }
  }

  clearFilters(): void {
    this.symbol = '';
    this.profile = '';
    this.timeframe = '';
    this.side = '';
    this.strategy = '';
    this.status = '';
    this.rangeDays = '7';
    void this.load(true);
  }

  candle(record: EventRecord): Record<string, unknown> {
    return asRecord(record['candle']);
  }

  isMarketObservation(record: EventRecord): boolean {
    return isObservation(record);
  }

  timestamp(record: EventRecord): Date | null {
    return this.isMarketObservation(record) ? candleCloseDate(record) : eventDate(record);
  }

  reasons(record: EventRecord): string {
    const value = record['reasons'];
    if (Array.isArray(value)) return value.map(String).join(', ');
    return typeof value === 'string' ? value : '—';
  }

  indicators(record: EventRecord): string {
    const value = record['indicators'] ?? record['indicator_snapshot'];
    if (!value || typeof value !== 'object') return '—';
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${String(item)}`)
      .join(' · ');
  }
}