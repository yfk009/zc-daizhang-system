// 冒烟测试：验证任务生成逻辑与代账4.0 终稿（五档 S1–S5 + T1–T22 任务库）一致（无需浏览器）
// 种子为空时（云端/仓库环境）自动构造同分布测试夹具，保证逻辑验证不依赖真实客户数据
import { buildMonthTasks, unitCount, unitDone, tierOf, TIERS, TASK_LIBRARY } from '../src/templates.js';
import { SEED_CUSTOMERS } from '../src/seed-data.js';

let pass = 0, fail = 0;
const eq = (desc, actual, expected) => {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗ FAIL'} ${desc} —— 实际 ${actual}，期望 ${expected}`);
};

// 种子客户补纳税人身份（与 app-state.seedCustomers 同规则：>100万推定一般纳税人）
const withType = c => ({ taxpayerType: c.revenue > 1_000_000 ? 'general' : 'small', ...c });
const SEED = SEED_CUSTOMERS.length ? SEED_CUSTOMERS.map(withType) : (() => {
  const mk = (i, rev, tt) => ({ _id: 'c_' + i, name: '测试客户' + i, revenue: rev, taxpayerType: tt });
  const arr = [];
  for (let i = 0; i < 2; i++) arr.push(mk(i, 15_000_000, 'general'));   // S5
  for (let i = 2; i < 4; i++) arr.push(mk(i, 8_000_000, 'general'));    // S4
  for (let i = 4; i < 7; i++) arr.push(mk(i, 2_000_000, 'general'));    // S3
  for (let i = 7; i < 21; i++) arr.push(mk(i, 500_000, 'small'));       // S2
  for (let i = 21; i < 68; i++) arr.push(mk(i, 0, 'small'));            // S1
  return arr;
})();

// 1) 分层规则（五档：零申报→S1；一般纳税按营业额 <500万 S3 / <1000万 S4 / 其余 S5；小规模有经营→S2）
const cnt = pred => SEED.filter(c => pred(c.revenue || 0)).length;
const tiers = SEED.map(c => tierOf(c));
eq('S1 家数（营业额=0）', tiers.filter(t => t === 'S1').length, cnt(r => r <= 0));
eq('S2 家数（小规模有经营）', tiers.filter(t => t === 'S2').length, cnt(r => r > 0 && r <= 1_000_000));
eq('S3 家数（一般纳税<500万）', tiers.filter(t => t === 'S3').length, cnt(r => r > 1_000_000 && r < 5_000_000));
eq('S4 家数（500–1000万）', tiers.filter(t => t === 'S4').length, cnt(r => r >= 5_000_000 && r < 10_000_000));
eq('S5 家数（≥1000万）', tiers.filter(t => t === 'S5').length, cnt(r => r >= 10_000_000));
eq('客户总数', SEED.length, 68);
eq('兼容旧签名 tierOf(数字) 小规模口径', tierOf(500_000), 'S2');
eq('判档边界 500万 → S4', tierOf({ revenue: 5_000_000, taxpayerType: 'general' }), 'S4');
eq('判档边界 1000万 → S5', tierOf({ revenue: 10_000_000, taxpayerType: 'general' }), 'S5');
eq('任务库共 22 项（T1–T22）', TASK_LIBRARY.length, 22);

// 2) 任务生成（9 月 = 季度月：S2–S5 每户 15 项月度 + T19 季度对标 = 16 项）
const ownersMap = { boss: '老板', director: '项目老张', lead: '小王', reviewer: '审核小陈', assist: '小李' };
const customers = SEED.map(c => ({ ...c, tier: tierOf(c) }));
const docs = buildMonthTasks('2026-09', customers, ownersMap);

