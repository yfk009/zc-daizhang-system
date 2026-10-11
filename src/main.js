// 应用主入口：登录（单机=选人 / 云端=账号密码）→ 头部（月份/身份/同步状态）→ 导航 → 视图挂载
import './style.css';
import { APP_NAME, VERSION } from './config.js';
import { init, getMode, getUser, setUser } from './db.js';
import { state, loadAll, setMonth, seedCustomers } from './app-state.js';
import { probe, resume, login, register, logout, switchGuard, isServerMode, getMe, pullData, importServerData, markDirty, pushData } from './api.js';
import { toast, monthNow, esc } from './ui.js';

import * as overview from './views/overview.js';
import * as kanban from './views/kanban.js';
import * as tasks from './views/tasks.js';
import * as tax from './views/tax.js';
import * as deliverables from './views/deliverables.js';
import * as cooperation from './views/cooperation.js';
import * as services from './views/services.js';
import * as clients from './views/clients.js';
import * as importer from './views/importer.js';
import * as amoeba from './views/amoeba.js';
import * as settings from './views/settings.js';
import * as admin from './views/admin.js';

const TABS = [
  { k: 'overview', label: '📊 经营总览', mod: overview, render: (r, c) => overview.render(r, c) },
  { k: 'kanban', label: '🗂️ 四周看板', mod: kanban, render: (r, c) => kanban.render(r, c) },
  { k: 'tasks', label: '✅ 任务清单', mod: tasks, render: (r, c) => tasks.render(r, c) },
  { k: 'tax', label: '💰 税金确认', mod: tax, render: (r, c) => tax.render(r, c) },
  { k: 'dlv', label: '📤 交付物', mod: deliverables, render: (r, c) => deliverables.render(r, c) },
  { k: 'coop', label: '🤝 客户配合', mod: cooperation, render: (r, c) => cooperation.render(r, c) },
  { k: 'svc', label: '🧾 增值服务', mod: services, render: (r, c) => services.render(r, c) },
  { k: 'clients', label: '👥 客户分层', mod: clients, render: (r, c) => clients.render(r, c) },
  { k: 'imp', label: '📥 数据导入', mod: importer, render: (r, c) => importer.render(r, c) },
  { k: 'amoeba', label: '🧮 阿米巴', mod: amoeba, render: (r, c) => amoeba.render(r, c) },
  { k: 'settings', label: '⚙️ 设置', mod: settings, render: (r, c) => settings.render(r, c) },
];
let curTab = 0;

const ctx = {
  jumpTask(name) { switchTab(2); const inp = document.getElementById('fSearch'); if (inp) { inp.value = name; inp.dispatchEvent(new Event('input')); } },
  refreshHeader() { renderHeader(); },
};

window.__rerender = () => { renderHeader(); mount(); };
window.__ctx = ctx;

function tabsNow() {
  // 云端管理员追加「管理」页在末尾，保持既有索引（jumpTask 等按索引跳转）不变
  if (isServerMode() && getMe() && getMe().role === 'boss') {
    return [...TABS, { k: 'admin', label: '🛰️ 云端管理', mod: admin, render: (r, c) => admin.render(r, c) }];
  }
  return TABS;
}

