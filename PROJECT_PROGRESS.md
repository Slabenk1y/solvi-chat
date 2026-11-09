# PROJECT_PROGRESS — SOVLI v1.1.0

Последнее обновление: 2026-11-09.

## Состояние релиза

SOVLI v1.1.0 — закрытая beta-сборка с управляемым публичным туннелем и адаптивной веб-панелью владельца `/owner`. Сохранены API, SQLite-миграции и данные v1.0.0. Статические проверки `npm run check` и `npm run verify` прошли. Полный HTTP/Socket.IO runtime и двухклиентский тест в среде подготовки не выполнены: npm registry недоступен, `socket.io-client` не установлен. Ошибки Cloudflare 520/1033 нельзя считать устранёнными без теста на сети владельца; для устойчивого постоянного доступа нужен Named Tunnel и собственный hostname.

### Новое в v1.1.0
- Один процесс Node управляет cloudflared, выдаёт статус/URL/логи туннеля и может запускать/останавливать Quick или Named Tunnel из owner-only API.
- `start-public.bat` проверяет уже работающий локальный сервер и не пытается занять порт 3000 второй раз.
- Мобильная панель владельца `/owner`: пользователи, балансы, роли, VIP/Premium, ограничения, промокоды, метаданные диалогов, жалобы, журнал аудита и публичный доступ.
- Серверные журналы запросов фиксируют метод, путь, статус и задержку без записи тела сообщений или токенов.

## Реализовано в коде

### Аккаунт и профиль
- Регистрация по уникальному нику и паролю.
- Гостевой профиль с серверным сроком действия 24 часа и возможностью конвертировать его в постоянный аккаунт.
- Гостям запрещено редактировать ник/аватар и загружать собственный аватар.
- Постоянные аккаунты могут изменить ник/описание, выбрать встроенный аватар или загрузить JPG/PNG/WebP до 2 МБ.
- Профиль показывает Public ID, роль/подписку, дату регистрации, баланс, статистику и экипированный титул.

### Поиск и диалог
- Серверная очередь 1-на-1, язык/интересы, отмена, следующий собеседник.
- Socket.IO, сообщения, ответы, реакции с серверными ограничениями, typing/presence, фото и голосовые вложения.
- Стикеры ограничиваются базовым набором и тем sticker-pack, который экипирован пользователем.
- Диалоговые данные имеют временный характер и очищаются при завершении по текущим правилам retention.

### Магазин и инвентарь
- Каталог содержит 57 предметов в 12 коллекциях.
- Поддерживаются предпросмотр, поиск, категории, коллекции, покупка, инвентарь, экипировка/снятие и история транзакций.
- Предметы хранятся в `store_inventory` с `source` и датой получения.
- Титулы, темы, обои, пузырьки, рамки, звуковые профили и наборы стикеров применяются клиентом.

### Экономика
- Новые аккаунты и гости получают 0 токенов.
- Удалены ежедневные бонусы и welcome начисления.
- Старые балансы сохраняются миграцией.
- Один токен начисляется каждому из двух участников за полную минуту, только когда оба имеют подключённый Socket.IO socket с тем же `activeMatchId`.
- При отключении одной стороны начисление приостанавливается. Время сервера после рестарта не начисляется.
- VIP: 18k / 105k / 380k за 1/7/30 дней. Premium: 42k / 250k / 720k.
- Реальных платежей и токеновых пакетов за деньги нет.

### Управление владельца
- Отдельный `owner-console.bat` + `scripts/owner-console.cjs`.
- `OWNER_PUBLIC_ID` проверяется сервером; роль нельзя выдать из браузера.
- Сводка и экономика, поиск пользователей, корректировки токенов, промокоды, метаданные диалогов/завершение, цена/доступность магазина, подписки, роли, ограничения, жалобы, audit log.
- Добавлен отзыв всех активных сессий выбранного аккаунта; owner target защищён от данной операции.
- Консоль не читает приватные сообщения. Жалобы показывают контекст, отправленный пользователем.

