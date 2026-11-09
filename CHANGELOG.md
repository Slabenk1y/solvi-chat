## v1.3.0 — 2026-11-09

### Persistent storage for Render Free
- Added a Neon PostgreSQL snapshot store for Render's ephemeral filesystem.
- The existing synchronous SQLite runtime is retained to avoid rewriting every chat, economy, store and owner route in one risky change.
- Neon stores all SQLite tables as one JSONB snapshot; snapshots are debounced after database writes and flushed during normal shutdown.
- User avatar binaries are stored separately in `sovli_avatar_files` and uploaded only when created or changed.
- Startup restores the Neon snapshot before normal SQLite migrations and temporary-chat cleanup. A first empty Neon project is seeded from the SQLite file available at first boot.
- Render deployments now require `DATABASE_URL`; the free Blueprint no longer declares a paid persistent disk.
- Added snapshot restore tests and a GitHub Actions CI workflow.

### Limitations
- This is a single-instance persistence bridge, not a normalized PostgreSQL migration. Do not scale horizontally.
- Render Free can sleep and has an ephemeral filesystem; Neon preserves saved data but does not remove Render cold starts.
- Active chats/messages and temporary media continue to be cleared on server restart by the app's existing retention policy.
- The latest write can be lost if the process is terminated abruptly during the short snapshot delay or if Neon is unavailable.

# Changelog

## v1.1.0 — 2026-11-09

### Mobile owner dashboard
- Added responsive `/owner` page for phone and desktop.
- Owner can view overview/economy, search accounts, change balances, roles and memberships, restrict/unrestrict users, create/disable promo codes, inspect active-dialog metadata, end a dialog, review reports and audit entries.
- Owner can start/stop public tunnel from the dashboard, select Cloudflare transport, see the public URL, invite code and recent tunnel logs.
- Existing server-side `authMiddleware` + `ownerOnly` guard protects all admin endpoints; opening `/owner` alone grants no rights.
- Added owner dashboard link in existing admin view and `owner-panel.bat` shortcut.

### Public access / diagnostics
- `start-public.bat` now detects an already-running SOVLI server and avoids starting a duplicate. When the server is already up, it opens the owner page; the owner can start the tunnel from phone over LAN.
- When no server is running, the BAT starts SOVLI and the managed tunnel in one process tree, avoiding the old two-server/port-3000 conflict.
- Server can spawn `cloudflared` for Quick Tunnel or use a named Tunnel token from `.env`.
- Added runtime status API and bounded tunnel log history.
- Added HTTP request status/latency logs, `trust proxy=loopback`, and explicit Node HTTP keep-alive/headers/request timeouts.
- Added optional named Tunnel settings `CLOUDFLARE_TUNNEL_TOKEN` and `CLOUDFLARE_PUBLIC_URL`.
- Added API to remove a temporary user suspension.
- Service Worker cache version updated to v11.

### Verification
- `npm run check` passed in the build environment.
- `npm run verify` passed: 158 site IDs, 138 main-app selectors, 20 SQLite tables, 57 products, 12 collections, 6 sticker packs, owner panel API linkage.
- Mobile owner HTML selectors: 49/49 found.
- Full Express/Socket.IO integration tests were not run in the build environment because npm package downloads timed out. Do not treat runtime or two-device testing as complete.

## v1.0.0 — 2026-11-09


### Профиль и бренд
- Переработана карточка профиля: cover, роль, срок подписки, описание, статистика и баланс.
- Поддержана собственная загрузка аватара (JPG/PNG/WebP, до 2 МБ) и выбор встроенного аватара.
- Добавлен оригинальный анимированный SVG-маскот «Сосис-Мышь».

### Магазин и инвентарь
- Каталог расширен до 57 предметов в 12 коллекциях.
- Добавлены дополнительные темы, обои, стили пузырьков, рамки, звуки, стикеры и титулы.
- Поддержаны предпросмотр, коллекции, фильтр по наличию, экипировка и снятие предмета.
- Инвентарь хранит предметы с датой и источником получения.
- Добавлен полноценный набор стикеров для каждого доступного пакета: сервер проверяет право отправки по экипированному набору.

### Экономика
- Убраны welcome и daily бонусы для новых аккаунтов.
- Гости и новые аккаунты стартуют с нулевым балансом.
- Старые балансы сохраняются.
- Начисление: по 1 токену каждому участнику за каждую полную минуту, если оба участника подключены к одному активному Socket.IO-диалогу.
- Время простоя не начисляется; активный остаток времени хранится в матче.
- Установлены высокие цены VIP/Premium: VIP 18 000 / 105 000 / 380 000; Premium 42 000 / 250 000 / 720 000 токенов (1/7/30 дней).

### Консоль владельца
- Добавлен `owner-console.bat` и интерактивный CLI.
- Доступ выдаётся только серверной проверкой `OWNER_PUBLIC_ID`.
- Поддержаны пользователи, баланс, промокоды, диалоги (только метаданные), цены магазина, роли, подписки, ограничения, жалобы, аудит и отзыв сессий.
- Добавлен API принудительного отзыва сессий пользователя.
- Пароль в интерактивном TTY скрывается при вводе.
- Просмотр содержимого личных переписок через owner console не предусмотрен.

### Интерфейс и надёжность
- Обновлены стили и предпросмотры коллекционных предметов.
- Исправлено отображение всех наборов стикеров после экипировки.
- Расширено применение тем, обоев, пузырьков и рамок.
- Звуковые предметы теперь имеют различные Web Audio профили.
- Обновлены BAT-версии и документация. BAT перед запуском прогоняет синтаксическую проверку и `verify`-аудит; добавлен `scripts/verify-project.cjs` с проверкой HTML/JS, каталога, паков и SQLite-схемы.
- Исправлен повтор пункта «Жалобы» в меню owner console.
- Исправлена точная версия `express-rate-limit` на опубликованную `8.7.0` (в предыдущем черновике стоял ошибочный pin `8.7.3`).

### Проверки и ограничения
- Синтаксис JavaScript проверен `npm run check`.
- `npm run doctor` в среде подготовки подтвердил Node.js 22.16, встроенную SQLite и доступность папки данных/порта, но выявил отсутствие внешних npm-пакетов.
- Полный runtime и интеграционные тесты не заявляются как пройденные.
- Возрастная проверка, полноценная production-модерация, E2EE и реальные платежи остаются отложенными.

## v0.9.0
- Исправлены реакции и ссылки reply, предпросмотры/экипировка магазина, добавлены управления блокировками и сессиями.

## v1.2.0 — 2026-11-09
- Added Render Blueprint with paid always-on web service and persistent disk for SQLite and uploads.
- Added phone-first deploy guide and installable owner PWA cloud-control tab.
- Added owner-guarded Render API status, restart and suspend controls; Render API key remains server-side.
- Added GitHub Actions workflow for resume/restart/suspend while SOVLI is stopped.
- Changed Render build from `npm ci` to `npm install` because package-lock.json is not present in the source archive.
- Hide local Quick Tunnel controls when app detects Render hosting.
- Documented that local DB migration is manual and that persistent SQLite disk is single-instance.
