'use strict';
async function openEnvironmentProxy(profile) {
  if (!profile) return;
  await loadProxies();
  openModal(`环境 #${profile.sequence} · 修改代理`, `
    <p class="hint">只修改当前环境。复制一整条代理后打开此窗口会自动识别；也可以直接粘贴。</p>
    ${profile.open ? '<p class="hint">当前环境正在运行，保存时会先关闭该环境，其他环境继续运行。</p>' : ''}
    <div class="field"><label>代理方式</label><select id="ep-mode" class="input"><option value="custom">独立代理</option><option value="saved">选择已保存代理</option><option value="none">不使用代理</option></select></div>
    <div id="ep-custom"><div class="field"><label>粘贴整条代理</label><div class="row"><input id="ep-line" class="input" type="password" autocomplete="off" placeholder="host:port:用户:密码 或 socks5://用户:密码@host:port"><button id="ep-clipboard" class="btn">读取剪贴板</button></div></div>
    <div class="field-row"><div class="field"><label>类型</label><select id="ep-type" class="input"><option>http</option><option>https</option><option>socks5</option></select></div><div class="field"><label>主机</label><input id="ep-host" class="input"></div></div>
    <div class="field-row"><div class="field"><label>端口</label><input id="ep-port" class="input" type="number"></div><div class="field"><label>用户名</label><input id="ep-user" class="input" autocomplete="off"></div></div>
    <div class="field"><label>密码</label><input id="ep-pass" class="input" type="password" autocomplete="new-password"></div></div>
    <div class="field hidden" id="ep-saved"><label>已保存的代理</label><select id="ep-id" class="input">${state.proxies.map(p => `<option value="${esc(p.id)}">${esc(p.remark)} · ${esc(p.exitIp || p.host + ':' + p.port)}</option>`).join('')}</select></div>
    <p id="ep-result" class="hint" role="status"></p><div class="modal-foot"><button class="btn" id="ep-cancel">取消</button><button class="btn" id="ep-check">保存并检测</button><button class="btn primary" id="ep-save">${profile.open ? '关闭当前环境并保存' : '保存'}</button></div>
  `, (body, close) => {
    const $ = id => body.querySelector('#ep-' + id);
    let dirty = false, parsing = Promise.resolve(), invalidLine = false;
    const mode = () => { $('custom').classList.toggle('hidden', $('mode').value !== 'custom'); $('saved').classList.toggle('hidden', $('mode').value !== 'saved'); };
    const fill = p => { $('type').value = p.type; $('host').value = p.host; $('port').value = p.port; $('user').value = p.username || ''; $('pass').value = p.password || ''; $('mode').value = 'custom'; mode(); };
    if (profile.proxyId) { $('mode').value = 'saved'; $('id').value = profile.proxyId; }
    else if (profile.proxy) {
      try { const u = new URL(profile.proxy.server); fill({ type: u.protocol.slice(0,-1), host: u.hostname.replace(/^\[|\]$/g,''), port: u.port || ({'http:':80,'https:':443,'socks5:':1080})[u.protocol], username: profile.proxy.username }); $('pass').placeholder = profile.proxy.hasAuth ? '留空保留原密码' : ''; } catch {}
    } else $('mode').value = 'none';
    mode();
    body.addEventListener('input', event => {
      dirty = true;
      if (['ep-type', 'ep-host', 'ep-port', 'ep-user', 'ep-pass'].includes(event.target.id)) { $('line').value = ''; invalidLine = false; }
    }); $('mode').onchange = mode;
    const readClipboard = async automatic => {
      const result = await window.lfb.readProxyClipboard();
      if (!body.isConnected || (automatic && dirty)) return;
      if (result.ok) { fill(result.proxy); $('line').value = ''; invalidLine = false; dirty = true; $('result').textContent = '已识别剪贴板中的代理，请核对后保存。'; }
      else if (!automatic) $('result').textContent = '剪贴板中没有可识别的完整代理。';
    };
    $('clipboard').onclick = () => readClipboard(false).catch(e => { $('result').textContent = e.message; });
    $('line').addEventListener('input', () => {
      const value = $('line').value;
      invalidLine = false;
      if (!value.trim()) return;
      parsing = api('/api/proxies/parse', { method: 'POST', body: JSON.stringify({ text: value }) }).then(({ proxy }) => {
        if (!body.isConnected || $('line').value !== value) return;
        fill(proxy); $('result').textContent = '已自动拆分代理地址、用户名和密码。';
      }).catch(e => { if (body.isConnected && $('line').value === value) { invalidLine = true; $('result').textContent = e.message; } });
    });
    const save = async check => {
      $('save').disabled = $('check').disabled = true;
      try {
        await parsing;
        const data = { mode: $('mode').value };
        if (data.mode === 'saved') data.proxyId = $('id').value;
        if (data.mode === 'custom') {
          if (invalidLine) throw new Error('整条代理未能识别，请修正后再保存');
          data.proxy = { type: $('type').value, host: $('host').value.trim(), port: Number($('port').value), username: $('user').value };
          if ($('pass').value || !profile.proxy?.hasAuth) data.proxy.password = $('pass').value;
        }
        if (profile.open) await api('/api/closeBrowser', { method: 'POST', body: JSON.stringify({ profile_id: profile.id }) });
        await api('/api/profiles/' + profile.id + '/proxy', { method: 'PUT', body: JSON.stringify(data) });
        if (check && data.mode !== 'none') {
          $('result').textContent = '已保存，正在检测出口 IP…';
          const { result } = await api('/api/profiles/' + profile.id + '/checkProxy', { method: 'POST', body: '{}' });
          if (result.status !== 'ok') { await loadProfiles(); throw new Error('代理已保存，检测失败：' + (result.error || '连接不可用')); }
          toast('代理已保存 · ' + result.exitIp);
        } else toast('当前环境代理已修改');
        close(); await loadProfiles();
      } catch (error) { $('result').textContent = error.message; }
      finally { $('save').disabled = $('check').disabled = false; }
    };
    $('save').onclick = () => save(false); $('check').onclick = () => save(true); $('cancel').onclick = close;
    readClipboard(true).catch(() => {});
  });
}
