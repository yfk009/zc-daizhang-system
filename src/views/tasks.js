// 任务清单视图：筛选 / 打勾（凭证）/ 批量清单 / 铁律阻塞 / 升级
import { el, esc, toast, isOverdue } from '../ui.js';
import { state, reloadMonth, taxOf, getUser } from '../app-state.js';
import { store } from '../db.js';
import { EVIDENCE_TYPES, unitCount, unitDone } from '../templates.js';

const filters = { week: '', tier: '', st: '', owner: '', q: '' };
let expandedBatch = null; // 展开的批量任务 _id
let modalTask = null;

function blockedByTax(t) {
  if (t.key !== 'filing' || t.tier === 'S1') return false;
  const tc = taxOf(t.clientId);
  return !tc || tc.state !== 'confirmed';
}
export function vstate(t) {
  if (t.state === 'done') return ['done', '已完成'];
  if (t.state === 'issue') return ['issue', '问题'];
  if (blockedByTax(t)) return ['blocked', '受阻·未确认'];
  if (isOverdue(state.month, t.due)) return ['overdue', '逾期'];
  return ['todo', '待办'];
}

export function render(root, ctx) {
  root.innerHTML = `
  <div class="panel">
    <div class="filters">
      <select id="fWeek"><option value="">全部周次</option>${[1,2,3,4].map(w=>`<option value="${w}" ${filters.week==w?'selected':''}>W${w}</option>`).join('')}</select>
      <select id="fTier"><option value="">全部档位</option><option value="S3" ${filters.tier==='S3'?'selected':''}>S3 实体户</option><option value="S2" ${filters.tier==='S2'?'selected':''}>S2 微型户</option><option value="S1" ${filters.tier==='S1'?'selected':''}>S1 休眠户</option></select>
      <select id="fState"><option value="">全部状态</option><option value="overdue" ${filters.st==='overdue'?'selected':''}>🔴 逾期</option><option value="blocked" ${filters.st==='blocked'?'selected':''}>🟠 受阻</option><option value="issue" ${filters.st==='issue'?'selected':''}>⚑ 问题</option><option value="todo" ${filters.st==='todo'?'selected':''}>⚪ 待办</option><option value="done" ${filters.st==='done'?'selected':''}>🟢 已完成</option></select>
      <select id="fOwner"><option value="">全部责任人</option>${state.settings.staff.map(s=>`<option ${filters.owner===s.name?'selected':''}>${s.name}</option>`).join('')}</select>
      <input id="fSearch" placeholder="搜索客户名/任务名…" value="${esc(filters.q)}" style="flex:1;min-width:150px">
    </div>
    <table id="taskTable"><thead><tr>
      <th style="width:40px">周</th><th>客户</th><th>档位</th><th>任务</th><th>截止</th><th>责任人</th><th>状态</th><th style="width:180px">操作</th>
    </tr></thead><tbody></tbody></table>
    <div class="muted" id="taskCount" style="margin-top:10px"></div>
  </div>
  <div class="modal-mask" id="mask"><div class="modal">
    <h3 id="mTitle"></h3><div class="info" id="mInfo"></div>
    <div class="cred" id="mCred">${EVIDENCE_TYPES.map((e,i)=>`<label><input type="radio" name="cred" value="${esc(e)}" ${i===0?'checked':''}> ${esc(e)}</label>`).join('')}</div>
    <textarea id="mNote" placeholder="备注（可选）：客户反馈、异常说明…"></textarea>
    <div class="acts">
      <button class="btn danger" id="mIssue">🚩 标记问题（转老板）</button>
      <button class="btn ghost" id="mCancel">取消</button>
      <button class="btn" id="mDone">✅ 确认完成</button>
    </div>
  </div></div>`;

  root.querySelector('#fWeek').onchange = e => { filters.week = e.target.value; draw(); };
  root.querySelector('#fTier').onchange = e => { filters.tier = e.target.value; draw(); };
  root.querySelector('#fState').onchange = e => { filters.st = e.target.value; draw(); };
  root.querySelector('#fOwner').onchange = e => { filters.owner = e.target.value; draw(); };
  root.querySelector('#fSearch').oninput = e => { filters.q = e.target.value.trim(); draw(); };
  root.querySelector('#mCancel').onclick = () => root.querySelector('#mask').classList.remove('on');
  root.querySelector('#mDone').onclick = () => confirmDone(ctx);
  root.querySelector('#mIssue').onclick = () => markIssue(ctx);
  draw();
}

