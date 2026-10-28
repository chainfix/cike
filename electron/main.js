'use strict';
/**
 * CIKE — Electron shell.
 * Main process starts the local backend (Koa API + profile/browser manager)
 * and hosts the management UI, which talks to the same Local API over HTTP.
 */
const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');

const { startBackend, DATA_DIR } = require('../src/server');
const { chromiumStatus, downloadChromium, executableMarker, brandChromiumApp } = require('./chromium');
const { checkUpdate, installUpdate } = require('./updater');

let backend = null;
let mainWindow = null;

// If Chromium was downloaded before, point the backend at it.
function applyChromiumEnv() {
  try {
    const exe = fs.readFileSync(executableMarker(DATA_DIR), 'utf8').trim();
    if (exe) process.env.LFB_CHROMIUM_EXECUTABLE = exe;
  } catch { /* not downloaded yet */ }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'CIKE',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Backend connection info for the renderer (via preload).
  process.env.LFB_API_URL = backend.url;
  process.env.LFB_API_TOKEN = backend.token;

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Open http(s) links in the system browser, not in the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

app.whenReady().then(async () => {
  applyChromiumEnv();
  try {
    backend = await startBackend(undefined, { resolveSystemProxy: url => session.defaultSession.resolveProxy(url), downloadsDirectory: app.getPath('downloads') });
  } catch (err) {
    console.error('[CIKE] backend failed to start:', err.message);
    app.exit(1);
    return;
  }
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  try {
    await backend?.browsers.closeAll();
  } catch { /* ignore */ }
  backend?.server.close();
  if (process.platform !== 'darwin') app.quit();
});

// --- renderer IPC ---

ipcMain.handle('chromium-status', async () => {
  const st = await chromiumStatus(DATA_DIR);
  // Ensure the already-downloaded Chromium.app carries the CK icon
  if (st.installed) {
    try {
      const { browserRoot } = require('./chromium');
      brandChromiumApp(browserRoot(DATA_DIR));
    } catch { /* best effort */ }
  }
  return st;
});

ipcMain.handle('chromium-download', async (event) => {
  const send = (p) => event.sender.send('chromium-download-progress', p);
  try {
    const exe = await downloadChromium(DATA_DIR, send);
    process.env.LFB_CHROMIUM_EXECUTABLE = exe;
    return { ok: true, executable: exe };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('open-data-dir', async () => {
  shell.openPath(backend.dataDir);
  return { ok: true };
});

ipcMain.handle('data-dir', async () => ({ ok: true, dataDir: backend.dataDir }));

ipcMain.handle('update-check', () => checkUpdate());
ipcMain.handle('update-install', () => installUpdate());
