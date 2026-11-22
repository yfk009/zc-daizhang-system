// 税金确认跟踪：金额录入 → 发送 → 客户确认 → 解锁申报
import { el, esc, toast } from '../ui.js';
import { state, reloadMonth, taxOf, finOf, prevDataMonth, getUser } from '../app-state.js';
import { store } from '../db.js';
import { OTHER_TAXES, othersSum, partsSum } from '../taxkit.js';

let editClient = null;
// 弹窗内「其他税种」临时编辑副本（点保存才写回 tc.amounts.others）
let mOthers = [];

export function render(root, ctx) {
  const actives = state.customers.filter(c => !c.archived && c.tier !== 'S1')
    .sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
  const dm = prevDataMonth();

  const blocked = actives.filter(c => {
    const tc = taxOf(c._id);
    return (!tc || tc.state !== 'confirmed') ;
  }).length;

  root.innerHTML = `
  <div class="banner">⚠️ <b>铁律：客户未确认，不申报。</b>&nbsp;当前 <b>${blocked}</b> 户未确认；客户 24 小时未回复 → 电话确认；征期最后一天仍未回复 → 老板裁决。
    <span class="muted">（账务数据月：${dm}，可先在「数据导入」带入金蝶数据）</span></div>
  <div class="panel">
    <h3>💰 ${state.month} 税金确认跟踪（S2–S5 共 ${actives.length} 户）</h3>
    <table id="taxTable"><thead><tr>
      <th>客户</th><th>档位</th><th>增值税</th><th>附加税</th><th>个税</th><th>企税预缴</th><th>印花税</th><th style="min-width:180px">其他税种</th><th>合计应缴</th><th>状态</th><th>确认信息</th><th style="width:230px">操作</th>
    </tr></thead><tbody>
    ${actives.map(c => rowHtml(c, dm)).join('')}
    </tbody></table>
    <div class="muted" style="margin-top:10px">💡 印花税与其它税项经「录入金额」弹窗填写；「其他税种」列可在行内下拉添加（可多项），金额改完自动并入合计应缴；已确认行锁定不可改。</div>
  </div>
  <div class="modal-mask" id="taxMask"><div class="modal">
    <h3>✏️ 录入税金金额</h3><div class="info" id="tmInfo"></div>
    <div id="tmInputs"></div>
    <div id="tmOthers"></div>
    <div class="acts">
      <button class="btn ghost" id="tmCancel">取消</button>
      <button class="btn" id="tmSave">保存</button>
    </div>
  </div></div>`;

  root.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => act(b.dataset, ctx));
  wireInlineOthers(root);
  root.querySelector('#tmCancel').onclick = () => root.querySelector('#taxMask').classList.remove('on');
  root.querySelector('#tmSave').onclick = saveAmounts;
}

/* ---------- 其他税种：行内下拉添加/删除/改额，自动并入合计 ---------- */
function othersCellHtml(c, tc, locked) {
  const a = (tc && tc.amounts) || null;
  const others = (a && a.others) || [];
  const opts = OTHER_TAXES.filter(n => !others.find(o => o.name === n));
  const sel = `<select class="otadd" data-id="${c._id}" ${locked || !opts.length ? 'disabled' : ''}>
    <option value="">＋ 其他税种</option>${opts.map(n => `<option>${n}</option>`).join('')}</select>`;
  if (locked) {
    return others.length
      ? others.map(o => `<div class="otrow"><span class="otname">${esc(o.name)}</span><span class="otamt-txt">¥${(+o.amt || 0).toLocaleString()}</span></div>`).join('')
      : '<span class="muted">—</span>';
  }
  const rows = others.map((o, i) => `<div class="otrow" data-i="${i}">
      <span class="otname">${esc(o.name)}</span>
      <input class="otamt" type="number" data-id="${c._id}" data-i="${i}" value="${o.amt ?? ''}" placeholder="元">
      <button class="otdel" data-id="${c._id}" data-i="${i}" title="删除">✕</button>
    </div>`).join('');
  return rows + sel;
}

