// 数据导入（智能版）：任意模板自动分析拆解
// 输入：Excel 文件 / 粘贴表格 ｜ 识别：表头行定位、列角色智能判定、客户库匹配、单户报表模式
// 可选：AI 大模型解析（设置页配置接口后启用）
import { esc, toast } from '../ui.js';
import { state, loadAll, prevDataMonth } from '../app-state.js';
import { store, newId } from '../db.js';
import { buildMonthTasks, tierOf } from '../templates.js';
import {
  detectHeaderRow, detectMode, guessColumns, matchClient,
  parseNumber, parsePastedText, extractClientFinancials,
} from '../smart-import.js';

let wbData = null;        // { sheetNames, sheets }
let curSheet = '';
let mapping = { name: -1, revenue: -1, cost: -1, tax: -1, fee: -1, annualRev: -1 };
let dataMonth = '';
let pasteOn = false;
let mode = 'A';           // A 列式明细 / B 单户报表
let singleClient = null;  // B 模式客户
let singleVals = { revenue: null, cost: null, tax: null };
let headers = [], dataRows = [], headerRowIdx = 0;
let matched = [];         // [{name, clientId, revenue, cost, taxTotal, fee, annualRev}]
let lastPipeline = null;  // 一键处理结果摘要

export function render(root, ctx) {
  if (!dataMonth) dataMonth = prevDataMonth();
  root.innerHTML = `
  <div class="panel">
    <h3>📥 智能数据导入（月度经营数据）</h3>
    <p class="muted" style="margin-bottom:12px">不限模板：给什么表就分析什么表。自动定位表头、识别客户列与收入/成本/税金列并匹配客户库；单户报表（表名/标题含客户名）自动切换行式取数；也可在设置页配置 AI 接口后用大模型解析任意表格。导入结果供月度简报、偏差报告、税金确认取数。</p>
    <div class="filters">
      <label style="margin:0 8px 0 0">账务数据月：</label>
      <input type="month" id="impMonth" value="${dataMonth}">
      <input type="file" id="impFile" accept=".xlsx,.xls,.csv" style="flex:1;min-width:180px">
      <button class="btn ghost" id="pasteBtn">📋 粘贴表格</button>
    </div>
    <div id="pasteWrap" style="display:none;margin-top:8px">
      <textarea id="pasteArea" placeholder="从 Excel/WPS 直接复制区域粘贴（Ctrl+V），第一行最好是表头；单户利润表直接整表粘贴即可" style="width:100%;height:110px;border:1px solid #cbd5e1;border-radius:8px;padding:8px;font-size:12px;font-family:monospace"></textarea>
      <button class="btn" id="pasteParse" style="margin-top:6px">🔍 解析粘贴内容</button>
      <span class="muted" style="margin-left:8px">适合快速录几行，或软件不支持导出时</span>
    </div>
  </div>
  <div id="impBody"></div>`;

  root.querySelector('#impMonth').onchange = e => { dataMonth = e.target.value || prevDataMonth(); drawBody(root, ctx); };
  root.querySelector('#impFile').onchange = e => onFile(e, root, ctx);
  root.querySelector('#pasteBtn').onclick = () => {
    pasteOn = !pasteOn;
    root.querySelector('#pasteWrap').style.display = pasteOn ? 'block' : 'none';
  };
  root.querySelector('#pasteParse').onclick = () => onPaste(root, ctx);
  drawBody(root, ctx);
}

function aiConf() {
  try { return JSON.parse(localStorage.getItem('zx_ai_conf') || 'null'); } catch { return null; }
}

