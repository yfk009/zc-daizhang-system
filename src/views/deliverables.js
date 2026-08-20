// 交付物生成：催票话术 / 税金确认单 / 预算表 / 月度简报 / 偏差报告
// 数据优先取导入的金蝶数据，缺失时手工录入；html2canvas 出图；可回填对应任务
import { esc, toast, fmt, prevMonth } from '../ui.js';
import { state, reloadMonth, taxOf, finOf, prevDataMonth } from '../app-state.js';
import { store } from '../db.js';

const TYPES = [
  { k: 'urge', label: '💬 催票话术' },
  { k: 'tax', label: '🧾 税金确认单' },
  { k: 'budget', label: '📋 月度预算表' },
  { k: 'brief', label: '📊 月度简报' },
  { k: 'variance', label: '🔴 偏差分析报告' },
];
let curType = 'urge';
let curClient = '';
// 手工数据暂存（未导入时的兜底）
const manual = {};

export function render(root, ctx) {
  const actives = state.customers.filter(c => !c.archived && c.tier !== 'S1')
    .sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
  if (!curClient || !actives.find(c => c._id === curClient)) curClient = actives[0]?._id || '';

  root.innerHTML = `
  <div class="dlvgrid">
    <div class="dlvside">
      <label>选择客户（S2/S3 经营户）</label>
      <select id="dlvClient">${actives.map(c => `<option value="${c._id}" ${c._id===curClient?'selected':''}>${esc(c.name)}</option>`).join('')}</select>
      <label>交付物类型</label>
      <div class="types">${TYPES.map(t => `<button class="${t.k===curType?'on':''}" data-t="${t.k}">${t.label}</button>`).join('')}</div>
      <div class="muted" style="margin-top:10px">数据自动取自金蝶导入；未导入的栏位可手工填写。出图后发微信群，再回任务清单打勾。S1 休眠户无月度交付物。</div>
    </div>
    <div class="paper" id="dlvPaper"></div>
  </div>`;

  root.querySelector('#dlvClient').onchange = e => { curClient = e.target.value; draw(root, ctx); };
  root.querySelectorAll('.types button').forEach(b => b.onclick = () => {
    curType = b.dataset.t; root.querySelectorAll('.types button').forEach(x => x.classList.remove('on')); b.classList.add('on'); draw(root, ctx);
  });
  draw(root, ctx);
}

export function focusClient(clientId) { if (clientId) curClient = clientId; }

function draw(root, ctx) {
  const c = state.customers.find(x => x._id === curClient);
  if (!c) { root.querySelector('#dlvPaper').innerHTML = '<p class="muted">暂无经营户客户</p>'; return; }
  const dm = prevDataMonth();
  const fin = finOf(c._id, dm);
  const paper = root.querySelector('#dlvPaper');
  const m = manual[c._id] || (manual[c._id] = {});

  if (curType === 'urge') paper.innerHTML = urgeHtml(c, m);
  else if (curType === 'tax') paper.innerHTML = taxHtml(c, m);
  else if (curType === 'budget') paper.innerHTML = budgetHtml(c, m, fin, dm);
  else if (curType === 'brief') paper.innerHTML = briefHtml(c, m, fin, dm);
  else paper.innerHTML = varianceHtml(c, m, fin, dm);
  wire(root, ctx, c);
}

const numInput = (id, v, label) => `<div class="row"><span>${label}</span><span><input class="mini-input" data-m="${id}" type="number" value="${v ?? ''}" placeholder="手工录入"> <em class="muted" style="font-style:normal">元</em></span></div>`;

