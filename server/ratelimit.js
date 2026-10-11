// 登录限速：同 键（用户名|IP）10 分钟窗口内最多 8 次失败
const hits = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 8;

export function rateBlocked(key) {
  const rec = hits.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { hits.delete(key); return false; }
  return rec.n >= MAX_FAILS;
}
export function rateFail(key) {
  const rec = hits.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) hits.set(key, { n: 1, first: Date.now() });
  else rec.n++;
}
export function rateClear(key) { hits.delete(key); }
