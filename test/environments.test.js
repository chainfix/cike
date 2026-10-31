'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { ProfileStore } = require('../src/store');
const { BrowserManager } = require('../src/browser');
const { buildBackend } = require('../src/server');
const { parseProxyLine } = require('../src/proxyparse');
const { openStartPage, START_ORIGIN } = require('../src/startpage');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cike-environments-'));
const delay = ms => new Promise(r => setTimeout(r, ms));

test('whole proxy lines support credentials, encoded URLs and IPv6 without silently accepting incomplete fields', () => {
  assert.deepEqual(parseProxyLine('proxy.example:1080:user:p:a:ss'), { type:'http',host:'proxy.example',port:1080,username:'user',password:'p:a:ss',remark:'proxy.example:1080' });
  const p = parseProxyLine('socks5://u%40x:p%3Ass@[::1]:1080 {Test}');
  assert.equal(p.host, '::1'); assert.equal(p.username, 'u@x'); assert.equal(p.password, 'p:ss'); assert.equal(p.remark, 'Test');
  for (const line of ['example:80:user', 'example:0', 'example:80\nother:81', 'https://user:pass@host:443/path']) assert.throws(() => parseProxyLine(line));
});

test('environment proxy updates are independent, IP metadata is shown and passwords stay redacted', async () => {
  const dir = temp(); const backend = buildBackend(dir, { checkProxy: async () => ({ status:'ok',exitIp:'192.0.2.10',countryCode:'US',timezone:'America/New_York' }) });
  const server = backend.app.listen(0,'127.0.0.1'); await new Promise(r => server.once('listening',r));
  const request = async (endpoint, method='GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${endpoint}`, {method,headers:{'x-api-token':backend.token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
    return { status:response.status, body:await response.json() };
  };
  try {
    const shared = backend.proxyStore.add({type:'http',host:'old.example',port:80,password:'old-secret'});
    const a = backend.store.create({proxyId:shared.id}), b = backend.store.create({proxyId:shared.id});
    const reply = await request(`/profiles/${a.id}/proxy`,'PUT',{mode:'custom',text:'socks5://new:secret@proxy.example:1080'});
    assert.equal(reply.status,200); assert.ok(!JSON.stringify(reply.body).includes('secret'));
    assert.equal(backend.store.get(b.id).proxyId,shared.id); assert.equal(backend.proxyStore.getSecret(shared.id).host,'old.example');
    await request(`/profiles/${a.id}/checkProxy`,'POST',{});
    const profiles = (await request('/profiles')).body.profiles;
    assert.equal(profiles.find(p=>p.id===a.id).proxyIp,'192.0.2.10');
    assert.equal(profiles.find(p=>p.id===b.id).proxyIp,null);
    assert.equal(profiles.find(p=>p.id===a.id).lastOpenedAt,undefined);
    await request(`/profiles/${a.id}/proxy`,'PUT',{mode:'none'});
    assert.equal(backend.store.get(a.id).lastNetwork,null);
  } finally { await backend.browsers.closeAll(); await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true}); }
});

