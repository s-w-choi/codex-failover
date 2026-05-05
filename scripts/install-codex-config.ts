import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, parse } from 'node:path';

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '127.0.0.1';

const GREEN = '\x1b[0;32m';
const CYAN = '\x1b[0;36m';
const YELLOW = '\x1b[0;33m';
const RESET = '\x1b[0m';

const homeDir = homedir();
const configPath = join(homeDir, '.codex', 'config.toml');
const backupPath = `${configPath}.backup`;
const dataDir = join(homeDir, '.codex-failover');
const routerBaseUrl = `http://${DEFAULT_HOST}:${DEFAULT_PORT}/v1`;

async function main(): Promise<void> {
  const changes: string[] = [];
  const warnings: string[] = [];

  await mkdir(dataDir, { recursive: true });
  changes.push(`Created data directory ${dataDir}`);

  await mkdir(dirname(configPath), { recursive: true });

  const existingConfig = await readFile(configPath, 'utf8').catch(() => '');
  await writeFile(backupPath, existingConfig, 'utf8');
  changes.push(`Backed up ${configPath} to ${backupPath}`);

  let updatedConfig = setTomlKey(existingConfig, 'model_provider', 'openai');
  updatedConfig = setTomlKey(updatedConfig, 'openai_base_url', routerBaseUrl);
  await writeFile(configPath, updatedConfig, 'utf8');
  changes.push('Set model_provider = "openai"');
  changes.push(`Set openai_base_url = "${routerBaseUrl}"`);

  warnings.push(...(await diagnoseProjectConfigOverrides(process.cwd())));

  printList('Applied changes', changes, GREEN);
  if (warnings.length > 0) {
    printList('Warnings', warnings, YELLOW);
  } else {
    printLine('No project-level .codex/config.toml overrides detected.', GREEN);
  }

  printNextSteps();
}

function setTomlKey(content: string, key: string, value: string): string {
  const line = `${key} = "${escapeTomlString(value)}"`;
  const lines = content.split('\n');
  const firstSectionIndex = lines.findIndex((currentLine) => currentLine.trimStart().startsWith('['));
  const topLevelEnd = firstSectionIndex === -1 ? lines.length : firstSectionIndex;

  for (let index = 0; index < topLevelEnd; index += 1) {
    if (isTomlKeyLine(lines[index], key)) {
      lines[index] = line;
      return lines.join('\n');
    }
  }

  if (content.length === 0 || (lines.length === 1 && lines[0] === '')) {
    return `${line}\n`;
  }

  if (firstSectionIndex === -1) {
    const suffix = content.endsWith('\n') ? '' : '\n';
    return `${content}${suffix}${line}\n`;
  }

  const prefix = lines.slice(0, firstSectionIndex).join('\n');
  const sectionContent = lines.slice(firstSectionIndex).join('\n');
  const prefixSuffix = prefix.length === 0 || prefix.endsWith('\n') ? '' : '\n';
  return `${prefix}${prefixSuffix}${line}\n${sectionContent}`;
}

async function diagnoseProjectConfigOverrides(startDir: string): Promise<string[]> {
  const warnings: string[] = [];

  for (const directory of getDirectoryChain(startDir)) {
    const projectConfigPath = join(directory, '.codex', 'config.toml');
    const content = await readFile(projectConfigPath, 'utf8').catch(() => undefined);

    if (content === undefined) {
      continue;
    }

    if (/^\s*openai_base_url\s*=/m.test(content)) {
      warnings.push(`Project config override detected: ${projectConfigPath}`);
    }
  }

  return warnings;
}

function getDirectoryChain(startDir: string): string[] {
  const directories: string[] = [];
  let currentDir = startDir;

  while (true) {
    directories.push(currentDir);
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir || currentDir === parse(currentDir).root) {
      break;
    }
    currentDir = parentDir;
  }

  return directories;
}

function isTomlKeyLine(line: string, key: string): boolean {
  return new RegExp(`^\\s*${escapeRegex(key)}\\s*=`).test(line);
}

function escapeTomlString(value: string): string {
  return Array.from(value, (character) => {
    switch (character) {
      case '\\':
        return '\\\\';
      case '"':
        return '\\"';
      case '\b':
        return '\\b';
      case '\t':
        return '\\t';
      case '\n':
        return '\\n';
      case '\f':
        return '\\f';
      case '\r':
        return '\\r';
      default:
        if (isTomlControlCharacter(character)) {
          return `\\u${character.codePointAt(0)?.toString(16).padStart(4, '0') ?? '0000'}`;
        }
        return character;
    }
  }).join('');
}

function isTomlControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && ((codePoint >= 0 && codePoint <= 0x1f) || codePoint === 0x7f);
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

function printLine(message: string, color: string): void {
  console.log(`${color}${message}${RESET}\n`);
}

function printNextSteps(): void {
  console.log(`${CYAN}Next steps:${RESET}`);
  console.log(`${CYAN}1. Start the router with your normal project command.${RESET}`);
  console.log(`${CYAN}2. Run ${routerBaseUrl} health checks or \`codex-failover status\` if available.${RESET}`);
  console.log(`${CYAN}3. Use \`pnpm codex:restore\` to roll back this config change.${RESET}`);
}

try {
  await main();
} catch (error) {
  process.exitCode = 1;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to install Codex config: ${message}`);
}
