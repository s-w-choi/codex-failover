import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { CodexConfigInstallResult, ProjectConfigDiagnosis } from '@codex-failover/shared';

export interface CodexConfigServiceOptions {
  homeDir?: string;
  projectDir?: string;
}

export class CodexConfigService {
  private readonly homeDir: string;
  private readonly projectDir: string;

  constructor(options: CodexConfigServiceOptions = {}) {
    this.homeDir = options.homeDir ?? homedir();
    this.projectDir = options.projectDir ?? process.cwd();
  }

  get configPath(): string {
    return join(this.homeDir, '.codex', 'config.toml');
  }

  get backupPath(): string {
    return `${this.configPath}.backup`;
  }

  async install(): Promise<CodexConfigInstallResult> {
    const warnings: string[] = [];
    const changes: string[] = [];

    const dataDir = join(this.homeDir, '.codex-failover');
    await mkdir(dataDir, { recursive: true });
    changes.push(`Created data directory ${dataDir}`);

    await mkdir(dirname(this.configPath), { recursive: true });
    const existing = await this.readConfigIfExists();
    await writeFile(this.backupPath, existing, 'utf8');
    changes.push(`Backed up ${this.configPath}`);

    const diagnosis = await this.diagnoseProjectConfig();
    warnings.push(...diagnosis.warnings);
    return { success: true, backupPath: this.backupPath, changes, warnings };
  }

  async setModelProvider(providerName: string): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    const content = await this.readConfigIfExists();
    const updated = setTopLevelTomlString(content, 'model_provider', providerName);
    await writeFile(this.configPath, updated, 'utf8');
  }

  async setModel(modelName: string): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    const content = await this.readConfigIfExists();
    const updated = setTopLevelTomlString(content, 'model', modelName);
    await writeFile(this.configPath, updated, 'utf8');
  }

  async readModel(): Promise<string | undefined> {
    const content = await this.readConfigIfExists();
    return readTopLevelTomlString(content, 'model');
  }

  async readModelProvider(): Promise<string | undefined> {
    const content = await this.readConfigIfExists();
    return readTopLevelTomlString(content, 'model_provider');
  }

  async readBackupModel(): Promise<string | undefined> {
    const content = await readFile(this.backupPath, 'utf8').catch(() => '');
    const lines = content.split('\n');
    const firstSectionIndex = lines.findIndex((line) => line.trimStart().startsWith('['));
    const topLevelEnd = firstSectionIndex === -1 ? lines.length : firstSectionIndex;
    for (let index = 0; index < topLevelEnd; index += 1) {
      const match = /^\s*model\s*=\s*"([^"]*)"/.exec(lines[index]);
      if (match) {
        return match[1];
      }
    }
    return undefined;
  }

  async saveProviderModel(providerId: string, model: string): Promise<void> {
    const dataDir = join(this.homeDir, '.codex-failover');
    await mkdir(dataDir, { recursive: true });
    const path = join(dataDir, 'provider-models.json');
    const existing = await readFile(path, 'utf8').catch(() => '{}');
    const models = JSON.parse(existing) as Record<string, string>;
    models[providerId] = model;
    await writeFile(path, JSON.stringify(models, null, 2), 'utf8');
  }

  async readProviderModel(providerId: string): Promise<string | undefined> {
    const path = join(this.homeDir, '.codex-failover', 'provider-models.json');
    const content = await readFile(path, 'utf8').catch(() => '{}');
    const models = JSON.parse(content) as Record<string, string>;
    return models[providerId];
  }

  async removeModelProvider(): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    const content = await this.readConfigIfExists();
    const cleaned = removeTopLevelTomlLine(content, 'model_provider');
    await writeFile(this.configPath, cleaned, 'utf8');
  }

  async setModelProviderSection(name: string, fields: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    const content = await this.readConfigIfExists();
    const section = formatModelProviderSection(name, fields);
    const withoutExisting = removeModelProviderSection(content, name);
    const suffix = withoutExisting.length > 0 && !withoutExisting.endsWith('\n') ? '\n' : '';
    const separator = withoutExisting.length > 0 && !withoutExisting.endsWith('\n\n') ? '\n' : '';
    await writeFile(this.configPath, `${withoutExisting}${suffix}${separator}${section}`, 'utf8');
  }

  async removeAllModelProviderSections(): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    const content = await this.readConfigIfExists();
    const cleaned = removeAllSections(content, 'model_providers');
    await writeFile(this.configPath, cleaned, 'utf8');
  }

  async cleanupLegacyProxySettings(): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    const content = await this.readConfigIfExists();
    let cleaned = removeTopLevelTomlLine(content, 'openai_base_url');
    cleaned = removeSection(cleaned, 'api');
    await writeFile(this.configPath, cleaned, 'utf8');
  }

  async restore(): Promise<CodexConfigInstallResult> {
    await mkdir(dirname(this.configPath), { recursive: true });
    await copyFile(this.backupPath, this.configPath);
    const restored = await this.readConfigIfExists();
    let cleaned = removeTopLevelTomlLine(restored, 'openai_base_url');
    cleaned = removeTopLevelTomlLine(cleaned, 'model_provider');
    cleaned = removeTopLevelTomlLine(cleaned, 'url');
    cleaned = removeAllSections(cleaned, 'model_providers');
    await writeFile(this.configPath, cleaned, 'utf8');
    const changes = ['Restored config from backup', 'Cleaned up codex-failover settings'];
    return { success: true, backupPath: this.backupPath, changes, warnings: [] };
  }

  async isInstalled(): Promise<boolean> {
    const dataDir = join(this.homeDir, '.codex-failover');
    try {
      const { access } = await import('node:fs/promises');
      await access(join(dataDir, 'providers.json'));
      return true;
    } catch {
      return false;
    }
  }

  async diagnoseProjectConfig(): Promise<ProjectConfigDiagnosis> {
    const projectConfigPath = join(this.projectDir, '.codex', 'config.toml');
    const content = await readFile(projectConfigPath, 'utf8').catch(() => undefined);
    const hasProjectConfig = content !== undefined;
    const overridesBaseUrl = hasProjectConfig && /^\s*openai_base_url\s*=/m.test(content);
    const warnings: string[] = [];
    if (overridesBaseUrl) {
      warnings.push(`Project config ${projectConfigPath} overrides global Codex router settings.`);
    }
    return {
      hasProjectConfig,
      ...(hasProjectConfig ? { projectConfigPath } : {}),
      overridesBaseUrl,
      warnings,
    };
  }

  async writeConfigForTest(content: string): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, content, 'utf8');
  }

  async ensureProjectCodexDirForTest(): Promise<void> {
    await mkdir(join(this.projectDir, '.codex'), { recursive: true });
  }

  private async readConfigIfExists(): Promise<string> {
    return readFile(this.configPath, 'utf8').catch(() => '');
  }
}