function wireInlineOthers(root) {
  // 下拉选中 → 加入该户（自动建档、并入合计、即时保存）
  root.querySelectorAll('#taxTable select.otadd').forEach(sel => sel.onchange = async () => {
    const name = sel.value; if (!name) return;
    const c = state.customers.find(x => x._id === sel.dataset.id);
    if (!c) return;
    const tc = ensureTax(c);
    if (!tc.amounts) tc.amounts = { vat: 0, sur: 0, it: 0, cit: 0, stamp: 0, total: 0, others: [] };
    tc.amounts.others = tc.amounts.others || [];
    if (!tc.amounts.others.find(o => o.name === name)) tc.amounts.others.push({ name, amt: 0 });
    if (tc.state === 'draft') tc.state = 'ready';
    await store.upsert('taxConfirm', tc);
    await reloadMonth();
    render(document.getElementById('view'), window.__ctx);
    toast(`${name} 已添加，请填金额`);
  });
  // 金额改动 → 差额并入合计应缴，就地更新不整页刷
  root.querySelectorAll('#taxTable input.otamt').forEach(inp => inp.onchange = async () => {
    const tc = taxOf(inp.dataset.id);
    const o = ((tc && tc.amounts && tc.amounts.others) || [])[+inp.dataset.i];
    if (!o) return;
    const old = +o.amt || 0, nv = parseFloat(inp.value) || 0;
    o.amt = nv;
    tc.amounts.total = Math.max(0, (+tc.amounts.total || 0) - old + nv);
    await store.upsert('taxConfirm', tc);
    const td = inp.closest('tr').querySelector('.taxtotal');
    if (td) td.textContent = '¥' + Number(tc.amounts.total).toLocaleString();
    toast(`${o.name} 已并入合计`);
  });
  // ✕ 删除 → 扣回合计；若删完全空则回退草稿态
  root.querySelectorAll('#taxTable button.otdel').forEach(btn => btn.onclick = async () => {
    const tc = taxOf(btn.dataset.id);
    if (!tc || !tc.amounts) return;
    const i = +btn.dataset.i, arr = tc.amounts.others || [];
    const o = arr[i]; if (!o) return;
    const old = +o.amt || 0;
    arr.splice(i, 1);
    tc.amounts.total = Math.max(0, (+tc.amounts.total || 0) - old);
    maybeResetAmounts(tc);
    await store.upsert('taxConfirm', tc);
    await reloadMonth();
    render(document.getElementById('view'), window.__ctx);
    toast(`${o.name} 已移除`);
  });
}

// 全空（且非金蝶合计-only）则回退草稿、amounts 置空
function maybeResetAmounts(tc) {
  if (tc.sentAt || tc.state === 'confirmed') return;
  const a = tc.amounts || {};
  if ((a.others || []).length) return;
  if (+a.vat || +a.sur || +a.it || +a.cit || +a.stamp || +a.total) return;
  tc.amounts = null;
  if (tc.state === 'ready') tc.state = 'draft';
}

// 已录金额一律显示数值（输 0 也显示 ¥0，不再显示横杠）；整行未录金额才显示 —
const money = v => '¥' + (+v || 0).toLocaleString();

