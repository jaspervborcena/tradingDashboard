import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FirestoreDataService, describeFirestoreError, type AppConfig } from './firestore-data.service';

@Component({
  selector: 'app-system-page',
  imports: [CommonModule, FormsModule],
  templateUrl: './system-page.component.html',
  styleUrl: './system-page.component.css',
})
export class SystemPage {
  private readonly data = inject(FirestoreDataService);
  readonly config = signal<AppConfig | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  enabled = false;
  mode = 'test';
  intervalMinutes = 5;

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const config = await this.data.getAppConfig();
      this.config.set(config);
      this.syncForm(config);
    } catch (error) {
      this.error.set(describeFirestoreError(error));
    } finally {
      this.loading.set(false);
    }
  }

  private syncForm(config: AppConfig | null): void {
    this.enabled = config?.['enabled'] === true;
    this.mode = typeof config?.['mode'] === 'string' ? config['mode'] : 'test';
    const interval = Number(config?.['interval_minutes'] ?? 5);
    this.intervalMinutes = Number.isFinite(interval) ? interval : 5;
  }

  async saveConfig(): Promise<void> {
    this.saving.set(true);
    this.error.set('');
    try {
      await this.data.updateAppConfig({
        enabled: this.enabled,
        mode: this.mode,
        interval_minutes: this.intervalMinutes,
      });
      await this.refresh();
    } catch (error) {
      this.error.set(describeFirestoreError(error));
    } finally {
      this.saving.set(false);
    }
  }

  lastRun(): Date | null {
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
}