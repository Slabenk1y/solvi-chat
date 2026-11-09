'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const state = { token: localStorage.getItem('sovli_admin_token') || localStorage.getItem('sovli_token') || '', owner: false, runtime: null, poll: null };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),2800); }
  async function api(url, options={}) {
    const response = await fetch(url, { ...options, headers: { 'Content-Type':'application/json', ...(state.token ? { Authorization:`Bearer ${state.token}` } : {}), ...(options.headers||{}) } });
    const body = await response.json().catch(()=>({}));
    if (!response.ok) { if (response.status===401) clearAuth(); throw new Error(body.error || `HTTP ${response.status}`); }
    return body;
  }
  function clearAuth(){ state.token=''; localStorage.removeItem('sovli_admin_token'); $('#dashboardView').hidden=true; $('#loginView').hidden=false; $('#logoutButton').hidden=true; }
  function setConnection(text, good=true){ const e=$('#connectionBadge'); e.textContent=text; e.className=`status-pill ${good?'good':'bad'}`; }
  async function verifyOwner(){
    if(!state.token) return false;
    try { await api('/api/admin/overview'); state.owner=true; localStorage.setItem('sovli_admin_token',state.token); $('#loginView').hidden=true; $('#dashboardView').hidden=false; $('#logoutButton').hidden=false; setConnection('Владелец подтверждён'); await refreshAll(); return true; }
    catch(error){ if (/только владельцу|не назначен владельцем/i.test(error.message)) { $('#loginError').textContent=error.message; } return false; }
  }
  $('#loginForm').addEventListener('submit', async event=>{
    event.preventDefault(); $('#loginError').textContent='';
    try { const result=await api('/api/auth/login',{method:'POST',body:JSON.stringify({username:$('#loginName').value.trim(),password:$('#loginPassword').value,accessCode:$('#loginInvite').value.trim()})}); state.token=result.token; localStorage.setItem('sovli_admin_token',state.token); if(!await verifyOwner()) throw new Error('Этот аккаунт не назначен владельцем. Проверь OWNER_PUBLIC_ID в .env.'); }
    catch(error){ $('#loginError').textContent=error.message; setConnection('Не авторизован',false); }
  });
  $('#logoutButton').addEventListener('click',()=>{ clearAuth(); setConnection('Выход выполнен'); });
  function stat(label,value,sub=''){ return `<div class="stat-card"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub?`<small class="muted">${esc(sub)}</small>`:''}</div>`; }
  async function loadOverview(){
    const [o,e]=await Promise.all([api('/api/admin/overview'),api('/api/admin/economy')]);
    $('#statsGrid').innerHTML=[stat('Пользователи',o.users),stat('Гости',o.guests),stat('Активные диалоги',o.activeMatches),stat('Открытые жалобы',o.openReports)].join('');
    $('#economyDetails').innerHTML=[['Начислено сегодня',`${Number(e.earnedToday||0).toLocaleString('ru-RU')} ✦`],['Всего токенов в системе',`${Number(e.totalTokens||0).toLocaleString('ru-RU')} ✦`],['Дата',e.today]].map(([a,b])=>`<div class="detail-row"><span>${esc(a)}</span><strong>${esc(b)}</strong></div>`).join('');
    $('#recentUsers').innerHTML=(o.recentUsers||[]).map(u=>`<div class="user-card"><div class="user-main"><strong>${esc(u.username)}</strong><small>${esc(u.public_id)} · ${esc(u.role)} · ${esc(u.account_type)}</small></div></div>`).join('')||'<p class="hint">Пользователей пока нет.</p>';
  }
  async function loadRuntime(){
    const r=await api('/api/admin/runtime'); state.runtime=r;
    const hosted = r.hosting?.provider === 'render';
    if ($('#localTunnelGrid')) $('#localTunnelGrid').hidden = hosted;
    if ($('#localTunnelLogsCard')) $('#localTunnelLogsCard').hidden = hosted;
    $('#serverState').textContent='ONLINE'; $('#serverState').className='status-pill good';
    $('#serverDetails').innerHTML=[['Версия',r.version],['Node.js',r.server.node],['PID',r.server.pid],['Uptime',`${Math.floor(r.uptimeSeconds/60)} мин.`],['Публичный режим',r.publicMode?'Включён':'Выключен']].map(([a,b])=>`<div class="detail-row"><span>${esc(a)}</span><strong>${esc(b)}</strong></div>`).join('');
    const t=r.tunnel||{};
    $('#renderHostedNotice').hidden=!hosted;
    $('#cloudPublicUrl').textContent=r.hosting?.publicUrl||'Публичный адрес ещё не опубликован';
    $('#cloudInviteCode').textContent=r.inviteCode||'—';
    $('#copyCloudUrlButton').disabled=!r.hosting?.publicUrl;
    $('#copyCloudInviteButton').disabled=!r.inviteCode;
    $('#tunnelState').textContent=({connected:'Подключён',connecting:'Подключение',starting:'Запуск',degraded:'Нестабильно',error:'Ошибка',stopping:'Остановка',stopped:'Остановлен'})[t.state]||t.state;
    $('#tunnelState').className=`status-pill ${t.state==='connected'?'good':(['error','degraded'].includes(t.state)?'bad':'')}`;
    $('#tunnelUrl').textContent=t.url||'Публичная ссылка пока не получена'; $('#inviteCode').textContent=r.inviteCode||'—';
    $('#copyUrlButton').disabled=!t.url; $('#copyInviteButton').disabled=!r.inviteCode; $('#stopTunnelButton').disabled=!['connected','connecting','starting','degraded','error'].includes(t.state);
    $('#startTunnelButton').disabled=['connected','connecting','starting'].includes(t.state);
    $('#tunnelError').textContent=t.error||''; $('#tunnelLogs').textContent=(t.logs||[]).join('\n')||'Логов пока нет.';
    $('#matchingToggle').checked=!!r.publicMatching;
    setConnection('Сервер отвечает');
  }
  async function refreshAll(){
    try { await Promise.all([loadOverview(),loadRuntime()]); }
    catch(error){ setConnection('Ошибка соединения',false); toast(error.message); }
  }
  async function loadRenderPlatform(){
    const stateEl=$('#renderState'), detailsEl=$('#renderDetails'), messageEl=$('#renderMessage');
    stateEl.textContent='Проверяем…'; stateEl.className='status-pill';
    $('#renderRestartButton').disabled=true; $('#renderSuspendButton').disabled=true; $('#renderDashboardButton').disabled=true;
    try{
      const r=await api('/api/admin/platform/render');
      if(!r.configured){
        stateEl.textContent='Не настроено'; stateEl.className='status-pill bad';
        detailsEl.innerHTML=`<div class="hint">${esc(r.message||'Не настроено облачное управление.')}</div>`;
        messageEl.textContent='Добавь RENDER_API_KEY и RENDER_SERVICE_ID в переменные окружения Render. Секрет не вводится на этой странице.';
        return;
      }
      const health=r.health||{};
      stateEl.textContent=r.suspended?'Приостановлен':(health.reachable?'Работает':'Нет ответа');
      stateEl.className=`status-pill ${health.reachable?'good':(r.suspended?'bad':'')}`;
      const rows=[['Сервис',r.name||'SOVLI'],['Состояние Render',r.suspended?'suspended':'active'],['Регион',r.region||'—'],['План',r.plan||'—'],['Проверка приложения',health.reachable?`OK · v${health.version||'?'}`:(health.error||`HTTP ${health.status||'нет ответа'}`)],['Онлайн',health.reachable?String(health.online??'—'):'—'],['Публичный адрес',r.publicUrl||'—']];
      detailsEl.innerHTML=rows.map(([a,b])=>`<div class="detail-row"><span>${esc(a)}</span><strong>${esc(b)}</strong></div>`).join('');
      $('#renderRestartButton').disabled=!!r.suspended;
      $('#renderDashboardButton').disabled=!r.dashboardUrl;
      $('#renderSuspendButton').disabled=!!r.suspended;
      $('#renderDashboardHelpLink').href=r.dashboardUrl||'https://dashboard.render.com/';
      $('#renderActionsButton').href=r.actionsUrl||'https://github.com/';
      $('#renderActionsHelpLink').href=r.actionsUrl||'https://github.com/';
      $('#renderDashboardButton').dataset.url=r.dashboardUrl||'';
      messageEl.textContent=r.suspended?'Сервис приостановлен. Возобнови его через Render Dashboard или GitHub Actions.':(health.reachable?'Облачный backend отвечает. Телефон может управлять им без включённого ноутбука.':'Render API видит сервис, но health-check приложения не прошёл. Проверь Deploy Logs в Render.');
    }catch(error){stateEl.textContent='Ошибка';stateEl.className='status-pill bad';detailsEl.innerHTML=`<div class="error">${esc(error.message)}</div>`;messageEl.textContent='Не удалось получить статус Render. Проверь API key, service ID и доступ сервера к api.render.com.';}
  }
  $('#renderRefreshButton').addEventListener('click',()=>loadRenderPlatform());
  $('#renderRestartButton').addEventListener('click',async()=>{
    if(!confirm('Перезапустить облачный SOVLI? Текущие звонки/сокеты оборвутся, временные чаты могут завершиться.'))return;
    $('#renderRestartButton').disabled=true;
    try{const r=await api('/api/admin/platform/render/restart',{method:'POST',body:'{}'});toast(r.message||'Команда перезапуска отправлена.');setTimeout(()=>loadRenderPlatform(),8000);}
    catch(error){toast(error.message);$('#renderRestartButton').disabled=false;}
  });
  $('#renderDashboardButton').addEventListener('click',()=>{const url=$('#renderDashboardButton').dataset.url;if(url && /^https:\/\/dashboard\.render\.com\//.test(url))window.open(url,'_blank','noopener,noreferrer');else toast('Ссылка Render Dashboard пока не настроена.');});
  $('#renderSuspendButton').addEventListener('click',async()=>{
    if(!confirm('Приостановить SOVLI? Сайт, чат и эта панель станут недоступны до возобновления через Render или GitHub Actions.'))return;
    $('#renderSuspendButton').disabled=true;
    try{const r=await api('/api/admin/platform/render/suspend',{method:'POST',body:'{}'});toast(r.message||'Команда остановки отправлена.');}
    catch(error){toast(error.message);$('#renderSuspendButton').disabled=false;}
  });

  async function loadUsers(q=''){
    const result=await api(`/api/admin/users?limit=80${q?`&q=${encodeURIComponent(q)}`:''}`);
    $('#userResults').innerHTML=(result.users||[]).map(u=>{
      const suspended=u.suspended_until && new Date(u.suspended_until)>new Date();
      return `<article class="user-card"><div class="user-main"><strong>${esc(u.username)} ${u.owner?'👑':''}</strong><small>Public ID: ${esc(u.public_id)} · ${esc(u.account_type)} · ${esc(u.role)} · ${u.online?'онлайн':'не в сети'}</small><small>Баланс: ${Number(u.tokens||0).toLocaleString('ru-RU')} ✦ · Статус: ${esc(u.subscription_tier||'free')} · ${suspended?'ОГРАНИЧЕН':'активен'}</small>${suspended?`<small>До: ${esc(u.suspended_until)} · ${esc(u.suspension_reason||'')}</small>`:''}</div><div class="user-actions"><button class="secondary mini" data-action="tokens" data-id="${esc(u.id)}">± Токены</button><button class="secondary mini" data-action="vip" data-id="${esc(u.id)}">VIP/Premium</button><button class="secondary mini" data-action="role" data-id="${esc(u.id)}">Роль</button>${suspended?`<button class="primary mini" data-action="unsuspend" data-id="${esc(u.id)}">Снять блок</button>`:`<button class="danger mini" data-action="suspend" data-id="${esc(u.id)}">Ограничить</button>`}<button class="secondary mini" data-action="logout" data-id="${esc(u.id)}">Завершить сессии</button></div></article>`;
    }).join('')||'<p class="hint">Ничего не найдено.</p>';
  }
  $('#userSearchForm').addEventListener('submit',event=>{event.preventDefault();loadUsers($('#userSearchInput').value.trim()).catch(e=>toast(e.message));});
  $('#userResults').addEventListener('click',async event=>{
    const b=event.target.closest('button[data-action]'); if(!b)return; const id=b.dataset.id; const action=b.dataset.action;
    try{
      if(action==='tokens'){ const amount=Number(prompt('Начислить положительное или списать отрицательное число токенов:','100')); if(!Number.isInteger(amount)||!amount)return; const reason=prompt('Причина для журнала:','Корректировка владельцем')||'Корректировка владельцем'; await api(`/api/admin/users/${encodeURIComponent(id)}/tokens`,{method:'POST',body:JSON.stringify({amount,reason})}); }
      if(action==='vip'){ const tier=(prompt('Укажи vip, premium или free:','vip')||'').toLowerCase(); if(!['vip','premium','free'].includes(tier))return toast('Неизвестный статус'); const days=tier==='free'?1:Number(prompt('Срок в днях (1, 7, 30, 90):','1')); await api(`/api/admin/users/${encodeURIComponent(id)}/membership`,{method:'POST',body:JSON.stringify({tier,days})}); }
      if(action==='role'){ const role=(prompt('Роль: member, moderator или developer:','moderator')||'').toLowerCase(); await api(`/api/admin/users/${encodeURIComponent(id)}/role`,{method:'POST',body:JSON.stringify({role})}); }
      if(action==='suspend'){ const minutes=Number(prompt('Срок в минутах: 10, 60, 1440 или 10080','60')); const reason=prompt('Причина:','Нарушение правил')||'Нарушение правил'; await api(`/api/admin/users/${encodeURIComponent(id)}/suspend`,{method:'POST',body:JSON.stringify({minutes,reason})}); }
      if(action==='unsuspend'){ await api(`/api/admin/users/${encodeURIComponent(id)}/suspend`,{method:'DELETE'}); }
      if(action==='logout'){ if(!confirm('Завершить все сессии пользователя?'))return; await api(`/api/admin/users/${encodeURIComponent(id)}/logout`,{method:'POST',body:'{}'}); }
      toast('Изменения сохранены.'); await loadUsers($('#userSearchInput').value.trim());
    }catch(error){toast(error.message);}
  });
  async function loadPromos(){ const r=await api('/api/admin/promos'); $('#promoList').innerHTML=(r.promos||[]).map(p=>`<div class="user-card"><div class="user-main"><strong>${esc(p.code)} ${p.active?'':'· отключён'}</strong><small>${Number(p.token_reward||0)} ✦ · ${p.item_id?esc(p.item_id):'без предмета'} · ${p.membership_tier?esc(p.membership_tier)+' '+p.membership_days+' дн.':'без подписки'}</small><small>Активации: ${p.uses}/${p.max_uses} · ${p.expires_at?esc(p.expires_at):'без срока'}</small></div><button class="secondary mini" data-promo-toggle="${esc(p.id)}" data-active="${p.active?'1':'0'}">${p.active?'Отключить':'Включить'}</button></div>`).join('')||'<p class="hint">Промокодов пока нет.</p>'; }
  $('#promoForm').addEventListener('submit',async event=>{event.preventDefault(); $('#promoMessage').textContent=''; try{const tier=$('#promoTier').value; const generatedCode=`SOV-${Array.from(crypto.getRandomValues(new Uint8Array(4))).map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase()}`; const payload={code:$('#promoCode').value.trim()||generatedCode,tokens:Number($('#promoTokens').value)||0,itemId:$('#promoItem').value||undefined,membershipTier:tier||undefined,membershipDays:tier?Number($('#promoDays').value):undefined,maxUses:Number($('#promoMaxUses').value)||1,expiresAt:$('#promoExpires').value?new Date(`${$('#promoExpires').value}T23:59:59`).toISOString():undefined}; const r=await api('/api/admin/promos',{method:'POST',body:JSON.stringify(payload)}); $('#promoMessage').textContent=`Создан промокод ${r.promo.code}. Сохрани его и передай получателям.`; $('#promoForm').reset(); await loadPromos(); toast('Промокод создан.');}catch(error){$('#promoMessage').textContent=error.message;}});
  $('#promoList').addEventListener('click',async e=>{const b=e.target.closest('[data-promo-toggle]');if(!b)return;try{await api(`/api/admin/promos/${encodeURIComponent(b.dataset.promoToggle)}`,{method:'PATCH',body:JSON.stringify({active:b.dataset.active!=='1'})});await loadPromos();toast('Промокод обновлён.');}catch(err){toast(err.message);}});
  async function loadStoreItems(){try{const r=await api('/api/store');$('#promoItem').innerHTML='<option value="">Без предмета</option>'+(r.items||[]).map(i=>`<option value="${esc(i.id)}">${esc(i.name)} (${esc(i.id)})</option>`).join('');}catch(_){/* optional catalog */}}
  async function loadMatches(){const r=await api('/api/admin/matches');$('#matchList').innerHTML=(r.matches||[]).map(m=>`<div class="user-card"><div class="user-main"><strong>${esc(m.user1)} ↔ ${esc(m.user2)}</strong><small>ID: ${esc(m.id)}</small><small>${m.user1Online?'●':'○'} ${m.user1Online?'онлайн':'не в сети'} · ${m.user2Online?'●':'○'} ${m.user2Online?'онлайн':'не в сети'} · ${Math.floor(Number(m.active_seconds||0)/60)} мин.</small></div><button class="danger mini" data-end-match="${esc(m.id)}">Завершить</button></div>`).join('')||'<p class="hint">Активных диалогов нет.</p>';}
  $('#matchList').addEventListener('click',async e=>{const b=e.target.closest('[data-end-match]');if(!b)return;if(!confirm('Завершить этот диалог?'))return;try{await api(`/api/admin/matches/${encodeURIComponent(b.dataset.endMatch)}/end`,{method:'POST',body:JSON.stringify({reason:'owner_mobile_panel'})});await loadMatches();toast('Диалог завершён.');}catch(err){toast(err.message);}});
  async function loadReports(){const r=await api('/api/admin/reports');$('#reportList').innerHTML=(r.reports||[]).map(p=>`<div class="user-card"><div class="user-main"><strong>${esc(p.category)} · ${esc(p.status)}</strong><small>${esc(p.reporter)} → ${esc(p.reported)} · ${esc(p.createdAt)}</small><small>${esc(p.details||'Без описания')}</small>${p.context?.length?`<small>Приложенный контекст: ${p.context.length} элемента(ов)</small>`:''}</div><div class="user-actions"><button class="secondary mini" data-resolve-report="${esc(p.id)}">Закрыть</button><button class="danger mini" data-suspend-reported="${esc(p.reportedId)}">Ограничить</button></div></div>`).join('')||'<p class="hint">Жалоб нет.</p>';}
  $('#reportList').addEventListener('click',async e=>{const r=e.target.closest('[data-resolve-report]');const s=e.target.closest('[data-suspend-reported]');try{if(r){const resolution=prompt('Решение по жалобе:','Проверено');if(resolution===null)return;await api(`/api/admin/reports/${encodeURIComponent(r.dataset.resolveReport)}/resolve`,{method:'POST',body:JSON.stringify({resolution})});}else if(s){if(!confirm('Ограничить пользователя на 1 час?'))return;await api(`/api/admin/users/${encodeURIComponent(s.dataset.suspendReported)}/suspend`,{method:'POST',body:JSON.stringify({minutes:60,reason:'Решение по жалобе'})});}else return;await loadReports();toast('Готово.');}catch(err){toast(err.message);}});
  async function loadAudit(){const r=await api('/api/admin/audit');$('#auditList').textContent=(r.entries||[]).map(e=>`${e.created_at}  ${e.action}\n target: ${e.target_id||'—'}\n ${JSON.stringify(e.details||{})}`).join('\n\n')||'Записей пока нет.';}
  $('#startTunnelButton').addEventListener('click',async()=>{try{const r=await api('/api/admin/runtime/public/start',{method:'POST',body:JSON.stringify({protocol:$('#tunnelProtocol').value,matching:$('#matchingToggle').checked})});$('#inviteCode').textContent=r.inviteCode||'—';toast('Запрос на запуск туннеля отправлен.');await loadRuntime();clearInterval(state.poll);state.poll=setInterval(()=>loadRuntime().catch(()=>{}),2500);}catch(error){toast(error.message);$('#tunnelError').textContent=error.message;}});
  $('#stopTunnelButton').addEventListener('click',async()=>{if(!confirm('Остановить публичный доступ?'))return;try{await api('/api/admin/runtime/public/stop',{method:'POST',body:'{}'});clearInterval(state.poll);await loadRuntime();toast('Публичный туннель остановлен.');}catch(e){toast(e.message);}});
  $('#matchingToggle').addEventListener('change',async()=>{try{await api('/api/admin/runtime/matching',{method:'PATCH',body:JSON.stringify({enabled:$('#matchingToggle').checked})});toast('Настройка поиска сохранена.');}catch(e){toast(e.message);}});
  $('#copyUrlButton').addEventListener('click',()=>navigator.clipboard?.writeText(state.runtime?.tunnel?.url||'').then(()=>toast('Ссылка скопирована.')).catch(()=>toast('Не удалось скопировать ссылку.')));
  $('#copyInviteButton').addEventListener('click',()=>navigator.clipboard?.writeText(state.runtime?.inviteCode||'').then(()=>toast('Код скопирован.')).catch(()=>toast('Не удалось скопировать код.')));
  $('#copyCloudUrlButton').addEventListener('click',()=>navigator.clipboard?.writeText(state.runtime?.hosting?.publicUrl||'').then(()=>toast('Адрес скопирован.')).catch(()=>toast('Не удалось скопировать адрес.')));
  $('#copyCloudInviteButton').addEventListener('click',()=>navigator.clipboard?.writeText(state.runtime?.inviteCode||'').then(()=>toast('Код приглашения скопирован.')).catch(()=>toast('Не удалось скопировать код.')));
  $('#refreshTunnelButton').addEventListener('click',()=>loadRuntime().catch(e=>toast(e.message)));
  $('#refreshAllButton').addEventListener('click',refreshAll); $('#checkHealthButton').addEventListener('click',async()=>{try{const h=await fetch('/api/health').then(r=>r.json());toast(`Сервер отвечает · ${h.version} · онлайн: ${h.online}`);await loadRuntime();}catch(e){toast(e.message);}});
  $('#refreshPromosButton').addEventListener('click',()=>loadPromos().catch(e=>toast(e.message))); $('#refreshMatchesButton').addEventListener('click',()=>loadMatches().catch(e=>toast(e.message))); $('#refreshReportsButton').addEventListener('click',()=>loadReports().catch(e=>toast(e.message))); $('#refreshAuditButton').addEventListener('click',()=>loadAudit().catch(e=>toast(e.message)));
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
  document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.go)));
  function showTab(name){document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));document.querySelectorAll('[data-page]').forEach(p=>p.hidden=p.dataset.page!==name);const loaders={overview:refreshAll,public:loadRuntime,cloud:loadRenderPlatform,users:()=>loadUsers($('#userSearchInput').value.trim()),promos:loadPromos,dialogs:loadMatches,reports:loadReports,audit:loadAudit};loaders[name]?.().catch?.(e=>toast(e.message));}
  async function boot(){
    if(await verifyOwner()) { await loadStoreItems(); }
    else { $('#loginView').hidden=false; $('#dashboardView').hidden=true; setConnection('Нужен вход',false); if(state.token && !$('#loginError').textContent) $('#loginError').textContent='Текущая сессия не имеет прав владельца. Войди аккаунтом владельца.'; }
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
  boot();
})();
