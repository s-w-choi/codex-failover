import { BrowserWindow, Tray, app, nativeImage } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const popupPath = join(__dirname, 'popup.html');
const API_URL = 'http://127.0.0.1:8787/api';
const TRAY_ICON_SIZE = 18;
const USE_TEMPLATE_ICONS = process.env.CODEX_FAILOVER_TRAY_TEMPLATE === '1';
const TRAY_STATUS_POLL_MS = 5_000;

const iconFiles = {
  active: 'icon-active.png',
  fallback: 'icon-fallback.png',
  error: 'icon-error.png',
  unknown: 'icon-unknown.png',
};

let tray: Tray | null = null;
let popup: BrowserWindow | null = null;
const iconCache = new Map<keyof typeof iconFiles, Electron.NativeImage>();

function getPopup(): BrowserWindow {
  if (popup) return popup;
  popup = new BrowserWindow({
    width: 340,
    height: 520,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    type: 'panel',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  popup.loadURL(`file://${popupPath}`);
  popup.on('closed', () => {
    popup = null;
  });
  return popup;
}

function positionPopup() {
  const window = getPopup();
  const trayBounds = tray?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 };
  const { width } = window.getBounds();
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
  const y = Math.round(trayBounds.y + trayBounds.height);
  window.setPosition(x, y);
}

async function togglePopup() {
  const window = getPopup();
  if (window.isVisible()) {
    window.hide();
  } else {
    await pollStatus();
    positionPopup();
    window.show();
    window.focus();
    window.webContents.send('refresh');
  }
}

async function fetchStatus(): Promise<unknown> {
  try {
    const response = await fetch(`${API_URL}/status`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function loadIcon(name: keyof typeof iconFiles): Electron.NativeImage {
  const cached = iconCache.get(name);
  if (cached) {
    return cached;
  }

  const path = join(__dirname, iconFiles[name]);
  let image = nativeImage.createFromPath(path);

  if (image.isEmpty()) {
    const fallback = createFallbackIcon();
    iconCache.set(name, fallback);
    return fallback;
  }

  image = trimTransparentBounds(image);
  image = normalizeToSquare(image);

  image = image.resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE, quality: 'best' });

  if (process.platform === 'darwin') {
    image.setTemplateImage(USE_TEMPLATE_ICONS);
  }

  iconCache.set(name, image);
  return image;
}

function trimTransparentBounds(source: Electron.NativeImage): Electron.NativeImage {
  const { width, height } = source.getSize();
  const bitmap = source.toBitmap();
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = bitmap[(y * width + x) * 4 + 3];
      if (alpha > 10) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0 || maxY < 0) {
    return source;
  }

  return source.crop({
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  });
}

function normalizeToSquare(source: Electron.NativeImage): Electron.NativeImage {
  const size = source.getSize();
  if (size.width === size.height) {
    return source;
  }

  const side = Math.max(size.width, size.height);
  const src = source.toBitmap();
  const out = Buffer.alloc(side * side * 4, 0);
  const offsetX = Math.floor((side - size.width) / 2);
  const offsetY = Math.floor((side - size.height) / 2);

  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const srcIndex = (y * size.width + x) * 4;
      const dstIndex = ((y + offsetY) * side + (x + offsetX)) * 4;
      out[dstIndex] = src[srcIndex];
      out[dstIndex + 1] = src[srcIndex + 1];
      out[dstIndex + 2] = src[srcIndex + 2];
      out[dstIndex + 3] = src[srcIndex + 3];
    }
  }

  return nativeImage.createFromBitmap(out, {
    width: side,
    height: side,
    scaleFactor: 1,
  });
}

function createFallbackIcon(): Electron.NativeImage {
  const scaleFactor = 2;
  const width = TRAY_ICON_SIZE * scaleFactor;
  const height = TRAY_ICON_SIZE * scaleFactor;
  const center = width / 2;
  const radius = Math.floor(width * 0.28);
  const bitmap = Buffer.alloc(width * height * 4, 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - center;
      const dy = y - center;
      if (dx * dx + dy * dy <= radius * radius) {
        const index = (y * width + x) * 4;
        bitmap[index] = 0;
        bitmap[index + 1] = 0;
        bitmap[index + 2] = 0;
        bitmap[index + 3] = 255;
      }
    }
  }

  const fallback = nativeImage.createFromBitmap(bitmap, {
    width,
    height,
    scaleFactor,
  });

  if (process.platform === 'darwin') {
    fallback.setTemplateImage(USE_TEMPLATE_ICONS);
  }

  return fallback;
}

function updateTray(status: unknown) {
  if (!status || typeof status !== 'object') {
    tray?.setImage(loadIcon('unknown'));
    tray?.setToolTip('codex-failover — connecting...');
    return;
  }

  const data = status as Record<string, unknown>;
  const providers = Array.isArray(data.providers) ? data.providers : [];
  const enabledProviders = providers.filter((p: Record<string, unknown>) => p.enabled);
  const primaryProvider = enabledProviders[0] as Record<string, unknown> | undefined;
  const primaryId = primaryProvider?.id as string | undefined;
  const rawActiveId = typeof data.activeProviderId === 'string' ? data.activeProviderId : '';
  const activeProviderId = rawActiveId || primaryId || '';
  const isFallback = primaryId ? activeProviderId !== primaryId : false;
  const hasEnabledProviders = enabledProviders.length > 0;
  const hasActiveProvider = !!activeProviderId;

  if (isFallback) {
    tray?.setImage(loadIcon('fallback'));
    tray?.setToolTip(`codex-failover — fallback: ${activeProviderId}`);
  } else if (hasActiveProvider) {
    tray?.setImage(loadIcon('active'));
    tray?.setToolTip(`codex-failover — ${activeProviderId}`);
  } else if (hasEnabledProviders) {
    tray?.setImage(loadIcon('active'));
    tray?.setToolTip('codex-failover — starting...');
  } else {
    tray?.setImage(loadIcon('error'));
    tray?.setToolTip('codex-failover — no provider');
  }
}

async function pollStatus() {
  const status = await fetchStatus();
  updateTray(status);
}

app.whenReady().then(() => {
  tray = new Tray(loadIcon('unknown'));
  tray.setToolTip('codex-failover');
  tray.on('click', () => {
    void togglePopup();
  });

  app.dock?.hide();
  void pollStatus();
  setInterval(() => {
    void pollStatus();
  }, TRAY_STATUS_POLL_MS);
});

app.on('window-all-closed', () => {
});
