// 阿米巴分配：C 参数表的运行时 —— 收入输入 → 链条分配 → 工资测算 → 批次存档
// 服务绩效系数直接取任务引擎的按时完成率（与 C 文档一致）
import { esc, toast, fmt } from '../ui.js';
import { state, getUser } from '../app-state.js';
import { store } from '../db.js';

const DEFAULT_INPUT = { bookkeeping: 15554, other: 14446 };
let input = { ...DEFAULT_INPUT };

export function render(root, ctx) {
  const s = state.settings;
  const run = state.amoebaRuns.find(r => r.month === state.month);
  const isBoss = (getUser() || {}).boss;
  root.innerHTML = `
  <div class="dlvgrid">
    <div>
      <div class="panel">
        <h3>① 收入输入（${state.month}）</h3>
        <label>代账收入（经常性）</label><input type="number" id="amBook" value="${run?.inputs?.bookkeeping ?? input.bookkeeping}">
        <label>其他收入（工商/资质/咨询，单次不重复）</label><input type="number" id="amOther" value="${run?.inputs?.other ?? input.other}">
        <div class="presets"><button id="amDef">默认 3 万口径</button></div>
        <div class="alert" id="amAlert" style="display:none"></div>
      </div>
      <div class="panel">
        <h3>② 团队（设置页可改）</h3>
        <table><thead><tr><th>姓名</th><th>角色</th><th>权重</th></tr></thead>
        <tbody>${s.staff.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.role)}</td><td>${p.weight}</td></tr>`).join('')}</tbody></table>
        <div class="switch"><input type="checkbox" id="amPerf" ${s.amoeba.perfOn ? 'checked' : ''}><span>激励金 × 服务绩效系数（SOP 按时完成率）</span></div>
        <div id="perfList" style="display:${s.amoeba.perfOn ? 'block' : 'none'}"></div>
      </div>
    </div>
    <div>
      <div class="panel"><h3>③ 分配链条</h3><div class="flow" id="amFlow"></div></div>
      <div class="panel"><h3>④ 工资测算表</h3><table id="amSalary"></table>
        <div style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          ${run ? `<span class="st done">已存批次 ${run.savedAt}${run.locked ? ' · 已锁定' : ''}</span>` : ''}
          <button class="btn" id="amSave" ${!isBoss ? 'disabled' : ''}>📌 ${run ? '更新' : '保存'}本月批次</button>
          ${run && !run.locked && isBoss ? '<button class="btn ghost" id="amLock">🔒 锁定批次</button>' : ''}
          ${!isBoss ? '<span class="muted">仅老板可保存/锁定</span>' : ''}
        </div>
        <p class="muted" style="margin-top:8px">历史批次：${state.amoebaRuns.length ? state.amoebaRuns.map(r => `${r.month}${r.locked ? '🔒' : ''}（¥${fmt(r.inputs.bookkeeping + r.inputs.other)}）`).join(' ｜ ') : '暂无'}</p>
      </div>
    </div>
  </div>`;
  root.querySelector('#amDef').onclick = () => { root.querySelector('#amBook').value = DEFAULT_INPUT.bookkeeping; root.querySelector('#amOther').value = DEFAULT_INPUT.other; calc(root); };
  ['amBook', 'amOther'].forEach(id => root.querySelector('#' + id).oninput = () => calc(root));
  root.querySelector('#amPerf').onchange = e => {
    s.amoeba.perfOn = e.target.checked;
    root.querySelector('#perfList').style.display = e.target.checked ? 'block' : 'none';
    calc(root);
  };
  root.querySelector('#amSave').onclick = () => saveRun(false);
  root.querySelector('#amLock') && (root.querySelector('#amLock').onclick = () => saveRun(true));
  calc(root);
}

// 从任务引擎算每人按时完成率
function perfRates() {
  const rates = {};
  for (const p of state.settings.staff) {
    const ts = state.tasks.filter(t => t.owner === p.name);
    if (!ts.length) { rates[p.name] = 100; continue; }
    let ontime = 0, total = 0;
    for (const t of ts) {
      const n = t.type === 'batch' ? (t.checklist || []).length : 1;
      if (!n) continue;
      total += n;
      if (t.type === 'batch') {
        ontime += (t.checklist || []).filter(x => x.done).length; // 批量不记时点，按完成率
      } else {
        const dueDate = `${t.month}-${String(t.due).padStart(2, '0')}`;
        if (t.state === 'done') ontime += (t.doneAt && t.doneAt <= dueDate) ? 1 : 0;
      }
    }
    rates[p.name] = total ? Math.round(ontime / total * 100) : 100;
  }
  return rates;
}

function calc(root) {
  const s = state.settings;
  const book = parseFloat(root.querySelector('#amBook').value) || 0;
  const other = parseFloat(root.querySelector('#amOther').value) || 0;
  const R = book + other;
  const a = s.amoeba;
  const div = R * a.divPct / 100;
  const ops = R * (1 - a.divPct / 100);
  const fixed = ops * a.fixedPct / 100;
  const pool = ops * (1 - a.fixedPct / 100);
  const office = fixed * a.officePct / 100;
  const salaryPack = fixed * (1 - a.officePct / 100);
  const baseTotal = s.staff.length * a.baseSalary;
  const postPool = salaryPack - baseTotal;
  const W = s.staff.reduce((x, p) => x + p.weight, 0) || 1;
  const perfOn = root.querySelector('#amPerf').checked;
  const rates = perfOn ? perfRates() : null;

  if (perfOn) {
    root.querySelector('#perfList').innerHTML = '<table>' + Object.entries(rates).map(([n, r]) => `<tr><td style="width:80px">${esc(n)}</td><td>${r}%</td></tr>`).join('') + '</table><div class="muted">取自本月任务按时完成率（任务引擎自动统计）</div>';
  }

  const alert = root.querySelector('#amAlert');
  if (postPool < 0) {
    alert.style.display = 'block';
    alert.innerHTML = `⚠️ <b>岗位工资池为负（¥${fmt(postPool)}），模型失效。</b> 保本收入线 ≈ ¥${fmt(baseTotal / (0.7 * 0.8 * 0.8))}/月。处理：① 核对收入是否漏记 ② 调低基础工资/分红比例（设置页）`;
  } else if (other > 0 && R < baseTotal / (0.7 * 0.8 * 0.8)) {
    alert.style.display = 'block';
    alert.innerHTML = `⚠️ 收入低于保本线（¥${fmt(baseTotal / (0.7 * 0.8 * 0.8))}/月）——「其他收入」断档预警`;
  } else alert.style.display = 'none';

  root.querySelector('#amFlow').innerHTML = `
    <div class="step"><span>单月确认收入（代账 ¥${fmt(book)} + 其他 ¥${fmt(other)}）</span><b>¥${fmt(R)}</b></div>
    <div class="step sub"><span>股东分红 ${a.divPct}%</span><b class="neg">¥${fmt(div)}</b></div>
    <div class="step sub"><span>运营成本 ${100 - a.divPct}%</span><b>¥${fmt(ops)}</b></div>
    <div class="step sub" style="padding-left:44px"><span>└ 办公/软件/房租 ${a.officePct}%</span><b>¥${fmt(office)}</b></div>
    <div class="step sub" style="padding-left:44px"><span>└ 人员薪酬包</span><b>¥${fmt(salaryPack)}</b></div>
    <div class="step sub" style="padding-left:64px"><span>├ 基础工资 ${s.staff.length}人×¥${fmt(a.baseSalary)}</span><b>¥${fmt(baseTotal)}</b></div>
    <div class="step sub" style="padding-left:64px"><span>└ 岗位工资池</span><b class="${postPool < 0 ? 'neg' : ''}">¥${fmt(postPool)}</b></div>
    <div class="step sub" style="padding-left:44px"><span>└ 激励金池 ${Math.round(100 - a.fixedPct)}%${perfOn ? '（已挂绩效系数）' : ''}</span><b>¥${fmt(pool)}</b></div>`;

  let used = 0;
  const rows = s.staff.map(p => {
    const share = p.weight / W;
    const post = postPool > 0 ? postPool * share : 0;
    let inc = pool * share;
    let tag = '';
    if (perfOn) { const r = (rates[p.name] ?? 100) / 100; inc *= r; tag = ` <span class="muted">(×${Math.round(r * 100)}%)</span>`; used += inc; }
    else used += inc;
    return `<tr><td>${esc(p.name)}</td><td>${esc(p.role)}</td><td>${(share * 100).toFixed(1)}%</td><td>¥${fmt(a.baseSalary)}</td><td>¥${fmt(post)}</td><td>¥${fmt(inc)}${tag}</td><td><b>¥${fmt(a.baseSalary + post + inc)}</b></td>${p.boss ? `<td class="muted">＋分红 ¥${fmt(div)}</td>` : '<td></td>'}</tr>`;
  }).join('');
  root.querySelector('#amSalary').innerHTML = `<thead><tr><th>姓名</th><th>角色</th><th>权重占比</th><th>基础工资</th><th>岗位工资</th><th>激励金</th><th>月收入</th><th></th></tr></thead><tbody>${rows}
    <tr style="background:#f8fafc"><td colspan="6"><b>合计</b>${perfOn ? `<span class="muted">（绩效扣减 ¥${fmt(pool - used)} 滚存下月）</span>` : ''}</td><td colspan="2"><b>¥${fmt(baseTotal + Math.max(postPool, 0) + used)}</b></td></tr></tbody>`;

  input = { bookkeeping: book, other };
  return { R, div, office, baseTotal, postPool, pool, used, perfOn, rates };
}

async function saveRun(lock) {
  const res = calc(document.getElementById('view'));
  const s = state.settings;
  let run = state.amoebaRuns.find(r => r.month === state.month);
  if (!run) { run = { _id: `a_${state.month}`, month: state.month }; state.amoebaRuns.push(run); }
  run.inputs = { ...input };
  run.params = { ...s.amoeba, staff: s.staff.map(p => ({ name: p.name, weight: p.weight })) };
  run.result = {
    total: res.R, div: res.div, office: res.office, baseTotal: res.baseTotal,
    postPool: res.postPool, pool: res.pool,
    salaries: s.staff.map(p => {
      const W = s.staff.reduce((x, q) => x + q.weight, 0);
      const share = p.weight / W;
      const inc = res.pool * share * (res.perfOn ? (res.rates[p.name] ?? 100) / 100 : 1);
      return { name: p.name, total: s.amoeba.baseSalary + (res.postPool > 0 ? res.postPool * share : 0) + inc };
    }),
  };
  run.savedAt = new Date().toISOString().slice(0, 10);
  run.locked = !!lock;
  // 同步绩效开关到设置
  s.amoeba.perfOn = res.perfOn;
  await store.upsert('amoebaRuns', run);
  await store.upsert('settings', s);
  toast(lock ? '🔒 批次已锁定存档' : '📌 批次已保存');
  window.__rerender?.();
}
