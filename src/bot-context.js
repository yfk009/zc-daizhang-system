// AI 助手数据上下文构建器（纯逻辑，无浏览器依赖，可单测）
// 职责：把系统全量实时数据压缩成模型友好的快照文本，作为 system prompt 喂给 UI 层
// 口径与各页面一致：客户/任务/税金/财务/配合/服务单/团队设置
import { TIER_ORDER } from './templates.js';
import { ORDER_STATUS } from './valueservices.js';
import { todayStr, monthNow } from './ui.js';

const dash = v => (v === undefined || v === null || v === '' ? '—' : String(v));
const num = n => Number(n || 0).toLocaleString('zh-CN');
const dayOf = s => Number(String(s || '0000-00-00').slice(8, 10));

const idText = t => (t === 'general' ? '一般纳税人' : t === 'small' ? '小规模' : '身份未知');

/* ---------- 主入口 ---------- */
export function buildContext(data, question = '') {
  const today = data.today || todayStr();
  const month = data.month || monthNow();
  const dm = data.dataMonth || '—';
  const all = data.customers || [];
  const cs = all.filter(c => !c.archived);
  const arch = all.filter(c => c.archived);
  const tasks = data.tasks || [];
  const taxList = data.tax || [];
  const fins = (data.financials || []).filter(f => f.month === dm);
  const coopList = data.coop || [];
  const notices = data.risknotices || [];
  const orders = data.serviceOrders || [];
  const st = data.settings || {};
  const S = [];

  S.push(`你是「辫子哥代账 · 客户服务管理系统」内置 AI 助手。今天是 ${today}（${weekOf(today)}），当前服务月 ${month}，账务数据月 ${dm}（服务月 M 处理 M-1 月的账务数据）。`);
  S.push('你的职责：基于下方系统实时数据快照，回答老板/会计关于客户、任务、税金、财务、配合、服务单、团队分工的任何问题。数据是唯一事实来源，禁止编造。');

  /* —— 全局统计 —— */
  const tierCnt = {};
  for (const t of TIER_ORDER) tierCnt[t] = cs.filter(c => c.tier === t).length;
  const monthlyTotal = cs.reduce((s, c) => s + (Number(c.monthlyFee) || Math.round((Number(c.annualFee) || 0) / 12 * 100) / 100), 0);
  const annualTotal = cs.reduce((s, c) => s + (Number(c.annualFee) || (Number(c.monthlyFee) || 0) * 12), 0);
  const dayN = dayOf(today);
  const undone = tasks.filter(t => t.state !== 'done');
  const overdue = undone.filter(t => Number(t.due) < dayN);
  const actives = cs.filter(c => c.tier !== 'S1');

  /* —— 税金状态统计（口径同税金页） —— */
  const taxStat = { none: 0, draft: 0, ready: 0, sent: 0, confirmed: 0 };
  let taxTotalDue = 0, taxConfirmedDue = 0;
  for (const c of actives) {
    const tc = taxList.find(t => t.clientId === c._id && t.month === month);
    if (!tc) { taxStat.none++; continue; }
    if (tc.amounts && Number(tc.amounts.total) > 0) taxTotalDue += Number(tc.amounts.total);
    if (tc.state === 'confirmed') { taxStat.confirmed++; if (tc.amounts && Number(tc.amounts.total) > 0) taxConfirmedDue += Number(tc.amounts.total); }
    else if (tc.state === 'sent') taxStat.sent++;
    else if (tc.state === 'ready') taxStat.ready++;
    else if (tc.state === 'draft') taxStat.draft++;
    else taxStat.none++;
  }
  const closedCnt = coopList.filter(x => x.closeCall === 'done').length;
  const escalatedCnt = coopList.filter(x => x.closeCall === 'escalated').length;
  const receiptCnt = coopList.filter(x => x.receipt === true).length;
  const byStat = {};
  for (const o of orders) byStat[o.status || 'draft'] = (byStat[o.status || 'draft'] || 0) + 1;
  S.push(
    `【全局统计】客户 ${cs.length} 家在库（${TIER_ORDER.map(t => `${t}=${tierCnt[t]}`).join('，')}），归档 ${arch.length} 家；` +
    `月费合计 ¥${num(monthlyTotal)}/月；年费合计 ¥${num(annualTotal)}/年；` +
    `当月任务 ${tasks.length} 项 = 完成 ${tasks.length - undone.length} + 未完成 ${undone.length}（逾期 ${overdue.length}）；` +
    `税金确认（S2–S5 ${actives.length} 户）：已确认 ${taxStat.confirmed} · 已发送待客户确认 ${taxStat.sent} · 已录金额待发送 ${taxStat.ready} · 录入中 ${taxStat.draft} · 未录入 ${taxStat.none}；` +
    `合计应缴税金 ¥${num(taxTotalDue)}（已确认部分 ¥${num(taxConfirmedDue)}）；` +
    `5号收口：已收口 ${closedCnt} · 缺票升级 ${escalatedCnt}（应收口对象 ${actives.length} 户）；` +
    `回执已签 ${receiptCnt} 户；` +
    `增值服务单 ${orders.length} 张（${Object.entries(byStat).map(([k, v]) => `${ORDER_STATUS[k] || k} ${v} 张`).join('、') || '无'}）`
  );

  /* —— 客户明细（每户一行） —— */
  const custLines = cs.map(c => [
    c.name, `${c.tier}·${idText(c.taxpayerType)}`,
    c.revenue ? num(c.revenue) : '零申报',
    c.annualFee ? num(c.annualFee) : '—',
    c.monthlyFee ? num(c.monthlyFee) : '—',
    ownersOf(c), dash(c.contractEnd), dash(c.payCycle), dash(c.source),
  ].join(' | '));
  S.push(`【客户明细】共 ${cs.length} 家。格式：名称 | 档位·身份 | 年营业额 | 年记账费 | 月记账费 | 负责人 | 合同到期 | 收费周期 | 来源\n` + custLines.join('\n'));
  if (arch.length) S.push(`【归档客户】${arch.map(c => `${c.name}（${dash(c.tier)}，${ownersOf(c)}）`).join('、')}`);

  /* —— 当月任务 —— */
  const taskLines = tasks.map(t => {
    const stat = t.state === 'done'
      ? `✓${t.doneAt ? t.doneAt.slice(5) : ''}`
      : (Number(t.due) < dayN ? '⚠逾期' : '未完成');
    return [t.clientName || '团队/批量', t.name, `${month}-${String(t.due).padStart(2, '0')}`, t.owner, stat].join(' | ');
  });
  S.push(`【当月任务】共 ${tasks.length} 项。格式：客户|任务|截止日|责任人|状态\n` + (taskLines.length ? taskLines.join('\n') : '（本月尚未生成任务）'));

  /* —— 当月税金（S2–S5） —— */
  const taxLines = actives.map(c => {
    const tc = taxList.find(t => t.clientId === c._id && t.month === month);
    if (!tc) return `${c.name} | 未录入`;
    const a = tc.amounts || {};
    const oth = (a.others || []).map(o => `${o.name}¥${num(o.amt)}`).join(',');
    return [
      c.name, tc.state === 'confirmed' ? '已确认' : tc.state === 'sent' ? '已发送待确认' : tc.state === 'ready' ? '已录金额待发送' : '录入中',
      num(a.vat), num(a.sur), num(a.it), num(a.cit), num(a.stamp),
      oth || '—', num(a.total),
    ].join(' | ');
  });
  S.push(`【当月税金】格式：客户|状态|增值税|附加税|个税|企税预缴|印花税|其他税种|合计应缴\n` + taxLines.join('\n'));

  /* —— 账务月财务 —— */
  const finLines = fins.map(f => `${f.clientName || f.clientId} | 收入${num(f.revenue)} | 成本${num(f.cost)} | 税金${num(f.taxTotal)}`);
  S.push(`【账务月财务】${dm} 月（金蝶/用友导入）：\n` + (finLines.length ? finLines.join('\n') : '（无记录）'));

  /* —— 客户配合 + 风险告知书 —— */
  const byIdMap = byId(all);
  const coopLines = coopList.filter(x => x.closeCall || x.receipt || (x.items && Object.keys(x.items).length))
    .map(x => {
      const c = byIdMap(x.clientId);
      const nm = c ? c.name : x.clientId;
      const itemsArr = Object.entries(x.items || {});
      const itemsDone = itemsArr.filter(([, v]) => v).length;
      return [
        nm,
        x.closeCall === 'done' ? '已收口' : x.closeCall === 'escalated' ? '缺票升级' : '未收口',
        x.receipt ? '回执已签' : '回执未签',
        itemsArr.length ? `配合清单 ${itemsDone}/${itemsArr.length}` : '清单未用',
      ].join(' | ');
    });
  S.push(`【客户配合】格式：客户|5号收口|回执|配合清单\n` + (coopLines.length ? coopLines.join('\n') : '（无配合记录）'));
  if (notices.length) S.push(`【风险告知书】${notices.map(n => `${n.clientName}（${n.status === 'sent' ? '已送达' : n.status === 'signed' ? '已签回' : dash(n.status)}${n.date ? ' ' + n.date : ''}）`).join('、')}`);

  /* —— 增值服务单明细 —— */
  const orderLines = orders.map(o => [o.clientName || o.clientId, o.svc, dash(o.fee), ORDER_STATUS[o.status] || dash(o.status), dash(o.createdAt)].join(' | '));
  S.push(`【增值服务单】格式：客户|服务项目|费用|状态|创建日\n` + (orderLines.length ? orderLines.join('\n') : '（无）'));

  /* —— 团队与分工 —— */
  const om = st.ownersMap || {};
  S.push(`【团队与分工】成员：${(st.staff || []).map(p => `${p.name}（${dash(p.role)}${p.weight ? '·权重' + p.weight : ''}${p.boss ? '·管理员' : ''}）`).join('、')}`);
  S.push(`角色映射：老板=${dash(om.boss)}｜项目负责人=${dash(om.director)}｜主办会计=${dash(om.lead)}｜审核会计=${dash(om.reviewer)}｜助理=${dash(om.assist)}`);

  /* —— 重点客户深挖（问题中提到的客户，追加全字段+全部相关记录） —— */
  const hits = hitClients(question, all);
  if (hits.length) {
    S.push('【重点客户深挖】问题中提到的客户，全字段档案+全部相关记录（回答该客户问题时以此区为准）：');
    for (const c of hits) S.push(deepDive(c, { tasks, taxList, finsAll: data.financials || [], coopList, notices, orders, dm, month, dayN }));
  }

  /* —— 回答规则 —— */
  S.push([
    '【回答规则】',
    '1. 只依据上方快照回答，禁止编造；快照没有的直说「系统中暂无该数据」。',
    '2. 问具体客户优先用深挖区；问整体用全局统计+分档汇总。',
    '3. 金额千分位；本月=服务月 ' + month + '；账务月=' + dm + '；逾期=未完成且已过截止日。',
    '4. 简洁分点，先结论后明细；对比/排名/清单类问题用表格。',
    '5. 只读助手不改数据；建议要可落地（该催谁、先做哪单、缺什么）。',
  ].join('\n'));

  const system = S.filter(Boolean).join('\n\n');
  return { system, chars: system.length };
}

