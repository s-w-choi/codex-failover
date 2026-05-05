import { type ChildProcess, execSync, spawn } from 'node:child_process';

const GREEN = '\x1b[0;32m';
const CYAN = '\x1b[0;36m';
const RED = '\x1b[0;31m';
const RESET = '\x1b[0m';

const HEALTHZ_URL = 'http://127.0.0.1:8788/healthz';
const POLL_INTERVAL_MS = 200;
const READY_TIMEOUT_MS = 10_000;
const E2E_TIMEOUT_MS = 180_000;

let harnessProcess: ChildProcess | undefined;
let startedHarness = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isHarnessHealthy(): Promise<boolean> {
  try {
    const response = await fetch(HEALTHZ_URL);
    return response.ok;
  } catch {
    return false;
  }
}

function printStatus(message: string): void {
  console.log(`${CYAN}${message}${RESET}`);
}

function stopHarness(): void {
  if (!startedHarness || harnessProcess?.pid === undefined) {
    return;
  }

  printStatus('Stopping test harness...');

  try {
    process.kill(-harnessProcess.pid, 'SIGTERM');
  } catch {
    try {
      harnessProcess.kill('SIGTERM');
    } catch {
      // Process is already gone.
    }
  }

  harnessProcess = undefined;
  startedHarness = false;
}

function handleSignal(signal: NodeJS.Signals): void {
  console.error(`${RED}Received ${signal}; cleaning up.${RESET}`);
  stopHarness();
  process.exit(130);
}

async function waitForHarness(): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await isHarnessHealthy()) {
      return true;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return false;
}

function startHarness(): void {
  printStatus('Starting test harness...');
  harnessProcess = spawn('pnpm', ['harness:start'], {
    detached: true,
    stdio: 'ignore',
  });
  harnessProcess.unref();
  startedHarness = true;
}

function runE2eTests(): boolean {
  console.log(`${CYAN}▶ E2E tests${RESET}`);
  console.log(`${CYAN}${'-'.repeat(11)}${RESET}`);

  try {
    execSync('pnpm test:e2e', {
      env: { ...process.env, CODEX_FAILOVER_EXTERNAL_HARNESS: '1' },
      stdio: 'inherit',
      timeout: E2E_TIMEOUT_MS,
    });
    console.log(`${GREEN}✓ E2E tests passed.${RESET}`);
    return true;
  } catch {
    console.error(`${RED}✗ E2E tests failed.${RESET}`);
    return false;
  }
}

process.on('SIGINT', handleSignal);
process.on('SIGTERM', handleSignal);

try {
  if (await isHarnessHealthy()) {
    printStatus('Test harness already running.');
  } else {
    startHarness();

    if (!(await waitForHarness())) {
      console.error(`${RED}✗ Test harness did not become ready within 10s.${RESET}`);
      process.exitCode = 1;
    }
  }

  if (process.exitCode !== 1) {
    console.log(`${GREEN}✓ Test harness ready.${RESET}`);

    if (runE2eTests()) {
      console.log(`${GREEN}✅ E2E test run passed.${RESET}`);
    } else {
      console.error(`${RED}✗ E2E tests failed.${RESET}`);
      process.exitCode = 1;
    }
  }
} finally {
  stopHarness();
}
