'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const DEFAULT_AVATARS = ['🪐','🌙','🦊','🐼','🐸','🦉','🐳','🦋','🐙','🌵','🍀','🧩'];
const STICKER_PACKS = {
  'stickers-night-owl': ['✨','🌙','🚀','🫶','👀','🫡','🤝','💫'],
  'stickers-sausage': ['🌭','🐭','🧀','😵‍💫','🥨','💨'],
  'stickers-chaos': ['🤪','🫠','🫨','💥','🙃','🌀'],
  'stickers-food': ['🍔','🍟','🍕','🌮','🍩','🥤'],
  'stickers-sausage-mouse': ['🐭','🌭','🧀','😳','🏃','💨','👑','🥹'],
  'stickers-deep-sea': ['🐠','🐙','🪼','🐬','🦀','🐚']
};
const VIP_STICKERS = ['👑','💎','🪄','🌟','🫶','🚀','🦋','✨'];
const PREMIUM_STICKERS = ['🪩','🌌','🦄','🪽','🌠','🔮','💫','🪐'];
function readStoredList(key) { try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
const state = {
  token: localStorage.getItem('sovli_token') || localStorage.getItem('orbit_token') || '',
  user: null,
  authRestoring: false,
  config: { languages: [], interests: [], avatars: [], matchingEnabled: true, publicMode: false },
  settings: { theme: 'system', sounds: true, soundVolume: 35, messageScale: 'normal', reducedMotion: false, enterToSend: true, compactChat: false, browserNotifications: false },
  soundContext: null,
  settingsSaveTimer: null,
  socket: null,
  activeMatch: null,
  messages: [],
  outbox: [],
  selectedLanguages: readStoredList('sovli_languages'),
  selectedInterests: readStoredList('sovli_interests'),
  selectedAvatar: null,
  authMode: 'login',
  searching: false,
  searchStartedAt: 0,
  searchInterval: null,
  typingTimer: null,
  toastTimer: null,
  mediaUrls: new Map(),
  mediaLoading: new Set(),
  mediaRecorder: null,
  voiceStream: null,
  voiceChunks: [],
  voiceBlob: null,
  voicePreviewUrl: null,
  voiceStartedAt: 0,
  voiceTimer: null,
  discardVoice: false,
  replyTarget: null,
  storeCategory: 'Все',
  storeCollectionOnly: false,
  storeCollectionFilter: '',
  storeSearch: '',
  storeData: null,
  favorites: [],
  blockedUsers: [],
  tokenHistoryLoaded: false
};

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function showToast(message, duration = 2800) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

function confirmStorePurchase({ title, description, price, balance, confirmLabel = 'Купить' }) {
  const modal = $('#purchaseConfirmModal');
  const cost = Math.max(0, Number(price) || 0);
  const wallet = Math.max(0, Number(balance) || 0);
  const enough = wallet >= cost;
  $('#purchaseConfirmTitle').textContent = title;
  $('#purchaseConfirmDescription').textContent = description || 'Покупка навсегда останется в твоём инвентаре.';
  $('#purchaseConfirmPrice').textContent = `${cost.toLocaleString('ru-RU')} ✦`;
  $('#purchaseConfirmBalance').textContent = `${wallet.toLocaleString('ru-RU')} ✦`;
  $('#purchaseConfirmShortfall').hidden = enough;
  $('#purchaseConfirmShortfall').textContent = `Не хватает ${(cost - wallet).toLocaleString('ru-RU')} токенов. Продолжай общаться, чтобы заработать их.`;
  const confirm = $('#purchaseConfirmButton');
  confirm.disabled = !enough;
  confirm.textContent = enough ? confirmLabel : 'Не хватает токенов';
  modal.hidden = false;
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      modal.hidden = true;
      $('#purchaseCancelButton').onclick = null;
      confirm.onclick = null;
      modal.onclick = null;
      window.removeEventListener('keydown', onKeyDown);
      resolve(value);
    };
    const onKeyDown = event => { if (event.key === 'Escape') finish(false); };
    $('#purchaseCancelButton').onclick = () => finish(false);
    confirm.onclick = () => finish(true);
    modal.onclick = event => { if (event.target === modal) finish(false); };
    window.addEventListener('keydown', onKeyDown);
  });
}

