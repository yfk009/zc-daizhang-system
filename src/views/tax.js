// 税金确认跟踪：金额录入 → 发送 → 客户确认 → 解锁申报
import { el, esc, toast } from '../ui.js';
import { state, reloadMonth, taxOf, finOf, prevDataMonth, getUser } from '../app-state.js';
import { store } from '../db.js';

let editClient = null;

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
    <h3>💰 ${state.month} 税金确认跟踪（S2+S3 共 ${actives.length} 户）</h3>
    <table id="taxTable"><thead><tr>
      <th>客户</th><th>档位</th><th>增值税</th><th>附加税</th><th>个税</th><th>企税预缴</th><th>合计应缴</th><th>状态</th><th>确认信息</th><th style="width:230px">操作</th>
    </tr></thead><tbody>
    ${actives.map(c => rowHtml(c, dm)).join('')}
    </tbody></table>
  </div>
  <div class="modal-mask" id="taxMask"><div class="modal">
    <h3>✏️ 录入税金金额</h3><div class="info" id="tmInfo"></div>
    <div id="tmInputs"></div>
    <div class="acts">
      <button class="btn ghost" id="tmCancel">取消</button>
      <button class="btn" id="tmSave">保存</button>
    </div>
  </div></div>`;

  root.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => act(b.dataset, ctx));
  root.querySelector('#tmCancel').onclick = () => root.querySelector('#taxMask').classList.remove('on');
  root.querySelector('#tmSave').onclick = saveAmounts;
}

function rowHtml(c, dm) {
  const tc = taxOf(c._id);
  const fin = finOf(c._id, dm);
  const a = (tc && tc.amounts) || null;
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
    <td>${a && a.vat ? '¥' + a.vat.toLocaleString() : '—'}</td>
    <td>${a && a.sur ? '¥' + a.sur.toLocaleString() : '—'}</td>
    <td>${a && a.it ? '¥' + a.it.toLocaleString() : '—'}</td>
    <td>${a && a.cit ? '¥' + a.cit.toLocaleString() : '—'}</td>
    <td><b style="color:#b91c1c">${total != null ? '¥' + Number(total).toLocaleString() : '—'}</b>${importTag}</td>
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

function openEdit(c) {
  editClient = c;
  const tc = taxOf(c._id);
  const a = (tc && tc.amounts) || { vat: '', sur: '', it: '', cit: '', total: '' };
  document.getElementById('tmInfo').innerHTML = `客户：<b>${esc(c.name)}</b> ｜ ${c.tier} ｜ 服务月 ${state.month}`;
  document.getElementById('tmInputs').innerHTML = ['vat|增值税', 'sur|城建税及附加', 'it|个人所得税', 'cit|企业所得税（预缴）', 'total|合计应缴'].map(f => {
    const [k, label] = f.split('|');
    return `<label style="margin:8px 0 4px">${label}（元）</label><input type="number" id="amt_${k}" value="${a[k] ?? ''}" style="width:100%">`;
  }).join('') + `<div class="muted" style="margin-top:8px">提示：合计=四项之和可自动算；金蝶导入的税金合计可在「数据导入」带入。</div>`;
  document.getElementById('taxMask').classList.add('on');
  // 自动求和
  ['vat','sur','it','cit'].forEach(k => {
    document.getElementById('amt_' + k).oninput = () => {
      const s = ['vat','sur','it','cit'].reduce((acc, kk) => acc + (parseFloat(document.getElementById('amt_'+kk).value) || 0), 0);
      document.getElementById('amt_total').value = s || '';
    };
  });
}
async function saveAmounts() {
  if (!editClient) return;
  const tc = ensureTax(editClient);
  tc.amounts = {};
  ['vat','sur','it','cit','total'].forEach(k => { tc.amounts[k] = parseFloat(document.getElementById('amt_' + k).value) || 0; });
  if (!tc.amounts.total) { document.getElementById('taxMask').classList.remove('on'); toast('请填写合计金额'); return; }
  if (tc.state === 'draft') tc.state = 'ready';
  await store.upsert('taxConfirm', tc);
  await reloadMonth();
  document.getElementById('taxMask').classList.remove('on');
  render(document.getElementById('view'), window.__ctx);
  toast('金额已保存，可生成确认单发群');
}
