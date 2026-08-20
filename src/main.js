// 应用主入口：登录态（单机=选人）→ 头部（月份/身份）→ 导航 → 视图挂载
import './style.css';
import { APP_NAME, VERSION } from './config.js';
import { init, getMode, getUser, setUser } from './db.js';
import { state, loadAll, setMonth, seedCustomers } from './app-state.js';
import { toast, monthNow, esc } from './ui.js';

import * as overview from './views/overview.js';
import * as kanban from './views/kanban.js';
import * as tasks from './views/tasks.js';
import * as tax from './views/tax.js';
import * as deliverables from './views/deliverables.js';
import * as clients from './views/clients.js';
import * as importer from './views/importer.js';
import * as amoeba from './views/amoeba.js';
import * as settings from './views/settings.js';

const TABS = [
  { k: 'overview', label: '📊 经营总览', mod: overview, render: (r, c) => overview.render(r, c) },
  { k: 'kanban', label: '🗂️ 四周看板', mod: kanban, render: (r, c) => kanban.render(r, c) },
  { k: 'tasks', label: '✅ 任务清单', mod: tasks, render: (r, c) => tasks.render(r, c) },
  { k: 'tax', label: '💰 税金确认', mod: tax, render: (r, c) => tax.render(r, c) },
  { k: 'dlv', label: '📤 交付物', mod: deliverables, render: (r, c) => deliverables.render(r, c) },
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

async function boot() {
  const { mode } = await init();
  await loadAll();
  // 单机模式：仅首次打开自动播种 68 家；清空后不再自动播种（手动初始化走设置页）
  if (mode === 'local' && !localStorage.getItem('zx_seed_done')) {
    if (state.customers.length === 0) await seedCustomers();
    localStorage.setItem('zx_seed_done', '1');
  }
  if (!getUser()) setUser({ name: state.settings.ownersMap.boss || '老板', boss: true });
  document.getElementById('app').innerHTML = `
    <div id="topbar"></div>
    <main><section id="view"></section></main>
    <div class="mode-badge">${mode === 'cloud' ? '☁️ 云端模式' : '💾 单机模式（数据在本机浏览器）'} · ${VERSION}</div>`;
  renderHeader();
  drawNav();
  tasks.setDeliverablesJump((clientId) => { switchTab(4); deliverables.focusClient(clientId); });
  tax.setJump((clientId) => { switchTab(4); deliverables.focusClient(clientId); });
  mount();
}

function renderHeader() {
  let h = document.getElementById('hdr');
  if (!h) {
    h = document.createElement('header'); h.id = 'hdr';
    document.getElementById('topbar').appendChild(h);
  }
  const u = getUser() || { name: '—' };
  const months = [];
  const now = new Date();
  for (let i = 3; i >= -2; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  h.innerHTML = `
    <h1>${APP_NAME}</h1>
    <select id="monthSel" class="month">${months.map(m => `<option value="${m}" ${m === state.month ? 'selected' : ''}>📅 ${m} 服务循环</option>`).join('')}</select>
    <span class="spacer"></span>
    <span class="today">身份：</span>
    <div class="user">${state.settings.staff.map(p => `<button class="${u.name === p.name ? 'on' : ''}" data-u="${esc(p.name)}" data-boss="${!!p.boss}">${esc(p.name)}</button>`).join('')}</div>`;
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
}

function drawNav() {
  let nav = document.getElementById('nav');
  if (!nav) { nav = document.createElement('nav'); nav.id = 'nav'; document.getElementById('topbar').appendChild(nav); }
  nav.innerHTML = TABS.map((t, i) => `<button class="${i === curTab ? 'on' : ''}" data-nav="${t.k}" data-i="${i}">${t.label}</button>`).join('');
  nav.querySelectorAll('button').forEach(b => b.onclick = () => switchTab(+b.dataset.i));
}

async function switchTab(i) {
  curTab = i;
  drawNav();
  await mount();
}

async function mount() {
  const view = document.getElementById('view');
  const mod = TABS[curTab];
  try { await mod.render(view, ctx); }
  catch (e) { console.error(e); view.innerHTML = `<div class="panel" style="color:#b91c1c">视图加载失败：${e.message}</div>`; }
}

boot();