test('closing last window terminates only that environment; timestamps persist and numbered macOS bundles launch', {timeout:90000}, async () => {
  const dir = temp(), store = new ProfileStore(dir), manager = new BrowserManager(store,null,null,{startPage:false, downloadsDirectory:path.join(dir,'downloads')});
  try {
    const a = store.create({}), b = store.create({});
    const headless = process.platform !== 'darwin';
    await manager.open(a.id,{headless}); await manager.open(b.id,{headless});
    const first = store.get(a.id).lastOpenedAt;
    assert.ok(Date.parse(first)); assert.equal(store.get(a.id).createdAt,a.createdAt);
    await manager.open(a.id,{headless}); assert.equal(store.get(a.id).lastOpenedAt,first);
    if (!headless) {
      for (const p of [a,b]) {
        const bundle = path.join(dir,'browsers/apps',`CIKE-${p.sequence}-${p.id}.app`);
        cp.execFileSync('codesign',['--verify','--deep','--strict',bundle]);
        assert.equal(cp.execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleDisplayName',path.join(bundle,'Contents/Info.plist')],{encoding:'utf8'}).trim(),`CIKE #${p.sequence}`);
        assert.ok(fs.statSync(path.join(bundle,'Contents/Resources/cike-profile.icns')).size>1000);
      }
      const commands=cp.execFileSync('ps',['-axo','command='],{encoding:'utf8'}).split('\n').filter(l=>l.includes('--user-data-dir='+store.profileDir(a.id)));
      assert.ok(commands.some(l=>l.includes(`CIKE-${a.sequence}-${a.id}.app/Contents/MacOS`)));
      assert.ok(commands.every(l=>!l.includes('--no-sandbox')));
    }
    const contextA = manager.getContext(a.id); const extra = await contextA.newPage();
    await extra.close(); assert.ok(manager.isOpen(a.id));
    for(const page of contextA.pages()) await page.close();
    for(let i=0;i<100 && manager.isOpen(a.id);i++) await delay(50);
    assert.equal(manager.isOpen(a.id),false); assert.equal(manager.isOpen(b.id),true);
    const live=cp.execFileSync('ps',['-axo','command='],{encoding:'utf8'});
    assert.ok(!live.includes('--user-data-dir='+store.profileDir(a.id)));
    await manager.open(a.id,{headless}); assert.ok(store.get(a.id).lastOpenedAt>first);
    assert.equal(new ProfileStore(dir).get(a.id).lastOpenedAt,store.get(a.id).lastOpenedAt);
    await manager.close(a.id); assert.ok(manager.isOpen(b.id));
  } finally { await manager.closeAll();fs.rmSync(dir,{recursive:true,force:true}); }
});

test('close during pending proxy detection cancels launch without recording a last-open time', async () => {
  const dir=temp(),store=new ProfileStore(dir);let release;
  const manager=new BrowserManager(store,null,null,{checkProxy:()=>new Promise(r=>release=r)});
  try {
    const p=store.create({proxy:{server:'http://127.0.0.1:9'},locale:'en-US',timezone:'UTC'});
    const open=manager.open(p.id,{headless:true});const rejected=assert.rejects(open,/取消/);
    const close=manager.close(p.id); release({status:'ok',exitIp:'192.0.2.1'});
    await rejected;await close;assert.equal(manager.isOpen(p.id),false);assert.equal(store.get(p.id).lastOpenedAt,undefined);
  } finally {await manager.closeAll();fs.rmSync(dir,{recursive:true,force:true});}
});

test('default page detects through browser fetch, refreshes and reports failures without stale IP', async () => {
  const dir=temp(),store=new ProfileStore(dir),manager=new BrowserManager(store,null,null,{downloadsDirectory:path.join(dir,'downloads')});
  try {
    const p=store.create({name:'<fixture>',locale:'en-US',timezone:'UTC'});await manager.open(p.id,{headless:true});
    const context=manager.getContext(p.id);let failed=false,calls=0,reported;
    await context.route('https://api.ipify.org/**',route=>{calls++;return failed?route.abort():route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':START_ORIGIN},body:JSON.stringify({ip:'192.0.2.8'})});});
    await context.route('https://ipwho.is/**',route=>route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':START_ORIGIN},body:JSON.stringify({ip:'192.0.2.8',country:'Fixture',timezone:{id:'UTC'},connection:{isp:'Test ISP'}})}));
    const page=await openStartPage(context,p,{route:'proxy',exitIp:'192.0.2.8'},ip=>reported=ip);
    await page.waitForFunction(()=>document.querySelector('#refresh').disabled===false);
    assert.equal(await page.locator('#name').innerText(),'<fixture>');assert.equal(await page.locator('#ip').innerText(),'192.0.2.8');assert.equal(reported,'192.0.2.8');
    assert.equal(await page.locator('#isp').innerText(),'Test ISP');
    failed=true;await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#refresh').disabled===false);
    assert.equal(await page.locator('#ip').innerText(),'检测失败');assert.equal(calls,2);
  } finally {await manager.closeAll();fs.rmSync(dir,{recursive:true,force:true});}
});
