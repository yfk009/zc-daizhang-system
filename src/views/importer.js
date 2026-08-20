// 金蝶/用友 Excel 导入：列映射 + 客户名匹配 + 落库 financials
import { esc, toast } from '../ui.js';
import { state, loadAll, prevDataMonth } from '../app-state.js';
import { store } from '../db.js';

let wbData = null;      // { sheets: {name: rows[]}, sheetNames: [] }
let curSheet = '';
let mapping = { name: -1, revenue: -1, cost: -1, tax: -1 };
let dataMonth = '';
let matched = [];       // [{row, client, revenue, cost, taxTotal}]

export function render(root, ctx) {
  if (!dataMonth) dataMonth = prevDataMonth();
  root.innerHTML = `
  <div class="panel">
    <h3>📥 金蝶/用友报表导入（月度经营数据）</h3>
    <p class="muted" style="margin-bottom:12px">支持 .xlsx/.xls/.csv。建议导出「利润表/科目余额表」或自制三列汇总表（客户名、收入、成本、税金合计）。导入后自动供月度简报、偏差报告、税金确认取数。</p>
    <div class="filters">
      <label style="margin:0 8px 0 0">账务数据月：</label>
      <input type="month" id="impMonth" value="${dataMonth}">
      <input type="file" id="impFile" accept=".xlsx,.xls,.csv" style="flex:1;min-width:200px">
    </div>
    <div id="impBody"></div>
  </div>`;
  root.querySelector('#impMonth').onchange = e => { dataMonth = e.target.value || prevDataMonth(); drawBody(root, ctx); };
  root.querySelector('#impFile').onchange = e => onFile(e, root, ctx);
  drawBody(root, ctx);
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
    guessMapping();
    toast(`已读取 ${f.name}（${wb.SheetNames.length} 个工作表）`);
    drawBody(root, ctx);
  } catch (err) { console.error(err); toast('文件解析失败：' + err.message); }
}

function guessMapping() {
  const rows = wbData.sheets[curSheet] || [];
  const header = (rows[0] || []).map(h => String(h));
  mapping = { name: -1, revenue: -1, cost: -1, tax: -1 };
  header.forEach((h, i) => {
    if (mapping.name < 0 && /客户|公司|单位|名称/.test(h)) mapping.name = i;
    if (mapping.revenue < 0 && /收入|营业收入|主营业务收入/.test(h)) mapping.revenue = i;
    if (mapping.cost < 0 && /成本|营业成本|主营业务成本/.test(h)) mapping.cost = i;
    if (mapping.tax < 0 && /税|税金|税负|应交/.test(h)) mapping.tax = i;
  });
  if (mapping.name < 0) mapping.name = 0;
  doMatch();
}

function doMatch() {
  const rows = (wbData.sheets[curSheet] || []).slice(1); // 跳表头
  matched = [];
  for (const r of rows) {
    const name = String(r[mapping.name] ?? '').trim();
    if (!name || name === 'undefined') continue;
    const client = matchClient(name);
    matched.push({
      name,
      clientId: client ? client._id : null,
      revenue: num(r[mapping.revenue]),
      cost: num(r[mapping.cost]),
      taxTotal: num(r[mapping.tax]),
    });
  }
}
function num(v) { const n = parseFloat(String(v ?? '').replace(/[,，\s]/g, '')); return isNaN(n) ? null : n; }
function matchClient(name) {
  const short = name.replace(/（.*?）|\(.*?\)/g, '').replace(/有限责任公司|股份有限公司|有限公司|公司/g, '');
  return state.customers.find(c => c.name === name)
    || state.customers.find(c => c.name.includes(short) && short.length >= 4)
    || state.customers.find(c => c.name.includes(name) || name.includes(c.name.replace(/（.*?）/g, '')));
}

