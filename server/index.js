// 辫子哥代账系统 · 云端数据留存后端
// Express + Node24 内置 SQLite；接口：登录/JWT、按人整包数据同步、行为日志、文件、AI 代理、老板管理端
// 本地开发：node index.js（默认 127.0.0.1:3000）；线上：PM2 守护，nginx 把 /api/ 反代到本端口
// 分层：db.js(语句) → store.js(语义助手) → index.js(HTTP)；handler 不直接触碰语句与磁盘路径
import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, bootstrapAdmin, hashPassword, verifyPassword } from './db.js';
import { makeStore } from './store.js';
import { rateBlocked, rateFail, rateClear } from './ratelimit.js';

/* ---------- 配置（环境变量 > server/.env > 默认值） ---------- */
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // zc-system/
const SERVER_DIR = path.join(ROOT, 'server');
const ENV = {};
try {
  const raw = await fsp.readFile(path.join(SERVER_DIR, '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) ENV[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* 无 .env 时全部走默认/环境变量 */ }
const env = (k, d) => process.env[k] ?? ENV[k] ?? d;

const PORT = Number(env('PORT', 3000));
const DATA_DIR = env('DATA_DIR', path.join(SERVER_DIR, 'data'));
const UPLOAD_DIR = env('UPLOAD_DIR', path.join(SERVER_DIR, 'uploads'));
const AI_API_KEY = env('AI_API_KEY', '');
const AI_MODEL = env('AI_MODEL', 'glm-4-flash');
const ADMIN_USER = env('ADMIN_USER', 'boss');
const ADMIN_PASS = env('ADMIN_PASS', 'bianzige2026');
const INVITE_BOSS = env('INVITE_BOSS', '8888');   // 管理员邀请码（注册即管理员）
const INVITE_STAFF = env('INVITE_STAFF', '1111'); // 员工邀请码（普通权限）
const MAX_DATA_BYTES = 12 * 1024 * 1024;

// AI 上游端点白名单：值全部为代码内字面量常量，env 只能按键选择，不接受任意地址
const AI_ENDPOINTS = {
  zhipu: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  tongyi: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  kimi: 'https://api.moonshot.cn/v1/chat/completions',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  hunyuan: 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions',
  qianfan: 'https://qianfan.baidubce.com/v2/chat/completions',
};
const AI_CHAT_URL = AI_ENDPOINTS[env('AI_ENDPOINT', 'zhipu')] || '';

await fsp.mkdir(UPLOAD_DIR, { recursive: true });

const { q } = openDb(DATA_DIR);
const store = makeStore({ q, uploadDir: UPLOAD_DIR });
const bootAdmin = bootstrapAdmin(q, { adminUser: ADMIN_USER, adminPass: ADMIN_PASS });

// JWT 密钥：优先环境变量，否则入库 kv 表持久化（重启不变，会话不失效）
let JWT_SECRET = env('JWT_SECRET', '');
if (!JWT_SECRET) {
  const row = store.kvGet('jwt_secret');
  if (row && row.v) JWT_SECRET = row.v;
  else {
    JWT_SECRET = crypto.randomUUID() + crypto.randomUUID();
    store.kvSet('jwt_secret', JWT_SECRET);
  }
}

/* ---------- 应用与中间件 ---------- */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16mb' }));

const tenantOf = (req) => {
  const t = String(req.headers['x-tenant'] || 'main');
  return /^[A-Za-z0-9_-]{1,40}$/.test(t) ? t : 'main';
};
const ipOf = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
const logAct = (user, tenant, action, detail, req) =>
  store.writeLog(user ? user.id : null, user ? user.username : null, tenant || null, action, detail || null, ipOf(req));

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}
function userFromToken(token) {
  const payload = jwt.verify(token, JWT_SECRET);
  const u = store.findUserById(payload.id);
  return u ? { id: u.id, username: u.username, name: u.name, role: u.role } : null;
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ error: '未登录' });
  let user = null;
  try { user = userFromToken(token); } catch { user = null; }
  if (!user) return res.status(401).json({ error: '登录已过期，请重新登录' });
  req.user = user;
  next();
}
function bossOnly(req, res, next) {
  if (req.user.role !== 'boss') return res.status(403).json({ error: '仅老板（管理员）可访问' });
  next();
}
// 文件内容以 JSON(base64) 返回，前端解码后落盘；文件名仅作展示元数据
function sendStored(res, f, buf) {
  res.json({ ok: true, filename: f.filename, size: buf.length, dataBase64: buf.toString('base64') });
}

