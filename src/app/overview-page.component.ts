import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  asRecord,
  candleCloseDate,
  describeFirestoreError,
  eventDate,
  FirestoreDataService,
  isObservation,
  normalizeProfileName,
  profileDisplayLabel,
  profileStrategySummary,
  type AppConfig,
  type EventRecord,
  type RiskProfile,
  type SignalCounts,
} from './firestore-data.service';

@Component({
  selector: 'app-overview-page',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './overview-page.component.html',
  styleUrl: './overview-page.component.css',
})
export class OverviewPage {
  private readonly data = inject(FirestoreDataService);
  readonly loading = signal(true);
  readonly config = signal<AppConfig | null>(null);
  readonly profiles = signal<RiskProfile[]>([]);
  readonly events = signal<EventRecord[]>([]);
  readonly counts = signal<SignalCounts | null>(null);
  readonly error = signal('');
  rangeDays = '7';

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    const from = new Date(Date.now() - Number(this.rangeDays) * 24 * 60 * 60 * 1000);
    const [configResult, profilesResult, eventsResult, countsResult] = await Promise.allSettled([
      this.data.getAppConfig(),
      this.data.getRiskProfiles(),
      this.data.getLatestEvents(),
      this.data.getSignalCounts(from, new Date()),
    ]);

    if (configResult.status === 'fulfilled') this.config.set(configResult.value);
    if (profilesResult.status === 'fulfilled') this.profiles.set(profilesResult.value);
    if (eventsResult.status === 'fulfilled') this.events.set(eventsResult.value);
    if (countsResult.status === 'fulfilled') this.counts.set(countsResult.value);

    const failure = [configResult, profilesResult, eventsResult, countsResult].find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') this.error.set(describeFirestoreError(failure.reason));
    this.loading.set(false);
  }

  get scannerEnabled(): boolean | null {
    const value = this.config()?.enabled;
    return typeof value === 'boolean' ? value : null;
  }

  get observations(): EventRecord[] {
    return this.events().filter(isObservation);
  }

  get signals(): EventRecord[] {
    return this.events().filter((event) => event['event_type'] === 'signal').slice(0, 5);
  }

  profileName(profile: RiskProfile): string {
    return profileDisplayLabel(profile);
  }

  profileId(profile: RiskProfile): string {
    return normalizeProfileName(profile);
  }

  profileEnabled(profile: RiskProfile): boolean {
    return profile['enabled'] === true;
  }

  profileSymbols(profile: RiskProfile): number {
    const symbols = Array.isArray(profile['symbols']) ? profile['symbols'] : [];
    return symbols.length;
  }

  profileSummary(profile: RiskProfile): string {
    return profileStrategySummary(profile);
  }

  profileLastRun(profile: RiskProfile): Date | null {
    const value = profile['last_run_at'];
    if (value instanceof Date) return value;
    if (value && typeof value === 'object' && 'toDate' in value) {
      return (value as { toDate: () => Date }).toDate();
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
  }

  profileProfilesTag(profile: RiskProfile): string {
    return this.profileEnabled(profile) ? 'Enabled' : 'Disabled';
  }

  latestObservation(symbol: string): EventRecord | undefined {
    return this.observations.find((event) => event['symbol'] === symbol);
  }

  freshness(kind: 'markets' | 'signals'): { label: string; stale: boolean } {
    const record = kind === 'markets' ? this.observations[0] : this.signals[0];
    if (!record) return { label: 'No data yet', stale: true };
    const date = eventDate(record);
    if (!date) return { label: 'Time unavailable', stale: true };
    const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
    return {
      label: minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`,
      stale: minutes > 15,
    };
  }

  candle(record: EventRecord | undefined): Record<string, unknown> {
    return asRecord(record?.['candle']);
  }

  eventDate(record: EventRecord | undefined): Date | null {
    return record ? eventDate(record) : null;
  }

  candleCloseDate(record: EventRecord | undefined): Date | null {
    return record ? candleCloseDate(record) : null;
  }

  configTime(): Date | null {
    const value = this.config()?.['last_run_at'];
    if (value instanceof Date) return value;
    if (value && typeof value === 'object' && 'toDate' in value) {
      return (value as { toDate: () => Date }).toDate();
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
  }

  status(event: EventRecord): string {
    return String(event['status'] ?? 'Unspecified');
  }
}
