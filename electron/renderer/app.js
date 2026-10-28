'use strict';
/* CIKE 渲染层 — 基于 Local API 的单页应用 */

const TIMEZONES = ['auto', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Berlin', 'Europe/Moscow', 'Asia/Dubai', 'Asia/Shanghai',
  'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];
const TIMEZONE_LABELS = { auto: '跟随代理（推荐）' };
const VIEWPORTS = ['1440x900', '1366x768', '1536x864', '1920x1080', '1280x800', '2560x1440'];
const LOCALES = ['auto', 'zh-CN', 'en-US', 'en-GB', 'de-DE', 'fr-FR', 'ja-JP'];

const selectedProfiles = new Set(), selectedProxies = new Set();
let batchBusy = false;
const state = { profiles: [], proxies: [], chromium: null, page: 'profiles', activeGroup: '', profilePage: 0, proxyPage: 0 };

function apiBase() { return (window.lfb?.apiBase || '').replace(/\/$/, ''); }
function token() { return window.lfb?.token || ''; }

async function api(path, opts = {}) {
  const url = apiBase() + path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token());
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg, isError = false) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function openModal(title, bodyHtml, onMount) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal"><h2>${esc(title)}</h2><div class="modal-body"></div></div></div>`;
  const body = root.querySelector('.modal-body');
  body.innerHTML = bodyHtml;
  root.querySelector('.modal-backdrop').addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('modal-backdrop')) closeModal();
  });
  const close = () => closeModal();
  if (onMount) onMount(body, close);
  return close;
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

// ---------- 导航 ----------

function showPage(name) {
  state.page = name;
  document.querySelectorAll('.menu-item').forEach((b) => b.classList.toggle('active', b.dataset.page === name));
  document.querySelectorAll('.page').forEach((p) => p.classList.add('hidden'));
  document.getElementById('page-' + name).classList.remove('hidden');
  // 分组过滤只在浏览器管理页显示
  document.getElementById('group-section').style.display = name === 'profiles' ? '' : 'none';
  if (name === 'new') initNewPage();
  if (name === 'profiles') loadProfiles();
  if (name === 'proxies') loadProxies();
  if (name === 'settings') loadSettings();
}

// ---------- 新建环境（内嵌页面） ----------

let newPageInited = false;
let platformDefaulted = false;

function initNewPage() {
  // Populate selects (only once, but refresh proxy list each time)
  const vpSel = document.getElementById('n-vp');
  if (!vpSel.options.length) {
    vpSel.innerHTML = VIEWPORTS.map((v) => `<option>${v}</option>`).join('');
  }
  // Default the spoofed OS to the host OS, once (Windows build ships win-first).
  if (!platformDefaulted) {
    platformDefaulted = true;
    document.getElementById('n-platform').value = window.lfb?.platform === 'win32' ? 'win' : 'mac';
  }
  const locSel = document.getElementById('n-locale');
  if (!locSel.options.length) {
    locSel.innerHTML = LOCALES.map((l) => `<option value="${l}" ${l === 'auto' ? 'selected' : ''}>${l === 'auto' ? '跟随代理（推荐）' : l}</option>`).join('');
  }
  const tzSel = document.getElementById('n-tz');
  if (!tzSel.options.length) {
    tzSel.innerHTML = TIMEZONES.map((t) => `<option value="${t}" ${t === 'auto' ? 'selected' : ''}>${TIMEZONE_LABELS[t] || t}</option>`).join('');
  }
  refreshNewProxySelect();
  if (newPageInited) return;
  newPageInited = true;

  document.getElementById('n-proxy').onchange = () => {
    document.getElementById('n-proxy-result').textContent = '';
    // Auto-check on select
    autoCheckNewProxy();
  };
  document.getElementById('n-proxy-check').onclick = () => autoCheckNewProxy(true);
  document.getElementById('n-save').onclick = () => saveNewProfile(false);
  document.getElementById('n-save-open').onclick = () => saveNewProfile(true);
}

function refreshNewProxySelect() {
  const sel = document.getElementById('n-proxy');
  const cur = sel.value;
  sel.innerHTML = `<option value="">不使用代理</option>` +
    state.proxies.map((x) => {
      const st = x.status === 'ok' ? ` ✓ ${x.exitIp || ''}` : x.status === 'failed' ? ' ✗' : '';
      return `<option value="${x.id}">${esc(x.remark || x.host + ':' + x.port)}${st}</option>`;
    }).join('');
  if (cur) sel.value = cur;
  // Populate group datalist with existing groups
  const groups = [...new Set(state.profiles.map((p) => p.group).filter(Boolean))].sort();
  document.getElementById('n-group-list').innerHTML =
    groups.map((g) => `<option value="${esc(g)}">`).join('');
}

