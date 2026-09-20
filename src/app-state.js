// 应用状态中枢：月份、数据缓存、设置
import { store, getUser, setUser } from './db.js';
import { tierOf } from './templates.js';
import { monthNow } from './ui.js';
import { SEED_CUSTOMERS } from './seed-data.js';

export const state = {
  month: localStorage.getItem('zx_month') || monthNow(),
  customers: [],
  tasks: [],        // 当月任务
  tax: [],          // 当月税金确认
  financials: [],   // 全部财务数据
  amoebaRuns: [],
  settings: null,
};

export function setMonth(m) { state.month = m; localStorage.setItem('zx_month', m); }

export const DEFAULT_SETTINGS = {
  _id: 'settings_main',
  staff: [
    { key: 'boss', name: '老板', role: '总经理', weight: 2.5, boss: true },
    { key: 'lead', name: '小王', role: '主办会计', weight: 1.5, boss: false },
    { key: 'assist', name: '小李', role: '兼职助理', weight: 0.8, boss: false },
  ],
  ownersMap: { boss: '老板', director: '老板', lead: '小王', reviewer: '小王', assist: '小李' },
  amoeba: {
    divPct: 30, opsPct: 70, fixedPct: 80, officePct: 20,
    baseSalary: 3000, perfOn: false,
  },
  evidenceRequired: true,
  customTemplates: [],        // 自定义任务模板（四周看板添加，长期生效）
  disabledTemplateKeys: [],   // 停用的模板 key（内置或自定义）
};

// 数据迁移：v2 = 代账4.0 五档口径（S1–S5 + 纳税人身份 + 5 角色）
const SCHEMA_KEY = 'zx_schema_version';
async function migrateV2() {
  if (localStorage.getItem(SCHEMA_KEY) === '2') return;
  const customers = await store.list('customers');
  let changed = 0;
  for (const c of customers) {
    const before = JSON.stringify([c.tier, c.taxpayerType]);
    // 旧 S3（营业额>100万深度户）默认按一般纳税人处理，其余默认小规模；客户页可改
    if (!c.taxpayerType) c.taxpayerType = c.tier === 'S3' ? 'general' : 'small';
    if (!c.tierManual) {
      c.tier = tierOf({ revenue: c.revenue, taxpayerType: c.taxpayerType });
    }
    if (JSON.stringify([c.tier, c.taxpayerType]) !== before) {
      await store.upsert('customers', c);
      changed++;
    }
  }
  localStorage.setItem(SCHEMA_KEY, '2');
  if (changed) console.log(`[migrate] v2 五档口径：已迁移 ${changed} 家客户`);
}

export async function loadAll() {
  await migrateV2();
  const s = await store.list('settings');
  state.settings = s.find(x => x._id === 'settings_main') || { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (state.settings[k] === undefined) state.settings[k] = DEFAULT_SETTINGS[k];
  }
  state.settings.ownersMap = { ...DEFAULT_SETTINGS.ownersMap, ...(state.settings.ownersMap || {}) };
  state.customers = await store.list('customers');
  state.tasks = await store.list('monthTasks', { month: state.month });
  state.tax = await store.list('taxConfirm', { month: state.month });
  state.financials = await store.list('financials');
  state.amoebaRuns = await store.list('amoebaRuns');
}

export async function reloadMonth() {
  state.tasks = await store.list('monthTasks', { month: state.month });
  state.tax = await store.list('taxConfirm', { month: state.month });
}

// 初始化 68 家种子客户（tier/负责人按规则写入）；仓库默认空种子，本地生成真实种子用 scripts/gen-seed.mjs
// 五档口径：零申报→S1；有经营且年营业额>100万的种子户按一般纳税人推档（S3/S4/S5），其余小规模→S2
export async function seedCustomers() {
  if (!SEED_CUSTOMERS.length) return { skipped: true, count: 0, empty: true };
  const existing = await store.list('customers');
  if (existing.length > 0) return { skipped: true, count: existing.length };
  const docs = SEED_CUSTOMERS.map(c => {
    const taxpayerType = c.revenue > 1000000 ? 'general' : 'small';
    const tier = tierOf({ revenue: c.revenue, taxpayerType });
    return {
      ...c, tier, taxpayerType,
      ownerRole: tier === 'S1' ? 'assist' : 'lead',
      owner: tier === 'S1' ? '小李' : '小王',
      tierManual: false,
    };
  });
  await store.upsertMany('customers', docs);
  state.customers = docs;
  return { skipped: false, count: docs.length };
}

export function clientById(id) { return state.customers.find(c => c._id === id); }
export function taxOf(clientId) { return state.tax.find(t => t.clientId === clientId && t.month === state.month); }
export function finOf(clientId, m) { return state.financials.find(f => f.clientId === clientId && f.month === (m || prevDataMonth())); }
// 服务月 M 处理的是 M-1 的账务数据
export function prevDataMonth() {
  const [y, mo] = state.month.split('-').map(Number);
  const d = new Date(y, mo - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export { getUser, setUser };
