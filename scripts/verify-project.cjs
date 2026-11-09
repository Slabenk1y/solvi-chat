'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const fail = message => { console.error(`[FAIL] ${message}`); process.exitCode = 1; };
const pass = message => console.log(`[OK] ${message}`);

try {
  const pkg = JSON.parse(read('package.json'));
  if (pkg.version !== '1.7.0') fail(`Ожидалась версия 1.7.0, получена ${pkg.version}`);
  else pass(`Версия проекта ${pkg.version}`);

  const html = read('public/index.html');
  const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length) fail(`Повторяющиеся HTML id: ${duplicates.join(', ')}`);
  else pass(`HTML: ${ids.length} уникальных id`);

  const app = read('public/app.js');
  const selectors = [...new Set([...app.matchAll(/\$\$?\(\s*["']#([A-Za-z][\w:-]*)["']/g)].map(match => match[1]))];
  const missing = selectors.filter(id => !ids.includes(id));
  if (missing.length) fail(`JS-селекторы отсутствуют в HTML: ${missing.join(', ')}`);
  else pass(`JS: ${selectors.length} прямых id-селекторов найдены в HTML`);

  const server = read('server.js');
  const schemaMatch = server.match(/db\.exec\(`([\s\S]*?)`\);\s*\n\s*(?:await initializePersistentStorage\(\);\s*\n\s*)?\/\/ Backward-compatible migration/);
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
  const expectedMembershipRates = [
    "id: 'vip-1h', tier: 'vip', hours: 1, price: 180",
    "id: 'vip-3h', tier: 'vip', hours: 3, price: 540",
    "id: 'vip-6h', tier: 'vip', hours: 6, price: 1080",
    "id: 'premium-1h', tier: 'premium', hours: 1, price: 360",
    "id: 'premium-3h', tier: 'premium', hours: 3, price: 1080",
    "id: 'premium-6h', tier: 'premium', hours: 6, price: 2160"
  ];
  if (expectedMembershipRates.some(item => !membershipSection.includes(item)) || !server.includes("pack.hours * 60 * 60 * 1000")) fail('Часовые цены VIP/Premium не совпадают с формулой 180/360 токенов за час');
  else pass('VIP 180 ✦/ч и Premium 360 ✦/ч проверены для пакетов 1/3/6 часов');
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
  if (!owner.includes("choice === '14'") || !owner.includes("choice === '15'")) fail('Не найдены пункты 14/15 owner-console');
  else pass('Команды отзыва сессий и закрытия жалоб присутствуют');

  const sw = read('public/sw.js');
  if (!/sovli-shell-v18/.test(sw)) fail('Service Worker cache version не соответствует v1.7.0');
  else pass('Service Worker cache version обновлён');

  if (!server.includes('parent.sender_id === userId') || !server.includes('Нельзя отвечать на собственное сообщение')) fail('Сервер не запрещает ответы на собственные сообщения');
  else pass('Ответы на собственные сообщения блокируются сервером');
  if (!app.includes('function openStorePreview') || !html.includes('id="storePreviewModal"')) fail('Предпросмотр предметов магазина отсутствует');
  else pass('У каждого предмета магазина доступен отдельный предпросмотр');
  if (!html.includes('id="sessionBootScreen"') || !app.includes("classList.remove('session-checking')")) fail('Экран восстановления сессии не настроен');
  else pass('При перезагрузке отображается экран восстановления сессии, а не форма входа');
  if (!server.includes('Гостевой профиль может менять только аватар.') || !app.includes('DEFAULT_AVATARS')) fail('Гостевые и стандартные аватары не восстановлены');
  else pass('Стандартные и пользовательские аватары доступны гостям и аккаунтам');
  const favoritesRoute = server.slice(server.indexOf("app.get('/api/favorites'"), server.indexOf("app.post('/api/favorites'"));
  if (!favoritesRoute.includes('SELECT u.id, u.username, u.avatar, u.avatar_file') || favoritesRoute.includes('description: row.description') || favoritesRoute.includes('publicId: row.public_id')) fail('Избранное должно возвращать только карточку с аватаром и ником');
  else pass('Избранное не раскрывает лишние поля профиля и не содержит функций связи');
  if (!app.includes('function createLiveStorePreview(item)') || !app.includes('visual.replaceChildren(createLiveStorePreview(item))') || !html.includes('id="storePreviewPerks"')) fail('В магазине нет живого макета интерфейса и списка видимых изменений');
  else pass('Предпросмотр показывает макет SOVLI, а не только отдельный символ/описание');
  if (!server.includes('const VIP_STICKERS') || !server.includes('const PREMIUM_STICKERS') || !app.includes('const VIP_STICKERS') || !app.includes('const PREMIUM_STICKERS')) fail('VIP/Premium sticker packs are not synchronized between client and server');
  else pass('VIP и Premium имеют отдельные синхронизированные наборы стикеров');
  if (!server.includes('membershipCurrent: effectiveSubscription(user)') || !app.includes('function renderMembershipPerks(user)') || !app.includes('function renderMembershipQuickReplies(user)')) fail('Преимущества статусов или отображение текущей подписки отсутствуют');
  else pass('Преимущества VIP/Premium отображаются в профиле и быстрых фразах');
  if (!app.includes('playStoreSoundPreview(item.value)')) fail('Звуковой предпросмотр не воспроизводит выбранный товар');
  else pass('Звуковой предпросмотр использует выбранный звуковой товар');

  if (!html.includes('composer-tool-photo') || !html.includes('composer-tool-sticker') || !html.includes('composer-tool-voice')) fail('Иконки вложений чата отсутствуют');
  else pass('Иконки фото, стикеров и голосовых присутствуют');


  for (const file of ['start.bat', 'start-public.bat', 'owner-console.bat', 'owner-panel.bat', 'stop-server.bat', '.env.example', 'README.md', 'PROJECT_PROGRESS.md', 'lib/postgres-snapshot.cjs', 'public/owner.html', 'public/owner.css', 'public/owner.js']) {
    if (!fs.existsSync(path.join(root, file))) fail(`Отсутствует обязательный файл ${file}`);
  }
  const snapshot = read('lib/postgres-snapshot.cjs');
  if (!server.includes('DATABASE_URL') || !server.includes('PostgresSnapshotStore') || !snapshot.includes('sovli_persistent_state')) fail('Neon persistent snapshot integration is missing');
  else pass('Neon persistent snapshot storage is connected');

  const ownerHtml = read('public/owner.html');
  for (const endpoint of ['/api/admin/runtime', '/api/admin/runtime/public/start', '/api/admin/runtime/public/stop', '/api/admin/users']) if (!read('public/owner.js').includes(endpoint)) fail(`Mobile owner panel does not call ${endpoint}`);
  if (!ownerHtml.includes('id=\"dashboardView\"') || !ownerHtml.includes('id=\"loginView\"')) fail('Mobile owner panel login/dashboard missing');
  else pass('Мобильная панель владельца и её основные API на месте');
  if (!process.exitCode) pass('Комплект запуска и документации на месте');
} catch (error) {
  fail(error.stack || error.message);
}

if (process.exitCode) process.exit(process.exitCode);
console.log('\n[SOVLI] Статическая проверка проекта завершена успешно.');
