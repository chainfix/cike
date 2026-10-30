'use strict';
const http = require('http');
const https = require('https');
const net = require('net');

function parseSystemProxy(value) {
  const first = String(value).split(';')[0].trim();
  const match = /^(PROXY|HTTP|HTTPS|SOCKS|SOCKS5)\s+(\S+)$/i.exec(first);
  if (!match) throw new Error('系统代理对此 SOCKS5 地址返回直连或不支持的代理，请检查系统代理规则');
  const scheme = /SOCKS/i.test(match[1]) ? 'socks5' : match[1].toUpperCase() === 'HTTPS' ? 'https' : 'http';
  const parsed = new URL(`${scheme}://${match[2]}`);
  return {
    scheme,
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port: Number(parsed.port) || (scheme === 'https' ? 443 : scheme === 'http' ? 80 : 1080),
  };
}

function connect(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('连接代理超时'));
    }, 15000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function buffered(socket) {
  const queue = [];
  const read = count => new Promise((resolve, reject) => {
    const take = () => {
      const available = queue.reduce((sum, chunk) => sum + chunk.length, 0);
      if (available < count) return false;
      cleanup();
      const all = Buffer.concat(queue);
      queue.length = 0;
      if (all.length > count) queue.push(all.subarray(count));
      resolve(all.subarray(0, count));
      return true;
    };
    socket.pause();
    const onData = chunk => { socket.pause(); queue.push(chunk); if (!take()) socket.resume(); };
    const onError = error => { cleanup(); reject(error); };
    const onClose = () => onError(new Error('代理连接已关闭'));
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
    if (!take()) socket.resume();
  });
  return {
    read,
    release() {
      const rest = Buffer.concat(queue);
      queue.length = 0;
      if (rest.length) socket.unshift(rest);
      socket.pause();
    },
  };
}

async function socks(socket, proxy, destination) {
  const io = buffered(socket);
  const timer = setTimeout(() => socket.destroy(new Error('SOCKS5 握手超时')), 15000);
  try {
    if (Buffer.byteLength(proxy.username || '') > 255 || Buffer.byteLength(proxy.password || '') > 255 || Buffer.byteLength(destination.host) > 255) throw new Error('SOCKS5 字段过长');
    socket.write(Buffer.from([5, 1, proxy.username || proxy.password ? 2 : 0]));
    const method = await io.read(2);
    if (method[0] !== 5) throw new Error('SOCKS5 版本无效');
    if (method[1] === 2) {
      const user = Buffer.from(proxy.username || '');
      const pass = Buffer.from(proxy.password || '');
      socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]));
      const auth = await io.read(2);
      if (auth[0] !== 1 || auth[1] !== 0) throw new Error('SOCKS5 用户名或密码错误');
    } else if (method[1] !== 0) {
      throw new Error('SOCKS5 不支持所选认证方式');
    }
    const name = Buffer.from(destination.host);
    const request = Buffer.alloc(7 + name.length);
    request.set([5, 1, 0, 3, name.length]);
    name.copy(request, 5);
    request.writeUInt16BE(destination.port, 5 + name.length);
    socket.write(request);
    const reply = await io.read(4);
    if (reply[0] !== 5 || reply[1] !== 0) throw new Error(`SOCKS5 连接失败（${reply[1]}）`);
    if (![1, 3, 4].includes(reply[3])) throw new Error('SOCKS5 地址类型无效');
    const length = reply[3] === 1 ? 4 : reply[3] === 4 ? 16 : (await io.read(1))[0];
    await io.read(length + 2);
    io.release();
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  } finally { clearTimeout(timer); }
}

async function connectSystem(proxy, host, port) {
  if (proxy.scheme === 'socks5') return socks(await connect(proxy.host, proxy.port), {}, { host, port });
  const authority = `${host.includes(':') ? `[${host}]` : host}:${port}`;
  return new Promise((resolve, reject) => {
    const req = (proxy.scheme === 'https' ? https : http).request({
      hostname: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: authority,
      headers: { Host: authority },
    });
    req.setTimeout(15000, () => req.destroy(new Error('连接系统代理超时')));
    req.on('error', reject);
    req.on('connect', (res, socket, head) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`系统代理拒绝连接（${res.statusCode}），请检查代理及认证设置`));
        return;
      }
      if (head.length) socket.unshift(head);
      resolve(socket);
    });
    req.end();
  });
}

async function connectSocks(upstream, host, port, systemProxy) {
  const socket = systemProxy
    ? await connectSystem(systemProxy, upstream.host, upstream.port)
    : await connect(upstream.host, upstream.port);
  return socks(socket, upstream, { host, port });
}

module.exports = { parseSystemProxy, connectSystem, connectSocks };
