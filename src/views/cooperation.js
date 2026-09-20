// 客户配合页：5号票据收口看板 / 每月12项配合清单打勾 / 三催一升级时间线 / A~J 43项速查 / 风险告知书与承诺回执
import { esc, toast } from '../ui.js';
import { state, reloadMonth } from '../app-state.js';
import { store, newId } from '../db.js';
import { TIERS, TIER_ORDER } from '../templates.js';
import { MONTHLY_ITEMS, FULL_CYCLE, URGE_TIMELINE, CLOSE_LABEL } from '../coop.js';

let openCoopId = '';   // 12项清单展开的客户
let cycleFilter = '全部';
let cycleQ = '';

function coopOf(id) { return state.coop.find(x => x.clientId === id && x.month === state.month); }
function itemsDone(cp) { return cp ? MONTHLY_ITEMS.filter(m => cp.items && cp.items[m.k]).length : 0; }

async function patchCoop(clientId, patch) {
  let cp = coopOf(clientId);
  if (!cp) cp = { _id: `cp_${state.month}_${clientId}`, month: state.month, clientId, items: {}, closeCall: '', receipt: false };
  Object.assign(cp, patch);
  if (!cp.items) cp.items = {};
  await store.upsert('coop', cp);
  const i = state.coop.findIndex(x => x._id === cp._id);
  if (i >= 0) state.coop[i] = cp; else state.coop.push(cp);
  return cp;
}

