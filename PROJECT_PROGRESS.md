# PROJECT_PROGRESS — SOLVI v1.8.0

Последнее обновление: 2026-11-09.

## v1.8.0 — подготовка к публичному запуску

- Единый бренд SOLVI в приложении, мобильной панели и PWA manifest. Домен `solvi-chat.onrender.com` уже совпадает с SOLVI, поэтому сохраняем текущий адрес.
- Пользовательские тикеты для идей и баг-репортов: создание, приватная переписка, ответы владельца, статусы «Открыт / В работе / Закрыт».
- 50 ✦ за регистрацию постоянного аккаунта; начисление записывается в историю токенов.
- Избранное теперь для завершённых чатов. После завершения пользователь сам подтверждает сохранение. Текст и стикеры архивируются; временные медиа удаляются по прежней политике.
- Медиалимиты: Free — 3 фото и 30 секунд голосового; VIP — 5 фото и 45 секунд; Premium — 10 фото и 60 секунд.
- Голосовая запись использует mono capture, 48 kHz, шумоподавление, эхоподавление, автоматическую регулировку усиления и компактный Opus bitrate.
- Добавлены VIP-пак «Звёздный след» и Premium-пак «Квантовый портал», по 5 предметов в каждом.
- Server-side проверки: число вложений, право доступа к тикетам и соответствие статуса для покупки наборов.
- Перед сбросом создан Neon snapshot. Сброс пользователей выполняется отдельным одноразовым запуском, который проверяет OWNER_PUBLIC_ID и не удаляет аккаунт владельца.

## Launch checklist

- [ ] Verify production `ownerAccountPresent=true` before enabling purge.
- [ ] Reset non-owner accounts only; verify a single owner remains.
- [ ] Confirm GitHub CI and Render deployment are successful.
- [ ] Verify `/api/health` and sign in to `/owner`.
- [ ] Run smoke tests for registration reward, tickets, archive, photo and voice caps.
- [ ] Review public privacy/rules copy, favicon and official domain.
- [ ] Prepare launch copy, screenshots and first feedback cycle.