/* ---------- 基础接口 ---------- */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'zc-daizhang-server', version: '1.0.0', ai: { configured: !!(AI_API_KEY && AI_CHAT_URL), model: AI_MODEL }, serverTime: new Date().toISOString() });
});

app.post('/api/login', (req, res) => {
  const username = String((req.body || {}).username || '').trim();
  const password = String((req.body || {}).password || '');
  const tenant = tenantOf(req);
  if (!username || !password) return res.status(400).json({ error: '请输入账号和密码' });
  const limitKey = 'login|' + username + '|' + ipOf(req);
  if (rateBlocked(limitKey)) return res.status(429).json({ error: '失败次数过多，请 10 分钟后再试' });
  const u = store.findUserByUsername(username);
  if (!u || !verifyPassword(password, u.password_hash)) {
    rateFail(limitKey);
    logAct(u || null, tenant, 'login_fail', '用户名：' + username, req);
    return res.status(401).json({ error: '账号或密码错误' });
  }
  rateClear(limitKey);
  logAct(u, tenant, 'login_ok', null, req);
  res.json({ token: signToken(u), user: { id: u.id, username: u.username, name: u.name, role: u.role } });
});

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

/* 邀请码注册：8888=管理员 / 1111=员工（可在 server/.env 改 INVITE_BOSS / INVITE_STAFF）；
   同 IP 10 分钟限速防猜码，日志只记结果不记码值 */
app.post('/api/register', (req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim().toLowerCase();
  const password = String(b.password || '');
  const name = String(b.name || '').trim();
  const invite = String(b.invite || '').trim();
  const tenant = tenantOf(req);
  if (!username || !password || !name || !invite) return res.status(400).json({ error: '请填齐账号、姓名、密码和邀请码' });
  const regKey = 'reg|' + ipOf(req);
  if (rateBlocked(regKey)) return res.status(429).json({ error: '尝试次数过多，请 10 分钟后再试' });
  const role = invite === INVITE_BOSS ? 'boss' : invite === INVITE_STAFF ? 'staff' : null;
  if (!role) {
    rateFail(regKey);
    logAct(null, tenant, 'register_fail', '邀请码不正确', req);
    return res.status(403).json({ error: '邀请码不正确' });
  }
  if (!/^[a-z0-9_-]{2,24}$/.test(username)) return res.status(400).json({ error: '账号限 2-24 位小写字母/数字/-_' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (store.findUserByUsername(username)) return res.status(409).json({ error: '该账号已存在，请直接登录' });
  store.createUser(username, hashPassword(password), name, role);
  const u = store.findUserByUsername(username);
  logAct(u, tenant, 'register', `${username}（${name}，${role === 'boss' ? '管理员' : '员工'}）`, req);
  res.json({ token: signToken(u), user: { id: u.id, username: u.username, name: u.name, role: u.role } });
});

app.post('/api/logout', auth, (req, res) => {
  logAct(req.user, tenantOf(req), 'logout', null, req);
  res.json({ ok: true });
});

/* ---------- 数据同步：scope 为逻辑分包键（前端用 _all 存整包） ---------- */
const SCOPE_RE = /^[A-Za-z0-9_-]{1,32}$/;

app.get('/api/data/:scope', auth, (req, res) => {
  const scope = req.params.scope;
  if (!SCOPE_RE.test(scope)) return res.status(400).json({ error: 'scope 不合法' });
  const row = store.getData(req.user.id, tenantOf(req), scope);
  if (!row) return res.status(404).json({ error: '服务器暂无该数据包' });
  res.type('application/json').send(row.data);
});

app.put('/api/data/:scope', auth, (req, res) => {
  const scope = req.params.scope;
  if (!SCOPE_RE.test(scope)) return res.status(400).json({ error: 'scope 不合法' });
  const tenant = tenantOf(req);
  const body = req.body && typeof req.body === 'object' ? req.body : null;
  const data = body && body.data !== undefined ? body.data : body;
  if (data === null || data === undefined) return res.status(400).json({ error: '缺少 data' });
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  const bytes = Buffer.byteLength(text);
  if (bytes > MAX_DATA_BYTES) return res.status(413).json({ error: '数据包过大（>12MB），请先清理旧月份数据' });
  try { JSON.parse(text); } catch { return res.status(400).json({ error: 'data 不是合法 JSON' }); }
  store.saveData(req.user.id, tenant, scope, text, bytes);
  const brief = data && typeof data === 'object' && Array.isArray(data.customers) ? `，客户 ${data.customers.length} 家` : '';
  logAct(req.user, tenant, 'save_data', `scope=${scope} 大小=${bytes}B${brief}`, req);
  res.json({ ok: true, size: bytes, savedAt: new Date().toISOString() });
});

/* ---------- 行为埋点 ---------- */
app.post('/api/logs', auth, (req, res) => {
  const b = req.body || {};
  logAct(req.user, tenantOf(req), String(b.action || 'event').slice(0, 40), String(b.detail || '').slice(0, 500), req);
  res.json({ ok: true });
});

/* ---------- 文件（备份归档/附件）：内存暂存，按数字 id 落盘 <id>.bin ---------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

app.post('/api/files', auth, upload.single('file'), async (req, res) => {
  if (!req.file || !req.file.buffer) return res.status(400).json({ error: '未收到文件' });
  try { req.file.originalname = Buffer.from(req.file.originalname, 'latin1').toString('utf8'); } catch { /* 非 latin1 场景保持原名 */ }
  const id = store.addFile(req.user.id, tenantOf(req), String((req.body || {}).month || '').slice(0, 16) || null,
    req.file.originalname, req.file.size);
  const ok = await store.writeStoredUpload(id, req.file.buffer);
  if (!ok) { store.deleteFileRow(id); return res.status(500).json({ error: '文件落盘失败' }); }
  logAct(req.user, tenantOf(req), 'file_upload', `${req.file.originalname}（${req.file.size}B）`, req);
  res.json({ ok: true, id, filename: req.file.originalname, size: req.file.size });
});

