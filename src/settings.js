'use strict';
const { privateDirectory, readJSON, writeJSON } = require('./privatefiles');
const path = require('path');
const { parseSystemProxy } = require('./proxyroute');
class Settings {
  constructor(dir, resolveSystemProxy) {
    this.file = path.join(dir, 'settings.json');
    this.resolveSystemProxy = resolveSystemProxy;
    this.value = { socksViaSystemProxy: false };
    privateDirectory(dir);
    this.value.socksViaSystemProxy = readJSON(this.file, {}).socksViaSystemProxy === true;
  }
  get() { return { ...this.value }; }
  set(value) {
    if (typeof value.socksViaSystemProxy !== 'boolean') throw new Error('请选择是否通过系统代理');
    const next = { socksViaSystemProxy: value.socksViaSystemProxy };
    writeJSON(this.file, next);
    this.value = next;
    return this.get();
  }
  async route(host, port) {
    if (!this.value.socksViaSystemProxy) return null;
    if (!this.resolveSystemProxy) throw new Error('系统代理功能需要使用 CIKE 桌面客户端');
    const target = host ? `https://${host.includes(':') ? `[${host}]` : host}:${port}/` : 'https://example.com/';
    return parseSystemProxy(await this.resolveSystemProxy(target));
  }
}
module.exports = { Settings };
