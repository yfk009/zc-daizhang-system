// 设置：团队与角色映射 / 阿米巴参数 / 凭证开关 / 数据备份 / 种子初始化
import { esc, toast } from '../ui.js';
import { state, loadAll, seedCustomers } from '../app-state.js';
import { store, exportAllLocal, importAllLocal, wipeAll, getUser } from '../db.js';
import { parseClientTemplate, planClientImport } from '../client-template.js';

export function render(root, ctx) {
  const s = state.settings;
  const isBoss = (getUser() || {}).boss;
  if (!isBoss) {
    root.innerHTML = `<div class="panel"><h3>⚙️ 设置</h3><p class="muted">设置仅老板可修改。当前身份：${esc((getUser() || {}).name || '未选择')}</p></div>`;
    return;
  }
  root.innerHTML = `
  <div class="dlvgrid">
    <div>
      <div class="panel">
        <h3>👥 团队与角色映射</h3>
        <table><thead><tr><th>姓名</th><th>角色</th><th>岗位权重</th><th></th></tr></thead><tbody id="stTb"></tbody></table>
        <button class="btn ghost sm" id="stAdd" style="margin-top:10px">＋ 添加成员</button>
        <div style="margin-top:14px">
          <label>S1 批量任务负责（助理）：</label><select id="omAssist">${s.staff.map(p=>`<option ${s.ownersMap.assist===p.name?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
          <label>S2/S3 日常任务负责（主办会计）：</label><select id="omLead">${s.staff.map(p=>`<option ${s.ownersMap.lead===p.name?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
          <label>S3 预算/沟通会/复盘负责（老板）：</label><select id="omBoss">${s.staff.map(p=>`<option ${s.ownersMap.boss===p.name?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
          <p class="muted" style="margin-top:6px">改动后新生成的任务按新映射指派；已有任务不变。</p>
        </div>
      </div>
      <div class="panel">
        <h3>💰 阿米巴参数（C 文档定稿值）</h3>
        ${ratioRow('divPct', '股东分红比例 %', s.amoeba.divPct)}
        ${ratioRow('baseSalary', '每人基础工资（元）', s.amoeba.baseSalary)}
        <p class="muted">运营成本=100−分红；固定80/激励20；办公20/薪酬80 —— 与 Excel 核算表一致，如需改动比例请修改 src/config 后联系管理员。</p>
      </div>
    </div>
    <div>
      <div class="panel">
        <h3>🔐 执行开关</h3>
        <div class="switch"><input type="checkbox" id="swEv" ${s.evidenceRequired ? 'checked' : ''}><span>完成任务必须选择凭证（推荐开启）</span></div>
      </div>
      <div class="panel">
        <h3>📋 客户名单模板导入</h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <label class="btn" style="cursor:pointer">📄 选择模板 Excel<input type="file" id="tplImp" accept=".xlsx,.xls" style="display:none"></label>
          <span class="st" id="tplState">客户库：${state.customers.length} 家</span>
        </div>
        <div id="tplPreview" style="display:none;margin-top:12px"></div>
        <p class="muted" style="margin-top:10px">配合「ZC-客户信息导入模板.xlsx」使用：按 纳税人识别号→公司名称 匹配，已有客户更新、新客户自动建档；示例/合计/空行自动跳过；月记账费=年÷12；分级按本期营业额快照每月判一次（手动锁档的客户不重划）；负责人按分级自动指派。</p>
      </div>
      <div class="panel">
        <h3>💾 数据管理</h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn ghost" id="btnExp">📤 导出全量备份（JSON）</button>
          <label class="btn ghost" style="cursor:pointer">📥 导入备份<input type="file" id="btnImp" accept=".json" style="display:none"></label>
          ${state.customers.length === 0 ? '<button class="btn" id="btnSeed">初始化 68 家客户</button>' : `<span class="st done">客户库：${state.customers.length} 家</span>`}
        </div>
        <p class="muted" style="margin-top:10px">单机模式下数据存于本机浏览器，请每周导出一次备份；切换电脑/浏览器用备份迁移。</p>
      </div>
      <div class="panel">
        <h3>🤖 AI 接口（智能导入解析用，可选）</h3>
        <label>厂商预设</label>
        <select id="aiPreset" style="width:100%"></select>
        <label>接口地址（OpenAI 兼容 /chat/completions）</label>
        <input id="aiBase" placeholder="https://open.bigmodel.cn/api/paas/v4" style="width:100%">
        <label>模型</label>
        <input id="aiModel" placeholder="glm-4-flash" style="width:100%">
        <label>API Key</label>
        <input id="aiKey" type="password" placeholder="sk-..." style="width:100%">
        <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="btn" id="aiSave">保存配置</button>
          <button class="btn ghost" id="aiTest">🔌 测试连接</button>
          <button class="btn ghost" id="aiClear">清除</button>
          <span class="st" id="aiState"></span>
        </div>
        <p id="aiTestOut" style="margin:8px 0 0;font-size:13px;min-height:18px"></p>
        <p class="muted" id="aiHint" style="margin-top:6px"></p>
        <p class="muted" style="margin-top:8px">仅存本机浏览器（不会进仓库/云端/备份 JSON），用于「数据导入」页的 AI 解析任意表格。无 Key 时智能识别（离线）依然可用。</p>
      </div>
      <div class="panel">
        <h3>⚠️ 危险操作</h3>
        <button class="btn danger" id="btnWipe">🗑 清空全部数据</button>
        <p class="muted" style="margin-top:8px">清除全部客户、任务、税金确认、财务数据、阿米巴批次（不可恢复，请先导出备份）；保留团队与参数设置。清空后如需 68 家演示数据，点上方「初始化 68 家客户」。</p>
      </div>
    </div>
  </div>`;

  drawStaff(root, ctx);
  root.querySelector('#stAdd').onclick = () => { s.staff.push({ key: 'm' + Date.now(), name: '新成员', role: '会计', weight: 1, boss: false }); drawStaff(root, ctx); };
  ['omAssist', 'omLead', 'omBoss'].forEach(id => root.querySelector('#' + id).onchange = async e => {
    s.ownersMap = { ...s.ownersMap, [id.slice(2).toLowerCase()]: e.target.value };
    await store.upsert('settings', s); toast('角色映射已更新');
  });
  root.querySelectorAll('input[data-ratio]').forEach(i => i.onchange = async () => {
    s.amoeba[i.dataset.ratio] = parseFloat(i.value) || 0;
    await store.upsert('settings', s); toast('参数已保存');
  });
  root.querySelector('#swEv').onchange = async e => { s.evidenceRequired = e.target.checked; await store.upsert('settings', s); toast('已保存'); };
  root.querySelector('#btnExp').onclick = exportBackup;
  root.querySelector('#btnImp').onchange = importBackup;
  // 客户名单模板导入：选文件→解析预览→确认落库
  let tplPlan = null;
  root.querySelector('#tplImp').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    const prev = root.querySelector('#tplPreview');
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const sheetName = wb.SheetNames.includes('客户信息') ? '客户信息' : wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
      const parsed = parseClientTemplate(rows);
      if (!parsed.ok) { toast('⚠️ ' + parsed.error); return; }
      if (!parsed.items.length) { toast('模板中没有可导入的客户行'); return; }
      tplPlan = planClientImport(parsed.items, state.customers);
      const om = s.ownersMap;
      for (const d of [...tplPlan.creates, ...tplPlan.updates]) d.owner = om[d.ownerRole] || d.owner || '';
      drawTplPreview(root, parsed, tplPlan, f.name);
    } catch (err) { console.error(err); toast('文件解析失败：' + err.message); }
  };
  function drawTplPreview(rootEl, parsed, plan, fileName) {
    const prev = rootEl.querySelector('#tplPreview');
    const st = rootEl.querySelector('#tplState');
    const skipTxt = parsed.skipped.length ? ` · 跳过 ${parsed.skipped.length} 行` : '';
    const cutTxt = parsed.cutoff ? `本期营业额截止 ${parsed.cutoff} ｜ ` : '';
    st.textContent = `已解析：${fileName}`;
    st.className = 'st todo';
    const head = `<p style="font-size:13px"><b>${cutTxt}共 ${parsed.items.length} 行</b> → <span style="color:#15803d">新增 ${plan.creates.length}</span> · <span style="color:#1d4ed8">更新 ${plan.updates.length}</span>${skipTxt}</p>`;
    const maxShow = 15;
    const shown = plan.rows.slice(0, maxShow);
    const tbl = `<table style="margin-top:8px"><thead><tr><th>行</th><th>公司名称</th><th>匹配</th><th>年记账费</th><th>月费</th><th>营业额</th><th>分级</th><th>有效期止</th></tr></thead><tbody>${
      shown.map(r => `<tr>
        <td>${r.row}</td><td>${esc(r.name)}</td>
        <td>${r.action === 'create' ? '<span class="tag S1" style="background:#15803d;color:#fff">新增</span>' : '更新·' + r.via}</td>
        <td style="text-align:right">${r.annualFee ?? ''}</td>
        <td style="text-align:right">${r.monthFee ?? ''}</td>
        <td style="text-align:right">${r.revenue ?? ''}</td>
        <td><span class="tag ${r.tier}">${r.tier}</span></td>
        <td>${r.end || ''}</td></tr>`).join('')
    }${plan.rows.length > maxShow ? `<tr><td colspan="8" class="muted">…其余 ${plan.rows.length - maxShow} 行不再显示，导入时全部生效</td></tr>` : ''}</tbody></table>`;
    const warn = (plan.warnings.length || parsed.skipped.length)
      ? `<p class="muted" style="margin-top:6px">${[...plan.warnings, ...parsed.skipped.map(k => `第 ${k.row} 行（${k.name || '空'}）${k.reason}`)].map(x => '· ' + esc(x)).join('<br>')}</p>` : '';
    prev.innerHTML = `${head}${tbl}${warn}
      <div style="margin-top:10px;display:flex;gap:10px;align-items:center">
        <button class="btn" id="tplConfirm">✓ 确认导入（新增 ${plan.creates.length} + 更新 ${plan.updates.length}）</button>
        <span class="muted" style="font-size:12px">导入后分级/负责人/月费立即生效，当月任务下次生成时按新名单出</span>
      </div>`;
    prev.style.display = '';
    prev.querySelector('#tplConfirm').onclick = async () => {
      const btn = prev.querySelector('#tplConfirm');
      btn.disabled = true;
      try {
        await store.upsertMany('customers', [...plan.creates, ...plan.updates]);
        await loadAll();
        tplPlan = null;
        prev.style.display = 'none';
        toast(`✓ 导入完成：新增 ${plan.creates.length} 户、更新 ${plan.updates.length} 户，客户库共 ${state.customers.length} 家`);
        window.__rerender?.();
      } catch (err) { btn.disabled = false; toast('导入失败：' + err.message); }
    };
  }
  const seedBtn = root.querySelector('#btnSeed');
  if (seedBtn) seedBtn.onclick = async () => {
    const r = await seedCustomers();
    if (r.empty) { toast('种子数据为空：本地运行 node scripts/gen-seed.mjs 生成后再试（客户隐私不入库）'); return; }
    toast(r.skipped ? '已存在客户库' : `✓ 已初始化 ${r.count} 家`); window.__rerender?.();
  };
  // AI 接口配置（localStorage zx_ai_conf，独立于业务数据备份）
  const presetSel = root.querySelector('#aiPreset');
  const hintEl = root.querySelector('#aiHint');
  presetSel.innerHTML = AI_PROVIDERS.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  try {
    const ai = JSON.parse(localStorage.getItem('zx_ai_conf') || 'null') || {};
    root.querySelector('#aiBase').value = ai.base || '';
    root.querySelector('#aiModel').value = ai.model || '';
    root.querySelector('#aiKey').value = ai.apiKey || '';
    const saved = AI_PROVIDERS.find(p => p.base && p.base === (ai.base || '').replace(/\/$/, ''));
    presetSel.value = saved ? saved.id : (ai.base ? 'custom' : 'zhipu');
    hintEl.textContent = (saved || AI_PROVIDERS[0]).hint || '';
    const st = root.querySelector('#aiState');
    st.textContent = ai.apiKey ? '✓ 已配置' : '未配置（离线智能识别可用）';
    st.className = 'st ' + (ai.apiKey ? 'done' : 'todo');
  } catch { presetSel.value = 'zhipu'; hintEl.textContent = AI_PROVIDERS[0].hint; }
  presetSel.onchange = () => {
    const p = AI_PROVIDERS.find(x => x.id === presetSel.value);
    if (p && p.id !== 'custom') {
      root.querySelector('#aiBase').value = p.base;
      root.querySelector('#aiModel').value = p.model;
    }
    hintEl.textContent = (p && p.hint) || '';
  };
  ['#aiBase', '#aiModel'].forEach(id => root.querySelector(id).oninput = () => {
    const b = root.querySelector('#aiBase').value.trim().replace(/\/$/, '');
    const match = AI_PROVIDERS.find(p => p.base && p.base === b);
    presetSel.value = match ? match.id : 'custom';
    hintEl.textContent = (match && match.hint) || '';
  });
  root.querySelector('#aiTest').onclick = async () => {
    const out = root.querySelector('#aiTestOut');
    const btn = root.querySelector('#aiTest');
    const base = root.querySelector('#aiBase').value.trim().replace(/\/$/, '');
    const model = root.querySelector('#aiModel').value.trim();
    const key = root.querySelector('#aiKey').value.trim();
    if (!base || !model || !key) {
      out.style.color = '#b45309';
      out.textContent = '⚠️ 请先填齐接口地址、模型和 API Key 再测试';
      return;
    }
    const bad = validateAiUrl(base);
    if (bad) { out.style.color = '#b91c1c'; out.textContent = '⚠️ ' + bad; return; }
    btn.disabled = true;
    out.style.color = '';
    out.textContent = '⏳ 正在连接，最多等 15 秒…';
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: '回复OK' }], max_tokens: 8, temperature: 0, stream: false }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      let data = null;
      try { data = await res.json(); } catch { /* 非 JSON 响应按错误处理 */ }
      if (res.ok && data && Array.isArray(data.choices) && data.choices[0]) {
        const reply = ((data.choices[0].message || {}).content || '').trim().slice(0, 20);
        out.style.color = '#15803d';
        out.textContent = `✓ 连接成功（${secs}s · ${model}${reply ? ' · 回复：' + reply : ''}）。记得点「保存配置」`;
      } else {
        const msg = (data && data.error && (data.error.message || data.error.msg)) || `HTTP ${res.status}`;
        out.style.color = '#b91c1c';
        out.textContent = `✗ 连接失败：${msg}`;
      }
    } catch (err) {
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      out.style.color = '#b91c1c';
      out.textContent = err.name === 'AbortError'
        ? '✗ 连接超时（15 秒无响应），检查地址或稍后再试'
        : `✗ 无法连接（${secs}s）：可能是跨域限制、网络不通或地址有误`;
    } finally {
      btn.disabled = false;
    }
  };
  root.querySelector('#aiSave').onclick = () => {
    const conf = {
      base: root.querySelector('#aiBase').value.trim() || 'https://open.bigmodel.cn/api/paas/v4',
      model: root.querySelector('#aiModel').value.trim() || 'glm-4-flash',
      apiKey: root.querySelector('#aiKey').value.trim(),
    };
    localStorage.setItem('zx_ai_conf', JSON.stringify(conf));
    const st = root.querySelector('#aiState');
    st.textContent = conf.apiKey ? '✓ 已配置' : '未配置（离线智能识别可用）';
    st.className = 'st ' + (conf.apiKey ? 'done' : 'todo');
    toast(conf.apiKey ? '✓ AI 配置已保存（仅存本机）' : '已保存（未填 Key，AI 解析不启用）');
  };
  root.querySelector('#aiClear').onclick = () => {
    localStorage.removeItem('zx_ai_conf');
    presetSel.value = 'zhipu';
    root.querySelector('#aiBase').value = ''; root.querySelector('#aiModel').value = ''; root.querySelector('#aiKey').value = '';
    hintEl.textContent = AI_PROVIDERS[0].hint;
    const st = root.querySelector('#aiState');
    st.textContent = '未配置（离线智能识别可用）'; st.className = 'st todo';
    toast('AI 配置已清除');
  };

  // 清空全部数据：输入"清空"二次确认
  root.querySelector('#btnWipe').onclick = () => {
    let mask = document.getElementById('wipeMask');
    if (mask) mask.remove();
    mask = document.createElement('div');
    mask.id = 'wipeMask'; mask.className = 'modal-mask on';
    mask.innerHTML = `<div class="modal">
      <h3 style="color:#b91c1c">⚠️ 清空全部数据</h3>
      <div class="info">将删除本浏览器中的：<b>68 家客户（若在库）、全部月度任务、税金确认、财务数据、阿米巴批次</b>。<br>团队与参数设置保留。此操作<b>不可恢复</b>，建议先导出备份。</div>
      <label>输入「清空」两个字以确认</label>
      <input id="wipeConfirmInput" placeholder="清空" style="width:100%">
      <div class="acts"><button class="btn ghost" id="wipeCancel">取消</button><button class="btn danger" id="wipeOk" disabled>🗑 确认清空</button></div>
    </div>`;
    root.appendChild(mask);
    const input = mask.querySelector('#wipeConfirmInput');
    const okBtn = mask.querySelector('#wipeOk');
    input.oninput = () => { okBtn.disabled = input.value.trim() !== '清空'; };
    mask.querySelector('#wipeCancel').onclick = () => mask.remove();
    okBtn.onclick = async () => {
      await wipeAll();
      await loadAll();
      mask.remove();
      toast('已清空全部数据，应用已恢复干净状态');
      window.__rerender?.();
    };
  };
}

const ratioRow = (k, label, v) => `<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0"><span style="font-size:13px">${label}</span><input data-ratio="${k}" type="number" value="${v}" style="width:110px"></div>`;

// 测试请求的 URL 安全校验：仅公网 http/https，拒绝本机/内网/保留地址
function validateAiUrl(url) {
  let u;
  try { u = new URL(url); } catch { return '接口地址格式不正确'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '仅支持 http/https 地址';
  const bare = (u.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!bare) return '接口地址缺少主机名';
  if (bare === 'localhost' || bare.endsWith('.localhost') || bare.endsWith('.local') || bare.endsWith('.internal')) return '不允许本机/内网地址';
  if (/^127\./.test(bare) || /^10\./.test(bare) || /^192\.168\./.test(bare) || /^169\.254\./.test(bare) || /^0\./.test(bare)) return '不允许本机/内网地址';
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(bare)) return '不允许内网地址';
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(bare)) return '不允许保留地址';
  if (/^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(bare)) return '不允许保留地址';
  if (bare === '::1' || bare === '::' || /^(f[cd]|fe80)/.test(bare)) return '不允许本机/内网地址';
  return '';
}

// 国内主流大厂 OpenAI 兼容接口预设（顺序即下拉顺序，第一个为默认）
const AI_PROVIDERS = [
  { id: 'zhipu', name: '智谱 GLM（免费模型，默认）', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', hint: 'Key 获取：open.bigmodel.cn → 控制台 → API Keys；glm-4-flash 免费，够用' },
  { id: 'deepseek', name: 'DeepSeek 深度求索', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hint: 'Key 获取：platform.deepseek.com → API Keys；按量计费，便宜' },
  { id: 'qwen', name: '阿里通义千问（百炼）', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo', hint: 'Key 获取：bailian.console.aliyun.com → API-KEY 管理' },
  { id: 'kimi', name: '月之暗面 Kimi', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', hint: 'Key 获取：platform.moonshot.cn → API Key 管理' },
  { id: 'doubao', name: '字节豆包（火山方舟）', base: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1.6-flash-250615', hint: 'Key 获取：console.volcengine.com/ark → API Key 管理；模型也可填 ep- 开头的接入点' },
  { id: 'hunyuan', name: '腾讯混元', base: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-turbos-latest', hint: 'Key 获取：console.cloud.tencent.com → 混元大模型 → API Key' },
  { id: 'qianfan', name: '百度文心（千帆）', base: 'https://qianfan.baidubce.com/v2', model: 'ernie-3.5-8k-latest', hint: 'Key 获取：console.bce.baidu.com/qianfan → 安全认证 → API Key' },
  { id: 'custom', name: '自定义（手动填地址和模型）', base: '', model: '', hint: '任何 OpenAI 兼容接口均可：填地址、模型名、Key 三项' },
];

function drawStaff(root, ctx) {
  const s = state.settings;
  root.querySelector('#stTb').innerHTML = s.staff.map((p, i) => `<tr>
    <td><input data-si="${i}" data-f="name" value="${esc(p.name)}"></td>
    <td><input data-si="${i}" data-f="role" value="${esc(p.role)}"></td>
    <td><input data-si="${i}" data-f="weight" type="number" step="0.1" value="${p.weight}" style="width:70px"></td>
    <td>${s.staff.length > 1 ? `<button class="btn sm danger" data-del="${i}">删</button>` : ''}</td></tr>`).join('');
  root.querySelectorAll('#stTb input').forEach(inp => inp.onchange = async () => {
    const p = s.staff[+inp.dataset.si];
    p[inp.dataset.f] = inp.dataset.f === 'weight' ? (parseFloat(inp.value) || 0) : inp.value;
    await store.upsert('settings', s); toast('已保存');
  });
  root.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    s.staff.splice(+b.dataset.del, 1);
    await store.upsert('settings', s); drawStaff(root, ctx);
  });
}

function exportBackup() {
  const data = exportAllLocal();
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.download = `掌兴系统备份_${new Date().toISOString().slice(0, 10)}.json`;
  a.href = URL.createObjectURL(blob);
  a.click();
  toast('备份已导出，请妥善保存');
}
async function importBackup(e) {
  const f = e.target.files[0];
  if (!f) return;
  if (!confirm('导入将覆盖当前数据（建议先导出一份备份），确认继续？')) return;
  try {
    const data = JSON.parse(await f.text());
    await importAllLocal(data);
    await loadAll();
    toast('✓ 备份已导入');
    window.__rerender?.();
  } catch (err) { toast('导入失败：' + err.message); }
}
