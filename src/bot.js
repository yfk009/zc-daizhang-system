// 全局 AI 助手机器人：所有界面右下角悬浮 🤖，一键问答全系统数据
// 数据通道：每次提问实时构建全量快照（bot-context.js）→ AI 只读回答
// AI 通道：云端模式走服务器代理（Key 不进浏览器）；单机模式用本机配置(zx_ai_conf)直连
import { state, prevDataMonth } from './app-state.js';
import { isServerMode, serverAiReady, aiChat } from './api.js';
import { buildContext } from './bot-context.js';
import { esc } from './ui.js';

const HIST_KEY = 'zx_bot_hist';
const hist = loadHist();

function loadHist() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; }
}
function saveHist() {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(hist.slice(-40))); } catch { /* 满/隐私模式 */ }
}
function aiConf() {
  try { return JSON.parse(localStorage.getItem('zx_ai_conf') || 'null'); } catch { return null; }
}

/* ---------- 挂载入口（main.js boot2 后调用一次） ---------- */
export function initBot() {
  if (document.getElementById('botFab')) return;
  const fab = document.createElement('div');
  fab.id = 'botFab';
  fab.title = 'AI 助手：问我任何客户/数据问题';
  fab.textContent = '🤖';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'botPanel';
  panel.innerHTML = `
    <div class="bp-head">
      <b>🤖 智能助手</b>
      <span class="bp-sub" id="botSub"></span>
      <button class="bp-x" title="收起">×</button>
    </div>
    <div class="bp-body" id="botBody"></div>
    <div class="bp-chips" id="botChips"></div>
    <div class="bp-input">
      <textarea id="botQ" rows="1" placeholder="例：XX公司这个月税金确认了吗？谁还没交票据？"></textarea>
      <button class="btn" id="botGo">提问</button>
    </div>`;
  document.body.appendChild(panel);

  fab.onclick = toggle;
  panel.querySelector('.bp-x').onclick = toggle;
  panel.querySelector('#botGo').onclick = ask;
  const ta = panel.querySelector('#botQ');
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } };
  drawChips();
  drawMsgs();
  updateSub();
}
function toggle() {
  const p = document.getElementById('botPanel');
  const open = p.classList.toggle('on');
  if (open) {
    document.getElementById('botQ').focus();
    scrollBottom();
    updateSub();
  }
}
function updateSub() {
  const el = document.getElementById('botSub');
  if (!el) return;
  el.textContent = (isServerMode() && serverAiReady()) ? '已接通 AI · 实时读全系统数据' : aiConf()?.apiKey ? '本机 AI · 实时读全系统数据' : '未接通 AI';
}
function drawChips() {
  const cs = state.customers.filter(c => !c.archived);
  const chips = [];
  if (cs.length) chips.push('整体经营概况', '谁的任务逾期了', '税金还有谁没确认');
  if (cs.some(c => c.contractEnd)) chips.push('哪些客户合同快到期');
  chips.push('本月该重点盯什么');
  document.getElementById('botChips').innerHTML = chips.map(q => `<button data-q="${esc(q)}">${esc(q)}</button>`).join('');
  document.querySelectorAll('#botChips button').forEach(b => b.onclick = () => {
    document.getElementById('botQ').value = b.dataset.q;
    ask();
  });
}

/* ---------- 消息渲染（轻量 markdown：加粗/换行/表格透传为文本） ---------- */
function mdLite(s) {
  let h = esc(s);
  h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  h = h.replace(/^###?\s*(.+)$/gm, '<b>$1</b>');
  h = h.replace(/^[-•]\s+/gm, '· ');
  return h;
}
function drawMsgs() {
  const el = document.getElementById('botBody');
  if (!el) return;
  el.innerHTML = hist.map(m => m.role === 'user'
    ? `<div class="bm bm-u">${mdLite(m.content)}</div>`
    : `<div class="bm bm-a">${mdLite(m.content)}</div>`).join('');
  scrollBottom();
}
function scrollBottom() {
  const el = document.getElementById('botBody');
  if (el) el.scrollTop = el.scrollHeight;
}
function addMsg(role, content) {
  hist.push({ role, content, at: Date.now() });
  saveHist();
  drawMsgs();
}

/* ---------- 提问：实时快照 → AI ---------- */
let busy = false;
async function ask() {
  if (busy) return;
  const ta = document.getElementById('botQ');
  const q = (ta.value || '').trim();
  if (!q) { ta.focus(); return; }
  ta.value = '';
  addMsg('user', q);
  const body = document.getElementById('botBody');
  const loading = document.createElement('div');
  loading.className = 'bm bm-a';
  loading.innerHTML = '思考中…';
  body.appendChild(loading);
  body.scrollTop = body.scrollHeight;
  busy = true;
  try {
    const { system } = buildContext({
      month: state.month,
      dataMonth: prevDataMonth(),
      customers: state.customers,
      tasks: state.tasks,
      tax: state.tax,
      financials: state.financials,
      coop: state.coop,
      risknotices: state.risknotices,
      serviceOrders: state.serviceOrders,
      settings: state.settings,
    }, q);
    const reply = await callAi(system, q);
    addMsg('assistant', reply || '（AI 没有返回内容，请重试）');
  } catch (e) {
    addMsg('assistant', '⚠️ ' + (e.message || '请求失败') + tipOf(e));
  } finally {
    loading.remove();
    busy = false;
    updateSub();
  }
}
function tipOf(e) {
  if (e.status === 501) return '\n提示：管理员在「设置 → AI 接口」保存 Key 后即可接通。';
  if (e.status === 401) return '\n提示：登录已过期，请刷新页面重新登录。';
  return '';
}

/* ---------- AI 通道：云端代理优先，回落本机直连 ---------- */
async function callAi(system, q) {
  const msgs = [
    { role: 'system', content: system },
    ...hist.slice(-8, -1).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: q },
  ];
  if (isServerMode() && serverAiReady()) {
    const j = await aiChat({ temperature: 0.2, max_tokens: 2000, messages: msgs });
    return (j?.choices?.[0]?.message?.content || '').trim();
  }
  const conf = aiConf();
  if (!conf || !conf.apiKey) throw Object.assign(new Error('AI 未接通：云端未配置且本机未填 Key'), { status: 501 });
  const res = await fetch(String(conf.base || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + conf.apiKey },
    body: JSON.stringify({ model: conf.model || 'glm-4.6', temperature: 0.2, max_tokens: 2000, messages: msgs }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error((j?.error?.message || j?.error?.msg) || 'HTTP ' + res.status), { status: res.status });
  return (j?.choices?.[0]?.message?.content || '').trim();
}