export async function render(root, ctx) {
  const paid = state.customers.filter(c => !c.archived && c.tier !== 'S1')
    .sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
  const closed = paid.filter(c => coopOf(c._id)?.closeCall === 'done').length;
  const escalated = paid.filter(c => coopOf(c._id)?.closeCall === 'escalate').length;
  const receipts = state.customers.filter(c => !c.archived && coopOf(c._id)?.receipt).length;
  const notices = state.risknotices || [];
  const overdueClose = new Date().getDate() > 5 ? `<div class="card warn"><div class="k">5 号硬线已过</div><div class="v">${paid.length - closed - escalated}<small> 户未收口</small></div></div>` : '';

  const cycleClasses = ['全部', ...new Set(FULL_CYCLE.map(f => f.cls.split(' ')[0]))];
  const cycleRows = FULL_CYCLE.filter(f =>
    (cycleFilter === '全部' || f.cls.startsWith(cycleFilter)) &&
    (!cycleQ || f.act.includes(cycleQ) || f.req.includes(cycleQ)));

  root.innerHTML = `
  <div class="banner">📋 <b>客户配合体系：</b>每月 1 号系统启动 → 2 号首催 → 3 号播报 → 4 号预审 → <b>★5 号 18:00 收口（未回票老板亲自私信）</b> → 月底归档。账的质量 = 单据的质量 × 时效。</div>
  <div class="cards">
    <div class="card"><div class="k">经营户（S2–S5）</div><div class="v">${paid.length}<small> 户</small></div></div>
    <div class="card good"><div class="k">5号票据已收口</div><div class="v">${closed}<small> / ${paid.length} 户</small></div></div>
    <div class="card ${escalated ? 'warn' : ''}"><div class="k">缺票·升级老板</div><div class="v">${escalated}<small> 户</small></div></div>
    <div class="card"><div class="k">配合承诺回执已签</div><div class="v">${receipts}<small> / ${state.customers.filter(c => !c.archived).length} 户</small></div></div>
    ${overdueClose}
  </div>

  <div class="panel">
    <h3>📬 5 号收口看板（逐户跟踪）</h3>
    <table><thead><tr><th>客户</th><th>档位</th><th>收口状态（点击切换）</th><th>本月配合进度</th><th>承诺回执</th><th>风险告知书</th><th>操作</th></tr></thead><tbody>
    ${paid.map(c => {
      const cp = coopOf(c._id);
      const st = cp?.closeCall || '';
      const stCls = st === 'done' ? 'done' : st === 'escalate' ? 'issue' : 'todo';
      const nc = notices.filter(n => n.clientId === c._id).length;
      return `<tr>
        <td>${esc(c.name)}</td>
        <td><span class="tag ${c.tier}">${c.tier}</span></td>
        <td><button class="btn sm ghost" data-close="${c._id}"><span class="st ${stCls}">${CLOSE_LABEL[st]}</span></button></td>
        <td style="cursor:pointer" data-coop="${c._id}"><b>${itemsDone(cp)}</b> / 12 项 ${itemsDone(cp) === 12 ? '✅' : ''}</td>
        <td><button class="btn sm ghost" data-receipt="${c._id}"><span class="st ${cp?.receipt ? 'done' : 'todo'}">${cp?.receipt ? '已签' : '未签'}</span></button></td>
        <td>${nc ? `<span class="st issue">${nc} 份</span>` : '<span class="muted">—</span>'}</td>
        <td><button class="btn sm ghost" data-notice="${c._id}">＋告知书</button><button class="btn sm ghost" data-coopbtn="${c._id}">配合清单</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:16px">暂无经营户</td></tr>'}
    </tbody></table>
  </div>

  <div class="dlvgrid">
    <div class="panel">
      <h3>📞 三催一升级时间线</h3>
      <table><thead><tr><th>时点</th><th>动作</th><th>责任人</th></tr></thead>
      <tbody>${URGE_TIMELINE.map(t => `<tr><td>${t.time}</td><td>${t.act}</td><td>${t.who}</td></tr>`).join('')}</tbody></table>
    </div>
    <div class="panel">
      <h3>📜 风险告知书登记（无法取得票据等风险，书面告知留痕）</h3>
      <table><thead><tr><th>日期</th><th>客户</th><th>事由</th><th>状态（点击切换）</th><th></th></tr></thead>
      <tbody>${notices.slice().reverse().slice(0, 10).map(n => `<tr>
        <td>${esc(n.date)}</td><td>${esc(n.clientName)}</td><td class="muted">${esc(n.reason)}</td>
        <td><button class="btn sm ghost" data-nstat="${n._id}"><span class="st ${n.status === 'confirmed' ? 'done' : 'todo'}">${n.status === 'confirmed' ? '客户已签回' : '已送达待签回'}</span></button></td>
        <td><button class="btn sm ghost" data-ndel="${n._id}">删</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted" style="text-align:center;padding:12px">暂无登记</td></tr>'}</tbody></table>
    </div>
  </div>

  <div class="panel">
    <h3>📚 全周期配合事项速查（A~J 十类 43 项）</h3>
    <div class="filters">
      ${cycleClasses.map(cc => `<button class="btn ghost sm ${cycleFilter === cc ? 'on' : ''}" data-cyc="${cc}">${cc}</button>`).join('')}
      <input id="cycQ" placeholder="搜索事项…" value="${esc(cycleQ)}" style="flex:1;min-width:140px">
    </div>
    <table><thead><tr><th>类别</th><th>配合事项</th><th>您要做什么</th><th>频率/触发</th><th>时限</th><th>不配合的后果</th></tr></thead>
    <tbody>${cycleRows.map(f => `<tr><td>${f.cls}</td><td>${f.act}</td><td class="muted">${f.req}</td><td>${f.freq}</td><td>${f.due}</td><td class="muted">${f.risk}</td></tr>`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:12px">无匹配项</td></tr>'}</tbody></table>
  </div>

  <div class="modal-mask" id="coopMask"><div class="modal">
    <h3 id="coopTitle">每月配合清单</h3><div id="coopBody"></div>
    <div class="acts"><button class="btn" id="coopClose">关闭</button></div>
  </div></div>
  <div class="modal-mask" id="noticeMask"><div class="modal">
    <h3>＋ 登记风险告知书</h3><div id="noticeBody"></div>
    <div class="acts"><button class="btn ghost" id="noticeCancel">取消</button><button class="btn" id="noticeSave">保存</button></div>
  </div></div>`;

  // 收口状态循环切换
  root.querySelectorAll('[data-close]').forEach(b => b.onclick = async () => {
    const id = b.dataset.close;
    const cur = coopOf(id)?.closeCall || '';
    const next = cur === '' ? 'done' : cur === 'done' ? 'escalate' : '';
    await patchCoop(id, { closeCall: next });
    if (next === 'escalate') toast('⚠️ 已标记缺票升级：请老板亲自私信该客户（5号硬线机制）');
    render(root, ctx);
  });
  // 回执切换
  root.querySelectorAll('[data-receipt]').forEach(b => b.onclick = async () => {
    const cp = coopOf(b.dataset.receipt);
    await patchCoop(b.dataset.receipt, { receipt: !(cp?.receipt) });
    render(root, ctx);
  });
  // 12项清单弹窗
  const openCoopModal = (clientId) => {
    openCoopId = clientId;
    const c = state.customers.find(x => x._id === clientId);
    const cp = coopOf(clientId) || { items: {} };
    document.getElementById('coopTitle').textContent = `每月配合清单 · ${c.name} · ${state.month}`;
    document.getElementById('coopBody').innerHTML = MONTHLY_ITEMS.map(m => `
      <label class="switch" style="margin:7px 0"><input type="checkbox" data-mi="${m.k}" ${cp.items?.[m.k] ? 'checked' : ''}>
      <span>${m.star ? '★' : ''}${m.time} ｜ ${esc(m.act)}<br><small class="muted">方式：${m.way} ｜ 时限：${m.due}${m.risk !== '—' ? ' ｜ 不配合：' + m.risk : ''}</small></span></label>`).join('');
    document.getElementById('coopBody').querySelectorAll('[data-mi]').forEach(cb => cb.onchange = async () => {
      const cur = coopOf(clientId) || { items: {} };
      const items = { ...(cur.items || {}), [cb.dataset.mi]: cb.checked };
      await patchCoop(clientId, { items });
    });
    document.getElementById('coopMask').classList.add('on');
  };
  root.querySelectorAll('[data-coop],[data-coopbtn]').forEach(el => el.onclick = () => openCoopModal(el.dataset.coop || el.dataset.coopbtn));
  root.querySelector('#coopClose').onclick = () => { document.getElementById('coopMask').classList.remove('on'); render(root, ctx); };
  // 风险告知书
  root.querySelectorAll('[data-notice]').forEach(b => b.onclick = () => {
    const cid = b.dataset.notice;
    const c = state.customers.find(x => x._id === cid);
    document.getElementById('noticeBody').innerHTML = `
      <p class="muted">客户：<b>${esc(c.name)}</b>（告知后 3 日内签回，微信回复视为送达）</p>
      <label style="display:block;margin:8px 0 4px">事由 *</label>
      <input id="ntReason" style="width:100%" placeholder="如：X月购货票据无法取得，按税法口径做纳税调整">
      <label style="display:block;margin:8px 0 4px">日期</label>
      <input id="ntDate" type="date" style="width:100%" value="${new Date().toISOString().slice(0, 10)}">`;
    document.getElementById('noticeMask').classList.add('on');
    document.getElementById('noticeSave').onclick = async () => {
      const reason = document.getElementById('ntReason').value.trim();
      if (!reason) { toast('请填写事由'); return; }
      await store.upsert('risknotices', { _id: newId('rn'), clientId: cid, clientName: c.name, date: document.getElementById('ntDate').value, reason, status: 'sent' });
      state.risknotices = await store.list('risknotices');
      document.getElementById('noticeMask').classList.remove('on');
      toast('✓ 风险告知书已登记（状态：已送达待签回）');
      render(root, ctx);
    };
  });
  root.querySelector('#noticeCancel').onclick = () => document.getElementById('noticeMask').classList.remove('on');
  root.querySelectorAll('[data-nstat]').forEach(b => b.onclick = async () => {
    const n = state.risknotices.find(x => x._id === b.dataset.nstat);
    n.status = n.status === 'confirmed' ? 'sent' : 'confirmed';
    await store.upsert('risknotices', n);
    state.risknotices = await store.list('risknotices');
    render(root, ctx);
  });
  root.querySelectorAll('[data-ndel]').forEach(b => b.onclick = async () => {
    await store.remove('risknotices', b.dataset.ndel);
    state.risknotices = await store.list('risknotices');
    render(root, ctx);
  });
  // 43项速查
  root.querySelectorAll('[data-cyc]').forEach(b => b.onclick = () => { cycleFilter = b.dataset.cyc; render(root, ctx); });
  root.querySelector('#cycQ').oninput = e => { cycleQ = e.target.value.trim(); render(root, ctx); };
  root.querySelector('#cycQ').focus();
}
