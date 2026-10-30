'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { HOST_PLATFORM, validateProfile } = require('./fingerprint');
const { privateDirectory, readJSON, writeJSON, credentials } = require('./privatefiles');
const { validateInlineProxy } = require('./proxyconfig');

const DEFAULT_SPEC = {
  name: 'profile', group: '', fingerprintMode: 'native', platform: HOST_PLATFORM,
  userAgent: null, proxyId: null, proxy: null,
  viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2,
  locale: 'auto', timezone: 'auto', canvasSeed: null, canvasNoise: false,
  hardwareConcurrency: null, deviceMemory: null, webrtc: 'auto', colorScheme: 'light',
};
const pick = value => Object.fromEntries(Object.keys(DEFAULT_SPEC).filter(k => Object.hasOwn(value, k)).map(k => [k, value[k]]));
class ProfileStore {
  constructor(dataDir, secretStorage) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'profiles.json');
    this.codec = credentials(secretStorage);
    privateDirectory(dataDir);
    privateDirectory(path.join(dataDir, 'profiles'));
    this.profiles = readJSON(this.file, {});
    for (const [id, p] of Object.entries(this.profiles)) {
      this.profileDir(id); // Reject traversal in existing records as well.
      if (p.id !== id) throw new Error('环境记录 ID 不一致');
      if (p.proxy) p.proxy.password = this.codec.decode(p.proxy.password);
      p.fingerprintMode ||= 'legacy';
    }
    this.sequenceFile = path.join(dataDir, 'profile-sequence.json');
    const saved = readJSON(this.sequenceFile, { last: 0 }).last || 0;
    this.sequence = Math.max(saved, this.list().length, ...this.list().map(p => Number(p.sequence) || (/^\d+$/.test(p.name) ? Number(p.name) : 0)));
    if (fs.existsSync(this.file)) this._save(); // Migrate permissions/encryption, not fingerprints.
  }
  _save() {
    const records = structuredClone(this.profiles);
    for (const p of Object.values(records)) if (p.proxy) p.proxy.password = this.codec.encode(p.proxy.password);
    writeJSON(this.file, records);
  }
  create(spec = {}) {
    const id = 'p_' + crypto.randomBytes(6).toString('hex');
    const now = new Date().toISOString();
    const sequence = this.sequence + 1;
    const record = { ...structuredClone(DEFAULT_SPEC), ...pick(spec), id,
      name: String(spec.name || '').trim() || String(sequence), sequence,
      viewport: { ...DEFAULT_SPEC.viewport, ...spec.viewport }, createdAt: now, updatedAt: now };
    validateProfile(record);
    if (record.proxy) validateInlineProxy(record.proxy);
    this.sequence = sequence;
    writeJSON(this.sequenceFile, { last: sequence });
    this.profiles[id] = record;
    try { this._save(); } catch (error) { delete this.profiles[id]; throw error; }
    return structuredClone(record);
  }
  list() { return Object.values(this.profiles).map(p => structuredClone(p)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.sequence || 0) - (b.sequence || 0)); }
  get(id) { return Object.hasOwn(this.profiles, id) ? structuredClone(this.profiles[id]) : null; }
  update(id, patch = {}) {
    const old = this.get(id);
    if (!old) return null;
    let next = { ...old, ...pick(patch), updatedAt: new Date().toISOString() };
    if (old.fingerprintMode === 'legacy' && patch.fingerprintMode === 'native') {
      // Keep non-secret former fingerprint settings for reference. Never put
      // proxy credentials into a second unencrypted copy.
      const keys = ['platform', 'userAgent', 'canvasSeed', 'canvasNoise', 'hardwareConcurrency', 'deviceMemory', 'webrtc'];
      next.previousFingerprint = Object.fromEntries(keys.map(k => [k, old[k] ?? null]));
      Object.assign(next, { platform: HOST_PLATFORM, userAgent: null, canvasNoise: false, canvasSeed: null,
        hardwareConcurrency: null, deviceMemory: null, webrtc: patch.webrtc || (old.webrtc === 'disabled' ? 'restricted' : old.webrtc || 'auto') });
    }
    if (old.fingerprintMode === 'native' || next.fingerprintMode !== 'legacy') validateProfile(next);
    if (next.proxy) {
      next.proxy = { ...next.proxy };
      if (patch.proxy && !Object.hasOwn(patch.proxy, 'password') && old.proxy?.server === next.proxy.server && (old.proxy?.username || '') === (next.proxy.username || '')) next.proxy.password = old.proxy.password;
      validateInlineProxy(next.proxy);
    }
    this.profiles[id] = next;
    try { this._save(); } catch (error) { this.profiles[id] = old; throw error; }
    return structuredClone(next);
  }
  remove(id) {
    const rec = this.get(id);
    if (!rec) return false;
    delete this.profiles[id];
    try { this._save(); } catch (error) { this.profiles[id] = rec; throw error; }
    fs.rmSync(this.profileDir(id), { recursive: true, force: true });
    return true;
  }
  profileDir(id) {
    if (typeof id !== 'string' || !/^p_[a-f0-9]{12}$/.test(id)) throw new Error('无效的环境 ID');
    return path.join(this.dataDir, 'profiles', id);
  }
  public(record) {
    const p = structuredClone(record);
    if (p?.proxy) { p.proxy.hasAuth = !!p.proxy.password; delete p.proxy.password; }
    return p;
  }
}
module.exports = { ProfileStore, DEFAULT_SPEC };
