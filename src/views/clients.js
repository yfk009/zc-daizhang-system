// 客户分层视图：68 家主档 + 编辑 / 调档 / 负责人 / 新增
import { esc, toast } from '../ui.js';
import { state, loadAll } from '../app-state.js';
import { store, newId } from '../db.js';
import { tierOf, TIERS } from '../templates.js';

let curTier = '';
let q = '';
let editId = null;

export function render(root, ctx) {
  const list = state.customers.filter(c =>
    (!curTier || c.tier === curTier) && (!q || c.name.includes(q)))
    .sort((a, b) => (b.revenue || 0) - (a.revenue || 0));

  root.innerHTML = `
  <div class="tiers">
    ${['S3','S2','S1'].map(t => {
      const n = state.customers.filter(c => !c.archived && c.tier === t).length;
      return `<div class="tiercard ${t.toLowerCase()}"><div class="n">${n} 家</div><div class="d">${TIERS[t].name} · ${TIERS[t].rule}</div><div class="p">${TIERS[t].monthly}</div></div>`;
    }).join('')}
  </div>
  <div class="panel">
    <div class="filters">
      <button class="btn ghost sm" data-tf="">全部 ${state.customers.filter(c=>!c.archived).length} 家</button>
      <button class="btn ghost sm" data-tf="S3">S3</button>
      <button class="btn ghost sm" data-tf="S2">S2</button>
      <button class="btn ghost sm" data-tf="S1">S1</button>
      <input id="ctSearch" placeholder="搜索客户名…" value="${esc(q)}" style="flex:1;min-width:140px">
      <button class="btn sm" id="addBtn">＋ 新增客户</button>
    </div>
    <table><thead><tr><th>客户名称</th><th>档位</th><th>2025 营业额</th><th>月记账费</th><th>月任务项</th><th>负责人</th><th>合同到期</th><th>操作</th></tr></thead>
    <tbody>${list.map(c => {
      const monthly = { S1: '3 项(批)', S2: '7 项', S3: '12 项' }[c.tier];
      return `<tr><td>${esc(c.name)}${c.archived ? ' <span class="st todo">已归档</span>' : ''}</td>
      <td><span class="tag ${c.tier}">${c.tier}${c.tierManual ? '·手' : ''}</span></td>
      <td>${c.revenue ? c.revenue.toLocaleString() : '—'}</td>
      <td>${c.monthlyFee ? '¥' + c.monthlyFee.toLocaleString() : (c.annualFee ? '¥' + c.annualFee.toLocaleString() + '/年' : '⚠️ 0')}</td>
      <td>${monthly}</td><td>${esc(c.owner || '')}</td><td>${c.contractEnd || '—'}</td>
      <td><button class="btn sm ghost" data-edit="${c._id}">编辑</button></td></tr>`;
    }).join('')}</tbody></table>
    <div class="muted" style="margin-top:8px">档位规则：按年度营业额自动划分（每年 1 月刷新），个案可手动调档（标"手"）；调档后下月任务按新档生成。</div>
  </div>
  <div class="modal-mask" id="cMask"><div class="modal">
    <h3 id="cTitle">编辑客户</h3><div id="cForm"></div>
    <div class="acts"><button class="btn ghost" id="cCancel">取消</button><button class="btn" id="cSave">保存</button></div>
  </div></div>`;

  root.querySelectorAll('[data-tf]').forEach(b => b.onclick = () => { curTier = b.dataset.tf; render(root, ctx); });
  root.querySelector('#ctSearch').oninput = e => { q = e.target.value.trim(); render(root, ctx); };
  root.querySelector('#addBtn').onclick = () => openEdit(null, ctx);
  root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEdit(b.dataset.edit, ctx));
  root.querySelector('#cCancel').onclick = () => root.querySelector('#cMask').classList.remove('on');
  root.querySelector('#cSave').onclick = save;
}

function openEdit(id, ctx) {
  editId = id;
  const c = id ? state.customers.find(x => x._id === id) : { name: '', taxNo: '', tier: 'S2', revenue: '', annualFee: '', monthlyFee: '', contact: '', phone: '', owner: '', contractStart: '', contractEnd: '', tierManual: false, archived: false };
  document.getElementById('cTitle').textContent = id ? '编辑客户' : '新增客户';
  const F = (k, label, type = 'text') => `<label style="margin:8px 0 4px;display:block">${label}</label><input id="cf_${k}" type="${type}" value="${c[k] ?? ''}" style="width:100%">`;
  document.getElementById('cForm').innerHTML = `
    ${F('name', '公司名称 *')}
    ${F('taxNo', '纳税人识别号')}
    <label style="margin:8px 0 4px;display:block">服务档位 ${c.tierManual ? '（当前为手动指定）' : ''}</label>
    <select id="cf_tier" style="width:100%">
      ${['S3','S2','S1'].map(t => `<option value="${t}" ${c.tier === t ? 'selected' : ''}>${t} · ${TIERS[t].name}</option>`).join('')}
    </select>
    <div class="switch" style="margin-top:6px"><input type="checkbox" id="cf_manual" ${c.tierManual ? 'checked' : ''}><span>手动锁定档位（不随营业额重划）</span></div>
    ${F('revenue', '2025 年营业额（元）', 'number')}
    ${F('annualFee', '年记账费（元）', 'number')}
    ${F('contact', '联系人')}${F('phone', '联系电话')}
    ${F('owner', '负责人（人名）')}
    ${F('contractStart', '合同开始（YYYY-MM-DD）', 'date')}${F('contractEnd', '合同到期（YYYY-MM-DD）', 'date')}
    <div class="switch"><input type="checkbox" id="cf_arch" ${c.archived ? 'checked' : ''}><span>归档（退出服务，不再生成任务）</span></div>`;
  document.getElementById('cMask').classList.add('on');
}

async function save() {
  const v = k => document.getElementById('cf_' + k).value.trim();
  if (!v('name')) { toast('请填写公司名称'); return; }
  let c = editId ? state.customers.find(x => x._id === editId) : { _id: newId('c'), source: '新增' };
  const newTier = v('tier');
  Object.assign(c, {
    name: v('name'), taxNo: v('taxNo'),
    tier: newTier, tierManual: document.getElementById('cf_manual').checked,
    revenue: parseFloat(v('revenue')) || 0,
    annualFee: parseFloat(v('annualFee')) || 0,
    contact: v('contact'), phone: v('phone'), owner: v('owner'),
    contractStart: v('contractStart'), contractEnd: v('contractEnd'),
    archived: document.getElementById('cf_arch').checked,
  });
  if (!c.tierManual) c.tier = tierOf(c.revenue);
  if (!c.owner) c.owner = c.tier === 'S1' ? (state.settings.ownersMap.assist || '') : (state.settings.ownersMap.lead || '');
  if (!c.ownerRole) c.ownerRole = c.tier === 'S1' ? 'assist' : 'lead';
  await store.upsert('customers', c);
  await loadAll();
  document.getElementById('cMask').classList.remove('on');
  toast('✓ 已保存：' + c.name);
  window.__rerender?.();
}