/* ---------- 催票话术 ---------- */
function urgeHtml(c, m) {
  return `<h2>💬 催票话术（自动生成）</h2><div class="sub">${esc(c.name)} · ${state.month} 服务月 · 发送：微信群</div>
  <div class="msgbox">@老板您好，${state.month.slice(5)} 月做账开始了 📋<br>
  请在本周内把 ${prevMonth(state.month).slice(5)} 月票据发我：①销售发票/收据 ②进货发票 ③银行流水 ④工资表 ⑤费用票（房租/差旅/办公）。<br>
  目前统计还缺 <b>${m.missN ?? 2} 张票据</b>，麻烦优先补一下～<br>
  收到后我们 3 个工作日内完成做账，税额会提前发确认单，您确认后才申报缴款。</div>
  ${numInput('missN', m.missN, '缺票张数（张）').replace(/（张）/,'')}
  <div class="copybar">
    <button class="btn" data-w="copyUrg">📋 复制话术</button>
    <button class="btn ghost" data-w="doneUrg">已发送，回填催票任务</button>
  </div>
  <p class="muted" style="margin-top:12px">升级规则：第 2 天未回自动换强硬话术；第 5 天未回升级老板电话。</p>`;
}

/* ---------- 税金确认单 ---------- */
function taxHtml(c, m) {
  const tc = taxOf(c._id);
  const a = (tc && tc.amounts) || null;
  const vals = a || { vat: m.vat, sur: m.sur, it: m.it, cit: m.cit, total: m.total };
  const warn = !a ? '<div class="banner" style="margin:0 0 12px">该户尚未在「税金确认」页正式录入金额——以下可先手工填写出图，正式确认请回税金确认页录入。</div>' : '';
  return `${warn}<h2>🧾 ${state.month} 税金确认单</h2><div class="sub">${esc(c.name)} · 请回复"确认"后我们再申报</div>
  ${numInput('vat', vals.vat, '增值税')}
  ${numInput('sur', vals.sur, '城建税及教育费附加')}
  ${numInput('it', vals.it, '个人所得税')}
  ${numInput('cit', vals.cit, '企业所得税（预缴）')}
  <div class="total"><span>本月合计应缴</span><span id="taxTotalShow">¥${fmt(vals.total || 0)}</span></div>
  <div class="msgbox" style="margin-top:14px">温馨提示：请确保扣款账户余额充足。回复"确认"即视为同意按此金额申报缴款；如对金额有疑问，请随时电话沟通。</div>
  <div class="copybar">
    <button class="btn" data-w="img">🖼️ 生成图片</button>
    <button class="btn ghost" data-w="sentTax">已发群，登记发送</button>
  </div>`;
}

/* ---------- 月度预算表（S3） ---------- */
function budgetHtml(c, m, fin, dm) {
  const b = (fin && fin.budget) || m.budget || { rev: '', cost: '', fee: '', tax: '', cash: '' };
  return `<h2>📋 ${dm} 月度经营预算表（初稿）</h2><div class="sub">${esc(c.name)} · 五大模块 · 客户确认后执行</div>
  ${numInput('b_rev', b.rev, '① 收入预算')}
  ${numInput('b_cost', b.cost, '② 成本预算')}
  ${numInput('b_fee', b.fee, '③ 费用预算（人工/房租/营销等）')}
  ${numInput('b_tax', b.tax, '④ 税负预算')}
  ${numInput('b_cash', b.cash, '⑤ 现金流预算（期末余额）')}
  <div class="msgbox" style="margin-top:12px">话术：@老板，这是根据上月数据和您的计划准备的本月预算初稿，预计收入约 ¥${fmt(b.rev||0)}，预估税负约 ¥${fmt(b.tax||0)}。请过目，如需调整随时沟通，确认后我们按此框架走本月服务。</div>
  <div class="copybar">
    <button class="btn" data-w="img">🖼️ 生成图片</button>
    <button class="btn ghost" data-w="saveBudget">💾 保存预算到系统</button>
    <button class="btn ghost" data-w="doneBudget">客户已确认，回填任务</button>
  </div>`;
}

