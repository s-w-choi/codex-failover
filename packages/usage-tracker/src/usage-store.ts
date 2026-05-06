import { createRequire } from 'node:module';

type DatabaseConnection = import('node:sqlite').DatabaseSync;

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseConnection;
};

export interface UsageRecord {
  id: string;
  providerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
  requestId: string;
  timestamp: number;
  requestCount?: number;
}

export interface DailyUsage {
  date: string;
  providerId: string;
  model: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalReasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  requestCount: number;
}

export interface HourlyUsage extends DailyUsage {
  hour: number;
}

export interface UsageSummary {
  totalCost: number;
  totalTokens: number;
  requestCount: number;
}

interface DailyUsageRow {
  date: string;
  providerId: string;
  model: string;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalCachedTokens: number | null;
  totalReasoningTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  requestCount: number;
}

interface HourlyUsageRow extends DailyUsageRow {
  hour: string;
}

interface SummaryRow {
  totalCost: number | null;
  totalTokens: number | null;
  requestCount: number | null;
}

interface WindowUsageRow {
  requestCount: number | null;
  totalTokens: number | null;
}

interface DailyCostRow {
  totalCost: number | null;
}

interface ProviderSummaryRow {
  providerId: string;
  totalCost: number | null;
  totalTokens: number | null;
  requestCount: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class UsageStore {
  private readonly db: DatabaseConnection;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_records (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cached_tokens INTEGER DEFAULT 0,
        reasoning_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0,
        request_id TEXT,
        request_count INTEGER DEFAULT 1,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_provider_time ON usage_records(provider_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_records(timestamp);
    `);
    this.addRequestCountColumnIfNeeded();
  }

  recordUsage(record: UsageRecord): void {
    this.db
      .prepare(`
        INSERT INTO usage_records (
          id,
          provider_id,
          model,
          input_tokens,
          output_tokens,
          cached_tokens,
          reasoning_tokens,
          total_tokens,
          cost_usd,
          request_id,
          request_count,
          timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.providerId,
        record.model,
        record.inputTokens,
        record.outputTokens,
        record.cachedTokens,
        record.reasoningTokens,
        record.totalTokens,
        record.costUsd,
        record.requestId,
        record.requestCount ?? 1,
        record.timestamp,
      );
  }

  getDailyUsage(options: { providerId?: string; startDate: string; endDate: string }): DailyUsage[] {
    const { startMs, endMs } = dateRangeToTimestamps(options.startDate, options.endDate);
    const params: Array<number | string> = [startMs, endMs];
    const providerClause = options.providerId === undefined ? '' : 'AND provider_id = ?';

    if (options.providerId !== undefined) {
      params.push(options.providerId);
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            date(timestamp / 1000, 'unixepoch') AS date,
            provider_id AS providerId,
            model,
            SUM(input_tokens) AS totalInputTokens,
            SUM(output_tokens) AS totalOutputTokens,
            SUM(cached_tokens) AS totalCachedTokens,
            SUM(reasoning_tokens) AS totalReasoningTokens,
            SUM(total_tokens) AS totalTokens,
            SUM(cost_usd) AS estimatedCostUsd,
            SUM(request_count) AS requestCount
          FROM usage_records
          WHERE timestamp >= ? AND timestamp < ? ${providerClause}
          GROUP BY date, provider_id, model
          ORDER BY date ASC, provider_id ASC, model ASC
        `,
      )
      .all(...params) as unknown as DailyUsageRow[];

    return rows.map(mapDailyUsageRow);
  }

  getHourlyUsage(options: { providerId?: string; date: string }): HourlyUsage[] {
    const { startMs, endMs } = dateRangeToTimestamps(options.date, options.date);
    const params: Array<number | string> = [startMs, endMs];
    const providerClause = options.providerId === undefined ? '' : 'AND provider_id = ?';

    if (options.providerId !== undefined) {
      params.push(options.providerId);
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            date(timestamp / 1000, 'unixepoch') AS date,
            strftime('%H', timestamp / 1000, 'unixepoch') AS hour,
            provider_id AS providerId,
            model,
            SUM(input_tokens) AS totalInputTokens,
            SUM(output_tokens) AS totalOutputTokens,
            SUM(cached_tokens) AS totalCachedTokens,
            SUM(reasoning_tokens) AS totalReasoningTokens,
            SUM(total_tokens) AS totalTokens,
            SUM(cost_usd) AS estimatedCostUsd,
            SUM(request_count) AS requestCount
          FROM usage_records
          WHERE timestamp >= ? AND timestamp < ? ${providerClause}
          GROUP BY date, hour, provider_id, model
          ORDER BY hour ASC, provider_id ASC, model ASC
        `,
      )
      .all(...params) as unknown as HourlyUsageRow[];

    return rows.map((row) => ({ ...mapDailyUsageRow(row), hour: Number.parseInt(row.hour, 10) }));
  }

  getProviderSummary(providerId: string, days: number): UsageSummary {
    const row = this.db
      .prepare(
        `
          SELECT
            SUM(cost_usd) AS totalCost,
            SUM(total_tokens) AS totalTokens,
            SUM(request_count) AS requestCount
          FROM usage_records
          WHERE provider_id = ? AND timestamp >= ?
        `,
      )
      .get(providerId, cutoffForDays(days)) as unknown as SummaryRow;

    return mapSummaryRow(row);
  }

  getUsageInWindow(providerId: string, windowMs: number): { requestCount: number; totalTokens: number } {
    const row = this.db
      .prepare(
        `
          SELECT
            SUM(request_count) AS requestCount,
            SUM(total_tokens) AS totalTokens
          FROM usage_records
          WHERE provider_id = ? AND timestamp >= ?
        `,
      )
      .get(providerId, Date.now() - windowMs) as unknown as WindowUsageRow;

    return {
      requestCount: row.requestCount ?? 0,
      totalTokens: row.totalTokens ?? 0,
    };
  }

  getDailyCost(providerId: string, date = new Date().toISOString().slice(0, 10)): number {
    const row = this.db
      .prepare(
        `
          SELECT
            SUM(cost_usd) AS totalCost
          FROM usage_records
          WHERE provider_id = ? AND date(timestamp / 1000, 'unixepoch') = ?
        `,
      )
      .get(providerId, date) as unknown as DailyCostRow;

    return row.totalCost ?? 0;
  }

  getOverallSummary(days: number): UsageSummary & {
    byProvider: Record<string, { totalCost: number; totalTokens: number }>;
  } {
    const cutoff = cutoffForDays(days);
    const summary = this.db
      .prepare(
        `
          SELECT
            SUM(cost_usd) AS totalCost,
            SUM(total_tokens) AS totalTokens,
            SUM(request_count) AS requestCount
          FROM usage_records
          WHERE timestamp >= ?
        `,
      )
      .get(cutoff) as unknown as SummaryRow;

    const providerRows = this.db
      .prepare(
        `
          SELECT
            provider_id AS providerId,
            SUM(cost_usd) AS totalCost,
            SUM(total_tokens) AS totalTokens,
            SUM(request_count) AS requestCount
          FROM usage_records
          WHERE timestamp >= ?
          GROUP BY provider_id
          ORDER BY provider_id ASC
        `,
      )
      .all(cutoff) as unknown as ProviderSummaryRow[];

    return {
      ...mapSummaryRow(summary),
      byProvider: Object.fromEntries(
        providerRows.map((row) => [
          row.providerId,
          { totalCost: row.totalCost ?? 0, totalTokens: row.totalTokens ?? 0 },
        ]),
      ),
    };
  }

  deleteProviderUsage(providerId: string): void {
    this.db.prepare('DELETE FROM usage_records WHERE provider_id = ?').run(providerId);
  }

  deleteRecordsByRequestIdPrefix(prefix: string): void {
    this.db.prepare('DELETE FROM usage_records WHERE request_id LIKE ?').run(`${prefix}%`);
  }

  close(): void {
    this.db.close();
  }

  private addRequestCountColumnIfNeeded(): void {
    try {
      this.db.prepare('ALTER TABLE usage_records ADD COLUMN request_count INTEGER DEFAULT 1').run();
    } catch {
      // Existing databases already have this column.
    }
  }
}

function mapDailyUsageRow(row: DailyUsageRow): DailyUsage {
  return {
    date: row.date,
    providerId: row.providerId,
    model: row.model,
    totalInputTokens: row.totalInputTokens ?? 0,
    totalOutputTokens: row.totalOutputTokens ?? 0,
    totalCachedTokens: row.totalCachedTokens ?? 0,
    totalReasoningTokens: row.totalReasoningTokens ?? 0,
    totalTokens: row.totalTokens ?? 0,
    estimatedCostUsd: row.estimatedCostUsd ?? 0,
    requestCount: row.requestCount ?? 0,
  };
}

function mapSummaryRow(row: SummaryRow): UsageSummary {
  return {
    totalCost: row.totalCost ?? 0,
    totalTokens: row.totalTokens ?? 0,
    requestCount: row.requestCount ?? 0,
  };
}

function dateRangeToTimestamps(startDate: string, endDate: string): { startMs: number; endMs: number } {
  return {
    startMs: parseDateStart(startDate),
    endMs: parseDateStart(endDate) + DAY_MS,
  };
}

function parseDateStart(date: string): number {
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);

  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid date: ${date}`);
  }

  return timestamp;
}

function cutoffForDays(days: number): number {
  return Date.now() - days * DAY_MS;
}