function draw() {
  const tb = document.querySelector('#taskTable tbody');
  let list = state.tasks.filter(t =>
    (!filters.week || t.week === +filters.week) &&
    (!filters.tier || t.tier === filters.tier) &&
    (!filters.owner || t.owner === filters.owner) &&
    (!filters.q || (t.clientName || '').includes(filters.q) || t.name.includes(filters.q)));
  if (filters.st) list = list.filter(t => vstate(t)[0] === filters.st);
  list.sort((a, b) => a.due - b.due || (a.clientName || '').localeCompare(b.clientName || '', 'zh'));

  const rows = [];
  for (const t of list.slice(0, 200)) {
    const [cl, txt] = vstate(t);
    rows.push(`<tr class="${cl}">
      <td>W${t.week}</td><td>${esc(t.clientName)}</td>
      <td><span class="tag ${t.tier}">${t.tier}</span></td>
      <td>${esc(t.name)}</td><td>${state.month}-${String(t.due).padStart(2,'0')}</td>
      <td>${esc(t.owner)}</td><td><span class="st ${cl}">${txt}</span></td>
      <td>${opsHtml(t)}</td></tr>`);
    if (t.type === 'batch' && expandedBatch === t._id) {
      for (const item of (t.checklist || [])) {
        rows.push(`<tr class="batch-sub"><td></td><td colspan="6" style="padding-left:36px">
          <label class="ck"><input type="checkbox" data-bid="${t._id}" data-cid="${item.id}" ${item.done?'checked':''}> ${esc(item.name)}
          ${item.done?'<span class="st done" style="margin-left:8px">✓</span>':''}</label></td><td></td></tr>`);
      }
    }
  }
  tb.innerHTML = rows.join('');
  document.getElementById('taskCount').textContent =
    `共 ${list.length} 条（批量任务按组显示，展开可逐户打勾） ｜ 规则：无凭证不许打勾；当天18:00未完成提醒，逾期1天老板标红，逾期3天点名复盘`;

  tb.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => handle(b.dataset, b.dataset.act));
  tb.querySelectorAll('input[data-bid]').forEach(c => c.onchange = () => toggleBatchItem(c.dataset.bid, c.dataset.cid));
}

function opsHtml(t) {
  const [cl] = vstate(t);
  if (t.state === 'done') return `<span class="st done">✓ ${t.doneAt ? t.doneAt.slice(5) : ''}</span>`;
  if (t.state === 'issue') return `<button class="btn sm ghost" data-act="resolve" data-id="${t._id}">恢复待办</button>`;
  const btns = [];
  if (t.type === 'batch') {
    btns.push(`<button class="btn sm" data-act="expand" data-id="${t._id}">${expandedBatch===t._id?'收起':'展开清单'}（${unitDone(t)}/${unitCount(t)}）</button>`);
  } else {
    if (cl === 'blocked') btns.push(`<button class="btn sm ghost" data-act="tax" data-id="${t._id}">去税金确认</button>`);
    else btns.push(`<button class="btn sm" data-act="done" data-id="${t._id}">完成</button>`);
    if (['urge','taxconfirm','brief','variance','budget'].includes(t.key))
      btns.push(`<button class="btn sm ghost" data-act="dlv" data-id="${t._id}">生成交付物</button>`);
  }
  return btns.join(' ');
}

async function handle(ds, act) {
  const t = state.tasks.find(x => x._id === ds.id);
  if (!t) return;
  if (act === 'expand') { expandedBatch = expandedBatch === t._id ? null : t._id; draw(); }
  if (act === 'done') openModal(t);
  if (act === 'tax') { document.querySelector('[data-nav="tax"]').click(); }
  if (act === 'dlv') { ctxGoDeliverables(t.clientId); }
  if (act === 'resolve') { t.state = 'todo'; await store.upsert('monthTasks', t); await reloadMonth(); draw(); toast('已恢复待办'); }
}
let _goDlv = null;
export function setDeliverablesJump(fn){ _goDlv = fn; }
function ctxGoDeliverables(clientId){ if(_goDlv) _goDlv(clientId); }

async function toggleBatchItem(bid, cid) {
  const t = state.tasks.find(x => x._id === bid);
  if (!t || !t.checklist) return;
  const it = t.checklist.find(x => x.id === cid);
  it.done = !it.done;
  if (t.checklist.every(x => x.done)) { t.state = 'done'; t.doneAt = new Date().toISOString().slice(0,10); toast('该批量任务全部完成 ✓'); }
  await store.upsert('monthTasks', t);
  await reloadMonth(); draw();
}

function openModal(t) {
  if (blockedByTax(t)) { toast('铁律：客户未确认税金，申报任务受阻。请先完成税金确认。'); return; }
  modalTask = t;
  document.getElementById('mTitle').textContent = '✅ 完成：' + t.name;
  document.getElementById('mInfo').innerHTML = `客户：<b>${esc(t.clientName)}</b>（${t.tier}）<br>责任人：${esc(t.owner)} ｜ 截止：${state.month}-${String(t.due).padStart(2,'0')}`;
  document.getElementById('mNote').value = t.note || '';
  document.getElementById('mask').classList.add('on');
}
async function confirmDone(ctx) {
  if (!modalTask) return;
  const note = document.getElementById('mNote').value.trim();
  const ev = document.querySelector('#mCred input:checked');
  if (state.settings.evidenceRequired && !ev) { toast('请选择完成凭证'); return; }
  if (ev && ev.value.startsWith('线下') && !note) { toast('线下完成需填写备注说明'); return; }
  modalTask.state = 'done';
  modalTask.doneAt = new Date().toISOString().slice(0, 10);
  modalTask.note = note;
  modalTask.evidence = ev ? ev.value : '';
  await store.upsert('monthTasks', modalTask);
  await reloadMonth();
  document.getElementById('mask').classList.remove('on');
  draw(); ctx.refreshHeader?.();
  toast('已完成并登记凭证 ✓');
}
async function markIssue(ctx) {
  if (!modalTask) return;
  const note = document.getElementById('mNote').value.trim();
  modalTask.state = 'issue';
  modalTask.note = (note ? note + ' ｜ ' : '') + '已升级老板';
  await store.upsert('monthTasks', modalTask);
  await reloadMonth();
  document.getElementById('mask').classList.remove('on');
  draw(); ctx.refreshHeader?.();
  toast('🚩 已标记问题并推送老板');
}
