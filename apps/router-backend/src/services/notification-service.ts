import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';

const execFileAsync = promisify(execFile);

export interface NotificationPayload {
  title: string;
  message: string;
}

export interface NotificationStatus {
  available: boolean;
  permissionDenied: boolean;
}

export class NotificationService {
  private lastNotificationTime = 0;
  private readonly cooldownMs: number;
  private hasAttempted = false;
  private lastPermissionDenied = false;

  constructor(cooldownMs = 30_000) {
    this.cooldownMs = cooldownMs;
  }

  getStatus(): NotificationStatus {
    return {
      available: this.hasAttempted,
      permissionDenied: this.lastPermissionDenied,
    };
  }

  async send(payload: NotificationPayload): Promise<void> {
    const now = Date.now();
    if (now - this.lastNotificationTime < this.cooldownMs) {
      return;
    }
    this.lastNotificationTime = now;

    const os = platform();
    try {
      this.hasAttempted = true;
      if (os === 'darwin') {
        await this.sendMacOS(payload);
      } else if (os === 'linux') {
        await this.sendLinux(payload);
      } else if (os === 'win32') {
        await this.sendWindows(payload);
      }
      this.lastPermissionDenied = false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastPermissionDenied = /not allowed|permission|denied/i.test(msg);
    }
  }

  private async sendMacOS({ title, message }: NotificationPayload): Promise<void> {
    await execFileAsync('osascript', [
      '-e',
      `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`,
    ]);
  }

  private async sendLinux({ title, message }: NotificationPayload): Promise<void> {
    await execFileAsync('notify-send', [title, message]);
  }

  private async sendWindows({ title, message }: NotificationPayload): Promise<void> {
    await execFileAsync('powershell', [
      '-c',
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${message.replace(/'/g, "''")}', '${title.replace(/'/g, "''")}')`,
    ]);
  }
}
