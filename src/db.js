// 数据层：单机模式(localStorage) / 云模式(CloudBase) 双适配
// 所有业务代码只调用 store API，不感知底层
import { CLOUDBASE_ENV } from './config.js';

let mode = 'local';
let cloud = null; // { app, auth, db }

export function getMode() { return mode; }
export function isCloud() { return mode === 'cloud'; }

export function getUser() {
  try { return JSON.parse(localStorage.getItem('zx_user') || 'null'); } catch { return null; }
}
export function setUser(u) { localStorage.setItem('zx_user', JSON.stringify(u)); }

export async function init() {
  if (CLOUDBASE_ENV) {
    try {
      const mod = await import('@cloudbase/js-sdk');
      const SDK = mod.default || mod;
      const app = SDK.initializeApp({ env: CLOUDBASE_ENV });
      const auth = app.auth({ persistence: 'local' });
      cloud = { app, auth, db: app.database() };
      let signedIn = false;
      try { signedIn = !!(await auth.hasLoginState()); } catch { /* 未登录属正常 */ }
      mode = 'cloud';
      return { mode, signedIn };
    } catch (e) {
      console.warn('[db] CloudBase 初始化失败，转单机模式:', e);
      mode = 'local';
    }
  }
  return { mode: 'local', signedIn: false };
}

export async function signInCloud(username, password) {
  if (!cloud) throw new Error('未配置云端环境');
  await cloud.auth.signInWithPassword({ username, password });
  return true;
}
export async function signOutCloud() {
  if (cloud) await cloud.auth.signOut();
}

/* ---------- 集合操作（两种模式统一接口） ---------- */
function lsKey(coll) { return 'zx_' + coll; }
function lsRead(coll) {
  try { return JSON.parse(localStorage.getItem(lsKey(coll)) || '[]'); } catch { return []; }
}
function lsWrite(coll, arr) { localStorage.setItem(lsKey(coll), JSON.stringify(arr)); }
export function newId(prefix) {
  const uid = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + performance.now().toString(36));
  return (prefix ? prefix + '_' : '') + uid.replace(/-/g, '').slice(0, 20);
}

export const store = {
  async list(coll, filter) {
    if (mode === 'cloud') {
      let q = cloud.db.collection(coll);
      if (filter && Object.keys(filter).length) q = q.where(filter);
      const res = await q.limit(1000).get();
      return res.data || [];
    }
    let arr = lsRead(coll);
    if (filter && Object.keys(filter).length) {
      arr = arr.filter(d => Object.entries(filter).every(([k, v]) => d[k] === v));
    }
    return arr;
  },

  // 按 _id 或 whereKey 幂等写入；doc 需含 _id 或 keyFn 返回唯一键
  async upsert(coll, doc) {
    if (mode === 'cloud') {
      const { _id, ...data } = doc;
      if (_id) {
        await cloud.db.collection(coll).doc(_id).set(data);
        return doc;
      }
      const r = await cloud.db.collection(coll).add(data);
      doc._id = (r && (r.id || r._id)) || newId();
      return doc;
    }
    const arr = lsRead(coll);
    const i = doc._id ? arr.findIndex(d => d._id === doc._id) : -1;
    if (i >= 0) arr[i] = doc;
    else { doc._id = doc._id || newId(); arr.push(doc); }
    lsWrite(coll, arr);
    return doc;
  },

  async upsertMany(coll, docs) {
    for (const d of docs) await store.upsert(coll, d);
    return docs.length;
  },

  async remove(coll, id) {
    if (mode === 'cloud') { await cloud.db.collection(coll).doc(id).remove(); return; }
    lsWrite(coll, lsRead(coll).filter(d => d._id !== id));
  },

  // 单例文档（settings 用）
  async getSingleton(coll, id, defaults) {
    const arr = await store.list(coll, { _single: id });
    if (arr.length) return arr[0];
    const doc = { _single: id, ...defaults };
    return doc;
  }
};

/* 导出/导入整库备份（单机模式的生命线） */
export function exportAllLocal() {
  const out = {};
  ['customers', 'monthTasks', 'taxConfirm', 'financials', 'amoebaRuns', 'settings'].forEach(c => { out[c] = lsRead(c); });
  return out;
}
export async function importAllLocal(data) {
  for (const [c, arr] of Object.entries(data)) {
    if (Array.isArray(arr)) {
      if (mode === 'cloud') { await store.upsertMany(c, arr); }
      else lsWrite(c, arr);
    }
  }
}

/* 清空全部业务数据（保留 settings 团队/参数；置种子标记防自动重播） */
export async function wipeAll() {
  const colls = ['customers', 'monthTasks', 'taxConfirm', 'financials', 'amoebaRuns'];
  for (const c of colls) {
    if (mode === 'cloud') {
      const docs = await store.list(c);
      for (const d of docs) if (d._id) await store.remove(c, d._id);
    } else {
      localStorage.removeItem(lsKey(c));
    }
  }
  localStorage.setItem('zx_seed_done', '1');
}