function setTopLevelTomlString(content: string, key: string, value: string): string {
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

  if (firstSectionIndex === -1) {
    const suffix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    return `${content}${suffix}${line}\n`;
  }

  const prefix = lines.slice(0, firstSectionIndex).join('\n');
  const sectionContent = lines.slice(firstSectionIndex).join('\n');
  const prefixSuffix = prefix.length > 0 && !prefix.endsWith('\n') ? '\n' : '';
  return `${prefix}${prefixSuffix}${line}\n${sectionContent}`;
}

function readTopLevelTomlString(content: string, key: string): string | undefined {
  const lines = content.split('\n');
  const firstSectionIndex = lines.findIndex((line) => line.trimStart().startsWith('['));
  const topLevelEnd = firstSectionIndex === -1 ? lines.length : firstSectionIndex;
  const pattern = new RegExp(`^\\s*${escapeRegex(key)}\\s*=\\s*"([^"]*)"`);
  for (let index = 0; index < topLevelEnd; index += 1) {
    const match = pattern.exec(lines[index]);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

function formatModelProviderSection(name: string, fields: Record<string, string>): string {
  const lines = [`[model_providers.${name}]`];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key} = "${escapeTomlString(value)}"`);
  }
  return `${lines.join('\n')}\n`;
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

function removeTopLevelTomlLine(content: string, key: string): string {
  const lines = content.split('\n');
  const firstSectionIndex = lines.findIndex((line) => line.trimStart().startsWith('['));
  const topLevelEnd = firstSectionIndex === -1 ? lines.length : firstSectionIndex;
  const filtered = lines.filter((line, index) => index >= topLevelEnd || !isTomlKeyLine(line, key));
  return filtered.join('\n');
}

function isTomlKeyLine(line: string, key: string): boolean {
  return new RegExp(`^\\s*${escapeRegex(key)}\\s*=`).test(line);
}

function removeModelProviderSection(content: string, name: string): string {
  const pattern = new RegExp(`(^|\\n)\\[model_providers\\.${escapeRegex(name)}\\]\\s*\\n[\\s\\S]*?(?=\\n\\[|$)`);
  return content.replace(pattern, '');
}

function removeAllSections(content: string, sectionName: string): string {
  const pattern = new RegExp(`(^|\\n)\\[${escapeRegex(sectionName)}(?:\\.[^\\]]+)?\\]\\s*\\n[\\s\\S]*?(?=\\n\\[|$)`, 'g');
  return content.replace(pattern, '');
}

function removeSection(content: string, sectionName: string): string {
  const pattern = new RegExp(`(^|\\n)\\[${escapeRegex(sectionName)}\\]\\s*\\n[\\s\\S]*?(?=\\n\\[|$)`);
  return content.replace(pattern, '');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
