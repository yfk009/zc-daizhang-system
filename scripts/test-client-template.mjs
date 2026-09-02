// 客户名单模板解析引擎测试：node scripts/test-client-template.mjs
import { locateTemplateHeader, mapTemplateColumns, normDate, normTax, parseClientTemplate, planClientImport } from '../src/client-template.js';

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.error('  ✗ ' + label); }
}

console.log('== 日期归一 ==');
ok(normDate(20260901) === '2026-09-01', '数字 YYYYMMDD');
ok(normDate('20260901') === '2026-09-01', '文本 YYYYMMDD');
ok(normDate('2026-09-01') === '2026-09-01', 'ISO 文本');
ok(normDate('2026/9/1') === '2026-09-01', '斜杠日期');
ok(normDate('2026.9.1') === '2026-09-01', '点分日期');
ok(normDate('2026年9月1日') === '2026-09-01', '中文日期');
const serial = Math.round((Date.UTC(2026, 8, 1) - Date.UTC(1899, 11, 30)) / 86400000);
ok(normDate(serial) === '2026-09-01', 'Excel 序列号 ' + serial);
ok(normDate('如 2026-07-31') === '', '占位文案不误判');
ok(normDate('') === '' && normDate(null) === '', '空值');
ok(normTax(' 91530112ma6mf57240 ') === '91530112MA6MF57240', '税号去空格转大写');
ok(normTax(915301120000000000) === String(915301120000000000), '数字税号不丢精度');