function renderLogin(err, mode = 'login') {
  const isReg = mode === 'reg';
  document.getElementById('app').innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#0f172a,#1e293b)">
      <div style="width:360px;max-width:92vw;background:#fff;border-radius:16px;padding:30px 28px;box-shadow:0 20px 60px rgba(0,0,0,.35)">
        <h2 style="margin:0 0 4px;font-size:20px">${APP_NAME}</h2>
        <p class="muted" style="margin:0 0 18px;font-size:13px">${isReg ? '注册新账号（凭公司邀请码，注册后自动登录）' : '云端模式 · 请使用公司账号登录（数据实时留存服务器）'}</p>
        <label>账号</label>
        <input id="lgUser" autocomplete="username" placeholder="小写字母/数字，如 xiaowang" style="width:100%">
        ${isReg ? `
        <label>姓名（与系统内成员名一致，用于任务派单显示）</label>
        <input id="lgName" placeholder="如 小王" style="width:100%">` : ''}
        <label>密码${isReg ? '（至少 6 位）' : ''}</label>
        <input id="lgPass" type="password" autocomplete="${isReg ? 'new-password' : 'current-password'}" placeholder="••••••" style="width:100%">
        ${isReg ? `
        <label>邀请码</label>
        <input id="lgInvite" inputmode="numeric" placeholder="向公司索取" style="width:100%">` : ''}
        <p id="lgErr" style="color:#b91c1c;font-size:13px;min-height:18px;margin:8px 0 4px">${err ? esc(err) : ''}</p>
        <button class="btn" id="lgGo" style="width:100%;margin-top:6px">${isReg ? '注 册 并 登 录' : '登 录'}</button>
        <p style="text-align:center;margin:12px 0 0">
          <a href="javascript:void(0)" id="lgSwitch" style="font-size:13px;color:#2563eb">${isReg ? '已有账号？返回登录' : '没有账号？用邀请码注册'}</a>
        </p>
        <p class="muted" style="font-size:12px;margin-top:10px">${isReg
          ? '邀请码即权限：管理员邀请码注册的账号拥有全部管理权限；员工邀请码注册的账号为普通权限（不能修改系统重要设置）。'
          : '员工为普通权限：任务打勾/税金确认/导入等日常操作均可，系统重要设置仅管理员可改。'}</p>
      </div>
    </div>`;
  const go = async () => {
    const u = document.getElementById('lgUser').value.trim();
    const p = document.getElementById('lgPass').value;
    const btn = document.getElementById('lgGo');
    if (!u || !p) { renderLogin('请输入账号和密码', mode); return; }
    btn.disabled = true; btn.textContent = isReg ? '注册中…' : '登录中…';
    try {
      const me = isReg
        ? await register(u, p, (document.getElementById('lgName') || {}).value?.trim() || '', (document.getElementById('lgInvite') || {}).value?.trim() || '')
        : await login(u, p);
      switchGuard(me.username);
      toast((isReg ? '注册成功，欢迎 ' : '欢迎，') + me.name + (me.role === 'boss' ? '（管理员）' : ''));
      await afterLogin();
      await boot2();
    } catch (e) {
      renderLogin(e.message || (isReg ? '注册失败' : '登录失败'), mode);
    }
  };
  document.getElementById('lgGo').onclick = go;
  document.getElementById('lgSwitch').onclick = () => renderLogin('', isReg ? 'login' : 'reg');
  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
  ['lgUser', 'lgPass', 'lgName', 'lgInvite'].forEach(id => { const el = document.getElementById(id); if (el) el.onkeydown = onKey; });
  document.getElementById('lgUser').focus();
}

let serverPkg = null; // 登录后拉到的服务器整包（无则为 null，沿用本地）
async function afterLogin() {
  const me = getMe();
  if (me) setUser({ name: me.name, boss: me.role === 'boss' }); // 各视图按 getUser().boss 判权限
  serverPkg = await pullData();
}

async function boot() {
  const { mode } = await init();
  const hasServer = await probe();
  window.addEventListener('zx:dirty', () => markDirty());
  window.addEventListener('zx:savestate', (e) => saveStateBadge(e.detail));
  if (hasServer) {
    const me = await resume();
    if (!me) { renderLogin(); return; }
    switchGuard(me.username);
    await afterLogin();
  }
  await boot2();
}

async function boot2() {
  const mode = getMode();
  if (isServerMode() && serverPkg) {
    // 服务器数据为准覆盖本地（服务器没有包时沿用本地，首次保存自动迁移上云）
    await importServerData(serverPkg);
    localStorage.setItem('zx_seed_done', '1');
  } else if (isServerMode()) {
    markDirty(); // 本地数据首迁上云
  }
  await loadAll();
  // 单机模式：仅首次打开自动播种 68 家；清空后不再自动播种（手动初始化走设置页）
  if (mode === 'local' && !isServerMode() && !localStorage.getItem('zx_seed_done')) {
    if (state.customers.length === 0) await seedCustomers();
    localStorage.setItem('zx_seed_done', '1');
  }
  if (!isServerMode() && !getUser()) setUser({ name: state.settings.ownersMap.boss || '老板', boss: true });
  document.getElementById('app').innerHTML = `
    <div id="topbar"></div>
    <main><section id="view"></section></main>
    <div class="mode-badge" id="modeBadge"></div>`;
  renderHeader();
  drawNav();
  tasks.setDeliverablesJump((clientId) => { switchTab(4); deliverables.focusClient(clientId); });
  tax.setJump((clientId) => { switchTab(4); deliverables.focusClient(clientId); });
  mount();
  updateBadge();
  const badge = document.getElementById('modeBadge');
  if (badge) badge.onclick = () => { if (isServerMode()) pushData(); };
}

/* 云端同步状态 → 底部徽标 */
function saveStateBadge(d) {
  if (!d) return updateBadge();
  if (d.state === 'pending') updateBadge('☁️ 有改动，待保存…');
  else if (d.state === 'saving') updateBadge('☁️ 保存中…');
  else if (d.state === 'saved') updateBadge(`☁️ 已保存 ${d.at ? d.at.toLocaleTimeString('zh-CN', { hour12: false }) : ''} · ${VERSION}`);
  else if (d.state === 'error') updateBadge(`⚠️ 云端保存失败：${esc(d.message || '')}（点击重试）`);
  else if (d.state === 'expired') updateBadge('⚠️ 登录已过期，请刷新页面重新登录');
}

function updateBadge(text) {
  const el = document.getElementById('modeBadge');
  if (!el) return;
  if (!isServerMode()) {
    el.textContent = `💾 单机模式（数据在本机浏览器） · ${VERSION}`;
    el.style.background = '';
    return;
  }
  if (text) { el.innerHTML = text; return; }
  const me = getMe();
  el.textContent = me ? `☁️ ${me.name}（${me.role === 'boss' ? '管理员' : '员工'}） · ${VERSION}` : `☁️ 云端模式 · ${VERSION}`;
}

function renderHeader() {
  let h = document.getElementById('hdr');
  if (!h) {
    h = document.createElement('header'); h.id = 'hdr';
    document.getElementById('topbar').appendChild(h);
  }
  const months = [];
  const now = new Date();
  for (let i = 3; i >= -2; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  let right;
  if (isServerMode()) {
    const me = getMe() || { name: '—' };
    right = `<span class="today">账号：</span><span class="user"><button class="on">${esc(me.name)}${me.role === 'boss' ? '（管理员）' : ''}</button></span>
      <button class="btn ghost sm" id="btnLogout" style="margin-left:8px">退出</button>`;
  } else {
    const u = getUser() || { name: '—' };
    right = `<span class="today">身份：</span><div class="user">${state.settings.staff.map(p => `<button class="${u.name === p.name ? 'on' : ''}" data-u="${esc(p.name)}" data-boss="${!!p.boss}">${esc(p.name)}</button>`).join('')}</div>`;
  }
  h.innerHTML = `
    <h1>${APP_NAME}</h1>
    <select id="monthSel" class="month">${months.map(m => `<option value="${m}" ${m === state.month ? 'selected' : ''}>📅 ${m} 服务循环</option>`).join('')}</select>
    <span class="spacer"></span>
    ${right}`;
  h.querySelector('#monthSel').onchange = async e => {
    setMonth(e.target.value);
    await loadAll();
    window.__rerender();
  };
  h.querySelectorAll('[data-u]').forEach(b => b.onclick = () => {
    setUser({ name: b.dataset.u, boss: b.dataset.boss === 'true' });
    renderHeader(); mount();
    toast('已切换身份：' + b.dataset.u + (b.dataset.boss === 'true' ? '（管理员）' : ''));
  });
  const lo = h.querySelector('#btnLogout');
  if (lo) lo.onclick = async () => { await logout(); location.reload(); };
}

function drawNav() {
  let nav = document.getElementById('nav');
  if (!nav) { nav = document.createElement('nav'); nav.id = 'nav'; document.getElementById('topbar').appendChild(nav); }
  const tabs = tabsNow();
  if (curTab >= tabs.length) curTab = 0;
  nav.innerHTML = tabs.map((t, i) => `<button class="${i === curTab ? 'on' : ''}" data-nav="${t.k}" data-i="${i}">${t.label}</button>`).join('');
  nav.querySelectorAll('button').forEach(b => b.onclick = () => switchTab(+b.dataset.i));
}

async function switchTab(i) {
  curTab = i;
  drawNav();
  await mount();
}

async function mount() {
  const view = document.getElementById('view');
  const tabs = tabsNow();
  const mod = tabs[curTab];
  try { await mod.render(view, ctx); }
  catch (e) { console.error(e); view.innerHTML = `<div class="panel" style="color:#b91c1c">视图加载失败：${e.message}</div>`; }
}

boot();
