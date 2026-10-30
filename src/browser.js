'use strict';
const net = require('net');
const { chromium } = require('playwright');
const { buildContextOptions, webrtcArgs, validateProfile } = require('./fingerprint');
const { resolveProxy, inlineRecord } = require('./proxyconfig');
const { ProxyStore } = require('./proxystore');
const { checkProxy } = require('./proxycheck');
const { privateDirectory } = require('./privatefiles');
const { prepareDownloads, configureDownloads } = require('./downloads');

function findFreePort(min, max) {
  return new Promise((resolve, reject) => {
    let port = min;
    const next = () => {
      if (port > max) return reject(new Error('no free debug port'));
      const s = net.createServer();
      s.once('error', () => { port++; next(); });
      s.listen(port, '127.0.0.1', () => s.close(() => resolve(port)));
    };
    next();
  });
}
class BrowserManager {
  constructor(store, proxyStore = null, settings = null, options = {}) {
    this.store = store;
    this.proxyStore = proxyStore;
    this.settings = settings;
    this.downloadsDirectory = options.downloadsDirectory;
    this.checkProxy = options.checkProxy || checkProxy;
    this.sessions = new Map();
    this.opening = new Map();
  }
  isOpen(id) { return this.sessions.has(id) || this.opening.has(id); }
  listOpen() {
    return [...this.sessions].map(([id, s]) => ({ profile_id: id,
      ...(s.debugPort ? { debug_url: `http://127.0.0.1:${s.debugPort}` } : {}),
      headless: s.headless, opened_at: new Date(s.openedAt).toISOString(), network: s.network }));
  }
  async open(id, options = {}) {
    if (this.opening.has(id)) return this.opening.get(id);
    const pending = this._open(id, options);
    this.opening.set(id, pending);
    try { return await pending; } finally { this.opening.delete(id); }
  }
  async _open(id, { headless = false } = {}) {
    if (typeof headless !== 'boolean') throw Object.assign(new Error('headless 必须为布尔值'), { status: 400 });
    if (this.sessions.has(id)) return { profile_id: id, open: true, reused: true, ...this.listOpen().find(s => s.profile_id === id) };
    const profile = this.store.get(id);
    if (!profile) throw Object.assign(new Error('环境不存在'), { status: 404 });
    validateProfile(profile);
    let proxyRecord = resolveProxy(profile, this.proxyStore);
    const useSystemProxy = this.settings?.get().socksViaSystemProxy === true;
    if (!proxyRecord && useSystemProxy) {
      const route = await this.settings.route();
      proxyRecord = inlineRecord({ server: `${route.scheme}://${route.host.includes(':') ? `[${route.host}]` : route.host}:${route.port}` });
    }
    const effective = { ...profile };
    let network = { route: proxyRecord ? 'proxy' : 'system', exitIp: null };
    if (proxyRecord) {
      const result = await this.checkProxy(proxyRecord, this.settings);
      // The check awaited external I/O: refuse stale/deleted/rebound settings.
      const current = this.store.get(id);
      if (!current || current.updatedAt !== profile.updatedAt ||
          ((profile.proxyId || profile.proxy) && JSON.stringify(resolveProxy(current, this.proxyStore)) !== JSON.stringify(proxyRecord))) {
        throw Object.assign(new Error('环境或代理在检测期间发生变化，请重试'), { status: 409 });
      }
      if (profile.proxyId) this.proxyStore.setCheckResult(profile.proxyId, result);
      if (result.status !== 'ok') throw Object.assign(new Error(result.error || '代理连接失败，已阻止启动'), { status: 502 });
      if (profile.timezone === 'auto') {
        if (!result.timezone) throw Object.assign(new Error('代理出口时区未知，请重新检测或手动选择时区；不会回退到本机时区'), { status: 409 });
        effective.timezone = result.timezone;
      }
      if (profile.locale === 'auto') {
        const { localeForCountry } = require('./localemap');
        if (!result.countryCode) throw Object.assign(new Error('代理出口地区未知，请重新检测或手动选择语言'), { status: 409 });
        effective.locale = localeForCountry(result.countryCode);
        if (!effective.locale) throw Object.assign(new Error('没有此代理地区的语言映射，请手动选择语言'), { status: 409 });
      }
      network = { route: 'proxy', exitIp: result.exitIp, timezone: effective.timezone, locale: effective.locale };
    }
    // With no configured proxy, auto means native system locale/timezone;
    // no geolocation request, and no invented America/New_York fallback.
    let proxy = proxyRecord ? ProxyStore.toPlaywright(proxyRecord) : null;
    let forwarder, context;
    try {
      if (proxyRecord?.type === 'socks5' && (proxyRecord.username || proxyRecord.password || useSystemProxy)) {
        const { SocksForwarder } = require('./socksfwd');
        const systemProxy = useSystemProxy ? await this.settings.route(proxyRecord.host, proxyRecord.port) : null;
        forwarder = await SocksForwarder.start({ ...proxyRecord, systemProxy });
        proxy = { server: `http://127.0.0.1:${forwarder.port}`, bypass: '<-loopback>' };
      } else if (proxy) proxy.bypass = '<-loopback>';
      const { options } = buildContextOptions({ ...effective, proxy });
      const debugPort = process.env.LFB_EXPOSE_DEBUGGER === '1' ? await findFreePort(4550, 4599) : null;
      const launchOptions = { ...options, headless, chromiumSandbox: true,
        ignoreDefaultArgs: ['--enable-automation'],
        args: ['--no-first-run', '--no-default-browser-check', '--site-per-process',
          '--disable-blink-features=AutomationControlled',
          ...(effective.locale !== 'auto' ? [`--lang=${effective.locale}`, `--accept-lang=${effective.locale}`] : []),
          ...(debugPort ? [`--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1'] : []),
          ...webrtcArgs({ ...effective, proxy: proxy || useSystemProxy || profile.webrtc === 'auto' }),
        ],
      };
      // Deliberately no arbitrary LFB_EXTRA_ARGS: they could disable sandbox,
      // alter proxy routing or invalidate the native consistency contract.
      if (process.env.LFB_CHROMIUM_EXECUTABLE) launchOptions.executablePath = process.env.LFB_CHROMIUM_EXECUTABLE;
      const directory = this.store.profileDir(id);
      privateDirectory(directory);
      await prepareDownloads(directory, this.downloadsDirectory);
      context = await chromium.launchPersistentContext(directory, launchOptions);
      await configureDownloads(context);
      this.sessions.set(id, { context, debugPort, headless, openedAt: Date.now(), forwarder, network });
      context.on('close', () => { this.sessions.delete(id); forwarder?.stop().catch(() => {}); });
      return { profile_id: id, open: true, reused: false, headless, network,
        ...(debugPort ? { debug_url: `http://127.0.0.1:${debugPort}` } : {}) };
    } catch (error) {
      await context?.close().catch(() => {});
      await forwarder?.stop().catch(() => {});
      // Playwright launch errors include argv, but proxy credentials are not
      // in argv. Do not retry by disabling sandbox or removing the proxy.
      throw error;
    }
  }
  async close(id) {
    await this.opening.get(id)?.catch(() => {});
    const session = this.sessions.get(id);
    if (session) {
      await session.context.close();
      await session.forwarder?.stop();
      this.sessions.delete(id);
    }
    return { profile_id: id, open: false };
  }
  async closeAll() {
    const ids = [...new Set([...this.opening.keys(), ...this.sessions.keys()])];
    await Promise.all(ids.map(id => this.close(id)));
    return { closed: ids.length };
  }
  getContext(id) { return this.sessions.get(id)?.context || null; }
}
module.exports = { BrowserManager };
