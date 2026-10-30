'use strict';
// Native Chromium owns UA, Client Hints, platform, GPU, CPU, memory, Canvas
// and Audio in every realm. Do not patch only Window and contradict Workers.
const HOST_PLATFORM = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform] || 'linux';
function bad(message) { throw Object.assign(new Error(message), { status: 400 }); }
function validateProfile(profile) {
  if (profile.fingerprintMode !== 'native') bad('旧环境需要先转换为原生一致模式；Cookie 和站点数据会保留');
  if (profile.platform !== HOST_PLATFORM || profile.userAgent || profile.canvasNoise || profile.hardwareConcurrency != null || profile.deviceMemory != null) {
    bad('原生一致模式使用本机平台、UA、CPU、内存与 Canvas；不支持页面级伪装');
  }
  if (!['auto', 'default', 'restricted'].includes(profile.webrtc)) bad('WebRTC 请选择自动、默认或限制直连 UDP');
  if (profile.timezone !== 'auto') {
    try { new Intl.DateTimeFormat('en', { timeZone: profile.timezone }).format(); } catch { bad('无效的 IANA 时区'); }
  }
  if (profile.locale !== 'auto') {
    try { if (!Intl.getCanonicalLocales(profile.locale).length) bad('语言不能为空'); } catch { bad('无效的语言代码'); }
  }
  const { width, height } = profile.viewport || {};
  if (![width, height].every(n => Number.isInteger(n) && n >= 320 && n <= 7680)) bad('窗口尺寸必须在 320–7680 之间');
  if (!(profile.deviceScaleFactor >= 0.5 && profile.deviceScaleFactor <= 4)) bad('无效的缩放比例');
  if (!['light', 'dark', 'no-preference'].includes(profile.colorScheme)) bad('无效的外观设置');
}
function buildContextOptions(profile) {
  validateProfile(profile);
  const options = {
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    colorScheme: profile.colorScheme,
    acceptDownloads: true,
    ignoreHTTPSErrors: false,
    bypassCSP: false,
  };
  if (profile.locale !== 'auto') options.locale = profile.locale;
  if (profile.timezone !== 'auto') options.timezoneId = profile.timezone;
  if (profile.proxy) options.proxy = profile.proxy;
  return { options };
}
function webrtcArgs(profile) {
  // Proxy profiles always restrict UDP, even if a stale record says default.
  // This is Chromium's native IP handling policy, not a fake PeerConnection.
  return profile.proxy || profile.webrtc === 'restricted' ? [
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--disable-quic',
  ] : [];
}
module.exports = { HOST_PLATFORM, validateProfile, buildContextOptions, webrtcArgs };
