'use strict';
const http = require('http');
const { connectSocks } = require('./proxyroute');

// Chromium connects to this loopback HTTP proxy. Both plain HTTP and HTTPS
// CONNECT use the destination SOCKS5, optionally reached via a system proxy.
class SocksForwarder {
  constructor(opts) {
    this.upstream = opts;
    this.sockets = new Set();
    this.port = 0;
  }
  track(socket) {
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
    socket.on('error', () => {});
    return socket;
  }
  async connect(host, port) {
    const socket = this.track(await connectSocks(this.upstream, host, port, this.upstream.systemProxy));
    if (this.stopped) { socket.destroy(); throw new Error('代理已关闭'); }
    return socket;
  }
  static async start(opts) {
    const f = new SocksForwarder(opts);
    f.server = http.createServer((req, res) => f.request(req, res));
    f.server.on('connection', socket => f.track(socket));
    f.server.on('connect', (req, client, head) => f.tunnel(req, client, head));
    f.server.headersTimeout = 15000;
    await new Promise((resolve, reject) => {
      f.server.once('error', reject);
      f.server.listen(0, '127.0.0.1', resolve);
    });
    f.port = f.server.address().port;
    return f;
  }
  async tunnel(req, client, head) {
    try {
      const target = new URL(`http://${req.url}`);
      const upstream = await this.connect(target.hostname.replace(/^\[|\]$/g, ''), Number(target.port) || 80);
      if (client.destroyed) { upstream.destroy(); return; }
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
      client.once('close', () => upstream.destroy());
      upstream.once('close', () => client.destroy());
    } catch { client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); }
  }
  async request(req, res) {
    const agent = new http.Agent({ keepAlive: false });
    agent.createConnection = (options, callback) => {
      this.connect(options.host, options.port).then(socket => { callback(null, socket); socket.resume(); }, callback);
    };
    try {
      const target = new URL(req.url);
      if (target.protocol !== 'http:' || target.username || target.password) throw new Error('unsupported protocol');
      const cleanHeaders = headers => {
        const omit = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', ...(headers.connection || '').toLowerCase().split(',').map(s => s.trim())]);
        return Object.fromEntries(Object.entries(headers).filter(([name]) => !omit.has(name)));
      };
      const upstream = http.request(target, { method: req.method, headers: { ...cleanHeaders(req.headers), host: target.host }, agent }, response => {
        res.writeHead(response.statusCode, cleanHeaders(response.headers));
        response.on('error', () => res.destroy());
        response.pipe(res);
      });
      upstream.setTimeout(30000, () => upstream.destroy(new Error('proxy timeout')));
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.on('aborted', () => upstream.destroy());
      res.once('close', () => { upstream.destroy(); agent.destroy(); });
      req.pipe(upstream);
    } catch { agent.destroy(); res.writeHead(502); res.end(); }
  }
  async stop() {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.stopping = (async () => {
      for (const socket of this.sockets) socket.destroy();
      if (this.server) await new Promise(resolve => this.server.close(resolve));
      this.server = null;
    })();
    return this.stopping;
  }
}
module.exports = { SocksForwarder };
