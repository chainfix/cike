'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('数据目录不能是符号链接');
  fs.chmodSync(directory, 0o700);
}
function readJSON(file, fallback) {
  try {
    if (!fs.lstatSync(file).isFile()) throw new Error(`不是普通数据文件：${path.basename(file)}`);
    fs.chmodSync(file, 0o600);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`无法读取 ${path.basename(file)}，请检查文件或恢复备份：${error.message}`);
  }
}
function writePrivate(file, contents) {
  privateDirectory(path.dirname(file));
  const temporary = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, contents); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}
function writeJSON(file, value) { writePrivate(file, JSON.stringify(value, null, 2)); }

// Electron supplies safeStorage on desktop. CLI never silently decrypts or
// downgrades an encrypted file; without that provider it can only use 0600 files.
function credentials(provider) {
  return {
    protection: provider ? 'keychain' : 'private-file',
    encode(value) {
      if (!value) return '';
      if (typeof value !== 'string') throw new Error('密码格式无效');
      return provider ? { format: 'safe-storage-v1', data: provider.encrypt(value) } : value;
    },
    decode(value) {
      if (!value) return '';
      if (typeof value === 'string') return value;
      if (value.format !== 'safe-storage-v1' || typeof value.data !== 'string') throw new Error('凭据格式无效');
      if (!provider) throw new Error('此数据包含钥匙串保护的凭据，请使用 CIKE 桌面版打开');
      return provider.decrypt(value.data);
    },
  };
}
module.exports = { privateDirectory, readJSON, writePrivate, writeJSON, credentials };
