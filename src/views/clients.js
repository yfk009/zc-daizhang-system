// 客户分层视图：68 家主档 + 编辑 / 调档 / 负责人 / 新增
import { esc, toast } from '../ui.js';
import { state, loadAll } from '../app-state.js';
import { store, newId } from '../db.js';
import { inferTier, TIERS, TIER_ORDER } from '../templates.js';

let curTier = '';
let q = '';
let editId = null;
let editOwners = []; // 编辑中的负责团队（首位=主负责人）

export function render(root, ctx) {
  const list = state.customers.filter(c =>
    (!curTier || c.tier === curTier) && (!q || c.name.includes(q)))
    .sort((a, b) => (b.revenue || 0) - (a.revenue || 0));

  root.innerHTML = `
  <div class="tiers">
    ${TIER_ORDER.map(t => {
      const n = state.customers.filter(c => !c.archived && c.tier === t).length;
      return `<div class="tiercard ${t.toLowerCase()}"><div class="n">${n} 家</div><div class="d">${TIERS[t].name} · ${TIERS[t].rule}</div><div class="p">${TIERS[t].monthly}<br>一口价 ¥${TIERS[t].price}/月</div></div>`;
    }).join('')}
  </div>
  <div class="panel">
    <div class="filters">
      <button class="btn ghost sm" data-tf="">全部 ${state.customers.filter(c=>!c.archived).length} 家</button>
      ${TIER_ORDER.map(t => `<button class="btn ghost sm" data-tf="${t}">${t}</button>`).join('')}
      <input id="ctSearch" placeholder="搜索客户名…" value="${esc(q)}" style="flex:1;min-width:140px">
      <button class="btn sm" id="addBtn">＋ 新增客户</button>
    </div>
    <table><thead><tr><th>客户名称</th><th>档位</th><th>纳税人身份</th><th>年营业额</th><th>月记账费</th><th>年记账费</th><th>负责人</th><th>合同到期</th><th>操作</th></tr></thead>
    <tbody>${list.map(c => {
      const tt = c.taxpayerType === 'general' ? '一般纳税人' : (c.taxpayerType === 'small' ? '小规模' : '未设置');
      const owners = Array.isArray(c.owners) && c.owners.length ? c.owners : (c.owner ? [c.owner] : []);
      return `<tr><td>${esc(c.name)}${c.archived ? ' <span class="st todo">已归档</span>' : ''}</td>
      <td><span class="tag ${c.tier}">${c.tier}${c.tierManual ? '·手' : ''}</span></td>
      <td>${tt}</td>
      <td>${c.revenue ? c.revenue.toLocaleString() : '—'}</td>
      <td>${c.monthlyFee ? '¥' + c.monthlyFee.toLocaleString() : '—'}</td>
      <td>${c.annualFee ? '¥' + c.annualFee.toLocaleString() : '—'}</td>
      <td>${owners.length ? owners.map(esc).join('、') : '<span class="muted">未指定</span>'}</td><td>${c.contractEnd || '—'}</td>
      <td><button class="btn sm ghost" data-edit="${c._id}">编辑</button></td></tr>`;
    }).join('')}</tbody></table>
    <div class="muted" style="margin-top:8px">档位规则（4.0 五档）：零申报→S1 托管；小规模有经营→S2；一般纳税人按年营业额 ≤500万→S3、500–1000万→S4、1000–3000万→S5，一口价无折扣。营业额缺失时按 纳税人身份→记账费档位→默认零申报 自动判档。每年 1 月按上年营业额统一重划，个案可手动调档（标"手"）；调档后下月任务按新档生成。</div>
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
  const c = id ? state.customers.find(x => x._id === id) : { name: '', taxNo: '', tier: 'S2', taxpayerType: 'small', revenue: '', annualFee: '', monthlyFee: '', contact: '', phone: '', owner: '', owners: [], contractStart: '', contractEnd: '', tierManual: false, archived: false };
  editOwners = Array.isArray(c.owners) && c.owners.length ? [...c.owners] : (c.owner ? [c.owner] : []);
  document.getElementById('cTitle').textContent = id ? '编辑客户' : '新增客户';
  const F = (k, label, type = 'text') => `<label style="margin:8px 0 4px;display:block">${label}</label><input id="cf_${k}" type="${type}" value="${c[k] ?? ''}" style="width:100%">`;
  document.getElementById('cForm').innerHTML = `
    ${F('name', '公司名称 *')}
    ${F('taxNo', '纳税人识别号')}
    <label style="margin:8px 0 4px;display:block">纳税人身份</label>
    <select id="cf_taxpayerType" style="width:100%">
      <option value="small" ${c.taxpayerType !== 'general' ? 'selected' : ''}>小规模纳税人（含个体户/个独）</option>
      <option value="general" ${c.taxpayerType === 'general' ? 'selected' : ''}>一般纳税人</option>
    </select>
    <label style="margin:8px 0 4px;display:block">服务档位 ${c.tierManual ? '（当前为手动指定）' : ''}</label>
    <select id="cf_tier" style="width:100%">
      ${TIER_ORDER.map(t => `<option value="${t}" ${c.tier === t ? 'selected' : ''}>${t} · ${TIERS[t].name} · ¥${TIERS[t].price}/月</option>`).join('')}
    </select>
    <div class="switch" style="margin-top:6px"><input type="checkbox" id="cf_manual" ${c.tierManual ? 'checked' : ''}><span>手动锁定档位（不随营业额重划）</span></div>
    ${F('revenue', '年营业额（元）', 'number')}
    ${F('annualFee', '年记账费（元）', 'number')}
    <label style="margin:8px 0 4px;display:block">月记账费（自动核算 = 年记账费 ÷ 12）</label>
    <input id="cf_monthly" type="number" readonly style="width:100%;background:#f8fafc;color:#475569">
    ${F('contact', '联系人')}${F('phone', '联系电话')}
    <label style="margin:8px 0 4px;display:block">负责团队（可多人；首位为主负责人，任务「谁服务谁做」按主负责人派单）</label>
    <div id="cf_ownerChips" style="display:flex;flex-wrap:wrap;gap:6px;min-height:26px"></div>
    <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;align-items:center">
      <select id="cf_ownerSel" style="flex:1;min-width:120px">
        <option value="">从团队选择…</option>
        ${state.settings.staff.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('')}
      </select>
      <button class="btn ghost sm" id="cf_ownerSelAdd" type="button">＋加入</button>
    </div>
    <div style="display:flex;gap:8px;margin-top:6px;align-items:center">
      <input id="cf_ownerInput" placeholder="手动添加人员姓名（回车或点按钮，如外协/新同事）" style="flex:1">
      <button class="btn ghost sm" id="cf_ownerAdd" type="button">＋手动添加</button>
    </div>
    ${F('contractStart', '合同开始（YYYY-MM-DD）', 'date')}${F('contractEnd', '合同到期（YYYY-MM-DD）', 'date')}
    <div class="switch"><input type="checkbox" id="cf_arch" ${c.archived ? 'checked' : ''}><span>归档（退出服务，不再生成任务）</span></div>`;
  const syncMonthly = () => {
    const a = parseFloat(document.getElementById('cf_annualFee').value) || 0;
    document.getElementById('cf_monthly').value = a > 0 ? Math.round(a / 12 * 100) / 100 : '';
  };
  syncMonthly();
  document.getElementById('cf_annualFee').oninput = syncMonthly;
  // 负责团队：chips 渲染 + 团队下拉加入 + 手动添加
  function drawOwnerChips() {
    const box = document.getElementById('cf_ownerChips');
    if (!box) return;
    box.innerHTML = editOwners.length
      ? editOwners.map((n, i) => `<span style="display:inline-flex;align-items:center;gap:6px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:999px;padding:3px 10px;font-size:13px">${esc(n)}${i === 0 ? '<b style="color:#1d4ed8;font-size:11px">主</b>' : ''}<a href="javascript:void(0)" data-od="${i}" style="color:#b91c1c;text-decoration:none;font-weight:bold">×</a></span>`).join('')
      : '<span class="muted" style="font-size:13px">（暂无，添加后保存生效）</span>';
    box.querySelectorAll('[data-od]').forEach(a => a.onclick = () => { editOwners.splice(+a.dataset.od, 1); drawOwnerChips(); });
  }
  function addOwner(raw) {
    const name = (raw || '').trim();
    if (!name) return;
    if (editOwners.includes(name)) { toast(name + ' 已在负责团队中'); return; }
    editOwners.push(name);
    drawOwnerChips();
  }
  drawOwnerChips();
  document.getElementById('cf_ownerSelAdd').onclick = () => {
    const sel = document.getElementById('cf_ownerSel');
    if (!sel.value) { toast('请先在下拉中选择团队成员'); return; }
    addOwner(sel.value);
    sel.value = '';
  };
  document.getElementById('cf_ownerAdd').onclick = () => {
    const inp = document.getElementById('cf_ownerInput');
    addOwner(inp.value);
    inp.value = '';
  };
  document.getElementById('cf_ownerInput').onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addOwner(e.target.value); e.target.value = ''; }
  };
  document.getElementById('cMask').classList.add('on');
}

async function save() {
  const v = k => document.getElementById('cf_' + k).value.trim();
  if (!v('name')) { toast('请填写公司名称'); return; }
  let c = editId ? state.customers.find(x => x._id === editId) : { _id: newId('c'), source: '新增' };
  const annualFee = parseFloat(v('annualFee')) || 0;
  Object.assign(c, {
    name: v('name'), taxNo: v('taxNo'),
    taxpayerType: v('taxpayerType') || 'small',
    tier: v('tier'), tierManual: document.getElementById('cf_manual').checked,
    revenue: parseFloat(v('revenue')) || 0,
    annualFee,
    monthlyFee: annualFee > 0 ? Math.round(annualFee / 12 * 100) / 100 : 0,
    contact: v('contact'), phone: v('phone'),
    owners: editOwners.slice(),
    owner: editOwners[0] || '',
    contractStart: v('contractStart'), contractEnd: v('contractEnd'),
    archived: document.getElementById('cf_arch').checked,
  });
  if (!c.tierManual) {
    // 未锁档重判走统一引擎（身份>营业额>记账费>默认），避免空营业额客户被 tierOf 打回 S1
    const judged = inferTier(c);
    c.tier = judged.tier;
    c.taxpayerType = judged.taxpayerType;
    c.tierReason = judged.reason;
  }
  const omv = c.tier === 'S1' ? state.settings.ownersMap.assist : state.settings.ownersMap.lead;
  if (!c.owner) {
    const o = (omv && !String(omv).startsWith('__')) ? omv : '';
    if (o) { c.owner = o; c.owners = [o]; }
  }
  if (!c.ownerRole) c.ownerRole = c.tier === 'S1' ? 'assist' : 'lead';
  await store.upsert('customers', c);
  await loadAll();
  document.getElementById('cMask').classList.remove('on');
  toast('✓ 已保存：' + c.name);
  window.__rerender?.();
}