async function onFile(e, root, ctx) {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const XLSX = await import('xlsx');
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    wbData = {
      sheetNames: wb.SheetNames,
      sheets: Object.fromEntries(wb.SheetNames.map(n => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' })])),
    };
    curSheet = wb.SheetNames[0];
    toast(`已读取 ${f.name}（${wb.SheetNames.length} 个工作表）`);
    analyze(root, ctx);
  } catch (err) { console.error(err); toast('文件解析失败：' + err.message); }
}

function onPaste(root, ctx) {
  const text = root.querySelector('#pasteArea').value;
  if (!text.trim()) { toast('请先粘贴表格内容'); return; }
  const rows = parsePastedText(text);
  if (!rows.length) { toast('未识别到内容'); return; }
  wbData = { sheetNames: ['粘贴的表格'], sheets: { '粘贴的表格': rows } };
  curSheet = '粘贴的表格';
  analyze(root, ctx);
}

// 核心：分析当前表 → 定模式、猜列、逐行匹配
function analyze(root, ctx) {
  const rows = wbData.sheets[curSheet] || [];
  if (!rows.length) { drawBody(root, ctx); return; }
  lastPipeline = null; // 新解析清空上次的处理摘要
  headerRowIdx = detectHeaderRow(rows);
  headers = rows[headerRowIdx] || [];
  dataRows = rows.slice(headerRowIdx + 1).filter(r => r.some(c => String(c ?? '').trim() !== ''));
  const det = detectMode({ headers, dataRows, customers: state.customers, sheetName: curSheet, rows });
  mode = det.mode;
  singleClient = det.client || null;
  if (mode === 'A') {
    mapping = det.guess;
    doMatch();
  } else {
    singleVals = extractClientFinancials(rows);
  }
  drawBody(root, ctx);
}

function doMatch() {
  matched = [];
  // 年度口径列与月度收入列若是同一列，视为名单表：月度财务收入不落库（防年值当月值）
  const revIsAnnual = mapping.revenue >= 0 && mapping.revenue === mapping.annualRev;
  for (const r of dataRows) {
    const name = String(r[mapping.name] ?? '').trim();
    if (!name || name === 'undefined' || name === '合计' || /合\s*计|总\s*计/.test(name)) continue;
    const client = matchClient(name, state.customers);
    matched.push({
      name,
      clientId: client ? client._id : null,
      revenue: !revIsAnnual && mapping.revenue >= 0 ? parseNumber(r[mapping.revenue]) : null,
      cost: mapping.cost >= 0 ? parseNumber(r[mapping.cost]) : null,
      taxTotal: mapping.tax >= 0 ? parseNumber(r[mapping.tax]) : null,
      fee: mapping.fee >= 0 ? parseNumber(r[mapping.fee]) : null,
      annualRev: mapping.annualRev >= 0 ? parseNumber(r[mapping.annualRev]) : null,
    });
  }
}

/* ---------- 渲染 ---------- */
function drawBody(root, ctx) {
  const body = root.querySelector('#impBody');
  if (!wbData) {
    body.innerHTML = '<div class="muted" style="text-align:center;padding:24px">选择文件或粘贴表格后，系统自动分析并展示识别结果</div>';
    return;
  }
  if (mode === 'B') { drawModeB(body, root, ctx); return; }
  drawModeA(body, root, ctx);
}

function sheetTabsHtml() {
  return wbData.sheetNames.length > 1
    ? `<div class="filters">${wbData.sheetNames.map(n => `<button class="btn sm ${n === curSheet ? '' : 'ghost'}" data-sheet="${esc(n)}">${esc(n)}</button>`).join('')}</div>`
    : '';
}

function drawModeA(body, root, ctx) {
  const conf = aiConf();
  const cols = headers.map((h, i) => ({ i, label: `${esc(String(h).slice(0, 14)) || '第' + (i + 1) + '列'}` }));
  const opt = (sel, allowName) => '<option value="-1">（不导入）</option>'
    + cols.map(c => `<option value="${c.i}" ${sel === c.i ? 'selected' : ''}>${allowName && mapping.name === c.i ? '👤 ' : ''}${c.label}</option>`).join('');
  const smartTag = v => v >= 0 ? '<span class="st done">🤖 已识别</span>' : '<span class="st todo">未识别·请选</span>';
  const emptyLibTip = state.customers.length === 0
    ? '<div class="banner" style="margin:0 0 10px">💡 客户库为空？没关系——点下方「🚀 一键导入并自动处理」，系统会按表格自动建档、分层并串起后续全流程。</div>' : '';
  const resultBanner = lastPipeline
    ? `<div class="msgbox" style="margin:0 0 10px">🚀 <b>处理完成</b>：${lastPipeline.text}</div>` : '';
  body.innerHTML = `
  ${sheetTabsHtml()}
  <div class="panel">
    <h3>🔍 智能识别结果 <span class="st done">列式明细表</span> <span class="muted">表头行：第 ${headerRowIdx + 1} 行 ｜ 识别到 ${matched.length} 行数据</span></h3>
    ${resultBanner}${emptyLibTip}
    <div class="filters">
      <label style="margin:0">客户列：</label><select id="mName">${opt(mapping.name, false)}</select>${smartTag(mapping.name)}
      <label style="margin:0 0 0 10px">收入列：</label><select id="mRev">${opt(mapping.revenue)}</select>${smartTag(mapping.revenue)}
      <label style="margin:0 0 0 10px">成本列：</label><select id="mCost">${opt(mapping.cost)}</select>${smartTag(mapping.cost)}
      <label style="margin:0 0 0 10px">税金列：</label><select id="mTax">${opt(mapping.tax)}</select>${smartTag(mapping.tax)}
      <button class="btn ghost sm" id="reGuess">↻ 重新识别</button>
      ${conf && conf.apiKey
        ? '<button class="btn sm" id="aiBtn">🤖 AI 解析此表</button>'
        : '<span class="muted">💡 在设置页配置 AI 接口后，可让大模型解析任意复杂表格</span>'}
    </div>
    <table><thead><tr><th>表格中的名称</th><th>匹配到系统客户</th><th>收入</th><th>成本</th><th>税金合计</th></tr></thead>
    <tbody>${matched.slice(0, 120).map(m => `<tr class="${m.clientId ? '' : 'blocked'}">
      <td>${esc(m.name)}</td>
      <td><select class="rowMatch" data-row="${esc(m.name)}"><option value="">— 未匹配（跳过） —</option>${state.customers.map(c => `<option value="${c._id}" ${c._id === m.clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></td>
      <td>${m.revenue ?? '—'}</td><td>${m.cost ?? '—'}</td><td>${m.taxTotal ?? '—'}</td>
    </tr>`).join('')}</tbody></table>
    <div style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn" id="autoBtn">🚀 一键导入并自动处理</button>
      <button class="btn ghost" id="impSave">仅保存财务数据（精细模式）</button>
      <span class="muted">一键 = 自动建档客户+分层+财务落库（${dataMonth}）+税金预填（${state.month}）+生成月度任务；红色行未匹配，一键时将自动建档</span>
    </div>
  </div>`;

  body.querySelectorAll('[data-sheet]').forEach(b => b.onclick = () => { curSheet = b.dataset.sheet; analyze(root, ctx); });
  const M = { mName: 'name', mRev: 'revenue', mCost: 'cost', mTax: 'tax' };
  Object.entries(M).forEach(([id, k]) => {
    const el = body.querySelector('#' + id);
    if (el) el.onchange = e => { mapping[k] = parseInt(e.target.value); doMatch(); drawBody(root, ctx); };
  });
  body.querySelector('#reGuess').onclick = () => { mapping = guessColumns(headers, dataRows, state.customers); doMatch(); drawBody(root, ctx); toast('已重新智能识别'); };
  const aiBtn = body.querySelector('#aiBtn');
  if (aiBtn) aiBtn.onclick = () => aiParse(root, ctx);
  body.querySelectorAll('.rowMatch').forEach(s => s.onchange = e => {
    const m = matched.find(x => x.name === s.dataset.row);
    if (m) m.clientId = e.target.value || null;
  });
  body.querySelector('#autoBtn').onclick = () => autoProcess(root, ctx);
  body.querySelector('#impSave').onclick = saveImport;
}

/* ---------- 🚀 一键管线：拆分→建档→分层→财务→税金→任务 ---------- */
async function autoProcess(root, ctx) {
  if (!matched.length) { toast('没有可处理的行'); return; }
  const s = state.settings;
  const created = [], finDocs = [], taxDocs = [];
  let matchedCnt = 0;

  for (const m of matched) {
    let client = m.clientId ? state.customers.find(c => c._id === m.clientId) : null;
    if (client) { matchedCnt++; }
    else {
      // 自动建档：分层依据 年营业额列 → 月收入×12 → 有税金(S2) → 零申报(S1)
      let annualRev = m.annualRev ?? null;
      let tier;
      if (annualRev != null) tier = tierOf(annualRev);
      else if (m.revenue) { annualRev = Math.round(m.revenue * 12); tier = tierOf(annualRev); }
      else if (m.taxTotal) tier = 'S2';
      else { annualRev = 0; tier = 'S1'; }
      client = {
        _id: newId('c'), name: m.name, taxNo: '', source: '表格导入',
        revenue: annualRev || 0, annualFee: m.fee || 0, monthlyFee: 0,
        tier, tierManual: false, archived: false,
        ownerRole: tier === 'S1' ? 'assist' : 'lead',
        owner: tier === 'S1' ? (s.ownersMap.assist || '') : (s.ownersMap.lead || ''),
        contact: '', phone: '', contractStart: '', contractEnd: '',
      };
      await store.upsert('customers', client);
      created.push(client);
    }
    // 财务数据落库（有任一数值才建）
    if (m.revenue != null || m.cost != null || m.taxTotal != null) {
      finDocs.push({
        _id: `f_${dataMonth}_${client._id}`, month: dataMonth, clientId: client._id, clientName: client.name,
        revenue: m.revenue || 0, cost: m.cost || 0, taxTotal: m.taxTotal || 0,
        importedAt: new Date().toISOString().slice(0, 10),
      });
    }
    // 税金预填（服务月 taxConfirm，税金>0 才建，状态=金额就绪待发送）
    if (m.taxTotal != null && m.taxTotal > 0) {
      taxDocs.push({
        _id: `x_${state.month}_${client._id}`, month: state.month, clientId: client._id, clientName: client.name,
        state: 'ready', amounts: { vat: 0, sur: 0, it: 0, cit: 0, total: m.taxTotal },
      });
    }
  }

  if (finDocs.length) await store.upsertMany('financials', finDocs);
  if (taxDocs.length) await store.upsertMany('taxConfirm', taxDocs);

  // 刷新客户库（后续任务生成要用）
  state.customers = await store.list('customers');

  // 生成当月任务（幂等：已存在跳过）
  const existTasks = await store.list('monthTasks', { month: state.month });
  const existIds = new Set(existTasks.map(t => t._id));
  const docs = buildMonthTasks(state.month, state.customers, s.ownersMap).filter(d => !existIds.has(d._id));
  if (docs.length) await store.upsertMany('monthTasks', docs);
  await loadAll();

  const tierDist = { S3: 0, S2: 0, S1: 0 };
  created.forEach(c => tierDist[c.tier]++);
  lastPipeline = {
    text:
      `建档 <b>${created.length}</b> 家（S3×${tierDist.S3} S2×${tierDist.S2} S1×${tierDist.S1}）｜` +
      `匹配既有 <b>${matchedCnt}</b> 家 ｜ 财务落库 <b>${finDocs.length}</b> 条（${dataMonth}）｜ ` +
      `税金预填 <b>${taxDocs.length}</b> 户（${state.month}）｜ 月度任务 <b>${docs.length ? '新生成 ' + docs.length + ' 项' : '已存在'}</b>`,
  };
  drawBody(root, ctx);
  toast('🚀 一键处理完成，各页面已就绪');
}

function drawModeB(body, root, ctx) {
  const c = singleClient;
  const conf = aiConf();
  body.innerHTML = `
  ${sheetTabsHtml()}
  <div class="panel">
    <h3>🔍 智能识别结果 <span class="st done">单户报表（行式取数）</span></h3>
    ${c ? `<div class="msgbox" style="margin-bottom:12px">识别为 <b>${esc(c.name)}</b>（${c.tier}）的报表：表名/标题命中客户名，已按科目标签行取数。</div>`
        : `<div class="banner" style="margin:0 0 12px">未能从表名/标题识别客户，请选择：</div>
           <select id="sbClient" style="margin-bottom:12px"><option value="">— 选择客户 —</option>${state.customers.map(x => `<option value="${x._id}">${esc(x.name)}</option>`).join('')}</select>`}
    <div class="paper" style="max-width:460px">
      <div class="row"><span>收入（营业收入等）</span><span><input class="mini-input" id="sb_rev" type="number" value="${singleVals.revenue ?? ''}"> 元</span></div>
      <div class="row"><span>成本（营业成本等）</span><span><input class="mini-input" id="sb_cost" type="number" value="${singleVals.cost ?? ''}"> 元</span></div>
      <div class="row"><span>税金（税金及附加/应交税费等）</span><span><input class="mini-input" id="sb_tax" type="number" value="${singleVals.tax ?? ''}"> 元</span></div>
      <div class="copybar">
        <button class="btn" id="sbSave">💾 保存到 ${dataMonth}</button>
        ${conf && conf.apiKey ? '<button class="btn ghost" id="sbAi">🤖 AI 兜底取数</button>' : ''}
        <button class="btn ghost" id="sbModeA">按列式明细处理</button>
      </div>
      <p class="muted" style="margin-top:10px">行式取数：定位"主营业务收入/营业成本/税金及附加"等科目标签行，取其右侧数值。若取数不准可手改或点 AI 兜底。</p>
    </div>
  </div>`;
  body.querySelector('#sbSave').onclick = saveSingle;
  body.querySelector('#sbModeA').onclick = () => { mode = 'A'; mapping = guessColumns(headers, dataRows, state.customers); doMatch(); drawBody(root, ctx); };
  const sbAi = body.querySelector('#sbAi');
  if (sbAi) sbAi.onclick = () => aiParse(root, ctx, true);
}

async function saveSingle() {
  const cid = singleClient ? singleClient._id : (document.querySelector('#sbClient')?.value || '');
  const c = state.customers.find(x => x._id === cid);
  if (!c) { toast('请先选择客户'); return; }
  const doc = {
    _id: `f_${dataMonth}_${c._id}`, month: dataMonth, clientId: c._id, clientName: c.name,
    revenue: parseFloat(document.getElementById('sb_rev').value) || 0,
    cost: parseFloat(document.getElementById('sb_cost').value) || 0,
    taxTotal: parseFloat(document.getElementById('sb_tax').value) || 0,
    importedAt: new Date().toISOString().slice(0, 10),
  };
  await store.upsert('financials', doc);
  await loadAll();
  toast(`✓ 已保存 ${c.name}（${dataMonth}）：收入 ${doc.revenue.toLocaleString()} / 成本 ${doc.cost.toLocaleString()} / 税金 ${doc.taxTotal.toLocaleString()}`);
}

async function saveImport() {
  const docs = matched.filter(m => m.clientId).map(m => {
    const c = state.customers.find(x => x._id === m.clientId);
    return {
      _id: `f_${dataMonth}_${m.clientId}`, month: dataMonth, clientId: m.clientId, clientName: c ? c.name : m.name,
      revenue: m.revenue || 0, cost: m.cost || 0, taxTotal: m.taxTotal || 0,
      importedAt: new Date().toISOString().slice(0, 10),
    };
  });
  if (!docs.length) { toast('没有可保存的行（请先匹配客户）'); return; }
  await store.upsertMany('financials', docs);
  await loadAll();
  toast(`✓ 已保存 ${docs.length} 条到 ${dataMonth}，交付物页可直接取数`);
}

/* ---------- AI 大模型解析（可选） ---------- */
async function aiParse(root, ctx, single = false) {
  const conf = aiConf();
  if (!conf || !conf.apiKey) { toast('请先在设置页配置 AI 接口'); return; }
  toast('🤖 AI 解析中…');
  const tsv = [headers.map(h => String(h ?? '')).join('\t'), ...dataRows.map(r => r.map(c => String(c ?? '')).join('\t'))].join('\n').slice(0, 9000);
  const sys = '你是代账公司的表格解析助手。用户给你一段从Excel复制/解析出的TSV表格数据（第一行为表头）。请提取每个客户的一行数据：客户名(name)、收入(revenue)、成本(cost)、税金合计(tax)，数值为纯数字（原值，不要换算单位）。没有的项用0。跳过合计/空行。只输出一个JSON数组，如 [{"name":"xx公司","revenue":1000,"cost":500,"tax":50}]，不要任何解释文字。';
  try {
    const res = await fetch(String(conf.base || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + conf.apiKey },
      body: JSON.stringify({
        model: conf.model || 'glm-4-flash', temperature: 0,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: tsv }],
      }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content || '';
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('AI 未返回有效 JSON');
    const arr = JSON.parse(m[0]);
    if (single && arr.length >= 1) {
      singleVals = { revenue: arr[0].revenue ?? null, cost: arr[0].cost ?? null, tax: arr[0].tax ?? null };
      drawBody(root, ctx);
      toast(`🤖 AI 提取：收入 ${singleVals.revenue ?? 0} / 成本 ${singleVals.cost ?? 0} / 税金 ${singleVals.tax ?? 0}`);
      return;
    }
    let hit = 0;
    for (const item of arr) {
      const cl = matchClient(item.name || '', state.customers);
      if (!cl) continue;
      let row = matched.find(x => x.clientId === cl._id);
      if (!row) { row = { name: item.name, clientId: cl._id }; matched.push(row); }
      row.revenue = item.revenue ?? row.revenue;
      row.cost = item.cost ?? row.cost;
      row.taxTotal = item.tax ?? row.taxTotal;
      hit++;
    }
    drawBody(root, ctx);
    toast(`🤖 AI 解析完成：识别 ${arr.length} 行，匹配到客户库 ${hit} 户`);
  } catch (e) {
    console.error(e);
    toast('AI 解析失败：' + e.message + '（若为跨域/网络错误，可在设置页更换接口地址）');
  }
}
