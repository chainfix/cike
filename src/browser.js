'use strict';
/**
 * BrowserManager — open/close persistent Chromium contexts, one per profile.
 * Each profile gets its own user-data-dir (cookies, storage, cache persist
 * across restarts) and a remote-debugging port so external tools can attach
 * via CDP, the same way automation frameworks drive a "profile".
 */
const net = require('net');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// We set userAgent/locale/platform per profile through Playwright's native
// context options (which also fix HTTP headers), so the stealth plugin's
// global user-agent-override evasion — which would stomp every profile with
// one hardcoded UA — is disabled. Our own init scripts keep
// navigator.platform consistent instead.
const stealth = StealthPlugin();
stealth.enabledEvasions.delete('user-agent-override');
// hardwareConcurrency is set per profile by our own init script
// (stealth pins it to 4 for every profile, which is linkable).
stealth.enabledEvasions.delete('navigator.hardwareConcurrency');
// navigator.languages is set consistently by Playwright's `locale` option
// (navigator.language + navigator.languages + Accept-Language header all
// agree). Stealth's override forces ['en-US','en'], which mismatches the
// Accept-Language header and trips consistency checks.
stealth.enabledEvasions.delete('navigator.languages');
// TEST-ONLY: LFB_NO_STEALTH=1 disables the stealth plugin entirely (bisection).
if (process.env.LFB_NO_STEALTH !== '1') {
  chromium.use(stealth);
}

const { buildContextOptions, webrtcArgs, setRealVersion } = require('./fingerprint');

/**
 * Detect the REAL Chromium version once (via a throwaway headless launch),
 * so the spoofed UA/Client-Hints always match the actual binary — never a
 * stale browsers.json. Cached for the process lifetime.
 */
let _versionPromise = null;
function ensureRealVersion() {
  if (!_versionPromise) {
    _versionPromise = (async () => {
      const opts = { headless: true, args: ['--no-sandbox', '--disable-gpu'] };
      if (process.env.LFB_CHROMIUM_EXECUTABLE) {
        opts.executablePath = process.env.LFB_CHROMIUM_EXECUTABLE;
      }
      const b = await chromium.launch(opts);
      const v = b.version();
      await b.close().catch(() => {});
      return v;
    })().catch(() => null);
  }
  return _versionPromise;
}

const DEBUG_PORT_MIN = 4550;
const DEBUG_PORT_MAX = 4599;

function findFreePort(min, max) {
  return new Promise((resolve, reject) => {
    let port = min;
    const tryNext = () => {
      if (port > max) return reject(new Error('no free debug port'));
      const s = net.createServer();
      s.once('error', () => { port += 1; tryNext(); });
      s.once('listening', () => s.close(() => resolve(port)));
      s.listen(port, '127.0.0.1');
    };
    tryNext();
  });
}

class BrowserManager {
  constructor(store, proxyStore = null, settings = null, options = {}) {
    this.store = store;
    this.downloadsDirectory = options.downloadsDirectory;
    this.proxyStore = proxyStore;
    this.settings = settings;
    this.sessions = new Map(); // profileId -> { context, debugPort, headless, openedAt }
  }

  isOpen(profileId) {
    return this.sessions.has(profileId);
  }

  listOpen() {
    return [...this.sessions.entries()].map(([profileId, s]) => ({
      profile_id: profileId,
      ...(s.debugPort ? { debug_url: `http://127.0.0.1:${s.debugPort}` } : {}),
      headless: s.headless,
      opened_at: new Date(s.openedAt).toISOString(),
    }));
  }

