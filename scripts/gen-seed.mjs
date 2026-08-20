// 从 客户数据_清洗后.json 生成种子数据文件
// 用法：node scripts/gen-seed.mjs [输出文件]
//   默认输出 src/seed-data.js；传 src/seed-data.local.js 可生成"仅本地不入库"版本
import { readFileSync, writeFileSync } from 'fs';

const out = process.argv[2] || new URL('../src/seed-data.js', import.meta.url).pathname;
const src = JSON.parse(readFileSync(new URL('../../客户数据_清洗后.json', import.meta.url), 'utf8'));
const rows = src.map((c, i) => ({
  _id: 'c_' + String(i + 1).padStart(3, '0'),
  name: c['公司名称'] || '',
  taxNo: c['纳税人识别号'] || '',
  source: c['客户来源'] || '',
  contractStart: c['合同开始'] || '',
  contractEnd: c['合同到期'] || '',
  annualFee: c['年记账费'] || 0,
  monthlyFee: c['月记账费'] || 0,
  revenue: c['2025年营业额'] || 0,
  remark: c['数据状态备注'] || '',
  contact: '', phone: '', introducer: '',
  archived: false,
}));

const header = `// 自动生成：68 家客户种子数据（源自 记账公司明细.xlsx 清洗版）——请勿手改，重新生成用 scripts/gen-seed.mjs
// 隐私约定：真实种子只放 src/seed-data.local.js（已 gitignore）；仓库内 src/seed-data.js 保持空数组
// tier 在初始化时按 revenue 自动计算并写入
export const SEED_CUSTOMERS = ${JSON.stringify(rows, null, 0)};
`;
writeFileSync(out, header);
console.log('生成完成：', rows.length, '家客户 →', out);