function rowHtml(c, dm) {
  const tc = taxOf(c._id);
  const fin = finOf(c._id, dm);
  const a = (tc && tc.amounts) || null;
  const locked = tc && tc.state === 'confirmed';
  const total = a ? a.total : (fin ? fin.taxTotal : null);
  const importTag = (!a && fin && fin.taxTotal) ? '<div class="muted">↳ 金蝶导入合计</div>' : '';
  let stHtml, acts = [];
  if (!tc || (!tc.amounts && !tc.sentAt)) {
    stHtml = `<span class="st todo">${fin && fin.taxTotal ? '待发送' : '待录入'}</span>`; // 按钮由下方通用分支给（未录=录入金额，已录=改金额）
  } else if (tc.state === 'confirmed') {
    stHtml = `<span class="st done">已确认</span>`;
  } else if (tc.sentAt) {
    stHtml = `<span class="st ${tc.overdueFlag ? 'overdue' : 'todo'}">已发送 · 待回复</span>`;
    acts.push(`<button class="btn sm" data-act="confirm" data-id="${c._id}">✓ 客户已确认</button>`);
  } else {
    stHtml = `<span class="st todo">待发送</span>`;
  }
  if (!tc || tc.state !== 'confirmed') {
    if (tc && tc.amounts && !tc.sentAt) acts.push(`<button class="btn sm" data-act="sent" data-id="${c._id}">已发群</button>`);
    acts.push(`<button class="btn sm ghost" data-act="edit" data-id="${c._id}">${a ? '改金额' : '录入金额'}</button>`);
  }
  acts.push(`<button class="btn sm ghost" data-act="dlv" data-id="${c._id}">生成确认单</button>`);
  const confInfo = tc && tc.state === 'confirmed'
    ? `${tc.confirmAt || ''} ${esc(tc.confirmBy || '')}${tc.confirmNote ? '<br>' + esc(tc.confirmNote) : ''}` : '—';

  return `<tr class="${tc && tc.sentAt && tc.state !== 'confirmed' ? 'blocked' : ''}">
    <td>${esc(c.name)}</td><td><span class="tag ${c.tier}">${c.tier}</span></td>
    <td>${a ? money(a.vat) : '—'}</td>
    <td>${a ? money(a.sur) : '—'}</td>
    <td>${a ? money(a.it) : '—'}</td>
    <td>${a ? money(a.cit) : '—'}</td>
    <td>${a ? money(a.stamp) : '—'}</td>
    <td class="otcell">${othersCellHtml(c, tc, locked)}</td>
    <td><b class="taxtotal" style="color:#b91c1c">${total != null ? '¥' + Number(total).toLocaleString() : '—'}</b>${importTag}</td>
    <td>${stHtml}</td><td class="muted">${confInfo}</td><td>${acts.join(' ')}</td></tr>`;
}

async function act(ds, ctx) {
  const c = state.customers.find(x => x._id === ds.id);
  if (ds.act === 'edit') openEdit(c);
  if (ds.act === 'sent') {
    const tc = ensureTax(c);
    tc.sentAt = new Date().toISOString().slice(0, 10);
    await store.upsert('taxConfirm', tc);
    await reloadMonth(); render(document.getElementById('view'), ctx); ctx.refreshHeader?.();
    toast('已登记发送，等待客户回复');
  }
  if (ds.act === 'confirm') {
    const tc = ensureTax(c);
    const note = window.prompt ? '' : '';
    openConfirmDialog(c, tc, note);
  }
  if (ds.act === 'dlv') { jumpDlv(c._id); }
}
let _jump = null;
export function setJump(fn){ _jump = fn; }
function jumpDlv(clientId){ if (_jump) _jump(clientId); }

function ensureTax(c) {
  let tc = taxOf(c._id);
  if (!tc) {
    tc = { _id: `x_${state.month}_${c._id}`, month: state.month, clientId: c._id, clientName: c.name, state: 'draft', amounts: null };
    state.tax.push(tc);
  }
  return tc;
}

// 客户确认弹窗（备注可留空）
function openConfirmDialog(c, tc, presetNote) {
  const root = document.getElementById('view');
  let mask = document.getElementById('cfMask');
  if (mask) mask.remove();
  mask = document.createElement('div');
  mask.id = 'cfMask'; mask.className = 'modal-mask on';
  mask.innerHTML = `<div class="modal">
    <h3>✓ 客户确认税金</h3>
    <div class="info"><b>${c.name}</b> ｜ 本月合计 <b style="color:#b91c1c">¥${(tc.amounts?.total || 0).toLocaleString()}</b><br>确认后该户申报任务自动解锁。</div>
    <label>确认方式/备注（可留空）</label>
    <input id="cfNote" placeholder="如：微信回复确认 / 电话确认" style="width:100%" value="${presetNote || ''}">
    <div class="acts"><button class="btn ghost" id="cfCancel">取消</button><button class="btn" id="cfOk">确认</button></div>
  </div>`;
  root.appendChild(mask);
  mask.querySelector('#cfCancel').onclick = () => mask.remove();
  mask.querySelector('#cfOk').onclick = async () => {
    tc.state = 'confirmed';
    tc.confirmAt = new Date().toISOString().slice(0, 10);
    tc.confirmBy = (getUser() || {}).name || '';
    tc.confirmNote = mask.querySelector('#cfNote').value.trim();
    await store.upsert('taxConfirm', tc);
    await reloadMonth();
    mask.remove();
    render(document.getElementById('view'), window.__ctx);
    window.__ctx?.refreshHeader?.();
    toast(`✓ ${c.name} 已确认，申报任务解锁`);
  };
}

