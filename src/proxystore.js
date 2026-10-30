'use strict';
/**
 * ProxyStore — JSON-backed store for saved proxies.
 * Types: http | https | socks5 | ssh  (mirrors the common antidetect set)
 * Everything stays local; no backend involved.
 */
const { privateDirectory, readJSON, writeJSON, credentials } = require('./privatefiles');
const { validateProxy, proxyURL } = require('./proxyconfig');
const path = require('path');
const crypto = require('crypto');

const TYPES = ['http', 'https', 'socks5'];

class ProxyStore {
  constructor(dataDir, secretStorage) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'proxies.json');
    privateDirectory(dataDir);
    this.codec = credentials(secretStorage);
    this.proxies = readJSON(this.file, {});
    for (const p of Object.values(this.proxies)) p.password = this.codec.decode(p.password);
    if (Object.keys(this.proxies).length) this._save();
  }

  _save() {
    const records = structuredClone(this.proxies);
    for (const p of Object.values(records)) p.password = this.codec.encode(p.password);
    writeJSON(this.file, records);
  }

  _newId() {
    return 'x_' + crypto.randomBytes(6).toString('hex');
  }

  /**
   * Parse one line of bulk input. Accepts:
   *   host:port
   *   host:port:user:pass
   *   http://user:pass@host:port   (also https://, socks5://)
   *   ...{remark}   (trailing {remark} becomes the remark)
   */
  static parseLine(line) {
    let remark = '';
    const m = line.match(/\{([^}]*)\}\s*$/);
    if (m) {
      remark = m[1].trim();
      line = line.slice(0, m.index).trim();
    }
    let type = 'http';
    const urlm = line.match(/^(https?|socks5):\/\/(.*)$/i);
    if (urlm) {
      type = urlm[1].toLowerCase();
      line = urlm[2];
    }
    // strip possible userinfo already handled? handle user:pass@host
    let auth = '';
    const at = line.lastIndexOf('@');
    if (at !== -1) {
      auth = line.slice(0, at);
      line = line.slice(at + 1);
    }
    const parts = line.split(':');
    if (parts.length < 2) throw new Error('无法解析代理行');
    const host = parts[0].trim();
    const port = Number(parts[1].trim());
    if (!host || !Number.isFinite(port)) throw new Error('无效的代理主机或端口');
    let username = '';
    let password = '';
    if (auth) {
      const i = auth.indexOf(':');
      username = decodeURIComponent(i === -1 ? auth : auth.slice(0, i));
      password = decodeURIComponent(i === -1 ? '' : auth.slice(i + 1));
    } else if (parts.length >= 4) {
      username = parts[2].trim();
      password = parts.slice(3).join(':').trim();
    }
    return { type, host, port, username, password, remark: remark || `${host}:${port}` };
  }

  add(spec) {
    validateProxy(spec);
    const id = this._newId();
    const now = new Date().toISOString();
    const rec = {
      id,
      type: spec.type,
      host: spec.host,
      port: Number(spec.port),
      username: spec.username || '',
      password: '',
      remark: spec.remark || `${spec.host}:${spec.port}`,
      status: 'unchecked',
      checkedAt: null,
      exitIp: null,
      country: null,
      createdAt: now,
      updatedAt: now,
    };
    // The codec encrypts the on-disk password when desktop safeStorage is available.
    rec.password = spec.password || '';
    this.proxies[id] = rec;
    try { this._save(); } catch (error) { delete this.proxies[id]; throw error; }
    return this._public(rec);
  }

  bulkAdd(text, type = 'http') {
    const added = [];
    const errors = [];
    for (const [index, raw] of String(text).split('\n').entries()) {
      const line = raw.trim();
      if (!line) continue;
      try {
        const p = ProxyStore.parseLine(line);
        if (!p.remark || p.remark === `${p.host}:${p.port}`) {
          // keep parsed remark
        }
        added.push(this.add({ ...p, type: p.type === 'http' ? type : p.type }));
      } catch (e) {
        errors.push({ line: index + 1, error: e.message });
      }
    }
    return { added, errors };
  }

  list() {
    return Object.values(this.proxies).map((p) => this._public(p));
  }

  get(id) {
    return Object.hasOwn(this.proxies, id) ? this._public(this.proxies[id]) : null;
  }

  /** Internal: with password (for launching browsers). */
  getSecret(id) {
    return Object.hasOwn(this.proxies, id) ? structuredClone(this.proxies[id]) : null;
  }

  update(id, patch = {}) {
    const p = this.getSecret(id);
    if (!p) return null;
    const safe = Object.fromEntries(['type', 'host', 'port', 'username', 'password', 'remark'].filter(k => Object.hasOwn(patch, k)).map(k => [k, patch[k]]));
    const next = { ...p, ...safe, updatedAt: new Date().toISOString(), status: 'unchecked', checkedAt: null, exitIp: null, country: null, countryCode: null, timezone: null };
    validateProxy(next);
    next.port = Number(next.port);
    this.proxies[id] = next;
    try { this._save(); } catch (error) { this.proxies[id] = p; throw error; }
    return this._public(next);
  }

  setCheckResult(id, result) {
    const p = this.proxies[id];
    if (!p) return;
    Object.assign(p, result, { checkedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    this._save();
  }

  remove(id) {
    if (!this.proxies[id]) return false;
    delete this.proxies[id];
    this._save();
    return true;
  }

  _public(p) {
    const { password, ...rest } = p;
    return { ...rest, hasAuth: !!password };
  }

  /** Playwright-compatible proxy option from a stored proxy. */
  static toPlaywright(p) {
    if (!p) return null;
    const server = proxyURL(p);
    const opt = { server };
    if (p.username) opt.username = p.username;
    if (p.password) opt.password = p.password;
    return opt;
  }

  /** Credentials must be supplied separately, never in process arguments. */
  static toCurlArg(p) { return proxyURL(p, true); }
}

module.exports = { ProxyStore, TYPES };
