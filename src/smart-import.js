// 智能表格解析引擎：不依赖固定模板
// 能力：表头行自动定位 / 列角色自动识别（客户名/收入/成本/税金）/ 客户库模糊匹配 / 单户报表(行式)识别
// 纯函数模块，无 DOM 依赖，可在 Node 中测试

const cellText = v => String(v ?? '').replace(/\r/g, '').trim();

// 数字解析：去千分位/货币符号/全角逗号
export function parseNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).replace(/[,\s￥¥]/g, '').replace(/，/g, '').replace(/（/g, '-').replace(/）/g, '');
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

// 客户名归一化：去括号注记与公司后缀
export function normName(s) {
  return String(s ?? '')
    .replace(/[（(][^（()）]*[)）]/g, '')
    .replace(/有限责任公司|股份有限公司|有限公司|合伙企业|公司|经营部|个体户|中心|厂|店/g, '')
    .replace(/\s+/g, '');
}

// 最长公共连续子串长度（名称都短，双循环滑窗足够）
function lcsLen(a, b) {
  if (!a || !b) return 0;
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > max) max = k;
    }
  }
  return max;
}

// 与客户库匹配：精确 → 双向包含（原名）→ 双向包含（归一化）→ 最长公共子串（≥5字且占较短名60%）
export function matchClient(raw, customers) {
  const t = cellText(raw);
  if (!t || !customers || !customers.length) return null;
  const exact = customers.find(c => c.name === t);
  if (exact) return exact;
  const nt = normName(t);
  if (nt.length < 2) return null;
  let fallback = null;
  let bestLcs = 0, bestLcsClient = null;
  for (const c of customers) {
    if (t.includes(c.name) || c.name.includes(t)) return c;
    const nc = normName(c.name);
    if (!nc) continue;
    if ((nt.includes(nc) || nc.includes(nt)) && nc.length >= 2) fallback = fallback || c;
    const l = lcsLen(nt, nc);
    if (l >= 5 && l / Math.min(nt.length, nc.length) >= 0.6 && l > bestLcs) { bestLcs = l; bestLcsClient = c; }
  }
  return fallback || bestLcsClient;
}

// 表头行定位：关键词命中最多且非纯数字的行
const HEADER_KW = /客户|公司|单位|名称|科目|企业|金额|收入|成本|税|余额|借方|贷方|数量|日期|期初|期末|本期|累计|销项|进项|往来/;
export function detectHeaderRow(rows, maxScan = 12) {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const cells = (rows[i] || []).map(cellText).filter(Boolean);
    if (cells.length < 2) continue;
    const kw = cells.filter(c => HEADER_KW.test(c)).length;
    const nums = cells.filter(c => /^-?[\d,.%]+$/.test(c)).length;
    const score = kw * 2 - nums * 1.5 + Math.min(cells.length, 10) * 0.1;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return bestScore >= 2 ? best : 0;
}

const REV_RE = /收入|销项|开票|销售额|营业额|主营业务/;
const COST_RE = /成本|进项|采购|购进|材料|劳务/;
const TAX_RE = /税/;
const FEE_RE = /年费|记账费|代理费|服务费|年度费/;
const ANNUAL_REV_RE = /年.{0,2}营业额|营业额|年销售额|年开票|年产值/;

