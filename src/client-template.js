// 客户名单模板解析引擎：适配「ZC-客户信息导入模板.xlsx」v2（列序对齐股改明细表）
// 能力：表头定位 / 列名映射（兼容旧表头）/ 日期归一（2026-09-01、20260901、Excel序列号）/ 示例·合计行剔除 / 税号→名称匹配建档
// 纯函数模块，无 DOM 依赖，可在 Node 中测试
import { tierOf } from './templates.js';
import { parseNumber, normName, matchClient } from './smart-import.js';

const cellText = v => String(v ?? '').replace(/\r/g, '').trim();
const r2 = n => Math.round(n * 100) / 100;

// 税号归一：数字防精度丢失、去空格、统一大写
export function normTax(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return String(Math.round(v));
  return String(v).replace(/\s+/g, '').toUpperCase();
}

// 日期归一 → 'YYYY-MM-DD'。兼容：Date / Excel序列号(20000..60000) / 数字或文本 YYYYMMDD / 2026-9-1 / 2026/9/1 / 2026.9.1 / 2026年9月1日
export function normDate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return isNaN(v) ? '' : ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number' && isFinite(v)) {
    if (v > 20000000) {
      const s = String(Math.round(v));
      return s.length === 8 ? ymd(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8)) : '';
    }
    if (v >= 20000 && v <= 60000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return '';
  }
  const s = String(v).trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  if (/^\d{8}$/.test(s)) return ymd(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8));
  return '';
}
const ymd = (y, mo, d) => {
  const dt = new Date(y, mo - 1, d);
  return isNaN(dt) ? '' : dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
};

// 表头行定位：同时含「纳税人识别号/税号」与「公司名称」的行
export function locateTemplateHeader(rows, maxScan = 15) {
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const j = (rows[i] || []).map(cellText).join('|');
    if (/纳税人识别|信用代码|税号/.test(j) && /公司名称|客户名称|单位名称/.test(j)) return i;
  }
  // 兜底：关键词命中数≥3
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const j = (rows[i] || []).map(cellText).join('|');
    const hits = ['有效期', '记账费', '营业额', '客户来源', '联系人'].filter(k => j.includes(k)).length;
    if (hits >= 3) return i;
  }
  return -1;
}

// 列名映射 → 字段索引。顺序敏感：月记账费须先于年记账费判定
const COL_RULES = [
  ['tax', /纳税人识别|信用代码|税号/],
  ['name', /公司名称|客户名称|单位名称|^名称$/],
  ['start', /有效期起|合同开始|起始日期|开始日期/],
  ['end', /有效期止|合同结束|结束日期|到期日期|到期日/],
  ['contractAmount', /合同金额/],
  ['commission', /佣金/],
  ['monthFee', /月记账费|月费/],
  ['annualFee', /年记账费|记账费|年费/],
  ['source', /客户来源|来源|渠道/],
  ['revenue', /营业额|产值|销售额/],
  ['cycle', /收费周期|收费方式|收费频次/],
  ['contact', /^联系人$|^联系人姓名$/],
  ['phone', /联系电话|电话|手机/],
  ['introducer', /介绍人|推荐人/],
  ['remark', /备注|说明/],
];
export function mapTemplateColumns(headers) {
  const col = {};
  headers.forEach((h, i) => {
    const t = cellText(h);
    if (!t) return;
    for (const [key, re] of COL_RULES) {
      if (col[key] === undefined && re.test(t)) { col[key] = i; return; }
    }
  });
  return col;
}

// 解析工作表 → { ok, headerRow, cutoff, items, skipped, warnings }
export function parseClientTemplate(rows) {
  const hr = locateTemplateHeader(rows);
  if (hr < 0) return { ok: false, error: '未找到模板表头（需同时包含「纳税人识别号」和「公司名称」两列）' };
  const col = mapTemplateColumns(rows[hr] || []);
  if (col.name === undefined) return { ok: false, error: '表头缺少「公司名称」列' };

  // 营业额截止日期：表头上方含「截止」的单元格，优先取右侧一格，其次从本格文字中提取
  let cutoff = '';
  for (let i = 0; i < hr && !cutoff; i++) {
    const cells = rows[i] || [];
    for (let j = 0; j < cells.length; j++) {
      const t = cellText(cells[j]);
      if (!t || !/截止/.test(t)) continue;
      if (j + 1 < cells.length) {
        const right = normDate(cells[j + 1]);
        if (right) { cutoff = right; break; }
      }
      const m = t.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/) || t.match(/((?:20)\d{2})(\d{2})(\d{2})/);
      if (m) { cutoff = ymd(+m[1], +m[2], +m[3]); break; }
    }
  }

  const items = [], skipped = [], warnings = [];
  const g = (k, cells) => (col[k] !== undefined ? cells[col[k]] : '');
  for (let r = hr + 1; r < rows.length; r++) {
    const cells = rows[r] || [];
    const rowNo = r + 1;
    const name = cellText(g('name', cells));
    const tax = normTax(g('tax', cells));
    const rowText = cells.map(cellText).join('|');
    if (!name && /合计|总计|小计|汇总/.test(rowText)) { skipped.push({ row: rowNo, name: '', reason: '合计行' }); continue; }
    if (!name && !tax) continue; // 其余空行静默
    if (/^(示例|样例)/.test(name)) { skipped.push({ row: rowNo, name, reason: '示例行' }); continue; }
    if (/合计|总计|小计|汇总/.test(name)) { skipped.push({ row: rowNo, name, reason: '合计行' }); continue; }
    if (!name) { skipped.push({ row: rowNo, name, reason: '缺公司名称', tax }); continue; }

    const annualFeeRaw = parseNumber(g('annualFee', cells));
    let monthFeeRaw = parseNumber(g('monthFee', cells));
    let annualFee = annualFeeRaw;
    if (annualFee != null && annualFee > 0) monthFeeRaw = r2(annualFee / 12); // 系统口径：年÷12
    else if (annualFee == null && monthFeeRaw != null && monthFeeRaw > 0) annualFee = Math.round(monthFeeRaw * 12); // 只有月费时反推

    items.push({
      _row: rowNo, name, tax,
      start: normDate(g('start', cells)),
      end: normDate(g('end', cells)),
      contractAmount: parseNumber(g('contractAmount', cells)),
      commission: parseNumber(g('commission', cells)),
      annualFee, monthFee: monthFeeRaw,
      source: cellText(g('source', cells)),
      revenue: parseNumber(g('revenue', cells)),
      cycle: cellText(g('cycle', cells)),
      contact: cellText(g('contact', cells)),
      phone: typeof g('phone', cells) === 'number' ? String(Math.round(g('phone', cells))) : cellText(g('phone', cells)),
      introducer: cellText(g('introducer', cells)),
      remark: cellText(g('remark', cells)),
    });
  }
  // 文件内查重：同税号/同名后行覆盖前行
  const seen = new Map();
  for (const it of items) {
    const key = it.tax || 'N:' + normName(it.name);
    if (seen.has(key)) warnings.push('第 ' + it._row + ' 行与第 ' + seen.get(key) + ' 行为同一客户（' + (it.tax ? '税号' : '名称') + '相同），取后一行数据');
    seen.set(key, it._row);
  }
  return { ok: true, headerRow: hr, cutoff, items, skipped, warnings };
}