/** Auto-check the selected proxy and show result. Returns check result or null. */
async function autoCheckNewProxy(manual = false) {
  const pid = document.getElementById('n-proxy').value;
  const resultEl = document.getElementById('n-proxy-result');
  if (!pid) {
    resultEl.textContent = '';
    return null;
  }
  resultEl.textContent = '正在检测代理…';
  resultEl.style.color = 'var(--muted)';
  try {
    const r = await api('/api/proxies/check', {
      method: 'POST',
      body: JSON.stringify({ ids: [pid] }),
    });
    const res = r.results?.[0];
    await loadProxies(); // refresh proxy list with new check data
    refreshNewProxySelect();
    // Restore selection after refresh
    document.getElementById('n-proxy').value = pid;
    if (res?.status === 'ok') {
      resultEl.textContent = `✓ ${res.exitIp} · ${res.country || ''} · ${res.timezone || ''}（时区/语言将自动跟随）`;
      resultEl.style.color = 'var(--green)';
      return res;
    } else {
      resultEl.textContent = '✗ 代理检测失败：' + (res?.error || '未知错误') + '——请检查代理是否可用';
      resultEl.style.color = 'var(--red)';
      if (manual) toast('代理检测失败，请检查代理设置', true);
      return null;
    }
  } catch (err) {
    resultEl.textContent = '✗ 检测出错：' + err.message;
    resultEl.style.color = 'var(--red)';
    return null;
  }
}

async function saveNewProfile(openAfter = false) {
  const proxyId = document.getElementById('n-proxy').value || null;

  // Force proxy check before creating (if a proxy is selected)
  if (proxyId) {
    const checkResult = await autoCheckNewProxy();
    if (!checkResult) {
      const go = confirm('代理检测失败，指纹参数（时区/语言）无法自动跟随。是否仍要创建？');
      if (!go) return;
    }
  }

  const [vw, vh] = document.getElementById('n-vp').value.split('x').map(Number);
  const spec = {
    group: document.getElementById('n-group').value.trim(),
    platform: document.getElementById('n-platform').value,
    locale: document.getElementById('n-locale').value,
    timezone: document.getElementById('n-tz').value,
    viewport: { width: vw, height: vh },
    proxyId,
    canvasNoise: document.getElementById('n-cnoise').value === '1',
    webrtc: document.getElementById('n-webrtc').value,
  };
  const seed = document.getElementById('n-seed').value.trim();
  if (seed !== '') spec.canvasSeed = parseInt(seed, 10);
  const cores = document.getElementById('n-cores').value.trim();
  if (cores !== '') spec.hardwareConcurrency = parseInt(cores, 10);
  const mem = document.getElementById('n-memory').value.trim();
  if (mem !== '') spec.deviceMemory = parseFloat(mem);

  try {
    const r = await api('/api/profiles', { method: 'POST', body: JSON.stringify(spec) });
    toast('环境已创建');
    // Reset form
    await loadProfiles();
    document.getElementById('n-group').value = '';
    document.getElementById('n-proxy-result').textContent = '';
    if (openAfter && r.profile?.id) {
      // Open with proxy check
      await openProfileWithCheck(r.profile.id);
    } else {
      showPage('profiles');
    }
  } catch (err) {
    toast('创建失败：' + err.message, true);
  }
}

/** Open a profile with forced proxy check first. */
async function openProfileWithCheck(profileId) {
  const p = state.profiles.find((x) => x.id === profileId);
  if (!p) { toast('环境不存在', true); return; }
  if (!state.chromium?.installed) {
    toast('请先在“设置”里下载 Chromium 内核', true);
    return;
  }
  // Force proxy check if the profile uses a proxy
  if (p.proxyId) {
    toast('正在检测代理…');
    try {
      const r = await api('/api/proxies/check', {
        method: 'POST',
        body: JSON.stringify({ ids: [p.proxyId] }),
      });
      const res = r.results?.[0];
      await loadProxies();
      if (res?.status !== 'ok') {
        const go = confirm(`代理检测失败：${res?.error || '未知错误'}\n\n指纹参数可能无法跟随代理。是否仍要打开？`);
        if (!go) return;
      } else {
        toast(`代理正常：${res.exitIp} · ${res.country || ''}`);
      }
    } catch (err) {
      const go = confirm(`代理检测出错：${err.message}\n\n是否仍要打开？`);
      if (!go) return;
    }
  }
  try {
    await api('/api/openBrowser', { method: 'POST', body: JSON.stringify({ profile_id: profileId }) });
    toast('环境已打开');
    await loadProfiles();
  } catch (err) {
    toast('打开失败：' + err.message, true);
  }
}

async function loadProfiles() {
  try {
    const { profiles } = await api('/api/profiles');
    state.profiles = profiles;
    for (const id of selectedProfiles) if (!profiles.some(p => p.id === id)) selectedProfiles.delete(id);
    renderProfiles();
  } catch (e) { toast('加载环境失败：' + e.message, true); }
}

