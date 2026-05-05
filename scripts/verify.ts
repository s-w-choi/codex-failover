import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const GREEN = '\x1b[0;32m';
const CYAN = '\x1b[0;36m';
const RED = '\x1b[0;31m';
const RESET = '\x1b[0m';

type Step = {
  label: string;
  command: string;
};

type SecretPattern = {
  label: string;
  pattern: RegExp;
};

type Finding = {
  filePath: string;
  lineNumber: number;
  patternLabel: string;
};

const verifySteps: Step[] = [
  { label: 'Lint', command: 'pnpm lint' },
  { label: 'Typecheck', command: 'pnpm typecheck' },
  { label: 'Unit tests', command: 'pnpm test:unit' },
  { label: 'Integration tests', command: 'pnpm test:integration' },
  { label: 'E2E tests', command: 'pnpm test:e2e' },
];

const secretPatterns: SecretPattern[] = [
  { label: 'OpenAI API key', pattern: /sk-[a-zA-Z0-9]{20,}/g },
  { label: 'Bearer token', pattern: /Bearer\s+[a-zA-Z0-9\-_.]{20,}/g },
  { label: 'Authorization bearer header', pattern: /Authorization:\s*Bearer\s+/g },
  { label: 'JSON plaintext API key', pattern: /"api[_-]?key"\s*:\s*"[^"]{20,}"/gi },
];

function printHeader(label: string): void {
  console.log(`${CYAN}▶ ${label}${RESET}`);
  console.log(`${CYAN}${'-'.repeat(label.length + 2)}${RESET}`);
}

function runNormalVerify(): void {
  let passed = 0;
  let failed = 0;

  for (const step of verifySteps) {
    printHeader(step.label);

    try {
      execSync(step.command, { stdio: 'inherit' });
      passed += 1;
      console.log(`${GREEN}✓ ${step.label} passed.${RESET}\n`);
    } catch {
      failed += 1;
      console.error(`${RED}✗ ${step.label} failed.${RESET}`);
      console.error(`${RED}Summary: ${passed} passed, ${failed} failed.${RESET}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(`${GREEN}✅ Verification passed. Summary: ${passed} passed, ${failed} failed.${RESET}`);
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

function scanContent(filePath: string, content: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    for (const secretPattern of secretPatterns) {
      secretPattern.pattern.lastIndex = 0;

      if (secretPattern.pattern.test(line)) {
        findings.push({
          filePath,
          lineNumber: index + 1,
          patternLabel: secretPattern.label,
        });
      }
    }
  }

  return findings;
}

async function runSecurityScan(): Promise<void> {
  const dataDir = join(homedir(), '.codex-failover');
  const filePaths = [
    join(dataDir, 'server.log'),
    join(dataDir, 'tray.log'),
    join(dataDir, 'providers.json'),
  ];
  const findings: Finding[] = [];

  printHeader('Security scan');

  for (const filePath of filePaths) {
    const content = await readOptionalFile(filePath);

    if (content === undefined) {
      console.log(`${CYAN}Skipping missing file: ${filePath}${RESET}`);
      continue;
    }

    findings.push(...scanContent(filePath, content));
  }

  if (findings.length > 0) {
    console.error(`${RED}✗ Secret patterns found:${RESET}`);

    for (const finding of findings) {
      console.error(`${RED}${finding.filePath}:${finding.lineNumber} ${finding.patternLabel}${RESET}`);
    }

    process.exitCode = 1;
    return;
  }

  console.log(`${GREEN}✅ Security scan passed. No secret patterns found.${RESET}`);
}

if (process.argv.includes('--security-scan')) {
  await runSecurityScan();
} else {
  runNormalVerify();
}
