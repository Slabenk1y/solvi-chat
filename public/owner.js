'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const safeStorageGet = key => { try { return window.localStorage.getItem(key); } catch { return null; } };
  const safeStorageSet = (key, value) => { try { window.localStorage.setItem(key, value); return true; } catch { return false; } };
  const safeStorageRemove = key => { try { window.localStorage.removeItem(key); return true; } catch { return false; } };
  const state = { token:safeStorageGet('sovli_admin_token')||safeStorageGet('sovli_token')||'', users:[], userOffset:0, userTotal:0, userHasMore:false, userQuery:'', selectedUserId:'', matches:[], matchSearch:'', reports:[], reportFilter:'all', reportQuery:'', tickets:[], ticketFilter:'all', ticketQuery:'', activeTicketId:'', socialLinks:[], tasks:[], submissions:[], monetization:null, inspectMatchId:'', matchesTimer:null };
  const esc = v => String(v==null?'':v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = v => Number(v||0).toLocaleString('ru-RU');
  const date = v => v ? new Date(v).toLocaleString('ru-RU',{dateStyle:'medium',timeStyle:'short'}) : '—';
  const dateInput = v => { if(!v)return ''; const d=new Date(v); if(Number.isNaN(d.getTime()))return ''; return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
  function applyOwnerTheme(theme){
    const selected = theme || safeStorageGet('solvi_owner_theme') || 'dark';
    document.documentElement.dataset.theme = selected;
    safeStorageSet('solvi_owner_theme', selected);
    const button = $('#themeToggleButton');
    if (button) { button.textContent = selected === 'dark' ? '☀ Светлая тема' : '☾ Тёмная тема'; button.setAttribute('aria-label', selected === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'); button.title = selected === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'; }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', selected === 'dark' ? '#10131c' : '#f4f5fb');
  }
  function toast(message){ const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),3200); }
  async function api(url,options){
    const opts=options||{};
    const response=await fetch(url,{...opts,cache:opts.cache||(String(opts.method||'GET').toUpperCase()==='GET'?'no-store':'default'),headers:{'Content-Type':'application/json',...(state.token?{Authorization:'Bearer '+state.token}:{}),...(opts.headers||{})}});
    const body=await response.json().catch(()=>({}));
    if(!response.ok){ if(response.status===401)clearAuth(); throw new Error(body.error||('HTTP '+response.status)); }
    return body;
  }
  function clearAuth(){state.token='';safeStorageRemove('sovli_admin_token');$('#dashboardView').hidden=true;$('#loginView').hidden=false;$('#logoutButton').hidden=true;}
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
      role:['Изменить роль','Это статусная отметка в профиле. Роли модератора и разработчика не дают доступ к панели владельца, платежам или управлению балансом. Эти права есть только у владельца.','Сохранить','<label>Роль<select name="role"><option value="member">Участник</option><option value="moderator">Модератор</option><option value="developer">Разработчик</option></select></label>'],
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
    try{await api('/api/admin/overview');$('#loginView').hidden=true;$('#dashboardView').hidden=false;$('#logoutButton').hidden=false;safeStorageSet('sovli_admin_token',state.token);setConnection('Доступ подтверждён');await loadOverview();showTab('overview',false);return true;}
    catch(error){setConnection('Нужен вход',false);if(/только владельцу|не назначен владельцем/i.test(error.message))$('#loginError').textContent=error.message;return false;}
  }
  async function loadCleanupPreview(){
    const root=$('#cleanupPreview');root.textContent='Проверяем сохраняемые аккаунты и список остальных пользователей…';root.dataset.ready='';$('#executeCleanupButton').disabled=true;
    try{const r=await api('/api/admin/users/cleanup-preview');root.replaceChildren();const keep=document.createElement('p');keep.textContent='Останутся: '+r.keep.map(x=>x.username+' ('+x.role+')').join(' и ');const count=document.createElement('p');count.textContent='Будет удалено аккаунтов: '+num(r.deleteCount);const list=document.createElement('ul');(r.deletePreview||[]).forEach(x=>{const li=document.createElement('li');li.textContent=x.username+' · '+x.public_id+' · '+(x.account_type==='guest'?'гость':x.role);list.append(li);});root.append(keep,count,list);root.dataset.ready='1';$('#cleanupConfirmation').value='';toast('Список проверен. Просмотри его перед удалением.');}
    catch(error){root.textContent=error.message;root.dataset.ready='';toast(error.message);}
  }
  async function executeCleanup(){
    if($('#cleanupPreview').dataset.ready!=='1')return toast('Сначала проверь список.');
    if($('#cleanupConfirmation').value.trim()!=='УДАЛИТЬ ВСЕ КРОМЕ SLABENK1Y И МАШИ')return toast('Фраза подтверждения не совпадает.');
    const button=$('#executeCleanupButton');button.disabled=true;
    try{const r=await api('/api/admin/users/cleanup',{method:'POST',body:JSON.stringify({confirmationPhrase:$('#cleanupConfirmation').value.trim()})});$('#cleanupPreview').dataset.ready='';$('#cleanupPreview').textContent='Удалено аккаунтов: '+num(r.deletedCount)+'. Сохранены: '+r.preserved.join(' и ')+'. Роль Маши: Участник.';$('#cleanupConfirmation').value='';await Promise.all([loadUsers('',false),loadOverview()]);toast('Очистка аккаунтов выполнена.');}
    catch(error){toast(error.message);button.disabled=false;}
  }
  async function sendOwnerMessage(event){
    event.preventDefault();const targetMode=$('#ownerMessageTarget').value,body=$('#ownerMessageBody').value.trim(),button=$('#ownerMessageSendButton');
    if(body.length<2)return toast('Сообщение слишком короткое.');button.disabled=true;$('#ownerMessageResult').textContent='Отправляем…';
    try{const payload={targetMode,subject:$('#ownerMessageSubject').value.trim(),body};if(targetMode==='user')payload.recipient=$('#ownerMessageRecipient').value.trim();const result=await api('/api/admin/messages',{method:'POST',body:JSON.stringify(payload)});$('#ownerMessageResult').textContent='Сообщение сохранено для получателей: '+num(result.recipientCount)+'.';$('#ownerMessageBody').value='';toast('Сообщение отправлено.');}
    catch(error){$('#ownerMessageResult').textContent=error.message;toast(error.message);}finally{button.disabled=false;}
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
      const actions=u.owner?'<p class="hint">Управляющие действия для аккаунта владельца отключены.</p>':'<div class="detail-actions"><button class="primary" data-user-action="tokens">± Токены</button><button class="secondary" data-user-action="vip">VIP / Premium</button><button class="secondary" data-user-action="personalPromo">🎁 Личное промо</button><button class="secondary" data-user-action="starterPack" '+(u.starterGifted?'disabled':'')+'>Стартовый подарок</button><button class="secondary" data-user-action="role">Роль</button>'+(u.suspendedUntil&&new Date(u.suspendedUntil)>new Date()?'<button class="primary" data-user-action="unsuspend">Снять блокировку</button>':'<button class="danger" data-user-action="suspend">Заблокировать</button>')+'<button class="secondary" data-user-action="logout">Завершить сессии</button><button class="secondary" data-user-action="paidMembership">Подтвердить оплату</button><button class="danger" data-user-action="delete">Удалить аккаунт навсегда</button><p class="hint">Удаление необратимо: исчезнут профиль, переписки, медиа, токены, покупки и связанные данные.</p></div>';
      $('#userDetailContent').innerHTML='<div class="user-detail-hero"><div class="detail-avatar">'+(u.owner?'👑':esc(u.avatar||'✦'))+'</div><div><strong>'+esc(u.username)+'</strong><span>'+esc(u.role)+' · '+esc(u.subscriptionTier||'free')+'</span><small>Регистрация: '+date(u.createdAt)+'</small><small>Последний вход: '+date(s.lastLoginAt)+'</small></div></div><div class="detail-balance"><div><span>Баланс</span><strong>'+num(u.tokens)+' ✦</strong></div><div><span>Привилегия</span><strong>'+esc(u.subscriptionTier||'free')+'</strong><small>до '+date(u.subscriptionExpiresAt)+'</small></div><div><span>Доступ</span><strong>'+(u.suspendedUntil&&new Date(u.suspendedUntil)>new Date()?'Ограничен':'Активен')+'</strong><small>'+esc(u.suspensionReason||'')+'</small></div></div><section class="detail-section"><h3>Действия с аккаунтом</h3>'+actions+'</section><section class="detail-section"><h3>Статистика</h3><div class="detail-stat-grid">'+stats.map(x=>'<div><span>'+esc(x[0])+'</span><strong>'+esc(x[1])+'</strong></div>').join('')+'</div></section><section class="detail-section"><h3>Персональные промокоды</h3><div class="mini-list">'+promoRows+'</div></section><section class="detail-section"><h3>Последние операции с токенами</h3><div class="mini-list">'+tx+'</div></section><section class="detail-section"><h3>Модерация</h3><div class="mini-list">'+mod+'</div></section>';
    }catch(error){$('#userDetailContent').innerHTML='<p class="error">'+esc(error.message)+'</p>';}
  }
  async function runUserAction(action){
    const id=state.selectedUserId;if(!id)return;
    if(action==='delete'){
      const expectedUsername=String($('#userDetailTitle').textContent||'').trim();
      if(!expectedUsername)return toast('Не удалось определить никнейм аккаунта.');
      const confirmation=await confirmDialog({
        title:'Удалить аккаунт навсегда?',
        message:'Будут удалены профиль, переписки, фотографии, голосовые сообщения, баланс, покупки, сессии и связанные данные. Это действие нельзя отменить. Введи никнейм «'+expectedUsername+'» для подтверждения.',
        input:true,
        confirmText:'Удалить навсегда',
        danger:true
      });
      if(confirmation===null)return;
      if(confirmation!==expectedUsername)return toast('Никнейм не совпадает. Аккаунт не удалён.');
      await api('/api/admin/users/'+encodeURIComponent(id),{method:'DELETE',body:JSON.stringify({confirmationUsername:confirmation})});
      $('#userDetailModal').hidden=true;state.selectedUserId='';
      await Promise.all([loadUsers(state.userQuery,false),loadOverview()]);
      return toast('Аккаунт «'+expectedUsername+'» полностью удалён.');
    }
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
  async function loadMonetization(){
    const r=await api('/api/admin/monetization');state.monetization=r;
    const s=r.stats||{};
    const pw=r.paymentwall||{};
    const manualOrders=r.manualStoreOrders||[];
    $('#manualStoreOrders').innerHTML=manualOrders.map(o=>{
       const accepted=Boolean(o.accepted_at);
       const status=o.status==='paid'?'оплачено и выдано':o.status==='cancelled'?'отменена':accepted?'диалог открыт · ожидается оплата':'ожидает принятия';
       const actions=o.status!=='pending'?'':accepted
         ?'<button class="primary mini" type="button" data-manual-order-action="paid" data-manual-order-id="'+esc(o.id)+'">Оплата получена · выдать</button><button class="danger mini" type="button" data-manual-order-action="cancel" data-manual-order-id="'+esc(o.id)+'">Отклонить</button>'
         :'<button class="primary mini" type="button" data-manual-order-action="accept" data-manual-order-id="'+esc(o.id)+'">Принять заявку · открыть диалог</button><button class="danger mini" type="button" data-manual-order-action="cancel" data-manual-order-id="'+esc(o.id)+'">Отклонить</button>';
       return '<article class="growth-row manual-order-row"><div><strong>'+esc(o.item_name)+' · '+(Number(o.amount_minor)/100).toFixed(2)+' '+esc(o.currency)+'</strong><small>'+esc(o.username)+' · '+esc(o.public_id)+' · '+esc(o.account_type==='guest'?'гость':'аккаунт')+'</small><small>Заявка '+esc(o.id)+' · '+date(o.created_at)+(o.telegram_username?' · @'+esc(o.telegram_username):'')+'</small><small>Статус: '+esc(status)+'</small></div><div class="inline-actions">'+actions+'</div></article>';
     }).join('')||'<p class="hint">Заявок на покупку пока нет.</p>';
     $('#monetizationStats').innerHTML=stat('Токенов в обороте',num(s.tokenSupply))+stat('Заработано сегодня',num(s.earnedToday)+' ✦')+stat('Покупок за токены',num(s.storeSales))+stat('Заявки ожидают оплаты',num(r.manualStoreStats?.pending||0))+stat('Выдано вручную',num(r.manualStoreStats?.paid||0),'Подтверждённых заявок')+stat('Telegram-бот',r.telegramBotConfigured?'Подключён':'Не настроен',r.telegramOwnerConnected?'Уведомления владельцу включены':'Заявки видны в панели');
    const names=new Map((r.products||[]).map(p=>[p.id,p.name]));
    $('#monetizationSales').innerHTML=(r.salesByItem||[]).map(x=>'<div class="detail-row"><span>'+esc(names.get(x.item_id)||x.item_id)+'</span><strong>'+num(x.sales)+' покупок · '+num(x.tokens)+' ✦</strong></div>').join('')||'<p class="hint">Покупок пока нет.</p>';
    const recent=(r.paymentwallRecent||[]).map(x=>'<div class="detail-row"><span>Paymentwall · '+esc(x.username)+' · '+num(x.token_amount)+' ✦</span><strong>'+esc(x.status==='reversed'?'Возврат':'Зачислено')+' · '+date(x.created_at)+'</strong></div>');
    const legacy=(r.payments||[]).map(x=>'<div class="detail-row"><span>'+esc(x.provider)+' · '+esc(x.currency)+'</span><strong>'+num(x.count)+' · '+(Number(x.amount_minor)/100).toFixed(2)+' '+esc(x.currency)+'</strong></div>');
    const direct=(r.cashStoreRecent||[]).map(x=>'<div class="detail-row"><span>Digital Goods · '+esc(x.username)+' · '+esc(names.get(x.item_id)||x.item_id)+'</span><strong>'+(Number(x.amount_minor)/100).toFixed(2)+' '+esc(x.currency)+' · '+esc(x.status==='reversed'?'Возврат':x.status==='paid'?'Оплачено':'Ожидает')+'</strong></div>');
    $('#monetizationPayments').innerHTML=recent.concat(direct,legacy).join('')||'<p class="hint">История прямых платёжных шлюзов здесь отдельно; ручные заявки и выдача отображаются ниже.</p>';
    $('#monetizationProducts').innerHTML=(r.products||[]).map(p=>'<article class="growth-row" data-product-row="'+esc(p.id)+'"><div><strong>'+esc(p.name)+'</strong><small>'+esc(p.category)+' · базовая цена '+num(p.basePrice)+' ✦'+(p.bundleOnly?' · предмет фирменного набора':'')+'</small><small>'+(p.tokenEnabled?'Покупка за ✦ включена':'Покупка за ✦ выключена')+' · '+(p.cashEnabled?'Денежная покупка: '+(Number(p.cashPriceMinor)/100).toFixed(2)+' '+esc(p.cashCurrency):'Денежная цена не задана')+'</small></div><div class="inline-actions"><label class="hint">Цена ✦ <input class="search-input" type="number" min="0" max="10000000" step="1" data-product-price value="'+num(p.price).replace(/\s/g,'')+'" style="width:90px"></label><label class="hint"><input type="checkbox" data-product-enabled '+(p.tokenEnabled?'checked':'')+'> За токены</label><button class="secondary mini" type="button" data-save-product="'+esc(p.id)+'">Сохранить ✦</button><label class="hint">Денежная цена <input class="search-input" type="number" min="0.30" max="1000000" step="0.01" data-cash-price value="'+(p.cashPriceMinor?(Number(p.cashPriceMinor)/100).toFixed(2):'')+'" placeholder="пусто = только ✦" style="width:110px"></label><label class="hint">Валюта<select class="search-input" data-cash-currency><option value="RUB" '+(p.cashCurrency==='RUB'?'selected':'')+'>RUB ₽</option><option value="EUR" '+(p.cashCurrency==='EUR'?'selected':'')+'>EUR €</option><option value="USD" '+(p.cashCurrency==='USD'?'selected':'')+'>USD $</option></select></label><button class="secondary mini" type="button" data-save-cash-price="'+esc(p.id)+'">Сохранить цену</button></div></article>').join('')||'<p class="empty-state">Каталог пуст.</p>';
    $('#monetizationAdStats').innerHTML=(r.adStats||[]).map(x=>stat('Рекламные кампании · '+x.currency,num(x.campaigns),num(x.impressions)+' показов · '+num(x.clicks)+' переходов · оплачено '+(Number(x.booked_minor)/100).toFixed(2)+' '+x.currency)).join('')||stat('Рекламные кампании','0','Пока нет размещений');
    $('#adCampaignList').innerHTML=(r.adCampaigns||[]).map(x=>'<article class="growth-row" data-ad-row="'+esc(x.id)+'"><div><strong>'+esc(x.title)+' · '+esc(x.sponsor_name)+'</strong><small>'+esc(x.placement==='home'?'Главная страница':'Магазин')+' · '+esc(x.payment_status==='paid'?'Оплачено':x.payment_status==='comped'?'Без оплаты':'Ожидает оплаты')+' · '+esc(x.status==='active'?'Показывается':x.status==='ended'?'Завершена':'На паузе')+' · '+(Number(x.price_minor)/100).toFixed(2)+' '+esc(x.currency)+'</small><small>'+num(x.impressions)+' показов · '+num(x.clicks)+' переходов · '+esc(x.target_url)+'</small></div><div class="inline-actions">'+(x.payment_status==='unpaid'?'<button class="primary mini" type="button" data-ad-paid-launch="'+esc(x.id)+'">Оплачено · запустить</button><button class="secondary mini" type="button" data-ad-free-launch="'+esc(x.id)+'">Бесплатно · опубликовать</button>':'<button class="secondary mini" type="button" data-ad-unpay="'+esc(x.id)+'">Снять оплату</button>')+(x.status==='active'?'<button class="secondary mini" type="button" data-ad-toggle="'+esc(x.id)+'" data-active="1">Пауза</button>':'<button class="secondary mini" type="button" data-ad-toggle="'+esc(x.id)+'" data-active="0" '+(x.payment_status==='unpaid'?'disabled':'')+'>Запустить</button>')+'<button class="danger mini" type="button" data-ad-delete="'+esc(x.id)+'">Удалить</button></div></article>').join('')||'<p class="empty-state">Рекламных кампаний пока нет.</p>';
  }
  $('#adCampaignForm').addEventListener('submit',async e=>{
    e.preventDefault();const button=e.currentTarget.querySelector('button[type="submit"]');button.disabled=true;$('#adCampaignMessage').textContent='';
    try{
      const price=Math.round(Number($('#adPrice').value)*100);
      if(!Number.isSafeInteger(price)||price<0)return toast('Проверь цену размещения.');
      const placement=$('#adPlacement').value;
      const payload={title:$('#adTitle').value.trim(),sponsorName:$('#adSponsor').value.trim(),body:$('#adBody').value.trim(),targetUrl:$('#adTargetUrl').value.trim(),placement,priceMinor:price,currency:$('#adCurrency').value,startsAt:$('#adStartsAt').value?new Date($('#adStartsAt').value).toISOString():undefined,endsAt:$('#adEndsAt').value?new Date($('#adEndsAt').value).toISOString():undefined};
      await api('/api/admin/ad-campaigns',{method:'POST',body:JSON.stringify(payload)});
      e.currentTarget.reset();$('#adPrice').value='25.00';$('#adPlacement').value='home';await loadMonetization();
      toast(price===0?'Бесплатное объявление опубликовано на '+(placement==='home'?'главной странице':'странице магазина')+'.':'Реклама создана. Отметь оплату и нажми «Оплачено · запустить», либо опубликуй бесплатно для проверки.');
    }catch(err){$('#adCampaignMessage').textContent=err.message;}finally{button.disabled=false;}
  });
  $('#adCampaignList').addEventListener('click',async e=>{
    const paidLaunch=e.target.closest('[data-ad-paid-launch]'),freeLaunch=e.target.closest('[data-ad-free-launch]');
    const unpay=e.target.closest('[data-ad-unpay]'),toggle=e.target.closest('[data-ad-toggle]'),del=e.target.closest('[data-ad-delete]');
    const id=paidLaunch?.dataset.adPaidLaunch||freeLaunch?.dataset.adFreeLaunch||unpay?.dataset.adUnpay||toggle?.dataset.adToggle||del?.dataset.adDelete;if(!id)return;
    try{
      if(del){if(!await confirmDialog({title:'Удалить рекламу?',message:'Кампания и её статистика будут удалены.',confirmText:'Удалить',danger:true}))return;await api('/api/admin/ad-campaigns/'+encodeURIComponent(id),{method:'DELETE'});}
      else if(paidLaunch){
        if(!await confirmDialog({title:'Подтвердить оплату и запустить?',message:'Нажимай только если рекламодатель действительно оплатил размещение.',confirmText:'Оплата получена · запустить'}))return;
        await api('/api/admin/ad-campaigns/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({paymentStatus:'paid',status:'active'})});
      }
      else if(freeLaunch){
        if(!await confirmDialog({title:'Опубликовать бесплатно?',message:'Объявление будет помечено как бесплатное и сразу станет видно пользователям на выбранной площадке.',confirmText:'Опубликовать бесплатно'}))return;
        await api('/api/admin/ad-campaigns/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({paymentStatus:'comped',status:'active'})});
      }
      else if(unpay)await api('/api/admin/ad-campaigns/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({paymentStatus:'unpaid',status:'paused'})});
      else if(toggle)await api('/api/admin/ad-campaigns/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status:toggle.dataset.active==='1'?'paused':'active'})});
      await loadMonetization();toast(del?'Кампания удалена.':paidLaunch?'Оплата отмечена, реклама запущена.':freeLaunch?'Бесплатная реклама опубликована.':'Статус рекламной кампании обновлён.');
    }catch(err){toast(err.message);}
  });
  $('#manualStoreOrders').addEventListener('click',async e=>{
    const button=e.target.closest('[data-manual-order-action]');if(!button)return;
    const id=button.dataset.manualOrderId,action=button.dataset.manualOrderAction;
    if(action==='accept'&&!await confirmDialog({title:'Принять заявку?',message:'После принятия покупатель сможет писать тебе в Telegram, а его сообщения будут пересылаться владельцу. Выдачи товара пока не будет.',confirmText:'Принять и открыть диалог'}))return;
    if(action==='paid'&&!await confirmDialog({title:'Подтвердить оплату?',message:'Сначала проверь фактическое поступление денег. После подтверждения товар автоматически попадёт в инвентарь пользователя.',confirmText:'Оплата получена · выдать'}))return;
    if(action==='cancel'&&!await confirmDialog({title:'Отклонить заявку?',message:'Товар не будет выдан. Убедись, что оплаты не было или вопрос согласован с покупателем.',confirmText:'Отклонить',danger:true}))return;
    button.disabled=true;
    try{await api('/api/admin/manual-store-orders/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({action})});await loadMonetization();toast(action==='accept'?'Заявка принята, диалог открыт.':action==='paid'?'Оплата подтверждена, товар выдан.':'Заявка отменена.');}
    catch(err){toast(err.message);button.disabled=false;}
  });
  $('#monetizationProducts').addEventListener('click',async e=>{
    const cash=e.target.closest('[data-save-cash-price]');
    const button=e.target.closest('[data-save-product]');
    const target=cash||button;if(!target)return;
    const row=target.closest('[data-product-row]');target.disabled=true;
    try{
      if(cash){
        const raw=row.querySelector('[data-cash-price]').value.trim();
        const currency=row.querySelector('[data-cash-currency]').value;
        if(!raw){
          await api('/api/admin/store/'+encodeURIComponent(cash.dataset.saveCashPrice)+'/cash-price',{method:'DELETE'});
          await loadMonetization();toast('Денежная цена очищена. Осталась покупка за токены.');
        }else{
          const priceMinor=Math.round(Number(raw)*100);
          if(!Number.isSafeInteger(priceMinor)||priceMinor<30||priceMinor>100000000)return toast('Денежная цена должна быть от 0,30 до 1 000 000.');
          await api('/api/admin/store/'+encodeURIComponent(cash.dataset.saveCashPrice)+'/cash-price',{method:'PATCH',body:JSON.stringify({priceMinor,currency,enabled:true})});
          await loadMonetization();toast('Денежная цена сохранена, отдельная покупка включена.');
        }
      }else{
        const price=Number(row.querySelector('[data-product-price]').value);const enabled=row.querySelector('[data-product-enabled]').checked;
        if(!Number.isSafeInteger(price)||price<0||price>10000000)return toast('Цена должна быть целым числом от 0 до 10 000 000.');
        await api('/api/admin/store/'+encodeURIComponent(button.dataset.saveProduct)+'/price',{method:'PATCH',body:JSON.stringify({price,enabled})});
        await loadMonetization();toast('Цена за токены обновлена.');
      }
    }catch(err){toast(err.message);}finally{target.disabled=false;}
  });
  async function loadAudit(){const r=await api('/api/admin/audit');$('#auditList').textContent=(r.entries||[]).map(x=>date(x.created_at)+'  '+x.action+'  '+(x.target_id||'')+'\n'+JSON.stringify(x.details||{})).join('\n\n')||'Журнал пока пуст.';}
  function showTab(name,load){
    if(!document.querySelector('[data-page="'+name+'"]'))name='overview';
    document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
    document.querySelectorAll('[data-page]').forEach(p=>p.hidden=p.dataset.page!==name);
    if(state.matchesTimer){clearInterval(state.matchesTimer);state.matchesTimer=null;}
    const loaders={overview:loadOverview,users:()=>loadUsers(state.userQuery,false),messages:()=>{},promos:loadPromos,monetization:loadMonetization,dialogs:loadMatches,reports:loadReports,tickets:loadTickets,growth:loadGrowth,audit:loadAudit};
    if(load!==false)Promise.resolve(loaders[name]()).catch(err=>toast(err.message));
    if(name==='dialogs')state.matchesTimer=setInterval(()=>{if(!document.hidden&&!$('#dashboardView').hidden)loadMatches().catch(err=>toast(err.message));},15000);
    else if(name==='overview')state.matchesTimer=setInterval(()=>{if(!document.hidden&&!$('#dashboardView').hidden)loadOverview().catch(err=>toast(err.message));},15000);
    else if(name==='users')state.matchesTimer=setInterval(()=>{if(!document.hidden&&!$('#dashboardView').hidden)loadUsers(state.userQuery,false).catch(err=>toast(err.message));},20000);
  }

  document.addEventListener('visibilitychange',()=>{
    if(document.hidden||$('#dashboardView').hidden)return;
    const active=document.querySelector('[data-tab].active')?.dataset.tab||'overview';
    if(active==='overview')loadOverview().catch(err=>toast(err.message));
    else if(active==='users')loadUsers(state.userQuery,false).catch(err=>toast(err.message));
    else if(active==='dialogs')loadMatches().catch(err=>toast(err.message));
  });

  applyOwnerTheme();
  $('#themeToggleButton').addEventListener('click',()=>applyOwnerTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('#loginForm').addEventListener('submit',async e=>{
    e.preventDefault();$('#loginError').textContent='';setConnection('Входим…');const b=e.currentTarget.querySelector('button[type="submit"]');b.disabled=true;
    try{const r=await api('/api/auth/login',{method:'POST',body:JSON.stringify({username:$('#loginName').value.trim(),password:$('#loginPassword').value,accessCode:$('#loginInvite').value.trim()})});state.token=r.token;safeStorageSet('sovli_admin_token',state.token);if(!await verifyOwner())throw new Error('Этот аккаунт не назначен владельцем. Проверь OWNER_PUBLIC_ID.');await loadStoreItems();toast('Добро пожаловать в панель владельца.');}
    catch(err){$('#loginError').textContent=err.message;setConnection('Не авторизован',false);}finally{b.disabled=false;}
  });
  $('#logoutButton').addEventListener('click',()=>{clearAuth();setConnection('Выход выполнен');});
  $('#refreshAllButton').addEventListener('click',refreshAll);
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
  document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.go)));
  $('#userSearchForm').addEventListener('submit',e=>{e.preventDefault();loadUsers($('#userSearchInput').value.trim(),false).catch(err=>toast(err.message));});
  $('#previewCleanupButton').addEventListener('click',loadCleanupPreview);
  $('#cleanupConfirmation').addEventListener('input',()=>{$('#executeCleanupButton').disabled=$('#cleanupPreview').dataset.ready!=='1'||$('#cleanupConfirmation').value.trim()!=='УДАЛИТЬ ВСЕ КРОМЕ SLABENK1Y И МАШИ';});
  $('#executeCleanupButton').addEventListener('click',executeCleanup);
  $('#ownerMessageTarget').addEventListener('change',()=>{$('#ownerMessageRecipientWrap').hidden=$('#ownerMessageTarget').value!=='user';});
  $('#ownerMessageForm').addEventListener('submit',sendOwnerMessage);
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
  $('#refreshMonetizationButton').addEventListener('click',()=>loadMonetization().catch(err=>toast(err.message)));
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