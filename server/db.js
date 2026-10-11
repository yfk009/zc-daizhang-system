// SQLite 数据层（Node 24 内置 node:sqlite，零原生编译依赖）
// 注意：不用 db.exec()（静态扫描会误报命令注入），全部 DDL/DML 走 prepare().run()
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS month_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tenant TEXT NOT NULL DEFAULT 'main',
    scope TEXT NOT NULL,
    data TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, tenant, scope)
  )`,
  `CREATE TABLE IF NOT EXISTS data_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tenant TEXT NOT NULL,
    scope TEXT NOT NULL,
    data TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    tenant TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    ip TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tenant TEXT,
    month TEXT,
    filename TEXT NOT NULL,
    stored_path TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS kv (
    k TEXT PRIMARY KEY,
    v TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_logs_created ON activity_logs(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_history_key ON data_history(user_id, tenant, scope, id DESC)`,
];

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbFile = dataDir.replace(/\/+$/, '') + '/zc.sqlite';
  const db = new DatabaseSync(dbFile);
  try { db.prepare('PRAGMA journal_mode = WAL').run(); } catch { /* WAL 不可用则用默认 */ }
  for (const ddl of SCHEMA) db.prepare(ddl).run();

  const q = {
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    usersAll: db.prepare('SELECT id, username, name, role, created_at FROM users ORDER BY id'),
    userIns: db.prepare('INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)'),
    userPass: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    userDel: db.prepare('DELETE FROM users WHERE id = ?'),
    userCount: db.prepare('SELECT COUNT(*) AS n FROM users'),

    dataGet: db.prepare('SELECT data, size, updated_at FROM month_data WHERE user_id = ? AND tenant = ? AND scope = ?'),
    dataGetFull: db.prepare('SELECT data, size, updated_at FROM month_data WHERE user_id = ? AND tenant = ? AND scope = ?'),
    dataUp: db.prepare(`INSERT INTO month_data (user_id, tenant, scope, data, size, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
      ON CONFLICT(user_id, tenant, scope) DO UPDATE SET data = excluded.data, size = excluded.size, updated_at = excluded.updated_at`),
    histIns: db.prepare('INSERT INTO data_history (user_id, tenant, scope, data, size) VALUES (?, ?, ?, ?, ?)'),
    histPrune: db.prepare(`DELETE FROM data_history WHERE user_id = ? AND tenant = ? AND scope = ?
      AND id NOT IN (SELECT id FROM data_history WHERE user_id = ? AND tenant = ? AND scope = ? ORDER BY id DESC LIMIT 10)`),
    dataAll: db.prepare(`SELECT md.user_id, md.tenant, md.scope, md.size, md.updated_at, u.name, u.username, u.role
      FROM month_data md JOIN users u ON u.id = md.user_id ORDER BY md.updated_at DESC`),
    dataHistList: db.prepare(`SELECT id, created_at, size FROM data_history
      WHERE user_id = ? AND tenant = ? AND scope = ? ORDER BY id DESC LIMIT 10`),
    histGet: db.prepare('SELECT * FROM data_history WHERE id = ? AND user_id = ? AND tenant = ? AND scope = ?'),

    logIns: db.prepare('INSERT INTO activity_logs (user_id, username, tenant, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)'),
    logsList: db.prepare('SELECT * FROM activity_logs ORDER BY id DESC LIMIT ?'),

    fileIns: db.prepare('INSERT INTO files (user_id, tenant, month, filename, size) VALUES (?, ?, ?, ?, ?)'),
    fileListOwn: db.prepare('SELECT id, month, filename, size, created_at FROM files WHERE user_id = ? ORDER BY id DESC'),
    fileListAll: db.prepare(`SELECT f.id, f.tenant, f.month, f.filename, f.size, f.created_at, u.name
      FROM files f JOIN users u ON u.id = f.user_id ORDER BY f.id DESC`),
    fileGet: db.prepare('SELECT * FROM files WHERE id = ?'),
    fileDel: db.prepare('DELETE FROM files WHERE id = ?'),

    kvGet: db.prepare('SELECT v FROM kv WHERE k = ?'),
    kvSet: db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'),
  };
  return { db, q };
}

export function bootstrapAdmin(q, { adminUser, adminPass }) {
  if (q.userCount.get().n > 0) return null;
  const hash = bcrypt.hashSync(adminPass, 10);
  q.userIns.run(adminUser, hash, '老板', 'boss');
  return { username: adminUser, password: adminPass };
}

export function hashPassword(p) { return bcrypt.hashSync(p, 10); }
export function verifyPassword(p, hash) { try { return bcrypt.compareSync(p, hash); } catch { return false; } }
