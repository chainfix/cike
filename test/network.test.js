'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SocksForwarder } = require('../src/socksfwd');
const { curl } = require('../src/proxycheck');
const { ProfileStore } = require('../src/store');
const { BrowserManager } = require('../src/browser');
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', r));
const close = s => new Promise(r => { s.closeAllConnections?.(); s.close(r); });

test('SOCKS HTTP forwarding preserves cookies, content type, status and chunked bodies, with remote DNS', async () => {
  const target = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    res.writeHead(201, { 'Content-Type': 'text/plain', 'Set-Cookie': ['a=1', 'b=2'], 'X-Proxy-Test': 'yes' });
    res.write('hello '); res.end(body);
  });
  await listen(target);
  const sockets = new Set(); let destination, authenticated = false;
  const socks = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let data = Buffer.alloc(0), stage = 0;
    const receive = chunk => {
      data = Buffer.concat([data, chunk]);
      for (;;) {
        if (stage === 0) {
          if (data.length < 3) return;
          data = data.subarray(3); socket.write(Buffer.from([5, 2])); stage++;
        } else if (stage === 1) {
          if (data.length < 2) return;
          const n = data[1]; if (data.length < 3 + n) return;
          const m = data[2 + n]; if (data.length < 3 + n + m) return;
          authenticated = data.subarray(2, 2 + n).toString() === 'fixture' && data.subarray(3 + n, 3 + n + m).toString() === 'secret';
          data = data.subarray(3 + n + m); socket.write(Buffer.from([1, authenticated ? 0 : 1])); stage++;
        } else {
          if (data.length < 5) return;
          const n = data[4]; if (data.length < 7 + n) return;
          destination = data.subarray(5, 5 + n).toString();
          const tail = data.subarray(7 + n); socket.off('data', receive);
          const upstream = net.connect(target.address().port, '127.0.0.1', () => {
            socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
            if (tail.length) upstream.write(tail);
            socket.pipe(upstream); upstream.pipe(socket);
          });
          upstream.on('error', () => socket.destroy()); socket.on('close', () => upstream.destroy()); return;
        }
      }
    };
    socket.on('data', receive);
  });
  await listen(socks);
  const f = await SocksForwarder.start({ host: '127.0.0.1', port: socks.address().port, username: 'fixture', password: 'secret' });
  try {
    const response = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: f.port, method: 'POST', path: 'http://unresolvable.invalid/test' }, res => {
        let body = ''; res.on('data', c => body += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }); req.on('error', reject); req.end('world');
    });
    assert.equal(authenticated, true); assert.equal(destination, 'unresolvable.invalid');
    assert.equal(response.status, 201); assert.equal(response.body, 'hello world');
    assert.deepEqual(response.headers['set-cookie'], ['a=1', 'b=2']);
    assert.equal(response.headers['content-type'], 'text/plain');
  } finally { await f.stop(); for (const socket of sockets) socket.destroy(); await close(socks); await close(target); }
});

test('curl forces selected proxy despite NO_PROXY and keeps authentication out of argv', async () => {
  let auth;
  const proxy = http.createServer((req, res) => { auth = req.headers['proxy-authorization']; res.end('via proxy'); });
  await listen(proxy);
  const old = process.env.NO_PROXY; process.env.NO_PROXY = '*';
  try {
    assert.equal(await curl({ type: 'http', host: '127.0.0.1', port: proxy.address().port, username: 'fixture', password: 'secret' }, 'http://unresolvable.invalid'), 'via proxy');
    assert.equal(auth, 'Basic ' + Buffer.from('fixture:secret').toString('base64'));
  } finally { if (old === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = old; await close(proxy); }
});

test('browser has no direct HTTP fallback when proxy closes and sends no local STUN UDP under restricted policy', { timeout: 45000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cike-network-'));
  let directHits = 0, packets = 0;
  const target = http.createServer((req, res) => { directHits++; res.end('direct'); }); await listen(target);
  const proxy = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html>proxied'); });
  proxy.on('connect', (req, socket) => { socket.on('error', () => {}); socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); }); await listen(proxy);
  const udp = dgram.createSocket('udp4'); await new Promise(r => udp.bind(0, '127.0.0.1', r)); udp.on('message', () => packets++);
  const store = new ProfileStore(dir), manager = new BrowserManager(store, null, null, { downloadsDirectory: path.join(dir, 'downloads'), checkProxy: async () => ({ status: 'ok', exitIp: '192.0.2.1' }) });
  let proxyClosed = false;
  try {
    const p = store.create({ locale: 'en-US', timezone: 'UTC', proxy: { server: `http://127.0.0.1:${proxy.address().port}` }, webrtc: 'default' });
    await manager.open(p.id, { headless: true });
    const page = await manager.getContext(p.id).newPage();
    const url = `http://127.0.0.1:${target.address().port}`;
    await page.goto(url); assert.equal(await page.locator('body').innerText(), 'proxied'); assert.equal(directHits, 0);
    const candidates = await page.evaluate(async port => {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: `stun:127.0.0.1:${port}` }] }), found = [];
      pc.onicecandidate = e => { if (e.candidate) found.push(e.candidate.candidate); };
      pc.createDataChannel('audit'); await pc.setLocalDescription(await pc.createOffer());
      await new Promise(r => setTimeout(r, 1500)); pc.close(); return found;
    }, udp.address().port);
    assert.equal(packets, 0); assert.ok(!candidates.some(c => / udp /i.test(c)));
    await close(proxy); proxyClosed = true;
    await assert.rejects(page.goto(url + '/after-close', { timeout: 6000 }), /PROXY|CONNECTION|ERR_/);
    assert.equal(directHits, 0);
  } finally { await manager.closeAll(); if (!proxyClosed) await close(proxy); await close(target); udp.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
