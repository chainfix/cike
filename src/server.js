'use strict';
/**
 * Local automation API — Koa HTTP server on 127.0.0.1.
 *
 * Design mirrors the architecture found in commercial fingerprint browsers:
 *  - port picked from a fixed local range (4440–4539)
 *  - the chosen URL is written to a discovery file so external tools can
 *    find the API without configuration
 *  - header token auth, token persisted with private permissions
 *    in the data dir and printed on first start
 *
 * Everything runs locally. No vendor backend, no account system.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');

const { ProfileStore } = require('./store');
const { ProxyStore } = require('./proxystore');
const { BrowserManager } = require('./browser');
const { checkProxy } = require('./proxycheck');
const { Settings } = require('./settings');

const VERSION = require('../package.json').version;
const DATA_DIR = process.env.LFB_DATA || path.join(os.homedir(), '.local-fingerprint-browser');
const PORT_MIN = 4440;
const PORT_MAX = 4539;
const DISCOVERY_FILE = 'local_api_url.txt';
const { privateDirectory, writePrivate } = require('./privatefiles');
const { HOST_PLATFORM } = require('./fingerprint');
const TOKEN_FILE = 'api_token.txt';

function ensureDataDir(dir) {
  privateDirectory(dir);
  return dir;
}

function getToken(dir) {
  const f = path.join(dir, TOKEN_FILE);
  try {
    if (!fs.lstatSync(f).isFile()) throw new Error('Token 必须是普通文件');
    fs.chmodSync(f, 0o600);
    const t = fs.readFileSync(f, 'utf8').trim();
    if (/^[a-f0-9]{48}$/.test(t)) return t;
    throw new Error('Token 文件损坏');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const t = crypto.randomBytes(24).toString('hex');
  writePrivate(f, t);
  return t;
}

function findFreePort(min, max) {
  return new Promise((resolve, reject) => {
    let port = min;
    const tryNext = () => {
      if (port > max) return reject(new Error('no free API port in range'));
      const s = net.createServer();
      s.once('error', () => { port += 1; tryNext(); });
      s.once('listening', () => s.close(() => resolve(port)));
      s.listen(port, '127.0.0.1');
    };
    tryNext();
  });
}

function need(obj, fields) {
  for (const f of fields) {
    if (obj[f] === undefined || obj[f] === null || obj[f] === '') {
      const err = new Error(`missing required field: ${f}`);
      err.status = 400;
      throw err;
    }
  }
}

/**
 * Build the backend (stores + Koa app) without listening.
 * Returns { app, store, proxyStore, browsers, token, dataDir }.
 */
