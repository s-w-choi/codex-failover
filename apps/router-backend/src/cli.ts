#!/usr/bin/env node
import { access, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULTS } from '@codex-failover/shared';
import dotenv from 'dotenv';

import { CodexConfigService } from './services/codex-config.js';
import { ensureUserDataDir, getUserDataDir, removeUserDataDir } from './utils/user-data.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

type Subcommand = 'start' | 'stop' | 'restart' | 'install' | 'restore' | 'uninstall' | 'status' | 'logs';

const command = parseCommand(process.argv[2]);

await ensureUserDataDir();

try {
  switch (command) {
    case 'start':
      await startCommand();
      break;
    case 'stop':
      await stopCommand();
      break;
    case 'restart':
      await restartCommand();
      break;
    case 'install':
      await installCommand();
      break;
    case 'restore':
      await restoreCommand();
      break;
    case 'uninstall':
      await uninstallCommand();
      break;
    case 'status':
      await statusCommand();
      break;
    case 'logs':
      await logsCommand();
      break;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Command failed.');
  process.exitCode = 1;
}

function parseCommand(value: string | undefined): Subcommand {
  const valid: Subcommand[] = ['start', 'stop', 'restart', 'install', 'restore', 'uninstall', 'status', 'logs'];
  if (value && valid.includes(value as Subcommand)) {
    return value as Subcommand;
  }

  if (value === '--watch') {
    printUsage();
    console.error('Error: --watch must be used with the status command (e.g., codex-failover status --watch)');
    process.exit(1);
  }

  printUsage();
  process.exit(value ? 1 : 0);
}

function getHost(): string { return process.env.HOST ?? DEFAULTS.BIND_ADDRESS; }
function getPort(): number { return Number(process.env.PORT ?? DEFAULTS.PORT); }

async function startCommand(): Promise<void> {
  process.env.NODE_ENV = 'production';
  dotenv.config();
  const host = getHost();
  const port = getPort();

  if (await isServerRunning(host, port)) {
    console.log(`codex-failover is already running on http://${host}:${port}`);
    console.log(`  stop:     codex-failover stop`);
    console.log(`  restart:  codex-failover restart`);
    console.log(`  status:   codex-failover status`);
    return;
  }

  const serverPid = await startBackgroundServer();
  if (!serverPid) {
    console.error('Failed to start server.');
    process.exitCode = 1;
    return;
  }

  await launchTray();

  console.log(`codex-failover started (PID ${serverPid})`);
  console.log(`  listening on http://${host}:${port}`);
}

async function stopCommand(): Promise<void> {
  dotenv.config();
  const host = getHost();
  const port = getPort();

  if (!(await isServerRunning(host, port))) {
    console.log('codex-failover is not running.');
    return;
  }

  const pidFile = join(getUserDataDir(), 'server.pid');
  const pid = await readPidFile(pidFile);

  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
      await waitForServerDown(host, port, 5000);
    } catch { /* already dead */ }
  }

  if (await isServerRunning(host, port)) {
    try {
      const { execSync } = await import('node:child_process');
      const portPid = execSync(`lsof -ti:${port}`, { encoding: 'utf8', timeout: 2000 }).trim();
      if (portPid) {
        for (const pidStr of portPid.split('\n')) {
          const p = Number(pidStr.trim());
          if (p > 1) try { process.kill(p, 'SIGTERM'); } catch { /* no-op */ }
        }
      }
      await waitForServerDown(host, port, 3000);
    } catch { /* unable to kill by port */ }
  }

  await killPreviousTray(join(getUserDataDir(), 'tray.pid'));

  if (await isServerRunning(host, port)) {
    console.log(`Failed to stop. Try: kill $(lsof -ti:${port})`);
  } else {
    console.log('codex-failover stopped.');
  }

  try { const { unlink } = await import('node:fs/promises'); await unlink(pidFile); } catch { /* ignore */ }
}

async function restartCommand(): Promise<void> {
  await stopCommand();
  await sleep(500);
  await startCommand();
}