function applyEquipped(equipped = {}) {
  const root = document.documentElement;
  root.dataset.storeTheme = equipped.theme || equipped.wallpaper || 'theme-light';
  delete root.dataset.storeWallpaper;
  root.dataset.storeBubble = equipped.bubble || '';
  root.dataset.storeFrame = equipped.frame || '';
  root.dataset.storeSound = equipped.sound || '';
  root.dataset.storeStickers = equipped.stickers || '';
  root.dataset.storeTitle = equipped.title || '';
  applyTheme();
}
function createStorePreview(item) {
  const preview = document.createElement('div');
  preview.className = `store-item-preview preview-${item.preview}`;
  const safeValue = String(item.value || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const scene = document.createElement('div');
  scene.className = `store-preview-scene scene-${item.slot}`;
  if (item.slot === 'theme' || item.slot === 'wallpaper') {
    const windowCard = document.createElement('div'); windowCard.className = 'preview-window-card';
    const top = document.createElement('div'); top.className = 'preview-window-top';
    ['one','two','three'].forEach(name => { const dot = document.createElement('i'); dot.className = `preview-dot ${name}`; top.append(dot); });
    const lines = document.createElement('div'); lines.className = 'preview-window-lines';
    const bubbleA = document.createElement('span'); bubbleA.className = 'preview-line preview-line-a'; bubbleA.textContent = 'Привет!';
    const bubbleB = document.createElement('span'); bubbleB.className = 'preview-line preview-line-b'; bubbleB.textContent = 'Как дела?';
    lines.append(bubbleA, bubbleB); windowCard.append(top, lines); scene.append(windowCard);
  } else if (item.slot === 'bubble') {
    const left = document.createElement('span'); left.className = 'preview-chat-bubble preview-chat-in'; left.textContent = 'Привет';
    const right = document.createElement('span'); right.className = 'preview-chat-bubble preview-chat-out'; right.textContent = 'Привет! ✨';
    scene.append(left, right);
  } else if (item.slot === 'frame') {
    const avatar = document.createElement('span'); avatar.className = `preview-avatar preview-frame-${safeValue}`; avatar.textContent = '◉';
    const caption = document.createElement('span'); caption.className = 'preview-avatar-caption'; caption.textContent = 'Твой профиль';
    scene.append(avatar, caption);
  } else if (item.slot === 'sound') {
    const sound = document.createElement('div'); sound.className = 'preview-sound-bars';
    [16,28,40,22,34,14,31,20,12].forEach((height, index) => { const bar = document.createElement('i'); bar.style.setProperty('--bar-height', `${height}px`); bar.style.setProperty('--bar-delay', `${index * 0.08}s`); sound.append(bar); });
    const label = document.createElement('span'); label.className = 'preview-sound-caption'; label.textContent = 'Звук интерфейса'; scene.append(sound, label);
  } else if (item.slot === 'stickers') {
    const stickers = document.createElement('div'); stickers.className = 'preview-sticker-stack';
    (STICKER_PACKS[item.id] || ['🌙','✨','☕']).slice(0,3).forEach((symbol, index) => { const sticker = document.createElement('span'); sticker.textContent = symbol; sticker.style.setProperty('--sticker-shift', `${(1 - index) * 5}px`); sticker.style.setProperty('--sticker-rotate', `${(index - 1) * 9}deg`); stickers.append(sticker); });
    scene.append(stickers);
  } else if (item.slot === 'title') {
    const title = document.createElement('span'); title.className = 'preview-title-pill'; title.textContent = item.name; scene.append(title);
  } else {
    const fallback = document.createElement('span'); fallback.className = 'preview-title-pill'; fallback.textContent = 'SOVLI'; scene.append(fallback);
  }
  preview.append(scene);
  return preview;
}
const PREVIEW_THEME_PALETTES = {
  light: ['#f5f6fb','#ffffff','#26263d','#655de2','#eeedff','#e7e8f2'],
  dark: ['#1b1b2b','#29293d','#f1f0ff','#958cff','#393654','#34344c'],
  default: ['#f4f5fb','#ffffff','#27263d','#655de2','#eeedff','#e8e9f2'],
  aurora: ['#eaf5f5','#ffffff','#1e3d4c','#368b91','#d8f3ee','#c7e9e7'],
  sunset: ['#fff1ed','#ffffff','#593c4c','#d8757d','#ffe0d4','#f6c4ba'],
  midnight: ['#171827','#25263b','#f0efff','#8b7df0','#38334f','#333249'],
  candy: ['#fff0f7','#ffffff','#56334f','#d45f9c','#ffe0f0','#f6c3de'],
  arcade: ['#17172d','#242448','#f2efff','#4fd1c5','#34345d','#45426e'],
  space: ['#161a36','#22264b','#f1efff','#9c85ec','#39355f','#4c4779'],
  paper: ['#f3ead8','#fffaf0','#584c40','#a17e55','#efe1c5','#e3d1b0'],
  neon: ['#17182a','#22253d','#f4f2ff','#28c8db','#3a3d62','#493f75'],
  pixel: ['#20203c','#2e2d55','#f6f0ff','#a58ae8','#49416f','#5d4f8f'],
  cream: ['#f7f0e3','#fffdf7','#55483b','#bd9967','#f4e6cd','#e9d8b8'],
  clouds: ['#eaf4ff','#ffffff','#35465d','#6d9cce','#deedff','#cee0f5'],
  royal: ['#211b39','#30264d','#fff4db','#d4a74f','#59446f','#71518b'],
  ice: ['#e9f4fb','#ffffff','#334b61','#548eb7','#d8ebf8','#c4dfef'],
  sakura: ['#fff0f4','#ffffff','#62424f','#d98ba7','#ffe0e9','#f3c5d5'],
  mountain: ['#f0eee7','#ffffff','#45534c','#7f9b81','#e3e8dc','#d3ddcf'],
  cyber: ['#161d31','#222b48','#effaff','#49c5dd','#3a446c','#574e8a'],
  sea: ['#e6f5f7','#ffffff','#244e59','#35a1ab','#d1f0ee','#b5e4e1']
};
const PREVIEW_BUBBLES = {
  mint:['#bcebd9','#31594c'], berry:['#7850a6','#ffffff'], lilac:['#a68fea','#ffffff'],
  gold:['#dfc17a','#473818'], ocean:['#4d9eae','#ffffff'], rose:['#e89ab8','#5b3044'],
  citrus:['#cde77b','#35421e'], graphite:['#45465a','#ffffff']
};
const PREVIEW_FRAMES = ['orbit','comet','pixel','royal','flower','neon','sakura','glass'];
function previewNode(tag, className, textValue) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textValue !== undefined) node.textContent = textValue;
  return node;
}
function createLiveStorePreview(item) {
  const root = previewNode('div', 'store-live-preview');
  const effect = item.slot === 'wallpaper' ? 'theme' : (item.slot || 'theme');
  root.dataset.previewEffect = effect;
  root.dataset.previewValue = item.value || '';
  root.dataset.previewTier = item.tier || '';
  const palette = PREVIEW_THEME_PALETTES[item.value] || PREVIEW_THEME_PALETTES.default;
  ['--demo-bg','--demo-surface','--demo-ink','--demo-primary','--demo-soft','--demo-line'].forEach((key,index)=>root.style.setProperty(key,palette[index]));
  const bubble = PREVIEW_BUBBLES[item.value];
  if (bubble) {
    root.style.setProperty('--demo-bubble',bubble[0]);
    root.style.setProperty('--demo-bubble-ink',bubble[1]);
  } else {
    root.style.setProperty('--demo-bubble',palette[3]);
    root.style.setProperty('--demo-bubble-ink','#ffffff');
  }
  const shell=previewNode('div','store-live-shell');
  const rail=previewNode('aside','store-live-rail');
  rail.append(previewNode('strong','store-live-logo','s'));
  ['⌂','◌','♡','⚙'].forEach((symbol,index)=>rail.append(previewNode('span',index===1?'active':'',symbol)));
  const main=previewNode('div','store-live-main');
  const top=previewNode('div','store-live-topbar');
  const brand=previewNode('strong','store-live-brand','SOVLI');
  const topHint=previewNode('span','store-live-top-hint','ТВОЁ ПРОСТРАНСТВО');
  const topAvatar=previewNode('span','store-live-top-avatar','🪐');
  top.append(brand,topHint,topAvatar);
  const content=previewNode('div','store-live-content');
  const profile=previewNode('div','store-live-profile');
  const avatar=previewNode('div','store-live-avatar','🦊');
  const profileCopy=previewNode('div','store-live-profile-copy');
  profileCopy.append(previewNode('strong','','Алекс'),previewNode('span','','В сети'));
  profile.append(avatar,profileCopy);
  const profileBadge=previewNode('span','store-live-badge',item.slot==='membership'?(item.tier==='premium'?'PREMIUM':'VIP'):(item.slot==='title'?item.name:'Участник'));
  profile.append(profileBadge);
  const chat=previewNode('div','store-live-chat');
  const chatHead=previewNode('div','store-live-chat-head');
  chatHead.append(previewNode('span','','Диалог'),previewNode('small','',item.slot==='membership'?'Особый статус': 'Пример оформления'));
  const bubbles=previewNode('div','store-live-messages');
  bubbles.append(previewNode('span','store-live-incoming','Привет! Как тебе SOVLI?'));
  bubbles.append(previewNode('span','store-live-outgoing','Очень красиво ✨'));
  if(effect==='stickers'||effect==='membership'){
    const tray=previewNode('div','store-live-sticker-strip');
    const stickers=item.slot==='membership'
      ? (item.tier==='premium'?[...VIP_STICKERS.slice(0,2),...PREMIUM_STICKERS.slice(0,3)]:VIP_STICKERS.slice(0,5))
      : (STICKER_PACKS[item.id]||['🌙','✨','☕','🪐','🫶']);
    stickers.slice(0,5).forEach(symbol=>tray.append(previewNode('span','',symbol)));
    bubbles.append(tray);
  }
  if(effect==='sound'){
    const waveform=previewNode('div','store-live-wave');
    [10,19,28,14,23,34,17,27,12,21,30,15].forEach(h=>{
      const bar=previewNode('i');
      bar.style.height=`${h}px`;
      waveform.append(bar);
    });
    const play=previewNode('button','store-live-play','▶ Прослушать звук');
    play.type='button';
    play.addEventListener('click',()=>playUiSound(640));
    bubbles.append(waveform,play);
  }
  if(effect==='title'){
    bubbles.append(previewNode('span','store-live-title-pill',item.name));
  }
  chat.append(chatHead,bubbles,previewNode('div','store-live-composer','＋  Написать сообщение…'));
  content.append(profile,chat);
  main.append(top,content);
  shell.append(rail,main);
  root.append(shell);
  const caption=previewNode('div','store-live-preview-caption',
    effect==='theme'?'Так будет выглядеть весь интерфейс':
    effect==='bubble'?'Так будет выглядеть твоё сообщение':
    effect==='frame'?'Так будет выглядеть рамка профиля':
    effect==='stickers'?'Так будут выглядеть стикеры':
    effect==='sound'?'Нажми, чтобы услышать звук':
    effect==='title'?'Так увидят твой титул':
    item.tier==='premium'?'Премиум-профиль и специальные стикеры':'VIP-профиль и специальные стикеры');
  root.append(caption);
  return root;
}
function storePreviewPerks(item) {
  if(item.slot==='membership' && item.tier==='premium') return [
    'Золотой Premium-бейдж рядом с ником в чате и профиле',
    'Сияющая рамка и отдельное оформление карточки профиля',
    '8 эксклюзивных Premium-стикеров плюс весь VIP-набор',
    'Дополнительные быстрые фразы для начала разговора'
  ];
  if(item.slot==='membership') return [
    'Золотой VIP-бейдж рядом с ником в чате и профиле',
    'Золотой контур аватара в чате и карточке профиля',
    '8 эксклюзивных VIP-стикеров в панели отправки',
    'Дополнительные быстрые фразы для начала разговора'
  ];
  const perks={
    theme:['Меняется фон всего приложения','Обновляются панели, карточки и поля','Цвета чата и рабочей области подстраиваются под тему'],
    bubble:['Меняется цвет твоих исходящих сообщений','Входящие сообщения остаются нейтральными','Эффект виден в каждом новом диалоге'],
    frame:['Рамка появляется вокруг аватара в профиле','Такой же контур виден рядом с именем в чате','Само фото аватара не изменяется'],
    sound:['Можно прослушать короткий пример прямо здесь','Звук используется для событий интерфейса','Громкость и отключение звуков остаются в настройках'],
    stickers:['Здесь показаны реальные стикеры из набора','Набор добавляется в панель отправки сообщений','Уже отправленные сообщения не меняются'],
    title:['Титул показывается рядом с именем в чате','Он также отображается в собственной карточке','Титул можно снять через инвентарь']
  };
  return perks[item.slot] || ['Посмотри на внешний вид предмета в интерфейсе SOVLI','Предмет можно применить из инвентаря'];
}
function openStorePreview(item) {
  const modal = $('#storePreviewModal');
  const visual = $('#storePreviewCanvas');
  visual.replaceChildren(createLiveStorePreview(item));
  $('#storePreviewBadge').textContent = item.category || (item.tier === 'premium' ? 'PREMIUM' : 'VIP');
  $('#storePreviewTitle').textContent = item.name || 'Предпросмотр';
  $('#storePreviewDescription').textContent = item.description || 'Посмотри, как предмет будет выглядеть в SOVLI.';
  $('#storePreviewBenefit').textContent = item.slot==='membership'
    ? (item.tier==='premium'?'Всё из VIP, а также Premium-оформление и отдельный набор стикеров.':'Бейдж VIP, рамка аватара, VIP-стикеры и быстрые фразы.')
    : ({theme:'Тема меняет весь экран: не только образец, но и фон, панели и чат.',bubble:'В образце показано твоё исходящее сообщение с выбранным цветом.',frame:'Образец показывает рамку на аватаре в профиле и чате.',stickers:'В образце показаны настоящие эмодзи-стикеры из набора.',sound:'Нажми «Прослушать звук» внутри образца.',title:'Титул появится рядом с ником в чате и профиле.'}[item.slot] || 'Посмотри на предмет в макете приложения.');
  const list=$('#storePreviewPerks');
  list.replaceChildren();
  storePreviewPerks(item).forEach(line=>list.append(previewNode('li','',line)));
  $('#storePreviewPriceLabel').textContent=item.hours? 'Стоимость и срок' : 'Стоимость / статус';
  $('#storePreviewPrice').textContent=item.hours
    ? `${Number(item.price).toLocaleString('ru-RU')} ✦ · ${item.hours} ч (${item.hourlyRate} ✦/ч)`
    : (item.owned?(item.equipped?'Уже используется':'Уже в инвентаре'):`${Number(item.price||0).toLocaleString('ru-RU')} ✦`);
  modal.hidden = false;
}
function renderStore(data) {
  state.storeData = data;
  $('#storeBalance').textContent = Number(data.balance || 0).toLocaleString('ru-RU');
  const categories = $('#storeCategories');
  categories.replaceChildren();
  (data.categories || ['Все']).forEach(category => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `store-category${state.storeCategory === category ? ' active' : ''}`;
    button.textContent = category;
    button.addEventListener('click', () => { state.storeCategory = category; state.storeCollectionOnly = false; renderStore(data); });
    categories.append(button);
  });
  const collectionSelect = $('#storeCollectionSelect');
  if (collectionSelect) {
    const selected = state.storeCollectionFilter;
    collectionSelect.replaceChildren(new Option('Все коллекции', ''));
    (data.collections || []).forEach(collection => collectionSelect.add(new Option(`${collection.name} · ${collection.owned}/${collection.total}`, collection.name)));
    collectionSelect.value = selected;
  }
  const search = $('#storeSearchInput');
  if (search && search.value !== state.storeSearch) search.value = state.storeSearch;
  $('#storeInventoryButton').classList.toggle('active', state.storeCollectionOnly);
  $('#storeInventoryButton').textContent = state.storeCollectionOnly ? 'Весь каталог' : 'Только купленное';
  $('#storeEquippedSummary').replaceChildren();
  const slotLabels = { theme: 'Тема интерфейса', bubble: 'Сообщения', frame: 'Рамка', sound: 'Звук', stickers: 'Стикеры', title: 'Титул' };
  Object.entries(slotLabels).forEach(([slot, label]) => {
    const itemId = data.equipped?.[slot];
    const item = data.items.find(row => row.id === itemId);
    const chip = document.createElement('span'); chip.className = 'equipped-chip';
    chip.textContent = `${label}: ${item?.name || 'По умолчанию'}`;
    $('#storeEquippedSummary').append(chip);
  });
  const collectionsRoot = $('#storeCollections');
  collectionsRoot.replaceChildren();
  (data.collections || []).forEach(collection => {
    const card = document.createElement('button'); card.type = 'button';
    card.className = `collection-card${state.storeCollectionFilter === collection.name ? ' active' : ''}`;
    const title = document.createElement('strong'); title.textContent = collection.name;
    const progress = document.createElement('span'); progress.textContent = `${collection.owned} из ${collection.total} предметов`;
    const track = document.createElement('i'); const fill = document.createElement('b'); fill.style.width = `${collection.total ? Math.min(100, collection.owned / collection.total * 100) : 0}%`; track.append(fill);
    card.append(title, progress, track);
    card.addEventListener('click', () => { state.storeCollectionFilter = state.storeCollectionFilter === collection.name ? '' : collection.name; renderStore(data); });
    collectionsRoot.append(card);
  });
  const root = $('#storeItems'); root.replaceChildren();
  const query = state.storeSearch.trim().toLocaleLowerCase('ru-RU');
  const visible = data.items.filter(item => item.enabled !== false && (state.storeCategory === 'Все' || item.category === state.storeCategory) && (!state.storeCollectionOnly || item.owned) && (!state.storeCollectionFilter || item.collection === state.storeCollectionFilter) && (!query || `${item.name} ${item.description} ${item.collection}`.toLocaleLowerCase('ru-RU').includes(query)));
  if (!visible.length) { const empty = document.createElement('div'); empty.className = 'store-empty'; empty.textContent = state.storeCollectionOnly ? 'В этой категории пока нет купленных предметов.' : 'Ничего не найдено. Попробуй изменить фильтр.'; root.append(empty); }
  visible.forEach(item => {
    const card = document.createElement('article'); card.className = `store-item-card rarity-${String(item.rarity).toLowerCase()}`;
    const preview = createStorePreview(item);
    const meta = document.createElement('div'); meta.className = 'store-item-meta';
    const category = document.createElement('span'); category.className = 'store-item-category'; category.textContent = `${item.category} · ${item.rarity}`;
    const title = document.createElement('h3'); title.textContent = item.name;
    const description = document.createElement('p'); description.textContent = item.description;
    const collection = document.createElement('small'); collection.className = 'store-item-collection'; collection.textContent = `Коллекция: ${item.collection || 'SOVLI'}`;
    meta.append(category, title, description, collection);
    const footer = document.createElement('div'); footer.className = 'store-item-footer';
    const price = document.createElement('strong'); price.className = 'store-item-price'; price.textContent = item.owned ? (item.equipped ? 'Уже используется' : 'В коллекции') : `${Number(item.price).toLocaleString('ru-RU')} ✦`;
    const previewButton = document.createElement('button'); previewButton.type = 'button'; previewButton.className = 'store-preview-button'; previewButton.textContent = 'Предпросмотр';
    previewButton.addEventListener('click', () => openStorePreview(item));
    const action = document.createElement('button'); action.type = 'button'; action.className = 'button button-secondary store-action';
    if (item.equipped) action.textContent = 'Снять';
    else if (item.owned) action.textContent = 'Применить';
    else action.textContent = 'Купить';
    action.addEventListener('click', async () => {
      action.disabled = true;
      try {
        if (item.equipped) {
          const result = await api(`/api/store/equip/${encodeURIComponent(item.slot)}`, { method: 'DELETE' });
          applyEquipped(result.equipped); if (state.user) state.user.equipped = result.equipped;
          renderStickerPanel(); showToast(`Снято: ${item.name}.`);
        } else if (!item.owned) {
          const approved = await confirmStorePurchase({ title: `Купить «${item.name}»?`, description: item.description, price: item.price, balance: data.balance });
          if (!approved) { action.disabled = false; return; }
          const result = await api('/api/store/buy', { method: 'POST', body: JSON.stringify({ itemId: item.id }) });
          if (state.user) state.user.tokens = result.balance;
          showToast(`«${item.name}» добавлен в коллекцию.`);
        } else {
          const result = await api('/api/store/equip', { method: 'POST', body: JSON.stringify({ itemId: item.id }) });
          applyEquipped(result.equipped); if (state.user) state.user.equipped = result.equipped;
          renderStickerPanel(); showToast(`Применено: ${item.name}.`);
        }
        await loadStore();
      } catch (error) { showToast(error.message); action.disabled = false; }
    });
    footer.append(previewButton, price, action); card.append(preview, meta, footer); root.append(card);
  });
  const membershipRoot = $('#membershipOffers'); membershipRoot.replaceChildren();
  (data.memberships || []).forEach(pack => {
    const card = document.createElement('article'); card.className = `membership-card membership-${pack.tier}`;
    const label = document.createElement('span'); label.className = 'membership-kicker'; label.textContent = pack.tier === 'premium' ? 'МАКСИМАЛЬНЫЙ СТАТУС' : 'РАСШИРЕННЫЙ СТАТУС';
    const title = document.createElement('h3'); title.textContent = pack.name;
    const copy = document.createElement('p'); copy.textContent = pack.description;
    const rate = document.createElement('span'); rate.className='membership-rate'; rate.textContent=`${Number(pack.hourlyRate).toLocaleString('ru-RU')} ✦ за час`;
    const price = document.createElement('strong'); price.textContent = `${Number(pack.price).toLocaleString('ru-RU')} ✦`;
    const detail = document.createElement('small'); detail.className='membership-duration-note'; detail.textContent=`${pack.hours} ${pack.hours===1?'часа':'часа'} доступа · без скидок и скрытых коэффициентов`;
    const previewButton = document.createElement('button'); previewButton.type = 'button'; previewButton.className = 'store-preview-button'; previewButton.textContent = 'Посмотреть в интерфейсе';
    previewButton.addEventListener('click', () => openStorePreview({ ...pack, slot: 'membership' }));
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-secondary'; button.textContent = pack.current ? 'Продлить' : 'Оформить';
    const premiumBlocked=pack.tier==='vip'&&data.membershipCurrent==='premium';
    if(premiumBlocked){button.disabled=true;button.textContent='Premium уже активен';}
    button.addEventListener('click', async () => {
      const approved = await confirmStorePurchase({
        title: `Оформить ${pack.name}?`,
        description: `${pack.description} Стоимость рассчитана по фиксированной ставке ${pack.hourlyRate} токенов за час. Срок добавится к текущему; при переходе с VIP на Premium остаток VIP пересчитывается по стоимости токенов.`,
        price: pack.price, balance: state.storeData?.balance ?? state.user?.tokens ?? 0, confirmLabel: 'Подтвердить покупку'
      });
      if (!approved) return;
      button.disabled = true;
      try { const result = await api('/api/store/membership', { method: 'POST', body: JSON.stringify({ packageId: pack.id }) }); setUser(result.user); showToast(`${pack.name} активирован.`); await loadStore(); }
      catch (error) { showToast(error.message); button.disabled = false; }
    });
    card.append(label,title,copy,rate,price,detail,previewButton,button); membershipRoot.append(card);
  });
  const currentMembership=$('#membershipCurrentStatus');
  if(currentMembership){
    const tier=data.membershipCurrent||'free';
    currentMembership.hidden=tier==='free';
    currentMembership.textContent=tier==='free'?'':`${tier==='premium'?'Premium':'VIP'} активен до ${data.membershipExpiresAt?new Date(data.membershipExpiresAt).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'}):'—'}`;
  }
}
async function loadInventory() {
  try {
    const data = await api('/api/inventory');
    if (state.user) state.user.equipped = data.equipped || {};
    applyEquipped(data.equipped || {});
    $('#inventoryBalance').textContent = Number(data.balance || 0).toLocaleString('ru-RU');
    $('#inventoryCount').textContent = `${data.items.length} предметов`;
    const root = $('#inventoryItems'); root.replaceChildren();
    if (!data.items.length) { const empty = document.createElement('div'); empty.className = 'store-empty'; empty.textContent = 'Коллекция пока пуста. Загляни в магазин и выбери первый предмет.'; root.append(empty); return; }
    data.items.forEach(item => {
      const card = document.createElement('article'); card.className = 'store-item-card inventory-card';
      card.append(createStorePreview(item));
      const meta = document.createElement('div'); meta.className = 'store-item-meta';
      const category = document.createElement('span'); category.className = 'store-item-category'; category.textContent = `${item.category} · ${item.rarity}`;
      const title = document.createElement('h3'); title.textContent = item.name;
      const desc = document.createElement('p'); desc.textContent = item.description;
      const source = document.createElement('small'); source.className = 'store-item-collection'; source.textContent = `Получено: ${item.source === 'promo' ? 'промокод' : item.source === 'purchase' ? 'покупка' : item.source === 'starter' ? 'стартовый предмет' : 'коллекция'} · ${new Date(item.acquiredAt).toLocaleDateString('ru-RU')}`;
      meta.append(category, title, desc, source);
      const footer = document.createElement('div'); footer.className = 'store-item-footer';
      const label = document.createElement('strong'); label.className = 'store-item-price'; label.textContent = item.equipped ? 'Используется' : 'В коллекции';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-secondary store-action'; button.textContent = item.equipped ? 'Снять' : 'Применить';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const result = item.equipped
            ? await api(`/api/store/equip/${encodeURIComponent(item.slot)}`, { method: 'DELETE' })
            : await api('/api/store/equip', { method: 'POST', body: JSON.stringify({ itemId: item.id }) });
          if (state.user) state.user.equipped = result.equipped;
          applyEquipped(result.equipped); renderStickerPanel(); await loadInventory();
          showToast(item.equipped ? 'Предмет снят.' : 'Предмет применён.');
        } catch (error) { showToast(error.message); button.disabled = false; }
      });
      footer.append(label, button); card.append(meta, footer); root.append(card);
    });
  } catch (error) { showToast(error.message); }
}
async function redeemPromo() {
  const input = $('#promoCodeInput'); const button = $('#promoRedeemButton');
  $('#promoRedeemError').textContent = '';
  button.disabled = true;
  try {
    const result = await api('/api/promos/redeem', { method: 'POST', body: JSON.stringify({ code: input.value }) });
    setUser(result.user); input.value = '';
    $('#promoRedeemError').textContent = 'Промокод успешно активирован.';
    $('#promoRedeemError').classList.add('success-text');
    showToast('Награда промокода добавлена.');
    await loadStore();
  } catch (error) { $('#promoRedeemError').classList.remove('success-text'); $('#promoRedeemError').textContent = error.message; }
  finally { button.disabled = false; }
}
async function loadStore() {
  try { const data = await api('/api/store'); renderStore(data); await loadTokenHistory(); }
  catch (error) { showToast(error.message); }
}
async function loadTokenHistory() {
  try {
    const data = await api('/api/store/transactions');
    const root = $('#tokenHistoryList'); root.replaceChildren();
    if (!data.transactions.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'История пока пустая.'; root.append(empty); return; }
    data.transactions.forEach(item => {
      const row = document.createElement('div'); row.className = 'token-history-row';
      const copy = document.createElement('span'); copy.textContent = item.description;
      const amount = document.createElement('strong'); amount.className = item.amount < 0 ? 'debit' : 'credit'; amount.textContent = `${item.amount > 0 ? '+' : ''}${item.amount} ✦`;
      const date = document.createElement('time'); date.textContent = new Date(item.created_at).toLocaleDateString('ru-RU');
      row.append(copy, amount, date); root.append(row);
    });
  } catch { /* token history is supplementary */ }
}

