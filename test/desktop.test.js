'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron } = require('playwright');
const { ProfileStore } = require('../src/store');
const { ProxyStore } = require('../src/proxystore');

test('sandboxed desktop UI can authenticate, migrate profiles and protect secrets with safeStorage', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cike-desktop-'));
  const profiles = new ProfileStore(dir), proxies = new ProxyStore(dir);
  // Re-signed ad-hoc packages can require interactive Keychain approval on
  // macOS. Exercise encryption in the stable source Electron binary; package
  // smoke tests use empty credentials and still verify sandbox/UI/migration.
  const secret = process.env.CIKE_TEST_APP ? '' : 'desktop-fixture-secret';
  const saved = proxies.add({ type: 'http', host: '127.0.0.1', port: 9, password: secret });
  const p = profiles.create({ name: 'Legacy fixture', proxyId: saved.id });
  const records = JSON.parse(fs.readFileSync(profiles.file)); delete records[p.id].fingerprintMode;
  fs.writeFileSync(profiles.file, JSON.stringify(records));
  let app;
  try {
    app = await _electron.launch({ args: process.env.CIKE_TEST_APP ? [] : [path.resolve(__dirname, '..')],
      ...(process.env.CIKE_TEST_APP ? { executablePath: process.env.CIKE_TEST_APP } : {}),
      env: { ...process.env, LFB_DATA: dir }, timeout: 30000 });
    const page = await app.firstWindow();
    await page.getByText('Legacy fixture', { exact: true }).waitFor();
    assert.ok(await page.getByText('旧环境 · 需要转换', { exact: true }).isVisible());
    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration };
    });
    assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false });
    const content = fs.readFileSync(path.join(dir, 'proxies.json'), 'utf8');
    if (secret) { assert.ok(!content.includes(secret)); assert.ok(content.includes('safe-storage-v1')); }
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator('#f-convert').check(); await page.locator('#m-save').click();
    await page.getByText('原生一致', { exact: true }).waitFor();
    assert.equal(JSON.parse(fs.readFileSync(profiles.file))[p.id].fingerprintMode, 'native');
    assert.equal(await page.evaluate(() => typeof require), 'undefined');
    // Assert the CSP is present and a script element cannot run inline code.
    await page.evaluate(() => { const script = document.createElement('script'); script.textContent = 'window.inlineRan = true'; document.body.append(script); });
    assert.equal(await page.evaluate(() => window.inlineRan), undefined);
    await page.getByRole('button', { name: '新建环境', exact: true }).click();
    await page.locator('#n-save').click();
    await page.getByText('环境已创建', { exact: true }).waitFor();
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(profiles.file))).length, 2);
  } finally { await app?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