app.get('/api/files', auth, (req, res) => res.json({ files: store.filesOf(req.user.id) }));

app.get('/api/files/:id/download', auth, async (req, res) => {
  const f = store.fileById(req.params.id);
  if (!f) return res.status(404).json({ error: '文件不存在' });
  if (f.user_id !== req.user.id && req.user.role !== 'boss') return res.status(403).json({ error: '无权下载他人文件' });
  const buf = await store.readStoredUpload(f.id);
  if (!buf) return res.status(404).json({ error: '文件已丢失' });
  logAct(req.user, tenantOf(req), 'file_download', f.filename, req);
  sendStored(res, f, buf);
});

app.delete('/api/files/:id', auth, async (req, res) => {
  const f = store.fileById(req.params.id);
  if (!f) return res.status(404).json({ error: '文件不存在' });
  if (f.user_id !== req.user.id && req.user.role !== 'boss') return res.status(403).json({ error: '无权删除他人文件' });
  store.deleteFileRow(f.id);
  await store.removeStoredUpload(f.id);
  logAct(req.user, tenantOf(req), 'file_delete', f.filename, req);
  res.json({ ok: true });
});

/* ---------- AI 代理：Key 只存服务器，不下发浏览器 ---------- */
app.post('/api/ai/chat', auth, async (req, res) => {
  if (!AI_API_KEY || !AI_CHAT_URL) return res.status(501).json({ error: !AI_CHAT_URL ? 'AI_ENDPOINT 未在白名单（zhipu/deepseek/tongyi/kimi/doubao/hunyuan/qianfan）' : '服务器未配置 AI Key（server/.env 的 AI_API_KEY）' });
  const b = req.body || {};
  if (!Array.isArray(b.messages) || !b.messages.length) return res.status(400).json({ error: '缺少 messages' });
  const model = String(b.model || AI_MODEL).slice(0, 80);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90 * 1000);
  try {
    const up = await fetch(AI_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AI_API_KEY },
      body: JSON.stringify({ model, messages: b.messages, temperature: b.temperature ?? 0, max_tokens: b.max_tokens, stream: false }),
      signal: ctrl.signal,
    });
    const text = await up.text();
    logAct(req.user, tenantOf(req), 'ai_call', `${model} 上游=${up.status}`, req);
    res.status(up.status).type('application/json').send(text);
  } catch (e) {
    logAct(req.user, tenantOf(req), 'ai_error', String(e.message || e).slice(0, 200), req);
    res.status(502).json({ error: 'AI 上游请求失败：' + (e.name === 'AbortError' ? '超时(90s)' : String(e.message || e)) });
  } finally { clearTimeout(timer); }
});

/* ---------- 老板管理端 ---------- */
function summarizePkg(text) {
  try {
    const d = JSON.parse(text);
    const months = new Set();
    for (const t of (d.monthTasks || [])) if (t.month) months.add(t.month);
    return { customers: (d.customers || []).length, tasks: (d.monthTasks || []).length, months: [...months].sort(), hasSettings: !!(d.settings && d.settings.length) };
  } catch { return { parseError: true }; }
}

