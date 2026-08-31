// 经营总览（老板首页）：指标卡 / 分层进度 / 逾期预警 / 四周节奏 / 生成任务
import { esc, toast } from '../ui.js';
import { state, reloadMonth, loadAll } from '../app-state.js';
import { store } from '../db.js';
import { buildMonthTasks, unitCount, unitDone, TIERS } from '../templates.js';
import { vstate } from './tasks.js';

export async function render(root, ctx) {
  if (state.tasks.length === 0) {
    root.innerHTML = `
    <div class="panel" style="text-align:center;padding:40px">
      <h3 style="justify-content:center">📅 ${state.month} 月度任务尚未生成</h3>
      <p class="muted" style="margin:10px 0 18px">系统将按三档服务包（S1 批量 / S2 标准 / S3 深度）为 68 家客户自动生成任务清单</p>
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
  const confirmed = actives.filter(c => { const tc = state.tax.find(x => x.clientId === c._id); return tc && tc.state === 'confirmed'; }).length;
  // 逾期/受阻/问题
  const bads = state.tasks.filter(t => ['overdue', 'blocked', 'issue'].includes(vstate(t)[0]));

  root.innerHTML = `
  <div class="cards">
    <div class="card"><div class="k">本月任务完成</div><div class="v">${done}<small> / ${total} 项</small></div></div>
    <div class="card good"><div class="k">已完成申报</div><div class="v">${filedDone}<small> / ${filedTotal} 户</small></div></div>
    <div class="card"><div class="k">税金确认（${actives.length} 经营户）</div><div class="v">${confirmed}<small> / ${actives.length} 户</small></div></div>
    <div class="card ${bads.length ? 'warn' : ''}"><div class="k">逾期 / 受阻 / 问题</div><div class="v">${bads.length}<small> 项</small></div></div>
  </div>
  <div class="tiers">
    ${['S3', 'S2', 'S1'].map(tier => {
      const ts = state.tasks.filter(t => t.tier === tier);
      const d = ts.reduce((a, t) => a + unitDone(t), 0), n = ts.reduce((a, t) => a + unitCount(t), 0);
      const nClients = state.customers.filter(c => !c.archived && c.tier === tier).length;
      return `<div class="tiercard ${tier.toLowerCase()}"><div class="n">${nClients} 家</div>
        <div class="d">${TIERS[tier].name} · ${TIERS[tier].rule}</div>
        <div class="p">${TIERS[tier].monthly}<br>本月完成 <b>${n ? Math.round(d / n * 100) : 0}%</b>（${d}/${n} 项）</div></div>`;
    }).join('')}
  </div>
  <div class="panel">
    <h3>⏰ 逾期 / 受阻 / 问题（点击跳转处理）</h3>
    <table><thead><tr><th>客户</th><th>任务</th><th>档位</th><th>责任人</th><th>状态</th><th>说明</th></tr></thead>
    <tbody>${bads.slice(0, 20).map(t => { const [cl, txt] = vstate(t); return `<tr class="${cl}" style="cursor:pointer" data-jump="${esc(t.name)}"><td>${esc(t.clientName)}</td><td>${esc(t.name)}</td><td><span class="tag ${t.tier}">${t.tier}</span></td><td>${esc(t.owner)}</td><td><span class="st ${cl}">${txt}</span></td><td class="muted">${t.state === 'issue' ? esc(t.note || '') : (cl === 'blocked' ? '税金未确认，申报受阻' : '已逾期，需今日处理')}</td></tr>`; }).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:16px">🎉 本月无逾期、无受阻——主动服务节奏保持得很好</td></tr>'}</tbody></table>
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
  </div>`;
  root.querySelectorAll('tr[data-jump]').forEach(tr => tr.onclick = () => ctx.jumpTask(tr.dataset.jump));
}

export async function generate() {
  if (!state.customers.filter(c => !c.archived).length) {
    toast('客户库为空：请先在「设置」初始化 68 家客户，或新增/导入客户');
    return;
  }
  const s = state.settings;
  const docs = buildMonthTasks(state.month, state.customers, s.ownersMap, {
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
