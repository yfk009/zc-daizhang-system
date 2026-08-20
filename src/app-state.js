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
  ownersMap: { boss: '老板', lead: '小王', assist: '小李' },
  amoeba: {
    divPct: 30, opsPct: 70, fixedPct: 80, officePct: 20,
    baseSalary: 3000, perfOn: false,
  },
  evidenceRequired: true,
};

export async function loadAll() {
  const s = await store.list('settings');
  state.settings = s.find(x => x._id === 'settings_main') || { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (state.settings[k] === undefined) state.settings[k] = DEFAULT_SETTINGS[k];
  }
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
export async function seedCustomers() {
  if (!SEED_CUSTOMERS.length) return { skipped: true, count: 0, empty: true };
  const existing = await store.list('customers');
  if (existing.length > 0) return { skipped: true, count: existing.length };
  const docs = SEED_CUSTOMERS.map(c => {
    const tier = tierOf(c.revenue);
    return {
      ...c, tier,
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
