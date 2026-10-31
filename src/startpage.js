'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');
const ORIGIN = 'https://start.cike.invalid';
async function openStartPage(context, profile, network, onResult) {
  const page = context.pages()[0] || await context.newPage();
  const root = path.join(__dirname, '..', 'electron', 'start');
  const config = { name: profile.name, sequence: profile.sequence, proxy: network.route === 'proxy', expectedIp: network.exitIp };
  const assets = { '/': ['index.html', 'text/html'], '/start.js': ['start.js', 'text/javascript'], '/start.css': ['start.css', 'text/css'] };
  // A reserved .invalid origin is fulfilled only inside this page. No local
  // API token, proxy password, listening port or browser-wide JS binding.
  await page.route(ORIGIN + '/**', async route => {
    const req = route.request(), url = new URL(req.url());
    const headers = { 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self' https://api.ipify.org https://ipwho.is; frame-ancestors 'none'" };
    if (url.pathname === '/result' && req.method() === 'POST') {
      if (req.headers().origin !== ORIGIN || page.url() !== ORIGIN + '/') return route.fulfill({ status: 403, body: '' });
      try {
        const data = req.postDataJSON();
        if (!net.isIP(data.ip)) throw new Error('Invalid IP');
        onResult(data.ip);
        return route.fulfill({ status: 204, body: '' });
      } catch { return route.fulfill({ status: 400, body: '' }); }
    }
    if (req.method() !== 'GET') return route.fulfill({ status: 405, body: '' });
    if (url.pathname === '/config.js') return route.fulfill({ headers, contentType: 'text/javascript', body: 'window.cikeEnvironment=' + JSON.stringify(config) + ';' });
    if (url.pathname === '/icon.svg') return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="16" fill="#172b48"/><text x="32" y="43" text-anchor="middle" fill="white" font-size="${String(profile.sequence).length > 3 ? 18 : 30}" font-family="sans-serif">${Number(profile.sequence)}</text></svg>` });
    const file = assets[url.pathname];
    return file ? route.fulfill({ headers, contentType: file[1], body: fs.readFileSync(path.join(root, file[0])) }) : route.fulfill({ status: 404, body: '' });
  });
  await page.goto(ORIGIN + '/');
  return page;
}
module.exports = { openStartPage, START_ORIGIN: ORIGIN };
