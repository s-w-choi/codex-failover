import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openDashboard: () => ipcRenderer.send('open-dashboard'),
  resetFallback: () => ipcRenderer.send('reset-fallback'),
  onRefresh: (callback: () => void) => ipcRenderer.on('refresh', () => callback()),
  resizePopup: (height: number) => ipcRenderer.send('resize-popup', height),
});
