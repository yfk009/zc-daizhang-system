// 冒烟测试：验证任务生成逻辑与 A《任务矩阵细则》一致（无需浏览器）
// 种子为空时（云端/仓库环境）自动构造同分布测试夹具，保证逻辑验证不依赖真实客户数据
import { buildMonthTasks, unitCount, unitDone, tierOf } from '../src/templates.js';
import { SEED_CUSTOMERS } from '../src/seed-data.js';

let pass = 0, fail = 0;
const eq = (desc, actual, expected) => {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗ FAIL'} ${desc} —— 实际 ${actual}，期望 ${expected}`);
};

const SEED = SEED_CUSTOMERS.length ? SEED_CUSTOMERS : (() => {
  const mk = (i, rev) => ({ _id: 'c_' + i, name: '测试客户' + i, revenue: rev });
  const arr = [];
  for (let i = 0; i < 7; i++) arr.push(mk(i, 2_000_000));       // S3
  for (let i = 7; i < 21; i++) arr.push(mk(i, 500_000));        // S2
  for (let i = 21; i < 68; i++) arr.push(mk(i, 0));             // S1
  return arr;
})();

// 1) 分层规则
const tiers = SEED.map(c => tierOf(c.revenue));
eq('S3 家数（营业额>100万）', tiers.filter(t => t === 'S3').length, 7);
eq('S2 家数（0<营业额≤100万）', tiers.filter(t => t === 'S2').length, 14);
eq('S1 家数（营业额=0）', tiers.filter(t => t === 'S1').length, 47);
eq('客户总数', SEED.length, 68);

// 2) 任务生成
const ownersMap = { boss: '老板', lead: '小王', assist: '小李' };
const customers = SEED.map(c => ({ ...c, tier: tierOf(c.revenue) }));
const docs = buildMonthTasks('2026-09', customers, ownersMap);

const s2c = customers.filter(c => c.tier === 'S2');
const s3c = customers.filter(c => c.tier === 'S3');
const s1c = customers.filter(c => c.tier === 'S1');
eq('S2 客户户任务数（14×7）', docs.filter(d => d.tier === 'S2' && d.type === 'client').length, s2c.length * 7);
eq('S3 客户户任务数（7×11）', docs.filter(d => d.tier === 'S3' && d.type === 'client').length, s3c.length * 11);
eq('S1 批量任务组数', docs.filter(d => d.tier === 'S1' && d.type === 'batch' && d.key !== 's1_annual').length, 3);
eq('S1 批量清单覆盖 47 家', docs.find(d => d.key === 's1_check').checklist.length, s1c.length);
eq('团队复盘任务', docs.filter(d => d.type === 'team').length, 1);
eq('9月不含年度存续确认', docs.filter(d => d.key === 's1_annual').length, 0);
eq('12月含年度存续确认', buildMonthTasks('2026-12', customers, ownersMap).filter(d => d.key === 's1_annual').length, 1);

// 3) 幂等：重复生成 key 不变
const again = buildMonthTasks('2026-09', customers, ownersMap);
eq('幂等：两次生成 _id 集合一致', again.every(d => docs.find(x => x._id === d._id)) ? 'yes' : 'no', 'yes');

// 4) 单元统计口径
const totalUnits = docs.reduce((a, t) => a + unitCount(t), 0);
eq('任务总单元数（47×3 + 14×7 + 7×11 + 1）', totalUnits, s1c.length * 3 + s2c.length * 7 + s3c.length * 11 + 1);

// 5) 铁律任务存在性
eq('每家 S2/S3 都有税金确认任务', docs.filter(d => d.key === 'taxconfirm').length, s2c.length + s3c.length);
eq('每家 S2/S3 都有申报任务', docs.filter(d => d.key === 'filing').length, s2c.length + s3c.length);
eq('S3 每家有预算编制任务', docs.filter(d => d.key === 'budget').length, s3c.length);
eq('S3 沟通会指派老板', docs.filter(d => d.key === 'meeting' && d.owner === '老板').length, s3c.length);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