async function loadAdmin() {
  try {
    const [overview, reports] = await Promise.all([api('/api/admin/overview'), api('/api/admin/reports')]);
    const stats = $('#adminStats'); stats.replaceChildren();
    [['Пользователи', overview.users], ['Гости', overview.guests], ['Активные чаты', overview.activeMatches], ['Открытые жалобы', overview.openReports], ['Токены в системе', overview.tokenTotal]].forEach(([label, value]) => {
      const card = document.createElement('div'); card.className = 'admin-stat-card';
      const strong = document.createElement('strong'); strong.textContent = Number(value).toLocaleString('ru-RU');
      const caption = document.createElement('span'); caption.textContent = label;
      card.append(strong, caption); stats.append(card);
    });
    const usersRoot = $('#adminUsers'); usersRoot.replaceChildren();
    (overview.recentUsers || []).forEach(person => {
      const row = document.createElement('div'); row.className = 'admin-user-row';
      const label = document.createElement('div'); label.className = 'admin-user-copy';
      const name = document.createElement('strong'); name.textContent = person.username;
      const roleNames = { owner: 'Владелец', developer: 'Разработчик', moderator: 'Модератор', member: 'Участник' };
      const meta = document.createElement('small'); meta.textContent = `${person.public_id} · ${roleNames[person.role] || 'Участник'} · ${person.subscription_tier || 'free'}`;
      label.append(name, meta);
      const actions = document.createElement('div'); actions.className = 'admin-user-actions';
      if (person.role !== 'owner') {
        for (const [tier, days, text] of [['vip',7,'VIP 7д'],['premium',30,'Premium 30д']]) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-secondary'; button.textContent = text;
          button.addEventListener('click', async () => { try { await api(`/api/admin/users/${encodeURIComponent(person.id)}/membership`, { method: 'POST', body: JSON.stringify({ tier, days }) }); showToast(`${person.username}: ${tier.toUpperCase()} на ${days} дней.`); await loadAdmin(); } catch (error) { showToast(error.message); } }); actions.append(button);
        }
        const nextRole = person.role === 'member' ? 'moderator' : person.role === 'moderator' ? 'developer' : 'member';
        const roleButton = document.createElement('button'); roleButton.type = 'button'; roleButton.className = 'button button-secondary'; roleButton.textContent = nextRole === 'moderator' ? 'Назначить модератора' : nextRole === 'developer' ? 'Назначить разработчика' : 'Снять роль';
        roleButton.addEventListener('click', async () => { try { await api(`/api/admin/users/${encodeURIComponent(person.id)}/role`, { method: 'POST', body: JSON.stringify({ role: nextRole }) }); await loadAdmin(); showToast('Роль обновлена.'); } catch (error) { showToast(error.message); } }); actions.append(roleButton);
      } else {
        const ownerLabel = document.createElement('span'); ownerLabel.className = 'owner-account-label'; ownerLabel.textContent = 'Полный доступ'; actions.append(ownerLabel);
      }
      row.append(label, actions); usersRoot.append(row);
    });
    const list = $('#adminReports'); list.replaceChildren();
    if (!reports.reports.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Жалоб пока нет.'; list.append(empty); return; }
    reports.reports.forEach(report => {
      const card = document.createElement('article'); card.className = 'admin-report-card';
      const heading = document.createElement('div'); heading.className = 'admin-report-heading';
      const title = document.createElement('strong'); title.textContent = `${report.category} · ${report.reported}`;
      const status = document.createElement('span'); status.className = `report-status ${report.status}`; status.textContent = report.status === 'resolved' ? 'Рассмотрена' : 'Открыта';
      heading.append(title, status);
      const reason = document.createElement('p'); reason.textContent = report.details || `Жалоба от ${report.reporter}`;
      const context = document.createElement('div'); context.className = 'report-context';
      report.context.forEach(message => { const line = document.createElement('p'); line.textContent = `${message.sender_id === report.reportedId ? report.reported : report.reporter}: ${message.content || 'Вложение'}`; context.append(line); });
      const actions = document.createElement('div'); actions.className = 'admin-report-actions';
      const resolve = document.createElement('button'); resolve.type = 'button'; resolve.className = 'button button-secondary'; resolve.textContent = report.status === 'resolved' ? 'Обновить решение' : 'Отметить рассмотренной';
      resolve.addEventListener('click', async () => { const resolution = window.prompt('Краткое решение по жалобе:', 'Проверено'); if (resolution === null) return; try { await api(`/api/admin/reports/${encodeURIComponent(report.id)}/resolve`, { method: 'POST', body: JSON.stringify({ resolution }) }); await loadAdmin(); showToast('Жалоба отмечена рассмотренной.'); } catch (error) { showToast(error.message); } });
      const suspend = document.createElement('button'); suspend.type = 'button'; suspend.className = 'button button-danger'; suspend.textContent = 'Ограничить на 1 час';
      suspend.addEventListener('click', async () => { if (!window.confirm(`Ограничить доступ пользователю ${report.reported} на 1 час?`)) return; try { await api(`/api/admin/users/${encodeURIComponent(report.reportedId)}/suspend`, { method: 'POST', body: JSON.stringify({ minutes: 60, reason: `Жалоба: ${report.category}` }) }); await loadAdmin(); showToast('Доступ пользователя ограничен.'); } catch (error) { showToast(error.message); } });
      actions.append(resolve, suspend); card.append(heading, reason, context, actions); list.append(card);
    });
  } catch (error) { showToast(error.message); }
}

async function loadFavorites() {
  try {
    const data = await api('/api/favorites');
    state.favorites = data.favorites || [];
    renderFavorites();
    if (state.activeMatch) renderChatHeader();
  } catch (error) { showToast(error.message); }
}
function renderFavorites() {
  const root = $('#favoritesList'); if (!root) return;
  root.replaceChildren();
  if (!state.favorites.length) {
    const empty = document.createElement('div'); empty.className = 'favorites-empty';
    const icon = document.createElement('span'); icon.textContent = '♡';
    const title = document.createElement('strong'); title.textContent = 'Пока здесь никого нет';
    const copy = document.createElement('p'); copy.textContent = 'Во время приятного разговора нажми «В избранное» — собеседник появится здесь.';
    empty.append(icon,title,copy); root.append(empty); return;
  }
  state.favorites.forEach(person => {
    const card = document.createElement('article'); card.className = 'favorite-contact-card';
    const avatar = document.createElement('div'); avatar.className = 'avatar avatar-medium'; setAvatarContent(avatar, person);
    const details = document.createElement('div'); details.className = 'favorite-card-details';
    const name = document.createElement('strong'); name.textContent = person.username;
    const note = document.createElement('p'); note.className = 'favorite-card-note'; note.textContent = 'Сохранённый контакт · чат пока недоступен';
    details.append(name, note);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button button-secondary'; remove.textContent = 'Убрать';
    remove.addEventListener('click', async () => { remove.disabled = true; try { await api(`/api/favorites/${encodeURIComponent(person.id)}`, { method: 'DELETE' }); state.favorites = state.favorites.filter(row => row.id !== person.id); renderFavorites(); if (state.activeMatch) renderChatHeader(); } catch (error) { remove.disabled = false; showToast(error.message); } });
    card.append(avatar, details, remove); root.append(card);
  });
}
async function toggleFavoritePartner() {
  const partner = state.activeMatch?.partner;
  if (!partner) return;
  const isFavorite = state.favorites.some(row => row.id === partner.id);
  const button = $('#favoritePartnerButton'); button.disabled = true;
  try {
    if (isFavorite) {
      await api(`/api/favorites/${encodeURIComponent(partner.id)}`, { method: 'DELETE' });
      state.favorites = state.favorites.filter(row => row.id !== partner.id);
      showToast('Собеседник удалён из избранного.');
    } else {
      await api('/api/favorites', { method: 'POST', body: JSON.stringify({ matchId: state.activeMatch.matchId }) });
      state.favorites.push({ ...partner, createdAt: new Date().toISOString() });
      showToast('Собеседник добавлен в избранное.');
    }
    renderChatHeader(); renderFavorites();
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; }
}