function buildBackend(dataDir = DATA_DIR, options = {}) {
  ensureDataDir(dataDir);
  const token = getToken(dataDir);
  const store = new ProfileStore(dataDir, options.secretStorage);
  const proxyStore = new ProxyStore(dataDir, options.secretStorage);
  const settings = new Settings(dataDir, options.resolveSystemProxy);
  const browsers = new BrowserManager(store, proxyStore, settings, options);

  const app = new Koa();
  const router = new Router({ prefix: '/api' });

  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      ctx.status = err.status || 500;
      ctx.body = { ok: false, error: err.message };
    }
  });

  app.use(async (ctx, next) => {
    if (!ctx.path.startsWith('/api/')) return next();
    const origin = ctx.get('origin');
    if (origin && origin !== 'null') ctx.throw(403, 'browser origin not allowed');
    if (origin === 'null') {
      ctx.set('Access-Control-Allow-Origin', 'null');
      ctx.set('Vary', 'Origin');
      if (ctx.method === 'OPTIONS') {
        ctx.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        ctx.set('Access-Control-Allow-Headers', 'Content-Type,X-API-Token');
        ctx.status = 204;
        return;
      }
    }
    const t = ctx.get('x-api-token');
    if (Buffer.byteLength(t) !== Buffer.byteLength(token) || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(token))) {
      ctx.status = 401;
      ctx.body = { ok: false, error: 'invalid token' };
      return;
    }
    await next();
  });

  app.use(bodyParser({ jsonLimit: '256kb' }));

  // --- meta ---
  router.get('/getVersion', (ctx) => {
    ctx.body = { ok: true, version: VERSION, name: 'cike', platform: HOST_PLATFORM, fingerprintMode: 'native', credentialProtection: proxyStore.codec.protection };
  });

  router.get('/settings', (ctx) => {
    ctx.body = { ok: true, settings: settings.get() };
  });

  router.patch('/settings', (ctx) => {
    ctx.body = { ok: true, settings: settings.set(ctx.request.body || {}) };
  });

  function proxyDisplay(profile) {
    const proxy = profile.proxyId ? proxyStore.get(profile.proxyId) : null;
    if (profile.proxyId && !proxy) return { proxyRemark: '代理已删除', proxyAddress: '', proxyIp: null, proxyCheckedAt: null };
    const latest = proxy && (!profile.lastNetwork?.checkedAt || proxy.updatedAt > profile.lastNetwork.checkedAt) ? proxy : profile.lastNetwork;
    return {
      proxyRemark: proxy ? proxy.remark : profile.proxy ? '独立代理' : '系统网络',
      proxyAddress: proxy ? `${proxy.host}:${proxy.port}` : profile.proxy?.server || '',
      proxyIp: latest?.exitIp || null,
      proxyCheckedAt: latest?.checkedAt || null,
    };
  }
  // --- profiles ---
  router.get('/profiles', (ctx) => {
    const profiles = store.list().map((p) => ({
      ...store.public(p),
      open: browsers.isOpen(p.id),
      phase: browsers.closing.has(p.id) ? 'closing' : browsers.opening.has(p.id) ? 'opening' : browsers.isOpen(p.id) ? 'open' : 'closed',
      ...proxyDisplay(p),
    }));
    ctx.body = { ok: true, profiles };
  });

  // Parse is explicitly invoked by the proxy editor; never log clipboard text.
  router.post('/proxies/parse', ctx => {
    try { ctx.body = { ok: true, proxy: ProxyStore.parseLine(ctx.request.body?.text) }; }
    catch (error) { ctx.throw(400, error.message); }
  });

  router.put('/profiles/:id/proxy', async ctx => {
    const id = ctx.params.id;
    if (!store.get(id)) ctx.throw(404, '环境不存在');
    if (browsers.isOpen(id)) ctx.throw(409, '请先关闭当前环境再修改代理');
    const body = ctx.request.body || {};
    let patch;
    if (body.mode === 'none') patch = { proxyId: null, proxy: null };
    else if (body.mode === 'saved') {
      if (!proxyStore.get(body.proxyId)) ctx.throw(400, '代理不存在');
      patch = { proxyId: body.proxyId, proxy: null };
    } else if (body.mode === 'custom') {
      // Store an independent inline proxy; shared proxy records stay intact.
      const value = body.text ? ProxyStore.parseLine(body.text) : require('./proxyconfig').validateProxy(body.proxy || {});
      patch = { proxyId: null, proxy: ProxyStore.toPlaywright(value) };
    } else ctx.throw(400, '请选择代理类型');
    ctx.body = { ok: true, profile: store.public(store.update(id, patch)) };
  });

  router.post('/profiles/:id/checkProxy', async ctx => {
    const id = ctx.params.id, profile = store.get(id);
    if (!profile) ctx.throw(404, '环境不存在');
    const proxy = require('./proxyconfig').resolveProxy(profile, proxyStore);
    if (!proxy) ctx.throw(400, '未配置代理，请打开环境检测系统网络出口');
    const result = await (options.checkProxy || checkProxy)(proxy, settings);
    if (JSON.stringify(require('./proxyconfig').resolveProxy(store.get(id) || {}, proxyStore)) !== JSON.stringify(proxy)) ctx.throw(409, '代理已改变，请重新检测');
    if (profile.proxyId) proxyStore.setCheckResult(profile.proxyId, result);
    store.recordNetwork(id, { route: 'proxy', exitIp: result.exitIp || null, checkedAt: new Date().toISOString() });
    ctx.body = { ok: true, result };
  });

  router.post('/profiles', (ctx) => {
    const body = ctx.request.body || {};
    if (body.proxyId && !proxyStore.get(body.proxyId)) ctx.throw(400, 'proxy not found');
    ctx.body = { ok: true, profile: store.public(store.create(body)) };
  });

  router.get('/profiles/:id', (ctx) => {
    const p = store.get(ctx.params.id);
    if (!p) ctx.throw(404, 'profile not found');
    ctx.body = { ok: true, profile: store.public(p) };
  });

  router.patch('/profiles/:id', (ctx) => {
    const body = ctx.request.body || {};
    if (body.proxyId && !proxyStore.get(body.proxyId)) ctx.throw(400, 'proxy not found');
    if (browsers.isOpen(ctx.params.id)) ctx.throw(409, '请先关闭环境再修改设置');
    const p = store.update(ctx.params.id, body);
    if (!p) ctx.throw(404, 'profile not found');
    ctx.body = {
      ok: true,
      profile: store.public(p),
      ...(browsers.isOpen(ctx.params.id) ? { warning: 'profile is open; changes apply on next open' } : {}),
    };
  });

  router.delete('/profiles/:id', async (ctx) => {
    await browsers.close(ctx.params.id);
    if (!store.remove(ctx.params.id)) ctx.throw(404, 'profile not found');
    ctx.body = { ok: true };
  });

  // --- proxies ---
  router.get('/proxies', (ctx) => {
    ctx.body = { ok: true, proxies: proxyStore.list() };
  });

  router.post('/proxies', (ctx) => {
    const body = ctx.request.body || {};
    if (body.bulk) {
      const { added, errors } = proxyStore.bulkAdd(body.bulk, body.type || 'http');
      ctx.body = { ok: true, added, errors };
      return;
    }
    need(body, ['host', 'port']);
    ctx.body = { ok: true, proxy: proxyStore.add({ type: body.type || 'http', ...body }) };
  });

  router.patch('/proxies/:id', (ctx) => {
    if (store.list().some(p => p.proxyId === ctx.params.id && browsers.isOpen(p.id))) ctx.throw(409, '请先关闭使用此代理的环境');
    const p = proxyStore.update(ctx.params.id, ctx.request.body || {});
    if (!p) ctx.throw(404, 'proxy not found');
    ctx.body = { ok: true, proxy: p };
  });

  router.delete('/proxies/:id', (ctx) => {
    if (store.list().some(p => p.proxyId === ctx.params.id)) ctx.throw(409, '代理仍被环境引用，请先解除绑定；不会自动改为直连');
    if (!proxyStore.remove(ctx.params.id)) ctx.throw(404, 'proxy not found');
    ctx.body = { ok: true };
  });

  router.post('/proxies/check', async (ctx) => {
    const body = ctx.request.body || {};
    const ids = body.ids || proxyStore.list().map((p) => p.id);
    const results = [];
    for (const id of ids) {
      const secret = proxyStore.getSecret(id);
      if (!secret) {
        results.push({ id, status: 'failed', error: 'not found' });
        continue;
      }
      const r = await (options.checkProxy || checkProxy)(secret, settings);
      proxyStore.setCheckResult(id, {
        status: r.status,
        exitIp: r.exitIp || null,
        country: r.country || null,
        countryCode: r.countryCode || null,
        timezone: r.timezone || null,
      });
      results.push({ id, ...r });
    }
    ctx.body = { ok: true, results };
  });

  // --- browser sessions ---
  router.post('/openBrowser', async (ctx) => {
    need(ctx.request.body || {}, ['profile_id']);
    const { profile_id, headless = false } = ctx.request.body;
    const profile = store.get(profile_id);
    if (!profile) ctx.throw(404, 'profile not found');
    ctx.body = { ok: true, ...(await browsers.open(profile_id, { headless })) };
  });

  router.post('/closeBrowser', async (ctx) => {
    need(ctx.request.body || {}, ['profile_id']);
    ctx.body = { ok: true, ...(await browsers.close(ctx.request.body.profile_id)) };
  });

  router.get('/checkOpen', (ctx) => {
    need(ctx.query, ['profile_id']);
    ctx.body = { ok: true, profile_id: ctx.query.profile_id, open: browsers.isOpen(ctx.query.profile_id) };
  });

  router.get('/openedList', (ctx) => {
    ctx.body = { ok: true, opened: browsers.listOpen() };
  });

  router.post('/closeAllBrowsers', async (ctx) => {
    ctx.body = { ok: true, ...(await browsers.closeAll()) };
  });

  app.use(router.routes()).use(router.allowedMethods());

  return { app, store, proxyStore, browsers, settings, token, dataDir };
}