/* ---------- 辅助函数 ---------- */
function weekOf(s) {
  const d = new Date(String(s).replace(/-/g, '/'));
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][isNaN(d) ? 0 : d.getDay()];
}
function ownersOf(c) {
  const o = Array.isArray(c.owners) && c.owners.length ? c.owners : (c.owner ? [c.owner] : []);
  return o.length ? o.join('、') : '未指定';
}
function byId(all) {
  const m = new Map((all || []).map(c => [c._id, c]));
  return id => m.get(id);
}
/* ---------- 命中客户识别：问题文本 → 客户数组 ---------- */
export function hitClients(question, customers) {
  const q = String(question || '').trim();
  if (!q) return [];
  const cs = customers || [];
  const strip = s => String(s || '').replace(/（[^）]*）|\([^)]*\)/g, '');
  const seen = new Set();
  const hits = [];
  const add = c => { if (c && !seen.has(c._id)) { seen.add(c._id); hits.push(c); } };
  for (const c of cs) {
    const nm = strip(c.name);
    if (nm.length >= 4 && q.includes(nm)) add(c);
    const stem = nm.replace(/(有限)?(责任)?公司$/, '').trim();
    if (stem.length >= 4 && q.includes(stem)) add(c);
  }
  return hits.slice(0, 8);
}
/* ---------- 单户深挖：全字段档案 + 相关记录 ---------- */
function deepDive(c, env) {
  const L = [];
  L.push(`▸ ${c.name}（${c.tier}·${idText(c.taxpayerType)}）`);
  L.push(`  档案：年营业额 ${c.revenue ? num(c.revenue) : '零申报'}｜年记账费 ${c.annualFee ? num(c.annualFee) : '—'}｜月记账费 ${c.monthlyFee ? num(c.monthlyFee) : '—'}｜负责人 ${ownersOf(c)}`);
  L.push(`  联系：联系人 ${dash(c.contact)}｜电话 ${dash(c.phone)}｜介绍人 ${dash(c.introSource)}｜收费周期 ${dash(c.payCycle)}｜来源 ${dash(c.source)}`);
  L.push(`  合同：开始 ${dash(c.contractStart)} → 到期 ${dash(c.contractEnd)}｜税号 ${dash(c.taxNo)}｜备注 ${dash(c.notes || c.remark)}`);
  const ts = env.tasks.filter(t => t.clientId === c._id);
  if (ts.length) L.push(`  本月任务：${ts.map(t => `${t.name}(${t.state === 'done' ? '✓' : Number(t.due) < env.dayN ? '⚠逾期' : '未完成'})`).join('、')}`);
  const tc = env.taxList.find(t => t.clientId === c._id && t.month === env.month);
  if (tc) {
    const a = tc.amounts || {};
    const oth = (a.others || []).map(o => `${o.name}¥${num(o.amt)}`).join(',');
    const stTxt = tc.state === 'confirmed' ? '已确认' : tc.state === 'sent' ? '已发送待确认' : tc.state === 'ready' ? '已录金额待发送' : '录入中';
    L.push(`  税金(${stTxt})：增${num(a.vat)} 附${num(a.sur)} 个${num(a.it)} 企${num(a.cit)} 印${num(a.stamp)} 其他(${oth || '无'}) 合计¥${num(a.total)}`);
  }
  const fs = (env.finsAll || []).filter(f => f.clientId === c._id).sort((x, y) => (x.month || '').localeCompare(y.month || ''));
  if (fs.length) L.push(`  财务史：${fs.map(f => `${f.month}月收入${num(f.revenue)}/成本${num(f.cost)}/税金${num(f.taxTotal)}`).join('；')}`);
  const cp = env.coopList.find(x => x.clientId === c._id && x.month === env.month);
  if (cp) {
    const closeTxt = cp.closeCall === 'done' ? '已收口' : cp.closeCall === 'escalated' ? '缺票升级' : '未收口';
    L.push(`  配合：收口=${closeTxt}｜回执=${cp.receipt ? '已签' : '未签'}`);
  }
  const nt = env.notices.filter(n => n.clientId === c._id);
  if (nt.length) L.push(`  风险告知书：${nt.map(n => n.status === 'sent' ? '已送达' : '已签回').join('、')}`);
  const os = (env.orders || []).filter(o => o.clientId === c._id);
  if (os.length) L.push(`  服务单：${os.map(o => `${o.svc}（${ORDER_STATUS[o.status] || o.status}）`).join('、')}`);
  return L.join('\n');
}
