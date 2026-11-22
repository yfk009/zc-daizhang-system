// bot-context 单测：快照构建 + 命中客户识别（无需浏览器，无需真实数据）
import { buildContext, hitClients } from '../src/bot-context.js';

let pass = 0, fail = 0;
const ok = (desc, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✓' : '✗ FAIL'} ${desc}${cond ? '' : ' ' + extra}`);
};

/* 夹具：2 家在库 + 1 归档 + 任务/税金/财务/配合/服务单 */
const data = {
  month: '2026-11',
  dataMonth: '2026-10',
  today: '2026-11-22',
  customers: [
    { _id: 'c1', name: '大理苍山茶业有限公司', tier: 'S3', taxpayerType: 'general', revenue: 3000000, annualFee: 6000, monthlyFee: 500, owners: ['小王'], contractEnd: '2027-03-31', source: '转介绍', contact: '张总', phone: '13800000000' },
    { _id: 'c2', name: '丽江客栈个体户', tier: 'S2', taxpayerType: 'small', revenue: 400000, annualFee: 3600, monthlyFee: 300, owner: '小李' },
    { _id: 'c3', name: '已注销公司', tier: 'S1', archived: true },
  ],
  tasks: [
    { _id: 't1', clientId: 'c1', clientName: '大理苍山茶业有限公司', name: '纳税申报', due: 15, owner: '小王', state: 'done', doneAt: '2026-11-14' },
    { _id: 't2', clientId: 'c2', clientName: '丽江客栈个体户', name: '取票核对', due: 5, owner: '小李', state: 'todo' },
  ],
  tax: [
    { _id: 'x1', month: '2026-11', clientId: 'c1', state: 'confirmed', amounts: { vat: 8000, sur: 960, it: 0, cit: 2000, stamp: 40, total: 11000 } },
    { _id: 'x2', month: '2026-11', clientId: 'c2', state: 'ready', amounts: { vat: 500, sur: 60, it: 0, cit: 0, stamp: 0, total: 560, others: [{ name: '房产税', amt: 120 }] } },
  ],
  financials: [
    { month: '2026-10', clientId: 'c1', clientName: '大理苍山茶业有限公司', revenue: 260000, cost: 190000, taxTotal: 11000 },
  ],
  coop: [
    { _id: 'cp1', month: '2026-11', clientId: 'c2', closeCall: 'done', receipt: true, items: { a: true, b: false } },
  ],
  risknotices: [
    { _id: 'rn1', clientId: 'c2', clientName: '丽江客栈个体户', status: 'signed', date: '2026-11-03' },
  ],
  serviceOrders: [
    { _id: 'so1', clientId: 'c1', clientName: '大理苍山茶业有限公司', svc: '工商年报代办', fee: '300元/年', status: 'doing', createdAt: '2026-11-10' },
  ],
  settings: {
    staff: [{ name: '老板', role: '总经理', weight: 2.5, boss: true }, { name: '小王', role: '主办会计', weight: 1.5 }],
    ownersMap: { boss: '老板', lead: '小王' },
  },
};

const { system, chars } = buildContext(data, '大理苍山茶业这个月税金确认了吗');
console.log(`—— 快照 ${chars} 字符 ——`);

ok('含系统身份头', system.includes('内置 AI 助手'));
ok('含时间基准（服务月/账务月）', system.includes('2026-11') && system.includes('2026-10'));
ok('全局统计：2 家在库（排除归档）', system.includes('客户 2 家在库'));
ok('分档计数 S3=1/S2=1', system.includes('S3=1') && system.includes('S2=1'));
ok('月费合计 ¥800/月', system.includes('¥800/月'));
ok('任务：完成1+未完成1（逾期1，11-22>5号）', system.includes('完成 1 + 未完成 1（逾期 1）'));
ok('税金：已确认1 · 已录待发送1', system.includes('已确认 1') && system.includes('已录金额待发送 1'));
ok('合计应缴含其他税种 560（500+60+120）', system.includes('11,560'));
ok('5号收口已收口1', system.includes('已收口 1'));
ok('客户明细含联系人/电话（深挖触发）', system.includes('张总') && system.includes('13800000000'));
ok('深挖区：大理苍山茶业命中', system.includes('重点客户深挖') && system.includes('大理苍山茶业有限公司'));
ok('深挖区：税金状态已确认+合计', system.includes('税金(已确认)') && system.includes('11,000'));
ok('深挖区：财务史', system.includes('财务史') && system.includes('260,000'));
ok('深挖区：服务单', system.includes('工商年报代办') && system.includes('执行中'));
ok('配合清单进度 1/2', system.includes('配合清单 1/2'));
ok('风险告知书已签回', system.includes('已签回'));
ok('团队与角色映射', system.includes('主办会计') && system.includes('主办会计=小王'));
ok('回答规则在场', system.includes('【回答规则】'));

/* 命中识别 */
const cs = data.customers;
ok('hitClients 全名命中', hitClients('大理苍山茶业怎么样', cs).length === 1);
ok('hitClients 去后缀命中（大理苍山茶业）', hitClients('大理苍山茶业的税确认了吗', cs).length === 1);
ok('hitClients 2字简称不直接命中（防误报，AI 从全表明细兜底）', hitClients('帮我查下茶业的税', cs).length === 0);
ok('hitClients 无关问题不命中', hitClients('整体经营概况', cs).length === 0);
ok('hitClients 空问题安全', hitClients('', cs).length === 0);
ok('快照无 undefined 泄漏', !system.includes('undefined'), '');
ok('快照无 NaN 泄漏', !system.includes('NaN'), '');

/* 空库安全 */
const empty = buildContext({ month: '2026-11', dataMonth: '2026-10', customers: [], settings: {} }, '');
ok('空库不炸且提示 0 家', empty.system.includes('客户 0 家在库'));
ok('空库快照长度 < 2000 字符', empty.chars < 2000, `实际 ${empty.chars}`);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