console.log('== 表头定位与列映射 ==');
const rows = [
  ['掌兴代理记账公司客户名单'],
  [],
  ['截止2026-07-31'],
  ['', '序号（自动）', '纳税人识别号', '公司名称*', '有效期起*', '有效期止*', '合同金额（元/年）', '佣金（元/年）', '年记账费（元/年）*', '月记账费（自动）', '客户来源', '剩余月份（自动）', '剩余金额（自动）', '客户营业额（截至月末，元）', '收费周期', '联系人', '联系电话', '介绍人', '备注'],
  ['', 1, '91530100TEST0001', '示例·昆明某某商贸有限公司', 20260901, 20270831, 2400, 400, 2000, 166.67, '转介绍', 11, 1833.37, 350000, '按季', '张会计', 13800000000, '李总', '示例行，正式导入前可删除'],
  ['', 2, '91530100AAAA0001', '云南测试一号有限公司', 20260101, 20261231, 6000, 0, 6000, 500, '自有', 4, 2000, 789497.36, '按月', '', 13800000000, '', ''],
  ['', 3, '', '昆明新增商贸有限公司', '2026-09-01', '2027-08-31', '', '', '', 200, '转介绍', '', '', 1500000, '', '', '', '', ''],
  ['', 4, '91530100BBBB0002', '云南休眠户贸易有限公司', 20250101, 20251231, '', '', '', '', '自有', '', '', 0, '', '', '', '', '合同待补录'],
  ['', 5, '91530100AAAA0001', '云南测试一号有限公司', 20260101, 20270101, 7200, 0, 7200, 600, '自有', '', '', 800000, '', '', '', '', ''],
  [],
  ['', '', '合计', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
];
ok(locateTemplateHeader(rows) === 3, '跳过标题行定位表头');
const col = mapTemplateColumns(rows[3]);
ok(col.tax === 2 && col.name === 3 && col.start === 4 && col.end === 5, '税号/名称/起/止 列映射');
ok(col.contractAmount === 6 && col.commission === 7 && col.annualFee === 8 && col.monthFee === 9, '金额列映射（月费先于年费）');
ok(col.source === 10 && col.revenue === 13 && col.cycle === 14 && col.phone === 16, '来源/营业额/周期/电话 列映射');
ok(col.remark === 18, '备注列映射');

console.log('== 解析与剔除 ==');
const parsed = parseClientTemplate(rows);
ok(parsed.ok === true, '解析成功');
ok(parsed.cutoff === '2026-07-31', '识别营业额截止日期');
ok(parsed.items.length === 4, '有效客户 4 行（示例/合计/空行剔除）');
ok(parsed.skipped.length === 2 && parsed.skipped[0].reason === '示例行' && parsed.skipped[1].reason === '合计行', '示例行+合计行跳过记录');
ok(parsed.warnings.length === 1 && parsed.warnings[0].includes('同一客户'), '文件内重复税号告警');
const t1 = parsed.items[0];
ok(t1.name === '云南测试一号有限公司' && t1.tax === '91530100AAAA0001', '首行取数');
ok(t1.start === '2026-01-01' && t1.end === '2026-12-31', '数字日期转 ISO');
ok(t1.phone === '13800000000', '数字电话转文本');
ok(t1.monthFee === 500 && t1.annualFee === 6000, '月费按 年÷12 重算');
const t3 = parsed.items[1];
ok(t3.annualFee === 2400 && t3.monthFee === 200, '只有月费时反推年费 200×12');
const t4 = parsed.items[2];
ok(t4.revenue === 0 && t4.annualFee == null, '休眠户零值/空值保留');

console.log('== 导入计划（对照客户库） ==');
const library = [
  { _id: 'c_001', name: '昆明骄雷环保科技有限公司', taxNo: '91530100AAAA0001', source: '转介绍', contractStart: '2026-01-01', contractEnd: '2026-12-31', annualFee: 0, monthlyFee: 0, revenue: 789497.36, remark: '⚠️ 记账费为0，待确认', contact: '', phone: '', introducer: '', archived: false, tier: 'S3', tierManual: false, ownerRole: 'lead', owner: '小王' },
  { _id: 'c_002', name: '云南手动锁档公司', taxNo: '91530100LOCK0001', source: '自有', contractStart: '', contractEnd: '', annualFee: 1000, monthlyFee: 83.33, revenue: 0, remark: '', contact: '', phone: '', introducer: '', archived: false, tier: 'S1', tierManual: true, ownerRole: 'assist', owner: '小李' },
  { _id: 'c_068', name: '昆明野萃食品公司', taxNo: '', source: '自有', contractStart: '', contractEnd: '', annualFee: 1200, monthlyFee: 100, revenue: 0, remark: '', contact: '', phone: '', introducer: '', archived: true, tier: 'S1', tierManual: false, ownerRole: 'assist', owner: '小李' },
];
const plan = planClientImport(parsed.items, library);
// 4 行去重后 3 户：测试一号(税号匹配→更新，重复取后行)、新增商贸(无匹配→新增)、休眠户(无匹配→新增)
ok(plan.updates.length === 1 && plan.creates.length === 2, '去重后更新 1 + 新增 2');
ok(plan.rows.length === 3, '预览行也去重');
const upd = plan.updates[0];
ok(upd._id === 'c_001' && upd.name === '昆明骄雷环保科技有限公司', '税号匹配更新且保留在库规范名');
ok(upd.annualFee === 7200 && upd.monthlyFee === 600, '更新后年费/月费取后行数据');
ok(upd.revenue === 800000 && upd.tier === 'S2' && upd.ownerRole === 'lead', '营业额快照变化 → 分级重判 S3→S2');
const created = plan.creates.find(d => d.name === '昆明新增商贸有限公司');
ok(created && created._id === 'c_069', '新客户序号接续 c_069');
ok(created.tier === 'S3' && created.monthlyFee === 200, '新客户分级 150万→S3、月费 200');
const dorm = plan.creates.find(d => d.name === '云南休眠户贸易有限公司');
ok(dorm && dorm.tier === 'S1' && dorm.ownerRole === 'assist', '零营业额→S1 归助理');
ok(dorm.remark === '合同待补录' && dorm.contractEnd === '2025-12-31', '备注/到期日随档案入库');

console.log('== 手动锁档不重划 ==');
const lockRows = [
  ['序号', '纳税人识别号', '公司名称*', '有效期起*', '有效期止*', '合同金额（元/年）', '佣金（元/年）', '年记账费（元/年）*', '月记账费（自动）', '客户来源', '剩余月份（自动）', '剩余金额（自动）', '客户营业额（截至月末，元）', '收费周期', '联系人', '联系电话', '介绍人', '备注'],
  [1, '91530100LOCK0001', '云南手动锁档公司', 20260101, 20261231, '', '', 2000, '', '自有', '', '', 2000000, '', '', '', '', ''],
];
const lockParsed = parseClientTemplate(lockRows);
const lockPlan = planClientImport(lockParsed.items, library);
ok(lockPlan.updates.length === 1, '锁档客户按税号匹配到');
ok(lockPlan.updates[0].tier === 'S1' && lockPlan.updates[0].tierManual === true && lockPlan.updates[0].ownerRole === 'assist', '锁档客户 200万 仍保持 S1');

console.log('== 备注保留策略 ==');
const rmRowsKeep = [
  ['纳税人识别号', '公司名称*', '年记账费（元/年）*', '客户营业额（截至月末，元）', '备注'],
  ['91530100AAAA0001', '云南测试一号有限公司', 6000, 789497.36, ''],
];
const rmPlanKeep = planClientImport(parseClientTemplate(rmRowsKeep).items, library);
ok(rmPlanKeep.updates[0].remark === '⚠️ 记账费为0，待确认', '模板备注为空 → 保留在库备注');
const rmRowsOver = [
  ['纳税人识别号', '公司名称*', '年记账费（元/年）*', '客户营业额（截至月末，元）', '备注'],
  ['91530100AAAA0001', '云南测试一号有限公司', 6000, 789497.36, '7月已催票'],
];
const rmPlanOver = planClientImport(parseClientTemplate(rmRowsOver).items, library);
ok(rmPlanOver.updates[0].remark === '7月已催票', '模板备注非空 → 覆盖');

console.log('== 异常防护 ==');
ok(parseClientTemplate([['随便一个表'], [1, 2, 3]]).ok === false, '无表头表报错');
ok(planClientImport([], library).creates.length === 0, '空数据不产生动作');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