// 生成导入计划：creates / updates / rows（预览用）。 customers 为当前客户库
export function planClientImport(items, customers) {
  const creates = [], updates = [], rows = [], warnings = [];
  // 文件内去重：同税号/同名取后一行（与解析阶段告警口径一致），避免同一客户出两条动作
  const uniq = new Map();
  for (const it of items) uniq.set(it.tax || 'N:' + normName(it.name), it);
  const byTax = new Map(customers.filter(c => c.taxNo).map(c => [normTax(c.taxNo), c]));
  let seq = 0;
  for (const c of customers) {
    const m = (c._id || '').match(/^c_(\d+)$/);
    if (m) seq = Math.max(seq, +m[1]);
  }
  for (const it of uniq.values()) {
    let target = null, via = '';
    if (it.tax && byTax.has(it.tax)) { target = byTax.get(it.tax); via = '税号'; }
    if (!target) {
      const c = matchClient(it.name, customers);
      if (c) { target = c; via = '名称'; }
    }
    if (target) {
      const doc = buildDoc(it, target);
      if (target.archived) { doc.archived = false; warnings.push('「' + it.name + '」匹配到已归档客户，将同时恢复为在库'); }
      updates.push(doc);
      rows.push(previewRow(it, { action: 'update', via, tier: doc.tier, monthFee: doc.monthlyFee }));
    } else {
      seq += 1;
      const doc = buildDoc(it, null, 'c_' + String(seq).padStart(3, '0'));
      creates.push(doc);
      rows.push(previewRow(it, { action: 'create', tier: doc.tier, monthFee: doc.monthlyFee }));
    }
  }
  return { creates, updates, rows, warnings };
}

function buildDoc(it, prev, newId) {
  const annualFee = it.annualFee != null ? it.annualFee
    : (it.monthFee != null ? r2(it.monthFee * 12)
    : (prev ? (prev.annualFee ?? 0) : 0));
  const revenue = it.revenue != null ? it.revenue : (prev ? (prev.revenue ?? 0) : 0);
  const tierManual = prev ? prev.tierManual === true : false; // 手动锁档客户不重划
  const tier = tierManual && prev ? (prev.tier || tierOf(revenue)) : tierOf(revenue);
  const ownerRole = tier === 'S1' ? 'assist' : 'lead';
  return {
    ...(prev || {}),
    _id: prev ? prev._id : newId,
    name: prev ? prev.name : it.name, // 在库客户保留规范名称（模板注记如「（鑫田）」仅用于匹配）
    taxNo: it.tax || (prev ? prev.taxNo || '' : ''),
    source: it.source || (prev ? prev.source || '' : ''),
    contractStart: it.start || (prev ? prev.contractStart || '' : ''),
    contractEnd: it.end || (prev ? prev.contractEnd || '' : ''),
    annualFee, monthlyFee: r2(annualFee / 12), revenue,
    contact: it.contact || (prev ? prev.contact || '' : ''),
    phone: it.phone || (prev ? prev.phone || '' : ''),
    introducer: it.introducer || (prev ? prev.introducer || '' : ''),
    remark: it.remark || (prev ? prev.remark || '' : ''),
    contractAmount: it.contractAmount != null ? it.contractAmount : (prev ? (prev.contractAmount ?? 0) : 0),
    commission: it.commission != null ? it.commission : (prev ? (prev.commission ?? 0) : 0),
    payCycle: it.cycle || (prev ? prev.payCycle || '' : ''),
    tier, tierManual, ownerRole,
    archived: prev ? !!prev.archived : false,
  };
}

const previewRow = (it, extra) => ({
  row: it._row, name: it.name, tax: it.tax, end: it.end,
  annualFee: it.annualFee, revenue: it.revenue,
  ...extra,
});