  async open(profileId, { headless = false, proxyOverride = null } = {}) {
    if (this.sessions.has(profileId)) {
      const s = this.sessions.get(profileId);
      return {
        profile_id: profileId,
        open: true,
        reused: true,
        ...(s.debugPort ? { debug_url: `http://127.0.0.1:${s.debugPort}` } : {}),
      };
    }
    const profile = this.store.get(profileId);
    if (!profile) {
      throw Object.assign(new Error(`profile not found: ${profileId}`), { status: 404 });
    }
    const exposeDebugger = process.env.LFB_EXPOSE_DEBUGGER === '1';
    const debugPort = exposeDebugger ? await findFreePort(DEBUG_PORT_MIN, DEBUG_PORT_MAX) : null;
    // Pin the spoofed version story to the real binary before building options.
    const realVer = await ensureRealVersion();
    if (realVer) setRealVersion(realVer);
    // Timezone/locale 'auto' follows the IP region:
    // - With proxy: use the proxy's timezone/country (from proxy check).
    // - Without proxy: detect the local IP's region.
    // This avoids the -10% "timezone mismatch" penalty on fingerprint checks.
    let effectiveProfile = profile;
    const needTz = profile.timezone === 'auto';
    const needLoc = profile.locale === 'auto';
    if ((needTz || needLoc) && profile.proxyId && this.proxyStore) {
      const proxyInfo = this.proxyStore.get(profile.proxyId);
      if (needTz && proxyInfo?.timezone) {
        effectiveProfile = { ...effectiveProfile, timezone: proxyInfo.timezone };
      }
      if (needLoc && proxyInfo?.countryCode) {
        const { localeForCountry } = require('./localemap');
        const loc = localeForCountry(proxyInfo.countryCode);
        if (loc) effectiveProfile = { ...effectiveProfile, locale: loc };
      }
    }
    // No proxy (or proxy has no geo data): fall back to local IP geolocation
    if ((effectiveProfile.timezone === 'auto' || effectiveProfile.locale === 'auto')) {
      try {
        const { detectLocalGeo } = require('./localgeo');
        const geo = await detectLocalGeo();
        if (effectiveProfile.timezone === 'auto' && geo.timezone) {
          effectiveProfile = { ...effectiveProfile, timezone: geo.timezone };
        }
        if (effectiveProfile.locale === 'auto' && geo.countryCode) {
          const { localeForCountry } = require('./localemap');
          const loc = localeForCountry(geo.countryCode);
          if (loc) effectiveProfile = { ...effectiveProfile, locale: loc };
        }
      } catch { /* keep defaults */ }
    }
    // Final fallback if geo detection failed
    if (effectiveProfile.timezone === 'auto') effectiveProfile = { ...effectiveProfile, timezone: 'America/New_York' };
    if (effectiveProfile.locale === 'auto') effectiveProfile = { ...effectiveProfile, locale: 'en-US' };
    // Saved-proxy (proxyId) resolution happens in server.js and arrives as
    // proxyOverride; fall back to the inline proxy for direct callers.
    let proxyForLaunch = null;
    if (proxyOverride) {
      proxyForLaunch = proxyOverride;
    } else if (profile.proxyId && this.proxyStore) {
      const p = this.proxyStore.getSecret(profile.proxyId);
      if (p) {
        const { ProxyStore } = require('./proxystore');
        proxyForLaunch = ProxyStore.toPlaywright(p);
      }
    }
    // Chromium cannot authenticate SOCKS5 itself. The local forwarder also
    // inserts the operating-system proxy when that setting is enabled.
    let socksFwd = null;
    let needsWebrtcBlock = (effectiveProfile.webrtc === 'disabled');
    const useSystemProxy = this.settings?.get().socksViaSystemProxy === true;
    const isSocks = proxyForLaunch?.server?.startsWith('socks5://');
    if (isSocks && (proxyForLaunch.username || proxyForLaunch.password || useSystemProxy)) {
      const { SocksForwarder } = require('./socksfwd');
      const u = isSocks ? new URL(proxyForLaunch.server) : null;
      const host = u?.hostname;
      const port = u ? (parseInt(u.port, 10) || 1080) : null;
      const systemProxy = useSystemProxy ? await this.settings.route(host, port) : null;
      if (systemProxy && host === systemProxy.host && port === systemProxy.port) {
        proxyForLaunch = { server: `${systemProxy.scheme}://${systemProxy.host}:${systemProxy.port}` };
      } else if (u || systemProxy) {
        socksFwd = await SocksForwarder.start({
          host,
          port,
          username: proxyForLaunch?.username,
          password: proxyForLaunch?.password,
          systemProxy,
        });
        proxyForLaunch = { server: `http://127.0.0.1:${socksFwd.port}` };
      }
    }
    if (socksFwd) {
      // The forwarder is TCP-only; WebRTC's UDP would bypass it and leak the
      // real IP via STUN. Block WebRTC entirely in this case.
      needsWebrtcBlock = true;
    }
    const { options, scripts, extraHeaders } = buildContextOptions({
      ...effectiveProfile,
      proxy: proxyForLaunch || effectiveProfile.proxy,
    });
    // Override with the resolved proxy (incl. forwarder if used)
    if (proxyForLaunch) options.proxy = proxyForLaunch;
    // WebRTC leak prevention
    if (needsWebrtcBlock) {
      const { webrtcBlockScript } = require('./webrtcblock');
      scripts.push(webrtcBlockScript());
    }
    // WebGL vendor/renderer: in headed mode the REAL GPU values are the most
    // authentic signal available, so don't spoof them. Only spoof in headless
    // mode, where the real values would scream "SwiftShader".
    if (headless) {
      stealth.enabledEvasions.add('webgl.vendor');
    } else {
      stealth.enabledEvasions.delete('webgl.vendor');
    }
    const launchOptions = {
      ...options,
      headless,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        ...(debugPort ? [`--remote-debugging-port=${debugPort}`] : []),
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-blink-features=AutomationControlled',
        ...webrtcArgs({ ...profile, proxy: options.proxy || profile.proxy }),
        // Escape hatch for sandbox/proxy environments, e.g.
        // LFB_EXTRA_ARGS='--no-proxy-server'
        ...(process.env.LFB_EXTRA_ARGS ? process.env.LFB_EXTRA_ARGS.split(' ').filter(Boolean) : []),
      ],
    };
    // Optional override for environments where the Playwright-bundled
    // Chromium cannot be downloaded (e.g. restricted egress):
    //   LFB_CHROMIUM_EXECUTABLE=/path/to/chrome
    if (process.env.LFB_CHROMIUM_EXECUTABLE) {
      launchOptions.executablePath = process.env.LFB_CHROMIUM_EXECUTABLE;
    }
    // macOS per-profile .app bundles are temporarily disabled (v0.5.9+).
    // They caused launch failures ("shows as open but window doesn't appear").
    // TODO: re-enable with a more robust implementation.
    // The Dock will show the default Chromium icon until then.
    // Launch the browser (direct executable; per-profile .app disabled).
    const profileDirectory = this.store.profileDir(profileId);
    const { prepareDownloads, configureDownloads } = require('./downloads');
    let context;
    try {
      await prepareDownloads(profileDirectory, this.downloadsDirectory);
      context = await chromium.launchPersistentContext(profileDirectory, launchOptions);
      await configureDownloads(context);
    } catch (error) {
      if (context) await context.close().catch(() => {});
      if (socksFwd) await socksFwd.stop().catch(() => {});
      throw error;
    }
    for (const script of scripts) {
      await context.addInitScript(script);
    }
    // Client-Hints request headers consistent with the spoofed UA.
    if (extraHeaders) {
      await context.setExtraHTTPHeaders(extraHeaders);
    }
    const session = { context, debugPort, headless, openedAt: Date.now(), socksFwd };
    this.sessions.set(profileId, session);
    context.on('close', async () => {
      this.sessions.delete(profileId);
      if (socksFwd) { try { await socksFwd.stop(); } catch { /* ignore */ } }
    });
    return {
      profile_id: profileId,
      open: true,
      reused: false,
      ...(debugPort ? { debug_url: `http://127.0.0.1:${debugPort}` } : {}),
      headless,
    };
  }

  async close(profileId) {
    const s = this.sessions.get(profileId);
    if (!s) return { profile_id: profileId, open: false };
    await s.context.close().catch(() => {});
    if (s.socksFwd) { try { await s.socksFwd.stop(); } catch { /* ignore */ } }
    this.sessions.delete(profileId);
    return { profile_id: profileId, open: false };
  }

  async closeAll() {
    const ids = [...this.sessions.keys()];
    for (const id of ids) await this.close(id);
    return { closed: ids.length };
  }

  /** For tests / probes: get the raw context of an open profile. */
  getContext(profileId) {
    return this.sessions.get(profileId)?.context || null;
  }
}

module.exports = { BrowserManager };
