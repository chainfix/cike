'use strict';
const { validateProxy } = require('./proxyconfig');
function parseProxyLine(input) {
  let line = String(input || '').trim(), remark = '';
  if (!line || /[\r\n]/.test(line) || line.length > 8192) throw new Error('请粘贴一条完整代理');
  const note = line.match(/\s*\{([^{}]*)\}\s*$/);
  if (note) { remark = note[1].trim(); line = line.slice(0, note.index).trim(); }
  let type = 'http', host, port, username = '', password = '';
  const scheme = line.match(/^(https?|socks5):\/\//i);
  if (scheme) { type = scheme[1].toLowerCase(); line = line.slice(scheme[0].length); }
  const at = line.lastIndexOf('@');
  if (at >= 0) {
    const auth = line.slice(0, at), split = auth.indexOf(':');
    try { username = decodeURIComponent(split < 0 ? auth : auth.slice(0, split)); password = split < 0 ? '' : decodeURIComponent(auth.slice(split + 1)); }
    catch { throw new Error('代理认证编码无效'); }
    line = line.slice(at + 1);
  }
  const match = /^(\[[0-9a-fA-F:]+\]|[^:/\s]+):(\d+)(?::([^:]*):(.*))?$/.exec(line);
  if (!match || (at >= 0 && match[3] !== undefined)) throw new Error('代理格式应为 host:port、host:port:用户:密码 或 socks5://用户:密码@host:port');
  host = match[1].replace(/^\[|\]$/g, ''); port = Number(match[2]);
  if (match[3] !== undefined) { username = match[3]; password = match[4]; }
  return validateProxy({ type, host, port, username, password, remark: remark || `${host}:${port}` });
}
module.exports = { parseProxyLine };