### UI
- Переработанная карточка профиля.
- Магазин с 12 коллекциями и отдельной инвентарной страницей.
- SVG mascot «Сосис-Мышь»; анимации ожидания/поиска.
- Стили применения тем, обоев, пузырьков, рамок; индивидуальные звуковые профили.

## Проверки

- `npm run check`: PASS (node --check для server.js, app.js, sw.js, doctor.cjs, owner-console.cjs, verify-project.cjs, integration.test.js).
- `npm run verify`: PASS — 158 уникальных HTML id, 138 прямых JS-селекторов совпадают с HTML, 57 уникальных предметов, 12 коллекций, 6 стикерпаков совпадают на клиенте/сервере, owner API-маршруты присутствуют, SQLite-схема из 20 таблиц выполняется в памяти.
- Статический аудит HTML/селекторов предыдущих версий прошёл; после v1.0 нужно повторить полный HTML/DOM smoke test.
- `npm run doctor`: Node.js v22.16 и встроенная SQLite доступны; `data/` доступна для записи; порт 3000 свободен. Внешние пакеты `express`, `socket.io`, `bcryptjs`, `jsonwebtoken`, `express-rate-limit`, `helmet`, `dotenv` не установлены в данной среде, поэтому doctor ожидаемо завершился FAIL по dependencies.
- `npm test` пытался запуститься, но завершился на `MODULE_NOT_FOUND: socket.io-client`; npm install повторно завершился `EAI_AGAIN` при DNS-запросе к `registry.npmjs.org`. Полный HTTP smoke test, двухклиентский Socket.IO test, реальная загрузка медиа и owner-console login не запускались. Не считать пройденными.

## Предварительные решения

- SQLite остаётся встроенной через `node:sqlite`; минимальная версия Node — 22.16.
- Владелец задаётся только через `OWNER_PUBLIC_ID` в `.env` после регистрации.
- Owner console работает через серверные owner-only API.
- Экономика считает только время совместного подключения обоих участников к одному активному матчу.
- VIP/Premium косметические и не дают приоритета в поиске.
- Публичный тест только invite-only до внедрения полноценной возрастной защиты и модерации.

## Отложено / не заявляется готовым

- Полная проверка возраста и разделение возрастных групп.
- Полноценная production-модерация, антигруминг и команда модераторов.
- E2EE.
- Голосовые/видеозвонки, push notifications, Android/iOS.
- Реальные платежи, пополнение токенов, возвраты, финансовый учёт.
- Нагрузочное тестирование и производственный мониторинг.

## Следующий шаг

На Windows после распаковки выполнить `start.bat`, убедиться в `SOVLI v1.1.0 — сервер запущен`, затем прогнать `npm run verify`, `npm run doctor` и `npm test`. Отдельно проверить с двух разных устройств: поиск, чат, фото, голосовое, стикеры каждого набора, начисление токена после 60 активных секунд, магазин, экипировку, промокод и owner console.


## v1.1.0 — Mobile owner dashboard and managed tunnel

### Implemented
- Added responsive owner web panel at `/owner`, including owner login and overview, public tunnel, users, promo codes, dialogs, reports and audit tabs.
- Added owner APIs for runtime status, public tunnel start/stop, matching toggle and un-suspension. All are guarded by server-side owner role.
- `start-public.bat` detects an existing local server and avoids duplicate port launches. If already running, it opens `/owner`; if not, starts server with managed tunnel.
- Added named Cloudflare Tunnel support with `CLOUDFLARE_TUNNEL_TOKEN` and `CLOUDFLARE_PUBLIC_URL`.
- Added HTTP response logging and request timeout settings to help diagnose edge/origin errors.
- Added `owner-panel.bat` shortcut; updated Service Worker cache to v11.

### Verified in build environment
- `node --check` for server and owner panel.
- `npm run check` — passed.
- `npm run verify` — passed.
- Owner page selector audit: 49 unique selectors, none missing.
- Existing SQLite schema: 20 tables still creates in-memory.

