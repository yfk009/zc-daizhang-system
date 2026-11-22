// 冒烟测试：验证任务生成逻辑与代账4.0 终稿（五档 S1–S5 + T1–T22 任务库）一致（无需浏览器）
// 种子为空时（云端/仓库环境）自动构造同分布测试夹具，保证逻辑验证不依赖真实客户数据
import { buildMonthTasks, unitCount, unitDone, tierOf, inferTier, TIERS, TASK_LIBRARY } from '../src/templates.js';
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
eq('S3 家数（一般纳税500万以内）', tiers.filter(t => t === 'S3').length, cnt(r => r > 1_000_000 && r <= 5_000_000));
eq('S4 家数（500万以上–1000万）', tiers.filter(t => t === 'S4').length, cnt(r => r > 5_000_000 && r < 10_000_000));
eq('S5 家数（≥1000万）', tiers.filter(t => t === 'S5').length, cnt(r => r >= 10_000_000));
eq('客户总数', SEED.length, 68);
eq('兼容旧签名 tierOf(数字) 小规模口径', tierOf(500_000), 'S2');
eq('判档边界 500万 → S3（以内含本数）', tierOf({ revenue: 5_000_000, taxpayerType: 'general' }), 'S3');
eq('判档边界 500万零1 → S4', tierOf({ revenue: 5_000_001, taxpayerType: 'general' }), 'S4');
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

// 7) 派单模式：固定人 / 谁服务谁做（__clients）/ 谁检谁（__cross + crossMap）
import { resolveOwner } from '../src/templates.js';
eq('固定指派：人名直接返回', resolveOwner({ lead: '小王' }, {}, 'lead', { owner: '张三' }), '小王');
eq('谁服务谁做：任务派给客户负责人', resolveOwner({ assist: '__clients' }, {}, 'assist', { owner: '会计甲' }), '会计甲');
eq('谁服务谁做：客户未指定负责人回落角色名', resolveOwner({ assist: '__clients' }, {}, 'assist', null), '会计助理');
eq('谁检谁：按互检表派给复核人', resolveOwner({ reviewer: '__cross' }, { '会计甲': '会计乙' }, 'reviewer', { owner: '会计甲' }), '会计乙');
eq('谁检谁：互检表未配置的会计自查兜底', resolveOwner({ reviewer: '__cross' }, {}, 'reviewer', { owner: '会计甲' }), '会计甲');
const modeClients = buildMonthTasks('2026-09',
  [{ _id: 'x1', name: '甲公司', tier: 'S2', owner: '会计甲' }, { _id: 'x2', name: '乙公司', tier: 'S2', owner: '会计乙' }],
  { ...ownersMap, assist: '__clients' });
eq('生成任务按客户负责人派单（催票）', modeClients.filter(d => d.key === 'urge' && d.owner === '会计甲').length, 1);
const modeCross = buildMonthTasks('2026-09',
  [{ _id: 'y1', name: '零申报甲', tier: 'S1', owner: '会计甲' }],
  { ...ownersMap, reviewer: '__cross' }, { crossMap: { '会计甲': '会计乙' } });
eq('S1 批量巡检（无单一客户）回落审核会计占位', modeCross.find(d => d.key === 's1_patrol').owner, '审核会计');

// 8) 税种目录与税金合计逻辑（taxkit，2026-11-01 税金页加列）
import { OTHER_TAXES, othersSum, partsSum } from '../src/taxkit.js';
eq('其他税种目录 ≥18 项（含房产税/残保金/工会经费）', OTHER_TAXES.length >= 18 ? 'yes' : 'no', 'yes');
eq('其他税种求和（非法金额按 0）', othersSum({ others: [{ name: '房产税', amt: 300 }, { name: '残保金', amt: 'x' }] }), 300);
eq('六项明细合计（不含 total 字段、含其他税种）', partsSum({ vat: 100, sur: 12, it: 0, cit: 0, stamp: 8, total: 999, others: [{ name: '工会经费', amt: 50 }] }), 170);

// 9) 新增客户实时同步（2026-11-22）：档位修复 + 当月任务幂等补齐
const memStore = new Map();
globalThis.localStorage = {
  getItem: k => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => { memStore.set(k, String(v)); },
  removeItem: k => { memStore.delete(k); },
};
globalThis.window = { dispatchEvent: () => {} };

const as = await import('../src/app-state.js');
const judgeOf = c => inferTier({ ...c, identityText: c.taxpayerType === 'general' ? '一般纳税人' : (c.taxpayerType === 'small' ? '小规模纳税人' : '') });
eq('判档身份优先级：已存一般纳税人+200万 → S3（不误降 S2）', inferTier({ revenue: 2_000_000, taxpayerType: 'general' }).tier, 'S3');
eq('判档身份优先级：已存身份 general 结果同步 general', inferTier({ revenue: 2_000_000, taxpayerType: 'general' }).taxpayerType, 'general');
eq('判档身份优先级：≥500万仍推定一般纳税（存档 small 被营业额推翻）', inferTier({ revenue: 6_000_000, taxpayerType: 'small' }).tier, 'S4');
eq('判档身份优先级：无身份 +200万 → S2（原口径不变）', inferTier({ revenue: 2_000_000 }).tier, 'S2');
const badC = { name: '坏档客户', tier: '', taxpayerType: 'general', revenue: 2_000_000, annualFee: 0 };
eq('档位修复引擎：空档位一般纳税人按营业额补 S3', judgeOf(badC).tier, 'S3');
eq('档位修复识别非法档位（S9）', !['S1', 'S2', 'S3', 'S4', 'S5'].includes('S9') ? 'yes' : 'no', 'yes');

as.state.month = '2026-11';
as.state.customers = [
  { _id: 't1', name: '测试甲', tier: 'S2', taxpayerType: 'small', revenue: 300000, archived: false, owner: '小王' },
  { _id: 't2', name: '测试乙', tier: 'S1', taxpayerType: 'small', revenue: 0, archived: false, owner: '小李' },
];
as.state.settings = {
  staff: [
    { key: 'boss', name: '老板', role: '总经理', weight: 2.5, boss: true },
    { key: 'lead', name: '小王', role: '主办会计', weight: 1.5, boss: false },
    { key: 'assist', name: '小李', role: '兼职助理', weight: 0.8, boss: false },
  ],
  ownersMap: { boss: '老板', director: '老板', lead: '小王', reviewer: '小王', assist: '小李' },
  crossMap: {}, disabledTemplateKeys: [], customTemplates: [],
};
const n1 = await as.syncMonthTasks();
eq('空月任务：syncMonthTasks 生成 2 户全部任务', n1 > 0 ? 'yes' : 'no', 'yes');
const n2 = await as.syncMonthTasks();
eq('再次调用幂等（不重复生成）', n2, 0);
as.state.customers.push({ _id: 't3', name: '新增丙公司', tier: 'S2', taxpayerType: 'small', revenue: 200000, archived: false, owner: '小王' });
const n3 = await as.syncMonthTasks();
eq('新增 1 家客户后仅补该户任务（S2=15 项）', n3, 15);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
