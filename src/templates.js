// 任务模板库：代账4.0 终稿（2026-09-19 v4.1 五档口径）的机器可执行版
// 五档客户：S1 零申报托管 / S2 小规模标准经营 / S3 一般纳税≤500万 / S4 500–1000万 / S5 1000–3000万
// 一口价无折扣（月费固定），年费=月费×12；S1=4项（零申报闭环），S2–S5=18项（基础12项+尊享六项）
// 角色代码：boss=老板 director=项目负责人 lead=主办会计 reviewer=审核会计 assist=会计助理

export const TIERS = {
  S5: { name: 'S5 尊享管家', rule: '一般纳税人 · 年营业额 1000万–3000万', price: 1500, tasks: 18, monthly: '18 项/月 · 编外财务总监', ownerRole: 'lead' },
  S4: { name: 'S4 经营管家', rule: '一般纳税人 · 年营业额 500万–1000万', price: 750, tasks: 18, monthly: '18 项/月 · 经营管家', ownerRole: 'lead' },
  S3: { name: 'S3 标准经营', rule: '一般纳税人 · 年营业额 ≤500万', price: 500, tasks: 18, monthly: '18 项/月 · 经营导航员', ownerRole: 'lead' },
  S2: { name: 'S2 标准经营', rule: '小规模 · 有实际经营', price: 300, tasks: 18, monthly: '18 项/月 · 贴身账房', ownerRole: 'lead' },
  S1: { name: 'S1 零申报托管', rule: '小规模 · 无经营（零申报）', price: 200, tasks: 4, monthly: '4 项/月（批量） · 零申报闭环', ownerRole: 'assist' },
};
export const TIER_ORDER = ['S5', 'S4', 'S3', 'S2', 'S1'];

export const ROLES = {
  boss: '老板', director: '项目负责人', lead: '主办会计', reviewer: '审核会计', assist: '会计助理',
};

// tierOf(client|number)：按 纳税人身份 × 年营业额 × 经营状态 判档
//   零申报/无经营 → S1；一般纳税人按营业额 <500万→S3 / 500–1000万→S4 / ≥1000万→S5；小规模有经营→S2
// 兼容旧调用 tierOf(revenue)：仅传数字时视为身份未知，按小规模处理
export function tierOf(x) {
  const c = (typeof x === 'object' && x !== null) ? x : { revenue: x };
  const rev = Number(c.revenue) || 0;
  if (rev <= 0) return 'S1';
  if (c.taxpayerType === 'general') {
    if (rev < 5000000) return 'S3';
    if (rev < 10000000) return 'S4';
    return 'S5';
  }
  return 'S2';
}

// T1–T22 任务库（key 全局唯一，生成幂等靠它）
// 周期 cycle：缺省=每月；'quarterly'=3/6/9/12月；'june'=每年6月；'december'=每年12月
// type：'client' 每客户一条 ｜ 'batch' 全组一条（含客户清单打勾）
const T = (no, key, name, week, due, role, opts = {}) => ({ no, key, name, week, due, role, tiers: ['S2', 'S3', 'S4', 'S5'], ...opts });

export const TASK_LIBRARY = [
  T(1, 's1_check', '零申报名单核对（批量）', 1, 3, 'assist', { tiers: ['S1'], type: 'batch' }),
  T(2, 's1_file', '零申报批量申报', 2, 13, 'lead', { tiers: ['S1'], type: 'batch' }),
  T(3, 's1_patrol', '税务/工商状态巡检（批量）', 3, 20, 'reviewer', { tiers: ['S1'], type: 'batch' }),
  T(4, 's1_annual', '年度存续确认（12月）', 4, 28, 'director', { tiers: ['S1'], type: 'batch', cycle: 'december' }),
  T(5, 'urge', '催票（话术推送）', 1, 3, 'assist'),
  T(6, 'precheck', '票据预审', 1, 5, 'assist'),
  T(7, 'bookkeep', '做账结账', 2, 10, 'assist'),
  T(8, 'taxconfirm', '税金确认（未确认不申报）', 2, 12, 'lead'),
  T(9, 'filing', '纳税申报', 2, 13, 'lead'),
  T(10, 'brief', '月度简报（自动出图）', 3, 20, 'lead'),
  T(11, 'archive', '票据归档', 4, 30, 'assist'),
  T(12, 'budget', '月度预算编制（预填+客户确认）', 1, 3, 'lead'),
  T(13, 'track1', '预算执行首轮对比', 1, 7, 'lead'),
  T(14, 'variance', '偏差分析报告（自动生成）', 3, 18, 'lead'),
  T(15, 'meeting', '经营沟通会（项目负责人）', 3, 22, 'director'),
  T(16, 'revise', '预算修正与团队复盘', 4, 28, 'lead'),
  T(17, 'taxplan', '月度税务筹划建议', 4, 25, 'lead'),
  T(18, 'cashflow', '现金流预警与预测（13周滚动）', 4, 26, 'lead'),
  T(19, 'benchmark', '行业对标分析（季度）', 3, 22, 'lead', { cycle: 'quarterly' }),
  T(20, 'annual_report', '工商年报代办（赠送）', 2, 30, 'assist', { cycle: 'june' }),
  T(21, 'squad', '专属服务小组当月服务确认', 4, 25, 'lead'),
  T(22, 'strategy', '年度战略复盘（次年预算框架）', 4, 28, 'director', { cycle: 'december' }),
];

