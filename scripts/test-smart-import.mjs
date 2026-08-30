// 智能解析引擎测试：非固定模板的多形态表格 → 验证自动识别
import {
  detectHeaderRow, guessColumns, matchClient, parseNumber,
  detectSingleClient, extractClientFinancials, detectMode, parsePastedText, normName,
} from '../src/smart-import.js';

let pass = 0, fail = 0;
const eq = (d, a, e) => { const ok = JSON.stringify(a) === JSON.stringify(e); ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗ FAIL'} ${d} —— 实际 ${JSON.stringify(a)}，期望 ${JSON.stringify(e)}`); };

const customers = [
  { _id: 'c1', name: '昆明测试科技有限公司' },
  { _id: 'c2', name: '云南试验商贸有限公司' },
  { _id: 'c3', name: '盘龙区某茶叶经营部（个体工商户）' },
];

// 1) 数字解析
eq('千分位', parseNumber('1,234.5'), 1234.5);
eq('货币符号', parseNumber('￥82,000'), 82000);
eq('非数字', parseNumber('—'), null);

// 2) 客户匹配（宽松模板命名）
eq('全称精确', matchClient('昆明测试科技有限公司', customers), customers[0]);
eq('去后缀包含', matchClient('昆明测试科技', customers), customers[0]);
eq('反向包含（表格名是全称、库是简称场景兜底）', !!matchClient('昆明测试科技有限公司2026年8月', customers), true);
eq('个体户括号注记', matchClient('盘龙区某茶叶经营部', customers), customers[2]);
eq('完全无关', matchClient('不知道什么公司', customers), null);

// 2.5) LCS 模糊匹配（差异较大的别名/简称）
const cust2 = [{ _id: 'k1', name: '昆明鑫城建筑工程有限公司' }, { _id: 'k2', name: '云南盛和文化传播股份有限公司' }];
eq('LCS别名匹配', matchClient('鑫城建筑工程', cust2), cust2[0]);
eq('LCS差异名匹配', matchClient('盛和文化传媒', cust2), cust2[1]);
eq('LCS不误配', matchClient('完全不同的名字啊', cust2), null);

// 3) 表头行定位（前两行是标题/空行）
const rowsA = [
  ['云南某某代账公司客户数据导出', '', ''],
  ['导出时间：2026-09-01', '', ''],
  ['往来单位', '本期销项金额', '进项合计', '已缴税额'],
  ['昆明测试科技有限公司', '120000', '80000', '3600'],
  ['云南试验商贸有限公司', '50000', '30000', '1500'],
  ['合计', '170000', '110000', '5100'],
];
eq('表头行=第3行', detectHeaderRow(rowsA), 2);

// 4) 列角色识别（非标准表头词：往来单位/销项/进项/已缴税额）
const headersA = rowsA[2];
const dataA = rowsA.slice(3);
const g = guessColumns(headersA, dataA, customers);
eq('客户列=0（客户库命中）', g.name, 0);
eq('收入列=1（销项）', g.revenue, 1);
eq('成本列=2（进项）', g.cost, 2);
eq('税金列=3（已缴税额）', g.tax, 3);

// 5) 模式判定：多户明细 → A
const dm = detectMode({ headers: headersA, dataRows: dataA, customers, sheetName: '导出', rows: rowsA });
eq('多户表=列式', dm.mode, 'A');

// 6) 单户利润表 → B + 行式取数
const rowsB = [
  ['昆明测试科技有限公司利润表', '', '', ''],
  ['项目', '本月数', '本年累计', ''],
  ['一、营业收入', '100000', '800000', ''],
  ['减：营业成本', '60000', '480000', ''],
  ['税金及附加', '3000', '24000', ''],
  ['销售费用', '5000', '40000', ''],
];
const sc = detectSingleClient(rowsB, 'sheet1', customers);
eq('标题命中客户', sc && sc._id, 'c1');
const fv = extractClientFinancials(rowsB);
eq('行式收入', fv.revenue, 100000);
eq('行式成本', fv.cost, 60000);
eq('行式税金', fv.tax, 3000);

// 6.5) 单户报表 → 模式 B（标题行在表头行之前，须靠完整 rows 识别）
const dmB = detectMode({ headers: rowsB[1], dataRows: rowsB.slice(2), customers, sheetName: 'sheet1', rows: rowsB });
eq('单户表=行式B', dmB.mode, 'B');
eq('单户表客户', dmB.client && dmB.client._id, 'c1');

// 7) 粘贴解析（TSV）
const tsv = '客户\t收入\t成本\t税\n昆明测试科技有限公司\t10\t5\t1';
const pr = parsePastedText(tsv);
eq('粘贴行列数', pr.length, 2);
eq('粘贴表头', pr[0], ['客户', '收入', '成本', '税']);

// 8) 合计行剔除逻辑在 importer（此处验证正则）
eq('合计识别', /合\s*计|总\s*计/.test('合计'), true);

// 9) normName 边界
eq('归一化', normName('昆明测试科技有限公司'), '昆明测试科技');

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
