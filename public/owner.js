'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const state = { token:localStorage.getItem('sovli_admin_token')||localStorage.getItem('sovli_token')||'', users:[], userOffset:0, userTotal:0, userHasMore:false, userQuery:'', selectedUserId:'', matches:[], matchSearch:'', reports:[], reportFilter:'all', reportQuery:'', tickets:[], ticketFilter:'all', ticketQuery:'', activeTicketId:'', socialLinks:[], tasks:[], submissions:[], inspectMatchId:'', matchesTimer:null };
  const esc = v => String(v==null?'':v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = v => Number(v||0).toLocaleString('ru-RU');
  const date = v => v ? new Date(v).toLocaleString('ru-RU',{dateStyle:'medium',timeStyle:'short'}) : '—';
  const dateInput = v => { if(!v)return ''; const d=new Date(v); if(Number.isNaN(d.getTime()))return ''; return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
  function applyOwnerTheme(theme){
    const selected = theme || localStorage.getItem('solvi_owner_theme') || 'dark';
    document.documentElement.dataset.theme = selected;
    localStorage.setItem('solvi_owner_theme', selected);
    const button = $('#themeToggleButton');
    if (button) { button.textContent = selected === 'dark' ? '☀ Светлая тема' : '☾ Тёмная тема'; button.setAttribute('aria-label', selected === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'); button.title = selected === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'; }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', selected === 'dark' ? '#10131c' : '#f4f5fb');
  }
  function toast(message){ const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),3200); }
  async function api(url,options){
    const opts=options||{};
    const response=await fetch(url,{...opts,headers:{'Content-Type':'application/json',...(state.token?{Authorization:'Bearer '+state.token}:{}),...(opts.headers||{})}});
    const body=await response.json().catch(()=>({}));
    if(!response.ok){ if(response.status===401)clearAuth(); throw new Error(body.error||('HTTP '+response.status)); }
    return body;
  }
  function clearAuth(){state.token='';localStorage.removeItem('sovli_admin_token');$('#dashboardView').hidden=true;$('#loginView').hidden=false;$('#logoutButton').hidden=true;}
  function setConnection(text,good){const e=$('#connectionBadge');e.textContent=text;e.className='status-pill '+(good===false?'bad':'good');}
  function stat(label,value,small){return '<article class="stat-card"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+(small?'<small>'+esc(small)+'</small>':'')+'</article>';}
  function suspendModalLayers(exceptId){
    const restore=[];
    ['ownerActionModal','userDetailModal','infoModal','dialogInspector'].forEach(id=>{
      if(id===exceptId)return;
      const modal=$('#'+id);
      if(modal&&!modal.hidden){restore.push(id);modal.hidden=true;}
    });
    return ()=>restore.forEach(id=>{const modal=$('#'+id);if(modal)modal.hidden=false;});
  }
  let infoModalRestore=null;
  function openInfo(title,body){
    if(infoModalRestore){infoModalRestore();infoModalRestore=null;}
    infoModalRestore=suspendModalLayers('infoModal');
    $('#infoModalTitle').textContent=title;$('#infoModalBody').innerHTML=body;$('#infoModal').hidden=false;
  }
  function closeInfo(){
    $('#infoModal').hidden=true;
    if(infoModalRestore){const restore=infoModalRestore;infoModalRestore=null;restore();}
  }
  function confirmDialog(opts){
    const o=opts||{};
    const restoreModals=suspendModalLayers(null);
    return new Promise(resolve=>{
      const back=document.createElement('div');back.className='modal-backdrop';
      const card=document.createElement('section');card.className='modal-card confirm-card';card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');
      const h=document.createElement('h2');h.textContent=o.title||'Подтверждение';
      const p=document.createElement('p');p.textContent=o.message||'';card.append(h,p);
      let field=null;if(o.input){field=document.createElement('textarea');field.rows=3;field.maxLength=300;field.className='dialog-textarea';field.value=o.defaultValue||'';card.append(field);}
      const actions=document.createElement('div');actions.className='modal-actions';
      const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary';cancel.textContent='Отмена';
      const ok=document.createElement('button');ok.type='button';ok.className=o.danger?'danger':'primary';ok.textContent=o.confirmText||'Продолжить';
      actions.append(cancel,ok);card.append(actions);back.append(card);document.body.append(back);
      const finish=value=>{back.remove();window.removeEventListener('keydown',key);restoreModals();resolve(value);};
      const key=e=>{if(e.key==='Escape')finish(null);};
      cancel.onclick=()=>finish(null);ok.onclick=()=>finish(field?field.value.trim():true);
      back.onclick=e=>{if(e.target===back)finish(null);};window.addEventListener('keydown',key);if(field)field.focus();
    });
  }
  function openActionDialog(action,ctx){
    const c=ctx||{};
    const configs={
      tokens:['Изменить баланс','Плюс начисляет токены, минус списывает.','Сохранить','<label>Количество токенов<input name="amount" type="number" min="-1000000" max="1000000" value="100" required></label><label>Комментарий (необязательно)<input name="comment" maxlength="160" placeholder="Например: подарок за активность"></label>'], 
      vip:['Привилегия','Продлить статус или вернуть обычный тариф.','Применить','<label>Статус<select name="tier"><option value="vip">VIP</option><option value="premium">Premium</option><option value="free">Обычный аккаунт</option></select></label><label>Дней<input name="days" type="number" min="1" max="365" value="7" required></label>'],
      role:['Изменить роль','Роль определяет доступ к инструментам модерации.','Сохранить','<label>Роль<select name="role"><option value="member">Участник</option><option value="moderator">Модератор</option><option value="developer">Разработчик</option></select></label>'],
      suspend:['Ограничить аккаунт','Пользователь не сможет пользоваться аккаунтом до окончания срока.','Ограничить','<label>Срок<select name="minutes"><option value="10">10 минут</option><option value="60" selected>1 час</option><option value="1440">1 день</option><option value="10080">7 дней</option></select></label><label>Причина<input name="reason" maxlength="180" value="Нарушение правил" required></label>'],
      starterPack:['Стартовый подарок','Разовая награда: 100 токенов и 7 дней VIP.','Выдать подарок','<div class="grant-preview"><strong>🎁 100 ✦ + 7 дней VIP</strong><span>Сервер не позволит выдать подарок повторно.</span></div><label>Комментарий (необязательно)<input name="comment" maxlength="240" placeholder="Например: приветственный подарок"></label>'], 
      paidMembership:['Подтвердить оплату','Только после проверки реального поступления платежа.','Зафиксировать','<label>Тариф<select name="tier"><option value="vip">VIP</option><option value="premium">Premium</option></select></label><label>Дней<input name="days" type="number" min="1" max="365" value="30"></label><label>Сумма<input name="amount" type="number" min="0.01" step="0.01" value="4.99" required></label><label>Валюта<input name="currency" value="EUR" minlength="3" maxlength="3" required></label><label>ID платежа<input name="paymentReference" minlength="4" maxlength="120" required></label>'],
      personalPromo:['Персональный промокод','Код привяжется к аккаунту и будет доступен только ему. Одна активация, срок 30 дней по умолчанию.','Создать код','<label>Код (пусто — сгенерировать)<input name="code" maxlength="32" placeholder="SOLVI-XXXXXX"></label><label>Токены<input name="tokens" type="number" min="0" max="1000000" value="100"></label><label>Предмет<select name="itemId" id="personalPromoItem"><option value="">Без предмета</option></select></label><label>Привилегия<select name="membershipTier"><option value="">Без привилегии</option><option value="vip">VIP</option><option value="premium">Premium</option></select></label><label>Дней привилегии<select name="membershipDays"><option value="1">1</option><option value="7">7</option><option value="30">30</option><option value="90">90</option></select></label><label>Действует до<input name="expiresAt" type="date"></label>'],
      logout:['Завершить все сессии','Пользователю придётся войти снова на всех устройствах.','Завершить','<div class="grant-preview"><strong>🔐 Отключить устройства</strong><span>Все активные сессии будут отозваны.</span></div>'],
      editPromo:['Редактировать промокод','Меняются только код, лимит и даты. Нельзя уменьшить лимит ниже уже использованного количества.','Сохранить','<label>Код<input name="code" maxlength="32" value="'+esc(c.code)+'" required></label><label>Максимум активаций<input name="maxUses" type="number" min="'+Number(c.uses||0)+'" max="100000" value="'+Number(c.max_uses||1)+'" required></label><label>Начало<input name="startsAt" type="datetime-local" value="'+dateInput(c.starts_at)+'"></label><label>Окончание<input name="expiresAt" type="datetime-local" value="'+dateInput(c.expires_at)+'"></label>'],
      editSocial:['Редактировать ссылку','Можно изменить платформу, подпись, URL, иконку и порядок.','Сохранить','<label>Платформа<input name="platform" maxlength="40" value="'+esc(c.platform)+'" required></label><label>Подпись<input name="label" maxlength="60" value="'+esc(c.label)+'" required></label><label>HTTPS-ссылка<input name="url" type="url" maxlength="500" value="'+esc(c.url)+'" required></label><label>Иконка<input name="icon" maxlength="8" value="'+esc(c.icon||'↗')+'" required></label><label>Порядок<input name="sortOrder" type="number" min="0" max="10000" value="'+Number(c.sort_order||0)+'"></label>'],
      editTask:['Редактировать задание','Измени название, описание, площадку, ссылку, награду и лимит.','Сохранить','<label>Название<input name="title" maxlength="100" value="'+esc(c.title)+'" required></label><label>Описание<textarea name="description" maxlength="500" rows="3" required>'+esc(c.description)+'</textarea></label><label>Платформа<input name="platform" maxlength="40" value="'+esc(c.platform)+'" required></label><label>HTTPS-ссылка<input name="url" type="url" maxlength="500" value="'+esc(c.url)+'" required></label><label>Награда<input name="rewardTokens" type="number" min="1" max="5000" value="'+Number(c.reward_tokens)+'" required></label><label>Рекламодатель<input name="sponsorName" maxlength="80" value="'+esc(c.sponsor_name||'')+'"></label><label>Лимит, 0 = без лимита<input name="maxClaims" type="number" min="0" max="100000" value="'+Number(c.max_claims||0)+'"></label>']
    };
    const cfg=configs[action];if(!cfg)return Promise.resolve(null);
    const restoreModals=suspendModalLayers('ownerActionModal');
    const modal=$('#ownerActionModal');$('#ownerActionTitle').textContent=cfg[0];$('#ownerActionDescription').textContent=cfg[1];$('#ownerActionSubmit').textContent=cfg[2];$('#ownerActionFields').innerHTML=cfg[3];
    if(action==='personalPromo')$('#personalPromoItem').innerHTML=$('#promoItem').innerHTML;
    modal.hidden=false;
    return new Promise(resolve=>{
      let done=false;
      const finish=value=>{if(done)return;done=true;modal.hidden=true;restoreModals();$('#ownerActionForm').onsubmit=null;$('#ownerActionCancel').onclick=null;$('#ownerActionClose').onclick=null;modal.onclick=null;window.removeEventListener('keydown',key);resolve(value);};
      const key=e=>{if(e.key==='Escape')finish(null);};
      $('#ownerActionCancel').onclick=()=>finish(null);$('#ownerActionClose').onclick=()=>finish(null);modal.onclick=e=>{if(e.target===modal)finish(null);};
      $('#ownerActionForm').onsubmit=e=>{
        e.preventDefault();const result=Object.fromEntries(new FormData(e.currentTarget).entries());
        if(action==='tokens'){result.amount=Number(result.amount);if(!Number.isInteger(result.amount)||result.amount===0)return toast('Укажи ненулевое целое число.');}
        if(action==='vip'||action==='paidMembership'){result.days=Number(result.days);if(!Number.isInteger(result.days)||result.days<1||result.days>365)return toast('Срок должен быть от 1 до 365 дней.');}
        if(action==='paidMembership'){const currency=String(result.currency||'EUR').trim().toUpperCase();const zero=['BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF'].includes(currency);result.amountMinor=Math.round(Number(result.amount)*(zero?1:100));delete result.amount;result.currency=currency;if(!Number.isInteger(result.amountMinor)||result.amountMinor<1||!/^[A-Z]{3}$/.test(currency)||String(result.paymentReference||'').trim().length<4)return toast('Проверь сумму, валюту и ID оплаты.');}
        if(action==='suspend')result.minutes=Number(result.minutes);
        if(action==='starterPack'){result.tokens=100;result.tier='vip';result.days=7;result.comment=String(result.comment||'').trim();}
        if(action==='personalPromo'){result.tokens=Number(result.tokens||0);result.membershipDays=result.membershipTier?Number(result.membershipDays):undefined;if(result.expiresAt)result.expiresAt=new Date(result.expiresAt+'T23:59:59').toISOString();else result.expiresAt=undefined;}
        if(action==='editPromo'){result.maxUses=Number(result.maxUses);result.startsAt=result.startsAt?new Date(result.startsAt).toISOString():null;result.expiresAt=result.expiresAt?new Date(result.expiresAt).toISOString():null;}
        if(action==='editSocial')result.sortOrder=Number(result.sortOrder||0);
        if(action==='editTask'){result.rewardTokens=Number(result.rewardTokens);result.maxClaims=Number(result.maxClaims||0);}
        finish(result);
      };
      window.addEventListener('keydown',key);$('#ownerActionSubmit').focus();
    });
  }

  async function verifyOwner(){
    if(!state.token)return false;
    try{await api('/api/admin/overview');$('#loginView').hidden=true;$('#dashboardView').hidden=false;$('#logoutButton').hidden=false;localStorage.setItem('sovli_admin_token',state.token);setConnection('Доступ подтверждён');await loadOverview();showTab('overview',false);return true;}
    catch(error){setConnection('Нужен вход',false);if(/только владельцу|не назначен владельцем/i.test(error.message))$('#loginError').textContent=error.message;return false;}
  }
  async function loadOverview(){
    const result=await Promise.all([api('/api/admin/overview'),api('/api/admin/economy')]);const o=result[0],e=result[1];
    $('#statsGrid').innerHTML=stat('Всего аккаунтов',num(o.users),num(o.guests)+' гостевых')+stat('Активные диалоги',num(o.activeMatches),'Сейчас')+stat('Открытые жалобы',num(o.openReports),'Нужна проверка')+stat('Токены в системе',num(o.tokenTotal)+' ✦','Суммарный баланс');
    $('#economyDetails').innerHTML=[['Заработано сегодня',num(e.earnedToday)+' ✦'],['Всего токенов',num(e.totalTokens)+' ✦'],['Дата отчёта',e.today]].concat((e.transactions||[]).slice(0,5).map(x=>[x.kind,num(x.amount)+' ✦ · '+num(x.count)+' операций'])).map(x=>'<div class="detail-row"><span>'+esc(x[0])+'</span><strong>'+esc(x[1])+'</strong></div>').join('');
  }
  async function refreshAll(){const b=$('#refreshAllButton');b.disabled=true;try{await Promise.all([loadOverview()]);toast('Данные обновлены.');}catch(e){toast(e.message);}finally{b.disabled=false;}}
  async function loadUsers(query,append){
    if(!append){state.userQuery=query==null?state.userQuery:query;state.userOffset=0;state.users=[];}
    const offset=append?state.userOffset:0;
    const result=await api('/api/admin/users?limit=100&offset='+offset+(state.userQuery?'&q='+encodeURIComponent(state.userQuery):''));
    state.userTotal=Number(result.total||0);state.users=append?state.users.concat(result.users||[]):(result.users||[]);state.userOffset=offset+(result.users||[]).length;state.userHasMore=Boolean(result.hasMore);
    $('#userResults').innerHTML=state.users.map(u=>{
      const suspended=u.suspended_until&&new Date(u.suspended_until)>new Date();
      return '<button type="button" class="user-card user-open-card" data-open-user="'+esc(u.id)+'"><span class="user-avatar">'+(u.owner?'👑':u.account_type==='guest'?'👤':'✦')+'</span><span class="user-main"><strong>'+esc(u.username)+(u.owner?' <em>Владелец</em>':'')+'</strong><small>'+esc(u.public_id)+' · '+(u.account_type==='guest'?'Гость':'Аккаунт')+' · '+esc(u.role)+'</small><small>'+num(u.tokens)+' ✦ · '+esc(u.subscription_tier||'free')+' · '+(u.online?'● онлайн':'○ не в сети')+'</small></span><span class="user-card-end"><span class="tag '+(suspended?'warning':'neutral')+'">'+(suspended?'Ограничен':'Активен')+'</span><span class="open-arrow">→</span></span></button>';
    }).join('')||'<p class="empty-state">Пользователи не найдены.</p>';
    $('#userCountSummary').textContent=state.userTotal?num(state.userTotal)+' аккаунтов · показано '+num(state.users.length):'Пользователей пока нет.';
    $('#loadMoreUsers').hidden=!state.userHasMore;
  }
  async function openUserDetail(id){
    infoModalRestore=null;
    suspendModalLayers('userDetailModal');
    state.selectedUserId=id;$('#userDetailModal').hidden=false;$('#userDetailTitle').textContent='Загружаем…';$('#userDetailMeta').textContent='';$('#userDetailContent').innerHTML='<p class="empty-state">Загружаем профиль…</p>';
    try{
      const d=await api('/api/admin/users/'+encodeURIComponent(id));if(state.selectedUserId!==id)return;
      const u=d.user,s=d.stats;
      $('#userDetailTitle').textContent=u.username;$('#userDetailMeta').textContent=u.publicId+' · '+(u.owner?'Владелец':u.accountType==='guest'?'Гость':'Аккаунт')+' · '+(u.online?'онлайн':'не в сети');
      const stats=[['Диалоги',s.totalMatches],['Минуты общения',s.activeMinutes],['Сообщения',s.totalMessages],['Активные сессии',s.activeSessions+'/'+s.totalSessions],['Заработано ✦',num(s.tokensEarned)],['Потрачено ✦',num(s.tokensSpent)],['Предметы',s.inventoryCount],['Активации промо',s.promoRedemptions],['Жалобы на него',s.reportsReceived],['Его жалобы',s.reportsMade],['Тикеты',s.ticketCount],['Меры модерации',s.moderationCount]];
      const promoRows=(d.personalPromos||[]).map(p=>'<div class="mini-row"><span><strong>'+esc(p.code)+'</strong><small>'+(p.active?'Активен':'Отключён')+' · '+p.uses+'/'+p.max_uses+' · '+date(p.expires_at)+'</small></span><button type="button" class="secondary mini" data-promo-stats="'+esc(p.id)+'">Статистика</button></div>').join('')||'<p class="hint">Персональных кодов пока нет.</p>';
      const tx=(d.transactions||[]).map(t=>'<div class="mini-row"><span><strong>'+esc(t.description||t.kind)+'</strong><small>'+date(t.created_at)+' · '+esc(t.kind)+'</small></span><b class="'+(Number(t.amount)>=0?'positive':'negative')+'">'+(Number(t.amount)>0?'+':'')+num(t.amount)+' ✦</b></div>').join('')||'<p class="hint">История операций пуста.</p>';
      const mod=(d.moderation||[]).map(m=>'<div class="mini-row"><span><strong>'+esc(m.action)+'</strong><small>'+esc(m.reason||'Без комментария')+' · '+date(m.created_at)+'</small></span></div>').join('')||'<p class="hint">Мер модерации нет.</p>';
      const actions=u.owner?'<p class="hint">Управляющие действия для аккаунта владельца отключены.</p>':'<div class="detail-actions"><button class="primary" data-user-action="tokens">± Токены</button><button class="secondary" data-user-action="vip">VIP / Premium</button><button class="secondary" data-user-action="personalPromo">🎁 Личное промо</button><button class="secondary" data-user-action="starterPack" '+(u.starterGifted?'disabled':'')+'>Стартовый подарок</button><button class="secondary" data-user-action="role">Роль</button>'+(u.suspendedUntil&&new Date(u.suspendedUntil)>new Date()?'<button class="primary" data-user-action="unsuspend">Снять блокировку</button>':'<button class="danger" data-user-action="suspend">Заблокировать</button>')+'<button class="secondary" data-user-action="logout">Завершить сессии</button><button class="secondary" data-user-action="paidMembership">Подтвердить оплату</button></div>';
      $('#userDetailContent').innerHTML='<div class="user-detail-hero"><div class="detail-avatar">'+(u.owner?'👑':esc(u.avatar||'✦'))+'</div><div><strong>'+esc(u.username)+'</strong><span>'+esc(u.role)+' · '+esc(u.subscriptionTier||'free')+'</span><small>Регистрация: '+date(u.createdAt)+'</small><small>Последний вход: '+date(s.lastLoginAt)+'</small></div></div><div class="detail-balance"><div><span>Баланс</span><strong>'+num(u.tokens)+' ✦</strong></div><div><span>Привилегия</span><strong>'+esc(u.subscriptionTier||'free')+'</strong><small>до '+date(u.subscriptionExpiresAt)+'</small></div><div><span>Доступ</span><strong>'+(u.suspendedUntil&&new Date(u.suspendedUntil)>new Date()?'Ограничен':'Активен')+'</strong><small>'+esc(u.suspensionReason||'')+'</small></div></div><section class="detail-section"><h3>Действия с аккаунтом</h3>'+actions+'</section><section class="detail-section"><h3>Статистика</h3><div class="detail-stat-grid">'+stats.map(x=>'<div><span>'+esc(x[0])+'</span><strong>'+esc(x[1])+'</strong></div>').join('')+'</div></section><section class="detail-section"><h3>Персональные промокоды</h3><div class="mini-list">'+promoRows+'</div></section><section class="detail-section"><h3>Последние операции с токенами</h3><div class="mini-list">'+tx+'</div></section><section class="detail-section"><h3>Модерация</h3><div class="mini-list">'+mod+'</div></section>';
    }catch(error){$('#userDetailContent').innerHTML='<p class="error">'+esc(error.message)+'</p>';}
  }
  async function runUserAction(action){
    const id=state.selectedUserId;if(!id)return;
    if(action==='unsuspend'){
      if(!await confirmDialog({title:'Снять блокировку?',message:'Пользователь снова получит доступ к аккаунту.',confirmText:'Снять'}))return;
      await api('/api/admin/users/'+encodeURIComponent(id)+'/suspend',{method:'DELETE'});
    }else{
      const p=await openActionDialog(action,state.users.find(u=>u.id===id)||{});if(!p)return;
      const routes={tokens:'tokens',vip:'membership',role:'role',suspend:'suspend',starterPack:'starter-pack',paidMembership:'paid-membership',personalPromo:'promo',logout:'logout'};
      await api('/api/admin/users/'+encodeURIComponent(id)+'/'+routes[action],{method:'POST',body:JSON.stringify(p)});
    }
    toast(action==='personalPromo'?'Персональный код создан.':'Изменения сохранены.');
    await loadUsers(state.userQuery,false);await openUserDetail(id);
  }
  async function loadStoreItems(){
    try{const r=await api('/api/store');$('#promoItem').innerHTML='<option value="">Без предмета</option>'+(r.items||[]).map(i=>'<option value="'+esc(i.id)+'">'+esc(i.name)+'</option>').join('');}
    catch{$('#promoItem').innerHTML='<option value="">Без предмета</option>';}
  }

  async function loadPromos(){
    const r=await api('/api/admin/promos'),rows=r.promos||[];
    $('#promoStatsSummary').innerHTML=stat('Всего промокодов',rows.length)+stat('Активны',rows.filter(x=>x.active).length)+stat('Активаций всего',num(rows.reduce((a,x)=>a+Number(x.uses||0),0)));
    $('#promoList').innerHTML=rows.map(p=>'<article class="promo-row"><div class="promo-main"><strong>'+esc(p.code)+'</strong><small>'+(p.target_user_id?'Персональный · '+esc(p.target_username||'пользователь'):'Общий')+' · '+(p.active?'активен':'отключён')+'</small><small>'+num(p.token_reward)+' ✦ '+(p.item_id?'· '+esc(p.item_id):'')+(p.membership_tier?' · '+esc(p.membership_tier)+' '+p.membership_days+' дн.':'')+'</small><small>Активации: '+num(p.uses)+'/'+num(p.max_uses)+' · '+(p.expires_at?'до '+date(p.expires_at):'без срока')+'</small></div><div class="inline-actions"><button class="secondary mini" data-promo-stats="'+esc(p.id)+'">Статистика</button><button class="secondary mini" data-promo-edit="'+esc(p.id)+'">Изменить</button><button class="secondary mini" data-promo-toggle="'+esc(p.id)+'" data-active="'+(p.active?'1':'0')+'">'+(p.active?'Отключить':'Включить')+'</button></div></article>').join('')||'<p class="empty-state">Промокодов пока нет.</p>';
  }
  async function showPromoStats(id){
    const r=await api('/api/admin/promos/'+encodeURIComponent(id)),p=r.promo;
    const list=(r.redemptions||[]).map(x=>'<div class="mini-row"><button class="link-button" data-open-user="'+esc(x.user_id)+'">'+esc(x.username)+' · '+esc(x.public_id)+'</button><small>'+date(x.redeemed_at)+'</small></div>').join('')||'<p class="hint">Активаций пока нет.</p>';
    openInfo('Статистика '+p.code,'<div class="detail-stat-grid"><div><span>Активации</span><strong>'+num(p.uses)+'</strong></div><div><span>Лимит</span><strong>'+num(p.max_uses)+'</strong></div><div><span>Осталось</span><strong>'+num(Math.max(0,Number(p.max_uses)-Number(p.uses)))+'</strong></div></div><div class="detail-section"><h3>Кто активировал</h3><div class="mini-list">'+list+'</div></div>');
  }
  $('#promoForm').addEventListener('submit',async e=>{
    e.preventDefault();const b=e.currentTarget.querySelector('button[type="submit"]');b.disabled=true;$('#promoMessage').textContent='';
    try{
      const tier=$('#promoTier').value,rand=Array.from(crypto.getRandomValues(new Uint8Array(4))).map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
      const p={code:$('#promoCode').value.trim()||'SOLVI-'+rand,tokens:Number($('#promoTokens').value)||0,itemId:$('#promoItem').value||undefined,membershipTier:tier||undefined,membershipDays:tier?Number($('#promoDays').value):undefined,maxUses:Number($('#promoMaxUses').value)||1,startsAt:$('#promoStarts').value?new Date($('#promoStarts').value).toISOString():undefined,expiresAt:$('#promoExpires').value?new Date($('#promoExpires').value).toISOString():undefined};
      const r=await api('/api/admin/promos',{method:'POST',body:JSON.stringify(p)});$('#promoMessage').textContent='Создан код '+r.promo.code+'.';e.currentTarget.reset();await loadPromos();toast('Промокод создан.');
    }catch(err){$('#promoMessage').textContent=err.message;}finally{b.disabled=false;}
  });
  $('#promoList').addEventListener('click',async e=>{
    const s=e.target.closest('[data-promo-stats]'),ed=e.target.closest('[data-promo-edit]'),t=e.target.closest('[data-promo-toggle]');
    try{
      if(s)await showPromoStats(s.dataset.promoStats);
      else if(ed){const r=await api('/api/admin/promos/'+encodeURIComponent(ed.dataset.promoEdit));const p=await openActionDialog('editPromo',r.promo);if(!p)return;await api('/api/admin/promos/'+encodeURIComponent(ed.dataset.promoEdit),{method:'PATCH',body:JSON.stringify(p)});await loadPromos();toast('Промокод обновлён.');}
      else if(t){await api('/api/admin/promos/'+encodeURIComponent(t.dataset.promoToggle),{method:'PATCH',body:JSON.stringify({active:t.dataset.active!=='1'})});await loadPromos();toast('Статус обновлён.');}
    }catch(err){toast(err.message);}
  });

  function renderMatches(){
    const q=state.matchSearch.toLowerCase(),rows=state.matches.filter(m=>!q||[m.user1,m.user2,m.id,m.user1_public_id,m.user2_public_id].some(x=>String(x||'').toLowerCase().includes(q)));
    $('#matchCounters').textContent=state.matches.length+' активных · показано '+rows.length;
    $('#matchList').innerHTML=rows.map(m=>'<article class="user-card match-card"><div class="user-main"><strong>'+esc(m.user1)+' ↔ '+esc(m.user2)+'</strong><small>'+(m.bothOnline?'● Оба онлайн':'○ Не обе сессии активны')+' · '+Math.floor(Number(m.active_seconds||0)/60)+' мин.</small><small>'+num(m.message_count)+' сообщений · последнее: '+date(m.last_message_at)+'</small><small>ID: '+esc(m.id)+'</small></div><div class="inline-actions"><button class="primary mini" data-open-match="'+esc(m.id)+'">Открыть</button><button class="danger mini" data-end-match="'+esc(m.id)+'">Завершить</button></div></article>').join('')||'<p class="empty-state">Активных диалогов по запросу нет.</p>';
  }
  async function loadMatches(){const r=await api('/api/admin/matches');state.matches=r.matches||[];renderMatches();}
  function openInspector(id){
    suspendModalLayers('dialogInspector');
    const m=state.matches.find(x=>x.id===id);if(!m)return;state.inspectMatchId=id;
    $('#inspectorTitle').textContent='Проверка активного диалога';$('#inspectorParticipants').textContent=m.user1+' ↔ '+m.user2+' · '+m.id;
    $('#inspectReason').value='';$('#dialogNoticeText').value='';$('#dialogMessages').innerHTML='<p class="empty-state">Укажи причину проверки. Участники будут уведомлены.</p>';$('#dialogInspector').hidden=false;
  }
  async function inspectDialog(){
    const reason=$('#inspectReason').value.trim();if(reason.length<6)return toast('Причина должна содержать минимум 6 символов.');if(!state.inspectMatchId)return;
    const b=$('#inspectDialogButton');b.disabled=true;
    try{const r=await api('/api/admin/matches/'+encodeURIComponent(state.inspectMatchId)+'/inspect',{method:'POST',body:JSON.stringify({reason})});$('#dialogMessages').innerHTML=(r.messages||[]).map(m=>'<article class="inspector-message"><div><strong>'+esc(m.sender)+'</strong><time>'+date(m.created_at)+'</time></div><p>'+esc(m.content||(m.messageType==='voice'?'Голосовое сообщение':m.hasAttachments?'Вложение':'[сообщение без текста]'))+'</p>'+(m.hasAttachments?'<small>Вложения скрыты</small>':'')+'</article>').join('')||'<p class="empty-state">Сообщений пока нет.</p>';toast('Сообщений: '+(r.messages||[]).length+'. Участники уведомлены.');}
    catch(err){toast(err.message);}finally{b.disabled=false;}
  }
  $('#matchList').addEventListener('click',async e=>{
    const o=e.target.closest('[data-open-match]'),end=e.target.closest('[data-end-match]');
    if(o){openInspector(o.dataset.openMatch);return;}if(!end)return;
    if(!await confirmDialog({title:'Завершить диалог?',message:'Оба участника будут отключены от чата.',confirmText:'Завершить',danger:true}))return;
    try{await api('/api/admin/matches/'+encodeURIComponent(end.dataset.endMatch)+'/end',{method:'POST',body:'{}'});await loadMatches();toast('Диалог завершён.');}catch(err){toast(err.message);}
  });

  async function loadReports(){const r=await api('/api/admin/reports');state.reports=r.reports||[];renderReports();}
  function renderReports(){
    const q=state.reportQuery,all=state.reports,open=all.filter(x=>x.status!=='resolved');
    const rows=all.filter(r=>(state.reportFilter==='all'||r.status===state.reportFilter)&&(!q||[r.category,r.reporter,r.reported,r.reporterPublicId,r.reportedPublicId,r.details].some(v=>String(v||'').toLowerCase().includes(q))));
    $('#reportCounters').textContent=all.length+' жалоб · '+open.length+' требуют внимания';
    $('#reportList').innerHTML=rows.map(r=>{
      const context=(r.context||[]).slice(-4).map(x=>'<div class="context-line"><strong>'+esc(x.sender||x.username||'Контекст')+'</strong><span>'+esc(x.content||x.text||x.message||'Сообщение без текста')+'</span></div>').join('');
      return '<article class="report-row"><div class="report-main"><strong>'+esc(r.category)+' <span class="tag '+(r.status==='resolved'?'neutral':'warning')+'">'+(r.status==='resolved'?'Рассмотрена':'Открыта')+'</span></strong><small>'+date(r.createdAt)+'</small><p><button class="link-button" data-open-user="'+esc(r.reporterId)+'">'+esc(r.reporter)+'</button> пожаловался на <button class="link-button" data-open-user="'+esc(r.reportedId)+'">'+esc(r.reported)+'</button></p><p>'+esc(r.details||'Без описания')+'</p>'+(context?'<details class="report-context"><summary>Контекст ('+(r.context||[]).length+')</summary>'+context+'</details>':'')+(r.resolution?'<small>Решение: '+esc(r.resolution)+'</small>':'')+'</div><div class="inline-actions">'+(r.status!=='resolved'?'<button class="primary mini" data-resolve-report="'+esc(r.id)+'">Рассмотреть</button>':'')+'<button class="danger mini" data-suspend-reported="'+esc(r.reportedId)+'" data-category="'+esc(r.category)+'">Ограничить</button></div></article>';
    }).join('')||'<p class="empty-state">Жалоб по этому фильтру нет.</p>';
  }
  $('#reportList').addEventListener('click',async e=>{
    const user=e.target.closest('[data-open-user]');if(user){openUserDetail(user.dataset.openUser);return;}
    const resolve=e.target.closest('[data-resolve-report]'),suspend=e.target.closest('[data-suspend-reported]');
    try{
      if(resolve){const text=await confirmDialog({title:'Решение по жалобе',message:'Кратко опиши результат проверки.',input:true,defaultValue:'Проверено',confirmText:'Сохранить'});if(text===null)return;await api('/api/admin/reports/'+encodeURIComponent(resolve.dataset.resolveReport)+'/resolve',{method:'POST',body:JSON.stringify({resolution:text})});}
      else if(suspend){if(!await confirmDialog({title:'Ограничить пользователя?',message:'Доступ будет ограничен на 1 час. Действие попадёт в журнал.',confirmText:'Ограничить',danger:true}))return;await api('/api/admin/users/'+encodeURIComponent(suspend.dataset.suspendReported)+'/suspend',{method:'POST',body:JSON.stringify({minutes:60,reason:'Жалоба: '+suspend.dataset.category})});}
      else return;
      await loadReports();toast('Решение сохранено.');
    }catch(err){toast(err.message);}
  });

  async function loadTickets(){const r=await api('/api/admin/tickets');state.tickets=r.tickets||[];renderTickets();}
  function renderTickets(){
    const rows=state.tickets.filter(t=>(state.ticketFilter==='all'||t.status===state.ticketFilter||t.category===state.ticketFilter)&&(!state.ticketQuery||[t.title,t.username,t.public_id,t.last_message].some(x=>String(x||'').toLowerCase().includes(state.ticketQuery))));
    $('#ticketCounters').textContent=state.tickets.length+' тикетов · '+state.tickets.filter(t=>t.status!=='closed').length+' требуют ответа';
    $('#adminTicketList').innerHTML=rows.map(t=>'<button type="button" class="ticket-row '+(t.id===state.activeTicketId?'active':'')+'" data-admin-ticket="'+esc(t.id)+'"><strong>'+esc(t.title)+'</strong><small>'+(t.category==='bug'?'Ошибка':'Идея')+' · '+({open:'Открыт',in_progress:'В работе',closed:'Закрыт'}[t.status]||t.status)+' · '+esc(t.username)+' · '+esc(t.public_id)+'</small><small>'+esc(t.last_message||'')+'</small></button>').join('')||'<p class="empty-state">Тикетов по запросу нет.</p>';
  }
  async function openTicket(id){
    const r=await api('/api/admin/tickets/'+encodeURIComponent(id));state.activeTicketId=id;
    $('#adminTicketTitle').textContent=r.ticket.title;$('#adminTicketMeta').textContent=(r.ticket.category==='bug'?'Ошибка':'Идея')+' · '+r.ticket.username+' · '+r.ticket.public_id+' · '+({open:'Открыт',in_progress:'В работе',closed:'Закрыт'}[r.ticket.status]||r.ticket.status);
    $('#adminTicketMessages').innerHTML=(r.messages||[]).map(m=>'<article class="ticket-message"><div><strong>'+esc(m.sender_name)+'</strong><time>'+date(m.created_at)+'</time></div><p>'+esc(m.body)+'</p></article>').join('')||'<p class="empty-state">Сообщений пока нет.</p>';
    $('#adminTicketStatus').value=r.ticket.status==='closed'?'closed':r.ticket.status==='open'?'in_progress':r.ticket.status;$('#adminTicketReply').value='';$('#adminTicketReplyForm').hidden=false;renderTickets();
  }
  $('#adminTicketList').addEventListener('click',e=>{const b=e.target.closest('[data-admin-ticket]');if(b)openTicket(b.dataset.adminTicket).catch(err=>toast(err.message));});
  $('#adminTicketReplyForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!state.activeTicketId)return;const b=$('#adminTicketReplyButton');b.disabled=true;
    try{await api('/api/admin/tickets/'+encodeURIComponent(state.activeTicketId)+'/reply',{method:'POST',body:JSON.stringify({body:$('#adminTicketReply').value,status:$('#adminTicketStatus').value})});await openTicket(state.activeTicketId);await loadTickets();toast('Ответ отправлен.');}
    catch(err){toast(err.message);}finally{b.disabled=false;}
  });

  async function loadGrowth(){
    const r=await api('/api/admin/growth');state.socialLinks=r.socialLinks||[];state.tasks=r.tasks||[];state.submissions=r.submissions||[];
    $('#revenueSummary').textContent=(r.revenue||[]).length?'Оплаты: '+r.revenue.map(x=>x.currency+' '+(Number(x.amount_minor)/100).toFixed(2)+' · '+x.payments+' платежей').join(' · '):'Подтверждённых оплат пока нет.';
    renderSocialLinks();renderTasks();renderSubmissions();
  }
  function renderSocialLinks(){
    $('#socialLinkList').innerHTML=state.socialLinks.map(x=>'<article class="growth-row"><div><strong>'+esc(x.icon)+' '+esc(x.label)+'</strong><small>'+esc(x.platform)+' · <a href="'+esc(x.url)+'" target="_blank" rel="noopener noreferrer">'+esc(x.url)+'</a></small><small>Порядок '+Number(x.sort_order||0)+' · '+(x.enabled?'видна на сайте':'скрыта')+'</small></div><div class="inline-actions"><button class="secondary mini" data-social-edit="'+esc(x.id)+'">Изменить</button><button class="secondary mini" data-social-toggle="'+esc(x.id)+'" data-enabled="'+(x.enabled?'1':'0')+'">'+(x.enabled?'Скрыть':'Показать')+'</button><button class="danger mini" data-social-delete="'+esc(x.id)+'">Удалить</button></div></article>').join('')||'<p class="empty-state">Ссылок пока нет.</p>';
  }
  function renderTasks(){
    $('#rewardTaskList').innerHTML=state.tasks.map(x=>'<article class="growth-row"><div><strong>'+esc(x.title)+'</strong><small>'+esc(x.platform)+' · '+num(x.reward_tokens)+' ✦ · заявок '+num(x.submissions)+' · одобрено '+num(x.approved)+'</small><small>'+(x.sponsor_name?'Рекламодатель: '+esc(x.sponsor_name)+' · ':'')+(Number(x.max_claims)?'Лимит '+num(x.max_claims):'Без лимита')+' · '+(x.active?'опубликовано':'в архиве')+'</small></div><div class="inline-actions"><button class="secondary mini" data-task-edit="'+esc(x.id)+'">Изменить</button><button class="secondary mini" data-task-toggle="'+esc(x.id)+'" data-active="'+(x.active?'1':'0')+'">'+(x.active?'Скрыть':'Опубликовать')+'</button><button class="danger mini" data-task-delete="'+esc(x.id)+'">Удалить</button></div></article>').join('')||'<p class="empty-state">Заданий пока нет.</p>';
  }
  function renderSubmissions(){
    $('#taskSubmissionList').innerHTML=state.submissions.map(x=>'<article class="growth-row"><div><strong>'+esc(x.task_title)+' · '+esc(x.username)+'</strong><small>'+esc(x.public_id)+' · '+num(x.reward_tokens)+' ✦ · '+date(x.created_at)+'</small><small><a href="'+esc(x.proof_url)+'" target="_blank" rel="noopener noreferrer">Открыть доказательство ↗</a> · '+esc(x.status)+(x.review_note?' · '+esc(x.review_note):'')+'</small></div><div class="inline-actions">'+(x.status==='pending'?'<button class="primary mini" data-review-submission="'+esc(x.id)+'" data-decision="approve">Одобрить</button><button class="danger mini" data-review-submission="'+esc(x.id)+'" data-decision="reject">Отклонить</button>':'<span class="tag neutral">Проверено</span>')+'</div></article>').join('')||'<p class="empty-state">Заявок на проверку нет.</p>';
  }
  $('#socialLinkForm').addEventListener('submit',async e=>{
    e.preventDefault();const b=e.currentTarget.querySelector('button[type="submit"]');b.disabled=true;
    try{await api('/api/admin/social-links',{method:'POST',body:JSON.stringify({platform:$('#socialPlatform').value.trim(),label:$('#socialLabel').value.trim(),url:$('#socialUrl').value.trim(),icon:$('#socialIcon').value.trim()||'↗',sortOrder:Number($('#socialSortOrder').value||0)})});e.currentTarget.reset();$('#socialIcon').value='↗';$('#socialSortOrder').value='0';await loadGrowth();toast('Ссылка добавлена.');}
    catch(err){toast(err.message);}finally{b.disabled=false;}
  });
  $('#socialLinkList').addEventListener('click',async e=>{
    const ed=e.target.closest('[data-social-edit]'),tg=e.target.closest('[data-social-toggle]'),rm=e.target.closest('[data-social-delete]');
    try{
      if(ed){const x=state.socialLinks.find(a=>a.id===ed.dataset.socialEdit);if(!x)return;const p=await openActionDialog('editSocial',x);if(!p)return;await api('/api/admin/social-links/'+encodeURIComponent(x.id),{method:'PATCH',body:JSON.stringify(p)});await loadGrowth();toast('Ссылка изменена.');}
      else if(tg){await api('/api/admin/social-links/'+encodeURIComponent(tg.dataset.socialToggle),{method:'PATCH',body:JSON.stringify({enabled:tg.dataset.enabled!=='1'})});await loadGrowth();toast('Видимость изменена.');}
      else if(rm){if(!await confirmDialog({title:'Удалить ссылку?',message:'Она исчезнет из футера сайта.',confirmText:'Удалить',danger:true}))return;await api('/api/admin/social-links/'+encodeURIComponent(rm.dataset.socialDelete),{method:'DELETE'});await loadGrowth();toast('Ссылка удалена.');}
    }catch(err){toast(err.message);}
  });
  $('#rewardTaskForm').addEventListener('submit',async e=>{
    e.preventDefault();const b=e.currentTarget.querySelector('button[type="submit"]');b.disabled=true;
    try{await api('/api/admin/tasks',{method:'POST',body:JSON.stringify({title:$('#taskTitle').value.trim(),description:$('#taskDescription').value.trim(),platform:$('#taskPlatform').value.trim(),url:$('#taskUrl').value.trim(),rewardTokens:Number($('#taskReward').value),sponsorName:$('#taskSponsor').value.trim(),maxClaims:Number($('#taskMaxClaims').value||0)})});e.currentTarget.reset();$('#taskReward').value='50';$('#taskMaxClaims').value='0';await loadGrowth();toast('Задание опубликовано.');}
    catch(err){toast(err.message);}finally{b.disabled=false;}
  });
  $('#rewardTaskList').addEventListener('click',async e=>{
    const ed=e.target.closest('[data-task-edit]'),tg=e.target.closest('[data-task-toggle]'),rm=e.target.closest('[data-task-delete]');
    try{
      if(ed){const x=state.tasks.find(a=>a.id===ed.dataset.taskEdit);if(!x)return;const p=await openActionDialog('editTask',x);if(!p)return;await api('/api/admin/tasks/'+encodeURIComponent(x.id),{method:'PATCH',body:JSON.stringify(p)});await loadGrowth();toast('Задание обновлено.');}
      else if(tg){await api('/api/admin/tasks/'+encodeURIComponent(tg.dataset.taskToggle),{method:'PATCH',body:JSON.stringify({active:tg.dataset.active!=='1'})});await loadGrowth();toast('Статус задания изменён.');}
      else if(rm){if(!await confirmDialog({title:'Удалить задание?',message:'Если по нему уже есть заявки, оно будет архивировано вместе с историей проверок.',confirmText:'Удалить / архивировать',danger:true}))return;const r=await api('/api/admin/tasks/'+encodeURIComponent(rm.dataset.taskDelete),{method:'DELETE'});await loadGrowth();toast(r.archived?'Задание отправлено в архив.':'Задание удалено.');}
    }catch(err){toast(err.message);}
  });
  $('#taskSubmissionList').addEventListener('click',async e=>{
    const b=e.target.closest('[data-review-submission]');if(!b)return;
    const note=await confirmDialog({title:b.dataset.decision==='approve'?'Одобрить заявку?':'Отклонить заявку?',message:'Добавь комментарий для журнала и пользователя (необязательно).',input:true,defaultValue:'Проверено'});if(note===null)return;
    try{await api('/api/admin/task-submissions/'+encodeURIComponent(b.dataset.reviewSubmission)+'/review',{method:'POST',body:JSON.stringify({decision:b.dataset.decision,note})});await loadGrowth();toast(b.dataset.decision==='approve'?'Награда выдана.':'Заявка отклонена.');}catch(err){toast(err.message);}
  });
  async function loadAudit(){const r=await api('/api/admin/audit');$('#auditList').textContent=(r.entries||[]).map(x=>date(x.created_at)+'  '+x.action+'  '+(x.target_id||'')+'\n'+JSON.stringify(x.details||{})).join('\n\n')||'Журнал пока пуст.';}
  function showTab(name,load){
    if(!document.querySelector('[data-page="'+name+'"]'))name='overview';
    document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
    document.querySelectorAll('[data-page]').forEach(p=>p.hidden=p.dataset.page!==name);
    if(state.matchesTimer){clearInterval(state.matchesTimer);state.matchesTimer=null;}
    if(load===false)return;
    const loaders={overview:loadOverview,users:()=>loadUsers(state.userQuery,false),promos:loadPromos,dialogs:loadMatches,reports:loadReports,tickets:loadTickets,growth:loadGrowth,audit:loadAudit};
    Promise.resolve(loaders[name]()).catch(err=>toast(err.message));
    if(name==='dialogs')state.matchesTimer=setInterval(()=>loadMatches().catch(err=>toast(err.message)),15000);
  }

  applyOwnerTheme();
  $('#themeToggleButton').addEventListener('click',()=>applyOwnerTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('#loginForm').addEventListener('submit',async e=>{
    e.preventDefault();$('#loginError').textContent='';setConnection('Входим…');const b=e.currentTarget.querySelector('button[type="submit"]');b.disabled=true;
    try{const r=await api('/api/auth/login',{method:'POST',body:JSON.stringify({username:$('#loginName').value.trim(),password:$('#loginPassword').value,accessCode:$('#loginInvite').value.trim()})});state.token=r.token;localStorage.setItem('sovli_admin_token',state.token);if(!await verifyOwner())throw new Error('Этот аккаунт не назначен владельцем. Проверь OWNER_PUBLIC_ID.');await loadStoreItems();toast('Добро пожаловать в панель владельца.');}
    catch(err){$('#loginError').textContent=err.message;setConnection('Не авторизован',false);}finally{b.disabled=false;}
  });
  $('#logoutButton').addEventListener('click',()=>{clearAuth();setConnection('Выход выполнен');});
  $('#refreshAllButton').addEventListener('click',refreshAll);
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
  document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.go)));
  $('#userSearchForm').addEventListener('submit',e=>{e.preventDefault();loadUsers($('#userSearchInput').value.trim(),false).catch(err=>toast(err.message));});
  $('#clearUserSearch').addEventListener('click',()=>{$('#userSearchInput').value='';loadUsers('',false).catch(err=>toast(err.message));});
  $('#loadMoreUsers').addEventListener('click',()=>loadUsers(state.userQuery,true).catch(err=>toast(err.message)));
  $('#userResults').addEventListener('click',e=>{const b=e.target.closest('[data-open-user]');if(b)openUserDetail(b.dataset.openUser);});
  $('#userDetailContent').addEventListener('click',e=>{const a=e.target.closest('[data-user-action]'),p=e.target.closest('[data-promo-stats]');if(a)runUserAction(a.dataset.userAction).catch(err=>toast(err.message));else if(p)showPromoStats(p.dataset.promoStats).catch(err=>toast(err.message));});
  $('#closeUserDetail').addEventListener('click',()=>{$('#userDetailModal').hidden=true;state.selectedUserId='';});
  $('#userDetailModal').addEventListener('click',e=>{if(e.target===$('#userDetailModal')){$('#userDetailModal').hidden=true;state.selectedUserId='';}});
  $('#refreshPromosButton').addEventListener('click',()=>loadPromos().catch(err=>toast(err.message)));
  $('#refreshMatchesButton').addEventListener('click',()=>loadMatches().catch(err=>toast(err.message)));
  $('#matchSearchInput').addEventListener('input',()=>{state.matchSearch=$('#matchSearchInput').value.trim();renderMatches();});
  $('#refreshReportsButton').addEventListener('click',()=>loadReports().catch(err=>toast(err.message)));
  $('#reportSearchInput').addEventListener('input',()=>{state.reportQuery=$('#reportSearchInput').value.trim().toLowerCase();renderReports();});
  $('#reportFilters').addEventListener('click',e=>{const b=e.target.closest('[data-report-filter]');if(!b)return;state.reportFilter=b.dataset.reportFilter;$('#reportFilters').querySelectorAll('[data-report-filter]').forEach(x=>x.classList.toggle('active',x===b));renderReports();});
  $('#refreshTicketsButton').addEventListener('click',()=>loadTickets().catch(err=>toast(err.message)));
  $('#ticketAdminSearch').addEventListener('input',()=>{state.ticketQuery=$('#ticketAdminSearch').value.trim().toLowerCase();renderTickets();});
  $('#ticketAdminFilters').addEventListener('click',e=>{const b=e.target.closest('[data-ticket-filter]');if(!b)return;state.ticketFilter=b.dataset.ticketFilter;$('#ticketAdminFilters').querySelectorAll('[data-ticket-filter]').forEach(x=>x.classList.toggle('active',x===b));renderTickets();});
  $('#refreshGrowthButton').addEventListener('click',()=>loadGrowth().catch(err=>toast(err.message)));
  $('#refreshAuditButton').addEventListener('click',()=>loadAudit().catch(err=>toast(err.message)));
  $('#inspectDialogButton').addEventListener('click',inspectDialog);
  $('#closeDialogInspector').addEventListener('click',()=>{$('#dialogInspector').hidden=true;state.inspectMatchId='';});
  $('#dialogInspector').addEventListener('click',e=>{if(e.target===$('#dialogInspector')){$('#dialogInspector').hidden=true;state.inspectMatchId='';}});
  $('#sendDialogNoticeButton').addEventListener('click',async()=>{
    const message=$('#dialogNoticeText').value.trim();if(message.length<3)return toast('Напиши сообщение минимум из 3 символов.');if(!state.inspectMatchId)return;
    try{await api('/api/admin/matches/'+encodeURIComponent(state.inspectMatchId)+'/notice',{method:'POST',body:JSON.stringify({message})});$('#dialogNoticeText').value='';toast('Уведомление отправлено участникам.');}catch(err){toast(err.message);}
  });
  $('#endInspectedMatch').addEventListener('click',async()=>{
    if(!state.inspectMatchId||!await confirmDialog({title:'Завершить диалог?',message:'Оба участника будут отключены от чата.',confirmText:'Завершить',danger:true}))return;
    try{await api('/api/admin/matches/'+encodeURIComponent(state.inspectMatchId)+'/end',{method:'POST',body:'{}'});$('#dialogInspector').hidden=true;await loadMatches();toast('Диалог завершён.');}catch(err){toast(err.message);}
  });
  $('#closeInfoModal').addEventListener('click',closeInfo);
  $('#infoModal').addEventListener('click',e=>{if(e.target===$('#infoModal'))closeInfo();});
  $('#infoModalBody').addEventListener('click',e=>{const b=e.target.closest('[data-open-user]');if(b)openUserDetail(b.dataset.openUser);});
  window.addEventListener('keydown',e=>{
    if(e.key!=='Escape'||document.querySelector('.confirm-card')||!$('#ownerActionModal').hidden)return;
    if(!$('#infoModal').hidden){closeInfo();return;}
    if(!$('#dialogInspector').hidden){$('#dialogInspector').hidden=true;state.inspectMatchId='';return;}
    if(!$('#userDetailModal').hidden){$('#userDetailModal').hidden=true;state.selectedUserId='';}
  });
  async function boot(){if(await verifyOwner())await loadStoreItems();else{setConnection('Нужен вход',false);if(state.token&&!$('#loginError').textContent)$('#loginError').textContent='Сессия не имеет прав владельца. Войди аккаунтом владельца.';}}
  boot();
})();