// 云端同步层：探测后端 → 账号登录(JWT) → 首载拉取 → 防抖自动保存 → AI 代理
// 探测失败自动回落单机模式（localStorage），行为与历史版本完全一致
import { exportAllLocal, importAllLocal } from './db.js';

const TOKEN_KEY = 'zx_token';
let serverMode = false;   // 是否已探测到后端
let me = null;            // { id, username, name, role }
let healthInfo = null;    // /api/health 返回（含 ai 配置状态）
let saveTimer = null;     // 防抖句柄
let pushing = false;
let pushQueued = false;

export function isServerMode() { return serverMode; }
export function getMe() { return me; }
export function getHealth() { return healthInfo; }

function saveState(state, extra) {
  try { window.dispatchEvent(new CustomEvent('zx:savestate', { detail: { state, ...extra } })); } catch { /* 非浏览器环境 */ }
}
function token() { return localStorage.getItem(TOKEN_KEY) || ''; }

async function apiFetch(path, opts = {}) {
  const headers = { 'X-Tenant': tenantId(), ...(opts.headers || {}) };
  const t = token();
  if (t) headers['Authorization'] = 'Bearer ' + t;
  if (opts.body && typeof opts.body === 'string') headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...opts, headers });
  let json = null;
  try { json = await res.json(); } catch { /* 非 JSON */ }
  if (res.status === 401 && serverMode && !path.startsWith('/api/login')) {
    saveState('expired');
    throw Object.assign(new Error((json && json.error) || '登录已过期'), { status: 401 });
  }
  if (!res.ok) throw Object.assign(new Error((json && json.error) || 'HTTP ' + res.status), { status: res.status, json });
  return json;
}

// 站点租户：按域名隔离（主站/dali/chuxiong/分身站/本地 各自独立数据空间）
export function tenantId() {
  const h = (typeof location !== 'undefined' ? location.hostname : 'local').toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '') return 'local';
  return h.replace(/[^a-z0-9-]/g, '-').slice(0, 40);
}

/* 启动探测：2 秒内无响应视为单机模式 */
export async function probe() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch('/api/health', { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    healthInfo = await res.json();
    serverMode = true;
  } catch { serverMode = false; }
  return serverMode;
}

/* 登录/登出 */
export async function login(username, password) {
  const r = await apiFetch('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  localStorage.setItem(TOKEN_KEY, r.token);
  me = r.user;
  return me;
}
/* 换账号串号防护：同一浏览器上一账号≠本账号时，清空本地业务集合再从服务器拉取，
   避免上一账号（如老板）的整包被当前账号首次保存时顶名上云 */
export function switchGuard(username) {
  const last = localStorage.getItem('zx_last_user');
  localStorage.setItem('zx_last_user', username);
  if (last === username) return false;
  ['customers', 'monthTasks', 'taxConfirm', 'financials', 'amoebaRuns', 'coop', 'risknotices', 'serviceOrders', 'settings'].forEach(c => localStorage.removeItem('zx_' + c));
  localStorage.removeItem('zx_schema_version');
  localStorage.setItem('zx_seed_done', '1');
  return true;
}
export async function logout() {
  try { await apiFetch('/api/logout', { method: 'POST' }); } catch { /* 已过期也继续清理 */ }
  localStorage.removeItem(TOKEN_KEY);
  me = null;
}
/* 用已有令牌恢复会话 */
export async function resume() {
  if (!token()) return null;
  try {
    const r = await apiFetch('/api/me');
    me = r.user;
    return me;
  } catch (e) {
    if (e.status === 401) localStorage.removeItem(TOKEN_KEY);
    return null;
  }
}

/* 数据拉取：服务器有整包返回解析结果，没有返回 null（前端沿用本地/种子） */
export async function pullData() {
  try {
    const r = await fetch('/api/data/_all', { headers: { 'Authorization': 'Bearer ' + token(), 'X-Tenant': tenantId() } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const pkg = await r.json();
    return (pkg && typeof pkg === 'object') ? pkg : null;
  } catch (e) {
    if (e.status === 401) throw e;
    console.warn('[sync] 拉取失败，使用本地数据：', e.message);
    return null;
  }
}

/* 服务器整包落地本地集合（挂起同步防回声：导入的数据不再立刻推回服务器） */
let suspended = 0;
export async function importServerData(pkg) {
  suspended++;
  try { await importAllLocal(pkg); }
  finally { setTimeout(() => { suspended = Math.max(0, suspended - 1); }, 200); }
}

/* 防抖自动保存：业务写操作触发 zx:dirty 事件 → 3 秒后整包上推 */
export function markDirty(immediate = false) {
  if (!serverMode || suspended > 0) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveState('pending');
  saveTimer = setTimeout(() => pushData(), immediate ? 0 : 3000);
}

export async function pushData() {
  if (!serverMode) return { skipped: true };
  if (pushing) { pushQueued = true; return { queued: true }; }
  pushing = true;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  saveState('saving');
  try {
    const pkg = exportAllLocal();
    const r = await apiFetch('/api/data/_all', { method: 'PUT', body: JSON.stringify({ data: pkg }) });
    saveState('saved', { at: new Date(), size: r.size });
    return { ok: true };
  } catch (e) {
    saveState('error', { message: e.message });
    return { ok: false, error: e.message };
  } finally {
    pushing = false;
    if (pushQueued) { pushQueued = false; markDirty(); }
  }
}

/* AI 代理：服务器端持 Key 转发（OpenAI 兼容 /chat/completions 协议） */
export async function aiChat(body) {
  return apiFetch('/api/ai/chat', { method: 'POST', body: JSON.stringify(body) });
}
export function serverAiReady() {
  return !!(healthInfo && healthInfo.ai && healthInfo.ai.configured);
}

/* 管理端接口（仅 boss 角色） */
export async function adminApi(path, opts = {}) {
  return apiFetch('/api/admin' + path, opts);
}

/* 备份归档到服务器（文件留存） */
export async function archiveBackup(blob, filename, month) {
  const fd = new FormData();
  fd.append('file', blob, filename);
  if (month) fd.append('month', month);
  const res = await fetch('/api/files', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token(), 'X-Tenant': tenantId() }, body: fd });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error((j && j.error) || 'HTTP ' + res.status);
  return j;
}

/* 解码下载服务器文件（base64 JSON 响应） */
export function downloadBase64(filename, b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement('a');
  a.href = url; a.download = filename || 'download.bin';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