async function startBackgroundServer(): Promise<number | null> {
  const serverEntry = join(__dirname, 'index.js');
  const pidFile = join(getUserDataDir(), 'server.pid');
  const logFile = join(getUserDataDir(), 'server.log');

  const { openSync } = await import('node:fs');
  const outFd = openSync(logFile, 'a');
  const child = spawn(process.execPath, [serverEntry], {
    detached: true,
    stdio: ['ignore', outFd, outFd],
    env: { ...process.env, NODE_ENV: 'production' },
  });

  await writeFile(pidFile, String(child.pid)).catch(() => {});
  child.unref();

  const host = getHost();
  const port = getPort();
  const started = await waitForServerUp(host, port, 8000);
  return started ? (child.pid ?? null) : null;
}

async function waitForServerUp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerRunning(host, port)) return true;
    await sleep(200);
  }
  return false;
}

async function waitForServerDown(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isServerRunning(host, port))) return true;
    await sleep(200);
  }
  return false;
}

function resolveElectronBinary(projectRoot: string): string | null {
  try {
    const projectRequire = createRequire(join(projectRoot, 'package.json'));
    return projectRequire('electron');
  } catch {
    return null;
  }
}

async function launchTray(): Promise<void> {
  const projectRoot = resolve(__dirname, '../../..');
  const trayMain = join(__dirname, 'tray', 'main.js');
  const electronBin = resolveElectronBinary(projectRoot);
  const pidFile = join(getUserDataDir(), 'tray.pid');
  const trayLogFile = join(getUserDataDir(), 'tray.log');

  if (!electronBin) {
    return;
  }

  try {
    await access(trayMain);
    await access(electronBin);
  } catch {
    return;
  }

  await killPreviousTray(pidFile);
  await sleep(300);

  const { openSync } = await import('node:fs');
  const outFd = openSync(trayLogFile, 'a');
  const tray = spawn(electronBin, [trayMain], {
    detached: true,
    stdio: ['ignore', outFd, outFd],
    env: { ...process.env },
  });
  await writeFile(pidFile, String(tray.pid)).catch(() => {});
  tray.unref();
}

async function killPreviousTray(pidFile: string): Promise<void> {
  const pid = await readPidFile(pidFile);
  if (!pid || pid === process.pid) return;

  try { process.kill(pid, 0); } catch { return; }
  try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
  await sleep(500);
  try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
}

