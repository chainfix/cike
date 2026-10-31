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
  if (process.env.LFB_CHROMIUM_EXECUTABLE) {
    fs.mkdirSync(path.join(dir, 'browsers'));
    fs.writeFileSync(path.join(dir, 'browsers/chromium-executable.txt'), process.env.LFB_CHROMIUM_EXECUTABLE);
  }
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
    await app.evaluate(async ({ clipboard }) => {
      globalThis.cikeClipboardBackup = await clipboard.read();
      await clipboard.writeText('socks5://fixture-user:fixture-pass@127.0.0.1:1080');
    });
    try {
      const card = page.locator('.env-card').filter({ hasText: 'Legacy fixture' });
      await card.locator('[data-act="proxy"]').click();
      await page.waitForFunction(() => document.querySelector('#ep-user')?.value === 'fixture-user');
      assert.equal(await page.locator('#ep-type').inputValue(), 'socks5');
      assert.equal(await page.locator('#ep-port').inputValue(), '1080');
      assert.equal(await page.locator('#ep-pass').inputValue(), 'fixture-pass');
      // Clear the test password to keep packaged tests independent of Keychain approval.
      await page.locator('#ep-pass').fill('');
      await page.locator('#ep-save').click();
      await page.getByText('当前环境代理已修改', { exact: true }).waitFor();
      assert.equal(JSON.parse(fs.readFileSync(profiles.file))[p.id].proxyId, null);
      assert.equal(JSON.parse(fs.readFileSync(profiles.file))[p.id].proxy.server, 'socks5://127.0.0.1:1080');
      assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'proxies.json')))).length, 1);
      assert.ok(await card.getByText(/最后打开 尚未打开/).isVisible());
      assert.ok(await card.locator('.environment-number').isVisible());
      if (process.env.LFB_CHROMIUM_EXECUTABLE) {
        const newCard = page.locator('.env-card').filter({ has: page.locator('.name', { hasText: /^2$/ }) });
        await newCard.locator('[data-act="open"]').click();
        await newCard.getByText('运行中', { exact: true }).waitFor({ timeout: 30000 });
        assert.ok(JSON.parse(fs.readFileSync(profiles.file))[Object.keys(JSON.parse(fs.readFileSync(profiles.file))).find(id => id !== p.id)].lastOpenedAt);
        await newCard.locator('[data-act="close"]').click();
        await newCard.getByText('已关闭', { exact: true }).waitFor();
      }
      if (process.env.CIKE_SCREENSHOT) await page.screenshot({ path: process.env.CIKE_SCREENSHOT });
    } finally {
      await app.evaluate(async ({ clipboard, ClipboardItem }) => {
        const items = await Promise.all(globalThis.cikeClipboardBackup.map(async item => {
          const entries = await Promise.all(item.types.map(async type => [type, await item.getType(type)]));
          return new ClipboardItem(Object.fromEntries(entries));
        }));
        if (items.length) await clipboard.write(items); else clipboard.clear();
        delete globalThis.cikeClipboardBackup;
      });
    }
  } finally { await app?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
