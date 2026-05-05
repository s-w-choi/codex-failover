import { execSync } from 'node:child_process';

const GREEN = '\x1b[0;32m';
const CYAN = '\x1b[0;36m';
const RED = '\x1b[0;31m';
const RESET = '\x1b[0m';

type Phase = {
  label: string;
  command: string;
};

const phases: Phase[] = [
  { label: 'Unit tests', command: 'pnpm test:unit' },
  { label: 'Integration tests', command: 'pnpm test:integration' },
];

function printHeader(label: string): void {
  console.log(`${CYAN}▶ ${label}${RESET}`);
  console.log(`${CYAN}${'-'.repeat(label.length + 2)}${RESET}`);
}

function runPhase(phase: Phase): boolean {
  printHeader(phase.label);

  try {
    execSync(phase.command, { stdio: 'inherit' });
    console.log(`${GREEN}✓ ${phase.label} passed.${RESET}\n`);
    return true;
  } catch {
    console.error(`${RED}✗ ${phase.label} failed.${RESET}\n`);
    return false;
  }
}

for (const phase of phases) {
  const passed = runPhase(phase);

  if (!passed) {
    console.error(`${RED}✗ ${phase.label} failed.${RESET}`);
    process.exitCode = 1;
    break;
  }
}

if (process.exitCode !== 1) {
  console.log(`${GREEN}✅ All tests passed.${RESET}`);
}
