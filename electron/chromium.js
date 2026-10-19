'use strict';
/**
 * First-run Chromium acquisition for the packaged app.
 *
 * Downloads Playwright's Chromium build (Chrome-for-Testing layout) for the
 * current platform into the app data dir:
 *   <dataDir>/browsers/chromium/...
 * and records the executable path in:
 *   <dataDir>/browsers/chromium-executable.txt
 *
 * Uses only Node https + the OS unzip tool (macOS ships /usr/bin/unzip).
 * Fully self-contained: does not depend on Playwright's internal layout.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');

function browsersJson() {
  const pkgPath = require.resolve('playwright-core/package.json');
  const p = path.join(path.dirname(pkgPath), 'browsers.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function chromiumEntry() {
  const j = browsersJson();
  const e = (j.browsers || []).find((b) => b.name === 'chromium');
  if (!e) throw new Error('chromium entry not found in playwright browsers.json');
  return e;
}

function cftPlatform() {
  const key = `${process.platform}-${process.arch}`;
  const map = {
    'darwin-arm64': 'mac-arm64',
    'darwin-x64': 'mac-x64',
    'linux-x64': 'linux64',
    'win32-x64': 'win64',
  };
  const p = map[key];
  if (!p) throw new Error('unsupported platform for chromium download: ' + key);
  return p;
}

function cftFileName() {
  const p = cftPlatform();
  if (p === 'mac-arm64') return 'chrome-mac-arm64.zip';
  if (p === 'mac-x64') return 'chrome-mac-x64.zip';
  if (p === 'linux64') return 'chrome-linux64.zip';
  return 'chrome-win64.zip';
}

function downloadUrl() {
  const { browserVersion } = chromiumEntry();
  const host = process.env.PLAYWRIGHT_DOWNLOAD_HOST || 'https://cdn.playwright.dev';
  return `${host}/builds/cft/${browserVersion}/${cftPlatform()}/${cftFileName()}`;
}

function browserRoot(dataDir) {
  return path.join(dataDir, 'browsers', 'chromium');
}

function executableMarker(dataDir) {
  return path.join(dataDir, 'browsers', 'chromium-executable.txt');
}

async function chromiumStatus(dataDir) {
  try {
    const exe = fs.readFileSync(executableMarker(dataDir), 'utf8').trim();
    if (exe && fs.existsSync(exe)) {
      return { installed: true, executable: exe, version: chromiumEntry().browserVersion };
    }
  } catch { /* not installed */ }
  return { installed: false, executable: null, version: chromiumEntry().browserVersion };
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    const req = https.get(url, { headers: { 'User-Agent': 'CIKE/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        out.close();
        fs.unlink(dest, () => {});
        return downloadFile(res.headers.location, dest, onProgress).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        out.close();
        return reject(new Error(`download failed: HTTP ${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let done = 0;
      res.on('data', (c) => {
        done += c.length;
        if (total && onProgress) onProgress({ done, total, pct: Math.round((done / total) * 100) });
      });
      res.pipe(out);
      out.on('finish', () => resolve(dest));
    });
    req.on('error', (e) => {
      out.close();
      reject(e);
    });
    req.setTimeout(120000, () => req.destroy(new Error('download timed out')));
  });
}

function unzip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    // Windows has no unzip; its bundled bsdtar (System32\tar.exe) extracts zips.
    const [bin, args] = process.platform === 'win32'
      ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zipPath, '-C', destDir]]
      : [process.platform === 'darwin' ? '/usr/bin/unzip' : 'unzip', ['-q', '-o', zipPath, '-d', destDir]];
    execFile(bin, args, { timeout: 600000 }, (err) => {
      if (err) return reject(new Error('unzip failed: ' + err.message));
      resolve();
    });
  });
}

/** Locate the browser executable inside the extracted tree. */
function findExecutable(root) {
  const hits = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.endsWith('.app')) {
          const macos = path.join(full, 'Contents', 'MacOS');
          try {
            const bins = fs.readdirSync(macos).filter((f) => !f.startsWith('.'));
            if (bins.length) hits.push(path.join(macos, bins[0]));
          } catch { /* not an app bundle */ }
        } else if (hits.length === 0) {
          walk(full);
        }
      } else if (process.platform === 'linux' && e.name === 'chrome') {
        hits.push(full);
      } else if (process.platform === 'win32' && /^chrome\.exe$/i.test(e.name)) {
        hits.push(full);
      }
    }
  };
  walk(root);
  return hits[0] || null;
}

/**
 * Ensure Chromium is present; download + extract with progress callback.
 * Returns the executable path.
 */
async function downloadChromium(dataDir, onProgress) {
  const st = await chromiumStatus(dataDir);
  if (st.installed) return st.executable;
  const url = downloadUrl();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lfb-chromium-'));
  const zipPath = path.join(tmp, 'chromium.zip');
  try {
    await downloadFile(url, zipPath, onProgress);
    const dest = browserRoot(dataDir);
    fs.rmSync(dest, { recursive: true, force: true });
    await unzip(zipPath, dest);
    const exe = findExecutable(dest);
    if (!exe) throw new Error('downloaded archive does not contain a browser executable');
    try { fs.chmodSync(exe, 0o755); } catch { /* ignore */ }
    // Brand the downloaded Chromium.app with the CK icon so opened browser
    // windows show CK in the Dock instead of the stock Chromium icon.
    try { brandChromiumApp(dest); } catch (e) { console.warn('[chromium] icon branding failed:', e.message); }
    fs.mkdirSync(path.dirname(executableMarker(dataDir)), { recursive: true });
    fs.writeFileSync(executableMarker(dataDir), exe + '\n');
    if (onProgress) onProgress({ done: 1, total: 1, pct: 100 });
    return exe;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Replace the icon of the downloaded Chromium.app with the CK brand icon.
 * macOS only; no-op on other platforms or if the icon asset is missing.
 */
function brandChromiumApp(root) {
  if (process.platform !== 'darwin') return;
  // Find the .app bundle
  let appPath = null;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.endsWith('.app')) { appPath = full; return; }
        if (!appPath) walk(full);
      }
    }
  };
  walk(root);
  if (!appPath) return;
  // Locate our CK icon (packaged with the app)
  const iconSrc = path.join(__dirname, 'assets', 'icon.icns');
  if (!fs.existsSync(iconSrc)) return;
  // Find the icon file referenced by Info.plist, or fall back to app.icns
  let iconName = 'app.icns';
  try {
    const plistPath = path.join(appPath, 'Contents', 'Info.plist');
    const plist = fs.readFileSync(plistPath, 'utf8');
    const m = plist.match(/<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/);
    if (m) iconName = m[1].endsWith('.icns') ? m[1] : m[1] + '.icns';
  } catch { /* use default */ }
  const iconDest = path.join(appPath, 'Contents', 'Resources', iconName);
  fs.copyFileSync(iconSrc, iconDest);
  // Touch the bundle so Finder picks up the change
  try { fs.utimesSync(appPath, new Date(), new Date()); } catch { /* ignore */ }
}

module.exports = { chromiumStatus, downloadChromium, downloadUrl, executableMarker, brandChromiumApp, browserRoot };
