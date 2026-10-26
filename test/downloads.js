'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const http = require('http');
const { buildBackend } = require('../src/server');

test('Chromium downloads keep real paths, filenames and contents after closing profiles', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cike-download-test-'));
  const directory = path.join(root, 'Downloads');
  const server = http.createServer((req, res) => {
    if (req.url === '/file') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="sample.pem"' });
      res.end('download regression fixture');
    } else {
      res.end('<a href="/file">download</a><a target="_blank" href="/file">popup</a>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { browsers, store } = buildBackend(path.join(root, 'data'), { downloadsDirectory: directory });
  try {
    const profile = store.create({ name: 'downloads', timezone: 'UTC', locale: 'en-US' });
    await browsers.open(profile.id, { headless: true });
    const context = browsers.getContext(profile.id);
    const page = await context.newPage();
    // Closing the original tab must not revert the browser-wide policy.
    await context.pages()[0].close();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    for (const label of ['download', 'popup', 'download']) {
      const event = page.waitForEvent('download');
      await page.getByText(label, { exact: true }).click();
      assert.equal(await (await event).failure(), null);
    }
    // Blob downloads are commonly used to export keys and generated documents.
    const event = page.waitForEvent('download');
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob(['blob fixture']));
      link.download = '导出.txt';
      link.click();
    });
    assert.equal(await (await event).failure(), null);
    const history = await context.newPage();
    await history.goto('chrome://downloads/');
    await history.locator('downloads-item').nth(3).waitFor();
    const paths = await history.locator('downloads-item').evaluateAll(items => items.map(item => item.data.filePath));
    assert.equal(paths.length, 4);
    for (const savedPath of paths) assert.equal(path.dirname(savedPath), directory);
    await browsers.close(profile.id);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['sample (1).pem', 'sample (2).pem', 'sample.pem', '导出.txt'].sort());
    for (const name of ['sample.pem', 'sample (1).pem', 'sample (2).pem']) {
      assert.equal(await fs.readFile(path.join(directory, name), 'utf8'), 'download regression fixture');
    }
    assert.equal(await fs.readFile(path.join(directory, '导出.txt'), 'utf8'), 'blob fixture');
  } finally {
    await browsers.closeAll();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});