/** Start listening; writes the discovery file. Returns { url, port, server, ...backend }. */
async function startBackend(dataDir = DATA_DIR, options = {}) {
  const backend = buildBackend(dataDir, options);
  const port = await findFreePort(PORT_MIN, PORT_MAX);
  const url = `http://127.0.0.1:${port}/`;
  writePrivate(path.join(backend.dataDir, DISCOVERY_FILE), url + '\n');
  const server = await new Promise((resolve, reject) => {
    const s = backend.app.listen(port, '127.0.0.1', () => resolve(s));
    s.once('error', reject);
  });
  return { ...backend, url, port, server };
}

async function main() {
  const b = await startBackend();
  console.log(`[LocalAPI] listening on ${b.url}`);
  console.log(`[LocalAPI] discovery file: ${path.join(b.dataDir, DISCOVERY_FILE)}`);
  console.log(`[LocalAPI] token file (0600): ${path.join(b.dataDir, TOKEN_FILE)}`);
  console.log(`[LocalAPI] data dir: ${b.dataDir}`);

  const shutdown = async () => {
    console.log('\n[LocalAPI] shutting down, closing browsers…');
    await b.browsers.closeAll().catch(() => {});
    b.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[LocalAPI] fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { main, buildBackend, startBackend, DATA_DIR };