/** Poll open/close status (e.g. user closed browser via window X). */
let lastOpenState = '';
async function pollOpenStatus() {
  // Only poll when on the profiles page and no modal is open
  if (state.page !== 'profiles' || document.querySelector('.modal')) return;
  try {
    const { profiles } = await api('/api/profiles');
    const cur = profiles.map((p) => p.id + ':' + (p.open ? 1 : 0)).sort().join(',');
    if (cur !== lastOpenState) {
      lastOpenState = cur;
      state.profiles = profiles;
      renderProfiles();
    }
  } catch { /* silent */ }
}
setInterval(pollOpenStatus, 3000);

function renderProfiles() {
  const q = document.getElementById('profile-search').value.trim().toLowerCase();
  const gf = state.activeGroup;

  const rows = state.profiles.filter((p) =>
    (!q || (p.name + ' ' + (p.group || '')).toLowerCase().includes(q)) &&
    (!gf || p.group === gf));

  syncSelection('profile', rows, selectedProfiles);
  const list = document.getElementById('profiles-list');
  if (!rows.length) {
    list.innerHTML = '<div class="list-empty">还没有环境，点击左侧「新建环境」创建一个。</div>';
    return;
  }

  // Pagination
  const PAGE_SIZE = 12;
  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  if (state.profilePage >= totalPages) state.profilePage = Math.max(0, totalPages - 1);
  const start = state.profilePage * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  list.innerHTML = pageRows.map((p) => `
    <div class="env-card ${p.open ? 'running' : ''}">
      <input type="checkbox" class="profile-sel" value="${p.id}" aria-label="选择环境 ${esc(p.name)}" ${selectedProfiles.has(p.id) ? 'checked' : ''}>
      <span class="dot"></span>
      <div class="info">
        <div class="name">${esc(p.name)}</div>
        <div class="meta">
          <span>${esc(p.group || '未分组')}</span>
          <span>${p.platform === 'mac' ? 'macOS' : 'Windows'}</span>
          <span>代理：${esc(p.proxyRemark || '无')}</span>
          <span class="pill ${p.open ? 'open' : 'closed'}">${p.open ? '运行中' : '已关闭'}</span>
        </div>
      </div>
      <div class="actions">
        ${p.open
          ? `<button class="link-btn" data-act="close" data-id="${p.id}">关闭</button>`
          : `<button class="link-btn" data-act="open" data-id="${p.id}">打开</button>`}
        <button class="link-btn" data-act="edit" data-id="${p.id}">编辑</button>
        <button class="link-btn danger" data-act="del" data-id="${p.id}">删除</button>
      </div>
    </div>`).join('') + (totalPages > 1 ? renderPagination(state.profilePage, totalPages, 'profile') : '');
  renderSideGroups();
}

function renderPagination(cur, total, type) {
  let html = `<div class="pagination">`;
  html += `<button class="page-btn" data-page="${cur - 1}" data-type="${type}" ${cur === 0 ? 'disabled' : ''}>‹ 上一页</button>`;
  // Show page numbers (max 7)
  let start = Math.max(0, Math.min(cur - 3, total - 7));
  let end = Math.min(total, start + 7);
  for (let i = start; i < end; i++) {
    html += `<button class="page-btn ${i === cur ? 'active' : ''}" data-page="${i}" data-type="${type}">${i + 1}</button>`;
  }
  html += `<button class="page-btn" data-page="${cur + 1}" data-type="${type}" ${cur >= total - 1 ? 'disabled' : ''}>下一页 ›</button>`;
  html += `<span class="page-info">共 ${total} 页</span></div>`;
  return html;
}

function renderSideGroups() {
  const groups = [...new Set(state.profiles.map((p) => p.group).filter(Boolean))].sort();
  // If the active group no longer exists (e.g. profile edited/deleted), reset filter
  if (state.activeGroup && !groups.includes(state.activeGroup)) {
    state.activeGroup = '';
  }
  const box = document.getElementById('group-list');
  box.innerHTML =
    `<button class="group-item ${!state.activeGroup ? 'active' : ''}" data-group="">
       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
       全部环境</button>` +
    (groups.length
      ? groups.map((g) => `<button class="group-item ${state.activeGroup === g ? 'active' : ''}" data-group="${esc(g)}" title="分组：${esc(g)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
          ${esc(g)}</button>`).join('')
      : `<div class="side-empty">没有分组</div>`);
}

async function handleProfileAction(act, id, btn) {
  if (btn) btn.disabled = true;
  try {
    if (act === 'open') {
      await openProfileWithCheck(id);
      return;
    } else if (act === 'close') {
      await api('/api/closeBrowser', { method: 'POST', body: JSON.stringify({ profile_id: id }) });
    } else if (act === 'del') {
      const p = state.profiles.find((x) => x.id === id);
      if (!confirm(`删除环境「${p?.name}」及其全部数据？`)) return;
      await api('/api/profiles/' + id, { method: 'DELETE' });
      toast('已删除');
    } else if (act === 'edit') {
      openProfileModal(state.profiles.find((x) => x.id === id));
      return;
    }
    await loadProfiles();
  } catch (err) { toast(err.message, true); }
  finally { if (btn) btn.disabled = false; }
}