async function loadBlockedUsers() {
  try {
    const data = await api('/api/blocks');
    state.blockedUsers = data.blocked || [];
    renderBlockedUsers();
  } catch (error) { showToast(error.message); }
}
function renderBlockedUsers() {
  const root = $('#blockedList'); if (!root) return;
  root.replaceChildren();
  if (!state.blockedUsers.length) {
    const empty = document.createElement('div'); empty.className = 'favorites-empty';
    const icon = document.createElement('span'); icon.textContent = '✓';
    const title = document.createElement('strong'); title.textContent = 'Список пуст';
    const copy = document.createElement('p'); copy.textContent = 'Здесь появятся люди, которых ты заблокируешь во время общения.';
    empty.append(icon, title, copy); root.append(empty); return;
  }
  state.blockedUsers.forEach(person => {
    const card = document.createElement('article'); card.className = 'favorite-contact-card';
    const avatar = document.createElement('div'); avatar.className = 'avatar avatar-medium'; setAvatarContent(avatar, person);
    const details = document.createElement('div'); details.className = 'favorite-card-details';
    const name = document.createElement('strong'); name.textContent = person.username;
    const description = document.createElement('p'); description.textContent = person.description || 'Пользователь SOVLI';
    details.append(name, description);
    const unblock = document.createElement('button'); unblock.type = 'button'; unblock.className = 'button button-secondary'; unblock.textContent = 'Разблокировать';
    unblock.addEventListener('click', async () => {
      unblock.disabled = true;
      try { await api(`/api/blocks/${encodeURIComponent(person.id)}`, { method: 'DELETE' }); state.blockedUsers = state.blockedUsers.filter(row => row.id !== person.id); renderBlockedUsers(); showToast('Блокировка снята.'); }
      catch (error) { unblock.disabled = false; showToast(error.message); }
    });
    card.append(avatar, details, unblock); root.append(card);
  });
}
async function loadSessions() {
  const root = $('#sessionsList'); if (!root) return;
  const button = $('#loadSessionsButton'); button.disabled = true;
  try {
    const data = await api('/api/sessions');
    root.replaceChildren();
    if (!(data.sessions || []).length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Активных сессий не найдено.'; root.append(empty); return; }
    data.sessions.forEach(session => {
      const row = document.createElement('div'); row.className = 'session-row';
      const copy = document.createElement('div'); copy.className = 'session-row-copy';
      const title = document.createElement('strong'); title.textContent = session.current ? 'Это устройство' : 'Другое устройство';
      const meta = document.createElement('small'); meta.textContent = `Вход: ${new Date(session.createdAt).toLocaleString('ru-RU')} · До: ${new Date(session.expiresAt).toLocaleString('ru-RU')}`;
      copy.append(title, meta); row.append(copy);
      if (session.current) { const badge = document.createElement('span'); badge.className = 'session-current'; badge.textContent = 'Текущая'; row.append(badge); }
      else {
        const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'button button-secondary'; revoke.textContent = 'Завершить';
        revoke.addEventListener('click', async () => { revoke.disabled = true; try { await api(`/api/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' }); showToast('Сессия завершена.'); await loadSessions(); } catch (error) { revoke.disabled = false; showToast(error.message); } });
        row.append(revoke);
      }
      root.append(row);
    });
  } catch (error) { root.replaceChildren(); const line = document.createElement('p'); line.className = 'muted'; line.textContent = error.message; root.append(line); }
  finally { button.disabled = false; }
}

function setAuthError(message = '') { $('#authError').textContent = message; }
function currentView() {
  return ['home', 'search', 'chat', 'profile', 'settings', 'store', 'inventory', 'favorites', 'blocked', 'admin'].find(name => !$(`#${name}Panel`).hidden) || 'home';
}
function setView(view) {
  if (view === 'home' && state.activeMatch) view = 'chat';
  ['home', 'search', 'chat', 'profile', 'settings', 'store', 'inventory', 'favorites', 'blocked', 'admin'].forEach(name => {
    const panel = $(`#${name}Panel`);
    if (panel) panel.hidden = name !== view;
  });
  const activePanel = $(`#${view}Panel`);
  if (activePanel) {
    activePanel.classList.remove('view-enter');
    requestAnimationFrame(() => activePanel.classList.add('view-enter'));
  }
  $$('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === (view === 'search' || view === 'chat' ? 'home' : view)));
  if (view === 'chat') scrollMessages();
  if (view === 'admin' && state.user?.role === 'owner') loadAdmin();
  if (view === 'store') loadStore();
  if (view === 'inventory') loadInventory();
  if (view === 'favorites') loadFavorites();
  if (view === 'blocked') loadBlockedUsers();
}
function setAvatarContent(element, user) {
  if (!element) return;
  element.replaceChildren();
  if (user?.avatarUrl) {
    const image = document.createElement('img'); image.src = user.avatarUrl; image.alt = ''; image.className = 'avatar-image'; image.loading = 'lazy';
    image.addEventListener('error', () => { element.textContent = user.avatar || '◉'; }, { once: true });
    element.append(image);
  } else element.textContent = user?.avatar || '◉';
}

function renderMembershipPerks(user) {
  const root=$('#membershipPerksCard');
  if(!root)return;
  const tier=user?.subscriptionTier||'free';
  root.hidden=tier==='free';
  root.dataset.tier=tier;
  if(tier==='free')return;
  root.replaceChildren();
  const premium=tier==='premium';
  const heading=previewNode('div','membership-perks-heading');
  heading.append(previewNode('strong','',premium?'Твои возможности Premium':'Твои возможности VIP'));
  heading.append(previewNode('span','',premium?'VIP + Premium':'VIP активен'));
  const intro=previewNode('p','',premium
    ? 'Premium объединяет привилегии VIP и добавляет собственное премиальное оформление.'
    : 'Твои косметические привилегии активны во всех диалогах, пока действует статус.');
  const perks=previewNode('ul','membership-perks-list');
  const lines=[
    'Особый бейдж рядом с ником в чате и профиле',
    '8 эксклюзивных стикеров в панели сообщений',
    'Дополнительные быстрые фразы для начала разговора'
  ];
  if(premium)lines.push('Ещё 8 Premium-стикеров','Золотая Premium-карточка профиля и сияющая рамка');
  else lines.push('Золотой контур аватара в чате и профиле');
  lines.forEach(line=>perks.append(previewNode('li','',line)));
  const expiry=previewNode('small','membership-perks-expiry',user.subscriptionExpiresAt
    ? `Действует до ${new Date(user.subscriptionExpiresAt).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'})}`
    : 'Срок не указан');
  root.append(heading,intro,perks,expiry);
}
function renderMembershipQuickReplies(user) {
  const list=$('#quickReplies .quick-reply-list');
  if(!list)return;
  list.querySelectorAll('[data-membership-quick]').forEach(node=>node.remove());
  const tier=user?.subscriptionTier||'free';
  if(tier==='free')return;
  const vip=[
    'Что тебя сегодня порадовало?',
    'Какую цель хочешь достичь в этом году?',
    'Какой фильм можешь пересматривать снова?'
  ];
  const premium=[
    'Какое место ты мечтаешь посетить?',
    'Что бы ты создал, если бы не было ограничений?',
    'Какая мелочь моментально поднимает тебе настроение?'
  ];
  [...vip,...(tier==='premium'?premium:[])].forEach(text=>{
    const button=previewNode('button','',text);
    button.type='button';
    button.dataset.membershipQuick='true';
    button.addEventListener('click',()=>{
      sendMessage(text,crypto.randomUUID());
      $('#quickReplies').open=false;
    });
    list.append(button);
  });
}
function setUser(user) {
  const isNewAccount = state.user?.id !== user.id;
  state.user = user;
  document.documentElement.dataset.role = user.role === 'owner' ? 'owner' : (user.role || 'member');
  document.documentElement.dataset.membershipTier = user.subscriptionTier || 'free';
  $('#profileHero').dataset.membership = user.subscriptionTier || 'free';
  renderMembershipPerks(user);
  renderMembershipQuickReplies(user);
  if (isNewAccount) state.selectedAvatar = user.avatarUrl ? null : user.avatar;
  setAvatarContent($('#sideAvatar'), user);
  setAvatarContent($('#topAvatar'), user);
  $('#sideUsername').textContent = user.username;
  $('#topUsername').textContent = user.username;
  $('#sidePublicId').textContent = `ID: ${user.publicId} ⧉`;
  setAvatarContent($('#profilePreviewAvatar'), user);
  $('#profilePreviewName').textContent = user.username;
  $('#profilePreviewId').textContent = `Технический ID: ${user.publicId}`;
  const stats = user.stats || { chats: 0, activeMinutes: 0, messages: 0 };
  $('#profileStats').innerHTML = `<div><strong>${Number(stats.chats || 0).toLocaleString('ru-RU')}</strong><span>диалогов</span></div><div><strong>${Number(stats.activeMinutes || 0).toLocaleString('ru-RU')}</strong><span>минут общения</span></div><div><strong>${Number(stats.messages || 0).toLocaleString('ru-RU')}</strong><span>сообщений</span></div>`;
  $('#profileRoleBadge').textContent = user.badge || 'Участник';
  $('#profileMembershipLine').textContent = user.subscriptionTier === 'free' ? 'Стандартный участник' : `${user.subscriptionTier.toUpperCase()} активно до ${user.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'}) : '—'}`;
  $('#profileTokenBalance').textContent = Number(user.tokens || 0).toLocaleString('ru-RU');
  $('#profileCreatedAt').textContent = `В SOVLI с ${new Date(user.createdAt).toLocaleDateString('ru-RU')}`;
  $('#profileUsername').value = user.username;
  if ($('#profileDescription')) $('#profileDescription').value = user.description || '';
  $('#profileUsername').disabled = user.accountType === 'guest';
  $('#saveProfileButton').hidden = user.accountType === 'guest';
  $('#avatarOptions').hidden = false;
  $('#avatarUploadButton').hidden = false;
  state.settings = { ...state.settings, ...(user.settings || {}) };
  applyEquipped(user.equipped || {});
  $('#adminNavButton').hidden = user.role !== 'owner';
  const isGuest = user.accountType === 'guest';
  $('#accountTypeBadge').textContent = isGuest ? 'ГОСТЬ' : 'АККАУНТ';
  $('#profileAccountType').textContent = isGuest ? 'ГОСТЕВОЙ ПРОФИЛЬ · ДО 180 ДНЕЙ' : 'ПОСТОЯННЫЙ АККАУНТ';
  $('#guestClaimCard').hidden = !isGuest;
  $('#claimUsername').value = isGuest ? user.username : '';
  $('#claimPassword').value = '';
  $('#claimError').textContent = '';
  $('#sidePublicId').hidden = false;
  renderSettingsControls();
  applySettings();
  renderAvatarOptions();
  renderStickerPanel();
  try { if (state.token) localStorage.setItem('sovli_user_cache', JSON.stringify(user)); } catch { /* cached profile is optional */ }
}
async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(url, { ...options, headers });
  let payload = {};
  try { payload = await response.json(); } catch { /* non-JSON response */ }
  if (!response.ok) {
    const error = new Error(payload.error || `Ошибка запроса (${response.status})`);
    error.status = response.status;
    if (response.status === 401 && state.token && !state.authRestoring) logout(false, false);
    throw error;
  }
  return payload;
}
function showAuth() {
  document.documentElement.classList.remove('session-checking');
  $('#authView').hidden = false;
  $('#appView').hidden = true;
}
function showApp() {
  document.documentElement.classList.remove('session-checking');
  $('#authView').hidden = true;
  $('#appView').hidden = false;
  setView('home');
}
function switchAuthMode(mode) {
  state.authMode = mode;
  const isRegister = mode === 'register';
  $('#authTitle').textContent = isRegister ? 'Создай свой аккаунт' : 'С возвращением';
  $('#authSubtitle').textContent = isRegister
    ? 'Придумай уникальный ник и пароль. Никакой лишней анкеты.'
    : 'Войди, используя свой никнейм и пароль.';
  $('#authUsernameLabel').textContent = 'Никнейм';
  $('#authUsername').placeholder = isRegister ? 'Придумай никнейм' : 'Твой никнейм';
  $('#authSubmit').querySelector('span:first-child').textContent = isRegister ? 'Создать аккаунт' : 'Войти в SOVLI';
  $('#authPassword').autocomplete = isRegister ? 'new-password' : 'current-password';
  $('#authPassword').placeholder = 'Не менее 8 символов';
  $$('[data-auth-tab]').forEach(button => button.classList.toggle('active', button.dataset.authTab === mode));
  setAuthError('');
}
function renderChoices(container, values, selected, onToggle) {
  container.replaceChildren();
  values.forEach(value => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `choice-chip${selected.includes(value) ? ' selected' : ''}`;
    button.textContent = value;
    button.setAttribute('aria-pressed', String(selected.includes(value)));
    button.addEventListener('click', () => onToggle(value));
    container.append(button);
  });
}
function toggleChoice(listName, value, container, values, limit) {
  const list = state[listName];
  if (list.includes(value)) state[listName] = list.filter(item => item !== value);
  else if (list.length >= limit) { showToast(`Можно выбрать не больше ${limit}.`); return; }
  else state[listName] = [...list, value];
  renderFilters();
}
function renderFilters() {
  renderChoices($('#languageOptions'), state.config.languages, state.selectedLanguages, value => toggleChoice('selectedLanguages', value, $('#languageOptions'), state.config.languages, 3));
  renderChoices($('#interestOptions'), state.config.interests, state.selectedInterests, value => toggleChoice('selectedInterests', value, $('#interestOptions'), state.config.interests, 5));
  const languageSummary = state.selectedLanguages.length ? state.selectedLanguages.join(', ') : 'Любой язык';
  const interestSummary = state.selectedInterests.length ? state.selectedInterests.slice(0, 2).join(', ') + (state.selectedInterests.length > 2 ? ` +${state.selectedInterests.length - 2}` : '') : 'Любые интересы';
  $('#languageSummary').textContent = languageSummary;
  $('#languageCount').textContent = state.selectedLanguages.length ? `${state.selectedLanguages.length} / 3` : 'Не ограничивать';
  $('#interestSummary').textContent = interestSummary;
  $('#interestCount').textContent = state.selectedInterests.length ? `${state.selectedInterests.length} / 5` : 'Без фильтра';
  try {
    localStorage.setItem('sovli_languages', JSON.stringify(state.selectedLanguages));
    localStorage.setItem('sovli_interests', JSON.stringify(state.selectedInterests));
  } catch { /* filter preferences are optional */ }
}

function renderAvatarOptions() {
  if (!state.user) return;
  if (!state.selectedAvatar && !state.user.avatarUrl) state.selectedAvatar = state.user.avatar;
  const container = $('#avatarOptions');
  container.replaceChildren();
  const avatarChoices = Array.isArray(state.config.avatars) && state.config.avatars.length ? state.config.avatars : DEFAULT_AVATARS;
  avatarChoices.forEach(avatar => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `avatar-option${state.selectedAvatar === avatar ? ' selected' : ''}`;
    button.textContent = avatar;
    button.setAttribute('aria-label', `Выбрать аватар ${avatar}`);
    button.setAttribute('aria-pressed', String(state.selectedAvatar === avatar));
    button.addEventListener('click', async () => {
      state.selectedAvatar = avatar;
      renderAvatarOptions();
      setAvatarContent($('#profilePreviewAvatar'), { ...state.user, avatar, avatarUrl: null });
      if (state.user.accountType === 'guest') {
        button.disabled = true;
        try { const result = await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ username: state.user.username, avatar }) }); setUser(result.user); showToast('Аватар обновлён.'); }
        catch (error) { showToast(error.message); }
        finally { button.disabled = false; }
      }
    });
    container.append(button);
  });
}
function connectSocket() {
  if (state.socket) state.socket.disconnect();
  state.socket = io({ auth: { token: state.token, lastMatchId: state.activeMatch?.matchId || null }, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 700, reconnectionDelayMax: 5000, timeout: 10000 });
  const socket = state.socket;
  socket.on('connect', () => {
    if (state.searching) {
      socket.emit('queue:join', { languages: state.selectedLanguages, interests: state.selectedInterests }, result => {
        if (!result?.ok) { state.searching = false; clearSearchTimer(); setView('home'); showToast(result?.error || 'Не удалось возобновить поиск.'); }
      });
    }
    if (state.activeMatch) { markRead(); flushOutbox(); }
  });
  socket.on('connect_error', error => {
    if (error.message?.includes('авторизац') || error.message?.includes('Сессия') || error.message?.includes('гостевого')) {
      showToast('Сессия завершена. Войдите снова.');
      logout(false);
    } else if (state.searching) {
      $('#searchStatusText').textContent = 'Связь прервалась. Пытаемся подключиться снова…';
    }
  });
  socket.on('disconnect', () => {
    if (state.searching) $('#searchStatusText').textContent = 'Связь прервалась. Восстанавливаем подключение…';
    if (state.activeMatch) $('#partnerStateText').textContent = 'Переподключение…';
  });
  socket.on('presence:count', data => { $('#onlineCount').textContent = String(data.count ?? 0); });
  socket.on('wallet:updated', data => { if (state.user) state.user.tokens = Number(data.balance || 0); const balance = $('#storeBalance'); if (balance) balance.textContent = Number(data.balance || 0).toLocaleString('ru-RU'); const profileBalance = $('#profileTokenBalance'); if (profileBalance) profileBalance.textContent = Number(data.balance || 0).toLocaleString('ru-RU'); if (data.earned) showToast(`+${data.earned} токен(ов) за активное общение ✦`, 2200); });
  socket.on('moderation:notice', payload => {
    const message = String(payload?.message || '').trim();
    if (message) showToast(`Сообщение от команды SOVLI: ${message}`, 7500);
  });
  socket.on('queue:waiting', () => {
    if (state.searching) $('#searchStatusText').textContent = 'Подбираем человека с похожими интересами.';
  });
  socket.on('queue:cancelled', () => { state.searching = false; clearSearchTimer(); setView('home'); });
  socket.on('match:found', match => activateMatch(match));
  socket.on('chat:restored', payload => {
    state.activeMatch = { matchId: payload.matchId, partner: payload.partner, commonInterests: payload.commonInterests || [], startedAt: payload.startedAt };
    state.messages = payload.messages || [];
    restoreOutbox();
    restoreDraft();
    renderChatHeader();
    renderMessages();
    setView('chat');
    markRead();
    flushOutbox();
    showToast('Соединение восстановлено.');
  });
  socket.on('chat:message', message => {
    if (!state.activeMatch || message.match_id !== state.activeMatch.matchId) return;
    mergeMessage(message);
    if (message.sender_id !== state.user.id) {
      playUiSound(740);
      if (document.visibilityState === 'visible') markRead();
      else if (state.settings.browserNotifications && 'Notification' in window && Notification.permission === 'granted') new Notification(state.activeMatch?.partner?.username || 'Новое сообщение', { body: (message.content || (message.type === 'voice' ? 'Голосовое сообщение' : 'Вложение')).slice(0, 120), icon: '/favicon.svg', tag: state.activeMatch?.matchId });
    }
  });
  socket.on('chat:status', data => {
    const item = state.messages.find(message => message.id === data.messageId);
    if (item) { item.delivered_at = data.at; renderMessages(); }
  });
  socket.on('chat:read-receipt', data => {
    const ids = new Set(data.messageIds || []);
    state.messages.forEach(message => { if (ids.has(message.id)) { message.read_at = data.readAt; message.delivered_at ||= data.readAt; } });
    renderMessages();
  });
  socket.on('chat:reactions', data => {
    const message = state.messages.find(item => item.id === data.messageId);
    if (message) { message.reactions = data.reactions || []; renderMessages(); }
  });
  socket.on('chat:typing', data => {
    if (data.userId === state.activeMatch?.partner?.id) $('#typingIndicator').hidden = !data.typing;
  });
  socket.on('chat:recording', data => {
    if (data.userId === state.activeMatch?.partner?.id) $('#recordingIndicator').hidden = !data.recording;
  });
  socket.on('chat:ended', data => {
    if (state.activeMatch?.matchId !== data.matchId) return;
    state.activeMatch = null;
    state.messages = [];
    releaseMediaUrls();
    state.outbox = [];
    persistOutbox();
    try { if (draftKey()) localStorage.removeItem(draftKey()); } catch { /* ignore */ }
    $('#typingIndicator').hidden = true;
    $('#recordingIndicator').hidden = true;
    stopVoiceRecording(true);
    if (!state.searching) setView('home');
    if (data.reason !== 'user_next') showToast(endReasonText(data.reason));
  });
  socket.on('auth:expired', () => {
    logout(false, false);
    setAuthError('Срок гостевого доступа завершился. Создай новый гостевой профиль или войди в постоянный аккаунт.');
  });
  socket.on('account:deleted', () => logout(false, false));
}
function endReasonText(reason) {
  const messages = {
    user_ended: 'Диалог завершён. Переписка удалена.',
    user_next: 'Ищем следующего собеседника…',
    reported: 'Жалоба отправлена. Диалог завершён.',
    blocked: 'Пользователь заблокирован.',
    connection_lost: 'Соединение потеряно. Диалог завершён.',
    server_restart: 'Сервер перезапустился. Диалог завершён, переписка удалена.',
    account_deleted: 'Аккаунт удалён.',
    guest_expired: 'Гостевой доступ завершился.'
  };
  return messages[reason] || 'Диалог завершён.';
}
function activateMatch(match) {
  state.searching = false;
  clearSearchTimer();
  releaseMediaUrls();
  state.activeMatch = match;
  state.messages = [];
  state.favorites = [];
  state.tokenHistoryLoaded = false;
  state.replyTarget = null;
  if ($('#replyPreview')) { $('#replyPreview').hidden = true; $('#replyPreview').querySelector('span').textContent = ''; }
  state.outbox = [];
  persistOutbox();
  $('#typingIndicator').hidden = true;
  $('#recordingIndicator').hidden = true;
  restoreDraft();
  renderChatHeader();
  renderMessages();
  setView('chat');
  showToast('Собеседник найден. Хорошего разговора!');
}
function renderChatHeader() {
  const partner = state.activeMatch?.partner;
  if (!partner) return;
  setAvatarContent($('#partnerAvatar'), partner);
  const partnerTier=partner.subscriptionTier||'free';
  $('#chatPanel .chat-partner').dataset.membership=partnerTier;
  $('#partnerAvatar').dataset.membership=partnerTier;
  $('#partnerName').textContent = partner.username || 'Собеседник';
  $('#partnerStateText').textContent = [partner.badge, partner.cosmeticTitle].filter(Boolean).join(' · ') || 'На связи';
  $('#partnerName').title = partner.description || partner.username || '';
  const favorite = state.favorites.some(row => row.id === partner.id);
  $('#favoritePartnerButton').textContent = favorite ? '★ В избранном' : '☆ В избранное';
  $('#favoritePartnerButton').classList.toggle('active', favorite);
  const common = state.activeMatch.commonInterests || [];
  const container = $('#commonInterests');
  container.replaceChildren();
  if (common.length) {
    const label = document.createElement('span');
    label.textContent = 'Общее';
    container.append(label);
    common.forEach(interest => {
      const chip = document.createElement('span');
      chip.textContent = interest;
      container.append(chip);
    });
    container.hidden = false;
  } else container.hidden = true;
}
function formatTime(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
function messageStatus(message) {
  if (message.status === 'sending') return 'Отправка…';
  if (message.status === 'failed') return 'Ошибка отправки';
  if (message.read_at) return 'Прочитано';
  if (message.delivered_at) return 'Доставлено';
  return 'Отправлено';
}
function releaseMediaUrls() {
  for (const url of state.mediaUrls.values()) URL.revokeObjectURL(url);
  state.mediaUrls.clear();
  state.mediaLoading.clear();
}
async function loadMediaElement(element, attachment) {
  if (!attachment?.id || !state.token) return;
  const existing = state.mediaUrls.get(attachment.id);
  if (existing) { element.src = existing; return; }
  if (state.mediaLoading.has(attachment.id)) {
    const wait = setInterval(() => {
      const url = state.mediaUrls.get(attachment.id);
      if (url || !state.mediaLoading.has(attachment.id)) {
        clearInterval(wait);
        if (url && element.isConnected) element.src = url;
      }
    }, 150);
    return;
  }
  state.mediaLoading.add(attachment.id);
  try {
    const response = await fetch(attachment.url, { headers: { Authorization: `Bearer ${state.token}` } });
    if (!response.ok) throw new Error('media unavailable');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    state.mediaUrls.set(attachment.id, url);
    if (element.isConnected) element.src = url;
  } catch {
    element.dataset.failed = 'true';
    if (element.tagName === 'IMG') element.alt = 'Фото больше недоступно';
  } finally { state.mediaLoading.delete(attachment.id); }
}
function reactToMessage(messageId, emoji) {
  if (!state.socket?.connected || !state.activeMatch || String(messageId).startsWith('pending:')) return;
  state.socket.emit('chat:react', { matchId: state.activeMatch.matchId, messageId, emoji }, result => {
    if (!result?.ok) showToast(result?.error || 'Не удалось поставить реакцию.');
    else {
      const message = state.messages.find(item => item.id === messageId);
      if (message) { message.reactions = result.reactions || []; renderMessages(); }
    }
  });
}
function renderMessages() {
  const container = $('#messages');
  container.replaceChildren();
  if (!state.messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-chat';
    const symbol = document.createElement('div');
    symbol.className = 'empty-chat-icon';
    symbol.textContent = '✳';
    const text = document.createElement('div');
    text.textContent = 'Неловко начинать? Вот несколько вариантов:';
    const prompts = document.createElement('div');
    prompts.className = 'icebreaker-list';
    ['Привет! Как проходит твой день?', 'Что сейчас слушаешь?', 'Посоветуй фильм или сериал'].forEach(prompt => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'icebreaker-chip';
      button.textContent = prompt;
      button.addEventListener('click', () => sendMessage(prompt, crypto.randomUUID()));
      prompts.append(button);
    });
    empty.append(symbol, text, prompts);
    container.append(empty);
    return;
  }
  state.messages.forEach(message => {
    const mine = message.sender_id === state.user.id;
    const row = document.createElement('div');
    row.id = `message-${String(message.id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
    row.className = `message-row${mine ? ' mine' : ''}${message.status === 'failed' ? ' failed' : ''}`;
    const bubble = document.createElement('div');
    bubble.className = `message-bubble${message.type === 'sticker' ? ' sticker-bubble' : ''}`;
    if (message.type === 'sticker') {
      const sticker = document.createElement('span');
      sticker.className = 'message-sticker';
      sticker.textContent = message.sticker || '✨';
      bubble.append(sticker);
    }
    if (message.replyTo) {
      const quote = document.createElement('button'); quote.type = 'button'; quote.className = 'message-reply-quote';
      quote.textContent = `↪ ${message.replyTo.senderId === state.user.id ? 'Твой ответ' : (state.activeMatch?.partner?.username || 'Собеседник')}: ${(message.replyTo.content || 'Вложение').slice(0, 100)}`;
      quote.title = 'Перейти к исходному сообщению';
      quote.addEventListener('click', () => {
        const targetId = `message-${String(message.replyTo.id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
        const target = document.getElementById(targetId);
        if (!target) { showToast('Исходное сообщение уже недоступно.'); return; }
        target.scrollIntoView({ behavior: state.settings.reducedMotion ? 'auto' : 'smooth', block: 'center' });
        target.classList.add('reply-highlight');
        setTimeout(() => target.classList.remove('reply-highlight'), 1500);
      });
      bubble.append(quote);
    }
    if (message.content) {
      const text = document.createElement('div');
      text.className = 'message-text';
      text.textContent = message.content;
      bubble.append(text);
    }
    (message.attachments || []).forEach(attachment => {
      if (attachment.kind === 'image') {
        if (!attachment.url) { const pending = document.createElement('div'); pending.className = 'media-pending'; pending.textContent = '▧ Фото подготовлено к отправке…'; bubble.append(pending); return; }
        const image = document.createElement('img');
        image.className = 'message-image';
        image.alt = 'Изображение в сообщении';
        image.loading = 'lazy';
        image.addEventListener('click', () => { const url = state.mediaUrls.get(attachment.id); if (url) window.open(url, '_blank', 'noopener,noreferrer'); });
        loadMediaElement(image, attachment);
        bubble.append(image);
      } else if (attachment.kind === 'audio') {
        if (!attachment.url) { const pending = document.createElement('div'); pending.className = 'media-pending'; pending.textContent = '◉ Голосовое подготовлено к отправке…'; bubble.append(pending); return; }
        const audioWrap = document.createElement('div');
        audioWrap.className = 'message-audio-wrap';
        const audio = document.createElement('audio');
        audio.className = 'message-audio';
        audio.controls = true;
        audio.preload = 'none';
        const speed = document.createElement('button');
        speed.type = 'button';
        speed.className = 'audio-speed';
        speed.textContent = '1×';
        speed.title = 'Скорость воспроизведения';
        const speeds = [1, 1.5, 2];
        let speedIndex = 0;
        speed.addEventListener('click', () => {
          speedIndex = (speedIndex + 1) % speeds.length;
          audio.playbackRate = speeds[speedIndex];
          speed.textContent = `${speeds[speedIndex]}×`;
        });
        loadMediaElement(audio, attachment);
        audioWrap.append(audio, speed);
        bubble.append(audioWrap);
      }
    });
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const time = document.createElement('span');
    time.textContent = formatTime(message.created_at);
    meta.append(time);
    if (mine) {
      const status = document.createElement('span');
      status.className = 'message-status';
      status.textContent = messageStatus(message);
      meta.append(status);
      if (message.status === 'failed') {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'retry-button';
        retry.textContent = 'Повторить';
        retry.addEventListener('click', () => retryMessage(message));
        meta.append(retry);
      }
    }
    row.append(bubble, meta);
    const reactions = document.createElement('div');
    reactions.className = 'message-reactions';
    (message.reactions || []).forEach(reaction => {
      const pill = document.createElement(mine ? 'span' : 'button');
      if (!mine) { pill.type = 'button'; pill.addEventListener('click', () => reactToMessage(message.id, reaction.emoji)); }
      pill.className = `reaction-pill${reaction.mine ? ' mine' : ''}`;
      pill.textContent = `${reaction.emoji} ${reaction.count}`;
      reactions.append(pill);
    });
    if (!String(message.id).startsWith('pending:') && !mine) {
      ['❤️', '😂', '🔥', '👏'].forEach(emoji => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'reaction-add';
        button.textContent = emoji;
        button.title = `Поставить реакцию ${emoji}`;
        button.addEventListener('click', () => reactToMessage(message.id, emoji));
        reactions.append(button);
      });
    }
    if (!String(message.id).startsWith('pending:') && !mine) {
      const reply = document.createElement('button'); reply.type = 'button'; reply.className = 'message-reply-button'; reply.textContent = '↩ Ответить';
      reply.addEventListener('click', () => {
        state.replyTarget = message;
        const preview = $('#replyPreview');
        if (preview) { preview.hidden = false; preview.querySelector('span').textContent = `Ответ на ${mine ? 'твоё сообщение' : (state.activeMatch?.partner?.username || 'собеседника')}: ${(message.content || (message.type === 'voice' ? 'Голосовое сообщение' : 'Вложение')).slice(0, 90)}`; }
        $('#messageInput').focus();
      });
      reactions.append(reply);
    }
    if (reactions.children.length) row.append(reactions);
    container.append(row);
  });
  scrollMessages();
}
function scrollMessages() {
  const container = $('#messages');
  if (container) container.scrollTop = container.scrollHeight;
}
function mergeMessage(incoming) {
  const index = state.messages.findIndex(message => message.id === incoming.id || (message.client_id && message.client_id === incoming.client_id && message.sender_id === incoming.sender_id));
  if (index >= 0) state.messages[index] = { ...state.messages[index], ...incoming, status: undefined };
  else state.messages.push(incoming);
  state.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  renderMessages();
}
function markRead() {
  if (!state.socket?.connected || !state.activeMatch) return;
  state.socket.emit('chat:read', { matchId: state.activeMatch.matchId });
}
function startSearch() {
  if (state.config.matchingEnabled === false) { showToast('Публичный подбор пока отключён до завершения проверки безопасности.'); return; }
  if (!state.socket?.connected) { showToast('Подключаемся к серверу. Попробуй ещё раз через секунду.'); return; }
  if (state.activeMatch) { setView('chat'); return; }
  state.searching = true;
  state.searchStartedAt = Date.now();
  $('#expandSearchButton').hidden = true;
  $('#searchStatusTitle').textContent = 'Ищем собеседника';
  $('#searchStatusText').textContent = 'Подбираем человека с похожими интересами.';
  $('#mascotMessage').textContent = 'Сосис-Мышь уже побежала искать тебе человека.';
  $('#mascotStage').classList.add('mascot-active');
  $('#mascotSpeech').textContent = 'ПИ-ПИ! ИЩУ ЛЮДЕЙ!';
  $('#searchWaitingHint').textContent = state.selectedLanguages.length ? 'Ищем человека, с которым у вас есть общий язык.' : 'Языковых ограничений нет — ищем любого подходящего собеседника.';
  setView('search');
  updateSearchTimer();
  state.searchInterval = setInterval(updateSearchTimer, 1000);
  state.socket.emit('queue:join', { languages: state.selectedLanguages, interests: state.selectedInterests }, result => {
    if (!result?.ok) {
      state.searching = false;
      clearSearchTimer();
      setView('home');
      showToast(result?.error || 'Не удалось начать поиск.');
    }
  });
}
function updateSearchTimer() {
  if (!state.searching) return;
  const seconds = Math.floor((Date.now() - state.searchStartedAt) / 1000);
  $('#searchTimer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const mascotLines = ['Мышь-сосиска побежала. Сосиска-мышь покатилась.', 'Проверяю сыр. Собеседник тоже где-то рядом.', 'Это не паника. Это сосисочная аэродинамика.', 'Пи-пи. Простите, профессиональная деформация.', 'Хвост запутался в Wi-Fi, сейчас распутаю.', 'Я маленькая, но коммуникабельная.'];
  const mascotSpeech = ['ГДЕ МОЙ СЫР?!', 'СОСИСКА НА СВЯЗИ!', 'ПИ-ПИ, НЕ МЕШАЙ!', 'ХВОСТ НЕ ПОДВЕДИ!'];
  if (seconds % 7 === 0) { $('#mascotMessage').textContent = mascotLines[Math.floor(seconds / 7) % mascotLines.length]; $('#mascotSpeech').textContent = mascotSpeech[Math.floor(seconds / 7) % mascotSpeech.length]; }
  $('#mascotStage').dataset.mood = seconds > 35 ? 'chaos' : (seconds > 15 ? 'impatient' : 'hopeful');
  if (seconds >= 20) $('#searchWaitingHint').textContent = 'Пока ищем — можно подождать или снять часть фильтров.';
  if (seconds >= 30 && (state.selectedLanguages.length || state.selectedInterests.length)) $('#expandSearchButton').hidden = false;
  if (seconds >= 45) $('#searchStatusText').textContent = 'Подходящий собеседник пока не найден. Поиск продолжается.';
}
function nextPartner() {
  if (!state.activeMatch) { startSearch(); return; }
  if (!state.socket?.connected) { showToast('Нет соединения. Подключаемся…'); return; }
  const matchId = state.activeMatch.matchId;
  state.searching = true;
  state.searchStartedAt = Date.now();
  $('#expandSearchButton').hidden = true;
  $('#searchStatusTitle').textContent = 'Ищем следующего';
  $('#searchStatusText').textContent = 'Закрываем предыдущий разговор и ищем новую встречу.';
  $('#mascotMessage').textContent = 'Следующий! Сосис-Мышь ушла в занос.';
  $('#mascotStage').classList.add('mascot-active');
  $('#mascotSpeech').textContent = 'ХВОСТ ВПЕРЁД!';
  setView('search');
  updateSearchTimer();
  state.searchInterval = setInterval(updateSearchTimer, 1000);
  state.socket.emit('chat:next', { matchId, preferences: { languages: state.selectedLanguages, interests: state.selectedInterests } }, result => {
    if (!result?.ok) {
      state.searching = false;
      clearSearchTimer();
      setView('home');
      showToast(result?.error || 'Не удалось начать следующий поиск.');
    }
  });
}

function clearSearchTimer() {
  if (state.searchInterval) clearInterval(state.searchInterval);
  state.searchInterval = null;
}
function cancelSearch() {
  if (state.socket?.connected) state.socket.emit('queue:cancel');
  $('#expandSearchButton').hidden = true;
  state.searching = false;
  $('#mascotStage').classList.remove('mascot-active');
  clearSearchTimer();
  setView('home');
}
function sendMessage(content, clientId, extras = {}) {
  if (!state.activeMatch) { showToast('Сначала найди собеседника.'); return; }
  const attachments = Array.isArray(extras.attachments) ? extras.attachments : [];
  const sticker = typeof extras.sticker === 'string' ? extras.sticker : null;
  const replyToId = extras.replyToId || state.replyTarget?.id || null;
  if (replyToId && state.replyTarget?.sender_id === state.user?.id) {
    showToast('Нельзя отвечать на собственное сообщение.');
    return;
  }
  if (!content && !attachments.length && !sticker) return;
  const message = {
    id: `pending:${clientId}`, match_id: state.activeMatch.matchId,
    sender_id: state.user.id, client_id: clientId, content, replyTo: replyToId ? { id: replyToId, content: state.replyTarget?.content || '' } : null, attachments: attachments.map(id => ({ id, kind: extras.kind || 'image', url: '' })), sticker, type: sticker ? 'sticker' : (attachments.length ? (extras.kind === 'audio' ? 'voice' : 'media') : 'text'),
    created_at: new Date().toISOString(), status: 'sending'
  };
  mergeMessage(message);
  state.outbox.push({ matchId: state.activeMatch.matchId, clientId, content, attachments, attachmentKind: extras.kind || 'image', sticker, replyToId });
  state.replyTarget = null; if ($('#replyPreview')) $('#replyPreview').hidden = true;
  persistOutbox();
  saveDraft('');
  if (!state.socket?.connected) {
    showToast('Нет соединения. Сообщение в очереди и отправится после переподключения.');
    return;
  }
  flushOutbox();
}
function flushOutbox() {
  if (!state.socket?.connected || !state.activeMatch || !state.outbox.length) return;
  const pending = [...state.outbox];
  pending.forEach(item => {
    if (item.matchId !== state.activeMatch?.matchId) return;
    state.socket.emit('chat:send', { matchId: item.matchId, clientId: item.clientId, content: item.content, attachments: item.attachments || [], sticker: item.sticker || null, replyToId: item.replyToId || null }, result => {
      const index = state.outbox.findIndex(row => row.clientId === item.clientId);
      if (!result?.ok) {
        const failed = state.messages.find(row => row.client_id === item.clientId);
        if (failed) { failed.status = 'failed'; renderMessages(); }
        if (index >= 0) state.outbox.splice(index, 1);
        persistOutbox();
        showToast(result?.error || 'Не удалось отправить сообщение.');
      } else {
        if (index >= 0) state.outbox.splice(index, 1);
        persistOutbox();
        if (result.message) mergeMessage(result.message);
      }
    });
  });
}
function outboxKey() { return state.user ? `orbit_outbox_${state.user.id}` : ''; }
function persistOutbox() {
  if (!outboxKey()) return;
  try { localStorage.setItem(outboxKey(), JSON.stringify(state.outbox)); } catch { /* local storage may be unavailable */ }
}
function restoreOutbox() {
  if (!outboxKey() || !state.activeMatch) return;
  try {
    const saved = JSON.parse(localStorage.getItem(outboxKey()) || '[]');
    state.outbox = Array.isArray(saved) ? saved.filter(item => item && item.matchId === state.activeMatch.matchId && typeof item.clientId === 'string' && typeof item.content === 'string' && (Array.isArray(item.attachments) || typeof item.sticker === 'string' || item.content.length > 0)) : [];
    state.outbox.forEach(item => {
      if (!state.messages.some(message => message.client_id === item.clientId)) {
        state.messages.push({ id: `pending:${item.clientId}`, match_id: item.matchId, sender_id: state.user.id, client_id: item.clientId, content: item.content, attachments: (item.attachments || []).map(id => ({ id, kind: item.attachmentKind || 'image', url: '' })), sticker: item.sticker || null, type: item.sticker ? 'sticker' : 'text', created_at: new Date().toISOString(), status: 'sending' });
      }
    });
    renderMessages();
  } catch { state.outbox = []; }
}
function draftKey() { return state.user ? `orbit_draft_${state.user.id}` : ''; }
function saveDraft(value) {
  if (!draftKey()) return;
  try { localStorage.setItem(draftKey(), JSON.stringify({ matchId: state.activeMatch?.matchId || null, text: value })); }
  catch { /* local storage may be unavailable */ }
}
function restoreDraft() {
  if (!draftKey() || !state.activeMatch) return;
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey()) || 'null');
    if (draft?.matchId === state.activeMatch.matchId && typeof draft.text === 'string') $('#messageInput').value = draft.text;
    else localStorage.removeItem(draftKey());
  } catch { /* ignore malformed draft */ }
}
function retryMessage(message) {
  const item = state.messages.find(row => row.client_id === message.client_id);
  if (item) { item.status = 'sending'; renderMessages(); }
  if (!state.activeMatch) {
    if (item) { item.status = 'failed'; renderMessages(); }
    showToast('Этот диалог уже завершён.');
    return;
  }
  if (!state.outbox.some(row => row.clientId === message.client_id)) {
    state.outbox.push({ matchId: state.activeMatch.matchId, clientId: message.client_id, content: message.content, attachments: (message.attachments || []).map(item => item.id), attachmentKind: message.attachments?.[0]?.kind || 'image', sticker: message.sticker || null });
    persistOutbox();
  }
  if (!state.socket?.connected) { showToast('Повтор отправится после восстановления соединения.'); return; }
  flushOutbox();
}
async function uploadMedia(blob, kind) {
  if (!state.activeMatch || !state.token) throw new Error('Сначала найди собеседника.');
  const response = await fetch('/api/media/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': blob.type, 'X-Match-Id': state.activeMatch.matchId, 'X-Media-Kind': kind },
    body: blob
  });
  let payload = {};
  try { payload = await response.json(); } catch { /* server returned an unexpected response */ }
  if (!response.ok) throw new Error(payload.error || `Не удалось загрузить файл (${response.status}).`);
  return payload.file;
}
function setUploadStatus(text) { $('#uploadStatus').textContent = text; }
async function sendSelectedPhotos(files) {
  if (!state.activeMatch) return showToast('Сначала найди собеседника.');
  const selected = [...files].slice(0, 3);
  if (!selected.length) return;
  if (files.length > 3) showToast('За один раз можно отправить не больше трёх фотографий.');
  const uploaded = [];
  $('#photoButton').disabled = true;
  try {
    for (let index = 0; index < selected.length; index += 1) {
      const file = selected[index];
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Поддерживаются только JPG, PNG и WebP.');
      if (file.size > 6 * 1024 * 1024) throw new Error('Каждая фотография должна быть не больше 6 МБ.');
      setUploadStatus(`Загружаем ${index + 1}/${selected.length}…`);
      uploaded.push(await uploadMedia(file, 'image'));
    }
    sendMessage('', crypto.randomUUID(), { attachments: uploaded.map(item => item.id) });
    showToast(uploaded.length === 1 ? 'Фото отправлено.' : `Отправлено фотографий: ${uploaded.length}.`);
  } catch (error) {
    await Promise.all(uploaded.map(file => fetch(`/api/media/${encodeURIComponent(file.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${state.token}` } }).catch(() => {})));
    showToast(error.message);
  }
  finally { $('#photoButton').disabled = false; setUploadStatus(''); $('#photoInput').value = ''; }
}
function clearVoiceRecording() {
  if (state.voiceTimer) clearInterval(state.voiceTimer);
  state.voiceTimer = null;
  if (state.voiceStream) state.voiceStream.getTracks().forEach(track => track.stop());
  state.voiceStream = null;
  state.mediaRecorder = null;
  state.voiceChunks = [];
  state.voiceBlob = null;
  state.voiceStartedAt = 0;
  if (state.voicePreviewUrl) URL.revokeObjectURL(state.voicePreviewUrl);
  state.voicePreviewUrl = null;
  $('#voicePreview').removeAttribute('src');
  $('#voicePreview').hidden = true;
  $('#voiceRecordPanel').hidden = true;
  $('#voiceButton').querySelector('.composer-label').textContent = 'Голосовое';
  $('#voiceButton').classList.remove('recording');
  $('#voiceSendButton').disabled = true;
  $('#voiceRecordLabel').textContent = 'Идёт запись';
  $('#recordingTimer').textContent = '00:00';
}
function stopVoiceRecording(discard = false) {
  state.discardVoice = discard;
  if (state.voiceTimer) clearInterval(state.voiceTimer);
  state.voiceTimer = null;
  if (state.activeMatch && state.socket?.connected) state.socket.emit('chat:recording', { matchId: state.activeMatch.matchId, recording: false });
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
    state.voiceStream?.getTracks().forEach(track => track.stop());
    return;
  }
  clearVoiceRecording();
}
async function startVoiceRecording() {
  if (state.voiceBlob || state.voicePreviewUrl) clearVoiceRecording();
  if (!state.activeMatch) return showToast('Сначала найди собеседника.');
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    return showToast('Микрофон доступен через HTTPS или localhost. Открой безопасное соединение.');
  }
  try {
    state.discardVoice = false;
    state.voiceStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const candidates = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
    const mimeType = candidates.find(type => { try { return MediaRecorder.isTypeSupported(type); } catch { return false; } });
    state.mediaRecorder = new MediaRecorder(state.voiceStream, mimeType ? { mimeType } : undefined);
    state.voiceChunks = [];
    state.voiceStartedAt = Date.now();
    state.mediaRecorder.addEventListener('dataavailable', event => { if (event.data?.size) state.voiceChunks.push(event.data); });
    state.mediaRecorder.addEventListener('error', () => { state.discardVoice = true; clearVoiceRecording(); showToast('Браузер прервал запись. Попробуй ещё раз.'); }, { once: true });
    state.mediaRecorder.addEventListener('stop', () => {
      state.voiceStream?.getTracks().forEach(track => track.stop());
      state.voiceStream = null;
      if (state.discardVoice) { clearVoiceRecording(); return; }
      const rawType = state.mediaRecorder?.mimeType || state.voiceChunks[0]?.type || 'audio/webm';
      const type = rawType.toLowerCase().includes('ogg') ? 'audio/ogg' : (rawType.toLowerCase().includes('mp4') ? 'audio/mp4' : 'audio/webm');
      state.voiceBlob = new Blob(state.voiceChunks, { type });
      if (!state.voiceBlob.size) { clearVoiceRecording(); return showToast('Не удалось записать голосовое.'); }
      state.voicePreviewUrl = URL.createObjectURL(state.voiceBlob);
      $('#voicePreview').src = state.voicePreviewUrl;
      $('#voicePreview').hidden = false;
      $('#voiceRecordLabel').textContent = 'Прослушай запись перед отправкой';
      $('#voiceSendButton').disabled = false;
      $('#voiceButton').querySelector('.composer-label').textContent = 'Голосовое';
  $('#voiceButton').classList.remove('recording');
    }, { once: true });
    state.mediaRecorder.start(250);
    state.socket?.emit('chat:recording', { matchId: state.activeMatch.matchId, recording: true });
    $('#voiceRecordPanel').hidden = false;
    $('#voicePreview').hidden = true;
    $('#voiceRecordLabel').textContent = 'Идёт запись';
    $('#voiceSendButton').disabled = true;
    $('#voiceButton').querySelector('.composer-label').textContent = 'Остановить';
    $('#voiceButton').classList.add('recording');
    state.voiceTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - state.voiceStartedAt) / 1000);
      $('#recordingTimer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      if (seconds >= 90) { stopVoiceRecording(false); showToast('Достигнут лимит голосового — 90 секунд.'); }
    }, 250);
  } catch (error) {
    clearVoiceRecording();
    showToast(error.name === 'NotAllowedError' ? 'Разреши доступ к микрофону в браузере.' : 'Не удалось включить микрофон. Проверь его подключение и HTTPS.');
  }
}
async function sendVoiceRecording() {
  if (!state.voiceBlob || !state.activeMatch) return;
  $('#voiceSendButton').disabled = true;
  setUploadStatus('Загружаем голосовое…');
  try {
    const file = await uploadMedia(state.voiceBlob, 'audio');
    sendMessage('', crypto.randomUUID(), { attachments: [file.id], kind: 'audio' });
    clearVoiceRecording();
    showToast('Голосовое добавлено в очередь отправки.');
  } catch (error) { $('#voiceSendButton').disabled = false; showToast(error.message); }
  finally { setUploadStatus(''); }
}
function renderStickerPanel() {
  const panel = $('#stickerPanel');
  panel.replaceChildren();
  const base = state.config.stickers || ['👋', '😂', '❤️', '🔥', '🥹', '🎉', '☕', '🐈'];
  const pack = STICKER_PACKS[state.user?.equipped?.stickers] || [];
  const tier = state.user?.subscriptionTier || 'free';
  const membershipPack = tier === 'premium' ? [...VIP_STICKERS,...PREMIUM_STICKERS] : (tier === 'vip' ? VIP_STICKERS : []);
  [...new Set([...base, ...pack, ...membershipPack])].forEach(sticker => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sticker-choice';
    button.textContent = sticker;
    button.setAttribute('aria-label', `Отправить стикер ${sticker}`);
    button.addEventListener('click', () => {
      sendMessage('', crypto.randomUUID(), { sticker });
      panel.hidden = true;
    });
    panel.append(button);
  });
}

