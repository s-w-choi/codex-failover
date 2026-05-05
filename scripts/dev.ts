import { execSync, spawn } from 'node:child_process';

const GREEN = '\x1b[0;32m';
const CYAN = '\x1b[0;36m';
const YELLOW = '\x1b[0;33m';
const RESET = '\x1b[0m';
const DEV_PORT = 8788;

function logRunning(message: string): void {
  console.log(`${CYAN}▶ ${message}${RESET}`);
}

function logSuccess(message: string): void {
  console.log(`${GREEN}✓ ${message}${RESET}`);
}

function logWarning(message: string): void {
  console.warn(`${YELLOW}⚠ ${message}${RESET}`);
}

function buildArtifactsExist(): boolean {
  try {
    execSync('test -d apps/router-backend/dist', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function devPortIsAvailable(): boolean {
  try {
    execSync(`lsof -ti:${DEV_PORT}`, { stdio: 'ignore' });
    return false;
  } catch {
    return true;
  }
}

function printBanner(): void {
  console.log('');
  console.log(`${CYAN}Starting codex-failover development stack${RESET}`);
  console.log(`${GREEN}• backend${RESET}  PORT=${DEV_PORT}`);
  console.log(`${GREEN}• tray${RESET}     Electron shell`);
  console.log(`${GREEN}• harness${RESET}  test harness`);
  console.log('');
}

function main(): void {
  logRunning('Checking backend build artifacts');

  if (!buildArtifactsExist()) {
    logWarning('Missing apps/router-backend/dist. Run `tsx scripts/setup.ts` or `pnpm build` first.');
    process.exitCode = 1;
    return;
  }

  logSuccess('Backend build artifacts found');
  logRunning(`Checking port ${DEV_PORT}`);

  if (!devPortIsAvailable()) {
    logWarning(`Port ${DEV_PORT} is already in use. Stop the existing process and try again.`);
    process.exitCode = 1;
    return;
  }

  logSuccess(`Port ${DEV_PORT} is available`);
  printBanner();

  const child = spawn('pnpm', ['dev'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  const forwardSignal = (signal: NodeJS.Signals): void => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on('SIGINT', forwardSignal);
  process.on('SIGTERM', forwardSignal);

  child.on('error', (error) => {
    logWarning(`Failed to start dev stack: ${error.message}`);
    process.exitCode = 1;
  });

  child.on('exit', (code, signal) => {
    process.removeListener('SIGINT', forwardSignal);
    process.removeListener('SIGTERM', forwardSignal);

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exitCode = code ?? 0;
  });
}

try {
  main();
} catch (error) {
  process.exitCode = 1;

  if (error instanceof Error) {
    logWarning(`Dev startup failed: ${error.message}`);
  } else {
    logWarning('Dev startup failed due to an unexpected error.');
  }
}
