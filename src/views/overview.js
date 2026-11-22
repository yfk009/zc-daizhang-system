// 经营总览（老板首页）：指标卡 / 分层进度 / 逾期预警 / 四周节奏 / 生成任务
import { esc, toast } from '../ui.js';
import { state, reloadMonth, loadAll, getUser } from '../app-state.js';
import { store } from '../db.js';
import { buildMonthTasks, unitCount, unitDone, TIERS } from '../templates.js';
import { vstate } from './tasks.js';

export async function render(root, ctx) {
  if (state.tasks.length === 0) {
    root.innerHTML = `
    <div class="panel" style="text-align:center;padding:40px">
      <h3 style="justify-content:center">📅 ${state.month} 月度任务尚未生成</h3>
      <p class="muted" style="margin:10px 0 18px">系统将按五档服务体系（S1 零申报托管 4 项 / S2–S5 十八项任务制）为全部在服客户自动生成任务清单</p>
      <button class="btn" id="genBtn">⚙️ 生成 ${state.month} 任务清单</button>
    </div>`;
    root.querySelector('#genBtn').onclick = generate;
    return;
  }

  const total = state.tasks.reduce((a, t) => a + unitCount(t), 0);
  const done = state.tasks.reduce((a, t) => a + unitDone(t), 0);
  // 申报进度：S1 批量申报 + S2/S3 申报任务
  const s1file = state.tasks.find(t => t.key === 's1_file');
  const s1d = s1file ? unitDone(s1file) : 0, s1n = s1file ? unitCount(s1file) : 0;
  const filings = state.tasks.filter(t => t.key === 'filing');
  const fd = filings.filter(t => t.state === 'done').length;
  const filedTotal = s1n + filings.length;
  const filedDone = s1d + fd;
  // 税金确认
  const actives = state.customers.filter(c => !c.archived && c.tier !== 'S1');
  const totalActive = state.customers.filter(c => !c.archived).length;
  const confirmed = actives.filter(c => { const tc = state.tax.find(x => x.clientId === c._id); return tc && tc.state === 'confirmed'; }).length;
  // 逾期/受阻/问题
  const bads = state.tasks.filter(t => ['overdue', 'blocked', 'issue'].includes(vstate(t)[0]));
  // 已手动确认的逾期（不再计入预警，可撤销）
  const ackN = state.tasks.filter(t => vstate(t)[0] === 'ack').length;

  root.innerHTML = `
  <div class="cards">
    <div class="card"><div class="k">本月任务完成</div><div class="v">${done}<small> / ${total} 项</small></div></div>
    <div class="card good"><div class="k">已完成申报</div><div class="v">${filedDone}<small> / ${filedTotal} 户</small></div></div>
    <div class="card"><div class="k">税金确认（${actives.length} 经营户）</div><div class="v">${confirmed}<small> / ${actives.length} 户</small></div></div>
    <div class="card ${bads.length ? 'warn' : ''}"><div class="k">逾期 / 受阻 / 问题</div><div class="v">${bads.length}<small> 项</small></div>${ackN ? `<div class="muted" style="font-size:11px;margin-top:4px">另有 ${ackN} 条逾期已手动确认</div>` : ''}</div>
  </div>
  <div class="tiers">
    <div class="tiercard all"><div class="n">${totalActive} 家</div><div class="d">全部家数 · 在服客户</div><div class="p">全部任务完成 <b>${total ? Math.round(done / total * 100) : 0}%</b>（${done}/${total} 项）</div></div>
    ${['S5', 'S4', 'S3', 'S2', 'S1'].map(tier => {
      const ts = state.tasks.filter(t => t.tier === tier);
      const d = ts.reduce((a, t) => a + unitDone(t), 0), n = ts.reduce((a, t) => a + unitCount(t), 0);
      const nClients = state.customers.filter(c => !c.archived && c.tier === tier).length;
      return `<div class="tiercard ${tier.toLowerCase()}"><div class="n">${nClients} 家</div>
        <div class="d">${TIERS[tier].name} · ${TIERS[tier].rule}</div>
        <div class="p">${TIERS[tier].monthly}<br>本月完成 <b>${n ? Math.round(d / n * 100) : 0}%</b>（${d}/${n} 项）</div></div>`;
    }).join('')}
  </div>
  <div class="panel">
    <h3 style="display:flex;justify-content:space-between;align-items:center;gap:8px">⏰ 逾期 / 受阻 / 问题（点击跳转处理）
      <button class="btn sm ghost" id="ackAllBtn" style="white-space:nowrap">✋ 一键确认全部逾期</button></h3>
    <table><thead><tr><th>客户</th><th>任务</th><th>档位</th><th>责任人</th><th>状态</th><th>说明</th><th>操作</th></tr></thead>
    <tbody>${bads.slice(0, 20).map(t => { const [cl, txt] = vstate(t); return `<tr class="${cl}" style="cursor:pointer" data-jump="${esc(t.name)}"><td>${esc(t.clientName)}</td><td>${esc(t.name)}</td><td><span class="tag ${t.tier}">${t.tier}</span></td><td onclick="event.stopPropagation()"><select data-oid="${t._id}" style="max-width:110px">${ownerOptions(t.owner)}</select></td><td><span class="st ${cl}">${txt}</span></td><td class="muted">${t.state === 'issue' ? esc(t.note || '') : (cl === 'blocked' ? '税金未确认，申报受阻' : '已逾期，需今日处理')}</td><td onclick="event.stopPropagation()">${cl === 'overdue' ? `<button class="btn sm ghost" data-ack="${t._id}" style="white-space:nowrap">✋ 确认</button>` : '<span class="muted">—</span>'}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:16px">🎉 本月无逾期、无受阻——主动服务节奏保持得很好</td></tr>'}</tbody></table>
  </div>
  <div class="panel">
    <h3>📈 四周节奏进度</h3>
    ${[1, 2, 3, 4].map(w => {
      const ts = state.tasks.filter(t => t.week === w);
      const d = ts.reduce((a, t) => a + unitDone(t), 0), n = ts.reduce((a, t) => a + unitCount(t), 0);
      const p = n ? Math.round(d / n * 100) : 0;
      const names = ['', 'W1 · 1-7号 收票做账', 'W2 · 8-15号 申报', 'W3 · 16-25号 报表沟通', 'W4 · 26-月底 复盘'];
      return `<div class="weekrow"><div class="wl">${names[w]}</div><div class="bar"><i style="width:${p}%"></i></div><div class="pct">${p}% (${d}/${n})</div></div>`;
    }).join('')}
  </div>
  <div class="modal-mask" id="ackMask"><div class="modal">
    <h3>✋ 一键确认全部逾期</h3>
    <div class="info" id="ackInfo"></div>
    <p class="muted" style="font-size:12.5px;margin:8px 0 14px">确认后这些任务显示为「🟣 逾期已确认」，不再计入上方逾期预警与问题表；已完成的工作请正常打勾，误确认的可随时在「任务清单」页撤销恢复提醒。</p>
    <div class="acts">
      <button class="btn ghost" id="ackCancel">取消</button>
      <button class="btn" id="ackOk">确认执行</button>
    </div>
  </div></div>`;
  const overs = bads.filter(t => vstate(t)[0] === 'overdue');
  const me = getUser()?.name || '未知';
  root.querySelector('#ackAllBtn').onclick = () => {
    if (!overs.length) { toast('当前没有逾期任务，无需确认'); return; }
    root.querySelector('#ackInfo').innerHTML = `将把当前 <b>${overs.length}</b> 条逾期任务标记为「逾期已确认」（涉及 ${new Set(overs.map(t => t.clientName)).size} 家客户）`;
    root.querySelector('#ackMask').classList.add('on');
  };
  root.querySelector('#ackCancel').onclick = () => root.querySelector('#ackMask').classList.remove('on');
  root.querySelector('#ackOk').onclick = async () => {
    for (const t of overs) {
      t.ack = { by: me, at: new Date().toISOString().slice(0, 10) };
      await store.upsert('monthTasks', t);
    }
    await reloadMonth();
    root.querySelector('#ackMask').classList.remove('on');
    toast(`✓ 已手动确认 ${overs.length} 条逾期任务，逾期预警已更新`);
    render(document.getElementById('view'), ctx);
  };
  // 单条手动确认
  root.querySelectorAll('[data-ack]').forEach(b => b.onclick = async () => {
    const t = state.tasks.find(x => x._id === b.dataset.ack);
    if (!t) return;
    t.ack = { by: me, at: new Date().toISOString().slice(0, 10) };
    await store.upsert('monthTasks', t);
    await reloadMonth();
    toast(`✋ 已确认：「${t.clientName} · ${t.name}」不再计入逾期预警`);
    render(document.getElementById('view'), ctx);
  });
  root.querySelectorAll('tr[data-jump]').forEach(tr => tr.onclick = () => ctx.jumpTask(tr.dataset.jump));
  // 手动改派：下拉选择后保存该任务的责任人
  root.querySelectorAll('[data-oid]').forEach(sel => sel.onchange = async () => {
    const t = state.tasks.find(x => x._id === sel.dataset.oid);
    if (!t) return;
    t.owner = sel.value;
    await store.upsert('monthTasks', t);
    await reloadMonth();
    toast(`✓ 该任务已单独改派给「${sel.value}」（团队映射变更时此条仍会跟随角色同步）`);
    render(document.getElementById('view'), ctx);
  });
}

// 责任人下拉：团队成员 + 当前值（若已不在团队中则保留显示，避免丢失信息）
function ownerOptions(cur) {
  const names = state.settings.staff.map(p => p.name);
  const list = names.includes(cur) ? names : [cur, ...names];
  return list.map(n => `<option value="${esc(n)}" ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('');
}

export async function generate() {
  if (!state.customers.filter(c => !c.archived).length) {
    toast('客户库为空：请先在「设置」初始化 68 家客户，或新增/导入客户');
    return;
  }
  const s = state.settings;
  const docs = buildMonthTasks(state.month, state.customers, s.ownersMap, {
    crossMap: s.crossMap || {},
    disabledKeys: s.disabledTemplateKeys || [],
    customTemplates: s.customTemplates || [],
  });
  // 幂等：跳过已存在的
  const existIds = new Set(state.tasks.map(t => t._id));
  const fresh = docs.filter(d => !existIds.has(d._id));
  if (!fresh.length) { toast('本月任务已存在，无需重复生成'); return; }
  await store.upsertMany('monthTasks', fresh);
  await reloadMonth();
  toast(`✓ 已生成 ${state.month} 任务：新增 ${fresh.length} 条（幂等跳过 ${docs.length - fresh.length} 条）`);
  window.__rerender?.();
}
