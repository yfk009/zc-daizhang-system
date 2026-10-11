// 云端管理页（仅老板账号可见）：全员数据总览 / 操作日志 / 文件归档 / 账号管理
import { esc, toast } from '../ui.js';
import { adminApi, downloadBase64 } from '../api.js';

function fmtSize(n) {
  if (n == null) return '—';
  if (n < 1024) return n + 'B';
  if (n < 1048576) return (n / 1024).toFixed(1) + 'KB';
  return (n / 1048576).toFixed(2) + 'MB';
}

export async function render(root, ctx) {
  root.innerHTML = `
  <div class="panel">
    <h3>🛰️ 云端管理</h3>
    <p class="muted" style="margin:4px 0 0">全员数据实时留存在服务器，此页仅管理员可见。数据按站点（域名）分区：主站 / 大理 / 楚雄 / 徐 / 叶 / 段 / 本地互不混淆。</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      <button class="btn" data-tab="ov">📦 数据总览</button>
      <button class="btn ghost" data-tab="logs">📜 操作日志</button>
      <button class="btn ghost" data-tab="files">🗂 文件归档</button>
      <button class="btn ghost" data-tab="users">👤 账号管理</button>
    </div>
  </div>
  <div id="admBody" style="margin-top:12px"></div>`;
  const body = root.querySelector('#admBody');
  const tabs = root.querySelectorAll('[data-tab]');
  const setTab = (k) => {
    tabs.forEach(b => b.className = 'btn ' + (b.dataset.tab === k ? '' : 'ghost'));
    draw(k);
  };
  tabs.forEach(b => b.onclick = () => setTab(b.dataset.tab));

  async function draw(k) {
    body.innerHTML = '<div class="panel muted">加载中…</div>';
    try {
      if (k === 'ov') await drawOverview(body);
      else if (k === 'logs') await drawLogs(body);
      else if (k === 'files') await drawFiles(body);
      else await drawUsers(body);
    } catch (e) {
      body.innerHTML = `<div class="panel" style="color:#b91c1c">加载失败：${esc(e.message)}</div>`;
    }
  }

  /* ---- 数据总览 ---- */
  async function drawOverview(el) {
    const { rows } = await adminApi('/overview');
    if (!rows.length) { el.innerHTML = '<div class="panel muted">还没有任何数据包。员工登录并产生操作后，这里会出现各站点/各人的数据留存记录。</div>'; return; }
    el.innerHTML = `<div class="panel"><table><thead><tr>
      <th>站点</th><th>姓名</th><th>账号</th><th>角色</th><th>最后保存</th><th>大小</th><th>客户</th><th>任务</th><th>任务月份</th><th>操作</th>
    </tr></thead><tbody>${rows.map(r => {
      const s = r.summary || {};
      return `<tr>
        <td>${esc(r.tenant)}</td>
        <td>${esc(r.name)}${r.scope !== '_all' ? ` <span class="muted">(${esc(r.scope)})</span>` : ''}</td>
        <td>${esc(r.username)}</td>
        <td>${r.role === 'boss' ? '管理员' : '员工'}</td>
        <td>${esc(r.updatedAt)}</td>
        <td>${fmtSize(r.size)}</td>
        <td>${s.customers ?? '—'}</td>
        <td>${s.tasks ?? '—'}</td>
        <td class="muted">${(s.months || []).join('、') || '—'}</td>
        <td><button class="btn ghost sm" data-dl="${r.userId}|${esc(r.tenant)}|${esc(r.scope)}|${esc(r.username)}">⬇ 下载JSON</button></td>
      </tr>`;
    }).join('')}</tbody></table>
    <p class="muted" style="margin-top:8px">每次保存自动留有最近 10 份历史版本，误清空/误覆盖可由管理员恢复（恢复入口见服务器接口，二期做页面）。</p></div>`;
    el.querySelectorAll('[data-dl]').forEach(b => b.onclick = async () => {
      const [userId, tenant, scope, username] = b.dataset.dl.split('|');
      b.disabled = true;
      try {
        const r = await adminApi(`/data/${userId}/${tenant}/${scope}`);
        const blob = new Blob([JSON.stringify(r.data, null, 1)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `云端备份_${tenant}_${username}_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e) { toast('下载失败：' + e.message); }
      b.disabled = false;
    });
  }

  /* ---- 操作日志 ---- */
  async function drawLogs(el) {
    const { logs } = await adminApi('/logs?limit=300');
    const actName = { login_ok: '✅ 登录', login_fail: '⛔ 登录失败', logout: '🚪 退出', save_data: '💾 保存数据', file_upload: '📤 上传', file_download: '⬇ 下载', file_delete: '🗑 删文件', ai_call: '🤖 AI调用', ai_error: '🤖 AI异常', admin_user_create: '👤 建号', admin_user_resetpass: '🔑 改密', admin_user_delete: '👤 删号', admin_restore: '♻️ 恢复数据', event: '📌 事件' };
    el.innerHTML = `<div class="panel"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <b>最近 ${logs.length} 条行为日志</b><button class="btn ghost sm" id="lgRef">🔄 刷新</button></div>
      <table style="margin-top:10px"><thead><tr><th>时间</th><th>用户</th><th>站点</th><th>动作</th><th>详情</th><th>IP</th></tr></thead>
      <tbody>${logs.map(l => `<tr>
        <td style="white-space:nowrap">${esc(l.created_at)}</td>
        <td>${esc(l.username || '—')}</td>
        <td>${esc(l.tenant || '—')}</td>
        <td>${actName[l.action] || esc(l.action)}</td>
        <td class="muted">${esc(l.detail || '')}</td>
        <td class="muted">${esc((l.ip || '').replace('::ffff:', '').replace('::1', '本机'))}</td>
      </tr>`).join('')}</tbody></table></div>`;
    el.querySelector('#lgRef').onclick = () => drawLogs(el);
  }

  /* ---- 文件归档 ---- */
  async function drawFiles(el) {
    const { files } = await adminApi('/files');
    if (!files.length) { el.innerHTML = '<div class="panel muted">暂无归档文件。设置页「☁️ 归档备份到服务器」上传的备份会出现在这里。</div>'; return; }
    el.innerHTML = `<div class="panel"><table><thead><tr><th>时间</th><th>站点</th><th>上传人</th><th>文件名</th><th>大小</th><th>操作</th></tr></thead>
      <tbody>${files.map(f => `<tr>
        <td style="white-space:nowrap">${esc(f.created_at)}</td>
        <td>${esc(f.tenant || '—')}</td>
        <td>${esc(f.name)}</td>
        <td>${esc(f.filename)}</td>
        <td>${fmtSize(f.size)}</td>
        <td><button class="btn ghost sm" data-dlf="${f.id}">⬇ 下载</button></td>
      </tr>`).join('')}</tbody></table></div>`;
    el.querySelectorAll('[data-dlf]').forEach(b => b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await adminApi(`/files/${b.dataset.dlf}/download`);
        downloadBase64(r.filename, r.dataBase64);
      } catch (e) { toast('下载失败：' + e.message); }
      b.disabled = false;
    });
  }

  /* ---- 账号管理 ---- */
  async function drawUsers(el) {
    const { users } = await adminApi('/users');
    el.innerHTML = `<div class="dlvgrid"><div class="panel">
      <b>账号列表（${users.length}）</b>
      <table style="margin-top:10px"><thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>创建时间</th><th>操作</th></tr></thead>
      <tbody>${users.map(u => `<tr>
        <td>${esc(u.username)}</td><td>${esc(u.name)}</td>
        <td>${u.role === 'boss' ? '管理员' : '员工'}</td>
        <td class="muted">${esc(u.created_at)}</td>
        <td><button class="btn ghost sm" data-rp="${u.id}" data-un="${esc(u.username)}">🔑改密</button>
            <button class="btn ghost sm" data-du="${u.id}" data-un="${esc(u.username)}">🗑删除</button></td>
      </tr>`).join('')}</tbody></table>
    </div><div class="panel">
      <b>新建账号</b>
      <label>账号（小写字母/数字，2-24 位）</label><input id="nuUser" placeholder="xiaowang" style="width:100%">
      <label>姓名（与系统内成员名一致，任务派单按姓名显示）</label><input id="nuName" placeholder="小王" style="width:100%">
      <label>初始密码（≥6 位）</label><input id="nuPass" placeholder="••••••" style="width:100%">
      <label>角色</label><select id="nuRole" style="width:100%"><option value="staff">员工</option><option value="boss">管理员（老板）</option></select>
      <button class="btn" id="nuGo" style="margin-top:12px">＋ 创建账号</button>
      <p class="muted" style="margin-top:10px">员工用账号登录后，其浏览器数据会自动与服务器双向同步；同名分身站（dz-徐/叶/段）与此处账号相互独立，均可登录。</p>
    </div></div>`;
    el.querySelector('#nuGo').onclick = async () => {
      const payload = {
        username: el.querySelector('#nuUser').value.trim(),
        name: el.querySelector('#nuName').value.trim(),
        password: el.querySelector('#nuPass').value,
        role: el.querySelector('#nuRole').value,
      };
      if (!payload.username || !payload.name || !payload.password) { toast('请填齐账号/姓名/密码'); return; }
      try {
        await adminApi('/users', { method: 'POST', body: JSON.stringify(payload) });
        toast('✓ 账号已创建：' + payload.username);
        drawUsers(el);
      } catch (e) { toast('创建失败：' + e.message); }
    };
    el.querySelectorAll('[data-rp]').forEach(b => b.onclick = () => {
      const un = b.dataset.un;
      openPrompt(`为 ${un} 设置新密码（≥6 位）`, 'newpass', async (v) => {
        try { await adminApi(`/users/${b.dataset.rp}/password`, { method: 'POST', body: JSON.stringify({ password: v }) }); toast('✓ 密码已更新'); drawUsers(el); }
        catch (e) { toast('改密失败：' + e.message); }
      });
    });
    el.querySelectorAll('[data-du]').forEach(b => b.onclick = () => {
      if (!confirm(`确认删除账号 ${b.dataset.un}？该账号的云端数据包会保留但无法再登录。`)) return;
      adminApi(`/users/${b.dataset.du}`, { method: 'DELETE' })
        .then(() => { toast('✓ 已删除'); drawUsers(el); })
        .catch(e => toast('删除失败：' + e.message));
    });
  }

  // 自定义弹窗输入（内嵌浏览器禁原生 prompt 的既有约定）
  function openPrompt(title, placeholder, onOk) {
    let mask = document.getElementById('admMask');
    if (mask) mask.remove();
    mask = document.createElement('div');
    mask.id = 'admMask'; mask.className = 'modal-mask on';
    mask.innerHTML = `<div class="modal">
      <h3>${esc(title)}</h3>
      <input id="admInp" placeholder="${esc(placeholder)}" style="width:100%">
      <div style="display:flex;gap:10px;margin-top:14px;justify-content:flex-end">
        <button class="btn ghost" id="admCancel">取消</button>
        <button class="btn" id="admOk">确定</button>
      </div></div>`;
    document.body.appendChild(mask);
    const close = () => mask.remove();
    mask.querySelector('#admCancel').onclick = close;
    mask.querySelector('#admOk').onclick = () => { const v = mask.querySelector('#admInp').value; close(); onOk(v); };
    mask.querySelector('#admInp').focus();
  }

  setTab('ov');
}
