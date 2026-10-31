'use strict';
const config = window.cikeEnvironment;
const text = (id, value) => { document.getElementById(id).textContent = value || '未知'; };
text('name', config.name); text('number', '#' + config.sequence);
document.title = `#${config.sequence} ${config.name} · 环境检测`;
text('route', config.proxy ? '代理连接' : '系统网络');
text('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone); text('language', navigator.language);
async function getJSON(url) {
  const response = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('检测服务暂时不可用');
  return response.json();
}
async function detect() {
  const button = document.getElementById('refresh'); button.disabled = true;
  text('ip', '检测中…'); text('status', '通过当前环境的网络连接检测');
  for (const id of ['region', 'exit-timezone', 'isp']) text(id, '等待检测');
  document.getElementById('match').textContent = '';
  try {
    const { ip } = await getJSON('https://api.ipify.org?format=json');
    if (typeof ip !== 'string' || !/^[0-9a-fA-F.:]{3,45}$/.test(ip)) throw new Error('IP 检测响应无效');
    text('ip', ip); text('status', '检测成功 · ' + new Date().toLocaleTimeString());
    if (config.expectedIp && config.expectedIp !== ip) text('match', `当前出口与启动前检测的 ${config.expectedIp} 不同，请检查代理是否使用动态出口。`);
    await fetch('/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip }) });
    try {
      const geo = await getJSON('https://ipwho.is/' + encodeURIComponent(ip));
      if (geo.success === false || geo.ip !== ip) throw new Error('地区未知');
      text('region', [geo.country, geo.region, geo.city].filter(Boolean).join(' · '));
      text('exit-timezone', geo.timezone?.id); text('isp', geo.connection?.isp);
      if (geo.timezone?.id && geo.timezone.id !== Intl.DateTimeFormat().resolvedOptions().timeZone) text('match', '浏览器时区与出口地区时区不同，请检查环境时区设置。地区数据库可能存在误差。');
    } catch { for (const id of ['region', 'exit-timezone', 'isp']) text(id, '地区服务暂不可用'); }
  } catch { text('ip', '检测失败'); text('status', '请检查网络或代理后重新检测；不会切换为直连。'); }
  finally { button.disabled = false; }
}
document.getElementById('refresh').onclick = detect;
detect();
