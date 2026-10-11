// 语义化数据访问层：index.js 的 handler 只调用这里的具名函数，
// 不直接触碰 prepared statement（保持 handler 层无 DB 细节，也便于单测）
import fsp from 'node:fs/promises';

export function makeStore({ q, uploadDir }) {
  // 落盘文件名 = 纯数字 id + '.bin'（由强转后的整数构造，原始文件名只存数据库作展示）
  const storedPathOf = (id) => {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return null;
    const p = uploadDir + '/' + n + '.bin';
    return p.startsWith(uploadDir + '/') ? p : null;
  };

  const s = {
    /* 用户 */
    findUserByUsername: (username) => q.userByName.get(username),
    findUserById: (id) => q.userById.get(id),
    countUsers: () => q.userCount.get().n,
    listUsers: () => q.usersAll.all(),
    createUser: (username, hash, name, role) => q.userIns.run(username, hash, name, role),
    updateUserPassword: (id, hash) => q.userPass.run(hash, id), // 语句占位符顺序：SET password_hash=? WHERE id=?
    deleteUser: (id) => q.userDel.run(id),

    /* 数据包（按 人+租户+scope 唯一；旧版进历史，保留 10 份） */
    getData: (userId, tenant, scope) => q.dataGet.get(userId, tenant, scope),
    getDataFull: (userId, tenant, scope) => q.dataGetFull.get(userId, tenant, scope),
    listAllData: () => q.dataAll.all(),
    saveData: (userId, tenant, scope, text, bytes) => {
      const old = q.dataGet.get(userId, tenant, scope);
      if (old) {
        q.histIns.run(userId, tenant, scope, old.data, old.size);
        q.histPrune.run(userId, tenant, scope, userId, tenant, scope);
      }
      q.dataUp.run(userId, tenant, scope, text, bytes);
    },
    listHistory: (userId, tenant, scope) => q.dataHistList.all(userId, tenant, scope),
    historyById: (histId, userId, tenant, scope) => q.histGet.get(histId, userId, tenant, scope),
    restoreData: (userId, tenant, scope, text, bytes) => q.dataUp.run(userId, tenant, scope, text, bytes),
    snapshotCurrent: (userId, tenant, scope) => {
      const cur = q.dataGet.get(userId, tenant, scope);
      if (cur) {
        q.histIns.run(userId, tenant, scope, cur.data, cur.size);
        q.histPrune.run(userId, tenant, scope, userId, tenant, scope);
      }
    },

    /* 行为日志 */
    writeLog: (userId, username, tenant, action, detail, ip) => q.logIns.run(userId, username, tenant, action, detail, ip),
    listLogs: (limit) => q.logsList.all(limit),

    /* 文件：元数据入库返回数字 id，内容按 <id>.bin 落盘 */
    addFile: (userId, tenant, month, filename, size) => {
      const r = q.fileIns.run(userId, tenant, month, filename, Number(size));
      return Number(r.lastInsertRowid);
    },
    filesOf: (userId) => q.fileListOwn.all(userId),
    allFiles: () => q.fileListAll.all(),
    fileById: (id) => q.fileGet.get(Number(id)),
    deleteFileRow: (id) => q.fileDel.run(Number(id)),

    writeStoredUpload: async (id, buffer) => {
      const p = storedPathOf(id);
      if (!p) return false;
      try { await fsp.writeFile(p, buffer); return true; } catch { return false; }
    },
    readStoredUpload: async (id) => {
      const p = storedPathOf(id);
      if (!p) return null;
      try { return await fsp.readFile(p); } catch { return null; }
    },
    removeStoredUpload: async (id) => {
      const p = storedPathOf(id);
      if (!p) return;
      await fsp.unlink(p).catch(() => {});
    },

    /* kv */
    kvGet: (k) => q.kvGet.get(k),
    kvSet: (k, v) => q.kvSet.run(k, v),
  };
  return s;
}
