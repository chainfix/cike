'use strict';
/**
 * Preload: minimal bridge. The renderer talks to the Local API over HTTP;
 * only connection info and a few native actions cross the bridge.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lfb', {
  apiBase: process.env.LFB_API_URL || '',
  token: process.env.LFB_API_TOKEN || '',
  platform: process.platform,
  chromiumStatus: () => ipcRenderer.invoke('chromium-status'),
  chromiumDownload: () => ipcRenderer.invoke('chromium-download'),
  onChromiumProgress: (cb) => ipcRenderer.on('chromium-download-progress', (_e, p) => cb(p)),
  openDataDir: () => ipcRenderer.invoke('open-data-dir'),
  dataDir: () => ipcRenderer.invoke('data-dir'),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
});