async function readPidFile(pidFile: string): Promise<number | null> {
  try {
    const pidStr = await readFile(pidFile, 'utf8');
    const pid = Number(pidStr.trim());
    return pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function installCommand(): Promise<void> {
  dotenv.config();
  const service = new CodexConfigService();
  const result = await service.install();
  printJson(result);
}

async function restoreCommand(): Promise<void> {
  dotenv.config();
  const result = await new CodexConfigService().restore();
  printJson(result);
}

async function uninstallCommand(): Promise<void> {
  dotenv.config();

  const host = getHost();
  const port = getPort();
  if (await isServerRunning(host, port)) {
    await stopCommand();
  }

  const service = new CodexConfigService();
  const result = await service.restore();
  console.log('Config restored:', JSON.stringify(result, null, 2));

  const dataDir = getUserDataDir();
  await removeUserDataDir();
  console.log(`Removed data directory: ${dataDir}`);

  console.log('codex-failover uninstalled. You can now run: npm uninstall -g @sungwon_choi/codex-failover');
}

async function logsCommand(): Promise<void> {
  const logFile = join(getUserDataDir(), 'server.log');

  let content: string;
  try {
    content = await readFile(logFile, 'utf8');
  } catch {
    console.log('No log file found. Start the server first: codex-failover start');
    return;
  }

  const lines = content.split('\n');
  const lastLines = lines.slice(-100);
  console.log(lastLines.join('\n'));
}

async function statusCommand(): Promise<void> {
  dotenv.config();
  const watchMode = process.argv.includes('--watch');
  const host = getHost();
  const port = getPort();

  if (watchMode) {
    let stopped = false;
    const onSigint = () => {
      stopped = true;
      process.removeListener('SIGINT', onSigint);
    };
    process.on('SIGINT', onSigint);

    while (!stopped) {
      const output = await buildStatusOutput(host, port);
      process.stdout.write(`\x1Bc${output}\n`);
      await sleep(5000);
    }
    process.stdout.write('\nStopped watching.\n');
  } else {
    const output = await buildStatusOutput(host, port);
    console.log(output);
  }
}

async function buildStatusOutput(host: string, port: number): Promise<string> {
  const serverRunning = await isServerRunning(host, port);

  if (!serverRunning) {
    return [
      'codex-failover is not running.',
      '',
      '  Start: codex-failover start',
    ].join('\n');
  }

  const [statusRes, usageRes] = await Promise.all([
    fetch(`http://${host}:${port}/api/status`).then(r => r.json()).catch(() => null),
    fetch(`http://${host}:${port}/api/dashboard/usage-today`).then(r => r.json()).catch(() => null),
  ]);

  const status = statusRes as Record<string, unknown> | null;
  const usage = usageRes as { providers?: UsageProvider[]; codexSession?: CodexSessionUsage; codexLimitSession?: CodexSessionUsage } | null;

  if (!status) {
    return `codex-failover running on http://${host}:${port}\n(unable to fetch status)`;
  }

  const providers = (status.providers as ProviderState[]) ?? [];
  const activeId = (status.activeProviderId as string) ?? '';
  const uptime = (status.uptime as number) ?? 0;
  const usageProviders = usage?.providers ?? [];

  const lines: string[] = [];
  lines.push(`codex-failover — http://${host}:${port}`);
  lines.push(`Uptime: ${formatDuration(uptime)}`);
  lines.push('');

  for (const p of providers) {
    const isActive = p.id === activeId;
    const marker = isActive ? '▶' : ' ';
    const state = !p.enabled ? 'off' : isActive ? 'active' : 'standby';
    const authType = p.credentialMode === 'inbound-authorization' ? 'OAuth' : 'API Key';
    const typeLabel = (p.type as string).includes('azure') ? 'Azure' : (p.type as string).includes('compatible') ? 'Compatible' : 'OpenAI';

    lines.push(`${marker} ${p.id}`);
    lines.push(`  ${typeLabel} · ${authType} · ${state}`);

    const usageP = usageProviders.find((u) => u.providerId === p.id);
    if (p.enabled && usageP) {
      const codexLimitSession = usage?.codexLimitSession ?? (usage?.codexSession?.limits.available ? usage.codexSession : undefined);
      if (p.type === 'openai-oauth-pass-through' && codexLimitSession?.limits.available) {
        const { limits } = codexLimitSession;
        if (limits.primary) lines.push(`  ${limitLabel(limits.primary)}  ${bar(limits.primary.remainingPercent)} ${limits.primary.remainingPercent}% left${limits.primary.resetsAt ? ` · resets ${formatResetAt(limits.primary.resetsAt)}` : ''}`);
        if (limits.secondary) lines.push(`  ${limitLabel(limits.secondary)}  ${bar(limits.secondary.remainingPercent)} ${limits.secondary.remainingPercent}% left${limits.secondary.resetsAt ? ` · resets ${formatResetAt(limits.secondary.resetsAt)}` : ''}`);
      } else if (usageP.rateLimit) {
        const rl = usageP.rateLimit;
        const reqPct = rl.limitRequests > 0 ? Math.round((rl.remainingRequests / rl.limitRequests) * 100) : 100;
        const tokPct = rl.limitTokens > 0 ? Math.round((rl.remainingTokens / rl.limitTokens) * 100) : 100;
        lines.push(`  Requests  ${bar(reqPct)} ${rl.remainingRequests}/${rl.limitRequests}`);
        lines.push(`  Tokens    ${bar(tokPct)} ${formatTokenCount(rl.remainingTokens)}/${formatTokenCount(rl.limitTokens)}`);
      } else if (p.type !== 'openai-oauth-pass-through' && isActive) {
        const providerCodexSession = usageP.codexSession ?? (usage?.codexSession?.modelProvider ? undefined : usage?.codexSession);
        const providerSessionTotal = providerCodexSession?.usage?.total.totalTokens ?? 0;
        const localSessionTotal = usageP.localSessionTokens ?? 0;
        if (
          usageP.requestCount === 0
          && providerCodexSession?.usage
          && !providerCodexSession.limits.available
          && providerSessionTotal >= usageP.totalTokens
        ) {
          const total = providerCodexSession.usage.total;
          lines.push(`  Codex session · ${formatTokenCount(total.totalTokens)} tokens`);
          lines.push(`  Input ${formatTokenCount(total.inputTokens)} · Output ${formatTokenCount(total.outputTokens)}`);
        } else if (usageP.requestCount > 0 || usageP.totalTokens > 0) {
          const cost = usageP.estimatedCostUsd > 0 ? `$${formatFixed(usageP.estimatedCostUsd, 2)}` : '';
          lines.push(`  ${usageP.requestCount} reqs · ${formatTokenCount(usageP.totalTokens)} tokens${cost ? ' · ' + cost : ''}`);
        } else if (localSessionTotal > 0) {
          lines.push(`  Stored session · ${formatTokenCount(localSessionTotal)} tokens`);
        } else {
          lines.push(`  0 reqs · ${formatTokenCount(0)} tokens`);
        }
      } else if (usageP.requestCount > 0 || usageP.totalTokens > 0) {
        const cost = usageP.estimatedCostUsd > 0 ? `$${formatFixed(usageP.estimatedCostUsd, 2)}` : '';
        lines.push(`  ${usageP.requestCount} reqs · ${formatTokenCount(usageP.totalTokens)} tokens${cost ? ' · ' + cost : ''}`);
      } else if ((usageP.localSessionTokens ?? 0) > 0) {
        lines.push(`  Stored session · ${formatTokenCount(usageP.localSessionTokens ?? 0)} tokens`);
      } else if (p.type === 'openai-oauth-pass-through') {
        lines.push('  Limits not available');
      } else {
        lines.push(`  0 reqs · ${formatTokenCount(0)} tokens`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

function bar(pct: number): string {
  const width = 12;
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const color = pct > 50 ? '\x1B[32m' : pct > 20 ? '\x1B[33m' : '\x1B[31m';
  const reset = '\x1B[0m';
  return `${color}${'█'.repeat(filled)}${'░'.repeat(empty)}${reset}`;
}

function formatResetAt(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function limitLabel(limit: CodexLimitWindow): string {
  if (limit.windowMinutes === 300) return '5h limit';
  if (limit.windowMinutes === 10080) return 'Weekly limit';
  if (limit.windowMinutes < 60) return `${limit.windowMinutes}m limit`;
  if (limit.windowMinutes % 60 === 0) return `${limit.windowMinutes / 60}h limit`;
  return `${limit.windowMinutes}m limit`;
}

function formatTokenCount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const units = ['', 'k', 'M', 'B', 'T'];
  let scaled = Math.abs(value);
  let unitIndex = 0;
  while (scaled >= 1000 && unitIndex < units.length - 1) {
    scaled /= 1000;
    unitIndex += 1;
  }
  const sign = value < 0 ? '-' : '';
  return `${sign}${formatFixed(scaled, 2)}${units[unitIndex]}`;
}

function formatFixed(value: number, decimals: number): string {
  return value.toFixed(decimals).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isServerRunning(host: string, port: number): Promise<boolean> {
  const healthPaths = ['/healthz', '/readyz'];

  for (const path of healthPaths) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);

    try {
      const response = await fetch(`http://${host}:${port}${path}`, { signal: controller.signal });
      if (response.ok) {
        return true;
      }
    } catch {
      // try the next health endpoint
    } finally {
      clearTimeout(timeout);
    }
  }

  return false;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printUsage(): void {
  console.log('Usage: codex-failover <start|stop|restart|install|restore|uninstall|status|logs>');
}

interface ProviderState {
  id: string;
  type: string;
  enabled: boolean;
  credentialMode: string;
  status?: string;
}

interface UsageProvider {
  providerId: string;
  type: string;
  enabled: boolean;
  totalTokens: number;
  requestCount: number;
  estimatedCostUsd: number;
  localSessionTokens?: number;
  codexSession?: CodexSessionUsage;
  rateLimit?: {
    remainingRequests: number;
    limitRequests: number;
    remainingTokens: number;
    limitTokens: number;
  };
}

interface CodexSessionUsage {
  modelProvider?: string;
  usage?: {
    total: CodexTokenUsage;
  };
  limits: {
    available: boolean;
    primary?: CodexLimitWindow;
    secondary?: CodexLimitWindow;
  };
}

interface CodexTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface CodexLimitWindow {
  remainingPercent: number;
  windowMinutes: number;
  resetsAt: number;
}