/* ---------- 月度简报 ---------- */
function briefHtml(c, m, fin, dm) {
  const rev = fin ? fin.revenue : (m.brief_rev ?? '');
  const cost = fin ? fin.cost : (m.brief_cost ?? '');
  const tax = fin ? fin.taxTotal : (m.brief_tax ?? '');
  const src = fin ? `<span class="st done">数据源：金蝶导入（${dm}）</span>` : `<span class="st overdue">该户 ${dm} 数据未导入——以下手工录入</span>`;
  return `<h2>📊 ${dm} 月度财务简报 · 人话版</h2><div class="sub">${esc(c.name)} · ${src}</div>
  ${numInput('brief_rev', rev, '本月收入')}
  ${numInput('brief_cost', cost, '本月成本')}
  ${numInput('brief_tax', tax, '本月税金合计')}
  <div class="total"><span>毛利估算</span><span id="briefProfit">¥${fmt((rev||0)-(cost||0))}</span></div>
  <div class="msgbox" style="margin-top:12px">一句话解读：收入 ¥${fmt(rev||0)}，成本 ¥${fmt(cost||0)}，税金 ¥${fmt(tax||0)}。详细分析可约 15 分钟电话沟通。</div>
  <div class="copybar">
    <button class="btn" data-w="img">🖼️ 生成图片</button>
    <button class="btn ghost" data-w="doneBrief">已发群，回填简报任务</button>
  </div>`;
}

/* ---------- 偏差分析报告（S3） ---------- */
function varianceHtml(c, m, fin, dm) {
  const b = (fin && fin.budget) || m.budget || {};
  const rows = [
    ['营业收入', b.rev, fin ? fin.revenue : m.brief_rev],
    ['营业成本', b.cost, fin ? fin.cost : m.brief_cost],
    ['费用合计', b.fee, m.var_fee],
    ['税负合计', b.tax, fin ? fin.taxTotal : m.brief_tax],
  ];
  return `<h2>🔴 ${dm} 预算偏差分析</h2><div class="sub">${esc(c.name)} · 灯级：绿≤10% 黄10-25% 红>25%</div>
  <table><thead><tr><th>科目</th><th>预算</th><th>实际</th><th>偏差率</th><th>灯级</th><th>归因（会计补充）</th></tr></thead><tbody>
  ${rows.map((r, i) => {
    const bud = r[1] ?? '', act = r[2] ?? '';
    const dev = (bud && act) ? Math.round((act - bud) / bud * 100) : null;
    const lg = dev == null ? '' : (Math.abs(dev) <= 10 ? '<span class="light g"></span>正常' : Math.abs(dev) <= 25 ? '<span class="light y"></span>关注' : '<span class="light r"></span>警报');
    return `<tr><td>${r[0]}</td>
      <td><input class="mini-input" data-m="${['b_rev','b_cost','b_fee','b_tax'][i]}" type="number" value="${bud}"></td>
      <td><input class="mini-input" data-m="${['brief_rev','brief_cost','var_fee','brief_tax'][i]}" type="number" value="${act}"></td>
      <td style="color:${dev!=null&&Math.abs(dev)>10?'#b91c1c':'#15803d'}">${dev!=null?(dev>0?'+':'')+dev+'%':'—'}</td>
      <td>${lg}</td><td class="muted">${dev!=null&&Math.abs(dev)>10?'广告投放前置等，见备注':'—'}</td></tr>`;
  }).join('')}
  </tbody></table>
  <div class="copybar" style="margin-top:14px">
    <button class="btn" data-w="img">🖼️ 生成图片</button>
    <button class="btn ghost" data-w="saveBudget">💾 保存预算与实际值</button>
    <button class="btn ghost" data-w="doneVariance">已交付，回填偏差报告任务</button>
  </div>`;
}

/* ---------- 事件 ---------- */
function wire(root, ctx, c) {
  const paper = root.querySelector('#dlvPaper');
  paper.querySelectorAll('input[data-m]').forEach(inp => inp.onchange = () => {
    const m = manual[c._id] || (manual[c._id] = {});
    m[inp.dataset.m] = parseFloat(inp.value) || 0;
    // 联动显示
    if (inp.dataset.m === 'brief_rev' || inp.dataset.m === 'brief_cost') {
      const p = document.getElementById('briefProfit');
      if (p) p.textContent = '¥' + fmt((m.brief_rev || 0) - (m.brief_cost || 0));
    }
    const t = document.getElementById('taxTotalShow');
    if (t && ['vat','sur','it','cit'].includes(inp.dataset.m)) {
      t.textContent = '¥' + fmt(['vat','sur','it','cit'].reduce((acc, k) => acc + (m[k] || 0), 0));
    }
  });
  paper.querySelectorAll('button[data-w]').forEach(b => b.onclick = () => doAction(b.dataset.w, c, ctx, root));
}