export const WEEK_NAMES = [
  'W1 · 1-7号 收票做账', 'W2 · 8-15号 申报', 'W3 · 16-25号 报表沟通', 'W4 · 26-月底 复盘',
];

export const STATE_LABEL = {
  todo: '待办', done: '已完成', issue: '问题', blocked: '受阻',
};

// 完成凭证选项（完成任务弹窗）
export const EVIDENCE_TYPES = [
  '已收到客户微信回复/确认截图',
  '已上传税局申报/完税截图',
  '已归档电子凭证',
  '线下完成，备注说明',
];

// 生成某月全部任务（幂等：已有 key 的跳过）
// customers: 客户数组；ownersMap: {boss,director,lead,reviewer,assist} → 人名
// opts.disabledKeys: 停用的模板 key（内置或自定义）
// opts.customTemplates: 自定义模板 [{key,name,week,due,role,tiers,type}]，tiers=['ALL']|档位数组，type∈client|team
export function buildMonthTasks(month, customers, ownersMap, opts = {}) {
  const disabled = new Set(opts.disabledKeys || []);
  const custom = opts.customTemplates || [];
  const mm = month.slice(5, 7);
  const ownerOf = (role) => (ownersMap && ownersMap[role]) || ROLES[role] || role;
  const docs = [];
  const mk = (o) => ({ ...o, month, state: 'todo', doneAt: null, note: '' });
  const active = customers.filter(c => !c.archived);
  const inCycle = (tpl) => {
    if (tpl.cycle === 'quarterly') return ['03', '06', '09', '12'].includes(mm);
    if (tpl.cycle === 'june') return mm === '06';
    if (tpl.cycle === 'december') return mm === '12';
    return true;
  };

  // S1 零申报托管：批量任务（全组一条，带客户清单）
  const s1 = active.filter(c => (c.tier || tierOf(c)) === 'S1');
  for (const tpl of TASK_LIBRARY.filter(t => t.type === 'batch')) {
    if (disabled.has(tpl.key) || !inCycle(tpl) || s1.length === 0) continue;
    docs.push(mk({
      _id: `t_${month}_S1_${tpl.key}`, type: 'batch', tier: 'S1',
      clientName: `${TIERS.S1.name}（${s1.length}家）`,
      key: tpl.key, name: tpl.name, week: tpl.week, due: tpl.due,
      ownerRole: tpl.role, owner: ownerOf(tpl.role),
      checklist: s1.map(c => ({ id: c._id, name: c.name, done: false })),
    }));
  }

  // S2–S5：逐户任务（T5–T22 按周期展开）
  for (const c of active) {
    const tier = c.tier || tierOf(c);
    if (tier === 'S1') continue;
    for (const tpl of TASK_LIBRARY) {
      if (tpl.type === 'batch') continue;
      if (disabled.has(tpl.key) || !inCycle(tpl)) continue;
      docs.push(mk({
        _id: `t_${month}_${c._id}_${tpl.key}`, type: 'client',
        clientId: c._id, clientName: c.name, tier,
        key: tpl.key, name: tpl.name, week: tpl.week, due: tpl.due,
        ownerRole: tpl.role, owner: ownerOf(tpl.role),
      }));
    }
  }

  // 自定义模板：逐户型按档位展开，团队型单条
  for (const tpl of custom) {
    if (disabled.has(tpl.key)) continue;
    const owner = ownerOf(tpl.role);
    if (tpl.type === 'team') {
      docs.push(mk({
        _id: `t_${month}_team_${tpl.key}`, type: 'team', tier: 'ALL',
        clientName: `【团队】${tpl.name}`,
        key: tpl.key, name: tpl.name, week: tpl.week, due: tpl.due,
        ownerRole: tpl.role, owner,
      }));
    } else {
      for (const c of active) {
        const tier = c.tier || tierOf(c);
        if (tpl.tiers.includes('ALL') || tpl.tiers.includes(tier)) {
          docs.push(mk({
            _id: `t_${month}_${c._id}_${tpl.key}`,
            type: 'client', clientId: c._id, clientName: c.name, tier,
            key: tpl.key, name: tpl.name, week: tpl.week, due: tpl.due,
            ownerRole: tpl.role, owner,
          }));
        }
      }
    }
  }
  return docs;
}

// 统计口径：批量任务按户折算
export function unitCount(t) { return t.type === 'batch' ? (t.checklist ? t.checklist.length : 0) : 1; }
export function unitDone(t) {
  if (t.type !== 'batch') return t.state === 'done' ? 1 : 0;
  if (!t.checklist) return 0;
  return t.checklist.filter(x => x.done).length;
}
