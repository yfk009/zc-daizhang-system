// 通用 UI 小工具
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
export function fmt(n) { return Math.round(n || 0).toLocaleString('zh-CN'); }
export function pad2(n) { return String(n).padStart(2, '0'); }
export function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
export function monthNow() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
export function prevMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 2, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
export function toast(msg) {
  let t = document.getElementById('zx_toast');
  if (!t) { t = el('<div id="zx_toast"></div>'); document.body.appendChild(t); }
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(() => { t.style.display = 'none'; }, 2400);
}
export function monthDays(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo, 0).getDate();
}
// 服务月 M 的任务截止完整日期
export function dueDate(m, day) { return `${m}-${pad2(day)}`; }
export function isOverdue(m, day) { return todayStr() > dueDate(m, day); }
