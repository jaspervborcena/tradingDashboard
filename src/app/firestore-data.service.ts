import { Injectable } from '@angular/core';
import {
  Timestamp,
  collection,
  doc,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { environment } from '../environments/environment';
import { firestore } from './firebase-client';

export type EventKind = 'markets' | 'signals';

export interface EventFilters {
  symbol?: string;
  profile?: string;
  timeframe?: string;
  side?: string;
  strategy?: string;
  status?: string;
  from?: Date;
  to?: Date;
}

export interface EventRecord extends Record<string, unknown> {
  id: string;
  event_type?: string;
  symbol?: string;
  timeframe?: string;
  side?: string;
  strategy?: string;
  confidence?: number | string;
  status?: string;
  candle?: Record<string, unknown>;
  reasons?: string | string[];
  indicators?: Record<string, unknown>;
  indicator_snapshot?: Record<string, unknown>;
}

export interface AppConfig extends Record<string, unknown> {
  enabled?: boolean;
  mode?: string;
  interval_minutes?: number;
  last_run_at?: unknown;
}

export interface RiskProfile extends Record<string, unknown> {
  id?: string;
  profile_name?: string;
  description?: string;
  enabled?: boolean;
  interval_minutes?: number;
  last_run_at?: unknown;
  symbols?: string[];
  strategy?: Record<string, unknown>;
}

export interface EventPage {
  records: EventRecord[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

export interface SignalCounts {
  observations: number;
  accepted: number;
  rejected: number;
}

const pageSize = 25;
const eventTimeField = environment.firestore.eventTimeField;

@Injectable({ providedIn: 'root' })
export class FirestoreDataService {
  private get database() {
    if (!firestore) {
      throw new Error('Firebase is not configured. Add the web app settings first.');
    }
    return firestore;
  }

  async getAppConfig(): Promise<AppConfig | null> {
    const snapshot = await getDocs(query(collection(this.database, 'app_config'), limit(1)));
    return snapshot.empty ? null : snapshot.docs[0].data() as AppConfig;
  }

  async updateAppConfig(config: Partial<AppConfig>): Promise<AppConfig> {
    const collectionRef = collection(this.database, 'app_config');
    const snapshot = await getDocs(query(collectionRef, limit(1)));
    const payload: Record<string, unknown> = {
      ...config,
      last_run_at: serverTimestamp(),
    };

    if (snapshot.empty) {
      await setDoc(doc(this.database, 'app_config', 'scanner'), payload);
      return payload as AppConfig;
    }

    await updateDoc(snapshot.docs[0].ref, payload);
    return { ...snapshot.docs[0].data(), ...payload } as AppConfig;
  }

  async getRiskProfiles(): Promise<RiskProfile[]> {
    const snapshot = await getDocs(query(collection(this.database, 'risk_profiles'), orderBy('profile_name', 'asc')));
    return snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as RiskProfile));
  }

  async getLatestEvents(): Promise<EventRecord[]> {
    const snapshot = await getDocs(
      query(
        collection(this.database, 'market_events'),
        orderBy(eventTimeField, 'desc'),
        limit(100),
      ),
    );
    return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  }

  async getEventPage(
    kind: EventKind,
    filters: EventFilters,
    cursor: QueryDocumentSnapshot<DocumentData> | null,
  ): Promise<EventPage> {
    const constraints: QueryConstraint[] = [];
    const events = collection(this.database, 'market_events');

    if (kind === 'signals') {
      constraints.push(where('event_type', '==', 'signal'));
    }
    if (filters.symbol) constraints.push(where('symbol', '==', filters.symbol));
    if (filters.profile) constraints.push(where('profile_name', '==', filters.profile));
    if (filters.timeframe) constraints.push(where('timeframe', '==', filters.timeframe));
    if (filters.side) constraints.push(where('side', '==', filters.side));
    if (filters.strategy) constraints.push(where('strategy', '==', filters.strategy));
    if (filters.status) constraints.push(where('status', '==', filters.status));
    if (filters.from) {
      constraints.push(where(eventTimeField, '>=', isoUtcQueryBound(filters.from)));
    }
    if (filters.to) {
      constraints.push(where(eventTimeField, '<=', isoUtcQueryBound(filters.to, true)));
    }
    constraints.push(orderBy(eventTimeField, 'desc'));
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(pageSize));

    const snapshot = await getDocs(query(events, ...constraints));
    const documents = snapshot.docs;
    const records = documents
      .map((document) => ({ id: document.id, ...document.data() }))
      .filter((record) => kind === 'signals' || isObservation(record));

    return {
      records,
      cursor: documents.at(-1) ?? null,
      hasMore: documents.length === pageSize,
    };
  }

  async getSignalCounts(from: Date, to = new Date()): Promise<SignalCounts> {
    const events = collection(this.database, 'market_events');
    const dateRange = [
      where(eventTimeField, '>=', isoUtcQueryBound(from)),
      where(eventTimeField, '<=', isoUtcQueryBound(to, true)),
    ];
    const totalQuery = query(events, ...dateRange, orderBy(eventTimeField, 'desc'));
    const signalsQuery = query(
      events,
      where('event_type', '==', 'signal'),
      ...dateRange,
      orderBy(eventTimeField, 'desc'),
    );
    const acceptedQuery = query(
      events,
      where('event_type', '==', 'signal'),
      where('status', '==', 'accepted'),
      ...dateRange,
      orderBy(eventTimeField, 'desc'),
    );
    const rejectedQuery = query(
      events,
      where('event_type', '==', 'signal'),
      where('status', '==', 'rejected'),
      ...dateRange,
      orderBy(eventTimeField, 'desc'),
    );

    const [total, signals, accepted, rejected] = await Promise.all([
      getCountFromServer(totalQuery),
      getCountFromServer(signalsQuery),
      getCountFromServer(acceptedQuery),
      getCountFromServer(rejectedQuery),
    ]);

    return {
      observations: Math.max(0, total.data().count - signals.data().count),
      accepted: accepted.data().count,
      rejected: rejected.data().count,
    };
  }
}