async function submitReport() {
  $('#reportError').textContent = '';
  try {
    await api('/api/report', { method: 'POST', body: JSON.stringify({ category: $('#reportCategory').value, details: $('#reportDetails').value }) });
    closeModals();
    showToast('Жалоба отправлена. Спасибо, что помогаешь сохранять безопасность.');
  } catch (error) { $('#reportError').textContent = error.message; }
}
async function blockPartner() {
  if (!window.confirm('Заблокировать собеседника? Диалог завершится, и вы больше не попадёте друг к другу в подбор.')) return;
  try {
    await api('/api/block', { method: 'POST', body: '{}' });
    showToast('Пользователь заблокирован.');
  } catch (error) { showToast(error.message); }
}
function closeModals() { $$('.modal-backdrop').forEach(modal => { modal.hidden = true; }); }
function logout(showMessage = true, revokeServer = true) {
  const oldToken = state.token;
  if (revokeServer && oldToken) fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${oldToken}` } }).catch(() => {});
  clearSearchTimer();
  state.searching = false;
  if (state.socket) { state.socket.disconnect(); state.socket = null; }
  releaseMediaUrls();
  stopVoiceRecording(true);
  localStorage.removeItem('sovli_token');
  localStorage.removeItem('orbit_token');
  localStorage.removeItem('sovli_user_cache');
  state.token = '';
  state.user = null;
  state.activeMatch = null;
  state.messages = [];
  state.favorites = [];
  state.tokenHistoryLoaded = false;
  state.replyTarget = null;
  if ($('#replyPreview')) { $('#replyPreview').hidden = true; $('#replyPreview').querySelector('span').textContent = ''; }
  state.outbox = [];
  showAuth();
  if (showMessage) showToast('Ты вышел из аккаунта.');
}
function applyTheme() {
  const themeId = document.documentElement.dataset.storeTheme || state.user?.equipped?.theme || 'theme-light';
  const darkThemes = new Set(['theme-dark','theme-midnight','theme-aurora','theme-arcade','theme-violet-royal','wallpaper-deep-space','wallpaper-neon-city','wallpaper-cyber','wallpaper-pixel','wallpaper-arcade']);
  const resolved = darkThemes.has(themeId) ? 'dark' : 'light';
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || (resolved === 'dark' ? '#181827' : '#f5f6fb');
}
function renderSettingsControls() {
  const settings = state.settings;
  if ($('#settingSounds')) $('#settingSounds').checked = settings.sounds;
  if ($('#settingSoundVolume')) $('#settingSoundVolume').value = String(settings.soundVolume);
  if ($('#soundVolumeLabel')) $('#soundVolumeLabel').textContent = `${settings.soundVolume}%`;
  if ($('#settingMessageScale')) $('#settingMessageScale').value = settings.messageScale;
  if ($('#settingReducedMotion')) $('#settingReducedMotion').checked = settings.reducedMotion;
  if ($('#settingEnterToSend')) $('#settingEnterToSend').checked = settings.enterToSend !== false;
  if ($('#settingCompactChat')) $('#settingCompactChat').checked = Boolean(settings.compactChat);
  if ($('#settingBrowserNotifications')) $('#settingBrowserNotifications').checked = Boolean(settings.browserNotifications);
}
function applySettings() {
  applyTheme(state.settings.theme);
  const messages = $('#messages');
  if (messages) messages.dataset.messageScale = state.settings.messageScale;
  document.documentElement.classList.toggle('reduce-motion-user', Boolean(state.settings.reducedMotion));
  document.documentElement.classList.toggle('compact-chat-user', Boolean(state.settings.compactChat));
}
function scheduleSettingsSave(patch) {
  state.settings = { ...state.settings, ...patch };
  renderSettingsControls();
  applySettings();
  $('#settingsSaveStatus').textContent = 'Сохраняем…';
  clearTimeout(state.settingsSaveTimer);
  state.settingsSaveTimer = setTimeout(async () => {
    try {
      const result = await api('/api/settings', { method: 'PATCH', body: JSON.stringify(state.settings) });
      state.settings = { ...state.settings, ...result.settings };
      renderSettingsControls();
      applySettings();
      $('#settingsSaveStatus').textContent = 'Сохранено в аккаунте';
    } catch (error) {
      $('#settingsSaveStatus').textContent = 'Не удалось сохранить';
      showToast(error.message);
    }
  }, 350);
}
function playUiSound(frequency = 520) {
  if (!state.settings.sounds || state.settings.soundVolume <= 0) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    state.soundContext ||= new AudioContextClass();
    if (state.soundContext.state === 'suspended') state.soundContext.resume();
    const oscillator = state.soundContext.createOscillator();
    const gain = state.soundContext.createGain();
    const now = state.soundContext.currentTime;
    gain.gain.setValueAtTime(Math.max(0.0001, state.settings.soundVolume / 100 * 0.045), now);
    const soundStyle = state.user?.equipped?.sound;
    const soundProfiles = {
      'sound-soft-pop': { type: 'triangle', ratio: 0.78, duration: 0.11 },
      'sound-orbit-chime': { type: 'sine', ratio: 1.45, duration: 0.22 },
      'sound-arcade': { type: 'square', ratio: 1.8, duration: 0.09 },
      'sound-royal': { type: 'sine', ratio: 1.22, duration: 0.28 },
      'sound-rain': { type: 'triangle', ratio: 0.65, duration: 0.2 },
      'sound-bubble': { type: 'sine', ratio: 1.1, duration: 0.12 },
      'sound-synth': { type: 'sawtooth', ratio: 1.32, duration: 0.16 }
    };
    const profile = soundProfiles[soundStyle] || { type: 'sine', ratio: 1, duration: 0.14 };
    gain.gain.exponentialRampToValueAtTime(0.0001, now + profile.duration);
    oscillator.type = profile.type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.linearRampToValueAtTime(frequency * profile.ratio, now + profile.duration * 0.55);
    oscillator.connect(gain);
    gain.connect(state.soundContext.destination);
    oscillator.start(now);
    oscillator.stop(now + profile.duration + 0.02);
  } catch { /* Audio is optional and may be blocked by the browser. */ }
}
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  applyTheme();
  let cachedUser = null;
  const bootScreen = $('#sessionBootScreen');
  if (state.token) {
    try { cachedUser = JSON.parse(localStorage.getItem('sovli_user_cache') || 'null'); } catch { cachedUser = null; }
    if (cachedUser?.id) { setUser(cachedUser); showApp(); }
  }
  bootScreen.hidden = !state.token || Boolean(cachedUser?.id);
  try { state.config = await api('/api/config'); }
  catch { state.config = { languages: [], interests: [], avatars: ['🪐', '🌙', '🦊', '🐼'], matchingEnabled: true, publicMode: false }; }
  state.selectedLanguages = state.selectedLanguages.filter(value => state.config.languages.includes(value)).slice(0, 3);
  state.selectedInterests = state.selectedInterests.filter(value => state.config.interests.includes(value)).slice(0, 5);
  renderFilters();
  renderStickerPanel();
  $('#inviteCodeField').hidden = !state.config.inviteRequired;
  if (state.config.inviteRequired) $('#authInviteCode').required = true;
  if (state.config.matchingEnabled === false) {
    $('#findButton').disabled = true;
    $('#findButton').title = 'Подбор отключён в настройках сервера';
    $('#alphaNotice').querySelector('p').innerHTML = '<strong>Тестовый режим.</strong> Подбор временно выключен администратором. Попроси организатора проверить настройки сервера.';
  } else if (state.config.publicMode) {
    $('#alphaNotice').querySelector('p').innerHTML = '<strong>Закрытая тестовая бета.</strong> Доступ по коду приглашения. Общайся уважительно, не отправляй личные данные и используй жалобу/блокировку при проблемах.';
  }
  if (!state.token) { showAuth(); bootScreen.hidden = true; return; }
  state.authRestoring = true;
  try {
    const response = await api('/api/me');
    setUser(response.user);
    state.activeMatch = response.activeMatch;
    showApp();
    loadFavorites();
    connectSocket();
  } catch (error) {
    if (error.status === 401) {
      localStorage.removeItem('sovli_user_cache');
      logout(false);
      if (error.message?.includes('гостевого')) setAuthError(error.message);
    } else if (cachedUser?.id) {
      showApp();
      connectSocket();
      showToast('Восстанавливаем связь с сервером. Аккаунт сохранён.');
    } else {
      showAuth();
      setAuthError('Не удалось проверить сессию из-за временной ошибки связи. Обнови страницу — повторный вход не нужен.');
    }
  } finally {
    state.authRestoring = false;
    bootScreen.hidden = true;
    document.documentElement.classList.remove('session-checking');
  }
}

$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  setAuthError('');
  const username = $('#authUsername').value.trim();
  const password = $('#authPassword').value;
  const isRegister = state.authMode === 'register';
  if (username.length < 3 || username.length > 20) { setAuthError('Ник должен содержать от 3 до 20 символов.'); return; }
  if (password.length < 8) { setAuthError('Пароль должен содержать не менее 8 символов.'); return; }
  const button = $('#authSubmit');
  button.disabled = true;
  button.querySelector('span:first-child').textContent = isRegister ? 'Создаём аккаунт…' : 'Входим…';
  try {
    const response = await api(isRegister ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, accessCode: $('#authInviteCode').value.trim() })
    });
    state.token = response.token;
    localStorage.setItem('sovli_token', state.token);
    localStorage.removeItem('orbit_token');
    setUser(response.user);
    showApp();
    connectSocket();
    loadFavorites();
    showToast(isRegister ? 'Аккаунт создан. Теперь входи по никнейму и паролю.' : 'С возвращением!', 5000);
  } catch (error) { setAuthError(error.message); }
  finally {
    button.disabled = false;
    button.querySelector('span:first-child').textContent = isRegister ? 'Создать аккаунт' : 'Войти в SOVLI';
  }
});
$$('[data-auth-tab]').forEach(button => button.addEventListener('click', () => switchAuthMode(button.dataset.authTab)));
$('#guestButton').addEventListener('click', async () => {
  const button = $('#guestButton');
  button.disabled = true;
  button.querySelector('span:first-child').textContent = 'Готовим гостевой профиль…';
  setAuthError('');
  try {
    const response = await api('/api/auth/guest', { method: 'POST', body: JSON.stringify({ accessCode: $('#authInviteCode').value.trim() }) });
    state.token = response.token;
    localStorage.setItem('sovli_token', state.token);
    localStorage.removeItem('orbit_token');
    setUser(response.user);
    showApp();
    connectSocket();
    loadFavorites();
    showToast(`Привет, ${response.user.username}! Гостевой профиль сохранится в этом браузере до 180 дней.`);
  } catch (error) { setAuthError(error.message); }
  finally { button.disabled = false; button.querySelector('span:first-child').textContent = 'Продолжить гостем'; }
});
$('#findButton').addEventListener('click', startSearch);
$('#clearFiltersButton').addEventListener('click', () => { state.selectedLanguages = []; state.selectedInterests = []; $('#languagesDropdown').open = false; $('#interestsDropdown').open = false; renderFilters(); showToast('Фильтры сброшены.'); });
$('#nextChatButton').addEventListener('click', nextPartner);
$('#cancelSearchButton').addEventListener('click', cancelSearch);
$('#expandSearchButton').addEventListener('click', () => {
  state.selectedLanguages = [];
  state.selectedInterests = [];
  renderFilters();
  state.searching = false;
  state.socket?.emit('queue:cancel');
  clearSearchTimer();
  setTimeout(() => startSearch(), 120);
});
$('#logoutButton').addEventListener('click', () => logout());
$('#profileTopButton').addEventListener('click', () => setView('profile'));
$('#settingsTopButton').addEventListener('click', () => setView('settings'));
$('#sidePublicId').addEventListener('click', async () => {
  if (!state.user) return;
  try { await navigator.clipboard.writeText(state.user.publicId); showToast('Технический ID скопирован. Для входа используй ник и пароль.'); }
  catch { showToast(`Твой ID: ${state.user.publicId}`); }
});
$$('[data-view]').forEach(button => button.addEventListener('click', () => { setView(button.dataset.view); if (button.dataset.view === 'store') loadStore(); }));
$('#settingSounds').addEventListener('change', () => scheduleSettingsSave({ sounds: $('#settingSounds').checked }));
$('#settingSoundVolume').addEventListener('input', () => { $('#soundVolumeLabel').textContent = `${$('#settingSoundVolume').value}%`; });
$('#settingSoundVolume').addEventListener('change', () => scheduleSettingsSave({ soundVolume: Number($('#settingSoundVolume').value) }));
$('#settingMessageScale').addEventListener('change', () => scheduleSettingsSave({ messageScale: $('#settingMessageScale').value }));
$('#settingReducedMotion').addEventListener('change', () => scheduleSettingsSave({ reducedMotion: $('#settingReducedMotion').checked }));
$('#settingEnterToSend').addEventListener('change', () => scheduleSettingsSave({ enterToSend: $('#settingEnterToSend').checked }));
$('#settingCompactChat').addEventListener('change', () => scheduleSettingsSave({ compactChat: $('#settingCompactChat').checked }));
$('#settingBrowserNotifications').addEventListener('change', async () => {
  if ($('#settingBrowserNotifications').checked) {
    if (!('Notification' in window)) { $('#settingBrowserNotifications').checked = false; showToast('Этот браузер не поддерживает уведомления.'); return; }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { $('#settingBrowserNotifications').checked = false; showToast('Разрешение на уведомления не выдано.'); return; }
  }
  scheduleSettingsSave({ browserNotifications: $('#settingBrowserNotifications').checked });
});
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (state.settings.theme === 'system') applyTheme('system'); });
$('#rulesFooterButton').addEventListener('click', () => { $('#rulesModal').hidden = false; });
$('#authRulesButton').addEventListener('click', () => { $('#rulesModal').hidden = false; });
$$('[data-close-modal]').forEach(button => button.addEventListener('click', closeModals));
$$('.modal-backdrop').forEach(modal => modal.addEventListener('click', event => { if (event.target === modal) modal.hidden = true; }));
$('#endChatButton').addEventListener('click', () => {
  if (!state.activeMatch) return;
  if (!window.confirm('Завершить диалог? Переписка будет удалена.')) return;
  state.socket?.emit('chat:end', { matchId: state.activeMatch.matchId }, result => {
    if (!result?.ok) showToast(result?.error || 'Не удалось завершить диалог.');
  });
});
$('#reportButton').addEventListener('click', () => { $('#reportDetails').value = ''; $('#reportError').textContent = ''; $('#reportModal').hidden = false; });
$('#submitReportButton').addEventListener('click', submitReport);
$('#blockButton').addEventListener('click', blockPartner);
$('#cancelReplyButton')?.addEventListener('click', () => { state.replyTarget = null; $('#replyPreview').hidden = true; $('#replyPreview').querySelector('span').textContent = ''; });
$$('[data-quick-reply]').forEach(button => button.addEventListener('click', () => { const text = button.dataset.quickReply; sendMessage(text, crypto.randomUUID()); $('#quickReplies').open = false; }));
$('#storeInventoryButton')?.addEventListener('click', () => { state.storeCollectionOnly = !state.storeCollectionOnly; if (state.storeData) renderStore(state.storeData); });
$('#storeCollectionSelect')?.addEventListener('change', () => { state.storeCollectionFilter = $('#storeCollectionSelect').value; if (state.storeData) renderStore(state.storeData); });
$('#storeSearchInput')?.addEventListener('input', () => { state.storeSearch = $('#storeSearchInput').value; if (state.storeData) renderStore(state.storeData); });
$('#promoRedeemButton')?.addEventListener('click', redeemPromo);
$('#promoCodeInput')?.addEventListener('keydown', event => { if (event.key === 'Enter') redeemPromo(); });
$('#refreshReportsButton')?.addEventListener('click', loadAdmin);
$('#loadSessionsButton')?.addEventListener('click', loadSessions);
$('#favoritePartnerButton').addEventListener('click', toggleFavoritePartner);
$('#messageForm').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('#messageInput');
  const content = input.value.trim();
  if (!content) return;
  if (content.length > 2000) { showToast('Сообщение слишком длинное.'); return; }
  const clientId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  sendMessage(content, clientId);
  $('#stickerPanel').hidden = true;
  input.value = '';
  saveDraft('');
  input.style.height = 'auto';
  state.socket?.emit('chat:typing', { matchId: state.activeMatch?.matchId, typing: false });
});
$('#messageInput').addEventListener('input', () => {
  const input = $('#messageInput');
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 110)}px`;
  saveDraft(input.value);
  if (!state.activeMatch || !state.socket?.connected) return;
  state.socket.emit('chat:typing', { matchId: state.activeMatch.matchId, typing: true });
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => state.socket?.emit('chat:typing', { matchId: state.activeMatch?.matchId, typing: false }), 1200);
});
$('#messageInput').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && state.settings.enterToSend !== false) { event.preventDefault(); $('#messageForm').requestSubmit(); }
});
$('#photoButton').addEventListener('click', () => $('#photoInput').click());
$('#photoInput').addEventListener('change', () => sendSelectedPhotos($('#photoInput').files));
$('#stickerButton').addEventListener('click', () => { $('#stickerPanel').hidden = !$('#stickerPanel').hidden; });
$('#voiceButton').addEventListener('click', () => { if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') stopVoiceRecording(false); else startVoiceRecording(); });
$('#voiceDiscardButton').addEventListener('click', () => stopVoiceRecording(true));
$('#voiceSendButton').addEventListener('click', sendVoiceRecording);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') markRead(); });
window.addEventListener('focus', markRead);
$('#profileUsername').addEventListener('input', () => { $('#profilePreviewName').textContent = $('#profileUsername').value || state.user?.username || ''; });
$('#saveProfileButton').addEventListener('click', async () => {
  const button = $('#saveProfileButton');
  button.disabled = true;
  try {
    const profilePatch = { username: $('#profileUsername').value, description: $('#profileDescription')?.value || '' };
    if (state.selectedAvatar) profilePatch.avatar = state.selectedAvatar;
    const result = await api('/api/profile', { method: 'PATCH', body: JSON.stringify(profilePatch) });
    setUser(result.user);
    showToast('Профиль обновлён.');
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; }
});
$('#claimGuestButton').addEventListener('click', async () => {
  $('#claimError').textContent = '';
  const button = $('#claimGuestButton');
  button.disabled = true;
  try {
    const result = await api('/api/auth/claim', { method: 'POST', body: JSON.stringify({ username: $('#claimUsername').value.trim(), password: $('#claimPassword').value }) });
    state.token = result.token;
    localStorage.setItem('sovli_token', state.token);
    setUser(result.user);
    connectSocket();
    showToast('Гостевой профиль сохранён. Теперь можно входить по нику и паролю.');
  } catch (error) { $('#claimError').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#avatarUploadButton').addEventListener('click', () => $('#avatarFileInput').click());
$('#avatarFileInput').addEventListener('change', async () => {
  const file = $('#avatarFileInput').files?.[0]; if (!file) return;
  const button = $('#avatarUploadButton');
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { showToast('Поддерживаются JPG, PNG и WebP.'); $('#avatarFileInput').value = ''; return; }
  if (file.size > 2 * 1024 * 1024) { showToast('Аватар должен быть не больше 2 МБ.'); $('#avatarFileInput').value = ''; return; }
  button.disabled = true; button.textContent = 'Загружаем…';
  try {
    const response = await fetch('/api/avatar/upload', { method: 'POST', headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': file.type }, body: file });
    const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Не удалось загрузить аватар.');
    state.selectedAvatar = null; setUser(payload.user); showToast('Аватар обновлён.');
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; button.textContent = 'Загрузить своё фото'; $('#avatarFileInput').value = ''; }
});

$('#deleteAccountButton').addEventListener('click', async () => {
  if (!window.confirm('Удалить аккаунт без возможности восстановления?')) return;
  if (!window.confirm('Подтверди ещё раз: аккаунт и все связанные данные будут удалены.')) return;
  try {
    await api('/api/account', { method: 'DELETE' });
    logout(false);
    showToast('Аккаунт удалён.');
  } catch (error) { showToast(error.message); }
});

switchAuthMode('login');
boot();
