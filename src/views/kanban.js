// 四周看板：按周分列、任务组进度
import { state } from '../app-state.js';
import { unitCount, unitDone } from '../templates.js';

export function render(root, ctx) {
  const groups = {};
  for (const t of state.tasks) {
    const k = t.week + '|' + t.name;
    if (!groups[k]) groups[k] = { week: t.week, name: t.name, tier: t.tier, items: [] };
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
  <div class="panel" style="padding:12px 16px;font-size:13px;color:#64748b">任务由系统每月 1 号按客户服务包自动生成；当前周高亮。点击任务组跳转清单。</div>
  <div class="kanban">${cols.map((col, i) => `
    <div class="kcol ${i + 1 === curWeek ? 'now' : ''}"><h4>${wk[i]}</h4>
    ${col.sort((a, b) => (b.items[0]?.tier || '').localeCompare(a.items[0]?.tier || '')).map(g => {
      const d = g.items.reduce((a, t) => a + unitDone(t), 0);
      const n = g.items.reduce((a, t) => a + unitCount(t), 0);
      const p = n ? Math.round(d / n * 100) : 0;
      const tag = g.tier ? `<span class="tag ${g.tier}" style="margin-left:6px">${g.tier}</span>` : '';
      return `<div class="kitem" data-name="${g.name.replace(/"/g, '&quot;')}"><div class="t">${g.name}${tag}<em>${d}/${n}</em></div><div class="mini"><i style="width:${p}%"></i></div></div>`;
    }).join('')}
    </div>`).join('')}</div>`;
  root.querySelectorAll('.kitem').forEach(k => k.onclick = () => ctx.jumpTask(k.dataset.name));
}
