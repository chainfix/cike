'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const cp = require('child_process');
const { ProfileStore } = require('../src/store');
const { BrowserManager } = require('../src/browser');

async function fingerprint() {
  const c = new OffscreenCanvas(64, 64), x = c.getContext('2d');
  x.fillStyle = 'rgb(120,180,200)'; x.fillRect(0, 0, 64, 64);
  return { ua: navigator.userAgent, platform: navigator.platform, cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory,
    language: navigator.language, languages: [...navigator.languages], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    brands: navigator.userAgentData?.brands, high: await navigator.userAgentData?.getHighEntropyValues(['platform', 'architecture', 'bitness', 'fullVersionList']),
    pixel: Array.from(x.getImageData(0, 0, 1, 1).data), marks: Object.getOwnPropertyNames(Function.prototype).filter(k => k.includes('lfb')) };
}
async function storage(page, write) {
  return page.evaluate(async write => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('audit', 1); r.onupgradeneeded = () => r.result.createObjectStore('data'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    if (write) {
      document.cookie = 'audit=A; path=/; max-age=3600'; localStorage.setItem('audit', 'A');
      await new Promise((resolve, reject) => { const t = db.transaction('data', 'readwrite'); t.objectStore('data').put('A', 'id'); t.oncomplete = resolve; t.onerror = () => reject(t.error); });
      await (await caches.open('audit')).put('/marker', new Response('A'));
      await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
    }
    const value = await new Promise(resolve => { const r = db.transaction('data').objectStore('data').get('id'); r.onsuccess = () => resolve(r.result ?? null); }); db.close();
    const cached = await caches.match('/marker');
    return { cookie: document.cookie, local: localStorage.getItem('audit'), idb: value, cache: cached ? await cached.text() : null, sw: (await navigator.serviceWorker.getRegistrations()).length };
  }, write);
}
test('native fingerprints agree across realms, sandbox stays enabled and five storage categories remain isolated', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cike-runtime-'));
  const server = http.createServer((q, r) => {
    if (q.url === '/worker.js') { r.setHeader('content-type', 'text/javascript'); r.end(`(${fingerprint.toString()})().then(x=>postMessage(x))`); }
    else if (q.url === '/shared.js') { r.setHeader('content-type', 'text/javascript'); r.end(`onconnect=e=>(${fingerprint.toString()})().then(x=>e.ports[0].postMessage(x));`); }
    else if (q.url === '/sw.js') { r.setHeader('content-type', 'text/javascript'); r.end(`self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(clients.claim()));self.addEventListener('message',e=>e.waitUntil((${fingerprint.toString()})().then(x=>e.ports[0].postMessage(x))));`); }
    else if (q.url === '/headers') { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(q.headers)); }
    else { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><iframe src="/frame"></iframe>'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const store = new ProfileStore(dir), manager = new BrowserManager(store, null, null, { downloadsDirectory: path.join(dir, 'Downloads') });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const a = store.create({ locale: 'en-US', timezone: 'America/New_York' }), b = store.create({ locale: 'en-US', timezone: 'America/New_York' });
    const headless = process.env.CIKE_HEADED !== '1';
    const results = await Promise.all([manager.open(a.id, { headless }), manager.open(a.id, { headless })]);
    assert.equal(manager.sessions.size, 1); assert.ok(results.every(r => !r.debug_url));
    const page = await manager.getContext(a.id).newPage(); await page.goto(origin);
    const main = await page.evaluate(fingerprint);
    const worker = await page.evaluate(() => new Promise((resolve, reject) => { const w = new Worker('/worker.js'); w.onmessage = e => { w.terminate(); resolve(e.data); }; w.onerror = reject; }));
    const shared = await page.evaluate(() => new Promise((resolve, reject) => { const w = new SharedWorker('/shared.js'); w.port.onmessage = e => { w.port.close(); resolve(e.data); }; w.onerror = reject; }));
    assert.deepEqual(worker, main); assert.deepEqual(shared, main);
    assert.deepEqual(await page.frames()[1].evaluate(fingerprint), main);
    assert.deepEqual(main.marks, []);
    assert.equal(main.timezone, 'America/New_York');
    assert.equal(main.language, 'en-US');
    for (const brand of main.brands) assert.ok(main.high.fullVersionList.some(b => b.brand === brand.brand && b.version.split('.')[0] === brand.version));
    const headers = await page.evaluate(() => fetch('/headers').then(r => r.json()));
    assert.equal(headers['user-agent'], main.ua);
    for (const brand of main.brands) assert.ok(headers['sec-ch-ua'].includes(`"${brand.brand}";v="${brand.version}"`));
    const stable = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const draw = () => { x.fillStyle = 'rgb(120,180,200)'; x.fillRect(0,0,64,64); }; draw(); const a = c.toDataURL(), after = Array.from(x.getImageData(0,0,1,1).data); draw(); return { same: a === c.toDataURL(), after }; });
    assert.deepEqual(stable, { same: true, after: [120,180,200,255] });
    const expected = { cookie: 'audit=A', local: 'A', idb: 'A', cache: 'A', sw: 1 };
    assert.deepEqual(await storage(page, true), expected);
    const service = await page.evaluate(async () => { const reg = await navigator.serviceWorker.ready; return new Promise(resolve => { const ch = new MessageChannel(); ch.port1.onmessage = e => resolve(e.data); reg.active.postMessage('probe', [ch.port2]); }); });
    assert.deepEqual(service, main);
    const lines = cp.execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8' }).split('\n').filter(l => l.includes('--user-data-dir=' + store.profileDir(a.id)));
    assert.ok(lines.length); assert.ok(lines.every(l => !l.includes('--no-sandbox') && !l.includes('--remote-debugging-port')));
    assert.ok(lines.some(l => l.includes('--site-per-process')));
    assert.ok(lines.some(l => l.includes('disable_non_proxied_udp')));
    await manager.open(b.id, { headless }); const pageB = await manager.getContext(b.id).newPage(); await pageB.goto(origin);
    assert.deepEqual(await storage(pageB, false), { cookie: '', local: null, idb: null, cache: null, sw: 0 });
    await manager.close(a.id); await manager.open(a.id, { headless });
    const again = await manager.getContext(a.id).newPage(); await again.goto(origin);
    assert.deepEqual(await storage(again, false), expected);
    assert.deepEqual(await again.evaluate(fingerprint), main);
    const native = store.create({});
    await manager.open(native.id, { headless });
    const nativePage = await manager.getContext(native.id).newPage(); await nativePage.goto(origin);
    const nativeMain = await nativePage.evaluate(fingerprint);
    const nativeWorker = await nativePage.evaluate(() => new Promise(resolve => { const w = new Worker('/worker.js'); w.onmessage = e => { w.terminate(); resolve(e.data); }; }));
    assert.deepEqual(nativeWorker, nativeMain);
    assert.equal(nativeMain.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  } finally { await manager.closeAll(); await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
});
