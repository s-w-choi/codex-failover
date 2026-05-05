import type { Dirent } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

export interface CodexTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface CodexUsageSnapshot {
  total: CodexTokenUsage;
  last: CodexTokenUsage;
  contextWindowTokens: number;
  contextUsedTokens: number;
  contextLeftPercent: number;
}

export interface CodexLimitWindow {
  usedPercent: number;
  remainingPercent: number;
  windowMinutes: number;
  resetsAt: number;
}

export interface CodexRateLimitSnapshot {
  available: boolean;
  limitId?: string;
  limitName?: string;
  planType?: string;
  primary?: CodexLimitWindow;
  secondary?: CodexLimitWindow;
  rateLimitReachedType?: string;
}

export interface CodexSessionUsageSnapshot {
  source: 'codex-session';
  sessionId?: string;
  modelProvider?: string;
  updatedAt: string;
  usage?: CodexUsageSnapshot;
  limits: CodexRateLimitSnapshot;
}

interface SessionFile {
  path: string;
  modifiedMs: number;
}

export interface CodexSessionUsageServiceOptions {
  cacheTtlMs?: number;
  refreshIntervalMs?: number;
  maxFilesToScan?: number;
  tailBytes?: number;
}

export interface CodexSessionUsageReader {
  getLatestSnapshot(): Promise<CodexSessionUsageSnapshot | undefined>;
  getRecentSnapshots?(options?: { force?: boolean }): Promise<CodexSessionUsageSnapshot[]>;
  refresh?(): Promise<CodexSessionUsageSnapshot | undefined>;
}

const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_CACHE_TTL_MS = DEFAULT_REFRESH_INTERVAL_MS;
const DEFAULT_MAX_FILES_TO_SCAN = 32;
const DEFAULT_TAIL_BYTES = 512 * 1024;
const SESSION_HEAD_BYTES = 64 * 1024;

export class CodexSessionUsageService implements CodexSessionUsageReader {
  private cached: { expiresAt: number; value: CodexSessionUsageSnapshot | undefined } | undefined;
  private readonly cacheTtlMs: number;
  private readonly refreshIntervalMs: number;
  private readonly maxFilesToScan: number;
  private readonly tailBytes: number;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private refreshPromise: Promise<CodexSessionUsageSnapshot | undefined> | null = null;
  private recentCached: { expiresAt: number; value: CodexSessionUsageSnapshot[] } | undefined;
  private recentRefreshPromise: Promise<CodexSessionUsageSnapshot[]> | null = null;

  constructor(
    private readonly sessionsRoot = defaultSessionsRoot(),
    options: CodexSessionUsageServiceOptions = {},
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    this.maxFilesToScan = options.maxFilesToScan ?? DEFAULT_MAX_FILES_TO_SCAN;
    this.tailBytes = options.tailBytes ?? DEFAULT_TAIL_BYTES;
  }

  start(): void {
    if (this.timerId !== null) {
      return;
    }

    void this.refresh();
    this.timerId = setInterval(() => { void this.refresh(); }, this.refreshIntervalMs);
  }

  stop(): void {
    if (this.timerId === null) {
      return;
    }

    clearInterval(this.timerId);
    this.timerId = null;
  }

  async getLatestSnapshot(): Promise<CodexSessionUsageSnapshot | undefined> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) {
      return this.cached.value;
    }

    return this.refresh();
  }

  async getRecentSnapshots(options: { force?: boolean } = {}): Promise<CodexSessionUsageSnapshot[]> {
    const now = Date.now();
    if (!options.force && this.recentCached && this.recentCached.expiresAt > now) {
      return this.recentCached.value;
    }

    return this.refreshRecentSnapshots();
  }

  async refresh(): Promise<CodexSessionUsageSnapshot | undefined> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.readAndCacheLatestSnapshot();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async readAndCacheLatestSnapshot(): Promise<CodexSessionUsageSnapshot | undefined> {
    const now = Date.now();
    const recent = await this.readRecentSnapshots();
    this.recentCached = { expiresAt: now + this.cacheTtlMs, value: recent };
    const value = recent[0];
    this.cached = { expiresAt: now + this.cacheTtlMs, value };
    return value;
  }

  private async refreshRecentSnapshots(): Promise<CodexSessionUsageSnapshot[]> {
    if (this.recentRefreshPromise) {
      return this.recentRefreshPromise;
    }

    this.recentRefreshPromise = this.readAndCacheRecentSnapshots();
    try {
      return await this.recentRefreshPromise;
    } finally {
      this.recentRefreshPromise = null;
    }
  }

  private async readAndCacheRecentSnapshots(): Promise<CodexSessionUsageSnapshot[]> {
    const now = Date.now();
    const value = await this.readRecentSnapshots();
    this.recentCached = { expiresAt: now + this.cacheTtlMs, value };
    this.cached = { expiresAt: now + this.cacheTtlMs, value: value[0] };
    return value;
  }

  private async readRecentSnapshots(): Promise<CodexSessionUsageSnapshot[]> {
    const files = (await listSessionFiles(this.sessionsRoot))
      .sort((left, right) => right.modifiedMs - left.modifiedMs)
      .slice(0, this.maxFilesToScan);

    const snapshots: CodexSessionUsageSnapshot[] = [];
    for (const file of files) {
      const snapshot = await readSnapshotFromFile(file.path, this.tailBytes);
      if (snapshot) {
        snapshots.push({ ...snapshot, sessionId: sessionIdFromPath(file.path) });
      }
    }

    return snapshots.sort((left, right) => timestampMs(right.updatedAt) - timestampMs(left.updatedAt));
  }
}

