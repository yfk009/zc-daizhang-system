// 增值服务页：33项菜单（6大类）/ 服务单状态机（提出→确认→执行→验收）/ 报价单与服务确认单打印
import { esc, toast } from '../ui.js';
import { state } from '../app-state.js';
import { store, newId } from '../db.js';
import { SERVICE_CATALOG, SVC_CLASSES, ORDER_STATUS, ORDER_FLOW, QUOTE_TIERS, OVERAGE_RULES, BOTTOM_LINES } from '../valueservices.js';

let svcFilter = '全部';
let quoteClient = '';

function ordersOf() { return (state.serviceOrders || []).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); }

export async function render(root, ctx) {
  const orders = ordersOf();
  const done = orders.filter(o => o.status === 'done').length;
  const active = orders.filter(o => o.status !== 'done').length;
  const menu = SERVICE_CATALOG.filter(s => svcFilter === '全部' || s.cls === svcFilter);

  root.innerHTML = `
  <div class="banner">🧾 <b>增值服务（33 项 · 六大类）：</b>先确认、后服务、不留隐性收费——每单必出《服务确认单》，经客户微信确认后执行，交付物微信群留痕。签约客户享会员价。</div>
  <div class="cards">
    <div class="card"><div class="k">服务单总数</div><div class="v">${orders.length}<small> 单</small></div></div>
    <div class="card"><div class="k">进行中</div><div class="v">${active}<small> 单</small></div></div>
    <div class="card good"><div class="k">已验收</div><div class="v">${done}<small> 单</small></div></div>
    <div class="card"><div class="k">报价工具</div><div class="v" style="font-size:15px;padding-top:6px"><button class="btn sm" id="quoteBtn">📄 生成报价单</button></div></div>
  </div>

  <div class="panel">
    <h3>📋 服务单（提出 → 已确认 → 执行中 → 已验收）<button class="btn sm" id="newOrder" style="margin-left:auto">＋ 开服务单</button></h3>
    <table><thead><tr><th>客户</th><th>服务项目</th><th>费用</th><th>状态（点击流转）</th><th>确认单</th><th></th></tr></thead>
    <tbody>${orders.map(o => `<tr>
      <td>${esc(o.clientName)}</td><td>${esc(o.svc)}</td><td>${esc(o.fee)}</td>
      <td><button class="btn sm ghost" data-flow="${o._id}"><span class="st ${o.status === 'done' ? 'done' : o.status === 'draft' ? 'todo' : 'issue'}">${ORDER_STATUS[o.status]}</span></button></td>
      <td><button class="btn sm ghost" data-print="${o._id}">🖨️ 确认单</button></td>
      <td><button class="btn sm ghost" data-odel="${o._id}">删</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:14px">暂无服务单——从下方菜单「开服务单」或右上角新建</td></tr>'}</tbody></table>
  </div>

  <div class="panel">
    <h3>🛎️ 服务菜单</h3>
    <div class="filters">
      ${['全部', ...SVC_CLASSES].map(cc => `<button class="btn ghost sm ${svcFilter === cc ? 'on' : ''}" data-sf="${cc}">${cc}</button>`).join('')}
    </div>
    <table><thead><tr><th>分类</th><th>服务项目</th><th>收费标准</th><th>内容说明</th><th>适用客户</th><th>操作</th></tr></thead>
    <tbody>${menu.map(s => `<tr>
      <td>${s.cls}</td><td>${esc(s.name)}</td><td>${esc(s.fee)}</td>
      <td class="muted">${esc(s.desc)}</td><td class="muted">${esc(s.fit)}</td>
      <td><button class="btn sm ghost" data-svc="${SERVICE_CATALOG.indexOf(s)}">开服务单</button></td></tr>`).join('')}</tbody></table>
  </div>

  <div class="modal-mask" id="orderMask"><div class="modal">
    <h3>＋ 开服务单</h3><div id="orderBody"></div>
    <div class="acts"><button class="btn ghost" id="orderCancel">取消</button><button class="btn" id="orderSave">保存（状态：已提出）</button></div>
  </div></div>
  <div class="modal-mask" id="printMask"><div class="modal" style="max-width:760px">
    <div id="printArea"></div>
    <div class="acts noprint"><button class="btn ghost" id="printClose">关闭</button><button class="btn" onclick="window.print()">🖨️ 打印</button></div>
  </div></div>`;

  // 菜单分类过滤
  root.querySelectorAll('[data-sf]').forEach(b => b.onclick = () => { svcFilter = b.dataset.sf; render(root, ctx); });
  // 开服务单（带服务项或空表）
  const openOrder = (svc) => {
    const clients = state.customers.filter(c => !c.archived);
    if (!clients.length) { toast('请先在客户分层页添加客户'); return; }
    document.getElementById('orderBody').innerHTML = `
      <label style="display:block;margin:8px 0 4px">客户 *</label>
      <select id="odClient" style="width:100%">${clients.map(c => `<option value="${c._id}">${esc(c.name)}</option>`).join('')}</select>
      <label style="display:block;margin:8px 0 4px">服务项目 *</label>
      <input id="odSvc" style="width:100%" value="${svc ? esc(svc.name) : ''}" placeholder="服务名称">
      <label style="display:block;margin:8px 0 4px">费用</label>
      <input id="odFee" style="width:100%" value="${svc ? esc(svc.fee) : ''}" placeholder="如：500元/次 或 面议">
      <label style="display:block;margin:8px 0 4px">备注（工期/验收标准）</label>
      <input id="odNote" style="width:100%" placeholder="如：3 个工作日办结，以公示截图为验收依据">`;
    document.getElementById('orderMask').classList.add('on');
    document.getElementById('orderSave').onclick = async () => {
      const cid = document.getElementById('odClient').value;
      const name = document.getElementById('odSvc').value.trim();
      if (!name) { toast('请填写服务项目'); return; }
      const c = state.customers.find(x => x._id === cid);
      await store.upsert('serviceOrders', {
        _id: newId('so'), clientId: cid, clientName: c.name,
        svc: name, fee: document.getElementById('odFee').value.trim() || '面议',
        note: document.getElementById('odNote').value.trim(),
        status: 'draft', createdAt: new Date().toISOString().slice(0, 10),
      });
      state.serviceOrders = await store.list('serviceOrders');
      document.getElementById('orderMask').classList.remove('on');
      toast('✓ 服务单已建立（下一步：出《服务确认单》经客户微信确认）');
      render(root, ctx);
    };
  };
  root.querySelector('#newOrder').onclick = () => openOrder(null);
  root.querySelectorAll('[data-svc]').forEach(b => b.onclick = () => openOrder(SERVICE_CATALOG[+b.dataset.svc]));
  root.querySelector('#orderCancel').onclick = () => document.getElementById('orderMask').classList.remove('on');
  // 状态流转
  root.querySelectorAll('[data-flow]').forEach(b => b.onclick = async () => {
    const o = state.serviceOrders.find(x => x._id === b.dataset.flow);
    const next = ORDER_FLOW[Math.min(ORDER_FLOW.indexOf(o.status) + 1, ORDER_FLOW.length - 1)];
    if (next === o.status) { toast('已到最终状态：已验收'); return; }
    o.status = next;
    await store.upsert('serviceOrders', o);
    state.serviceOrders = await store.list('serviceOrders');
    toast(next === 'confirmed' ? '✓ 已确认——请先打印《服务确认单》经客户微信确认后再执行' : '✓ 状态流转：' + ORDER_STATUS[next]);
    render(root, ctx);
  });
  root.querySelectorAll('[data-odel]').forEach(b => b.onclick = async () => {
    await store.remove('serviceOrders', b.dataset.odel);
    state.serviceOrders = await store.list('serviceOrders');
    render(root, ctx);
  });
  // 服务确认单打印
  root.querySelectorAll('[data-print]').forEach(b => b.onclick = () => {
    const o = state.serviceOrders.find(x => x._id === b.dataset.print);
    showPrint(`
      <h2 style="text-align:center;margin:10px 0 4px">服务确认单</h2>
      <p style="text-align:center;color:#64748b;font-size:12px">昆明掌兴代理记账有限公司 ｜ 先确认、后服务、不留隐性收费</p>
      <table style="margin-top:14px">
        <tr><td style="width:26%"><b>客户名称</b></td><td>${esc(o.clientName)}</td></tr>
        <tr><td><b>服务项目</b></td><td>${esc(o.svc)}</td></tr>
        <tr><td><b>费用</b></td><td>${esc(o.fee)}</td></tr>
        <tr><td><b>工期 / 验收标准</b></td><td>${esc(o.note || '双方约定节点交付，交付物微信群留痕')}</td></tr>
        <tr><td><b>服务保障</b></td><td>与代账服务同等享受：未确认不申报 · 五分钟响应 · 三级复核 · 全程可视</td></tr>
        <tr><td><b>开单日期</b></td><td>${esc(o.createdAt)}</td></tr>
        <tr><td><b>客户确认</b></td><td>☐ 确认本单内容，即可执行（微信回复「确认」视为送达）　签字：__________</td></tr>
      </table>
      <p class="muted" style="margin-top:10px;font-size:12px">面议项目以本确认单最终报价为准；服务完成后 3 日内请配合验收确认。</p>`);
  });
  // 报价单
  root.querySelector('#quoteBtn').onclick = () => {
    const clients = state.customers.filter(c => !c.archived);
    showPrint(`
      <h2 style="text-align:center;margin:10px 0 4px">代账服务报价单</h2>
      <p style="text-align:center;color:#64748b;font-size:12px">昆明掌兴代理记账有限公司 · 代账 4.0 主动服务体系 ｜ 全国统一一口价 · 无折扣 · 无隐藏收费</p>
      <table style="margin-top:14px">
        <thead><tr><th>客户分类</th><th>适合谁</th><th>月费</th><th>年费（=月费×12）</th><th>服务内容</th></tr></thead>
        <tbody>${QUOTE_TIERS.map(t => `<tr><td><b>${t.name}</b></td><td>${t.who}</td><td><b>${t.price} 元/月</b></td><td>${t.price * 12} 元/年</td><td class="muted">${t.tasks}</td></tr>`).join('')}</tbody>
      </table>
      <h3 style="font-size:14px;margin:16px 0 6px">超量计费（标准含量之外）</h3>
      <table><tbody>${OVERAGE_RULES.map(r => `<tr><td style="width:30%"><b>${r.item}</b></td><td>标准：${r.std}</td><td>${r.over}</td></tr>`).join('')}</tbody></table>
      <h3 style="font-size:14px;margin:16px 0 6px">四条底线</h3>
      <table><tbody>${BOTTOM_LINES.map(b => `<tr><td style="width:26%"><b>${b.t}</b></td><td>${b.s}</td></tr>`).join('')}</tbody></table>
      <p class="muted" style="margin-top:10px;font-size:12px">最终报价以签约前书面报价单为准；每年 1 月按上年营业额统一重划档位；老客户调价首年涨幅 ≤10%。联系电话：【联系电话】</p>`);
  };
  root.querySelector('#printClose').onclick = () => document.getElementById('printMask').classList.remove('on');

  function showPrint(html) {
    document.getElementById('printArea').innerHTML = html;
    document.getElementById('printMask').classList.add('on');
  }
}
