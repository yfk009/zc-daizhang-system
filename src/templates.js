// 任务模板：A《任务矩阵细则》的机器可执行版
// 角色代码：boss=老板 lead=主办会计 assist=助理（在设置页映射到具体人名）
// type: 'client' 每客户一条 ｜ 'batch' 全组一条（含客户清单打勾） ｜ 'team' 团队级

export const TIERS = {
  S3: { name: 'S3 实体经营户', rule: '年营业额 >100万', monthly: '12 项/月 · 预算驱动深度服务', ownerRole: 'lead' },
  S2: { name: 'S2 微型经营户', rule: '0 < 年营业额 ≤100万', monthly: '7 项/月 · 标准服务', ownerRole: 'lead' },
  S1: { name: 'S1 休眠户', rule: '年营业额 =0', monthly: '3 项/月（批量） · 零申报+巡检', ownerRole: 'assist' },
};

export function tierOf(revenue) {
  if (!revenue || revenue <= 0) return 'S1';
  return revenue > 1000000 ? 'S3' : 'S2';
}

// key 全局唯一，生成幂等靠它
const T = (key, name, week, due, role, type = 'client') =>
  ({ key, name, week, due, role, type });

export const TASK_TEMPLATES = {
  S1: [
    T('s1_check', '零申报名单核对（批量）', 1, 3, 'assist', 'batch'),
    T('s1_file', '零申报批量申报', 2, 13, 'assist', 'batch'),
    T('s1_patrol', '税务/工商状态巡检（批量）', 3, 20, 'assist', 'batch'),
    T('s1_annual', '年度存续确认（12月）', 4, 28, 'boss', 'batch'),
  ],
  S2: [
    T('urge', '催票（话术推送）', 1, 3, 'lead'),
    T('precheck', '票据预审', 1, 5, 'lead'),
    T('bookkeep', '做账结账', 2, 10, 'lead'),
    T('taxconfirm', '税金确认（未确认不申报）', 2, 12, 'lead'),
    T('filing', '纳税申报', 2, 13, 'lead'),
    T('brief', '月度简报（自动出图）', 3, 20, 'lead'),
    T('archive', '票据归档', 4, 30, 'lead'),
  ],
  S3: [
    T('budget', '月度预算编制（预填+客户确认）', 1, 3, 'boss'),
    T('track1', '预算执行首轮对比', 1, 7, 'lead'),
    T('urge', '催票（话术推送）', 1, 3, 'lead'),
    T('precheck', '票据预审', 1, 5, 'lead'),
    T('bookkeep', '做账结账', 2, 10, 'lead'),
    T('taxconfirm', '税金确认（未确认不申报）', 2, 12, 'lead'),
    T('filing', '纳税申报', 2, 13, 'lead'),
    T('variance', '偏差分析报告（自动生成）', 3, 18, 'lead'),
    T('meeting', '经营沟通会（老板亲自）', 3, 22, 'boss'),
    T('revise', '预算修正（下月定稿）', 4, 28, 'lead'),
    T('archive', '票据归档', 4, 30, 'lead'),
  ],
};
// S3 团队级任务（不挂客户）
export const TEAM_TASKS = {
  S3: [T('s3_review', 'S3 内部服务复盘会', 4, 28, 'boss', 'team')],
};

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
// customers: 客户数组；ownersMap: {boss,lead,assist} → 人名
// opts.disabledKeys: 停用的模板 key（内置或自定义）
// opts.customTemplates: 自定义模板 [{key,name,week,due,role,tiers,type}]，role∈boss|lead|assist，tiers=['ALL']|['S1','S2','S3']，type∈client|team
export function buildMonthTasks(month, customers, ownersMap, opts = {}) {
  const disabled = new Set(opts.disabledKeys || []);
  const custom = opts.customTemplates || [];
  const docs = [];
  const mk = (o) => ({ ...o, month, state: 'todo', doneAt: null, note: '' });

  for (const c of customers) {
    if (c.archived) continue;
    const tier = c.tier || tierOf(c.revenue);
    for (const tpl of TASK_TEMPLATES[tier]) {
      if (tpl.key === 's1_annual' && !month.endsWith('-12')) continue;
      if (disabled.has(tpl.key)) continue;
      if (tpl.type === 'batch') continue; // 批量任务按组生成，不逐户
      docs.push(mk({
        _id: `t_${month}_${c._id}_${tpl.key}`,
        type: 'client', clientId: c._id, clientName: c.name, tier,
        key: tpl.key, name: tpl.name, week: tpl.week, due: tpl.due,
        ownerRole: tpl.role, owner: ownersMap[tpl.role] || tpl.role,
      }));
    }
  }

  // 自定义模板：逐户型按档位展开，团队型单条
  for (const tpl of custom) {
    if (disabled.has(tpl.key)) continue;
    const owner = ownersMap[tpl.role] || tpl.role;
    if (tpl.type === 'team') {
      docs.push(mk({
        _id: `t_${month}_team_${tpl.key}`, type: 'team', tier: 'ALL',
        clientName: `【团队】${tpl.name.includes('团队') ? '' : ''}${tpl.name}`,
        key: tpl.key, name: tpl.name, week: tpl.week, due: tpl.due,
        ownerRole: tpl.role, owner,
      }));
    } else {
      for (const c of customers) {
        if (c.archived) continue;
        const tier = c.tier || tierOf(c.revenue);
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

  // 批量任务（每档一组一条，携带客户清单）
  for (const tier of ['S1']) {
    const list = customers.filter(c => !c.archived && (c.tier || tierOf(c.revenue)) === tier);
    for (const tpl of TASK_TEMPLATES[tier]) {
      if (tpl.key === 's1_annual' && !month.endsWith('-12')) continue;
      if (disabled.has(tpl.key)) continue;
      if (list.length === 0) continue;
      docs.push(mk({
        _id: `t_${month}_${tier}_${tpl.key}`,
        type: 'batch', tier, clientName: `${TIERS[tier].name}（${list.length}家）`,
        key: tpl.key, name: tpl.name, week: tpl.week, due: tpl.due,
        ownerRole: tpl.role, owner: ownersMap[tpl.role] || tpl.role,
        checklist: list.map(c => ({ id: c._id, name: c.name, done: false })),
      }));
    }
  }

  // 团队级
  for (const tpl of TEAM_TASKS.S3) {
    if (disabled.has(tpl.key)) continue;
    docs.push(mk({
      _id: `t_${month}_team_${tpl.key}`,
      type: 'team', tier: 'S3', clientName: '【S3 团队】7家实体户',
      key: tpl.key, name: tpl.name, week: tpl.week, due: tpl.due,
      ownerRole: tpl.role, owner: ownersMap[tpl.role] || tpl.role,
    }));
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
