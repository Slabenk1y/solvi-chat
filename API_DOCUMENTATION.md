# API Documentation — SOVLI v1.1.0

Все `/api` маршруты, кроме публичных health/config/auth, требуют `Authorization: Bearer <JWT>`. Данные JSON. В API включены валидация и rate limits для чувствительных операций.

## Public / authentication

- `GET /api/health` — readiness endpoint.
- `GET /api/config` — языки, интересы, список базовых стикеров, доступность публичного режима и лимиты медиа.
- `POST /api/auth/register` — регистрация по нику и паролю; стартовый баланс 0.
- `POST /api/auth/login` — вход по нику/паролю, invite code при закрытом публичном режиме.
- `POST /api/auth/guest` — временный гостевой аккаунт, стартовый баланс 0, срок 24 часа.
- `POST /api/auth/claim-guest` — конвертация гостя в постоянный аккаунт.
- `POST /api/auth/logout` — отзыв текущей сессии.
- `GET /api/me` — профиль и восстановление активного матча.
- `GET /api/sessions`, `DELETE /api/sessions/:sessionId` — список и отзыв своих сессий.

## Profile / settings

- `PATCH /api/profile` — постоянный ник, описание до 160 символов, встроенный аватар.
- `POST /api/avatar/upload` — JPG/PNG/WebP до 2 МБ; сервер проверяет сигнатуру файла.
- `GET /api/avatar/:userId` — публичный аватар.
- `GET /api/settings`, `PATCH /api/settings` — настройки аккаунта.

## Store / inventory / tokens

- `GET /api/store` — каталог, категории, коллекции, экипировка, инвентарь и пакеты подписок.
- `POST /api/store/buy` — покупка товара с серверным списанием токенов и транзакцией.
- `POST /api/store/equip` — экипировка купленного предмета.
- `DELETE /api/store/equip/:slot` — снять предмет слота.
- `GET /api/inventory` — приобретённые/полученные предметы и экипировка.
- `GET /api/store/transactions` — история токенов.
- `POST /api/store/membership` — покупка VIP/Premium за токены.
- `POST /api/promos/redeem` — активация действующего промокода один раз на аккаунт.
- Нет публичного daily-reward endpoint. Welcome/daily начисления удалены.

## Social / safety

- `GET/POST/DELETE /api/favorites` (DELETE: `/api/favorites/:userId`).
- `GET/POST/DELETE /api/blocks` (DELETE: `/api/blocks/:userId`).
- `POST /api/report` — жалоба на текущего собеседника и ограниченный контекст.
- `/api/media` — временная загрузка/доступ медиа текущего диалога.

## Owner-only API

Доступ проверяется серверной функцией `ownerOnly` и `OWNER_PUBLIC_ID`.

- `GET /api/admin/overview`, `GET /api/admin/economy`, `GET /api/admin/audit`.
- `GET /api/admin/users?q=&limit=`.
- `POST /api/admin/users/:id/tokens` — положительная/отрицательная корректировка с причиной.
- `POST /api/admin/users/:id/logout` — отзыв всех сессий выбранного пользователя (кроме владельца), закрывает активный матч и удаляет пользователя из очереди.
- `POST /api/admin/users/:id/membership` — выдать/снять VIP/Premium.
- `POST /api/admin/users/:id/role` — member/moderator/developer (owner не назначается этим маршрутом).
- `POST /api/admin/users/:id/suspend` — временное ограничение.
- `GET /api/admin/matches`, `POST /api/admin/matches/:id/end` — только технические метаданные диалогов и завершение.
- `GET/POST /api/admin/promos`, `PATCH /api/admin/promos/:id` — управление промокодами.
- `PATCH /api/admin/store/:itemId/price` — цена/наличие предмета.
- `GET /api/admin/reports`, `POST /api/admin/reports/:id/resolve` — обработка жалоб.

Owner API не предоставляет скрытого чтения полной переписки. Активные диалоги отображаются как метаданные: участники, ID, длительность/статус. Контекст в жалобе ограничен сообщениями, приложенными к обращению.

## Socket.IO events

Client → server:
- `queue:join`, `queue:cancel`, `chat:next`.
- `chat:send`, `chat:typing`, `chat:read`, `chat:react`, `chat:recording`.
- `chat:end`.

Server → client:
- `queue:waiting`, `queue:cancelled`, `match:found`.
- `chat:message`, `chat:status`, `chat:read-receipt`, `chat:reactions`, `chat:recording`.
- `chat:typing`, `chat:restored`, `chat:ended`.
- `presence:count`, `wallet:updated`, `auth:expired`, `account:deleted`.

## Economy

Сервер начисляет 1 токен каждому участнику за полную минуту, если оба userId имеют активный Socket.IO socket с тем же `activeMatchId`. При отключении одной стороны время не учитывается. Временные значения ведутся в `matches.active_seconds` и `matches.credited_minutes`; каждая выплата отражается в `token_transactions` и `token_earning_daily`.


## Owner runtime APIs (v1.1.0)

- `GET /api/admin/runtime` — server, public mode, tunnel state, URL, invite code and recent diagnostic lines. Owner only.
- `POST /api/admin/runtime/public/start` — start Quick Tunnel or configured named Tunnel. Body: `{ "protocol": "auto|http2|quic", "matching": true }`. Owner only.
- `POST /api/admin/runtime/public/stop` — stop tunnel and disable public mode. Owner only.
- `PATCH /api/admin/runtime/matching` — body `{ "enabled": true|false }`. Owner only.
- `DELETE /api/admin/users/:id/suspend` — remove a temporary suspension. Owner only.
- `GET /owner` — responsive owner dashboard shell; every data operation still requires authenticated owner API access.

## Render cloud controls (v1.2.0)

All routes require a valid owner session (`authMiddleware` + `ownerOnly`).

- `GET /api/admin/platform/render` — fetches service state from Render API and checks public `/api/health`. Returns only operational metadata; the Render API key is never returned.
- `POST /api/admin/platform/render/restart` — asks Render to restart the configured service.
- `POST /api/admin/platform/render/suspend` — asks Render to suspend the service. After this operation the SOVLI owner UI is unavailable until resumed from Render Dashboard or GitHub Actions.

Server environment:
- `RENDER_API_KEY` — secret Render API key; required for cloud control.
- `RENDER_SERVICE_ID` — automatically injected by Render.
- `RENDER_EXTERNAL_URL` — automatically injected by Render.
- `SOVLI_GITHUB_ACTIONS_URL` — optional URL to the repo Actions workflow for resume/restart/suspend while service is offline.
