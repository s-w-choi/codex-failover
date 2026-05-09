import { execSync } from 'node:child_process';

const GREEN = '\x1b[0;32m';
const CYAN = '\x1b[0;36m';
const YELLOW = '\x1b[0;33m';
const RESET = '\x1b[0m';

function logRunning(message: string): void {
  console.log(`${CYAN}▶ ${message}${RESET}`);
}

function logSuccess(message: string): void {
  console.log(`${GREEN}✓ ${message}${RESET}`);
}

function logWarning(message: string): void {
  console.warn(`${YELLOW}⚠ ${message}${RESET}`);
}

function parseMajorVersion(version: string): number {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);

  return Number.isNaN(major) ? 0 : major;
}

function runCriticalStep(message: string, command: string, cwd = process.cwd()): void {
  logRunning(message);

  try {
    execSync(command, { cwd, stdio: 'inherit' });
    logSuccess(message);
  } catch {
    logWarning(`${message} failed.`);
    process.exitCode = 1;
    throw new Error(message);
  }
}

function runNonCriticalStep(message: string, command: string, cwd = process.cwd()): void {
  logRunning(message);

  try {
    execSync(command, { cwd, stdio: 'inherit' });
    logSuccess(message);
  } catch {
    logWarning(`${message} failed. Continuing.`);
  }
}

function ensureSupportedNodeVersion(): void {
  logRunning(`Checking Node.js version (${process.versions.node})`);

  if (parseMajorVersion(process.versions.node) < 20) {
    logWarning(`Node.js v20+ is required. Found ${process.versions.node}.`);
    process.exitCode = 1;
    throw new Error('Unsupported Node.js version');
  }

  logSuccess(`Node.js ${process.versions.node} is supported`);
}

function ensurePnpmAvailable(): void {
  logRunning('Checking pnpm availability');

  try {
    execSync('pnpm --version', { stdio: 'ignore' });
    logSuccess('pnpm is available');
  } catch {
    logWarning('pnpm not found. Installing pnpm@9 globally.');

    try {
      execSync('npm install -g pnpm@9', { stdio: 'inherit' });
      logSuccess('Installed pnpm@9 globally');
    } catch {
      logWarning('Failed to install pnpm@9 globally.');
      process.exitCode = 1;
      throw new Error('Unable to install pnpm');
    }
  }
}

function printSuccessBanner(): void {
  console.log('');
  console.log(`${GREEN}✓ codex-failover setup complete${RESET}`);
  console.log(`${CYAN}Next steps:${RESET}`);
  console.log('  1. Run `tsx scripts/dev.ts` to start the dev stack.');
  console.log('  2. Or run `pnpm start` for the production backend entrypoint.');
  console.log('  3. Run `codex-failover status` after startup to verify the router.');
}

function main(): void {
  ensureSupportedNodeVersion();
  ensurePnpmAvailable();
  runCriticalStep('Installing dependencies', 'pnpm install --frozen-lockfile 2>/dev/null || pnpm install');
  runCriticalStep('Building packages', 'pnpm build');
  runNonCriticalStep('Linking CLI', 'npm link 2>/dev/null || true');
  runNonCriticalStep('Configuring Codex', 'tsx scripts/install-codex-config.ts');
  printSuccessBanner();
}

try {
  main();
} catch (error) {
  if (process.exitCode !== 1) {
    process.exitCode = 1;
  }

  if (error instanceof Error) {
    logWarning(`Setup aborted: ${error.message}`);
  } else {
    logWarning('Setup aborted due to an unexpected error.');
  }
}