### Not verified
- Full server start and two-device Socket.IO test: external npm packages unavailable in build environment after `npm install` timed out.
- Cloudflare connectivity cannot be guaranteed by source changes; Quick Tunnel has no uptime guarantee. Named Tunnel with a Cloudflare account/domain is the recommended stable deployment.

### Operational limitation
- Mobile admin can control users and the tunnel only while the host computer and Node server are already running. A web panel cannot start a stopped server process or power on the Windows PC.

## v1.2.0 — Cloud deployment and phone-first owner control (2026-11-09)

### Реализовано в исходниках
- Добавлен Render Blueprint `render.yaml`: Node web service, Starter plan, Frankfurt, 1 GB persistent disk `/var/data`, SQLite/media storage via `DATA_DIR`, generated JWT secret/invite code, health check `/api/health`.
- Render build command использует `npm install` (не `npm ci`), потому что package-lock отсутствует в архиве.
- Render API доступен только после `authMiddleware + ownerOnly`; API key не отправляется клиенту.
- Owner API: статус облачного сервиса, health-check, restart и suspend; действия пишутся в admin audit log.
- Мобильная PWA панель `/owner` получила вкладку «Облачный сервер», статусы, restart/suspend и ссылки на Render/GitHub Actions.
- Добавлен GitHub Actions workflow с `workflow_dispatch`: `resume`, `restart`, `suspend`. Он предназначен для возобновления сервиса, когда сам сайт уже остановлен.
- На Render отдельный Cloudflare Quick Tunnel скрывается: Render сам выдаёт HTTPS URL и поддерживает WebSocket.
- Добавлены `DEPLOY_FROM_PHONE.md`, обновлённые README/DEPLOYMENT и статический cloud validator.

### Проверено
- `npm run check`: PASS.
- `npm run verify`: PASS — 158 HTML ID, 138 JS selector, 20 SQLite tables, 57 items / 12 collections / 6 sticker packs; Render Blueprint and phone control checks PASS.
- Python YAML parse: Render Blueprint читается; workflow YAML синтаксически корректен (PyYAML 1.1 показывает ключ `on` как boolean, GitHub Actions использует собственную YAML интерпретацию).
- Runtime deploy и HTTP/Socket.IO проверка на Render не запускались: у проекта ещё нет созданного Render service и подключённого Git-репозитория SOVLI.

### Не завершено / требует аккаунт пользователя
- Создать новый GitHub repository для SOVLI. Существующий `Slabenk1y/anonchat` — отдельный старый Rust-проект «Эхо», его нельзя перезаписывать.
- Создать Render Blueprint из нового репозитория и подтвердить оплачиваемый Starter plan + persistent disk.
- После первого deploy зарегистрировать владельца, выставить `OWNER_PUBLIC_ID`, добавить `RENDER_API_KEY`, GitHub Actions secrets и `SOVLI_GITHUB_ACTIONS_URL`.
- Миграция локальной базы пользователя не выполняется автоматически: нужен `data/orbit.sqlite`, `.jwt-secret` и uploads/avatars с прежнего компьютера.
- Возрастная проверка, полноценная production-модерация, правовая/retention проверка остаются обязательными перед открытым запуском.

### Стоимость и инфраструктурные ограничения
- Текущий ориентир Render Starter: около $7/месяц + $0.25/месяц за 1 GB disk, bandwidth сверх включённого объёма отдельно; сверить цену перед созданием.
- Persistent disk доступен одному service instance, поэтому SQLite нельзя горизонтально масштабировать.
- После первого cloud deploy ноутбук не нужен для работы сайта; если service suspended, используйте Render Dashboard Resume или GitHub Actions workflow.
- `npm test`: NOT PASSED in preparation environment; test process stops at missing `socket.io-client`. Full integration remains unverified until dependencies are installed and the deployed service is tested with two clients.
