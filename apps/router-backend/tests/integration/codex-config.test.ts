import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CodexConfigService } from '../../src/services/codex-config.js';

describe('codex config installer', () => {
  async function createService(): Promise<{ service: CodexConfigService; homeDir: string; projectDir: string; configPath: string }> {
    const root = await mkdtemp(join(tmpdir(), 'codex-failover-config-'));
    const homeDir = join(root, 'home');
    const projectDir = join(root, 'project');
    const service = new CodexConfigService({ homeDir, projectDir });
    return { service, homeDir, projectDir, configPath: join(homeDir, '.codex', 'config.toml') };
  }

  it('backs up existing config before patching', async () => {
    const { service, configPath } = await createService();
    await service.writeConfigForTest('model_provider = "openai"\n');

    const result = await service.install();

    expect(result.success).toBe(true);
    expect(result.backupPath).toBe(`${configPath}.backup`);
    expect(await readFile(`${configPath}.backup`, 'utf8')).toContain('model_provider = "openai"');
  });

  it('backs up config and creates data directory without changing provider settings', async () => {
    const { service, configPath } = await createService();
    await service.writeConfigForTest('model_provider = "openai"\napproval_policy = "never"\n');

    const result = await service.install();
    const patched = await readFile(configPath, 'utf8');

    expect(result.success).toBe(true);
    expect(patched).toContain('model_provider = "openai"');
    expect(patched).not.toContain('openai_base_url');
    expect(patched).toContain('approval_policy = "never"');
  });

  it('creates data directory during install without env file or shell profile changes', async () => {
    const { service, homeDir } = await createService();

    const result = await service.install();

    expect(result.success).toBe(true);
    expect(result.changes).not.toContain(expect.stringContaining('provider-env.sh'));
    expect(result.changes).not.toContain(expect.stringContaining('.zshrc'));
  });

  it('sets and removes model_provider for scheduler-driven switching', async () => {
    const { service, configPath } = await createService();
    await service.writeConfigForTest('approval_policy = "never"\n');

    await service.setModelProvider('azure');
    expect(await readFile(configPath, 'utf8')).toContain('model_provider = "azure"');
    expect(await service.readModelProvider()).toBe('azure');

    await service.removeModelProvider();
    const cleaned = await readFile(configPath, 'utf8');
    expect(cleaned).not.toContain('model_provider');
    expect(await service.readModelProvider()).toBeUndefined();
    expect(cleaned).toContain('approval_policy = "never"');
  });

  it('sets and reads only the top-level model without changing profile models', async () => {
    const { service, configPath } = await createService();
    await service.writeConfigForTest('model = "gpt-original"\napproval_policy = "never"\n\n[profiles.work]\nmodel = "gpt-profile"\n');

    expect(await service.readModel()).toBe('gpt-original');

    await service.setModel('gpt-5.3-codex');

    const content = await readFile(configPath, 'utf8');
    expect(await service.readModel()).toBe('gpt-5.3-codex');
    expect(content).toContain('model = "gpt-5.3-codex"');
    expect(content).toContain('[profiles.work]\nmodel = "gpt-profile"');
  });

  it('preserves section-scoped model_provider when removing top-level model_provider', async () => {
    const { service, configPath } = await createService();
    await service.writeConfigForTest('model_provider = "azure"\n\n[profiles.work]\nmodel_provider = "openai"\nmodel = "gpt-5-codex"\n');

    await service.removeModelProvider();

    expect(await readFile(configPath, 'utf8')).toBe('\n[profiles.work]\nmodel_provider = "openai"\nmodel = "gpt-5-codex"\n');
  });

  it('sets model provider sections with expected TOML format', async () => {
    const { service, configPath } = await createService();
    await service.writeConfigForTest('approval_policy = "never"\n');

    await service.setModelProviderSection('azure', {
      name: 'Azure OpenAI',
      base_url: 'https://example.openai.azure.com/openai/v1',
      env_key: 'AZURE_OPENAI_API_KEY',
      wire_api: 'responses',
    });

    expect(await readFile(configPath, 'utf8')).toBe(`approval_policy = "never"\n\n[model_providers.azure]\nname = "Azure OpenAI"\nbase_url = "https://example.openai.azure.com/openai/v1"\nenv_key = "AZURE_OPENAI_API_KEY"\nwire_api = "responses"\n`);
  });

  it('escapes generated TOML string control characters', async () => {
    const { service, configPath } = await createService();

    await service.setModelProviderSection('custom', {
      name: 'Custom "Provider"',
      base_url: 'https://example.test/v1\nnext = "bad"',
    });

    expect(await readFile(configPath, 'utf8')).toBe('[model_providers.custom]\nname = "Custom \\"Provider\\""\nbase_url = "https://example.test/v1\\nnext = \\"bad\\""\n');
  });

  it('replaces existing model provider section without corrupting other sections', async () => {
    const { service, configPath } = await createService();
    await service.writeConfigForTest('[model_providers.azure]\nname = "Old"\nbase_url = "https://old.example"\n\n[profiles.default]\nmodel = "gpt-5-codex"\n');

    await service.setModelProviderSection('azure', {
      name: 'Azure OpenAI',
      base_url: 'https://new.example/openai/v1',
      env_key: 'AZURE_OPENAI_API_KEY',
      wire_api: 'responses',
    });

    const content = await readFile(configPath, 'utf8');
    expect(content).not.toContain('https://old.example');
    expect(content).toContain('[profiles.default]\nmodel = "gpt-5-codex"');
    expect(content).toContain('[model_providers.azure]\nname = "Azure OpenAI"\nbase_url = "https://new.example/openai/v1"');
  });

  it('removes all model provider sections while preserving unrelated sections', async () => {
    const { service, configPath } = await createService();
    await service.writeConfigForTest('model_provider = "azure"\n\n[model_providers.azure]\nname = "Azure"\n\n[model_providers.openai]\nname = "OpenAI"\n\n[profiles.default]\nmodel = "gpt-5-codex"\n');

    await service.removeAllModelProviderSections();

    const content = await readFile(configPath, 'utf8');
    expect(content).not.toContain('[model_providers.azure]');
    expect(content).not.toContain('[model_providers.openai]');
    expect(content).toContain('model_provider = "azure"');
    expect(content).toContain('[profiles.default]\nmodel = "gpt-5-codex"');
  });

  it('cleans legacy proxy settings', async () => {
    const { service, configPath } = await createService();
    await service.writeConfigForTest('openai_base_url = "http://old.example"\n\n[api]\nurl = "http://old.example"\n\n[profiles.default]\nmodel = "gpt-5-codex"\n');

    await service.cleanupLegacyProxySettings();

    const content = await readFile(configPath, 'utf8');
    expect(content).not.toContain('openai_base_url');
    expect(content).not.toContain('[api]');
    expect(content).toContain('[profiles.default]\nmodel = "gpt-5-codex"');
  });

  it('preserves section-scoped openai_base_url and url when cleaning legacy top-level settings', async () => {
    const { service, configPath } = await createService();
    await service.writeConfigForTest('openai_base_url = "http://old.example"\n\n[api]\nurl = "http://legacy-api.example"\n\n[profiles.default]\nopenai_base_url = "http://profile.example"\nurl = "http://profile-url.example"\n');

    await service.cleanupLegacyProxySettings();

    expect(await readFile(configPath, 'utf8')).toBe('\n[profiles.default]\nopenai_base_url = "http://profile.example"\nurl = "http://profile-url.example"\n');
  });

  it('restores from backup', async () => {
    const { service, configPath } = await createService();
    await service.writeConfigForTest('model_provider = "openai"\n');
    await service.install();

    const restored = await service.restore();

    expect(restored.success).toBe(true);
    expect(await readFile(configPath, 'utf8')).toBe('');
  });

  it('restores from backup and removes codex-failover model provider settings', async () => {
    const { service, configPath } = await createService();
    await service.writeConfigForTest('model_provider = "azure"\nopenai_base_url = "http://old.example"\n\n[model_providers.azure]\nname = "Azure"\n\n[profiles.default]\nmodel = "gpt-5-codex"\n');
    await service.install();

    await service.restore();

    expect(await readFile(configPath, 'utf8')).toBe('\n[profiles.default]\nmodel = "gpt-5-codex"\n');
  });

  it('restores without removing section-scoped model_provider or url settings', async () => {
    const { service, configPath } = await createService();
    await service.writeConfigForTest('model_provider = "azure"\nurl = "http://top-level.example"\n\n[profiles.default]\nmodel_provider = "openai"\nurl = "http://profile-url.example"\n');
    await service.install();

    await service.restore();

    expect(await readFile(configPath, 'utf8')).toBe('\n[profiles.default]\nmodel_provider = "openai"\nurl = "http://profile-url.example"\n');
  });

  it('detects project-level .codex/config.toml overrides', async () => {
    const { service, projectDir } = await createService();
    await service.writeConfigForTest('model_provider = "codex-failover"\n');
    await writeFile(join(projectDir, '.codex', 'config.toml'), 'model_provider = "other"\nopenai_base_url = "http://example.test"\n', {
      encoding: 'utf8',
    }).catch(async () => {
      await service.ensureProjectCodexDirForTest();
      await writeFile(join(projectDir, '.codex', 'config.toml'), 'model_provider = "other"\nopenai_base_url = "http://example.test"\n');
    });

    const diagnosis = await service.diagnoseProjectConfig();

    expect(diagnosis.hasProjectConfig).toBe(true);
    expect(diagnosis.overridesBaseUrl).toBe(true);
  });
});
