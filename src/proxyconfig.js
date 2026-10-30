'use strict';
function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }
function validateProxy(p) {
  if (!['http', 'https', 'socks5'].includes(p.type)) invalid('仅支持 HTTP、HTTPS 和 SOCKS5 代理');
  if (typeof p.host !== 'string' || !p.host || /[\s/@?#\\]/.test(p.host)) invalid('无效的代理主机');
  if (!Number.isInteger(Number(p.port)) || Number(p.port) < 1 || Number(p.port) > 65535) invalid('代理端口必须在 1–65535 之间');
  for (const k of ['username', 'password']) if (p[k] != null && (typeof p[k] !== 'string' || /[\r\n\0]/.test(p[k]))) invalid('无效的代理凭据');
  return p;
}
function inlineRecord(proxy) {
  let u;
  try { u = new URL(proxy.server); } catch { invalid('无效的代理地址'); }
  if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/') || Object.hasOwn(proxy, 'bypass')) invalid('代理认证请使用用户名/密码字段；不允许绕过规则');
  const type = u.protocol.slice(0, -1);
  return validateProxy({ type, host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port) || ({ http: 80, https: 443, socks5: 1080 })[type], username: proxy.username || '', password: proxy.password || '' });
}
function validateInlineProxy(proxy) { inlineRecord(proxy); }
function proxyURL(p, curl = false) {
  validateProxy(p);
  return `${curl && p.type === 'socks5' ? 'socks5h' : p.type}://${p.host.includes(':') ? `[${p.host}]` : p.host}:${p.port}`;
}
function resolveProxy(profile, proxyStore) {
  if (profile.proxyId) {
    const p = proxyStore?.getSecret(profile.proxyId);
    if (!p) throw Object.assign(new Error('绑定的代理不存在，请重新绑定后再打开；已阻止直连回退'), { status: 409 });
    validateProxy(p);
    return p;
  }
  return profile.proxy ? inlineRecord(profile.proxy) : null;
}
module.exports = { validateProxy, validateInlineProxy, inlineRecord, proxyURL, resolveProxy };