export function isObservation(record: EventRecord): boolean {
  return record['event_type'] === 'observation' || ('candle' in record && record['candle'] != null);
}

export function normalizeProfileName(profile: RiskProfile | null | undefined): string {
  const value = profile?.['profile_name'] ?? profile?.id ?? 'unknown';
  const normalized = String(value).trim().toLowerCase() || 'unknown';
  return normalized === 'small' ? 'low' : normalized;
}

export function profileDisplayLabel(profile: RiskProfile | null | undefined): string {
  const normalized = normalizeProfileName(profile);
  if (normalized === 'low') return 'Low Risk';
  if (normalized === 'medium') return 'Medium Risk';
  if (normalized === 'high') return 'High Risk';
  return normalized
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function profileStrategySummary(profile: RiskProfile | null | undefined): string {
  const strategy = asRecord(profile?.['strategy']);
  const parts: string[] = [];

  const smaFast = strategy['sma_fast'] ?? strategy['smaFast'];
  const smaSlow = strategy['sma_slow'] ?? strategy['smaSlow'];
  if (smaFast != null && smaSlow != null) parts.push(`SMA ${smaFast}/${smaSlow}`);

  const rsiPeriod = strategy['rsi_period'] ?? strategy['rsiPeriod'];
  if (rsiPeriod != null) parts.push(`RSI ${rsiPeriod}`);

  const minConfidence = strategy['min_confidence_score'] ?? strategy['minConfidenceScore'];
  if (minConfidence != null) parts.push(`Min conf ${Number(minConfidence)}`);

  return parts.join(' · ') || 'Strategy not configured';
}

export function eventDate(record: EventRecord): Date | null {
  const candle = asRecord(record.candle);
  const value =
    record[eventTimeField] ??
    record['captured_at'] ??
    record['created_at'] ??
    record['timestamp'] ??
    candle['close_time'] ??
    candle['closeTime'] ??
    candle['time'];

  return dateFromValue(value);
}

export function candleCloseDate(record: EventRecord): Date | null {
  const closeTime = asRecord(record['candle'])['close_time'] ?? asRecord(record['candle'])['closeTime'];
  return dateFromValue(closeTime) ?? eventDate(record);
}

function dateFromValue(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (value && typeof value === 'object' && 'toDate' in value) {
    const toDate = (value as { toDate: () => Date }).toDate;
    return typeof toDate === 'function' ? toDate() : null;
  }
  return null;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function describeFirestoreError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === 'permission-denied') return 'Firestore denied this read. Check the authenticated user and Firestore Security Rules.';
  if (code === 'failed-precondition') {
    const message = error instanceof Error ? error.message : '';
    const indexUrl = message.match(/https:\/\/console\.firebase\.google\.com\/[^\s]+/)?.[0];
    return indexUrl
      ? `Firestore needs a composite index. Create it here: ${indexUrl}`
      : 'Firestore needs a composite index. Deploy firestore.indexes.json, or open the Firebase error details for the suggested index.';
  }
  if (code === 'unavailable') return 'Firestore is temporarily unavailable. Check your connection and retry.';
  const message = error instanceof Error ? error.message : '';
  return message || 'Dashboard data could not be loaded. Check Firebase configuration and the Firestore data contract.';
}

export function isoUtcQueryBound(date: Date, inclusiveEnd = false): string {
  const iso = date.toISOString();
  if (!inclusiveEnd) return iso.replace(/Z$/, '+00:00');
  return iso.replace(/\.(\d{3})Z$/, (_match, milliseconds: string) => `.${milliseconds}999+00:00`);
}