const paid = customers.filter(c => c.tier !== 'S1');
const s1c = customers.filter(c => c.tier === 'S1');
eq('S1 批量任务组数（核对/申报/巡检）', docs.filter(d => d.tier === 'S1' && d.type === 'batch' && d.key !== 's1_annual').length, 3);
eq('S1 批量清单覆盖家数', docs.find(d => d.key === 's1_check').checklist.length, s1c.length);
eq('S2–S5 每户任务数（15 月度 + 1 季度 = 16）', docs.filter(d => d.type === 'client').length, paid.length * 16);
eq('团队级固定任务（21号交付复核 + 年度专项节点）', docs.filter(d => d.type === 'team' && d.key !== 'cx_test2').length, 2);
eq('年度专项任务按月切换（9月）', docs.find(d => d.key === 'annual_node').name.includes('三季度预算修正'), true);
eq('9月不含年度存续确认', docs.filter(d => d.key === 's1_annual').length, 0);
eq('每户有税金确认任务（铁律）', docs.filter(d => d.key === 'taxconfirm').length, paid.length);
eq('每户有申报任务', docs.filter(d => d.key === 'filing').length, paid.length);
eq('每户有预算编制任务（S2 起）', docs.filter(d => d.key === 'budget').length, paid.length);
eq('每户有税筹/现金流（尊享并档）', docs.filter(d => d.key === 'taxplan').length, paid.length);
eq('沟通会指派项目负责人', docs.filter(d => d.key === 'meeting' && d.owner === '项目老张').length, paid.length);
eq('巡检指派审核会计', docs.find(d => d.key === 's1_patrol').owner, '审核小陈');

// 3) 周期任务：12月（T4 存续 + T19 对标 + T22 战略）/ 6月（T20 年报）/ 5月（无周期项）
const dec = buildMonthTasks('2026-12', customers, ownersMap);
eq('12月含年度存续确认', dec.filter(d => d.key === 's1_annual').length, 1);
eq('12月每户含年度战略复盘', dec.filter(d => d.key === 'strategy').length, paid.length);
eq('12月每户含季度对标', dec.filter(d => d.key === 'benchmark').length, paid.length);
const jun = buildMonthTasks('2026-06', customers, ownersMap);
eq('6月每户含工商年报代办', jun.filter(d => d.key === 'annual_report').length, paid.length);
const may = buildMonthTasks('2026-05', customers, ownersMap);
eq('5月每户 15 项（无周期项）', may.filter(d => d.type === 'client').length, paid.length * 15);

// 4) 幂等：重复生成 key 不变
const again = buildMonthTasks('2026-09', customers, ownersMap);
eq('幂等：两次生成 _id 集合一致', again.every(d => docs.find(x => x._id === d._id)) ? 'yes' : 'no', 'yes');

// 5) 单元统计口径
const totalUnits = docs.reduce((a, t) => a + unitCount(t), 0);
eq('任务总单元数（S1×3 + S2–S5×16 + 团队 2）', totalUnits, s1c.length * 3 + paid.length * 16 + 2);

// 6) 看板编辑：自定义模板 + 停用过滤
const cxTpl = { key: 'cx_test1', name: '发工资表收集提醒', week: 2, due: 5, role: 'lead', tiers: ['ALL'], type: 'client' };
const withCustom = buildMonthTasks('2026-09', customers, ownersMap, { customTemplates: [cxTpl] });
eq('自定义模板逐户生成', withCustom.filter(d => d.key === 'cx_test1' && d.type === 'client').length, 68);
const cxTeam = { key: 'cx_test2', name: '内部沟通会', week: 4, due: 28, role: 'boss', tiers: ['ALL'], type: 'team' };
const withBoth = buildMonthTasks('2026-09', customers, ownersMap, { customTemplates: [cxTpl, cxTeam] });
eq('自定义团队模板单条', withBoth.filter(d => d.key === 'cx_test2').length, 1);
const withDis = buildMonthTasks('2026-09', customers, ownersMap, { customTemplates: [cxTpl], disabledKeys: ['cx_test1', 'filing'] });
eq('停用自定义模板后不生成', withDis.filter(d => d.key === 'cx_test1').length, 0);
eq('停用内置模板后不生成', withDis.filter(d => d.key === 'filing').length, 0);
eq('停用不影响其他任务', withDis.filter(d => d.key === 'taxconfirm').length, paid.length);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