function updateModalTotal() {
  const s = ['vat', 'sur', 'it', 'cit', 'stamp'].reduce((acc, k) => {
    const inp = document.getElementById('amt_' + k);
    return acc + (inp ? (parseFloat(inp.value) || 0) : 0);
  }, 0) + othersSum({ others: mOthers });
  const t = document.getElementById('amt_total');
  if (t) t.value = s || '';
}

function drawModalOthers() {
  const box = document.getElementById('tmOthers');
  if (!box) return;
  const opts = OTHER_TAXES.filter(n => !mOthers.find(o => o.name === n));
  box.innerHTML = `<label style="margin:8px 0 4px;display:block">其他税种（下拉添加，可多项）</label>` +
    mOthers.map((o, i) => `
      <div class="otrow">
        <span class="otname">${esc(o.name)}</span>
        <input class="otamt" type="number" data-i="${i}" value="${o.amt ?? ''}" placeholder="元">
        <button class="otdel" type="button" data-i="${i}">✕</button>
      </div>`).join('') + `
    <select id="otAddSel" style="margin-top:6px;width:100%">
      <option value="">＋ 添加其他税种…</option>
      ${opts.map(n => `<option>${n}</option>`).join('')}
    </select>`;
  // 金额输入 → 更新副本并刷新合计建议
  box.querySelectorAll('input.otamt').forEach(inp => inp.oninput = () => {
    const o = mOthers[+inp.dataset.i]; if (!o) return;
    o.amt = parseFloat(inp.value) || 0;
    updateModalTotal();
  });
  // ✕ 移除 → 重绘 + 刷新合计
  box.querySelectorAll('button.otdel').forEach(btn => btn.onclick = () => {
    mOthers.splice(+btn.dataset.i, 1);
    drawModalOthers();
    updateModalTotal();
  });
  // 下拉添加 → 重绘 + 刷新合计
  const sel = box.querySelector('#otAddSel');
  if (sel) sel.onchange = () => {
    const name = sel.value; if (!name) return;
    mOthers.push({ name: name, amt: 0 });
    drawModalOthers();
    updateModalTotal();
  };
}

function openEdit(c) {
  editClient = c;
  const tc = taxOf(c._id);
  const a = (tc && tc.amounts) || { vat: '', sur: '', it: '', cit: '', stamp: '', total: '' };
  mOthers = ((tc && tc.amounts && tc.amounts.others) || []).map(o => ({ name: o.name, amt: o.amt }));
  document.getElementById('tmInfo').innerHTML = `客户：<b>${esc(c.name)}</b> ｜ ${c.tier} ｜ 服务月 ${state.month}`;
  document.getElementById('tmInputs').innerHTML = ['vat|增值税', 'sur|城建税及附加', 'it|个人所得税', 'cit|企业所得税（预缴）', 'stamp|印花税', 'total|合计应缴'].map(f => {
    const [k, label] = f.split('|');
    return `<label style="margin:8px 0 4px">${label}（元）</label><input type="number" id="amt_${k}" value="${a[k] ?? ''}" style="width:100%">`;
  }).join('') + `<div class="muted" style="margin-top:8px">提示：合计=各项之和可自动算；金蝶导入的税金合计可在「数据导入」带入。</div>`;
  document.getElementById('taxMask').classList.add('on');
  // 自动求和
  ['vat','sur','it','cit','stamp'].forEach(k => {
    document.getElementById('amt_' + k).oninput = updateModalTotal;
  });
  drawModalOthers();
}
async function saveAmounts() {
  if (!editClient) return;
  const tc = ensureTax(editClient);
  tc.amounts = {};
  ['vat','sur','it','cit','stamp','total'].forEach(k => { tc.amounts[k] = parseFloat(document.getElementById('amt_' + k).value) || 0; });
  tc.amounts.others = mOthers.filter(o => o.name);
  // 合计留空或 0 时自动取各项之和（全 0 记录同样允许保存——输什么存什么）
  if (!+tc.amounts.total) tc.amounts.total = partsSum(tc.amounts);
  if (tc.state === 'draft') tc.state = 'ready';
  await store.upsert('taxConfirm', tc);
  await reloadMonth();
  document.getElementById('taxMask').classList.remove('on');
  render(document.getElementById('view'), window.__ctx);
  toast('金额已保存，可生成确认单发群');
}
