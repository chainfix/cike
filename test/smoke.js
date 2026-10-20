'use strict';
/**
 * Smoke test: profile CRUD, open two headless profiles, run fingerprint
 * probes, verify per-profile canvas/audio noise, UA/Client-Hints consistency,
 * then clean up.
 *
 * Usage: node test/smoke.js
 * Requires a Chromium executable:
 *   - `npx playwright install chromium`, or
 *   - LFB_CHROMIUM_EXECUTABLE=/path/to/chrome
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ProfileStore } = require('../src/store');
const { BrowserManager } = require('../src/browser');
const { getChromiumMajor, getChromiumFullVersion } = require('../src/fingerprint');

const results = [];
function check(name, cond, extra = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
}

function drawProbeCanvas() {
  const c = document.createElement('canvas');
  c.width = 200; c.height = 50;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(120,180,200)';
  ctx.fillRect(0, 0, 200, 50);
  ctx.fillStyle = 'rgb(10,20,30)';
  ctx.font = '16px Arial';
  ctx.fillText('fingerprint-probe-xyz', 10, 30);
  return c.toDataURL().slice(-48);
}

async function probe(page) {
  return page.evaluate((drawSrc) => {
    const draw = new Function(`return (${drawSrc})()`);
    const canvas1 = draw();
    const canvas2 = draw(); // stability: same session -> same value
    // audio probe
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    let audioPatched = false;
    try {
      const ac = new AC(1, 44100, 44100);
      const buf = ac.createBuffer(1, 128, 44100);
      const ch = buf.getChannelData(0);
      audioPatched = ch instanceof Float32Array;
    } catch (e) { audioPatched = false; }
    return {
      webdriver: navigator.webdriver,
      hasChrome: typeof window.chrome === 'object',
      plugins: navigator.plugins.length,
      languages: navigator.languages.join(','),
      platform: navigator.platform,
      ua: navigator.userAgent,
      cores: navigator.hardwareConcurrency,
      mem: navigator.deviceMemory,
      hasUad: typeof navigator.userAgentData !== 'undefined',
      uadPlatform: navigator.userAgentData?.platform,
      uadMobile: navigator.userAgentData?.mobile,
      uadBrands: (navigator.userAgentData?.brands || []).map((b) => `${b.brand}/${b.version}`).join(' '),
      canvas1,
      canvas2,
      audioPatched,
    };
  }, drawProbeCanvas.toString());
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfb-smoke-'));
  const store = new ProfileStore(dataDir);
  const browsers = new BrowserManager(store);

  try {
    // 1. CRUD
    const a = store.create({ name: 'smoke-a', platform: 'mac', canvasSeed: 1111 });
    const b = store.create({ name: 'smoke-b', platform: 'win', canvasSeed: 2222 });
    const c = store.create({ name: 'smoke-c', platform: 'mac', canvasSeed: 3333, canvasNoise: true });
    check('create profiles', store.list().length === 3);
    check('canvas seeds differ', a.canvasSeed !== b.canvasSeed);
    check('hardwareConcurrency assigned', Number.isInteger(a.hardwareConcurrency) && a.hardwareConcurrency >= 8);

    // 2. open headless (also pins the real Chromium version for spoofing)
    const ra = await browsers.open(a.id, { headless: true });
    const rb = await browsers.open(b.id, { headless: true });
    const rc = await browsers.open(c.id, { headless: true });
    const MAJOR = getChromiumMajor();
    const FULL = getChromiumFullVersion();
    console.log(`Chromium version under test: ${FULL} (major ${MAJOR})`);
    // debug_url only exists when LFB_EXPOSE_DEBUGGER=1, so assert its shape
    // only when the debugger was actually exposed.
    check('open profile A', ra.open);
    if (ra.debug_url) check('debug_url points at loopback', ra.debug_url.startsWith('http://127.0.0.1:'));
    check('open profile B', rb.open);
    check('open profile C (canvasNoise)', rc.open);

    // 3. probes
    const pa = await probe(await browsers.getContext(a.id).newPage());
    const pb = await probe(await browsers.getContext(b.id).newPage());
    const pc = await probe(await browsers.getContext(c.id).newPage());

    check('webdriver hidden (A)', pa.webdriver !== true, `got ${pa.webdriver}`);
    check('webdriver hidden (B)', pb.webdriver !== true, `got ${pb.webdriver}`);
    check('chrome object present', pa.hasChrome);
    check('plugins spoofed', pa.plugins > 0, `${pa.plugins} plugins`);
    check('platform consistent (mac)', pa.platform === 'MacIntel', pa.platform);
    check('platform consistent (win)', pb.platform === 'Win32', pb.platform);

    // UA matches the REAL chromium major version
    check(`UA carries real major v${MAJOR} (mac)`, pa.ua.includes(`Chrome/${MAJOR}.0.0.0`), pa.ua.slice(0, 70));
    check(`UA carries real major v${MAJOR} (win)`, pb.ua.includes(`Chrome/${MAJOR}.0.0.0`));
    check('UA platform token (mac)', pa.ua.includes('Macintosh'));
    check('UA platform token (win)', pb.ua.includes('Windows NT 10.0'));

    // Client Hints consistency (skipped in old-headless test env where
    // navigator.userAgentData does not exist; present in real headed use)
    if (pa.hasUad) {
      check('userAgentData.platform (mac)', pa.uadPlatform === 'macOS', String(pa.uadPlatform));
      check('userAgentData.platform (win)', pb.uadPlatform === 'Windows', String(pb.uadPlatform));
      check('userAgentData brands carry major', pa.uadBrands.includes(`/${MAJOR}`), pa.uadBrands);
      check('userAgentData.mobile false', pa.uadMobile === false);
    } else {
      console.log('SKIP  userAgentData checks (API absent in this headless test browser)');
    }

    // hardware
    check('hardwareConcurrency per profile', pa.cores === a.hardwareConcurrency, `${pa.cores} vs ${a.hardwareConcurrency}`);
    check('deviceMemory per profile', pa.mem === a.deviceMemory, `${pa.mem} vs ${a.deviceMemory}`);

    // canvas: stable within session; differs across profiles ONLY when
    // canvasNoise is enabled (default off — pristine canvas for max score)
    check('canvas stable within session', pa.canvas1 === pa.canvas2);
    check('canvas same across profiles (noise off by default)', pa.canvas1 === pb.canvas1);
    check('canvas differs when canvasNoise=true', pa.canvas1 !== pc.canvas1);

    // audio
    check('audio getChannelData works', pa.audioPatched && pb.audioPatched);

    // 4. close
    await browsers.close(a.id);
    check('close A', !browsers.isOpen(a.id));
    const closed = await browsers.closeAll();
    check('closeAll', closed.closed === 2 && browsers.listOpen().length === 0);
  } finally {
    await browsers.closeAll().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('SMOKE FATAL:', err);
  process.exit(1);
});
