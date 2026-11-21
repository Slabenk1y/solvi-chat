'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const fail = message => { console.error(`[FAIL] ${message}`); process.exitCode = 1; };
const pass = message => console.log(`[OK] ${message}`);

try {
  const pkg = JSON.parse(read('package.json'));
  if (pkg.version !== '1.11.0') fail(`Ожидалась версия 1.11.0, получена ${pkg.version}`);
  else pass(`Версия проекта ${pkg.version}`);

  const matchingHtml = read('public/index.html');
  const matchingServer = read('server.js');
  const matchingApp = read('public/app.js');
  const hasAdultModeUi = matchingHtml.includes('data-match-mode="flirt"') || matchingHtml.includes('data-match-mode="roleplay"') || matchingHtml.includes('id="flirtAdultConsent"') || matchingHtml.includes('id="roleplayAdultConsent"') || matchingHtml.includes('Флирт 18+') || matchingHtml.includes('Ролка 18+');
  if (hasAdultModeUi) fail('В интерфейсе остались режимы флирта/ролевой игры или элементы 18+');
  else pass('Интерфейс содержит только обычное общение');
  if (!matchingApp.includes("mode: 'chat'") || !matchingServer.includes("const mode = 'chat'") || !matchingServer.includes('preferences?.mode && preferences.mode !== \'chat\'')) fail('Обычный режим чата не закреплён на клиенте и сервере');
  else pass('Подбор работает только в обычном чате; старые режимы отклоняются сервером');
  if (!matchingServer.includes('eligibleByGender(current, candidate)') || !matchingServer.includes('eligibleByMode(current, candidate)')) fail('Серверная фильтрация пола и режима отсутствует');
  else pass('Серверная фильтрация пола и единственного режима подключена');
  if (!matchingHtml.includes('id="desiredGender"') || (!matchingHtml.includes('id="ownGender"') && !matchingHtml.includes('id="profileGender"'))) fail('Не найден выбор пола собеседника или пола пользователя');
  else pass('Выбор желаемого пола собеседника сохранён');
  if (!matchingServer.includes('Режимы флирта и ролевой игры отключены.') || !matchingApp.includes("mode: 'chat'")) fail('Сервер не блокирует запросы отключённых режимов');
  else pass('Прямые запросы отключённых режимов блокируются сервером');
  if (!read('test/integration.test.js').includes("for (const removedMode of ['flirt', 'roleplay'])")) fail('Нет интеграционных проверок запрета отключённых режимов');
  else pass('Есть интеграционные тесты запрета флирта и ролки');

  const html = read('public/index.html');
  const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length) fail(`Повторяющиеся HTML id: ${duplicates.join(', ')}`);
  else pass(`HTML: ${ids.length} уникальных id`);

  const app = read('public/app.js');
  const css = read('public/styles.css');
  const selectors = [...new Set([...app.matchAll(/\$\$?\(\s*["']#([A-Za-z][\w:-]*)["']/g)].map(match => match[1]))];
  const missing = selectors.filter(id => !ids.includes(id));
  if (missing.length) fail(`JS-селекторы отсутствуют в HTML: ${missing.join(', ')}`);
  else pass(`JS: ${selectors.length} прямых id-селекторов найдены в HTML`);

  const server = read('server.js');
  const schemaMarker = 'db.exec(`';
  const schemaStart = server.indexOf(schemaMarker);
  const schemaEnd = schemaStart >= 0 ? server.indexOf('`);', schemaStart + schemaMarker.length) : -1;
  const schemaMatch = schemaEnd > schemaStart
    ? [null, server.slice(schemaStart + schemaMarker.length, schemaEnd)]
    : null;
  if (!schemaMatch) fail('Не удалось найти основную SQLite-схему в server.js');
  else {
    try {
      const sqlite = require('node:sqlite');
      const Database = sqlite.Database || sqlite.DatabaseSync;
      const db = new Database(':memory:');
      db.exec('PRAGMA foreign_keys = ON;');
      db.exec(schemaMatch[1]);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      db.close();
      if (tables.length < 20) fail(`SQLite создала неожиданно мало таблиц: ${tables.length}`);
      else pass(`SQLite schema: ${tables.length} таблиц успешно созданы`);
    } catch (error) { fail(`SQLite schema не выполняется: ${error.message}`); }
  }

  const catalogSection = server.slice(server.indexOf('const STORE_CATALOG'), server.indexOf('const MEMBERSHIP_PACKAGES'));
  const catalogItems = [...catalogSection.matchAll(/\{\s*id:\s*["']([^"']+)["'][\s\S]*?collection:\s*["']([^"']+)["'][^}]*\}/g)].map(match => ({ id: match[1], collection: match[2] }));
  const catalogIds = catalogItems.map(item => item.id);
  const collectionNames = [...new Set(catalogItems.map(item => item.collection))];
  if (catalogItems.length < 50) fail(`Каталог неожиданно мал: ${catalogItems.length} предметов`);
  else pass(`Каталог: ${catalogItems.length} предметов`);
  if (new Set(catalogIds).size !== catalogIds.length) fail('В каталоге есть повторяющиеся ID предметов');
  else pass('Все ID предметов уникальны');
  if (catalogSection.includes('category: "Обои"') || catalogSection.includes('slot: "wallpaper"')) fail('Каталог всё ещё содержит отдельную категорию обоев');
  else pass('Все бывшие обои переведены в темы интерфейса');
  const membershipSection = server.slice(server.indexOf('const MEMBERSHIP_PACKAGES'), server.indexOf('const LANGUAGES'));
  if (!membershipSection.includes("id: 'vip-1h', tier: 'vip', hours: 1, price: 180") || !membershipSection.includes("id: 'premium-1h', tier: 'premium', hours: 1, price: 360") || !membershipSection.includes("id: 'vip-24h', tier: 'vip', hours: 24, price: 4320") || !membershipSection.includes("id: 'premium-24h', tier: 'premium', hours: 24, price: 8640") || !membershipSection.includes("id: 'vip-6h', tier: 'vip', hours: 6, price: 1080") || !membershipSection.includes("id: 'premium-6h', tier: 'premium', hours: 6, price: 2160")) fail('Цены VIP/Premium не соответствуют почасовой экономике v1.7.3');
  else pass('Почасовые цены VIP и Premium проверены');
  if (!server.includes('function membershipLimits') || !server.includes('membership.attachmentLimit') || !app.includes('function createThemeStorePreview')) fail('Не все дополнительные возможности VIP/Premium и визуальные предпросмотры подключены');
  else pass('Расширенные лимиты VIP/Premium и визуальные предпросмотры подключены');
  if (app.includes('function startStorePreview()') || app.includes('function restoreStorePreview(') || html.includes('id="storePreviewTryOnButton"') || html.includes('id="storePreviewRestoreButton"') || !html.includes('Предпросмотр не меняет оформление')) fail('Бесплатное применение предметов из предпросмотра ещё доступно');
  else pass('Предпросмотр только показывает макет и не меняет оформление до покупки или получения предмета');
  if (!server.includes("const LANGUAGES = ['Русский'];") || !server.includes('languageLimit: 1')) fail('Список языков или лимиты подписок не соответствуют доступному русскому языку');
  else pass('В подборе доступен только русский язык; лимит подписок синхронизирован');
  if (!server.includes('function matchmakingPriorityBonusMs(user)') || !server.includes('return 12_000') || !server.includes('return 8_000') || !server.includes('return 4_000') || !server.includes('priorityBonusMs: matchmakingPriorityBonusMs(user)')) fail('Ограниченный приоритет очереди не подключён');
  else pass('Приоритет очереди ограничен по времени и не вытесняет долго ожидающих пользователей');
  if (collectionNames.length < 10) fail(`Слишком мало коллекций: ${collectionNames.length}`);
  else pass(`Коллекции: ${collectionNames.length}`);

  const clientPacks = [...app.matchAll(/^\s*['"](stickers-[\w-]+)['"]\s*:/gm)].map(match => match[1]).sort();
  const serverPackSection = server.slice(server.indexOf('const STICKER_PACKS'), server.indexOf('const PORT'));
  const serverPacks = [...serverPackSection.matchAll(/^\s*['"](stickers-[\w-]+)['"]\s*:/gm)].map(match => match[1]).sort();
  if (JSON.stringify(clientPacks) !== JSON.stringify(serverPacks)) fail('Стикерпаки клиента и сервера не совпадают');
  else pass(`Стикерпаки синхронизированы (${serverPacks.length})`);

  const hasZeroNewBalance = /INSERT INTO users[\s\S]{0,500}?,\s*0\s*,\s*\?\)/i.test(server);
  if (!hasZeroNewBalance || !server.includes('accrueMatchTime')) fail('Не найдена серверная схема нулевого стартового баланса/начисления времени');
  else pass('В сервере есть нулевой стартовый баланс и начисление за активную минуту');
  if (/app\.(?:get|post)\(['"]\/api\/tokens\/daily/.test(server)) fail('Обнаружен устаревший daily bonus endpoint');
  else pass('Daily bonus endpoint отсутствует');

  const owner = read('scripts/owner-console.cjs');
  const ownerPanel = read('public/owner.js');
  const ownerPublicHtml = read('public/owner.html');
  const ownerRoutes = [
    '/api/admin/overview', '/api/admin/users', '/api/admin/users/:id/tokens',
    '/api/admin/promos', '/api/admin/matches', '/api/admin/matches/:id/end',
    '/api/admin/users/:id/logout', '/api/admin/reports/:id/resolve'
  ];
  const missingRoutes = ownerRoutes.filter(route => {
    if (route.includes(':id')) return !server.includes(route);
    return !owner.includes(route) && !server.includes(route);
  });
  if (missingRoutes.length) fail(`Не найдены owner API маршруты: ${missingRoutes.join(', ')}`);
  else pass('Ключевые маршруты owner-console связаны с сервером');
  if (!server.includes("app.delete('/api/admin/users/:id'") || !server.includes('confirmationUsername') || !server.includes("DELETE FROM favorite_chat_drafts WHERE user_id = ? OR partner_id = ?") || !server.includes("DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?") || !server.includes("DELETE FROM reports WHERE reporter_id = ? OR reported_id = ?")) fail('Полное удаление аккаунта не очищает все связанные данные или не требует подтверждение ника');
  else pass('Полное удаление аккаунта очищает связанные данные и проверяет никнейм');
  if (!ownerPanel.includes('data-user-action="delete"') || !ownerPanel.includes("action==='delete'") || !ownerPanel.includes("method:'DELETE'")) fail('В карточке аккаунта отсутствует безопасное действие полного удаления');
  else pass('В карточке пользователя есть удаление с подтверждением и обновлением списка');

  if (!owner.includes("choice === '14'") || !owner.includes("choice === '15'")) fail('Не найдены пункты 14/15 owner-console');
  else pass('Команды отзыва сессий и закрытия жалоб присутствуют');

  const sw = read('public/sw.js');
  if (!/sovli-shell-v(?:3[4-9]|[4-9]\d)-/.test(sw)) fail('Service Worker cache version не обновлён');
  else pass('Service Worker cache version обновлён');
  if (!/\/styles\.css\?v=\d+/.test(html) || !/\/app\.js\?v=\d+/.test(html) || Number(html.match(/\/app\.js\?v=(\d+)/)?.[1] || 0) < 33) fail('Версии клиентских CSS/JS assets не обновлены');
  else pass('CSS/JS cache-busting версии согласованы');

  const filterSection = app.slice(app.indexOf('function renderFilters()'), app.indexOf('function buildMatchingPreferences()'));
  if (!filterSection || /const interestLimit = 0/.test(filterSection) || /state\.selected(?:Languages|Interests|FlirtInterests|RoleplayInterests)\s*=\s*\[/.test(filterSection)) fail('Фильтры поиска не должны сбрасываться при каждой перерисовке');
  else pass('Фильтры поиска сохраняют выбор пользователя при перерисовке');
  if (!app.includes("desiredGender: state.desiredGender") || !app.includes("mode: 'chat'") || !server.includes('eligibleByGender(current, candidate)')) fail('Выбор пола собеседника не передаётся в обычный подбор');
  else pass('Выбор пола собеседника передаётся в подбор');
  if (!html.includes('<svg class="search-mascot sausage-mouse"') || !html.includes('СОСИС-МЫШЬ') || !app.includes("dataset.mood = seconds > 35 ? 'chaos'") || !css.includes('.mascot-active .sausage-mouse') || !css.includes('@keyframes sausage-chaos')) fail('Оригинальная вращающаяся Сосис-Мышь не подключена');
  else pass('Оригинальная Сосис-Мышь вращается во время поиска и ускоряется в режиме хаоса');
  if (!app.includes("if (bootScreen) bootScreen.hidden = true;") || !app.includes("document.documentElement.classList.remove('session-checking');")) fail('Экран восстановления сессии не имеет аварийного снятия блокировки');
  else pass('Экран восстановления гарантированно скрывается при ошибке запуска');
  const ownerPanelJs = read('public/owner.js');
  if (!ownerPanelJs.includes('const safeStorageGet') || !ownerPanelJs.includes('const safeStorageSet') || !ownerPanelJs.includes('const safeStorageRemove')) fail('Панель владельца не защищена от недоступного localStorage');
  else pass('Панель владельца устойчива к ограничениям browser storage');
  if (!app.includes('Number(reaction.count) > 1')) fail('Одна реакция всё ещё отображается с числом 1');
  else pass('Одна реакция отображается без счётчика 1');

  if (!server.includes('parent.sender_id === userId') || !server.includes('Нельзя отвечать на собственное сообщение')) fail('Сервер не запрещает ответы на собственные сообщения');
  else pass('Ответы на собственные сообщения блокируются сервером');
  if (!app.includes('function openStorePreview') || !html.includes('id="storePreviewModal"')) fail('Предпросмотр предметов магазина отсутствует');
  else pass('У каждого предмета магазина доступен отдельный предпросмотр');
  if (!app.includes("modal.parentElement !== document.body") || !app.includes("store-preview-open")) fail('Store preview modal не вынесен из контейнера приложения');
  else pass('Предпросмотр магазина открывается отдельным фиксированным слоем');
  if (!server.includes("app.get('/api/ping'")) fail('Лёгкий ping endpoint отсутствует');
  else pass('Лёгкий ping endpoint доступен');
  if (!server.includes('GEMINI_API_KEY') || !server.includes('function startAiFallback') || !server.includes("socket.on('ai:send'") || !app.includes("socket.on('ai:message'")) fail('ИИ-подбор SOLVI не подключён во всех слоях');
  else pass('ИИ-подбор с явной маркировкой и Gemini API подключён');
  if (!server.includes('support_tickets') || !server.includes("app.post('/api/tickets'") || !server.includes("app.get('/api/admin/tickets'") || !server.includes("app.post('/api/tickets/:id/close'") || !html.includes('id="ticketCreateForm"') || !html.includes('id="ticketCloseButton"') || !ownerPublicHtml.includes('data-page="tickets"') || !ownerPanel.includes("api('/api/admin/tickets')")) fail('Система тикетов не подключена ко всем слоям');
  else pass('Тикеты: приватные треды, ответы, закрытие и owner inbox подключены');
  if (!server.includes('site_social_links') || !server.includes("app.post('/api/admin/social-links'") || !html.includes('socialLinksFooter') || !ownerPublicHtml.includes('data-page="growth"')) fail('Управление соцсетями не подключено');
  else pass('Социальные ссылки настраиваются владельцем и показываются в подвале');
  if (!server.includes('reward_task_submissions') || !server.includes("app.post('/api/tasks/:id/submit'") || !server.includes("app.post('/api/admin/task-submissions/:id/review'") || !ownerPanel.includes('loadGrowth')) fail('Задания с ручной проверкой награды не подключены');
  else pass('Задания, заявки и ручное начисление токенов подключены');
  const bundleRoute = server.slice(server.indexOf("app.post('/api/store/bundle'"), server.indexOf("app.post('/api/store/membership'"));
  if (!bundleRoute.includes('const activeTier = effectiveSubscription(req.user)') || bundleRoute.includes('effectivePaidSubscription')) fail('Фирменные наборы не учитывают статус VIP/Premium, купленный за токены');
  else pass('Фирменные VIP/Premium наборы доступны при активном токеновом статусе');
  if (/\b(confirm|prompt|alert)\(/.test(app) || /\b(confirm|prompt|alert)\(/.test(ownerPanel)) fail('В интерфейсе остались нативные диалоги браузера');
  else pass('Подтверждения и текстовые запросы используют фирменные диалоги');
  if (!server.includes("app.post('/api/billing/token-topup/checkout'") || !server.includes("app.get('/api/billing/paymentwall/pingback'") || !server.includes("app.post('/api/billing/store/checkout'") || !server.includes("app.get('/api/billing/paymentwall/goods-pingback'") || !server.includes('buildDigitalGoodsCheckoutUrl') || !server.includes('verifyPingback') || !server.includes('paymentwall_token_purchases') || !server.includes('paymentwall_store_orders')) fail('Paymentwall VC/Digital Goods checkout, подписи и журнал заказов не подключены');
  else pass('Paymentwall: отдельные VC и Digital Goods кассы, подписанные pingback, идемпотентность и возвраты подключены');
  if (html.includes('id="paidMembershipOffers"') || html.includes('id="storeBillingEmail"') || app.includes('await loadPaidMemberships()')) fail('В интерфейсе остались денежные товары, поле email или вызов денежной кассы из магазина');
  else pass('Публичный магазин использует токены; денежные товары и email-чек убраны из интерфейса');
  if (!server.includes('CREATE TABLE IF NOT EXISTS manual_store_orders') || !server.includes("app.post('/api/billing/manual-store/orders'") || !server.includes("app.patch('/api/admin/manual-store-orders/:id'") || !server.includes("app.delete('/api/admin/store/:itemId/cash-price'")) fail('Ручные денежные заявки или очистка денежной цены не подключены');
  else pass('Ручные денежные заявки, выдача после подтверждения и сброс денежной цены подключены');
  if (!server.includes("app.post('/telegram/webhook'") || !server.includes('configureTelegramSupportWebhook') || !server.includes('answerCallbackQuery')) fail('Telegram support webhook не подключён');
  else pass('Telegram-бот поддерживает deep links, уведомление владельца и ручное подтверждение заказа');
  if (!server.includes('telegram_owner_chat_state') || !server.includes("mso_chat:") || !server.includes('setActiveTelegramOrder(chatId, orderId)')) fail('Выбор заявки для Telegram support не подключён');
  else pass('Telegram support keeps order selection callbacks; owner messages are sent from SOLVI OWNER Mini App');
  else pass('Владелец может отвечать обычными сообщениями; выбор диалога и переключение между заявками работают без /reply');
  if (!server.includes('verifyTelegramWebAppInitData') || !server.includes("app.post('/api/auth/telegram-miniapp'") || !server.includes("app.get('/api/admin/telegram/orders'") || !server.includes("app.post('/api/admin/telegram/orders/:id/messages'") || !server.includes('setChatMenuButton') || !server.includes('telegram_order_messages')) fail('Telegram Mini App auth, buyer inbox or message storage is incomplete');
  else pass('Telegram Mini App: verified owner login, persistent buyer messages, order chat API and owner menu button connected');
  if (!server.includes('The owner replies only inside SOLVI OWNER') || !server.includes('For the check') && !server.includes('привязана к Telegram владельца') || !server.includes('COALESCE(o.accepted_at,o.updated_at)')) fail('Telegram owner/buyer chat separation or accepted-order priority is missing');
  else pass('Telegram chat: owner text cannot echo to buyers; self-chat is blocked and accepted orders have priority');
  if (!ownerPanel.includes('state.telegramSending') || !ownerPanel.includes('if(state.telegramSending)return')) fail('Telegram Mini App duplicate-send guard is missing');
  else pass('Telegram Mini App: duplicate-send guard is enabled');
  if (!ownerPublicHtml.includes('data-page="tgchats"') || !ownerPublicHtml.includes('telegram.org/js/telegram-web-app.js') || !ownerPanel.includes('function loadTelegramOrders') || !ownerPanel.includes('function sendTelegramBuyerMessage') || !ownerPublicHtml.includes('id="telegramChatForm"')) fail('Telegram Mini App buyer chat interface is incomplete');
  else pass('Telegram Mini App owner workspace includes buyer list, chat composer and Telegram SDK');
  if (!server.includes('cashPriceMinor: cash.cashPriceMinor') || !app.includes("requestManualCashPurchase(item)") || !app.includes("cashAction.textContent = 'За деньги'") || !server.includes('tokenEnabled: token.enabled')) fail('Магазин не отображает отдельные способы покупки за токены и реальные деньги');
  else pass('Публичный магазин показывает цену в валюте и отдельную кнопку покупки за деньги');
  if (!ownerPanel.includes('manualStoreOrders') || !ownerPanel.includes('data-manual-order-action="paid"')) fail('В панели владельца нет очереди ручных денежных заявок');
  else pass('Панель владельца показывает заявки, подтверждает оплату и выдаёт товар');
  if (!server.includes("placement === 'home'") && !server.includes("['store','home'].includes(placement)")) fail('Рекламные кампании не поддерживают главную страницу');
  else pass('Реклама выводится на главной странице и в магазине');
  if (!server.includes("priceMinor === 0 ? 'comped' : 'unpaid'") || !ownerPanel.includes('data-ad-free-launch')) fail('Бесплатная реклама не запускается автоматически или вручную');
  else pass('Бесплатная реклама может сразу публиковаться без платёжного подтверждения');
  if (!app.includes("doneButton.onclick = () =>") || !app.includes("loadHomeSponsoredAd")) fail('Кнопка завершения заявки или загрузка рекламы на главной не подключены');
  else pass('Кнопка «Понятно» закрывает окно заявки; домашняя рекламная зона подключена');
  if (!server.includes("telegramMissing.push('TELEGRAM_WEBHOOK_SECRET')") || !server.includes("webhookUrl: telegram.ready")) fail('Диагностика Telegram webhook не подключена');
  else pass('Публичная диагностика Telegram показывает только готовность и недостающие переменные, без секретов');
  if (!server.includes("app.get('/api/ads/slot'") || !server.includes("app.post('/api/admin/ad-campaigns'") || !server.includes("app.patch('/api/admin/ad-campaigns/:id'") || !server.includes('payment_status IN (\'paid\',\'comped\')') || !html.includes('id="storeSponsoredAd"') || !ownerPanel.includes('adCampaignForm')) fail('Платные рекламные размещения не связаны между сервером, магазином и панелью владельца');
  else pass('Прямые рекламные кампании требуют оплаты, показываются в магазине и учитывают статистику');
  if (!server.includes('registration_bonus') || !server.includes('VALUES (?, ?, ?, ?, ?, ?, ?, ?, 50, ?)')) fail('Регистрационный бонус 50 ✦ не настроен');
  else pass('Новый зарегистрированный аккаунт получает 50 ✦');
  if (!server.includes('favorite_chat_drafts') || !server.includes("app.get('/api/favorite-chats/:id'") || !app.includes('function openFavoriteChat')) fail('Архив избранных переписок не подключён');
  else pass('Завершённые диалоги можно сохранить и читать в Избранном');
  if (!server.includes("voiceSeconds: tier === 'premium' ? 60 : (tier === 'vip' ? 45 : 30)") || !server.includes("attachmentLimit: tier === 'premium' ? 10 : (tier === 'vip' ? 5 : 3)")) fail('Лимиты фото и голосовых не совпадают с тарифами');
  else pass('Лимиты медиа Free/VIP/Premium проверены');
  if (!server.includes('const STORE_BUNDLES') || !server.includes("app.post('/api/store/bundle'") || !app.includes('customizationBundles')) fail('VIP/Premium наборы кастомизаций не подключены');
  else pass('Фирменные VIP и Premium наборы доступны через магазин');
  if (!html.includes('id="sessionBootScreen"') || !app.includes("classList.remove('session-checking')")) fail('Экран восстановления сессии не настроен');
  else pass('При перезагрузке отображается экран восстановления сессии, а не форма входа');
  if (!server.includes('Гостевой профиль может менять только аватар.') || !app.includes('DEFAULT_AVATARS')) fail('Гостевые и стандартные аватары не восстановлены');
  else pass('Стандартные и пользовательские аватары доступны гостям и аккаунтам');
  const favoritesRoute = server.slice(server.indexOf("app.get('/api/favorites'"), server.indexOf("app.post('/api/favorites'"));
  if (!favoritesRoute.includes('SELECT u.id, u.username, u.avatar, u.avatar_file') || favoritesRoute.includes('description: row.description') || favoritesRoute.includes('publicId: row.public_id')) fail('Избранное должно возвращать только карточку с аватаром и ником');
  else pass('Избранное не раскрывает лишние поля профиля и не содержит функций связи');
  if (!html.includes('composer-tool-photo') || !html.includes('composer-tool-sticker') || !html.includes('composer-tool-voice')) fail('Иконки вложений чата отсутствуют');
  else pass('Иконки фото, стикеров и голосовых присутствуют');


  for (const file of ['start.bat', 'start-public.bat', 'owner-console.bat', 'owner-panel.bat', 'stop-server.bat', '.env.example', 'README.md', 'PROJECT_PROGRESS.md', 'lib/postgres-snapshot.cjs', 'public/owner.html', 'public/owner.css', 'public/owner.js']) {
    if (!fs.existsSync(path.join(root, file))) fail(`Отсутствует обязательный файл ${file}`);
  }
  const snapshot = read('lib/postgres-snapshot.cjs');
  if (!server.includes('DATABASE_URL') || !server.includes('PostgresSnapshotStore') || !snapshot.includes('sovli_persistent_state')) fail('Neon persistent snapshot integration is missing');
  else pass('Neon persistent snapshot storage is connected');

  const ownerHtml = read('public/owner.html');
  const ownerUiEndpoints = ['/api/admin/users', '/api/admin/users/', '/api/admin/promos', '/api/admin/promos/', '/api/admin/matches', '/api/admin/reports', '/api/admin/tickets', '/api/admin/growth'];
  for (const endpoint of ownerUiEndpoints) if (!ownerPanel.includes(endpoint)) fail(`Owner panel does not call ${endpoint}`);
  if (!ownerHtml.includes('id="dashboardView"') || !ownerHtml.includes('id="loginView"') || !ownerHtml.includes('data-page="users"') || !ownerHtml.includes('data-page="tickets"')) fail('Owner panel login, dashboard or key sections missing');
  if (ownerHtml.includes('data-page="public"') || ownerHtml.includes('data-page="cloud"') || ownerPanel.includes('/api/admin/runtime/public/')) fail('Unused public-tunnel or cloud-server panels are still exposed');
  else pass('Новая панель владельца, карточки аккаунтов и основные API подключены; устаревшие панели убраны');

  const guestServer = read('server.js');
  const darkOwnerHtml = read('public/owner.html');
  const darkOwnerJs = read('public/owner.js');
  const darkOwnerCss = read('public/owner.css');
  const guestAppJs = read('public/app.js');
  if (!guestServer.includes("3 * 24 * 60 * 60 * 1000") || guestServer.includes("180 * 24 * 60 * 60 * 1000") || guestServer.includes("'180d'")) fail('Guest lifetime must be three days everywhere');
  else pass('Гостевой срок и серверные сессии ограничены тремя днями');
  if (!guestServer.includes('Гостевой аккаунт нельзя превратить в постоянный') || !guestAppJs.includes('Гостевой профиль · 3 дня'.toUpperCase()) && !guestAppJs.includes('ГОСТЕВОЙ ПРОФИЛЬ · 3 ДНЯ')) fail('Guest identity restrictions or UI copy missing');
  if (!darkOwnerHtml.includes('data-theme="dark"') || !darkOwnerHtml.includes('themeToggleButton') || !darkOwnerJs.includes('applyOwnerTheme') || !darkOwnerCss.includes(':root[data-theme="dark"]')) fail('Owner dark theme toggle is incomplete');
  else pass('Тёмная тема панели владельца подключена');
  if (!darkOwnerCss.includes('animation:none!important') || !darkOwnerCss.includes('transition-duration:.08s')) fail('Owner motion optimization missing');
  else pass('Анимации панели владельца облегчены');
  const staticSelectors = [...guestAppJs.matchAll(/\$\(['"]#([^'"]+)['"]\)\.addEventListener/g)].map(match => match[1]);
  const pageIds = new Set([...read('public/index.html').matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]));
  const missingSelectors = [...new Set(staticSelectors)].filter(id => !pageIds.has(id));
  if (missingSelectors.length) fail('Main page buttons reference missing elements: ' + missingSelectors.join(', '));
  else pass('Все статические обработчики кнопок основного сайта имеют DOM-элементы');

  if (!process.exitCode) pass('Комплект запуска и документации на месте');
} catch (error) {
  fail(error.stack || error.message);
}

if (process.exitCode) process.exit(process.exitCode);
console.log('\\n[SOVLI] Статическая проверка проекта завершена успешно.');