app.get('/api/admin/overview', auth, bossOnly, (req, res) => {
  const rows = store.listAllData().map(r => {
    let summary = null;
    try { summary = summarizePkg(store.getDataFull(r.user_id, r.tenant, r.scope).data); } catch { /* 忽略 */ }
    return { userId: r.user_id, tenant: r.tenant, scope: r.scope, name: r.name, username: r.username, role: r.role, size: r.size, updatedAt: r.updated_at, summary };
  });
  res.json({ rows });
});

app.get('/api/admin/data/:userId/:tenant/:scope', auth, bossOnly, (req, res) => {
  const row = store.getDataFull(Number(req.params.userId), req.params.tenant, req.params.scope);
  if (!row) return res.status(404).json({ error: '无该数据包' });
  res.json({ data: JSON.parse(row.data), size: row.size, updatedAt: row.updated_at });
});

app.get('/api/admin/history/:userId/:tenant/:scope', auth, bossOnly, (req, res) => {
  res.json({ history: store.listHistory(Number(req.params.userId), req.params.tenant, req.params.scope) });
});

app.post('/api/admin/restore', auth, bossOnly, (req, res) => {
  const b = req.body || {};
  const userId = Number(b.userId), tenant = String(b.tenant || ''), scope = String(b.scope || ''), histId = Number(b.historyId);
  const hist = store.historyById(histId, userId, tenant, scope);
  if (!hist) return res.status(404).json({ error: '历史版本不存在' });
  store.snapshotCurrent(userId, tenant, scope);
  store.restoreData(userId, tenant, scope, hist.data, hist.size);
  logAct(req.user, tenant, 'admin_restore', `用户${userId} scope=${scope} 恢复历史#${histId}`, req);
  res.json({ ok: true });
});

app.get('/api/admin/logs', auth, bossOnly, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
  res.json({ logs: store.listLogs(limit) });
});

app.get('/api/admin/files', auth, bossOnly, (req, res) => res.json({ files: store.allFiles() }));

app.get('/api/admin/files/:id/download', auth, bossOnly, async (req, res) => {
  const f = store.fileById(req.params.id);
  if (!f) return res.status(404).json({ error: '文件不存在' });
  const buf = await store.readStoredUpload(f.id);
  if (!buf) return res.status(404).json({ error: '文件已丢失' });
  logAct(req.user, tenantOf(req), 'file_download', f.filename, req);
  sendStored(res, f, buf);
});

app.get('/api/admin/users', auth, bossOnly, (req, res) => res.json({ users: store.listUsers() }));

app.post('/api/admin/users', auth, bossOnly, (req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim().toLowerCase();
  const password = String(b.password || '');
  const name = String(b.name || '').trim();
  const role = b.role === 'boss' ? 'boss' : 'staff';
  if (!/^[a-z0-9_-]{2,24}$/.test(username)) return res.status(400).json({ error: '账号限 2-24 位小写字母/数字/-_' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (!name) return res.status(400).json({ error: '请填写姓名（与系统内成员名一致）' });
  if (store.findUserByUsername(username)) return res.status(409).json({ error: '账号已存在' });
  store.createUser(username, hashPassword(password), name, role);
  logAct(req.user, tenantOf(req), 'admin_user_create', `${username}（${name}，${role}）`, req);
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/password', auth, bossOnly, (req, res) => {
  const u = store.findUserById(Number(req.params.id));
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const password = String((req.body || {}).password || '');
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  store.updateUserPassword(u.id, hashPassword(password));
  logAct(req.user, tenantOf(req), 'admin_user_resetpass', u.username, req);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', auth, bossOnly, (req, res) => {
  const u = store.findUserById(Number(req.params.id));
  if (!u) return res.status(404).json({ error: '用户不存在' });
  if (u.id === req.user.id) return res.status(400).json({ error: '不能删除自己' });
  if (u.role === 'boss' && store.listUsers().filter(x => x.role === 'boss').length <= 1) {
    return res.status(400).json({ error: '不能删除最后一名管理员' });
  }
  store.deleteUser(u.id);
  logAct(req.user, tenantOf(req), 'admin_user_delete', u.username, req);
  res.json({ ok: true });
});

/* ---------- 兜底 ---------- */
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: '请求体过大' });
  console.error('[server]', err);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[zc-server] 已启动 http://127.0.0.1:${PORT}  数据目录: ${DATA_DIR}`);
  if (bootAdmin) console.log(`[zc-server] 首次启动，已创建管理员账号: ${bootAdmin.username} / ${bootAdmin.password}（请尽快登录后在管理页改密）`);
  if (!AI_API_KEY) console.log('[zc-server] 提示: 未配置 AI_API_KEY，/api/ai/chat 将返回 501');
});