// 列角色识别（列式明细表）
// 返回 { name, revenue, cost, tax, fee, annualRev, numericCols, nameMatchRate }
export function guessColumns(headers, dataRows, customers) {
  const n = Math.max(headers.length, dataRows.reduce((m, r) => Math.max(m, r.length), 0));
  const info = [];
  for (let c = 0; c < n; c++) {
    const h = cellText(headers[c]);
    const vals = dataRows.map(r => r[c]).filter(v => cellText(v) !== '');
    const nums = vals.filter(v => parseNumber(v) != null);
    const texts = vals.map(cellText);
    const matchRate = texts.length && customers.length
      ? texts.filter(t => matchClient(t, customers)).length / texts.length : 0;
    info.push({
      c, h, numericRate: vals.length ? nums.length / vals.length : 0, matchRate,
      sum: nums.reduce((a, v) => a + parseNumber(v), 0),
    });
  }
  // 客户列：客户库命中率 + 表头关键词 加权
  let name = -1, nameScore = 0;
  for (const ci of info) {
    const s = ci.matchRate * 10 + (/客户|公司|单位|名称|企业|科目|往来/.test(ci.h) ? 2.5 : 0) + (ci.numericRate < 0.3 ? 1 : 0);
    if (s > nameScore && s >= 2) { nameScore = s; name = ci.c; }
  }
  const numCols = info.filter(ci => ci.numericRate >= 0.5 && ci.c !== name);
  const pick = re => {
    const hits = numCols.filter(ci => re.test(ci.h) && !/率|比|%/.test(ci.h));
    return hits.length ? hits[0].c : -1;
  };
  return {
    name, revenue: pick(REV_RE), cost: pick(COST_RE), tax: pick(TAX_RE),
    fee: pick(FEE_RE), annualRev: pick(ANNUAL_REV_RE),
    numericCols: numCols.map(ci => ci.c),
    nameMatchRate: name >= 0 ? info[name].matchRate : 0,
  };
}

// 单户报表识别：sheet 名或表首几行文本包含某客户名 → 该表属于此客户
export function detectSingleClient(rows, sheetName, customers) {
  const texts = [cellText(sheetName)];
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    for (const v of (rows[i] || [])) {
      const t = cellText(v);
      if (t.length >= 3 && parseNumber(t) == null) texts.push(t);
    }
  }
  for (const c of customers) {
    if (texts.some(t => t.includes(c.name) || c.name.includes(normName(t)))) return c;
  }
  return null;
}

// 单户报表取数（行式）：按科目标签行向右取第一个数值
export function extractClientFinancials(rows) {
  const find = re => {
    for (let ri = 0; ri < Math.min(rows.length, 80); ri++) {
      const row = rows[ri] || [];
      for (let ci = 0; ci < Math.min(row.length, 4); ci++) {
        if (re.test(cellText(row[ci]))) {
          for (let k = ci + 1; k < row.length; k++) {
            const v = parseNumber(row[k]);
            if (v != null) return v;
          }
        }
      }
    }
    return null;
  };
  return {
    revenue: find(/主营业务收入|营业收入|收入合计|本期收入/),
    cost: find(/营业成本|主营业务成本|成本合计/),
    tax: find(/税金及附加|应交税费|税金合计|已交税|已缴税|缴纳|实缴/),
  };
}

// 模式判定：A=列式明细（多客户一张表） B=单户报表（行式）
// rows 传原始全表行（含标题行）——标题常出现在表头行之前，客户名识别需要它
export function detectMode({ headers, dataRows, customers, sheetName, rows }) {
  const single = detectSingleClient(rows && rows.length ? rows : [headers, ...dataRows], sheetName, customers);
  if (single) {
    // 若同时存在明显的客户列（多户明细），优先列式
    const g = guessColumns(headers, dataRows, customers);
    if (g.nameMatchRate < 0.5) return { mode: 'B', client: single };
    return { mode: 'A', guess: g };
  }
  return { mode: 'A', guess: guessColumns(headers, dataRows, customers) };
}

// 粘贴文本 → 行数组（TSV/多空格分隔）
export function parsePastedText(text) {
  return String(text || '').split(/\n/).map(line =>
    line.replace(/\r/g, '').split(/\t/).map(s => s.trim())
  ).filter(r => r.some(c => c !== ''));
}

// 表格行聚合：空名承接上行（合并单元格场景），同一客户多行数值求和（明细行汇总）
// 输入行需已剔除合计行；返回按名称聚合后的行数组
export function aggregateRows(rows) {
  const out = [];
  const idx = new Map();
  let lastName = '';
  for (const r of rows) {
    let name = String(r.name || '').trim();
    if (!name) name = lastName; else lastName = name;
    if (!name) continue;
    if (!idx.has(name)) {
      const o = { ...r, name };
      idx.set(name, o);
      out.push(o);
    } else {
      const o = idx.get(name);
      for (const k of ['revenue', 'cost', 'taxTotal', 'fee', 'annualRev']) {
        if (r[k] != null) o[k] = (o[k] || 0) + r[k];
      }
    }
  }
  return out;
}
