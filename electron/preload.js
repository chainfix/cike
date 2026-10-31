'use strict';
/**
 * Preload: minimal bridge. The renderer talks to the Local API over HTTP;
 * only connection info and a few native actions cross the bridge.
 */
const { contextBridge, ipcRenderer } = require('electron');

const connection = ipcRenderer.sendSync('connection-info');
contextBridge.exposeInMainWorld('lfb', {
  apiBase: connection.apiBase || '',
  token: connection.token || '',
  readProxyClipboard: () => ipcRenderer.invoke('proxy-clipboard'),
  chromiumStatus: () => ipcRenderer.invoke('chromium-status'),
  chromiumDownload: () => ipcRenderer.invoke('chromium-download'),
  onChromiumProgress: (cb) => ipcRenderer.on('chromium-download-progress', (_e, p) => cb(p)),
  openDataDir: () => ipcRenderer.invoke('open-data-dir'),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
});