function drawBody(root, ctx) {
  const body = root.querySelector('#impBody');
  if (!wbData) {
    body.innerHTML = '<div class="muted" style="text-align:center;padding:24px">选择文件后在此配置列映射并预览</div>';
    return;
  }
  const header = (wbData.sheets[curSheet][0] || []).map(h => String(h));
  const opt = (sel) => '<option value="-1">（不导入）</option>' + header.map((h, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(h) || '第' + (i + 1) + '列'}</option>`).join('');
  body.innerHTML = `
    <div class="filters">
      <label style="margin:0 8px 0 0">工作表：</label>
      <select id="impSheet">${wbData.sheetNames.map(n => `<option ${n === curSheet ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <label style="margin:0 8px">客户名列：</label><select id="mName">${opt(mapping.name)}</select>
      <label style="margin:0 8px">收入列：</label><select id="mRev">${opt(mapping.revenue)}</select>
      <label style="margin:0 8px">成本列：</label><select id="mCost">${opt(mapping.cost)}</select>
      <label style="margin:0 8px">税金列：</label><select id="mTax">${opt(mapping.tax)}</select>
    </div>
    <table><thead><tr><th>Excel 客户名</th><th>匹配到系统客户</th><th>收入</th><th>成本</th><th>税金合计</th></tr></thead>
    <tbody>${matched.slice(0, 100).map(m => `<tr class="${m.clientId ? '' : 'blocked'}">
      <td>${esc(m.name)}</td>
      <td>${m.clientId ? `<select data-row="${esc(m.name)}" class="rowMatch">` + state.customers.map(c => `<option value="${c._id}" ${c._id === m.clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('') + '</select>' : `<select data-row="${esc(m.name)}" class="rowMatch"><option value="">— 未匹配（跳过） —</option>` + state.customers.map(c => `<option value="${c._id}">${esc(c.name)}</option>`).join('') + '</select>'}</td>
      <td>${m.revenue ?? '—'}</td><td>${m.cost ?? '—'}</td><td>${m.taxTotal ?? '—'}</td>
    </tr>`).join('')}</tbody></table>
    <div style="margin-top:14px;display:flex;gap:10px;align-items:center">
      <button class="btn" id="impSave">💾 保存 ${matched.filter(m => m.clientId).length} 条到 ${dataMonth}</button>
      <span class="muted">未匹配行可手动指定客户或留空跳过</span>
    </div>`;
  root.querySelector('#impSheet').onchange = e => { curSheet = e.target.value; guessMapping(); drawBody(root, ctx); };
  ['mName', 'mRev', 'mCost', 'mTax'].forEach(id => {
    root.querySelector('#' + id).onchange = e => {
      const k = { mName: 'name', mRev: 'revenue', mCost: 'cost', mTax: 'tax' }[id];
      mapping[k] = parseInt(e.target.value); doMatch(); drawBody(root, ctx);
    };
  });
  body.querySelectorAll('.rowMatch').forEach(s => s.onchange = e => {
    const rowName = s.dataset.row;
    const m = matched.find(x => x.name === rowName);
    if (m) m.clientId = e.target.value || null;
    const btn = body.querySelector('#impSave');
    if (btn) btn.textContent = `💾 保存 ${matched.filter(x => x.clientId).length} 条到 ${dataMonth}`;
  });
  body.querySelector('#impSave').onclick = saveImport;
}

async function saveImport() {
  const docs = matched.filter(m => m.clientId).map(m => {
    const c = state.customers.find(x => x._id === m.clientId);
    return {
      _id: `f_${dataMonth}_${m.clientId}`,
      month: dataMonth, clientId: m.clientId, clientName: c ? c.name : m.name,
      revenue: m.revenue || 0, cost: m.cost || 0, taxTotal: m.taxTotal || 0,
      importedAt: new Date().toISOString().slice(0, 10),
    };
  });
  if (!docs.length) { toast('没有可保存的行（请先匹配客户）'); return; }
  await store.upsertMany('financials', docs);
  await loadAll();
  toast(`✓ 已保存 ${docs.length} 条到 ${dataMonth}，交付物页可直接取数`);
}
