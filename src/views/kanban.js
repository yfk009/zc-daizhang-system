// 四周看板：按周分列、任务组进度 ｜ 编辑模式：每列可＋添加任务、卡片可✕删除（当月/永久停用）
import { toast, esc } from '../ui.js';
import { state, reloadMonth } from '../app-state.js';
import { store, newId } from '../db.js';
import { buildMonthTasks, tierOf, unitCount, unitDone, TIERS } from '../templates.js';

export function render(root, ctx) {
  const groups = {};
  for (const t of state.tasks) {
    const k = t.week + '|' + t.name;
    if (!groups[k]) groups[k] = { week: t.week, name: t.name, tier: t.tier, key: t.key, items: [] };
    groups[k].items.push(t);
  }
  const cols = [[], [], [], []];
  Object.values(groups).forEach(g => cols[g.week - 1].push(g));
  const wk = [
    'W1 收票做账<br><span class="muted">1-7号</span>',
    'W2 申报<br><span class="muted">8-15号 · 铁律：未确认不申报</span>',
    'W3 报表沟通<br><span class="muted">16-25号</span>',
    'W4 复盘<br><span class="muted">26-月底</span>',
  ];
  const curWeek = (() => { const d = new Date().getDate(); return d <= 7 ? 1 : d <= 15 ? 2 : d <= 25 ? 3 : 4; })();
  root.innerHTML = `
  <div class="panel" style="padding:12px 16px;font-size:13px;color:#64748b;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <span>任务由系统按服务包自动生成；当前周高亮。点击任务组跳转清单。</span>
    <span class="st done">✏️ 编辑模式</span><span>每列「＋」添加任务；卡片「✕」删除（可选仅当月或永久停用）</span>
  </div>
  <div class="kanban">${cols.map((col, i) => `
    <div class="kcol ${i + 1 === curWeek ? 'now' : ''}">
      <h4>${wk[i]}<button class="kadd" data-week="${i + 1}" title="添加任务到本周">＋</button></h4>
      ${col.sort((a, b) => (b.items[0]?.tier || '').localeCompare(a.items[0]?.tier || '')).map(g => {
        const d = g.items.reduce((a, t) => a + unitDone(t), 0);
        const n = g.items.reduce((a, t) => a + unitCount(t), 0);
        const p = n ? Math.round(d / n * 100) : 0;
        const tag = g.tier ? `<span class="tag ${g.tier === 'ALL' ? 'S1' : g.tier}" style="margin-left:6px">${g.tier}</span>` : '';
        return `<div class="kitem" data-name="${esc(g.name)}">
          <span class="kdel" data-name="${esc(g.name)}" data-key="${esc(g.key || '')}" title="删除此任务">✕</span>
          <div class="t">${esc(g.name)}${tag}<em>${d}/${n}</em></div>
          <div class="mini"><i style="width:${p}%"></i></div>
        </div>`;
      }).join('')}
    </div>`).join('')}</div>
  <div class="modal-mask" id="kAddMask"><div class="modal">
    <h3 id="kaTitle">＋ 添加任务</h3>
    <label>任务名称 *</label>
    <input id="kaName" placeholder="如：发工资表收集提醒" style="width:100%">
    <label>截止日（当月几号）*</label>
    <input id="kaDue" type="number" min="1" max="31" style="width:100%">
    <label>责任人</label>
    <select id="kaRole" style="width:100%">
      ${state.settings.staff.map(p => `<option value="${esc(p.key)}">${esc(p.name)}（${esc(p.role)}）</option>`).join('')}
    </select>
    <label>任务粒度</label>
    <select id="kaType" style="width:100%">
      <option value="client">每家客户一条（如：催收资料）</option>
      <option value="team">团队一条（如：内部会议）</option>
    </select>
    <label>适用档位（客户型任务）</label>
    <select id="kaTiers" style="width:100%">
      <option value="ALL">全部档位</option>
      <option value="S3">仅 S3 实体户</option>
      <option value="S2">仅 S2 微型户</option>
      <option value="S1">仅 S1 休眠户</option>
    </select>
    <label>生效范围 *</label>
    <select id="kaScope" style="width:100%">
      <option value="both">以后每月都生成 + 立即补进当月</option>
      <option value="month">仅当月一次性</option>
    </select>
    <div class="acts"><button class="btn ghost" id="kaCancel">取消</button><button class="btn" id="kaOk">添加</button></div>
  </div></div>
  <div class="modal-mask" id="kDelMask"><div class="modal">
    <h3>✕ 删除任务： <span id="kdName"></span></h3>
    <div class="info" id="kdInfo"></div>
    <div class="cred">
      <label><input type="radio" name="kdMode" value="month" checked> 仅删除当月实例（下月仍会生成）</label>
      <label id="kdPermOpt"><input type="radio" name="kdMode" value="perm"> 永久停用此任务（下月起不再生成）</label>
    </div>
    <div class="acts"><button class="btn ghost" id="kdCancel">取消</button><button class="btn danger" id="kdOk">确认删除</button></div>
  </div></div>`;

  root.querySelectorAll('.kitem .t').forEach(el => el.onclick = e => {
    if (e.target.classList.contains('kdel')) return;
    ctx.jumpTask(el.closest('.kitem').dataset.name);
  });
  root.querySelectorAll('.kadd').forEach(b => b.onclick = () => openAdd(+b.dataset.week));
  root.querySelectorAll('.kdel').forEach(b => b.onclick = e => { e.stopPropagation(); openDel(b.dataset.name, b.dataset.key); });
  root.querySelector('#kaCancel').onclick = () => root.querySelector('#kAddMask').classList.remove('on');
  root.querySelector('#kaOk').onclick = () => doAdd(root, ctx);
  root.querySelector('#kdCancel').onclick = () => root.querySelector('#kDelMask').classList.remove('on');
  root.querySelector('#kdOk').onclick = () => doDel(root, ctx);
}

