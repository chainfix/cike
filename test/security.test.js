'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { ProfileStore } = require('../src/store');
const { ProxyStore } = require('../src/proxystore');
const { BrowserManager } = require('../src/browser');
const { buildBackend } = require('../src/server');
const { HOST_PLATFORM } = require('../src/fingerprint');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cike-security-'));
const provider = { encrypt: s => Buffer.from(s).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString() }; // codec fixture, not production encryption

test('legacy migration is explicit, credentials stay private, corrupt data fails closed', async () => {
  const dir = temp();
  try {
    const store = new ProfileStore(dir);
    const old = store.create({ name: 'old', proxy: { server: 'http://127.0.0.1:1234', password: 'test-secret' } });
    const records = JSON.parse(fs.readFileSync(store.file));
    delete records[old.id].fingerprintMode;
    Object.assign(records[old.id], { platform: 'win', hardwareConcurrency: 4, deviceMemory: 8, canvasNoise: true, webrtc: 'disabled' });
    fs.writeFileSync(store.file, JSON.stringify(records));
    fs.mkdirSync(store.profileDir(old.id));
    fs.writeFileSync(path.join(store.profileDir(old.id), 'session-fixture'), 'preserved');
    fs.chmodSync(store.file, 0o644); fs.chmodSync(dir, 0o755);
    const loaded = new ProfileStore(dir, provider);
    assert.equal(loaded.get(old.id).fingerprintMode, 'legacy');
    await assert.rejects(new BrowserManager(loaded).open(old.id), /转换/);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
    assert.ok(!fs.readFileSync(store.file, 'utf8').includes('test-secret'));
    assert.equal(loaded.get(old.id).proxy.password, 'test-secret');
    assert.equal(loaded.public(loaded.get(old.id)).proxy.password, undefined);
    assert.throws(() => new ProfileStore(dir), /桌面版/);
    const migrated = loaded.update(old.id, { fingerprintMode: 'native' });
    assert.equal(migrated.platform, HOST_PLATFORM);
    assert.equal(migrated.previousFingerprint.platform, 'win');
    assert.equal(migrated.hardwareConcurrency, null);
    assert.equal(migrated.webrtc, 'restricted');
    assert.equal(fs.readFileSync(path.join(store.profileDir(old.id), 'session-fixture'), 'utf8'), 'preserved');
    assert.throws(() => loaded.create({ hardwareConcurrency: 4 }), /原生一致/);
    assert.throws(() => loaded.create({ proxy: { server: 'http://user:pass@localhost:80' } }), /认证/);
    assert.throws(() => loaded.profileDir('../escape'), /ID/);
    fs.writeFileSync(store.file, '{broken');
    assert.throws(() => new ProfileStore(dir), /恢复备份/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('missing, failed, stale and unknown-region proxies cannot launch or fall back', async () => {
  const dir = temp();
  let manager;
  try {
    const store = new ProfileStore(dir), proxies = new ProxyStore(dir, provider);
    const x = proxies.add({ type: 'http', host: '127.0.0.1', port: 9, password: 'test-secret' });
    const p = store.create({ proxyId: x.id });
    assert.ok(!fs.readFileSync(proxies.file, 'utf8').includes('test-secret'));
    let check = async () => ({ status: 'failed', error: 'fixture authentication rejected' });
    manager = new BrowserManager(store, proxies, null, { checkProxy: (...args) => check(...args) });
    await assert.rejects(manager.open(p.id), /authentication/);
    check = async () => ({ status: 'ok', exitIp: '192.0.2.1', countryCode: null, timezone: null });
    await assert.rejects(manager.open(p.id), /时区未知/);
    store.update(p.id, { timezone: 'UTC' });
    await assert.rejects(manager.open(p.id), /地区未知/);
    check = async () => { proxies.update(x.id, { port: 10 }); return { status: 'ok' }; };
    await assert.rejects(manager.open(p.id), /发生变化/);
    proxies.remove(x.id);
    await assert.rejects(manager.open(p.id), /阻止直连/);
    assert.equal(manager.sessions.size, 0);
  } finally { await manager?.closeAll(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('API uses header auth, rejects foreign origins, protects proxy references and redacts inline passwords', async () => {
  const dir = temp(), b = buildBackend(dir);
  const server = http.createServer(b.app.callback());
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/api`;
  const request = (p, method = 'GET', body, headers = {}) => fetch(url + p, { method, headers: { 'x-api-token': b.token, 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  try {
    assert.equal((await fetch(url + '/profiles?token=' + b.token)).status, 401);
    assert.equal((await request('/profiles', 'GET', null, { origin: 'https://example.com' })).status, 403);
    const preflight = await fetch(url + '/profiles', { method: 'OPTIONS', headers: { origin: 'null', 'Access-Control-Request-Headers': 'x-api-token,content-type' } });
    assert.equal(preflight.status, 204);
    const p = b.store.create({ proxy: { server: 'http://127.0.0.1:9', password: 'fixture-secret' } });
    assert.ok(!(await (await request('/profiles')).text()).includes('fixture-secret'));
    const x = b.proxyStore.add({ type: 'http', host: '127.0.0.1', port: 9 });
    b.store.update(p.id, { proxyId: x.id });
    assert.equal((await request('/proxies/' + x.id, 'DELETE')).status, 409);
    assert.equal((await request('/profiles/' + p.id, 'PATCH', { proxyId: null })).status, 200);
    assert.equal((await request('/proxies/' + x.id, 'DELETE')).status, 200);
  } finally { await b.browsers.closeAll(); await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
});
