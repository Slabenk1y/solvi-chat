# Развёртывание SOVLI v1.2.0 только с телефона

Этот способ переносит backend с домашнего компьютера на Render. После успешного первого deploy ноутбук не нужен: Render держит процесс включённым, а панель `/owner` открывается как PWA на телефоне.

## Что понадобится

- Аккаунт GitHub.
- Аккаунт Render.
- Репозиторий GitHub с файлами этого проекта.
- Платный Render Web Service Starter и постоянный диск 1 GB. Текущий ориентир — около $7/месяц за сервис + $0.25/месяц за диск 1 GB; исходящий трафик сверх включённого лимита оплачивается отдельно. Перед подтверждением проверь цену в Render Dashboard.

## Шаг 1. Создай отдельный репозиторий

1. На телефоне открой GitHub и создай новый **Private repository** с именем `sovli-chat`.
2. Не используй `Slabenk1y/anonchat`: в нём находится отдельный старый Rust-проект «Эхо», а не текущая версия SOVLI.
3. Загрузи в новый репозиторий содержимое архива `SOVLI-v1.2.0.zip`, сохраняя структуру каталогов. Не загружай `.env`, `node_modules`, локальную `data/`, sqlite-файлы, `.jwt-secret`, `cloudflared.exe` и резервные копии.
4. Убедись, что `package.json`, `server.js`, `render.yaml`, `public/` и `.github/workflows/render-control.yml` лежат в корне/по указанным путям репозитория.

## Шаг 2. Создай Render Blueprint

1. Открой Render Dashboard на телефоне.
2. Выбери **New → Blueprint** и подключи GitHub.
3. Выбери новый репозиторий `sovli-chat`.
4. Render прочитает `render.yaml`. Проверь перед созданием:
   - Service: `sovli-chat`;
   - Plan: `starter` (не Free);
   - Region: Frankfurt;
   - Persistent disk: 1 GB, mount path `/var/data`;
   - Health check: `/api/health`.
5. Создай Blueprint и дождись успешного deploy.

`render.yaml` использует `npm install`, а не `npm ci`, потому что в исходном архиве нет npm lock-файла. Render сам добавит `PORT`; приложение слушает `0.0.0.0`.

## Шаг 3. Первый владелец

Публичная регистрация закрыта кодом приглашения.

1. В Render → сервис `sovli-chat` → Environment найди сгенерированное значение `PUBLIC_TEST_CODE` и скопируй его. Не публикуй этот код.
2. Открой публичный адрес Render (`https://...onrender.com`) и создай свой постоянный аккаунт с этим кодом.
3. В профиле SOVLI скопируй свой **Public ID**.
4. В Render → Environment добавь `OWNER_PUBLIC_ID=<твой Public ID>` и сохрани изменение. Render выполнит новый deploy.
5. Для стабильной сессии не меняй `JWT_SECRET` после первого запуска.

## Шаг 4. Включи мобильное управление Render

1. Создай API key в Render Account Settings → API Keys. Дай ключу минимально необходимые права на управление именно этим сервисом, если доступен scoped key.
2. В Render → сервис → Environment добавь `RENDER_API_KEY=<секретный ключ>`.
3. `RENDER_SERVICE_ID` и `RENDER_EXTERNAL_URL` Render предоставляет автоматически — вручную задавать их не нужно.
4. Сохрани Environment и дождись redeploy.
5. Зайди в SOVLI аккаунтом владельца и открой `/owner` → «Облачный сервер».
6. Нажми «Проверить облако». После настройки появятся состояние, публичный адрес и кнопка перезапуска.
7. В меню Chrome выбери «Установить приложение» / «Добавить на главный экран» — получится отдельная мобильная панель SOVLI Owner.

## Шаг 5. Запуск даже когда SOVLI остановлен

Когда Render полностью приостановлен, сайт `/owner` тоже недоступен и не может запустить сам себя. Для этого предусмотрен GitHub Actions workflow `.github/workflows/render-control.yml`.

1. В GitHub repository → Settings → Secrets and variables → Actions добавь:
   - `RENDER_API_KEY` — тот же Render API key;
   - `RENDER_SERVICE_ID` — ID сервиса из Render Dashboard.
2. В Render Environment добавь `SOVLI_GITHUB_ACTIONS_URL=https://github.com/<owner>/<repo>/actions/workflows/render-control.yml`.
3. Открой GitHub → Actions → **SOVLI cloud control** → Run workflow.
4. Выбери `resume`, `restart` или `suspend` и подтверди запуск.

Так можно возобновить даже полностью остановленный SOVLI с телефона. Не вставляй API key в URL, чат, заметки или frontend.

## Данные и ограничения

- SQLite и загруженные медиа пишутся в `/var/data` на постоянном диске.
- Persistent disk доступен одному экземпляру сервиса. Не увеличивай число инстансов, пока база остаётся SQLite на диске.
- При deploy/restart активные временные диалоги и несохранённые сообщения завершаются/очищаются согласно текущей политике retention.
- Данные из прежней локальной базы `data/orbit.sqlite` **автоматически не переносятся**. Для миграции с ноутбука понадобится сам файл базы, `.jwt-secret` и папка `uploads/`/`avatars/`; до миграции не начинай выдавать старые балансы или создавать платные покупки в новой базе.
- Это закрытая тестовая версия. Проверка возраста, разделение несовершеннолетних/взрослых и полноценная production-модерация ещё не завершены. Не открывай регистрацию широкой публике и не передавай invite code посторонним.