let addWeek = 1, delName = '', delKey = '';
function openAdd(week) {
  addWeek = week;
  document.querySelector('#kaTitle').textContent = `＋ 添加任务到 W${week}`;
  document.querySelector('#kaDue').value = [3, 12, 20, 28][week - 1];
  document.querySelector('#kaName').value = '';
  document.querySelector('#kAddMask').classList.add('on');
}
function openDel(name, key) {
  delName = name; delKey = key || '';
  document.querySelector('#kdName').textContent = name;
  const n = state.tasks.filter(t => t.name === name).length;
  const isCustom = delKey.startsWith('cx_');
  document.querySelector('#kdInfo').innerHTML = `当月实例 <b>${n}</b> 条。${isCustom ? '此为自定义任务模板，永久停用后将不再生成。' : ''}`;
  document.querySelector('#kDelMask').classList.add('on');
}

async function doAdd(root, ctx) {
  const name = document.querySelector('#kaName').value.trim();
  const due = parseInt(document.querySelector('#kaDue').value);
  if (!name) { toast('请填写任务名称'); return; }
  if (!due || due < 1 || due > 31) { toast('截止日请填 1-31'); return; }
  const role = document.querySelector('#kaRole').value;
  const type = document.querySelector('#kaType').value;
  const tiers = [document.querySelector('#kaTiers').value];
  const scope = document.querySelector('#kaScope').value;
  const s = state.settings;
  const owner = s.ownersMap[role] || (s.staff.find(p => p.key === role) || {}).name || role;

  const build = (tpl) => {
    const docs = [];
    if (type === 'team') {
      docs.push({ _id: `t_${state.month}_team_${tpl.key}`, month: state.month, type: 'team', tier: 'ALL', clientName: `【团队】${name}`, key: tpl.key, name, week: addWeek, due, ownerRole: role, owner, state: 'todo', doneAt: null, note: '' });
    } else {
      for (const c of state.customers) {
        if (c.archived) continue;
        const tier = c.tier || tierOf(c.revenue);
        if (tiers.includes('ALL') || tiers.includes(tier)) {
          docs.push({ _id: `t_${state.month}_${c._id}_${tpl.key}`, month: state.month, type: 'client', clientId: c._id, clientName: c.name, tier, key: tpl.key, name, week: addWeek, due, ownerRole: role, owner, state: 'todo', doneAt: null, note: '' });
        }
      }
    }
    return docs;
  };

  if (scope === 'both') {
    const tpl = { key: 'cx_' + newId().slice(0, 8), name, week: addWeek, due, role, tiers, type };
    s.customTemplates = [...(s.customTemplates || []), tpl];
    await store.upsert('settings', s);
    const docs = build(tpl);
    if (docs.length) await store.upsertMany('monthTasks', docs);
    await reloadMonth();
    toast(`✓ 已添加「${name}」：当月 ${docs.length} 条，并已存为月度模板（W${addWeek}，截止 ${state.month}-${String(due).padStart(2, '0')}）`);
  } else {
    const tpl = { key: 'cx_once_' + newId().slice(0, 8) };
    const docs = build(tpl);
    if (!docs.length) { toast('该档位当前没有客户，未生成任务'); document.querySelector('#kAddMask').classList.remove('on'); return; }
    await store.upsertMany('monthTasks', docs);
    await reloadMonth();
    toast(`✓ 已添加「${name}」：当月一次性 ${docs.length} 条`);
  }
  document.querySelector('#kAddMask').classList.remove('on');
  render(document.getElementById('view'), ctx);
  ctx.refreshHeader?.();
}

async function doDel(root, ctx) {
  const mode = document.querySelector('input[name="kdMode"]:checked')?.value || 'month';
  const items = state.tasks.filter(t => t.name === delName);
  for (const t of items) await store.remove('monthTasks', t._id);
  let extra = '';
  if (mode === 'perm' && delKey) {
    const s = state.settings;
    if (delKey.startsWith('cx_')) {
      s.customTemplates = (s.customTemplates || []).filter(t => t.key !== delKey);
      extra = '，模板已删除';
    } else {
      s.disabledTemplateKeys = [...new Set([...(s.disabledTemplateKeys || []), delKey])];
      extra = '，已永久停用';
    }
    await store.upsert('settings', s);
  }
  await reloadMonth();
  document.querySelector('#kDelMask').classList.remove('on');
  toast(`✓ 已删除「${delName}」当月 ${items.length} 条${extra}`);
  render(document.getElementById('view'), ctx);
  ctx.refreshHeader?.();
}
