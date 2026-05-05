import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const defaultExecAsync = promisify(exec);

export interface CodexLoginResult {
  success: boolean;
  output: string;
}

export interface ExecAsync {
  (command: string, options?: { timeout?: number }): Promise<{ stdout: string; stderr: string }>;
}

export class CodexLoginService {
  constructor(private readonly execAsync: ExecAsync = defaultExecAsync) {}

  async execute(deviceAuth = false): Promise<CodexLoginResult> {
    const command = deviceAuth ? 'codex login --device-auth' : 'codex login';
    try {
      const { stdout, stderr } = await this.execAsync(command, { timeout: 120_000 });
      return { success: true, output: stdout || stderr };
    } catch (error) {
      return { success: false, output: error instanceof Error ? error.message : String(error) };
    }
  }
}
