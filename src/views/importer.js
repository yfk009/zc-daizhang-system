// 数据导入（智能版·全表覆盖）：工作簿里所有表格一次处理
// 输入：Excel 文件（多 sheet）/ 反复粘贴多张表 ｜ 识别：每张表独立判定列式/单户模式
// 重新识别 / AI 解析 / 一键全流程 均覆盖全部表格；合并单元格自动承接、同客户多行自动汇总
import { esc, toast } from '../ui.js';
import { state, loadAll, prevDataMonth } from '../app-state.js';
import { store, newId } from '../db.js';
import { buildMonthTasks, tierOf } from '../templates.js';
import {
  detectHeaderRow, detectMode, guessColumns, matchClient,
  parseNumber, parsePastedText, extractClientFinancials, aggregateRows,
} from '../smart-import.js';

let wbData = null;        // { sheetNames: [], sheets: {} }
let curSheet = '';
let dataMonth = '';
let pasteOn = false;
let pasteCount = 0;
let sheetAn = {};         // sheetName → { mode, headerRowIdx, headers, dataRows, mapping, matched, singleClient, singleVals }
let lastPipeline = null;

export function render(root, ctx) {
  if (!dataMonth) dataMonth = prevDataMonth();
  root.innerHTML = `
  <div class="panel">
    <h3>📥 智能数据导入（月度经营数据 · 全部表格）</h3>
    <p class="muted" style="margin-bottom:12px">不限模板、不限表格数量：选一个 Excel 文件（含多少张表就处理多少张），或反复粘贴多张表。每张表自动判定"列式明细（多客户）/单户报表"，重新识别、AI 解析、一键全流程均覆盖<b>全部表格</b>。合并单元格（客户名只写第一行）自动承接，同一客户多行自动汇总。</p>
    <div class="filters">
      <label style="margin:0 8px 0 0">账务数据月：</label>
      <input type="month" id="impMonth" value="${dataMonth}">
      <input type="file" id="impFile" accept=".xlsx,.xls,.csv" style="flex:1;min-width:180px">
      <button class="btn ghost" id="pasteBtn">📋 粘贴表格</button>
      ${wbData ? '<button class="btn ghost" id="clearBtn">🗑 清空已识别表格</button>' : ''}
    </div>
    <div id="pasteWrap" style="display:none;margin-top:8px">
      <textarea id="pasteArea" placeholder="从 Excel/WPS 直接复制区域粘贴（Ctrl+V）；可多次粘贴，每张表独立识别" style="width:100%;height:110px;border:1px solid #cbd5e1;border-radius:8px;padding:8px;font-size:12px;font-family:monospace"></textarea>
      <button class="btn" id="pasteParse" style="margin-top:6px">🔍 识别这张表</button>
      <span class="muted" style="margin-left:8px">每粘贴一张点一次，多张表累加</span>
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
  const clearBtn = root.querySelector('#clearBtn');
  if (clearBtn) clearBtn.onclick = () => {
    wbData = null; sheetAn = {}; curSheet = ''; pasteCount = 0; lastPipeline = null;
    render(root, ctx);
  };
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
    pasteCount = 0;
    lastPipeline = null;
    toast(`已读取 ${f.name}：${wb.SheetNames.length} 张表格，开始全表识别`);
    analyzeAll(root, ctx);
  } catch (err) { console.error(err); toast('文件解析失败：' + err.message); }
}

function onPaste(root, ctx) {
  const text = root.querySelector('#pasteArea').value;
  if (!text.trim()) { toast('请先粘贴表格内容'); return; }
  const rows = parsePastedText(text);
  if (!rows.length) { toast('未识别到内容'); return; }
  if (!wbData) wbData = { sheetNames: [], sheets: {} };
  pasteCount += 1;
  const name = `粘贴表格${pasteCount}`;
  wbData.sheets[name] = rows;
  wbData.sheetNames.push(name);
  lastPipeline = null;
  root.querySelector('#pasteArea').value = '';
  toast(`已加入「${name}」（${rows.length} 行）`);
  analyzeAll(root, ctx);
}

/* ---------- 全表分析 ---------- */
function analyzeSheet(name) {
  const rows = wbData.sheets[name] || [];
  const headerRowIdx = detectHeaderRow(rows);
  const headers = rows[headerRowIdx] || [];
  const dataRows = rows.slice(headerRowIdx + 1).filter(r => r.some(c => String(c ?? '').trim() !== ''));
  const det = detectMode({ headers, dataRows, customers: state.customers, sheetName: name, rows });
  const an = { mode: det.mode, headerRowIdx, headers, dataRows, mapping: null, matched: [], singleClient: det.client || null, singleVals: null };
  if (det.mode === 'A') {
    an.mapping = det.guess;
    an.matched = buildMatched(an);
  } else {
    an.singleVals = extractClientFinancials(rows);
  }
  return an;
}

function buildMatched(an) {
  const mapping = an.mapping;
  const revIsAnnual = mapping.revenue >= 0 && mapping.revenue === mapping.annualRev;
  const raw = [];
  for (const r of an.dataRows) {
    const name = String(r[mapping.name] ?? '').trim();
    if (name && (name === 'undefined' || /合\s*计|总\s*计/.test(name))) continue;
    raw.push({
      name,
      revenue: !revIsAnnual && mapping.revenue >= 0 ? parseNumber(r[mapping.revenue]) : null,
      cost: mapping.cost >= 0 ? parseNumber(r[mapping.cost]) : null,
      taxTotal: mapping.tax >= 0 ? parseNumber(r[mapping.tax]) : null,
      fee: mapping.fee >= 0 ? parseNumber(r[mapping.fee]) : null,
      annualRev: mapping.annualRev >= 0 ? parseNumber(r[mapping.annualRev]) : null,
    });
  }
  // 合并单元格承接 + 同名聚合，然后匹配客户库
  return aggregateRows(raw).map(m => ({ ...m, clientId: matchClient(m.name, state.customers)?._id || null }));
}

function analyzeAll(root, ctx) {
  curSheet = wbData.sheetNames[0] || '';
  for (const name of wbData.sheetNames) sheetAn[name] = analyzeSheet(name);
  drawBody(root, ctx);
}

/* ---------- 渲染 ---------- */
function sheetTabsHtml() {
  if (!wbData || wbData.sheetNames.length <= 1) return '';
  return `<div class="filters" style="max-height:96px;overflow-y:auto">${wbData.sheetNames.map(n => {
    const an = sheetAn[n] || {};
    const badge = an.mode === 'B' ? `单户${an.singleClient ? '·' + esc(an.singleClient.name.slice(0, 6)) : ''}` : `列式·${an.matched.length}行`;
    return `<button class="btn sm ${n === curSheet ? '' : 'ghost'}" data-sheet="${esc(n)}" title="${esc(n)}">${esc(n.length > 12 ? n.slice(0, 12) + '…' : n)}<span class="muted"> ${badge}</span></button>`;
  }).join('')}</div>`;
}

function drawBody(root, ctx) {
  const body = root.querySelector('#impBody');
  if (!wbData) {
    body.innerHTML = '<div class="muted" style="text-align:center;padding:24px">选择文件或粘贴表格后，系统自动分析并展示识别结果</div>';
    return;
  }
  const an = sheetAn[curSheet];
  if (!an) { body.innerHTML = '<div class="muted">无表格</div>'; return; }
  if (an.mode === 'B') { drawModeB(body, root, ctx, an); return; }
  drawModeA(body, root, ctx, an);
}

function drawModeA(body, root, ctx, an) {
  const conf = aiConf();
  const cols = an.headers.map((h, i) => ({ i, label: `${esc(String(h).slice(0, 14)) || '第' + (i + 1) + '列'}` }));
  const mapping = an.mapping;
  const opt = (sel, allowName) => '<option value="-1">（不导入）</option>'
    + cols.map(c => `<option value="${c.i}" ${sel === c.i ? 'selected' : ''}>${allowName && mapping.name === c.i ? '👤 ' : ''}${c.label}</option>`).join('');
  const smartTag = v => v >= 0 ? '<span class="st done">🤖 已识别</span>' : '<span class="st todo">未识别·请选</span>';
  const aSheets = wbData.sheetNames.filter(n => sheetAn[n] && sheetAn[n].mode === 'A');
  const totalRows = aSheets.reduce((a, n) => a + sheetAn[n].matched.length, 0);
  const bSheets = wbData.sheetNames.filter(n => sheetAn[n] && sheetAn[n].mode === 'B').length;
  const resultBanner = lastPipeline ? `<div class="msgbox" style="margin:0 0 10px">🚀 <b>处理完成</b>：${lastPipeline.text}</div>` : '';
  const emptyLibTip = state.customers.length === 0 && totalRows > 0
    ? '<div class="banner" style="margin:0 0 10px">💡 客户库为空？没关系——点下方「🚀 一键匹配·建档·完成全流程」会按表格自动建档、分层并串起后续全流程。</div>' : '';
  body.innerHTML = `
  ${sheetTabsHtml()}
  <div class="panel">
    <h3>🔍 智能识别结果 <span class="st done">列式明细表</span>
      <span class="muted">当前表「${esc(curSheet)}」：表头第 ${an.headerRowIdx + 1} 行 ｜ ${an.matched.length} 户（同名已汇总）</span></h3>
    <div class="muted" style="margin-bottom:10px">共识别 <b>${wbData.sheetNames.length}</b> 张表：列式 ${aSheets.length} 张（合计 ${totalRows} 户）｜单户 ${bSheets} 张</div>
    ${resultBanner}${emptyLibTip}
    <div class="filters">
      <label style="margin:0">客户列：</label><select id="mName">${opt(mapping.name, false)}</select>${smartTag(mapping.name)}
      <label style="margin:0 0 0 10px">收入列：</label><select id="mRev">${opt(mapping.revenue)}</select>${smartTag(mapping.revenue)}
      <label style="margin:0 0 0 10px">成本列：</label><select id="mCost">${opt(mapping.cost)}</select>${smartTag(mapping.cost)}
      <label style="margin:0 0 0 10px">税金列：</label><select id="mTax">${opt(mapping.tax)}</select>${smartTag(mapping.tax)}
      <button class="btn ghost sm" id="reGuess">↻ 重新识别全部表格</button>
      ${conf && conf.apiKey
        ? `<button class="btn sm" id="aiBtn">🤖 AI 解析全部表格（${aSheets.length} 张）</button>`
        : '<span class="muted">💡 在设置页配置 AI 接口后，可让大模型解析全部表格</span>'}
    </div>
    <table><thead><tr><th>表格中的名称</th><th>匹配到系统客户</th><th>收入</th><th>成本</th><th>税金合计</th></tr></thead>
    <tbody>${an.matched.slice(0, 150).map(m => `<tr class="${m.clientId ? 'okrow' : 'newrow'}">
      <td>${esc(m.name)}</td>
      <td><select class="rowMatch" data-row="${esc(m.name)}">
        ${m.clientId ? '' : '<option value="" selected>🆕 一键时自动新建客户</option>'}
        ${state.customers.map(c => `<option value="${c._id}" ${c._id === m.clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select></td>
      <td>${m.revenue ?? '—'}</td><td>${m.cost ?? '—'}</td><td>${m.taxTotal ?? '—'}</td>
    </tr>`).join('')}</tbody></table>
    <div style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn" id="autoBtn">🚀 一键匹配·建档·完成全流程（全部表格）</button>
      <button class="btn ghost" id="reMatch">🔗 一键匹配（全部表格）</button>
      <button class="btn ghost" id="impSave">仅保存当前表财务数据（精细模式）</button>
    </div>
    <p class="muted" style="margin-top:8px">匹配规则：表格名与客户库自动对齐（简称/别名/括号注记/公共子串）→ 匹配上的直接挂数据；库中没有的行自动新建客户并分层。手工下拉仅作精确指定用。</p>
  </div>`;

  body.querySelectorAll('[data-sheet]').forEach(b => b.onclick = () => { curSheet = b.dataset.sheet; drawBody(root, ctx); });
  const M = { mName: 'name', mRev: 'revenue', mCost: 'cost', mTax: 'tax' };
  Object.entries(M).forEach(([id, k]) => {
    const el = body.querySelector('#' + id);
    if (el) el.onchange = e => {
      mapping[k] = parseInt(e.target.value);
      an.matched = buildMatched(an);
      drawBody(root, ctx);
    };
  });
  body.querySelector('#reGuess').onclick = () => { analyzeAll(root, ctx); toast('已重新识别全部表格'); };
  body.querySelector('#reMatch').onclick = () => {
    for (const n of wbData.sheetNames) { const a = sheetAn[n]; if (a && a.mode === 'A') a.matched = buildMatched(a); }
    drawBody(root, ctx);
    let hit = 0, total = 0;
    aSheets.forEach(n => { total += sheetAn[n].matched.length; hit += sheetAn[n].matched.filter(m => m.clientId).length; });
    toast(hit ? `🔗 匹配完成：${hit}/${total} 行已对上客户库` : '客户库中暂无可匹配客户——点🚀将自动建档');
  };
  const aiBtn = body.querySelector('#aiBtn');
  if (aiBtn) aiBtn.onclick = () => aiParseAll(root, ctx);
  body.querySelectorAll('.rowMatch').forEach(s => s.onchange = e => {
    const m = an.matched.find(x => x.name === s.dataset.row);
    if (m) m.clientId = e.target.value || null;
  });
  body.querySelector('#autoBtn').onclick = () => autoProcess(root, ctx);
  body.querySelector('#impSave').onclick = saveImport;
}

function drawModeB(body, root, ctx, an) {
  const c = an.singleClient;
  const conf = aiConf();
  body.innerHTML = `
  ${sheetTabsHtml()}
  <div class="panel">
    <h3>🔍 智能识别结果 <span class="st done">单户报表（行式取数）</span> <span class="muted">当前表「${esc(curSheet)}」</span></h3>
    ${c ? `<div class="msgbox" style="margin-bottom:12px">识别为 <b>${esc(c.name)}</b>（${c.tier}）的报表：表名/标题命中客户名，已按科目标签行取数。一键全流程时将自动保存其财务与税金。</div>`
        : `<div class="banner" style="margin:0 0 12px">未从表名/标题识别到客户——此表将在一键全流程中跳过；可在「客户分层」先建档后重新识别，或点下方按列式处理。</div>`}
    <div class="paper" style="max-width:460px">
      <div class="row"><span>收入（营业收入等）</span><span><input class="mini-input" id="sb_rev" type="number" value="${an.singleVals?.revenue ?? ''}"> 元</span></div>
      <div class="row"><span>成本（营业成本等）</span><span><input class="mini-input" id="sb_cost" type="number" value="${an.singleVals?.cost ?? ''}"> 元</span></div>
      <div class="row"><span>税金（税金及附加/应交税费等）</span><span><input class="mini-input" id="sb_tax" type="number" value="${an.singleVals?.tax ?? ''}"> 元</span></div>
      <div class="copybar">
        <button class="btn ghost" id="sbSave">💾 仅保存此表到 ${dataMonth}</button>
        <button class="btn ghost" id="sbModeA">按列式明细处理</button>
        <button class="btn" id="goAuto">🚀 去一键全流程</button>
      </div>
    </div>
  </div>`;
  body.querySelector('#sbSave').onclick = async () => {
    if (!c) { toast('未识别客户，无法保存'); return; }
    await store.upsert('financials', {
      _id: `f_${dataMonth}_${c._id}`, month: dataMonth, clientId: c._id, clientName: c.name,
      revenue: parseFloat(document.getElementById('sb_rev').value) || 0,
      cost: parseFloat(document.getElementById('sb_cost').value) || 0,
      taxTotal: parseFloat(document.getElementById('sb_tax').value) || 0,
      importedAt: new Date().toISOString().slice(0, 10),
    });
    await loadAll();
    toast(`✓ 已保存 ${c.name}（${dataMonth}）`);
  };
  body.querySelector('#sbModeA').onclick = () => {
    an.mode = 'A';
    an.mapping = guessColumns(an.headers, an.dataRows, state.customers);
    an.matched = buildMatched(an);
    drawBody(root, ctx);
  };
  body.querySelector('#goAuto').onclick = () => autoProcess(root, ctx);
}

async function saveImport() {
  const an = sheetAn[curSheet];
  if (!an || an.mode !== 'A') { toast('当前表不是列式明细'); return; }
  const docs = an.matched.filter(m => m.clientId).map(m => {
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

/* ---------- 🚀 一键管线：全部表格 → 拆分→建档→分层→财务→税金→任务 ---------- */
async function autoProcess(root, ctx) {
  const s = state.settings;
  const created = [], finDocs = [], taxDocs = [];
  let matchedCnt = 0, bSaved = 0, skippedB = 0;

  for (const name of wbData.sheetNames) {
    const an = sheetAn[name];
    if (!an) continue;
    if (an.mode === 'B') {
      // 单户报表：已识别客户才处理
      const c = an.singleClient;
      const v = an.singleVals || {};
      if (!c) { skippedB++; continue; }
      if (v.revenue != null || v.cost != null || v.tax != null) {
        finDocs.push({
          _id: `f_${dataMonth}_${c._id}`, month: dataMonth, clientId: c._id, clientName: c.name,
          revenue: v.revenue || 0, cost: v.cost || 0, taxTotal: v.tax || 0,
          importedAt: new Date().toISOString().slice(0, 10),
        });
        bSaved++;
      }
      if (v.tax != null && v.tax > 0) {
        taxDocs.push({
          _id: `x_${state.month}_${c._id}`, month: state.month, clientId: c._id, clientName: c.name,
          state: 'ready', amounts: { vat: 0, sur: 0, it: 0, cit: 0, total: v.tax },
        });
      }
      continue;
    }
    for (const m of an.matched) {
      let client = m.clientId ? state.customers.find(c => c._id === m.clientId) : null;
      if (client) { matchedCnt++; }
      else {
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
      if (m.revenue != null || m.cost != null || m.taxTotal != null) {
        finDocs.push({
          _id: `f_${dataMonth}_${client._id}`, month: dataMonth, clientId: client._id, clientName: client.name,
          revenue: m.revenue || 0, cost: m.cost || 0, taxTotal: m.taxTotal || 0,
          importedAt: new Date().toISOString().slice(0, 10),
        });
      }
      if (m.taxTotal != null && m.taxTotal > 0) {
        taxDocs.push({
          _id: `x_${state.month}_${client._id}`, month: state.month, clientId: client._id, clientName: client.name,
          state: 'ready', amounts: { vat: 0, sur: 0, it: 0, cit: 0, total: m.taxTotal },
        });
      }
    }
  }

  if (finDocs.length) await store.upsertMany('financials', finDocs);
  if (taxDocs.length) await store.upsertMany('taxConfirm', taxDocs);
  state.customers = await store.list('customers');

  // 生成当月任务（幂等）
  const existTasks = await store.list('monthTasks', { month: state.month });
  const existIds = new Set(existTasks.map(t => t._id));
  const docs = buildMonthTasks(state.month, state.customers, s.ownersMap, {
    disabledKeys: s.disabledTemplateKeys || [],
    customTemplates: s.customTemplates || [],
  }).filter(d => !existIds.has(d._id));
  if (docs.length) await store.upsertMany('monthTasks', docs);
  await loadAll();

  const tierDist = { S3: 0, S2: 0, S1: 0 };
  created.forEach(c => tierDist[c.tier]++);
  lastPipeline = {
    text:
      `覆盖 ${wbData.sheetNames.length} 张表（单户另存 ${bSaved} 张${skippedB ? '，跳过未识别 ' + skippedB + ' 张' : ''}）｜` +
      `建档 <b>${created.length}</b> 家（S3×${tierDist.S3} S2×${tierDist.S2} S1×${tierDist.S1}）｜匹配既有 <b>${matchedCnt}</b> 家 ｜ ` +
      `财务落库 <b>${finDocs.length}</b> 条（${dataMonth}）｜ 税金预填 <b>${taxDocs.length}</b> 户（${state.month}）｜ ` +
      `月度任务 <b>${docs.length ? '新生成 ' + docs.length + ' 项' : '已存在'}</b>`,
  };
  drawBody(root, ctx);
  toast('🚀 一键处理完成（全部表格），各页面已就绪');
}

/* ---------- AI 大模型解析（可选 · 全部列式表格） ---------- */
async function aiParseAll(root, ctx) {
  const conf = aiConf();
  if (!conf || !conf.apiKey) { toast('请先在设置页配置 AI 接口'); return; }
  const aSheets = wbData.sheetNames.filter(n => sheetAn[n] && sheetAn[n].mode === 'A');
  if (!aSheets.length) { toast('没有列式表格需要 AI 解析'); return; }
  toast(`🤖 AI 逐表解析中（${aSheets.length} 张）…`);
  const sys = '你是代账公司的表格解析助手。用户给你一段从Excel复制/解析出的TSV表格数据（第一行为表头）。请提取每个客户的一行数据：客户名(name)、收入(revenue)、成本(cost)、税金合计(tax)，数值为纯数字（原值，不要换算单位）。没有的项用0。跳过合计/空行。只输出一个JSON数组，如 [{"name":"xx公司","revenue":1000,"cost":500,"tax":50}]，不要任何解释文字。';
  let okCnt = 0, failCnt = 0, totalHit = 0;
  for (const name of aSheets) {
    const an = sheetAn[name];
    const tsv = [an.headers.map(h => String(h ?? '')).join('\t'), ...an.dataRows.map(r => r.map(c => String(c ?? '')).join('\t'))].join('\n').slice(0, 9000);
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
      if (!m) throw new Error('未返回有效 JSON');
      const arr = JSON.parse(m[0]);
      for (const item of arr) {
        const cl = matchClient(item.name || '', state.customers);
        if (!cl) continue;
        let row = an.matched.find(x => x.clientId === cl._id);
        if (!row) { row = { name: item.name, clientId: cl._id }; an.matched.push(row); }
        row.revenue = item.revenue ?? row.revenue;
        row.cost = item.cost ?? row.cost;
        row.taxTotal = item.tax ?? row.taxTotal;
        totalHit++;
      }
      okCnt++;
    } catch (e) {
      console.error('AI sheet fail:', name, e);
      failCnt++;
    }
  }
  drawBody(root, ctx);
  toast(`🤖 AI 完成：成功 ${okCnt}/${aSheets.length} 张，匹配客户库 ${totalHit} 户${failCnt ? '（' + failCnt + ' 张失败，可用离线识别兜底）' : ''}`);
}
