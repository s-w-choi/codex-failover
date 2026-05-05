import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const GREEN = '\x1b[0;32m';
const CYAN = '\x1b[0;36m';
const YELLOW = '\x1b[0;33m';
const RESET = '\x1b[0m';

const homeDir = homedir();
const configPath = join(homeDir, '.codex', 'config.toml');
const backupPath = `${configPath}.backup`;

async function main(): Promise<void> {
  const changes: string[] = [];
  const warnings: string[] = [];

  const backupContent = await readFile(backupPath, 'utf8').catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read backup at ${backupPath}: ${detail}`);
  });

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, backupContent, 'utf8');
  changes.push(`Restored ${configPath} from ${backupPath}`);

  let cleanedContent = removeTopLevelTomlLine(backupContent, 'openai_base_url');
  cleanedContent = removeTopLevelTomlLine(cleanedContent, 'model_provider');
  cleanedContent = removeTopLevelTomlLine(cleanedContent, 'url');
  cleanedContent = removeAllSections(cleanedContent, 'model_providers');
  cleanedContent = normalizeTomlContent(cleanedContent);

  await writeFile(configPath, cleanedContent, 'utf8');
  changes.push('Removed codex-failover specific keys and model provider sections');

  if (backupContent === cleanedContent) {
    warnings.push('Backup did not contain codex-failover specific settings to remove.');
  }

  printList('Restore complete', changes, GREEN);
  if (warnings.length > 0) {
    printList('Warnings', warnings, YELLOW);
  }

  console.log(`${CYAN}Codex config has been restored.${RESET}`);
}

function removeTopLevelTomlLine(content: string, key: string): string {
  const lines = content.split('\n');
  const firstSectionIndex = lines.findIndex((line) => line.trimStart().startsWith('['));
  const topLevelEnd = firstSectionIndex === -1 ? lines.length : firstSectionIndex;
  const filtered = lines.filter((line, index) => index >= topLevelEnd || !isTomlKeyLine(line, key));
  return filtered.join('\n');
}

function removeAllSections(content: string, sectionName: string): string {
  const pattern = new RegExp(`(^|\\n)\\[${escapeRegex(sectionName)}(?:\\.[^\\]]+)?\\]\\s*\\n[\\s\\S]*?(?=\\n\\[|$)`, 'g');
  return content.replace(pattern, '');
}

function normalizeTomlContent(content: string): string {
  const normalized = content.replace(/\n{3,}/g, '\n\n');
  if (normalized.trim().length === 0) {
    return '';
  }
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

function isTomlKeyLine(line: string, key: string): boolean {
  return new RegExp(`^\\s*${escapeRegex(key)}\\s*=`).test(line);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function printList(title: string, lines: string[], color: string): void {
  console.log(`${color}${title}:${RESET}`);
  for (const line of lines) {
    console.log(`${color}• ${line}${RESET}`);
  }
  console.log('');
}

try {
  await main();
} catch (error) {
  process.exitCode = 1;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to restore Codex config: ${message}`);
}
