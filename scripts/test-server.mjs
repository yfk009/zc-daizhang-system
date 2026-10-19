// 后端接口自动化测试：起独立实例（临时数据目录+随机夹具账号），逐接口断言后清理
// 运行：node scripts/test-server.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3456 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-srv-test-'));

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : '  ← ' + (extra || '')}`);
}

async function waitForServer(ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return await r.json(); } catch { /* 未就绪 */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('服务器 8 秒内未就绪');
}

const child = spawn(process.execPath, ['server/index.js'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: {
    ...process.env, PORT: String(PORT),
    DATA_DIR: path.join(TMP, 'data'), UPLOAD_DIR: path.join(TMP, 'uploads'),
    JWT_SECRET: 'test-secret', ADMIN_USER: 'admintest', ADMIN_PASS: 'test123456',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', d => process.stdout.write('[srv] ' + d));
child.stderr.on('data', d => process.stderr.write('[srv:err] ' + d));

async function api(p, { method = 'GET', token: tk, tenant = 'local', body, form } = {}) {
  const headers = { 'X-Tenant': tenant };
  if (tk) headers['Authorization'] = 'Bearer ' + tk;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + p, { method, headers, body: form ? form : body !== undefined ? JSON.stringify(body) : undefined });
  let j = null;
  try { j = await r.json(); } catch { /* 空或非 JSON */ }
  return { status: r.status, json: j };
}

try {
  const h = await waitForServer();
  check('health 探测正常', h && h.ok && h.name === 'zc-daizhang-server', JSON.stringify(h));

  let r = await api('/api/login', { method: 'POST', body: { username: 'admintest', password: 'wrong' } });
  check('错误密码 401', r.status === 401, 'got ' + r.status);

  r = await api('/api/login', { method: 'POST', body: { username: 'admintest', password: 'test123456' } });
  check('管理员登录成功 role=boss', r.status === 200 && r.json.user.role === 'boss', JSON.stringify(r.json));
  const boss = r.json.token;

  r = await api('/api/data/_all');
  check('无令牌读数据 401', r.status === 401, 'got ' + r.status);

  r = await api('/api/data/_all', { token: boss });
  check('无数据包时 404', r.status === 404, 'got ' + r.status);

  const pkg1 = { customers: [{ _id: 'c_1', name: '甲公司', tier: 'S2' }, { _id: 'c_2', name: '乙公司', tier: 'S1' }], monthTasks: [{ _id: 't1', month: '2026-10' }], settings: [{ _id: 'settings_main' }] };
  r = await api('/api/data/_all', { method: 'PUT', token: boss, body: { data: pkg1 } });
  check('保存整包 ok', r.status === 200 && r.json.ok, JSON.stringify(r.json));

  r = await api('/api/data/_all', { token: boss });
  check('回读整包一致', r.status === 200 && r.json.customers.length === 2, JSON.stringify(r.json).slice(0, 120));

  r = await api('/api/data/_all', { method: 'PUT', token: boss, body: { data: { customers: [{ _id: 'c_9', name: '丙公司' }] } } });
  check('第二次保存 ok（旧版进历史）', r.status === 200, JSON.stringify(r.json));

  r = await api('/api/admin/history/1/local/_all', { token: boss });
  check('历史版本保留 1 条', r.status === 200 && r.json.history.length === 1, JSON.stringify(r.json));
  const histId = r.json.history && r.json.history[0] && r.json.history[0].id;

  r = await api('/api/admin/overview', { token: boss });
  const rowBoss = (r.json.rows || []).find(x => x.username === 'admintest' && x.tenant === 'local');
  check('总览含管理员数据包+摘要', !!rowBoss && rowBoss.summary && rowBoss.summary.customers === 1, JSON.stringify(r.json).slice(0, 200));

  r = await api('/api/admin/users', { method: 'POST', token: boss, body: { username: 'xiaotest', password: 'test654321', name: '小测', role: 'staff' } });
  check('创建员工账号 ok', r.status === 200, JSON.stringify(r.json));
  r = await api('/api/admin/users', { method: 'POST', token: boss, body: { username: 'xiaotest', password: 'test654321', name: '小测', role: 'staff' } });
  check('重复账号 409', r.status === 409, 'got ' + r.status);

  r = await api('/api/login', { method: 'POST', body: { username: 'xiaotest', password: 'test654321' }, tenant: 'site2' });
  const staff = r.json && r.json.token;
  check('员工登录成功', r.status === 200 && !!staff, JSON.stringify(r.json));

  r = await api('/api/admin/overview', { token: staff });
  check('员工访问管理接口 403', r.status === 403, 'got ' + r.status);

  r = await api('/api/data/_all', { method: 'PUT', token: staff, tenant: 'site2', body: { data: { customers: [{ _id: 'c_s1', name: '站点二客户' }] } } });
  check('员工独立站点数据保存 ok', r.status === 200, JSON.stringify(r.json));

  r = await api('/api/admin/overview', { token: boss });
  check('总览跨站点可见（local+site2）', r.status === 200 && (r.json.rows || []).some(x => x.tenant === 'site2'), JSON.stringify(r.json).slice(0, 200));

  r = await api('/api/admin/restore', { method: 'POST', token: boss, body: { userId: 1, tenant: 'local', scope: '_all', historyId: histId } });
  check('恢复历史版本 ok', r.status === 200, JSON.stringify(r.json));
  r = await api('/api/data/_all', { token: boss });
  check('恢复后数据回到第 1 版（2 家客户）', r.json && r.json.customers && r.json.customers.length === 2, JSON.stringify(r.json).slice(0, 120));

  r = await api('/api/logs', { method: 'POST', token: staff, tenant: 'site2', body: { action: 'test_event', detail: '测试埋点' } });
  check('行为埋点 ok', r.status === 200, JSON.stringify(r.json));
  r = await api('/api/admin/logs?limit=50', { token: boss });
  check('日志含登录与保存与埋点', r.status === 200 && ['save_data', 'login_ok', 'test_event'].every(a => (r.json.logs || []).some(l => l.action === a)), 'actions=' + (r.json.logs || []).map(l => l.action).join(','));

  // AI 代理：未配 Key → 501
  r = await api('/api/ai/chat', { method: 'POST', token: boss, body: { messages: [{ role: 'user', content: 'hi' }] } });
  check('AI 未配 Key 时 501', r.status === 501, 'got ' + r.status);

  // AI 在线配置（界面保存/测试/热生效）
  r = await api('/api/ai/config', { token: staff, tenant: 'site2' });
  check('员工读 AI 配置 403', r.status === 403, 'got ' + r.status);
  r = await api('/api/ai/config', { token: boss });
  check('初始 AI 配置未配置', r.status === 200 && r.json.configured === false && r.json.source === 'env', JSON.stringify(r.json));
  r = await api('/api/ai/config', { method: 'POST', token: boss, body: { endpoint: 'evil', model: 'x' } });
  check('非法厂商 400', r.status === 400, 'got ' + r.status);
  r = await api('/api/ai/config', { method: 'POST', token: boss, body: { endpoint: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-fake-test-000000' } });
  check('保存 AI 配置 ok', r.status === 200 && r.json.configured === true, JSON.stringify(r.json));
  r = await api('/api/ai/config', { token: boss });
  check('回读配置（Key 掩码）', r.json.configured === true && r.json.endpoint === 'deepseek' && String(r.json.apiKeyMasked).includes('****'), JSON.stringify(r.json));
  r = await api('/api/ai/test', { method: 'POST', token: boss, body: {} });
  check('假 Key 测试返回失败详情（非异常）', r.status === 200 && r.json.ok === false && !!r.json.error, JSON.stringify(r.json).slice(0, 120));
  r = await api('/api/ai/chat', { method: 'POST', token: boss, body: { messages: [{ role: 'user', content: 'hi' }] } });
  check('保存后 chat 热生效（透传上游 401/502，而非未配置 501）', r.status === 401 || r.status === 502, 'got ' + r.status);
  r = await api('/api/ai/config', { method: 'POST', token: boss, body: { endpoint: 'deepseek', model: 'deepseek-chat', clearKey: true } });
  check('清除 Key ok', r.status === 200 && r.json.configured === false, JSON.stringify(r.json));
  r = await api('/api/ai/config', { token: boss });
  check('清除后未配置', r.json.configured === false, JSON.stringify(r.json));

  // 文件上传/下载/权限
  const content = JSON.stringify(pkg1);
  const fd = new FormData();
  fd.append('file', new Blob([content], { type: 'application/json' }), '备份归档测试.json');
  fd.append('month', '2026-10');
  r = await api('/api/files', { method: 'POST', token: boss, form: fd });
  check('备份归档上传 ok', r.status === 200 && r.json.filename === '备份归档测试.json', JSON.stringify(r.json));

  r = await api('/api/files', { token: boss });
  const fid = r.json.files && r.json.files[0] && r.json.files[0].id;
  check('本人文件列表可见', r.status === 200 && r.json.files.length === 1, JSON.stringify(r.json));

  r = await api(`/api/files/${fid}/download`, { token: staff });
  check('员工下载他人文件 403', r.status === 403, 'got ' + r.status);

  r = await api(`/api/files/${fid}/download`, { token: boss });
  const decoded = r.json && r.json.dataBase64 ? Buffer.from(r.json.dataBase64, 'base64').toString('utf8') : '';
  check('下载内容与上传一致', decoded === content, 'len=' + decoded.length);

  r = await api(`/api/files/${fid}`, { method: 'DELETE', token: boss });
  check('删除文件 ok', r.status === 200, JSON.stringify(r.json));

  // 账号保护
  r = await api('/api/admin/users/1/password', { method: 'POST', token: boss, body: { password: 'newpass654' } });
  check('管理员改密 ok', r.status === 200, JSON.stringify(r.json));
  r = await api('/api/login', { method: 'POST', body: { username: 'admintest', password: 'test123456' } });
  check('旧密码 401', r.status === 401, 'got ' + r.status);
  r = await api('/api/login', { method: 'POST', body: { username: 'admintest', password: 'newpass654' } });
  check('新密码登录 ok', r.status === 200, JSON.stringify(r.json).slice(0, 80));

  r = await api('/api/admin/users/1', { method: 'DELETE', token: boss });
  check('不能删除自己', r.status === 400, 'got ' + r.status);
  r = await api('/api/admin/users', { token: boss });
  const staffId = (r.json.users || []).find(u => u.username === 'xiaotest');
  r = await api(`/api/admin/users/${staffId ? staffId.id : 0}`, { method: 'DELETE', token: boss });
  check('删除员工 ok', r.status === 200, JSON.stringify(r.json));
  r = await api('/api/admin/users', { method: 'POST', token: boss, body: { username: 'BAD!', password: 'test654321', name: 'X' } });
  check('非法用户名 400', r.status === 400, 'got ' + r.status);

  // tenant 头缺失/非法 → 回落 main
  await api('/api/data/_all', { method: 'PUT', token: boss, tenant: '../evil', body: { data: { customers: [] } } });
  r = await api('/api/admin/overview', { token: boss });
  check('非法租户头回落 main', (r.json.rows || []).some(x => x.tenant === 'main' && x.username === 'admintest'), JSON.stringify(r.json).slice(0, 200));

  // 邀请码注册：8888=管理员 / 1111=员工
  r = await api('/api/register', { method: 'POST', body: { username: 'regboss', password: 'reg654321', name: '注册管理员', invite: '9999' }, tenant: 'site2' });
  check('错误邀请码 403', r.status === 403, 'got ' + r.status);
  r = await api('/api/register', { method: 'POST', body: { username: 'regboss', password: 'reg654321', name: '注册管理员', invite: '8888' }, tenant: 'site2' });
  check('8888 注册为管理员并自动登录', r.status === 200 && r.json.user.role === 'boss' && !!r.json.token, JSON.stringify(r.json));
  r = await api('/api/register', { method: 'POST', body: { username: 'regstaff', password: 'reg654321', name: '注册员工', invite: '1111' }, tenant: 'site2' });
  check('1111 注册为员工', r.status === 200 && r.json.user.role === 'staff', JSON.stringify(r.json));
  const regStaff = r.json.token;
  r = await api('/api/register', { method: 'POST', body: { username: 'regstaff', password: 'reg654321', name: '重复', invite: '1111' } });
  check('重复账号 409', r.status === 409, 'got ' + r.status);
  r = await api('/api/register', { method: 'POST', body: { username: 'BAD!', password: 'reg654321', name: 'X', invite: '1111' } });
  check('注册非法用户名 400', r.status === 400, 'got ' + r.status);
  r = await api('/api/admin/overview', { token: regStaff });
  check('注册员工无管理权限 403', r.status === 403, 'got ' + r.status);
  r = await api('/api/admin/logs?limit=50', { token: boss });
  check('注册日志含成功与失败（不含码值）', (r.json.logs || []).some(l => l.action === 'register') && (r.json.logs || []).some(l => l.action === 'register_fail') && !JSON.stringify(r.json.logs).includes('8888'), '');
} catch (e) {
  check('测试过程无异常', false, e.message);
} finally {
  child.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 300));
  fs.rmSync(TMP, { recursive: true, force: true });
}

const pass = results.filter(r => r.ok).length;
console.log(`\n== 接口测试 ${pass}/${results.length} ==`);
process.exit(pass === results.length ? 0 : 1);