async function doAction(w, c, ctx, root) {
  const m = manual[c._id] || {};
  if (w === 'copyUrg') {
    const txt = `@老板您好，${state.month.slice(5)} 月做账开始了 📋 请在本周内把 ${prevMonth(state.month).slice(5)} 月票据发我：①销售发票/收据 ②进货发票 ③银行流水 ④工资表 ⑤费用票。目前还缺 ${m.missN ?? 2} 张票据，麻烦优先补一下～收到后 3 个工作日内完成做账，税额会提前发确认单，确认后才申报。`;
    try { await navigator.clipboard.writeText(txt); toast('话术已复制，去微信粘贴发送 ✓'); }
    catch { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('话术已复制 ✓'); }
  }
  if (w === 'img') {
    try {
      const mod = await import('html2canvas');
      const canvas = await (mod.default || mod)(document.getElementById('dlvPaper'), { scale: 2, backgroundColor: '#ffffff' });
      const a = document.createElement('a');
      a.download = `${c.name}_${curType}_${state.month}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
      toast('图片已生成下载，发微信群即可 📤');
    } catch (e) { console.error(e); toast('出图失败，可截图代替'); }
  }
  if (w === 'sentTax' || w === 'doneUrg' || w === 'doneBrief' || w === 'doneBudget' || w === 'doneVariance' || w === 'saveBudget') {
    if (w === 'saveBudget') { await saveBudget(c); return; }
    if (w === 'sentTax') {
      let tc = taxOf(c._id);
      if (!tc) { tc = { _id: `x_${state.month}_${c._id}`, month: state.month, clientId: c._id, clientName: c.name, state: 'ready', amounts: { total: m.total || 0 } }; }
      tc.sentAt = new Date().toISOString().slice(0, 10);
      await store.upsert('taxConfirm', tc);
      await reloadMonth(); toast('已登记发送，等待客户回复'); ctx.refreshHeader?.(); return;
    }
    const keyMap = { doneUrg: 'urge', doneBrief: 'brief', doneBudget: 'budget', doneVariance: 'variance' };
    const key = keyMap[w];
    const t = state.tasks.find(x => x.clientId === c._id && x.key === key);
    if (!t) { toast('未找到对应任务（可能本月任务未生成或该户无此项）'); return; }
    if (t.state === 'done') { toast('该任务已完成'); return; }
    t.state = 'done'; t.doneAt = new Date().toISOString().slice(0, 10);
    t.evidence = '交付物已生成并发群';
    if (w === 'doneBudget' || w === 'doneVariance') await saveBudget(c);
    await store.upsert('monthTasks', t);
    await reloadMonth();
    toast('✓ 已回填任务：' + t.name);
    ctx.refreshHeader?.();
  }
}

async function saveBudget(c) {
  const m = manual[c._id] || {};
  const dm = prevDataMonth();
  let fin = state.financials.find(f => f.clientId === c._id && f.month === dm);
  if (!fin) {
    fin = { _id: `f_${dm}_${c._id}`, month: dm, clientId: c._id, clientName: c.name, revenue: m.brief_rev || 0, cost: m.brief_cost || 0, taxTotal: m.brief_tax || 0 };
  }
  fin.budget = {
    rev: m.b_rev ?? (fin.budget || {}).rev ?? '', cost: m.b_cost ?? (fin.budget || {}).cost ?? '',
    fee: m.b_fee ?? (fin.budget || {}).fee ?? '', tax: m.b_tax ?? (fin.budget || {}).tax ?? '',
    cash: (fin.budget || {}).cash ?? '',
  };
  if (m.brief_rev) fin.revenue = m.brief_rev;
  if (m.brief_cost) fin.cost = m.brief_cost;
  if (m.brief_tax) fin.taxTotal = m.brief_tax;
  await store.upsert('financials', fin);
  state.financials = await store.list('financials');
  toast('💾 预算已保存（' + dm + '）');
}