document.getElementById('profiles-list').addEventListener('click', async (e) => {
  // Pagination
  const pageBtn = e.target.closest('.page-btn');
  if (pageBtn && !pageBtn.disabled) {
    state.profilePage = parseInt(pageBtn.dataset.page, 10);
    renderProfiles();
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  await handleProfileAction(btn.dataset.act, btn.dataset.id, btn);
});

// 侧边栏：点击分组过滤
document.getElementById('group-list').addEventListener('click', (e) => {
  const item = e.target.closest('.group-item');
  if (!item) return;
  state.activeGroup = item.dataset.group || '';
  state.profilePage = 0;
  renderProfiles();
});
document.getElementById('group-toggle').addEventListener('click', (e) => {
  const list = document.getElementById('group-list');
  const hidden = list.classList.toggle('hidden');
  e.currentTarget.classList.toggle('collapsed', hidden);
});

function proxyOptionsHtml(selectedId) {
  const opts = [`<option value="">不使用代理</option>`]
    .concat(state.proxies.map((x) => `<option value="${x.id}" ${x.id === selectedId ? 'selected' : ''}>${esc(x.remark)} (${esc(x.type)}://${esc(x.host)}:${x.port})</option>`));
  return `<optgroup label="已保存的代理">${opts.join('')}</optgroup><option value="__custom" ${selectedId === '__custom' ? 'selected' : ''}>自定义…</option>`;
}

function openProfileModal(existing) {
  const p = existing || {};
  const isEdit = !!existing;
  openModal(isEdit ? '编辑环境' : '新建环境', `
    <div class="field"><label>名称</label><input id="f-name" class="input" value="${esc(p.name || '')}" placeholder="例如：店铺-01"></div>
    <div class="field-row">
      <div class="field"><label>分组</label><input id="f-group" class="input" list="f-group-list" value="${esc(p.group || '')}" placeholder="选填，可选已有或输入新的"><datalist id="f-group-list">${[...new Set(state.profiles.map((x) => x.group).filter(Boolean))].sort().map((g) => `<option value="${esc(g)}">`).join('')}</datalist></div>
      <div class="field"><label>平台</label><select id="f-platform" class="input">
        <option value="mac" ${p.platform !== 'win' ? 'selected' : ''}>macOS</option>
        <option value="win" ${p.platform === 'win' ? 'selected' : ''}>Windows</option>
      </select></div>
    </div>
    <div class="field"><label>代理</label>
      <div style="display:flex;gap:8px">
        <select id="f-proxy" class="input" style="flex:1">${proxyOptionsHtml(p.proxyId || '')}</select>
        <button type="button" id="f-proxy-check" class="btn" style="flex-shrink:0">检测</button>
      </div>
      <div id="f-proxy-check-result" style="font-size:12px;color:var(--muted);margin-top:4px"></div>
    </div>
    <div id="f-custom-proxy" class="hidden">
      <div class="field-row">
        <div class="field"><label>类型</label><select id="f-ptype" class="input"><option>http</option><option>https</option><option>socks5</option></select></div>
        <div class="field"><label>主机</label><input id="f-phost" class="input" placeholder="1.2.3.4"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>端口</label><input id="f-pport" class="input" placeholder="8080"></div>
        <div class="field"><label>用户名</label><input id="f-puser" class="input"></div>
      </div>
      <div class="field"><label>密码</label><input id="f-ppass" class="input" type="password"></div>
    </div>
    <details class="advanced"><summary>指纹选项</summary>
      <div class="field-row" style="margin-top:10px">
        <div class="field"><label>语言</label><select id="f-locale" class="input">${LOCALES.map((l) => `<option value="${l}" ${((p.locale || 'auto') === l) ? 'selected' : ''}>${l === 'auto' ? '跟随代理（推荐）' : l}</option>`).join('')}</select></div>
        <div class="field"><label>时区</label><select id="f-tz" class="input">${TIMEZONES.map((t) => `<option value="${t}" ${((p.timezone || 'auto') === t) ? 'selected' : ''}>${TIMEZONE_LABELS[t] || t}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>分辨率</label><select id="f-vp" class="input">${VIEWPORTS.map((v) => `<option ${`${p.viewport?.width}x${p.viewport?.height}` === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>Canvas 噪声 <span class="sub">（去关联用，browserscan -5%）</span></label><select id="f-cnoise" class="input">
          <option value="0" ${!p.canvasNoise ? 'selected' : ''}>关闭（指纹最真）</option>
          <option value="1" ${p.canvasNoise ? 'selected' : ''}>开启（环境间去关联）</option>
        </select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Canvas 种子 <span class="sub">（噪声开启时生效，留空 = 随机）</span></label><input id="f-seed" class="input" value="${p.canvasSeed ?? ''}" placeholder="自动"></div>
        <div class="field"><label>CPU 核心数</label><input id="f-cores" class="input" value="${p.hardwareConcurrency ?? ''}" placeholder="自动"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>WebRTC</label><select id="f-webrtc" class="input">
          <option value="auto" ${!p.webrtc || p.webrtc === 'auto' ? 'selected' : ''}>自动（有代理时防泄漏）</option>
          <option value="default" ${p.webrtc === 'default' ? 'selected' : ''}>默认</option>
          <option value="disabled" ${p.webrtc === 'disabled' ? 'selected' : ''}>禁用</option>
        </select></div>
      </div>
    </details>
    <div class="modal-foot">
      <button class="btn" id="m-cancel">取消</button>
      <button class="btn primary" id="m-save">${isEdit ? '保存' : '创建'}</button>
    </div>
  `, (body, close) => {
    const proxySel = body.querySelector('#f-proxy');
    const customBox = body.querySelector('#f-custom-proxy');
    const syncCustom = () => customBox.classList.toggle('hidden', proxySel.value !== '__custom');
    proxySel.addEventListener('change', syncCustom); syncCustom();
    // Proxy check button in the profile modal
    body.querySelector('#f-proxy-check').onclick = async (e) => {
      const btn = e.target;
      const pid = proxySel.value;
      const resultEl = body.querySelector('#f-proxy-check-result');
      if (!pid || pid === '__custom') {
        resultEl.textContent = '请先选择已保存的代理（自定义代理请保存后再检测）';
        return;
      }
      btn.disabled = true;
      resultEl.textContent = '检测中…';
      try {
        const r = await api('/api/proxies/check', {
          method: 'POST',
          body: JSON.stringify({ ids: [pid] }),
        });
        const res = r.results?.[0];
        if (res?.status === 'ok') {
          resultEl.textContent = `✓ ${res.exitIp} · ${res.country || ''} · ${res.timezone || ''}`;
          resultEl.style.color = 'var(--green)';
          // Refresh proxy list so timezone/country are current
          await loadProxies();
        } else {
          resultEl.textContent = '✗ 检测失败：' + (res?.error || '未知错误');
          resultEl.style.color = 'var(--red)';
        }
      } catch (err) {
        resultEl.textContent = '✗ ' + err.message;
        resultEl.style.color = 'var(--red)';
      } finally {
        btn.disabled = false;
      }
    };
    body.querySelector('#m-cancel').onclick = close;
    body.querySelector('#m-save').onclick = async () => {
      const name = body.querySelector('#f-name').value.trim();
      if (!name) { toast('请填写名称', true); return; }
      const [vw, vh] = body.querySelector('#f-vp').value.split('x').map(Number);
      const spec = {
        name,
        group: body.querySelector('#f-group').value.trim(),
        platform: body.querySelector('#f-platform').value,
        locale: body.querySelector('#f-locale').value,
        timezone: body.querySelector('#f-tz').value,
        viewport: { width: vw, height: vh },
      };
      const seed = body.querySelector('#f-seed').value.trim();
      if (seed !== '') spec.canvasSeed = parseInt(seed, 10);
      spec.canvasNoise = body.querySelector('#f-cnoise').value === '1';
      const cores = body.querySelector('#f-cores').value.trim();
      if (cores !== '') spec.hardwareConcurrency = parseInt(cores, 10);
      spec.webrtc = body.querySelector('#f-webrtc').value;
      if (proxySel.value === '__custom') {
        spec.proxyId = null;
        spec.proxy = {
          server: `${body.querySelector('#f-ptype').value}://${body.querySelector('#f-phost').value.trim()}:${body.querySelector('#f-pport').value.trim()}`,
          username: body.querySelector('#f-puser').value.trim() || undefined,
          password: body.querySelector('#f-ppass').value || undefined,
        };
      } else {
        spec.proxyId = proxySel.value || null;
        spec.proxy = null;
      }
      try {
        if (isEdit) await api('/api/profiles/' + p.id, { method: 'PATCH', body: JSON.stringify(spec) });
        else await api('/api/profiles', { method: 'POST', body: JSON.stringify(spec) });
        close(); toast(isEdit ? '已保存' : '环境已创建');
        await loadProfiles();
      } catch (e) { toast(e.message, true); }
    };
  });
}

// ---------- 代理 ----------

async function loadProxies() {
  try {
    const { proxies } = await api('/api/proxies');
    state.proxies = proxies;
    for (const id of selectedProxies) if (!proxies.some(p => p.id === id)) selectedProxies.delete(id);
    renderProxies();
  } catch (e) { toast('加载代理失败：' + e.message, true); }
}

function statusPill(x) {
  if (x.status === 'ok') return `<span class="pill ok">正常</span>`;
  if (x.status === 'failed') return `<span class="pill failed">失败</span>`;
  return `<span class="pill unchecked">未检测</span>`;
}

function renderProxies() {
  syncSelection('proxy', state.proxies, selectedProxies);
  const list = document.getElementById('proxies-list');
  if (!state.proxies.length) {
    list.innerHTML = '<div class="list-empty">还没有代理，点击「添加代理」批量导入。</div>';
    return;
  }
  // Pagination
  const PAGE_SIZE = 15;
  const totalPages = Math.ceil(state.proxies.length / PAGE_SIZE);
  if (state.proxyPage >= totalPages) state.proxyPage = Math.max(0, totalPages - 1);
  const start = state.proxyPage * PAGE_SIZE;
  const pageRows = state.proxies.slice(start, start + PAGE_SIZE);

  list.innerHTML = pageRows.map((x) => `
    <div class="proxy-card">
      <input type="checkbox" class="proxy-sel" value="${x.id}" aria-label="选择代理 ${esc(x.remark)}" ${selectedProxies.has(x.id) ? 'checked' : ''}>
      <div class="info">
        <div class="name">${esc(x.remark)}</div>
        <div class="meta">
          <span class="mono">${esc(x.type)}://${esc(x.host)}:${x.port}</span>
          <span>${statusPill(x)}</span>
          ${x.exitIp ? `<span class="mono">出口 ${esc(x.exitIp)}</span>` : ''}
          ${x.country ? `<span>${esc(x.country)}</span>` : ''}
        </div>
      </div>
      <div class="actions">
        <button class="link-btn" data-act="check" data-id="${x.id}">检测</button>
        <button class="link-btn" data-act="edit" data-id="${x.id}">编辑</button>
        <button class="link-btn danger" data-act="del" data-id="${x.id}">删除</button>
      </div>
    </div>`).join('') + (totalPages > 1 ? renderPagination(state.proxyPage, totalPages, 'proxy') : '');
}

function selectedProxyIds() {
  return [...selectedProxies];
}

document.getElementById('proxies-list').addEventListener('click', async (e) => {
  // Pagination
  const pageBtn = e.target.closest('.page-btn');
  if (pageBtn && !pageBtn.disabled) {
    state.proxyPage = parseInt(pageBtn.dataset.page, 10);
    renderProxies();
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  btn.disabled = true;
  try {
    if (act === 'check') {
      toast('正在检测…');
      await api('/api/proxies/check', { method: 'POST', body: JSON.stringify({ ids: [id] }) });
    } else if (act === 'del') {
      if (!confirm('删除这条代理？')) return;
      await api('/api/proxies/' + id, { method: 'DELETE' });
      toast('已删除');
    } else if (act === 'edit') {
      openProxyEditModal(state.proxies.find((x) => x.id === id));
      return;
    }
    await loadProxies();
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; }
});

document.getElementById('btn-add-proxy').onclick = () => {
  openModal('添加代理', `
    <div class="field"><label>类型（对没有写协议的行生效）</label>
      <select id="p-type" class="input"><option>http</option><option>https</option><option>socks5</option><option>ssh</option></select></div>
    <div class="field"><label>代理列表 — 每行一个</label>
      <textarea id="p-bulk" class="input" placeholder="1.2.3.4:8080:用户名:密码{办公室}&#10;socks5://用户名:密码@5.6.7.8:1080"></textarea></div>
    <div class="modal-foot"><button class="btn" id="m-cancel">取消</button><button class="btn primary" id="m-save">添加</button></div>
  `, (body, close) => {
    body.querySelector('#m-cancel').onclick = close;
    body.querySelector('#m-save').onclick = async () => {
      const bulk = body.querySelector('#p-bulk').value.trim();
      if (!bulk) { toast('请至少粘贴一条代理', true); return; }
      try {
        const { added, errors } = await api('/api/proxies', {
          method: 'POST', body: JSON.stringify({ bulk, type: body.querySelector('#p-type').value }),
        });
        close();
        toast(`已添加 ${added.length} 条` + (errors.length ? `，${errors.length} 行格式错误` : ''));
        if (errors.length) console.warn(errors);
        await loadProxies();
      } catch (e) { toast(e.message, true); }
    };
  });
};

function openProxyEditModal(x) {
  if (!x) return;
  openModal('编辑代理', `
    <div class="field"><label>备注</label><input id="e-remark" class="input" value="${esc(x.remark)}"></div>
    <div class="field-row">
      <div class="field"><label>类型</label><select id="e-type" class="input">${['http', 'https', 'socks5', 'ssh'].map((t) => `<option ${x.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>主机</label><input id="e-host" class="input" value="${esc(x.host)}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>端口</label><input id="e-port" class="input" value="${x.port}"></div>
      <div class="field"><label>用户名 <span class="sub">（留空=不改）</span></label><input id="e-user" class="input" value="${x.hasAuth ? '••••••' : ''}" placeholder="留空不改"></div>
    </div>
    <div class="field"><label>密码 <span class="sub">（留空=不改）</span></label><input id="e-pass" class="input" type="password"></div>
    <div class="modal-foot"><button class="btn" id="m-cancel">取消</button><button class="btn primary" id="m-save">保存</button></div>
  `, (body, close) => {
    body.querySelector('#m-cancel').onclick = close;
    body.querySelector('#m-save').onclick = async () => {
      const patch = {
        remark: body.querySelector('#e-remark').value.trim(),
        type: body.querySelector('#e-type').value,
        host: body.querySelector('#e-host').value.trim(),
        port: parseInt(body.querySelector('#e-port').value.trim(), 10),
      };
      const u = body.querySelector('#e-user').value;
      const pw = body.querySelector('#e-pass').value;
      if (u && u !== '••••••') patch.username = u;
      if (pw) patch.password = pw;
      try {
        await api('/api/proxies/' + x.id, { method: 'PATCH', body: JSON.stringify(patch) });
        close(); toast('已保存'); await loadProxies();
      } catch (e) { toast(e.message, true); }
    };
  });
}

document.getElementById('btn-check-proxies').onclick = async (e) => {
  const ids = selectedProxyIds();
  if (!ids.length) { toast('请先勾选代理', true); return; }
  e.target.disabled = true;
  try {
    toast(`正在检测 ${ids.length} 条代理…`);
    await api('/api/proxies/check', { method: 'POST', body: JSON.stringify({ ids }) });
    await loadProxies();
    toast('检测完成');
  } catch (err) { toast(err.message, true); }
  finally { e.target.disabled = false; }
};

function filteredProfiles() {
  const q = document.getElementById('profile-search').value.trim().toLowerCase();
  return state.profiles.filter(p => (!q || (p.name + ' ' + (p.group || '')).toLowerCase().includes(q)) && (!state.activeGroup || p.group === state.activeGroup));
}
function syncSelection(type, rows, selected) {
  const all = document.getElementById(type + '-all');
  const count = rows.filter(p => selected.has(p.id)).length;
  all.checked = rows.length > 0 && count === rows.length;
  all.indeterminate = count > 0 && count < rows.length;
  all.disabled = batchBusy || !rows.length;
  document.getElementById(type + '-count').textContent = `已选 ${selected.size} 项`;
}
for (const [type, selected, rows, render] of [
  ['profile', selectedProfiles, filteredProfiles, renderProfiles],
  ['proxy', selectedProxies, () => state.proxies, renderProxies],
]) {
  document.getElementById(type === 'profile' ? 'profiles-list' : 'proxies-list').addEventListener('change', e => {
    if (!e.target.matches('.' + type + '-sel')) return;
    if (batchBusy) { render(); return; }
    if (e.target.checked) selected.add(e.target.value); else selected.delete(e.target.value);
    render();
  });
  document.getElementById(type + '-all').onchange = e => {
    for (const row of rows()) { if (e.target.checked) selected.add(row.id); else selected.delete(row.id); }
    render();
  };
}
async function runBatch(type, action) {
  if (batchBusy) return;
  const selected = type === 'profile' ? selectedProfiles : selectedProxies;
  const ids = [...selected];
  if (!ids.length) { toast('请先勾选需要操作的项目', true); return; }
  if (action === 'delete' && !confirm(`删除选中的 ${ids.length} 个${type === 'profile' ? '环境及其全部数据（运行中的环境将关闭）' : '代理'}？`)) return;
  if (action === 'open' && !state.chromium?.installed) { toast('请先下载 Chromium 内核', true); return; }
  batchBusy = true;
  const buttons = ['btn-open-profiles', 'btn-del-profiles', 'btn-del-proxies'].map(id => document.getElementById(id));
  buttons.forEach(b => b.disabled = true);
  let done = 0;
  const failures = [];
  try {
    for (const id of ids) {
      try {
        if (action === 'open') {
          await api('/api/openBrowser', { method: 'POST', body: JSON.stringify({ profile_id: id }) });
        } else {
          await api('/api/' + (type === 'profile' ? 'profiles/' : 'proxies/') + id, { method: 'DELETE' });
        }
        selected.delete(id);
        done++;
      } catch (e) { failures.push(e.message); }
    }
  } finally {
    batchBusy = false;
    buttons.forEach(b => b.disabled = false);
    await loadProfiles();
    await loadProxies();
  }
  toast(`完成 ${done}/${ids.length} 项` + (failures.length ? `，失败 ${failures.length} 项：${failures[0]}` : ''), failures.length > 0);
}
document.getElementById('btn-open-profiles').onclick = () => runBatch('profile', 'open');
document.getElementById('btn-del-profiles').onclick = () => runBatch('profile', 'delete');
document.getElementById('btn-del-proxies').onclick = () => runBatch('proxy', 'delete');

// ---------- 设置 ----------

async function loadSettings() {
  const { settings } = await api('/api/settings');
  document.getElementById('set-socks-system-proxy').value = settings.socksViaSystemProxy ? 'yes' : 'no';
  document.getElementById('set-api-url').value = apiBase() + '/';
  document.getElementById('set-api-token').value = token();
  try {
    const { version, name } = await api('/api/getVersion');
    document.getElementById('about-box').innerHTML =
      `<div><strong>${esc(name)}</strong> ${esc(version)}</div><div class="sub">本地环境 · 本地代理 · 无厂商后端</div>`;
  } catch { /* ignore */ }
  await refreshChromiumStatus();
}

async function refreshChromiumStatus() {
  try {
    state.chromium = await window.lfb.chromiumStatus();
    const el = document.getElementById('browser-status');
    const btn = document.getElementById('btn-download-browser');
    if (state.chromium.installed) {
      el.innerHTML = `<div><span class="pill ok">已安装</span></div><div class="sub" style="margin-top:6px">版本 ${esc(state.chromium.version || '')}</div>`;
      btn.disabled = true;
      btn.textContent = 'Chromium 已安装';
    } else {
      el.innerHTML = `<div><span class="pill unchecked">未安装</span></div>`;
      btn.disabled = false;
      btn.textContent = '下载 Chromium';
    }
    updateBanner();
  } catch (e) { toast('检测内核状态失败：' + e.message, true); }
}

function updateBanner() {
  const show = state.chromium && !state.chromium.installed;
  document.getElementById('browser-banner').classList.toggle('hidden', !show);
}

async function startChromiumDownload() {
  const btn = document.getElementById('btn-download-browser');
  const bar = document.getElementById('browser-progress');
  btn.disabled = true;
  bar.classList.remove('hidden');
  const fill = bar.querySelector('.bar');
  window.lfb.onChromiumProgress((p) => { fill.style.width = (p.pct || 0) + '%'; });
  try {
    const r = await window.lfb.chromiumDownload();
    if (!r.ok) throw new Error(r.error);
    toast('Chromium 下载完成');
  } catch (e) { toast('下载失败：' + e.message, true); }
  bar.classList.add('hidden');
  await refreshChromiumStatus();
}

// ---------- 事件绑定 ----------

document.querySelectorAll('.menu-item').forEach((b) => b.onclick = () => showPage(b.dataset.page));
document.getElementById('btn-refresh-profiles').onclick = loadProfiles;
document.getElementById('profile-search').oninput = () => { state.profilePage = 0; renderProfiles(); };
document.getElementById('btn-search').onclick = () => {
  showPage('profiles');
  document.getElementById('profile-search').focus();
};
document.getElementById('btn-download-browser').onclick = startChromiumDownload;
document.getElementById('btn-save-proxy-route').onclick = async () => {
  try {
    await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ socksViaSystemProxy: document.getElementById('set-socks-system-proxy').value === 'yes' }) });
    toast('代理连接设置已保存');
  } catch (e) { toast(e.message, true); }
};
document.getElementById('btn-check-update').onclick = async () => {
  const status = document.getElementById('update-status');
  status.textContent = '正在检查…';
  try {
    const info = await window.lfb.checkUpdate();
    status.textContent = info.available ? `发现新版本 ${info.latest}（当前 ${info.current}）` : `已是最新版本 ${info.current}`;
    document.getElementById('btn-install-update').classList.toggle('hidden', !info.available);
  } catch (e) { status.textContent = '检查失败'; toast(e.message, true); }
};
document.getElementById('btn-install-update').onclick = async () => {
  const button = document.getElementById('btn-install-update');
  button.disabled = true;
  document.getElementById('update-status').textContent = '正在下载并安装…';
  try { await window.lfb.installUpdate(); }
  catch (e) { button.disabled = false; document.getElementById('update-status').textContent = '安装失败'; toast(e.message, true); }
};
document.getElementById('btn-banner-download').onclick = () => { showPage('settings'); startChromiumDownload(); };
document.getElementById('btn-token-show').onclick = (e) => {
  const i = document.getElementById('set-api-token');
  i.type = i.type === 'password' ? 'text' : 'password';
  e.target.textContent = i.type === 'password' ? '显示' : '隐藏';
};
document.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => {
  const i = document.getElementById(b.dataset.copy);
  navigator.clipboard.writeText(i.value).then(() => toast('已复制'));
});
document.getElementById('btn-open-data').onclick = () => window.lfb.openDataDir();
window.lfb.dataDir?.().then((r) => {
  if (r?.ok) document.getElementById('set-data-dir').value = r.dataDir;
}).catch(() => {});

(async function init() {
  if (!window.lfb?.apiBase) {
    document.body.innerHTML = '<p style="padding:40px">无法连接本地后端服务。</p>';
    return;
  }
  try {
    state.chromium = await window.lfb.chromiumStatus();
  } catch { state.chromium = { installed: false }; }
  updateBanner();
  await loadProfiles();
  await loadProxies();
  showPage('profiles');
})();