async function listSessionFiles(root: string): Promise<SessionFile[]> {
  const files: SessionFile[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        return;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        return;
      }
      try {
        const info = await stat(path);
        files.push({ path, modifiedMs: info.mtimeMs });
      } catch {
        // Ignore files that disappear while Codex is writing session state.
      }
    }));
  }

  await walk(root);
  return files;
}

async function readSnapshotFromFile(path: string, tailBytes: number): Promise<CodexSessionUsageSnapshot | undefined> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const modelProvider = await readModelProviderFromHead(handle, Math.min(size, SESSION_HEAD_BYTES));
    const length = Math.min(size, tailBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split(/\r?\n/);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const snapshot = parseTokenCountLine(lines[index]);
      if (snapshot) {
        return { ...snapshot, ...(modelProvider ? { modelProvider } : {}) };
      }
    }
  } finally {
    await handle.close();
  }

  return undefined;
}

async function readModelProviderFromHead(handle: Awaited<ReturnType<typeof open>>, length: number): Promise<string | undefined> {
  if (length <= 0) {
    return undefined;
  }

  const buffer = Buffer.alloc(length);
  await handle.read(buffer, 0, length, 0);
  const firstLine = buffer.toString('utf8').split(/\r?\n/, 1)[0];
  return parseSessionModelProviderLine(firstLine);
}

export function parseSessionModelProviderLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {
    return undefined;
  }

  let event: unknown;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  if (!isRecord(event) || event.type !== 'session_meta' || !isRecord(event.payload)) {
    return undefined;
  }

  return typeof event.payload.model_provider === 'string' ? event.payload.model_provider : undefined;
}

export function parseTokenCountLine(line: string): CodexSessionUsageSnapshot | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {
    return undefined;
  }

  let event: unknown;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  if (!isRecord(event) || event.type !== 'event_msg' || !isRecord(event.payload) || event.payload.type !== 'token_count') {
    return undefined;
  }

  const updatedAt = typeof event.timestamp === 'string' ? event.timestamp : new Date().toISOString();
  return {
    source: 'codex-session',
    updatedAt,
    usage: parseUsageSnapshot(event.payload.info),
    limits: parseRateLimits(event.payload.rate_limits),
  };
}

function parseUsageSnapshot(value: unknown): CodexUsageSnapshot | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const total = parseTokenUsage(value.total_token_usage);
  const last = parseTokenUsage(value.last_token_usage);
  const contextWindowTokens = readNumber(value.model_context_window);

  if (!total || !last || contextWindowTokens === undefined) {
    return undefined;
  }

  const contextUsedTokens = last.totalTokens;
  const contextLeftPercent = contextWindowTokens > 0
    ? clampPercent(Math.round(((contextWindowTokens - contextUsedTokens) / contextWindowTokens) * 100))
    : 100;

  return { total, last, contextWindowTokens, contextUsedTokens, contextLeftPercent };
}

function parseTokenUsage(value: unknown): CodexTokenUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const inputTokens = readNumber(value.input_tokens);
  const outputTokens = readNumber(value.output_tokens);
  const totalTokens = readNumber(value.total_tokens);

  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens,
    cachedInputTokens: readNumber(value.cached_input_tokens) ?? 0,
    outputTokens,
    reasoningOutputTokens: readNumber(value.reasoning_output_tokens) ?? 0,
    totalTokens,
  };
}

function parseRateLimits(value: unknown): CodexRateLimitSnapshot {
  if (!isRecord(value)) {
    return { available: false };
  }

  const primary = parseLimitWindow(value.primary);
  const secondary = parseLimitWindow(value.secondary);
  const limitId = typeof value.limit_id === 'string' ? value.limit_id : undefined;
  const limitName = typeof value.limit_name === 'string' ? value.limit_name : undefined;
  const planType = typeof value.plan_type === 'string' ? value.plan_type : undefined;
  const rateLimitReachedType = typeof value.rate_limit_reached_type === 'string' ? value.rate_limit_reached_type : undefined;

  return {
    available: primary !== undefined || secondary !== undefined,
    ...(limitId ? { limitId } : {}),
    ...(limitName ? { limitName } : {}),
    ...(planType ? { planType } : {}),
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    ...(rateLimitReachedType ? { rateLimitReachedType } : {}),
  };
}

function parseLimitWindow(value: unknown): CodexLimitWindow | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const usedPercent = readNumber(value.used_percent);
  const windowMinutes = readNumber(value.window_minutes);
  const resetsAt = readNumber(value.resets_at);

  if (usedPercent === undefined || windowMinutes === undefined || resetsAt === undefined) {
    return undefined;
  }

  return {
    usedPercent,
    remainingPercent: clampPercent(Math.round(100 - usedPercent)),
    windowMinutes,
    resetsAt,
  };
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultSessionsRoot(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  return home ? join(home, '.codex', 'sessions') : join('.codex', 'sessions');
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sessionIdFromPath(path: string): string | undefined {
  const match = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/.exec(basename(path));
  return match?.[1];
}
