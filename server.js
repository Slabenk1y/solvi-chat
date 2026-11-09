'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const express = require('express');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { rateLimit } = require('express-rate-limit');
const { Server } = require('socket.io');
const sqlite = require('node:sqlite');
const { PostgresSnapshotStore } = require('./lib/postgres-snapshot.cjs');
const SqliteDatabase = sqlite.Database || sqlite.DatabaseSync;
const APP_VERSION = require('./package.json').version;

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DB_FILE = path.join(DATA_DIR, 'orbit.sqlite'); // legacy filename retained to preserve existing installations
const SECRET_FILE = path.join(DATA_DIR, '.jwt-secret');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const AVATAR_DIR = path.join(DATA_DIR, 'avatars');
const MAX_AVATAR_BYTES = 8 * 1024 * 1024;
const NATIVE_DB_BACKUP = path.join(DATA_DIR, 'orbit.pre-v5-sqlitejs.backup.sqlite');
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const BASE_STICKERS = Object.freeze(['👋', '😂', '❤️', '🔥', '🥹', '🎉', '☕', '🐈']);
const STICKER_PACKS = Object.freeze({
  'stickers-night-owl': ['✨', '🌙', '🚀', '🫶', '👀', '🫡', '🤝', '💫'],
  'stickers-sausage': ['🌭', '🐭', '🧀', '😵‍💫', '🥨', '💨'],
  'stickers-chaos': ['🤪', '🫠', '🫨', '💥', '🙃', '🌀'],
  'stickers-food': ['🍔', '🍟', '🍕', '🌮', '🍩', '🥤'],
  'stickers-sausage-mouse': ['🐭', '🌭', '🧀', '😳', '🏃', '💨', '👑', '🥹'],
  'stickers-deep-sea': ['🐠', '🐙', '🪼', '🐬', '🦀', '🐚'],
  'stickers-vip-comet': ['🌌', '💫', '🪐', '☄️', '✨', '🌠'],
  'stickers-premium-quantum': ['🪩', '🌀', '💎', '🔮', '⚛️', '🌌']
});
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_MESSAGE_LENGTH = 2000;
let PUBLIC_MODE = process.env.PUBLIC_MODE === '1';
let PUBLIC_MATCHING = process.env.PUBLIC_MATCHING === '1';
let PUBLIC_TEST_CODE = String(process.env.PUBLIC_TEST_CODE || '').trim();
const STORE_TITLES = Object.freeze({
  'title-star-guide': 'Проводник звёзд',
  'title-night-owl': 'Ночной житель',
  'title-legend': 'Локальная легенда',
  'title-good-vibes': 'Добрая энергия',
  'title-collector': 'Коллекционер',
  'title-first-contact': 'Первый контакт',
  'title-sakura-keeper': 'Хранитель сакуры',
  'title-night-circuit': 'Ночной контур'
});
const DEFAULT_SETTINGS = Object.freeze({ theme: 'system', sounds: true, soundVolume: 35, messageScale: 'normal', reducedMotion: false, enterToSend: true, compactChat: false, browserNotifications: false });
const RECONNECT_GRACE_MS = 60_000;
const AVATARS = ['🪐', '🌙', '🦊', '🐼', '🐸', '🦉', '🐳', '🦋', '🐙', '🌵', '🍀', '🧩'];

const tunnelRuntime = { process: null, state: 'stopped', url: '', protocol: 'auto', error: '', logs: [], startedAt: null };
function tunnelLog(line) {
  const clean = String(line || '').replace(/[\u0000-\u0008]/g, '').slice(0, 600);
  if (!clean) return;
  tunnelRuntime.logs.push(`${new Date().toISOString()} ${clean}`);
  if (tunnelRuntime.logs.length > 40) tunnelRuntime.logs.shift();
  console.log(`[TUNNEL] ${clean}`);
  const urlMatch = clean.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
  if (urlMatch) { tunnelRuntime.url = urlMatch[0]; tunnelRuntime.state = 'connected'; }
  if (/serve tunnel error|connection with edge closed|failed to serve incoming request/i.test(clean)) {
    tunnelRuntime.state = 'degraded';
    tunnelRuntime.error = clean.slice(0, 300);
  }
  if (/registered tunnel connection/i.test(clean)) {
    tunnelRuntime.state = tunnelRuntime.url ? 'connected' : 'connecting';
    tunnelRuntime.error = '';
  }
}
function cloudflaredPath() {
  const configured = process.env.CLOUDFLARED_PATH;
  return configured ? path.resolve(configured) : path.join(ROOT, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
}
function startCloudflareQuickTunnel(protocol = 'auto') {
  if (tunnelRuntime.process && !tunnelRuntime.process.killed) return { ok: true, alreadyRunning: true };
  const executable = cloudflaredPath();
  if (!fs.existsSync(executable)) throw new Error(`cloudflared не найден: ${executable}. Запусти start-public.bat, чтобы установить клиент.`);
  if (!['auto', 'http2', 'quic'].includes(protocol)) protocol = 'auto';
  tunnelRuntime.state = 'starting';
  tunnelRuntime.url = '';
  tunnelRuntime.error = '';
  tunnelRuntime.protocol = protocol;
  tunnelRuntime.startedAt = nowIso();
  tunnelRuntime.logs = [];
  const namedToken = String(process.env.CLOUDFLARE_TUNNEL_TOKEN || '').trim();
  if (namedToken && !String(process.env.CLOUDFLARE_PUBLIC_URL || '').trim()) throw new Error('Для именованного Cloudflare Tunnel укажи CLOUDFLARE_PUBLIC_URL в .env.');
  const args = namedToken
    ? ['tunnel', 'run', '--token', namedToken]
    : ['tunnel', '--no-autoupdate', '--protocol', protocol, '--edge-ip-version', '4', '--url', `http://127.0.0.1:${PORT}`, '--loglevel', 'info'];
  if (namedToken && process.env.CLOUDFLARE_PUBLIC_URL) tunnelRuntime.url = String(process.env.CLOUDFLARE_PUBLIC_URL).trim().replace(/\/$/, '');
  const child = spawn(executable, args, {
    cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  tunnelRuntime.process = child;
  const consume = stream => {
    let buffer = '';
    stream.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) tunnelLog(line);
    });
    stream.on('end', () => { if (buffer) tunnelLog(buffer); });
  };
  consume(child.stdout); consume(child.stderr);
  child.on('error', error => { tunnelRuntime.state = 'error'; tunnelRuntime.error = error.message; tunnelRuntime.process = null; tunnelLog(`Ошибка запуска cloudflared: ${error.message}`); });
  child.on('exit', (code, signal) => {
    if (tunnelRuntime.process === child) tunnelRuntime.process = null;
    const requested = Boolean(child.sovliStopRequested);
    tunnelRuntime.state = requested || code === 0 ? 'stopped' : 'error';
    if (!requested && code !== 0) tunnelRuntime.error = `cloudflared завершился (code=${code}, signal=${signal || 'none'})`;
    tunnelLog(`Процесс cloudflared завершён: code=${code}, signal=${signal || 'none'}`);
  });
  tunnelLog(namedToken ? 'Запуск именованного Cloudflare Tunnel.' : `Запуск Quick Tunnel: protocol=${protocol}, edge-ip-version=4, origin=http://127.0.0.1:${PORT}`);
  return { ok: true, starting: true, protocol };
}
function stopCloudflareQuickTunnel() {
  const child = tunnelRuntime.process;
  if (child && !child.killed) {
    tunnelRuntime.state = 'stopping';
    child.sovliStopRequested = true;
    try { child.kill(); } catch (error) { tunnelRuntime.error = error.message; }
  }
  tunnelRuntime.process = null;
  tunnelRuntime.url = '';
  tunnelRuntime.state = 'stopped';
  tunnelRuntime.error = '';
  tunnelLog('Публичный Quick Tunnel остановлен владельцем.');
  return { ok: true };
}
const STORE_CATALOG = Object.freeze([
  { id: "theme-light", name: "Светлая тема", description: "Чистое светлое оформление SOLVI. Всегда доступно бесплатно.", category: "Темы", slot: "theme", price: 0, rarity: "Базовый", preview: "theme-light", value: "light", collection: "Базовые темы", starter: true },
  { id: "theme-dark", name: "Тёмная тема", description: "Комфортное тёмное оформление SOLVI. Всегда доступно бесплатно.", category: "Темы", slot: "theme", price: 0, rarity: "Базовый", preview: "theme-dark", value: "dark", collection: "Базовые темы", starter: true },
  { id: "theme-default", name: "Чистый старт", description: "Спокойное базовое оформление.", category: "Темы", slot: "theme", price: 0, rarity: "Базовый", preview: "theme-default", value: "default", collection: "Стартовая коллекция" , starter: true },
  { id: "theme-aurora", name: "Северное сияние", description: "Лавандовые и бирюзовые переливы.", category: "Темы", slot: "theme", price: 300, rarity: "Редкий", preview: "theme-aurora", value: "aurora", collection: "Космическая экспедиция" },
  { id: "theme-sunset", name: "Тёплый закат", description: "Персиковый свет и мягкие тени.", category: "Темы", slot: "theme", price: 260, rarity: "Редкий", preview: "theme-sunset", value: "sunset", collection: "Тёплые истории" },
  { id: "theme-midnight", name: "Полночный импульс", description: "Глубокий графит с электрической лавандой.", category: "Темы", slot: "theme", price: 810, rarity: "Эпический", preview: "theme-midnight", value: "midnight", collection: "Ночной город" },
  { id: "theme-candy", name: "Малиновый мармелад", description: "Розово-лиловая конфетная палитра.", category: "Темы", slot: "theme", price: 570, rarity: "Редкий", preview: "theme-candy", value: "candy", collection: "Сахарный космос" },
  { id: "theme-arcade", name: "Аркадный режим", description: "Пиксельные акценты и ретро-цвета.", category: "Темы", slot: "theme", price: 1020, rarity: "Легендарный", preview: "theme-arcade", value: "arcade", collection: "Ретро-аркада" },
  { id: "wallpaper-deep-space", name: "Тема — Глубокий космос", description: "Полное оформление всего интерфейса SOLVI в стиле «Мягкая звёздная текстура.»: цветовые поверхности, панели, карточки и чат.", category: "Темы", slot: "theme", price: 200, rarity: "Обычный", preview: "wallpaper-space", value: "space", collection: "Космическая экспедиция" },
  { id: "wallpaper-paper", name: "Тема — Тёплая бумага", description: "Полное оформление всего интерфейса SOLVI в стиле «Фактурный спокойный фон.»: цветовые поверхности, панели, карточки и чат.", category: "Темы", slot: "theme", price: 120, rarity: "Обычный", preview: "wallpaper-paper", value: "paper", collection: "Тихий уголок" },
  { id: "wallpaper-aurora", name: "Тема — Туманность Лиры", description: "Полное оформление всего интерфейса SOLVI в стиле «Бирюзовая космическая дымка.»: цветовые поверхности, панели, карточки и чат.", category: "Темы", slot: "theme", price: 350, rarity: "Редкий", preview: "wallpaper-aurora", value: "aurora", collection: "Космическая экспедиция" },
  { id: "wallpaper-neon-city", name: "Тема — Неоновый квартал", description: "Полное оформление всего интерфейса SOLVI в стиле «Ночной город после дождя.»: цветовые поверхности, панели, карточки и чат.", category: "Темы", slot: "theme", price: 650, rarity: "Эпический", preview: "wallpaper-neon", value: "neon", collection: "Ночной город" },
  { id: "wallpaper-pixel", name: "Тема — Пиксельный остров", description: "Полное оформление всего интерфейса SOLVI в стиле «Тёплая ретро-сетка и звёзды.»: цветовые поверхности, панели, карточки и чат.", category: "Темы", slot: "theme", price: 530, rarity: "Редкий", preview: "wallpaper-pixel", value: "pixel", collection: "Ретро-аркада" },
  { id: "bubble-mint", name: "Мятные сообщения", description: "Мягкий мятный оттенок пузырьков.", category: "Пузырьки", slot: "bubble", price: 150, rarity: "Обычный", preview: "bubble-mint", value: "mint", collection: "Тихий уголок" },
  { id: "bubble-berry", name: "Ягодные сообщения", description: "Насыщенный ягодный градиент.", category: "Пузырьки", slot: "bubble", price: 240, rarity: "Редкий", preview: "bubble-berry", value: "berry", collection: "Сахарный космос" },
  { id: "bubble-lilac", name: "Лавандовый воздух", description: "Полупрозрачная лаванда.", category: "Пузырьки", slot: "bubble", price: 180, rarity: "Обычный", preview: "bubble-lilac", value: "lilac", collection: "Космическая экспедиция" },
  { id: "bubble-gold", name: "Золотая пыль", description: "Тёплый золотистый акцент.", category: "Пузырьки", slot: "bubble", price: 750, rarity: "Эпический", preview: "bubble-gold", value: "gold", collection: "Королевская серия" },
  { id: "frame-orbit", name: "Орбитальная рамка", description: "Тонкое сияющее кольцо.", category: "Рамки", slot: "frame", price: 420, rarity: "Редкий", preview: "frame-orbit", value: "orbit", collection: "Космическая экспедиция" },
  { id: "frame-comet", name: "След кометы", description: "Рамка с хвостом кометы.", category: "Рамки", slot: "frame", price: 650, rarity: "Эпический", preview: "frame-comet", value: "comet", collection: "Космическая экспедиция" },
  { id: "frame-pixel", name: "Пиксельный портал", description: "Ретро-рамка для аватара.", category: "Рамки", slot: "frame", price: 540, rarity: "Редкий", preview: "frame-pixel", value: "pixel", collection: "Ретро-аркада" },
  { id: "frame-royal", name: "Королевская печать", description: "Тонкая золотая окантовка.", category: "Рамки", slot: "frame", price: 1490, rarity: "Легендарный", preview: "frame-royal", value: "royal", collection: "Королевская серия" },
  { id: "sound-soft-pop", name: "Тихий щелчок", description: "Мягкий короткий сигнал.", category: "Звуки", slot: "sound", price: 90, rarity: "Обычный", preview: "sound-soft", value: "soft", collection: "Тихий уголок" },
  { id: "sound-orbit-chime", name: "Орбитальный звон", description: "Воздушный двухнотный сигнал.", category: "Звуки", slot: "sound", price: 200, rarity: "Редкий", preview: "sound-orbit", value: "orbit", collection: "Космическая экспедиция" },
  { id: "sound-arcade", name: "Монетка 8-bit", description: "Короткий аркадный сигнал.", category: "Звуки", slot: "sound", price: 440, rarity: "Редкий", preview: "sound-arcade", value: "arcade", collection: "Ретро-аркада" },
  { id: "sound-royal", name: "Золотой аккорд", description: "Мягкий торжественный звук.", category: "Звуки", slot: "sound", price: 1220, rarity: "Эпический", preview: "sound-royal", value: "royal", collection: "Королевская серия" },
  { id: "stickers-night-owl", name: "Ночная смена", description: "Набор для поздних разговоров.", category: "Стикеры", slot: "stickers", price: 330, rarity: "Редкий", preview: "stickers-night", value: "night", collection: "Ночной город" },
  { id: "stickers-sausage", name: "Сосисыч в деле", description: "Стикерпак с мышкой-сосиской.", category: "Стикеры", slot: "stickers", price: 480, rarity: "Эпический", preview: "stickers-sausage", value: "sausage", collection: "Мемная лаборатория" },
  { id: "stickers-chaos", name: "Чистый хаос", description: "Набор эмоциональных реакций.", category: "Стикеры", slot: "stickers", price: 650, rarity: "Эпический", preview: "stickers-chaos", value: "chaos", collection: "Мемная лаборатория" },
  { id: "title-star-guide", name: "Проводник звёзд", description: "Титул рядом с именем в чате.", category: "Титулы", slot: "title", price: 810, rarity: "Эпический", preview: "title-stars", value: "star-guide", collection: "Космическая экспедиция" },
  { id: "title-night-owl", name: "Ночной житель", description: "Для тех, кто не спит до рассвета.", category: "Титулы", slot: "title", price: 620, rarity: "Редкий", preview: "title-night", value: "night-owl", collection: "Ночной город" },
  { id: "title-legend", name: "Локальная легенда", description: "Редкий титул коллекционера.", category: "Титулы", slot: "title", price: 3050, rarity: "Легендарный", preview: "title-legend", value: "legend", collection: "Королевская серия" },
  { id: "theme-cream", name: "Ванильный пломбир", description: "Светлая кремовая тема.", category: "Темы", slot: "theme", price: 470, rarity: "Редкий", preview: "theme-cream", value: "cream", collection: "Тихий уголок" },
  { id: "wallpaper-clouds", name: "Тема — Облака на выдохе", description: "Полное оформление всего интерфейса SOLVI в стиле «Нежные облака и утреннее небо.»: цветовые поверхности, панели, карточки и чат.", category: "Темы", slot: "theme", price: 210, rarity: "Обычный", preview: "wallpaper-clouds", value: "clouds", collection: "Тихий уголок" },
  { id: "bubble-ocean", name: "Морская глубина", description: "Сине-бирюзовые сообщения.", category: "Пузырьки", slot: "bubble", price: 350, rarity: "Редкий", preview: "bubble-ocean", value: "ocean", collection: "Космическая экспедиция" },
  { id: "frame-flower", name: "Цветочная скобка", description: "Лёгкая цветочная рамка.", category: "Рамки", slot: "frame", price: 480, rarity: "Редкий", preview: "frame-flower", value: "flower", collection: "Тёплые истории" },
  { id: "sound-rain", name: "Дождь по окну", description: "Уютный короткий звуковой акцент.", category: "Звуки", slot: "sound", price: 240, rarity: "Обычный", preview: "sound-rain", value: "rain", collection: "Тёплые истории" },
  { id: "stickers-food", name: "Перекус", description: "Смешные стикеры еды.", category: "Стикеры", slot: "stickers", price: 270, rarity: "Обычный", preview: "stickers-food", value: "food", collection: "Мемная лаборатория" },
  { id: "title-good-vibes", name: "Добрая энергия", description: "Небольшой позитивный титул.", category: "Титулы", slot: "title", price: 380, rarity: "Обычный", preview: "title-vibes", value: "vibes", collection: "Тёплые истории" },
  { id: "theme-violet-royal", name: "Фиолетовый бархат", description: "Глубокий фиолетовый с золотыми акцентами.", category: "Темы", slot: "theme", price: 1760, rarity: "Легендарный", preview: "theme-royal", value: "royal", collection: "Королевская серия" },
  { id: "wallpaper-arcade", name: "Тема — Аркадный зал", description: "Полное оформление всего интерфейса SOLVI в стиле «Неоновый ретро-фон.»: цветовые поверхности, панели, карточки и чат.", category: "Темы", slot: "theme", price: 890, rarity: "Эпический", preview: "wallpaper-arcade", value: "arcade", collection: "Ретро-аркада" },
  { id: "bubble-rose", name: "Розовый кварц", description: "Мягкий розовый градиент.", category: "Пузырьки", slot: "bubble", price: 290, rarity: "Редкий", preview: "bubble-rose", value: "rose", collection: "Сахарный космос" },
  { id: "frame-neon", name: "Неоновый контур", description: "Яркий контур профиля.", category: "Рамки", slot: "frame", price: 1110, rarity: "Эпический", preview: "frame-neon", value: "neon", collection: "Ночной город" },
  { id: "title-collector", name: "Коллекционер", description: "Титул для владельца большой коллекции.", category: "Титулы", slot: "title", price: 4050, rarity: "Легендарный", preview: "title-collector", value: "collector", collection: "Королевская серия" },
  { id: "theme-ice", name: "Ледяное сияние", description: "Холодная голубая тема с серебряными акцентами.", category: "Темы", slot: "theme", price: 1250, rarity: "Эпический", preview: "theme-ice", value: "ice", collection: "Океанская глубина" },
  { id: "theme-sakura", name: "Сакура после дождя", description: "Пудровые оттенки и спокойное настроение.", category: "Темы", slot: "theme", price: 1430, rarity: "Эпический", preview: "theme-sakura", value: "sakura", collection: "Японский сад" },
  { id: "wallpaper-mountain", name: "Тема — Горный рассвет", description: "Полное оформление всего интерфейса SOLVI в стиле «Тихие горы в первых лучах солнца.»: цветовые поверхности, панели, карточки и чат.", category: "Темы", slot: "theme", price: 600, rarity: "Редкий", preview: "wallpaper-mountain", value: "mountain", collection: "Тёплые истории" },
  { id: "wallpaper-cyber", name: "Тема — Кибер-неон", description: "Полное оформление всего интерфейса SOLVI в стиле «Городские огни в дождливой ночи.»: цветовые поверхности, панели, карточки и чат.", category: "Темы", slot: "theme", price: 1190, rarity: "Эпический", preview: "wallpaper-cyber", value: "cyber", collection: "Цифровой город" },
  { id: "wallpaper-sea", name: "Тема — Синяя лагуна", description: "Полное оформление всего интерфейса SOLVI в стиле «Свет сквозь чистую морскую воду.»: цветовые поверхности, панели, карточки и чат.", category: "Темы", slot: "theme", price: 660, rarity: "Редкий", preview: "wallpaper-sea", value: "sea", collection: "Океанская глубина" },
  { id: "bubble-citrus", name: "Цитрусовый заряд", description: "Тёплый лаймовый оттенок исходящих сообщений.", category: "Пузырьки", slot: "bubble", price: 360, rarity: "Редкий", preview: "bubble-citrus", value: "citrus", collection: "Японский сад" },
  { id: "bubble-graphite", name: "Графитовый шелк", description: "Сдержанная тёмная палитра сообщений.", category: "Пузырьки", slot: "bubble", price: 500, rarity: "Редкий", preview: "bubble-graphite", value: "graphite", collection: "Цифровой город" },
  { id: "frame-sakura", name: "Лепестки сакуры", description: "Нежная розовая рамка профиля.", category: "Рамки", slot: "frame", price: 980, rarity: "Эпический", preview: "frame-sakura", value: "sakura", collection: "Японский сад" },
  { id: "frame-glass", name: "Стеклянная грань", description: "Чистое стеклянное кольцо с бликами.", category: "Рамки", slot: "frame", price: 1320, rarity: "Эпический", preview: "frame-glass", value: "glass", collection: "Цифровой город" },
  { id: "sound-bubble", name: "Пузырёк", description: "Короткий мягкий звук нового сообщения.", category: "Звуки", slot: "sound", price: 150, rarity: "Обычный", preview: "sound-bubble", value: "bubble", collection: "Океанская глубина" },
  { id: "sound-synth", name: "Синтезатор 2088", description: "Минималистичный цифровой сигнал.", category: "Звуки", slot: "sound", price: 750, rarity: "Эпический", preview: "sound-synth", value: "synth", collection: "Цифровой город" },
  { id: "stickers-sausage-mouse", name: "Сосис-Мышь: полный набор", description: "Мемный набор с главным талисманом SOLVI.", category: "Стикеры", slot: "stickers", price: 1080, rarity: "Легендарный", preview: "stickers-sausage-mouse", value: "sausage-mouse", collection: "Мемная лаборатория" },
  { id: "stickers-deep-sea", name: "Глубоководные", description: "Морские существа и подводные эмоции.", category: "Стикеры", slot: "stickers", price: 420, rarity: "Редкий", preview: "stickers-deep-sea", value: "deep-sea", collection: "Океанская глубина" },
  { id: "title-first-contact", name: "Первый контакт", description: "Для тех, кто не боится начать разговор.", category: "Титулы", slot: "title", price: 480, rarity: "Редкий", preview: "title-first-contact", value: "first-contact", collection: "Стартовая коллекция" },
  { id: "title-sakura-keeper", name: "Хранитель сакуры", description: "Титул из коллекции японского сада.", category: "Титулы", slot: "title", price: 3510, rarity: "Легендарный", preview: "title-sakura", value: "sakura-keeper", collection: "Японский сад" },
  { id: "title-night-circuit", name: "Ночной контур", description: "Титул цифрового города.", category: "Титулы", slot: "title", price: 3920, rarity: "Легендарный", preview: "title-circuit", value: "night-circuit", collection: "Цифровой город" },
  { id: "theme-vip-nebula", name: "Туманность VIP", description: "Эксклюзивная глубокая космическая тема с пульсирующими созвездиями.", category: "Темы", slot: "theme", price: 0, rarity: "Легендарный", preview: "theme-vip-nebula", value: "vip-nebula", collection: "VIP · Звёздный след", bundleOnly: true },
  { id: "bubble-vip-meteor", name: "Метеоритный след", description: "Исходящие сообщения с медным свечением и лёгким хвостом.", category: "Пузырьки", slot: "bubble", price: 0, rarity: "Легендарный", preview: "bubble-vip-meteor", value: "vip-meteor", collection: "VIP · Звёздный след", bundleOnly: true },
  { id: "frame-vip-aurora", name: "Полярное кольцо", description: "Рамка профиля с переливом северного сияния.", category: "Рамки", slot: "frame", price: 0, rarity: "Легендарный", preview: "frame-vip-aurora", value: "vip-aurora", collection: "VIP · Звёздный след", bundleOnly: true },
  { id: "stickers-vip-comet", name: "Кометный экипаж", description: "Шесть эксклюзивных стикеров звёздного путешественника.", category: "Стикеры", slot: "stickers", price: 0, rarity: "Легендарный", preview: "stickers-vip-comet", value: "vip-comet", collection: "VIP · Звёздный след", bundleOnly: true },
  { id: "title-vip-stardust", name: "Пыльца комет", description: "Особый титул для профиля и чата.", category: "Титулы", slot: "title", price: 0, rarity: "Легендарный", preview: "title-vip-stardust", value: "vip-stardust", collection: "VIP · Звёздный след", bundleOnly: true },
  { id: "theme-premium-event-horizon", name: "Горизонт событий", description: "Премиальная тема с тёмной материей и стеклянными поверхностями.", category: "Темы", slot: "theme", price: 0, rarity: "Мифический", preview: "theme-premium-event-horizon", value: "premium-event-horizon", collection: "Premium · Квантовый портал", bundleOnly: true },
  { id: "bubble-premium-prism", name: "Призматический импульс", description: "Многослойные исходящие сообщения с оптическим переливом.", category: "Пузырьки", slot: "bubble", price: 0, rarity: "Мифический", preview: "bubble-premium-prism", value: "premium-prism", collection: "Premium · Квантовый портал", bundleOnly: true },
  { id: "frame-premium-portal", name: "Портал измерений", description: "Объёмная рамка аватара с контрастным свечением.", category: "Рамки", slot: "frame", price: 0, rarity: "Мифический", preview: "frame-premium-portal", value: "premium-portal", collection: "Premium · Квантовый портал", bundleOnly: true },
  { id: "stickers-premium-quantum", name: "Квантовые эмоции", description: "Шесть эксклюзивных стикеров из другой галактики.", category: "Стикеры", slot: "stickers", price: 0, rarity: "Мифический", preview: "stickers-premium-quantum", value: "premium-quantum", collection: "Premium · Квантовый портал", bundleOnly: true },
  { id: "title-premium-singularity", name: "Сингулярность", description: "Редкий титул для коллекции Premium.", category: "Титулы", slot: "title", price: 0, rarity: "Мифический", preview: "title-premium-singularity", value: "premium-singularity", collection: "Premium · Квантовый портал", bundleOnly: true },
]);
const STORE_BUNDLES = Object.freeze([
  { id: 'vip-signature-pack', name: 'VIP · Звёздный след', tier: 'vip', price: 2400, description: '5 эксклюзивных предметов: туманность, метеоритные сообщения, полярная рамка, кометные стикеры и титул «Пыльца комет». Нужен активный VIP или Premium.', itemIds: ['theme-vip-nebula','bubble-vip-meteor','frame-vip-aurora','stickers-vip-comet','title-vip-stardust'] },
  { id: 'premium-quantum-pack', name: 'Premium · Квантовый портал', tier: 'premium', price: 4800, description: '5 мифических предметов: горизонт событий, призматические сообщения, портал измерений, квантовые стикеры и титул «Сингулярность». Нужен активный Premium.', itemIds: ['theme-premium-event-horizon','bubble-premium-prism','frame-premium-portal','stickers-premium-quantum','title-premium-singularity'] }
]);
const BILLING_CURRENCY_RAW = String(process.env.BILLING_CURRENCY || 'eur').trim().toLowerCase();
const BILLING_CURRENCY = /^[a-z]{3}$/.test(BILLING_CURRENCY_RAW) ? BILLING_CURRENCY_RAW : 'eur';
function billingMinorPrice(envName, eurDefault) {
  const raw = process.env[envName];
  const value = raw === undefined || String(raw).trim() === '' ? (BILLING_CURRENCY === 'eur' ? eurDefault : 0) : Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
const BILLING_PRODUCTS = Object.freeze([
  { id: 'vip-30d', tier: 'vip', days: 30, amountMinor: billingMinorPrice('VIP_PRICE_MINOR', 499), currency: BILLING_CURRENCY, name: 'VIP · 30 дней', description: '30 дней VIP: расширенные лимиты, голосовые до 45 секунд и 5 фото за сообщение.' },
  { id: 'premium-30d', tier: 'premium', days: 30, amountMinor: billingMinorPrice('PREMIUM_PRICE_MINOR', 899), currency: BILLING_CURRENCY, name: 'Premium · 30 дней', description: '30 дней Premium: максимальные лимиты, голосовые до 1 минуты и 10 фото за сообщение.' }
]);
const MEMBERSHIP_PACKAGES = Object.freeze([
  { id: 'vip-1h', tier: 'vip', hours: 1, price: 180, name: 'VIP · 1 час', description: 'VIP-значок и сияющая рамка профиля, до 3 000 символов, 5 фото до 8 МБ, голосовые до 45 секунд, аватар до 4 МБ, 5 языков и 8 интересов.' },
  { id: 'vip-6h', tier: 'vip', hours: 6, price: 1080, name: 'VIP · 6 часов', description: 'Все возможности VIP на 6 часов. 180 ✦ за час статуса — эквивалент 3 часов активного диалога.' },
  { id: 'vip-24h', tier: 'vip', hours: 24, price: 4320, name: 'VIP · 24 часа', description: 'Полные сутки VIP со всеми расширенными лимитами. Срок прибавляется к оставшемуся времени.' },
  { id: 'premium-1h', tier: 'premium', hours: 1, price: 360, name: 'Premium · 1 час', description: 'Всё из VIP плюс Premium-ореол, до 5 000 символов, 10 фото до 12 МБ, голосовые до 1 минуты, аватар до 8 МБ, 10 языков и 12 интересов.' },
  { id: 'premium-6h', tier: 'premium', hours: 6, price: 2160, name: 'Premium · 6 часов', description: 'Все возможности Premium на 6 часов. 360 ✦ за час статуса — эквивалент 6 часов активного диалога.' },
  { id: 'premium-24h', tier: 'premium', hours: 24, price: 8640, name: 'Premium · 24 часа', description: 'Полные сутки Premium со всеми максимальными лимитами. Срок прибавляется к оставшемуся времени.' }
]);
const LANGUAGES = ['Русский', 'English', 'Español', 'Deutsch', 'Français', 'Türkçe', 'Português', 'العربية', '中文', '日本語'];
const INTERESTS = ['Музыка', 'Игры', 'Кино и сериалы', 'Технологии', 'Путешествия', 'Спорт', 'Книги', 'Юмор', 'Наука', 'Искусство', 'Языки', 'Общение'];
const FLIRT_INTERESTS = ['Флирт', 'Романтика', 'Свидания', 'Симпатия', 'Комплименты', 'Лёгкие намёки', 'Нежность', 'Отношения', 'Искра и химия', 'Общение без обязательств'];
const ROLEPLAY_INTERESTS = ['Романтический сюжет', 'Фэнтези', 'Приключения', 'Детектив', 'Мистика', 'Драма', 'Комедия', 'Научная фантастика', 'Исторический сюжет', 'Повседневная история', 'Медленное развитие', 'Альтернативный мир'];

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(AVATAR_DIR, { recursive: true });

function getJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32) return process.env.JWT_SECRET;
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}
const JWT_SECRET = getJwtSecret();
let startupUserResetStatus = 'not_started';

let db;
let io;
let persistentStore = null;
let persistentDirty = false;
let persistentFlushTimer = null;
let persistentFlushPromise = null;
let shuttingDown = false;
const queue = new Map();
const queueFallbackTimers = new Map();
const aiSessions = new Map();
const disconnectTimers = new Map();
const guestExpiryTimers = new Map();
const messageWindows = new Map();

function nowIso() { return new Date().toISOString(); }
function userRoom(userId) { return `user:${userId}`; }
function safeJsonArray(value) {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
function safeSettings(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function usernameKey(value) { return value.normalize('NFKC').toLocaleLowerCase('ru-RU'); }
function schedulePersistentFlush(delayMs = 2000) {
  if (!persistentStore?.ready || persistentFlushTimer || shuttingDown) return;
  persistentFlushTimer = setTimeout(() => {
    persistentFlushTimer = null;
    flushPersistentSnapshot().catch(error => console.error('[SOLVI] Не удалось сохранить снимок Neon:', error.message));
  }, delayMs);
  persistentFlushTimer.unref?.();
}
function markDatabaseChanged() {
  if (!persistentStore?.ready) return;
  persistentDirty = true;
  schedulePersistentFlush();
}
async function flushPersistentSnapshot(force = false) {
  if (!persistentStore?.ready) return;
  if (persistentFlushTimer) {
    clearTimeout(persistentFlushTimer);
    persistentFlushTimer = null;
  }
  if (persistentFlushPromise) {
    try { await persistentFlushPromise; } catch { /* retry below when dirty */ }
    if (persistentDirty) return flushPersistentSnapshot(force);
    return;
  }
  if (!persistentDirty && !force) return;

  persistentDirty = false;
  const pending = persistentStore.save(db);
  persistentFlushPromise = pending;
  try {
    const stats = await pending;
    if (force) console.log(`[SOLVI] Постоянная копия Neon обновлена: ${stats.rowCount} записей в ${stats.tableCount} таблицах.`);
  } catch (error) {
    persistentDirty = true;
    console.error('[SOLVI] Ошибка сохранения в Neon; повторим автоматически:', error.message);
    if (force) throw error;
  } finally {
    if (persistentFlushPromise === pending) persistentFlushPromise = null;
  }
  if (persistentDirty && !shuttingDown) schedulePersistentFlush(5000);
}
async function initializePersistentStorage() {
  const connectionString = String(process.env.DATABASE_URL || '').trim();
  if (!connectionString) {
    if (process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL || process.env.RENDER === 'true') {
      throw new Error('На Render обязательно задай DATABASE_URL в Environment, иначе аккаунты будут храниться только во временной файловой системе.');
    }
    console.warn('[SOLVI] DATABASE_URL не задан: локальная SQLite работает без постоянного облачного хранения.');
    return;
  }
  const store = new PostgresSnapshotStore({
    connectionString,
    avatarDir: AVATAR_DIR,
    appVersion: APP_VERSION
  });
  try {
    const status = await store.initialize(db);
    persistentStore = store;
    const verb = status.restored ? 'Восстановлена постоянная копия из Neon' : 'Создана первая постоянная копия в Neon';
    console.log(`[SOLVI] ${verb}: ${status.rowCount} записей, ${status.tableCount} таблиц, аватаров: ${status.avatarCount}.`);
  } catch (error) {
    await store.close().catch(() => {});
    throw new Error(`Не удалось подключить постоянную базу Neon (DATABASE_URL): ${error.message}`);
  }
}
function dbRun(sql, params = []) {
  const result = db.prepare(sql).run(...params);
  markDatabaseChanged();
  return result;
}
function dbGet(sql, params = []) { return db.prepare(sql).get(...params) || null; }
function dbAll(sql, params = []) { return db.prepare(sql).all(...params); }
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    markDatabaseChanged();
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
    throw error;
  }
}
function publicUser(row) {
  if (!row) return null;
  const equipped = db ? getEquippedItems(row.id) : {};
  const owner = isOwner(row);
  const role = owner ? 'owner' : (['developer', 'moderator'].includes(row.role) ? row.role : 'member');
  return {
    id: row.id,
    publicId: row.public_id,
    username: row.username,
    gender: row.gender || '',
    description: row.description || '',
    tokens: Number(row.tokens || 0),
    avatarUrl: row.avatar_file ? `/api/avatar/${encodeURIComponent(row.id)}?v=${encodeURIComponent(row.avatar_file)}` : null,
    equipped,
    cosmeticTitle: STORE_TITLES[equipped.title] || '',
    role,
    badge: owner ? 'Владелец' : (role === 'developer' ? 'Разработчик' : (role === 'moderator' ? 'Модератор' : (effectiveSubscription(row) === 'premium' ? 'Premium' : (effectiveSubscription(row) === 'vip' ? 'VIP' : 'Участник')))),
    subscriptionTier: effectiveSubscription(row),
    subscriptionExpiresAt: row.subscription_expires_at || null,
    avatar: row.avatar,
    languages: safeJsonArray(row.languages),
    interests: safeJsonArray(row.interests),
    createdAt: row.created_at,
    settings: safeSettings(row.settings_json),
    accountType: row.account_type || 'registered',
    guestExpiresAt: row.guest_expires_at || null,
    stats: db ? userStats(row.id) : { chats: 0, activeMinutes: 0, messages: 0 }
  };
}
function getEquippedItems(userId) {
  try {
    return Object.fromEntries(dbAll('SELECT slot, item_id FROM store_equipped WHERE user_id = ?', [userId]).map(row => [row.slot, row.item_id]));
  } catch { return {}; }
}
function ensureStarterInventory(userId) {
  const acquiredAt = nowIso();
  for (const itemId of ['theme-default', 'theme-light', 'theme-dark']) {
    dbRun("INSERT OR IGNORE INTO store_inventory (user_id, item_id, acquired_at, source) VALUES (?, ?, ?, 'starter')", [userId, itemId, acquiredAt]);
  }
  const legacyWallpaper = dbGet("SELECT item_id FROM store_equipped WHERE user_id = ? AND slot = 'wallpaper'", [userId]);
  if (legacyWallpaper) {
    const hasTheme = dbGet("SELECT item_id FROM store_equipped WHERE user_id = ? AND slot = 'theme'", [userId]);
    if (hasTheme) dbRun("DELETE FROM store_equipped WHERE user_id = ? AND slot = 'wallpaper'", [userId]);
    else dbRun("UPDATE store_equipped SET slot = 'theme', updated_at = ? WHERE user_id = ? AND slot = 'wallpaper'", [acquiredAt, userId]);
  }
  const equippedTheme = dbGet("SELECT item_id FROM store_equipped WHERE user_id = ? AND slot = 'theme'", [userId]);
  if (!equippedTheme) {
    const row = dbGet('SELECT settings_json FROM users WHERE id = ?', [userId]);
    const legacyTheme = safeSettings(row?.settings_json).theme;
    const itemId = legacyTheme === 'dark' ? 'theme-dark' : 'theme-light';
    dbRun("INSERT OR IGNORE INTO store_equipped (user_id, slot, item_id, updated_at) VALUES (?, 'theme', ?, ?)", [userId, itemId, acquiredAt]);
  }
}

function storePrice(itemId, fallbackPrice) {
  const row = dbGet('SELECT price, enabled FROM store_price_overrides WHERE item_id = ?', [itemId]);
  return row ? { price: Number(row.price), enabled: Boolean(row.enabled) } : { price: fallbackPrice, enabled: true };
}
function auditAdmin(actorId, action, targetId = null, details = {}) {
  dbRun('INSERT INTO admin_audit_log (id, actor_id, action, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [crypto.randomUUID(), actorId, action, targetId, JSON.stringify(details), nowIso()]);
}
function userStats(userId) {
  const chats = dbGet('SELECT COUNT(*) AS count, COALESCE(SUM(active_seconds),0) AS seconds FROM matches WHERE user1_id = ? OR user2_id = ?', [userId, userId]);
  const messages = dbGet('SELECT COUNT(*) AS count FROM messages WHERE sender_id = ?', [userId]);
  return { chats: Number(chats?.count || 0), activeMinutes: Math.floor(Number(chats?.seconds || 0) / 60), messages: Number(messages?.count || 0) };
}
function isOwner(user) {
  return Boolean(user && process.env.OWNER_PUBLIC_ID && String(user.public_id) === String(process.env.OWNER_PUBLIC_ID));
}
function effectiveSubscription(user) {
  const tier = ['vip', 'premium'].includes(user?.subscription_tier) ? user.subscription_tier : 'free';
  if (tier === 'free') return 'free';
  if (user.subscription_expires_at && user.subscription_expires_at <= nowIso()) return 'free';
  return tier;
}
function effectivePaidSubscription(user) {
  const tier = ['vip', 'premium'].includes(user?.paid_subscription_tier) ? user.paid_subscription_tier : 'free';
  if (tier === 'free' || (user.paid_subscription_expires_at && user.paid_subscription_expires_at <= nowIso())) return 'free';
  return tier;
}
function membershipLimits(user) {
  const tier = effectiveSubscription(user);
  return {
    tier,
    messageLength: tier === 'premium' ? 5000 : (tier === 'vip' ? 3000 : MAX_MESSAGE_LENGTH),
    languageLimit: tier === 'premium' ? 10 : (tier === 'vip' ? 5 : 3),
    interestLimit: tier === 'premium' ? 12 : (tier === 'vip' ? 8 : 5),
    attachmentLimit: tier === 'premium' ? 10 : (tier === 'vip' ? 5 : 3),
    imageBytes: tier === 'premium' ? 12 * 1024 * 1024 : (tier === 'vip' ? 8 * 1024 * 1024 : 6 * 1024 * 1024),
    audioBytes: tier === 'premium' ? 12 * 1024 * 1024 : (tier === 'vip' ? 8 * 1024 * 1024 : 5 * 1024 * 1024),
    avatarBytes: tier === 'premium' ? 12 * 1024 * 1024 : (tier === 'vip' ? 8 * 1024 * 1024 : 4 * 1024 * 1024),
    voiceSeconds: tier === 'premium' ? 60 : (tier === 'vip' ? 45 : 30)
  };
}
function mediaPublic(row) {
  return { id: row.id, kind: row.media_kind, mime: row.mime_type, size: row.byte_size, url: `/api/media/${encodeURIComponent(row.id)}` };
}
function getMessageReactions(messageId, viewerId = null) {
  return dbAll(
    'SELECT emoji, COUNT(*) AS count, MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine FROM message_reactions WHERE message_id = ? GROUP BY emoji ORDER BY count DESC, emoji ASC',
    [viewerId || '', messageId]
  ).map(item => ({ emoji: item.emoji, count: Number(item.count), mine: Boolean(item.mine) }));
}
function serializeMessage(row, viewerId = null) {
  if (!row) return null;
  const attachments = safeJsonArray(row.attachments_json);
  const reactions = getMessageReactions(row.id, viewerId);
  const replyRow = row.reply_to_id ? dbGet('SELECT id, sender_id, content, message_type FROM messages WHERE id = ?', [row.reply_to_id]) : null;
  const replyTo = replyRow ? { id: replyRow.id, senderId: replyRow.sender_id, content: replyRow.content, type: replyRow.message_type } : null;
  return { ...row, type: row.message_type || 'text', sticker: row.sticker_code || null, attachments, reactions, replyTo };
}
function removeStoredFiles(rows) {
  for (const row of rows) {
    const safeName = path.basename(String(row.stored_name || ''));
    if (!safeName) continue;
    try { fs.unlinkSync(path.join(UPLOAD_DIR, safeName)); } catch (error) { if (error.code !== 'ENOENT') console.warn('[SOLVI] Не удалось удалить медиафайл:', error.message); }
  }
}
function getUserById(id) { return dbGet('SELECT * FROM users WHERE id = ?', [id]); }
function getActiveMatch(userId) {
  return dbGet(
    `SELECT * FROM matches WHERE status = 'active' AND (user1_id = ? OR user2_id = ?) ORDER BY created_at DESC LIMIT 1`,
    [userId, userId]
  );
}
function otherUserId(match, userId) { return match.user1_id === userId ? match.user2_id : match.user1_id; }
function onlineUserIds() {
  const ids = new Set();
  for (const socket of io.sockets.sockets.values()) if (socket.data.userId) ids.add(socket.data.userId);
  return ids;
}
function emitOnlineCount() {
  io.emit('presence:count', { count: onlineUserIds().size });
}
function isBlocked(a, b) {
  return !!dbGet('SELECT id FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1', [a, b, b, a]);
}
function emitToPair(match, event, payload) {
  io.to(userRoom(match.user1_id)).emit(event, payload);
  io.to(userRoom(match.user2_id)).emit(event, payload);
}
function matchPayload(match, forUserId) {
  const other = getUserById(otherUserId(match, forUserId));
  const interests = safeJsonArray(getUserById(forUserId)?.interests);
  const theirInterests = safeJsonArray(other?.interests);
  return {
    matchId: match.id,
    mode: match.mode || 'chat',
    startedAt: match.created_at,
    partner: publicUser(other),
    commonInterests: interests.filter(item => theirInterests.includes(item)).slice(0, 3)
  };
}
function accrueMatchTime(matchId) {
  if (!io || !db) return;
  const match = dbGet("SELECT * FROM matches WHERE id = ? AND status = 'active'", [matchId]);
  if (!match) return;
  const activeInChat = new Set([...io.sockets.sockets.values()].filter(socket => socket.data.activeMatchId === matchId).map(socket => socket.data.userId));
  const bothOnline = activeInChat.has(match.user1_id) && activeInChat.has(match.user2_id);
  const now = Date.now();
  if (!bothOnline) {
    if (match.last_tick_at) dbRun("UPDATE matches SET last_tick_at = NULL WHERE id = ? AND status = 'active'", [matchId]);
    return;
  }
  const last = match.last_tick_at ? Date.parse(match.last_tick_at) : now;
  const delta = Math.max(0, Math.min(20, Math.floor((now - last) / 1000)));
  const activeSeconds = Number(match.active_seconds || 0) + delta;
  const earnedMinutes = Math.max(0, Math.floor(activeSeconds / 60) - Number(match.credited_minutes || 0));
  transaction(() => {
    dbRun("UPDATE matches SET active_seconds = ?, credited_minutes = ?, last_tick_at = ? WHERE id = ? AND status = 'active'",
      [activeSeconds, Number(match.credited_minutes || 0) + earnedMinutes, new Date(now).toISOString(), matchId]);
    if (earnedMinutes > 0) {
      for (const userId of [match.user1_id, match.user2_id]) {
        dbRun('UPDATE users SET tokens = tokens + ? WHERE id = ?', [earnedMinutes, userId]);
        dbRun('INSERT INTO token_transactions (id, user_id, kind, amount, description, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [crypto.randomUUID(), userId, 'chat_minute', earnedMinutes, `Активное общение · ${earnedMinutes} мин.`, new Date(now).toISOString()]);
        const day = new Date(now).toISOString().slice(0, 10);
        dbRun('INSERT INTO token_earning_daily (user_id, day, earned) VALUES (?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET earned = earned + excluded.earned', [userId, day, earnedMinutes]);
        const balance = Number(dbGet('SELECT tokens FROM users WHERE id = ?', [userId]).tokens || 0);
        io.to(userRoom(userId)).emit('wallet:updated', { balance, earned: earnedMinutes, reason: 'chat_minute' });
      }
    }
  });
}
function tickActiveMatches() {
  if (!db || !io) return;
  for (const row of dbAll("SELECT id FROM matches WHERE status = 'active'")) {
    try { accrueMatchTime(row.id); } catch (error) { console.error('[SOLVI] Ошибка начисления времени диалога:', error.message); }
  }
}
function endMatch(matchId, reason = 'ended', actorId = null) {
  accrueMatchTime(matchId);
  const match = dbGet("SELECT * FROM matches WHERE id = ? AND status = 'active'", [matchId]);
  if (!match) return false;
  const mediaToDelete = dbAll('SELECT stored_name FROM media_files WHERE match_id = ?', [matchId]);
  const canArchive = ['user_ended', 'user_next'].includes(reason);
  const archivedMessages = canArchive ? dbAll(
    'SELECT m.sender_id, u.username AS sender_name, m.content, m.message_type, m.sticker_code, m.attachments_json, m.created_at FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.match_id = ? ORDER BY m.created_at ASC',
    [matchId]
  ).map(row => ({
    senderId: row.sender_id,
    senderName: row.sender_name,
    content: row.content || '',
    type: row.message_type || 'text',
    sticker: row.sticker_code || null,
    attachments: safeJsonArray(row.attachments_json).map(file => file.kind === 'audio' ? 'Голосовое сообщение' : 'Фотография'),
    createdAt: row.created_at
  })) : [];
  for (const socket of io.sockets.sockets.values()) if (socket.data.activeMatchId === matchId) socket.data.activeMatchId = null;
  transaction(() => {
    if (canArchive) {
      const user1 = getUserById(match.user1_id);
      const user2 = getUserById(match.user2_id);
      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
      for (const [user, partner] of [[user1, user2], [user2, user1]]) {
        if (!user || !partner) continue;
        dbRun('INSERT OR IGNORE INTO favorite_chat_drafts (id, user_id, match_id, partner_id, partner_username, partner_avatar, messages_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [crypto.randomUUID(), user.id, matchId, partner.id, partner.username, partner.avatar || '◉', JSON.stringify(archivedMessages), createdAt, expiresAt]);
      }
    }
    dbRun("UPDATE matches SET status = 'ended', ended_at = ?, end_reason = ? WHERE id = ?", [nowIso(), reason, matchId]);
    dbRun('DELETE FROM media_files WHERE match_id = ?', [matchId]);
    dbRun('DELETE FROM messages WHERE match_id = ?', [matchId]);
  });
  removeStoredFiles(mediaToDelete);
  emitToPair(match, 'chat:ended', { matchId, reason, actorId, canFavorite: canArchive });
  return true;
}
function removeFromQueue(userId) {
  queue.delete(userId);
  const timer = queueFallbackTimers.get(userId);
  if (timer) clearTimeout(timer);
  queueFallbackTimers.delete(userId);
}
function eligibleByLanguage(a, b) {
  if (!a.languages.length || !b.languages.length) return true;
  return a.languages.some(language => b.languages.includes(language));
}
function eligibleByGender(a, b) {
  return (a.desiredGender === 'any' || a.desiredGender === b.gender)
    && (b.desiredGender === 'any' || b.desiredGender === a.gender);
}
function eligibleByMode(a, b) {
  return a.mode === b.mode && (a.mode !== 'roleplay' || a.roleplayIntent !== b.roleplayIntent);
}
function overlapScore(a, b) {
  return a.interests.filter(item => b.interests.includes(item)).length;
}
function tryMatch(userId) {
  const current = queue.get(userId);
  if (!current) return;
  const candidates = [...queue.entries()]
    .filter(([id, candidate]) => id !== userId && candidate.userId !== userId)
    .filter(([id]) => !getActiveMatch(id) && !isBlocked(userId, id))
    .filter(([, candidate]) => eligibleByLanguage(current, candidate))
    .filter(([, candidate]) => eligibleByGender(current, candidate))
    .filter(([, candidate]) => eligibleByMode(current, candidate))
    .sort((a, b) => overlapScore(current, b[1]) - overlapScore(current, a[1]) || a[1].joinedAt - b[1].joinedAt);
  if (!candidates.length) return;
  const [partnerId] = candidates[0];
  const partner = queue.get(partnerId);
  if (!partner || !queue.has(userId)) return;
  removeFromQueue(userId);
  removeFromQueue(partnerId);
  const matchId = crypto.randomUUID();
  const createdAt = nowIso();
  transaction(() => {
    dbRun('INSERT INTO matches (id, user1_id, user2_id, status, created_at, last_tick_at, mode) VALUES (?, ?, ?, ?, ?, ?, ?)', [matchId, userId, partnerId, 'active', createdAt, createdAt, current.mode || 'chat']);
  });
  const match = dbGet('SELECT * FROM matches WHERE id = ?', [matchId]);
  for (const socket of io.sockets.sockets.values()) if (socket.data.userId === userId || socket.data.userId === partnerId) socket.data.activeMatchId = matchId;
  io.to(userRoom(userId)).emit('match:found', matchPayload(match, userId));
  io.to(userRoom(partnerId)).emit('match:found', matchPayload(match, partnerId));
}
function addToQueue(socket, preferences) {
  const userId = socket.data.userId;
  if (PUBLIC_MODE && !PUBLIC_MATCHING) return { ok: false, error: 'Публичный подбор временно отключён в настройках сервера.' };
  if (getActiveMatch(userId)) return { ok: false, error: 'У вас уже есть активный диалог.' };
  const user = getUserById(userId);
  if (!user) return { ok: false, error: 'Аккаунт не найден. Войдите снова.' };
  const mode = ['chat', 'flirt', 'roleplay'].includes(preferences?.mode) ? preferences.mode : 'chat';
  const desiredGender = ['any', 'male', 'female', 'other'].includes(preferences?.desiredGender) ? preferences.desiredGender : 'any';
  const ownGender = ['male', 'female', 'other'].includes(user.gender) ? user.gender : '';
  if (desiredGender !== 'any' && !ownGender) return { ok: false, error: 'Сначала укажи свой пол в профиле, чтобы фильтр пола работал для обеих сторон.' };
  if (mode !== 'chat') {
    if (user.account_type === 'guest') return { ok: false, error: 'Режимы 18+ доступны только постоянным аккаунтам.' };
    if (preferences?.adultConfirmed !== true) return { ok: false, error: 'Для режима 18+ подтверди, что тебе уже исполнилось 18 лет.' };
    dbRun('UPDATE users SET adult_asserted_at = ? WHERE id = ?', [nowIso(), userId]);
  }
  const roleplayIntent = preferences?.roleplayIntent === 'offering' ? 'offering' : 'seeking';
  if (mode === 'roleplay' && !['seeking', 'offering'].includes(preferences?.roleplayIntent)) return { ok: false, error: 'Выбери: ищешь сюжет или предлагаешь сюжет.' };
  const limits = membershipLimits(user);
  const languages = ['Русский'];
  const interests = [];
  const entry = { userId, mode, gender: ownGender, desiredGender, roleplayIntent, languages, interests, joinedAt: Date.now() };
  if (aiSessions.has(userId)) return { ok: false, error: 'Сначала заверши текущий диалог с ИИ-собеседником.' };
  queue.set(userId, entry);
  tryMatch(userId);
  if (queue.has(userId)) {
    const fallbackTimer = setTimeout(() => {
      queueFallbackTimers.delete(userId);
      startAiFallback(userId).catch(error => console.error('[SOLVI] AI fallback error:', error.message));
    }, 25_000);
    fallbackTimer.unref?.();
    queueFallbackTimers.set(userId, fallbackTimer);
  }
  return { ok: true };
}
const AI_PERSONA_PROFILES = [
  { names: ['Мира', 'Алиса', 'Ника', 'Лея', 'Соня', 'Варя', 'Эмма'], avatar: '🌙', gender: 'female', style: 'дружелюбная, внимательная, с живым чувством юмора' },
  { names: ['Лёша', 'Марк', 'Илья', 'Даня', 'Тим', 'Макс', 'Егор'], avatar: '🎧', gender: 'male', style: 'общительный, любознательный, говорит просто и без пафоса' },
  { names: ['Сэм', 'Рэй', 'Саша', 'Крис', 'Мика'], avatar: '🐸', gender: 'other', style: 'неформальный, доброжелательный, любит необычные идеи и мемы' }
];
function chooseAiPersona(entry) {
  const candidates = AI_PERSONA_PROFILES.filter(persona => entry.desiredGender === 'any' || persona.gender === entry.desiredGender);
  const pool = candidates.length ? candidates : AI_PERSONA_PROFILES;
  const profile = pool[Math.floor(Math.random() * pool.length)];
  const names = profile.names;
  return {
    name: names[Math.floor(Math.random() * names.length)],
    age: 18 + Math.floor(Math.random() * 18),
    avatar: profile.avatar,
    gender: profile.gender,
    style: profile.style
  };
}
async function startAiFallback(userId) {
  const entry = queue.get(userId);
  if (!entry) return;
  const socket = [...io.sockets.sockets.values()].find(item => item.data.userId === userId);
  if (!socket) { removeFromQueue(userId); return; }
  if (entry.mode !== 'chat') {
    socket.emit('queue:aiUnavailable', { reason: 'adult_mode' });
    return;
  }
  if (!String(process.env.GEMINI_API_KEY || '').trim()) {
    socket.emit('queue:aiUnavailable', { reason: 'api_key' });
    return;
  }
  const persona = chooseAiPersona(entry);
  const sessionId = `ai:${crypto.randomUUID()}`;
  const partnerId = `ai-user:${crypto.randomUUID()}`;
  const interests = entry.interests.slice(0, 5);
  const languages = entry.languages.length ? entry.languages.join(', ') : 'русский';
  const systemPrompt = [
    `Ты ИИ-собеседник SOLVI по имени ${persona.name}, твой вымышленный возраст в этой беседе — ${persona.age} лет. Для каждого нового собеседника тебе случайно назначаются новое имя и возраст; не используй образ из прошлых бесед. Пользователь видит явную отметку «ИИ-собеседник» — никогда не утверждай и не намекай, что ты человек. Если спрашивают о возрасте, называй назначенный возраст как часть образа ИИ-персонажа.`,
    `Твой характер: ${persona.style}. Общайся естественно, короткими сообщениями, преимущественно строчными буквами, без официоза и без точки в конце обычной короткой реплики.`,
    'Твоя главная задача — вести настоящий связный диалог, а не собирать анкету. Каждый ответ начинай с реакции на конкретное содержание последнего сообщения пользователя: ответь на его вопрос, прокомментируй факт, поддержи эмоцию или развей мысль. Не игнорируй смысл сообщения и не отвечай универсальными фразами вроде «понятно», «прикольно», «расскажи ещё» без конкретной связи с тем, что сказано. Если пользователь задаёт вопрос — сначала дай прямой ответ, затем при необходимости добавь короткий встречный вопрос по той же теме. Если пользователь делится историей или мнением — обсуди именно её, не меняй тему. Не задавай вопрос автоматически в каждом сообщении: обычно задавай не более одного вопроса на 3 ответа пользователя; иногда несколько реплик подряд просто беседуй без вопросов. Никогда не задавай следующий вопрос из списка знакомства, если пользователь ещё развивает предыдущую тему. Не делай выводов о пользователе без оснований и не выдумывай детали его слов. Не используй шаблонные комплименты и повторяющиеся реакции. В начале один раз поздоровайся и спроси имя. Дальше узнавай человека естественно, без чек-листа: возраст, город, интересы, хобби, любимая еда, семья — только когда это уместно в разговоре. Курение и алкоголь сам не инициируй. Не задавай два вопроса в одной реплике. Учитывай всю доступную историю и не повторяй уже заданное. Будь доброжелательным, но не соглашайся автоматически со всем: можешь иметь мягкое собственное мнение. Не выдумывай настоящую человеческую биографию — честно оставайся ИИ-персонажем. Если человек не хочет отвечать, спокойно продолжи другую тему.',
    `Интересы пользователя: ${interests.length ? interests.join(', ') : 'пока не указаны'}. Языки: ${languages}. Подхватывай эти темы, но не перечисляй их механически.`,
    'Задавай по одному живому вопросу, не превращай диалог в интервью. Не проси личные данные, контакты, пароли или адреса. Не выдумывай собственные реальные соцсети, встречи или биографию. Если спрашивают, кто ты, честно отвечай, что ты ИИ-персонаж.',
    'Для обычного режима общайся дружелюбно и безопасно. Не переходи к сексуальному или откровенному контенту. Не выдавай медицинские, юридические или финансовые советы как специалист.',
    'Отвечай на русском языке. Максимум 2 коротких предложения. При первом знакомстве отправь одно короткое сообщение: приветствие, представление и один вопрос об имени. Не отправляй несколько сообщений подряд и всегда жди ответ пользователя.'
  ].join(' ');
  const partner = { id: partnerId, username: persona.name, gender: persona.gender, description: `ИИ-персонаж SOLVI, ${persona.age} лет. Общается на русском языке.`, avatar: persona.avatar, badge: 'ИИ-собеседник', accountType: 'ai', isAi: true, interests };
  const session = { id: sessionId, partnerId, partner, persona, interests, systemPrompt, history: [], messages: [], pending: [], processing: false, turnVersion: 0, createdAt: Date.now() };
  aiSessions.set(userId, session);
  removeFromQueue(userId);
  const commonInterests = interests.slice(0, 3);
  io.to(userRoom(userId)).emit('match:found', {
    matchId: sessionId, isAi: true, mode: 'chat', startedAt: nowIso(), partner, commonInterests
  });
  queueAiTurn(userId, session, null);
}
function fallbackAiReply(session, isGreeting = false) {
  const options = isGreeting
    ? [`привет! я ${session.persona.name} ✨ а как тебя зовут?`]
    : ['ахах, понимаю 😄', 'о, вот это поворот', 'звучит интересно, мне нравится как ты это описываешь', 'да, понимаю о чём ты', 'прикольно, продолжай, я слушаю', 'неожиданно, но в этом есть своя логика'];
  return options[Math.floor(Math.random() * options.length)];
}
async function generateAiReply(session, isGreeting = false) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return fallbackAiReply(session, isGreeting);
  const model = String(process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim();
  const contents = session.history.slice(-12);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: session.systemPrompt }] }, contents, generationConfig: { temperature: 0.72, maxOutputTokens: 180 } }),
    signal: AbortSignal.timeout(12_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Gemini HTTP ${response.status}`);
  const text = payload?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
  return text ? text.slice(0, 500) : fallbackAiReply(session, isGreeting);
}
function aiTypingDelay(text) {
  const length = String(text || '').trim().length;
  return Math.min(4600, Math.max(1100, 650 + length * 34 + Math.floor(Math.random() * 750)));
}
function queueAiTurn(userId, session, text) {
  // Keep every user turn in order; never replace a message sent during generation.
  if (session.processing) {
    session.pending.push(text);
    return;
  }
  session.pending.push(text);
  session.processing = true;
  (async () => {
    while (session.pending.length && aiSessions.get(userId) === session) {
      const input = session.pending.shift();
      const userPrompt = input === null
        ? 'Начни разговор одним коротким сообщением: поздоровайся, представься как ИИ-персонаж и задай только один простой вопрос об имени.'
        : input;
      session.history.push({ role: 'user', parts: [{ text: userPrompt }] });
      io.to(userRoom(userId)).emit('chat:typing', { userId: session.partnerId, typing: true });
      let generated;
      try { generated = await generateAiReply(session, input === null); }
      catch (error) {
        console.error('[SOLVI] Gemini response failed:', error.message);
        generated = fallbackAiReply(session, input === null);
      }
      if (aiSessions.get(userId) !== session) break;
      const reply = String(generated || '').split(/\\s*<MSG>\\s*/i).map(value => value.trim()).filter(Boolean)[0]
        || fallbackAiReply(session, input === null);
      await new Promise(resolve => setTimeout(resolve, aiTypingDelay(reply)));
      if (aiSessions.get(userId) !== session) break;
      const message = {
        id: crypto.randomUUID(), match_id: session.id, sender_id: session.partnerId,
        client_id: `ai:${crypto.randomUUID()}`, content: reply.slice(0, 500), created_at: nowIso(),
        delivered_at: nowIso(), read_at: null, message_type: 'text', type: 'text',
        sticker: null, attachments: [], reactions: [], replyTo: null
      };
      session.messages.push(message);
      session.history.push({ role: 'model', parts: [{ text: message.content }] });
      session.history = session.history.slice(-20);
      io.to(userRoom(userId)).emit('chat:typing', { userId: session.partnerId, typing: false });
      io.to(userRoom(userId)).emit('ai:message', message);
    }
  })().catch(error => {
    console.error('[SOLVI] AI conversation queue failed:', error.message);
  }).finally(() => {
    session.processing = false;
    if (session.pending.length && aiSessions.get(userId) === session) queueAiTurn(userId, session, session.pending.shift());
  });
}
function issueToken(user) {
  const sessionId = crypto.randomUUID();
  const createdAt = new Date();
  const lifetimeMs = user.account_type === 'guest' ? 3 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(createdAt.getTime() + lifetimeMs);
  transaction(() => {
    dbRun('DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?', [user.id, createdAt.toISOString()]);
    dbRun('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [sessionId, user.id, createdAt.toISOString(), expiresAt.toISOString()]);
  });
  return jwt.sign({ sub: user.id, publicId: user.public_id, accountType: user.account_type || 'registered' }, JWT_SECRET, { expiresIn: user.account_type === 'guest' ? '3d' : '7d', issuer: 'orbit-chat', jwtid: sessionId }); // issuer kept for existing sessions
}
function cleanUsername(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 20 || /[<>\u0000-\u001f]/.test(name)) return null;
  return name;
}
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Требуется вход в аккаунт.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET, { issuer: 'orbit-chat', ignoreExpiration: true });
    const user = getUserById(payload.sub);
    const session = dbGet('SELECT id, revoked_at, expires_at FROM sessions WHERE id = ? AND user_id = ?', [payload.jti, payload.sub]);
    if (!user || !session || session.revoked_at || session.expires_at <= nowIso()) return res.status(401).json({ error: 'Сессия недействительна. Войдите снова.' });
    if (Number(payload.exp || 0) * 1000 <= Date.now() && user.account_type !== 'guest') return res.status(401).json({ error: 'Сессия истекла. Войдите снова.' });
    if (user.account_type === 'guest' && user.guest_expires_at && user.guest_expires_at <= nowIso()) return res.status(401).json({ error: 'Срок гостевого доступа истёк. Создай новый гостевой профиль.' });
    if (user.suspended_until && user.suspended_until > nowIso()) return res.status(403).json({ error: `Доступ временно ограничен до ${new Date(user.suspended_until).toLocaleString('ru-RU')}. Причина: ${user.suspension_reason || 'нарушение правил'}.` });
    req.user = user;
    req.authJti = payload.jti;
    next();
  } catch {
    return res.status(401).json({ error: 'Сессия истекла. Войдите снова.' });
  }
}

async function main() {
  console.log(`[SOLVI] Node.js ${process.version} detected.`);
  console.log('[1/5] Открываем встроенную SQLite-базу…');
  if (fs.existsSync(DB_FILE) && !fs.existsSync(NATIVE_DB_BACKUP)) {
    fs.copyFileSync(DB_FILE, NATIVE_DB_BACKUP, fs.constants.COPYFILE_EXCL);
    console.log(`[SOLVI] Создан резервный снимок старой базы: ${NATIVE_DB_BACKUP}`);
  }
  db = new SqliteDatabase(DB_FILE);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  console.log(`[SOLVI] База готова: ${DB_FILE}`);
  console.log('[2/5] Проверяем схему и миграции…');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      username_key TEXT,
      password_hash TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT '🪐',
      avatar_file TEXT,
      avatar_mime TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      subscription_tier TEXT NOT NULL DEFAULT 'free',
      subscription_expires_at TEXT,
      last_daily_claim_at TEXT,
      suspended_until TEXT,
      suspension_reason TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      tokens INTEGER NOT NULL DEFAULT 0,
      languages TEXT NOT NULL DEFAULT '[]',
      interests TEXT NOT NULL DEFAULT '[]',
      adult_asserted_at TEXT NOT NULL DEFAULT 'NOT_COLLECTED',
      settings_json TEXT NOT NULL DEFAULT '{}',
      account_type TEXT NOT NULL DEFAULT 'registered',
      guest_expires_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS sessions_user_created ON sessions(user_id, created_at);
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      user1_id TEXT NOT NULL REFERENCES users(id),
      user2_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      ended_at TEXT,
      end_reason TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_match_per_user1 ON matches(user1_id) WHERE status = 'active';
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_match_per_user2 ON matches(user2_id) WHERE status = 'active';
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id),
      client_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      read_at TEXT,
      message_type TEXT NOT NULL DEFAULT 'text',
      sticker_code TEXT,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      reply_to_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      UNIQUE(sender_id, client_id)
    );
    CREATE INDEX IF NOT EXISTS messages_match_created ON messages(match_id, created_at);
    CREATE TABLE IF NOT EXISTS media_files (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stored_name TEXT NOT NULL UNIQUE,
      media_kind TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS media_match_idx ON media_files(match_id);
    CREATE TABLE IF NOT EXISTS store_purchases (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, item_id TEXT NOT NULL, price INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(user_id, item_id));
    CREATE TABLE IF NOT EXISTS store_inventory (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, item_id TEXT NOT NULL, acquired_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'purchase', PRIMARY KEY(user_id, item_id));
    CREATE TABLE IF NOT EXISTS store_equipped (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, slot TEXT NOT NULL, item_id TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, slot));
    CREATE TABLE IF NOT EXISTS token_transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, amount INTEGER NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS favorites (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY(user_id, target_user_id), CHECK(user_id != target_user_id));
    CREATE TABLE IF NOT EXISTS favorite_chat_drafts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      match_id TEXT NOT NULL, partner_id TEXT NOT NULL, partner_username TEXT NOT NULL, partner_avatar TEXT NOT NULL DEFAULT '◉',
      messages_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      UNIQUE(user_id, match_id)
    );
    CREATE INDEX IF NOT EXISTS favorite_chat_drafts_expiry ON favorite_chat_drafts(expires_at);
    CREATE TABLE IF NOT EXISTS favorite_chats (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      match_id TEXT NOT NULL, partner_id TEXT NOT NULL, partner_username TEXT NOT NULL, partner_avatar TEXT NOT NULL DEFAULT '◉',
      messages_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL,
      UNIQUE(user_id, match_id)
    );
    CREATE INDEX IF NOT EXISTS favorite_chats_created ON favorite_chats(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK(category IN ('idea','bug')), title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','closed')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS support_tickets_user ON support_tickets(user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS support_ticket_messages (
      id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS support_ticket_messages_thread ON support_ticket_messages(ticket_id, created_at);
    CREATE TABLE IF NOT EXISTS site_social_links (
      id TEXT PRIMARY KEY, platform TEXT NOT NULL, label TEXT NOT NULL, url TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '↗', enabled INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reward_tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, platform TEXT NOT NULL,
      url TEXT NOT NULL, reward_tokens INTEGER NOT NULL CHECK(reward_tokens BETWEEN 1 AND 5000),
      sponsor_name TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
      max_claims INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reward_task_submissions (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES reward_tasks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, proof_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      review_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, reviewed_at TEXT, reviewed_by TEXT REFERENCES users(id),
      UNIQUE(task_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS reward_task_submissions_status ON reward_task_submissions(status, created_at DESC);
    CREATE TABLE IF NOT EXISTS payment_records (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_reference TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tier TEXT NOT NULL CHECK(tier IN ('vip','premium')), days INTEGER NOT NULL,
      amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS payment_records_user ON payment_records(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS moderation_actions (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, action TEXT NOT NULL, reason TEXT NOT NULL, expires_at TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports_status (report_id TEXT PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'open', reviewed_by TEXT REFERENCES users(id), reviewed_at TEXT, resolution TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS promo_codes (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, token_reward INTEGER NOT NULL DEFAULT 0,
      item_id TEXT, membership_tier TEXT, membership_days INTEGER, max_uses INTEGER NOT NULL DEFAULT 1,
      uses INTEGER NOT NULL DEFAULT 0, starts_at TEXT, expires_at TEXT, active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS promo_redemptions (
      promo_id TEXT NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      redeemed_at TEXT NOT NULL, PRIMARY KEY(promo_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS store_price_overrides (
      item_id TEXT PRIMARY KEY, price INTEGER NOT NULL CHECK(price >= 0), enabled INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT REFERENCES users(id), updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
      target_id TEXT, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS token_earning_daily (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL,
      earned INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, day)
    );
    CREATE TABLE IF NOT EXISTS message_reactions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(message_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      blocker_id TEXT NOT NULL REFERENCES users(id),
      blocked_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(blocker_id, blocked_id)
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL REFERENCES users(id),
      reported_id TEXT NOT NULL REFERENCES users(id),
      category TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      context_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
  `);

  await initializePersistentStorage();

  // Backward-compatible migration: keep legacy accounts, normalize unique nicknames,
  // and add synced preferences without collecting birth dates or age declarations.
  const userColumns = dbAll('PRAGMA table_info(users)').map(column => column.name);
  const promoColumns = dbAll('PRAGMA table_info(promo_codes)').map(column => column.name);
  if (!promoColumns.includes('target_user_id')) db.exec('ALTER TABLE promo_codes ADD COLUMN target_user_id TEXT REFERENCES users(id) ON DELETE CASCADE');
  db.exec('CREATE INDEX IF NOT EXISTS promo_codes_target_user_idx ON promo_codes(target_user_id, created_at DESC)');
  if (!userColumns.includes('username_key')) db.exec('ALTER TABLE users ADD COLUMN username_key TEXT');
  if (!userColumns.includes('settings_json')) db.exec("ALTER TABLE users ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'");
  if (!userColumns.includes('account_type')) db.exec("ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'registered'");
  if (!userColumns.includes('guest_expires_at')) db.exec('ALTER TABLE users ADD COLUMN guest_expires_at TEXT');
  if (!userColumns.includes('description')) db.exec("ALTER TABLE users ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  if (!userColumns.includes('tokens')) db.exec('ALTER TABLE users ADD COLUMN tokens INTEGER NOT NULL DEFAULT 0');
  if (!userColumns.includes('avatar_file')) db.exec('ALTER TABLE users ADD COLUMN avatar_file TEXT');
  if (!userColumns.includes('avatar_mime')) db.exec('ALTER TABLE users ADD COLUMN avatar_mime TEXT');
  if (!userColumns.includes('suspended_until')) db.exec('ALTER TABLE users ADD COLUMN suspended_until TEXT');
  if (!userColumns.includes('suspension_reason')) db.exec("ALTER TABLE users ADD COLUMN suspension_reason TEXT NOT NULL DEFAULT ''");
  if (!userColumns.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
  if (!userColumns.includes('subscription_tier')) db.exec("ALTER TABLE users ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'free'");
  if (!userColumns.includes('subscription_expires_at')) db.exec('ALTER TABLE users ADD COLUMN subscription_expires_at TEXT');
  if (!userColumns.includes('last_daily_claim_at')) db.exec('ALTER TABLE users ADD COLUMN last_daily_claim_at TEXT');
  if (!userColumns.includes('paid_subscription_tier')) db.exec("ALTER TABLE users ADD COLUMN paid_subscription_tier TEXT NOT NULL DEFAULT 'free'");
  if (!userColumns.includes('paid_subscription_expires_at')) db.exec('ALTER TABLE users ADD COLUMN paid_subscription_expires_at TEXT');
  if (!userColumns.includes('gender')) db.exec("ALTER TABLE users ADD COLUMN gender TEXT NOT NULL DEFAULT ''");
  const matchColumns = dbAll('PRAGMA table_info(matches)').map(column => column.name);
  if (!matchColumns.includes('active_seconds')) db.exec('ALTER TABLE matches ADD COLUMN active_seconds INTEGER NOT NULL DEFAULT 0');
  if (!matchColumns.includes('credited_minutes')) db.exec('ALTER TABLE matches ADD COLUMN credited_minutes INTEGER NOT NULL DEFAULT 0');
  if (!matchColumns.includes('last_tick_at')) db.exec('ALTER TABLE matches ADD COLUMN last_tick_at TEXT');
  if (!matchColumns.includes('mode')) db.exec("ALTER TABLE matches ADD COLUMN mode TEXT NOT NULL DEFAULT 'chat'");
  const messageColumns = dbAll('PRAGMA table_info(messages)').map(column => column.name);
  if (!messageColumns.includes('message_type')) db.exec("ALTER TABLE messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text'");
  if (!messageColumns.includes('sticker_code')) db.exec('ALTER TABLE messages ADD COLUMN sticker_code TEXT');
  if (!messageColumns.includes('reply_to_id')) db.exec('ALTER TABLE messages ADD COLUMN reply_to_id TEXT REFERENCES messages(id) ON DELETE SET NULL');
  if (!messageColumns.includes('attachments_json')) db.exec("ALTER TABLE messages ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]'");
  const defaultSocialLinks = [
    { id: 'solvi-social-telegram', platform: 'Telegram', label: 'Telegram SOLVI', url: 'https://t.me/ChatSolvi', icon: '✈', sortOrder: 10 },
    { id: 'solvi-social-tiktok', platform: 'TikTok', label: 'TikTok SOLVI', url: 'https://www.tiktok.com/@slabenk1y_armagedon', icon: '♪', sortOrder: 20 }
  ];
  for (const link of defaultSocialLinks) {
    if (!dbGet('SELECT id FROM site_social_links WHERE id = ?', [link.id])) {
      const at = nowIso();
      dbRun('INSERT INTO site_social_links (id, platform, label, url, icon, enabled, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)', [link.id, link.platform, link.label, link.url, link.icon, link.sortOrder, at, at]);
    }
  }
  const usedNames = new Set();
  for (const row of dbAll('SELECT id, public_id, username, username_key FROM users ORDER BY created_at ASC, id ASC')) {
    let candidate = cleanUsername(row.username) || `user_${String(row.public_id).slice(-5)}`;
    let key = usernameKey(candidate);
    if (usedNames.has(key)) {
      const suffix = `_${String(row.public_id).slice(-4).toLowerCase()}`;
      candidate = `${candidate.slice(0, 20 - suffix.length)}${suffix}`;
      key = usernameKey(candidate);
      let bump = 2;
      while (usedNames.has(key)) {
        const extra = `_${bump++}`;
        candidate = `${candidate.slice(0, 20 - extra.length)}${extra}`;
        key = usernameKey(candidate);
      }
      dbRun('UPDATE users SET username = ?, username_key = ? WHERE id = ?', [candidate, key, row.id]);
      console.warn(`  [migration] Duplicate nickname renamed to ${candidate} for account ${row.public_id}.`);
    } else if (row.username_key !== key) {
      dbRun('UPDATE users SET username_key = ? WHERE id = ?', [key, row.id]);
    }
    usedNames.add(key);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_username_key_unique ON users(username_key)');
  db.exec("INSERT OR IGNORE INTO store_inventory (user_id, item_id, acquired_at, source) SELECT user_id, item_id, created_at, 'migration' FROM store_purchases");
  db.exec("UPDATE users SET settings_json = '{}' WHERE settings_json IS NULL OR settings_json = ''");
  db.exec("UPDATE users SET account_type = 'registered' WHERE account_type IS NULL OR account_type = ''");
  // Extend previously issued guest profiles to the new 180-day retention window.
  dbRun("UPDATE users SET guest_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', julianday(created_at) + 3.0) WHERE account_type = 'guest'");
  dbRun("UPDATE sessions SET expires_at = (SELECT guest_expires_at FROM users WHERE users.id = sessions.user_id) WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE account_type = 'guest' AND guest_expires_at IS NOT NULL)");
  // Expired temporary guests are removed during startup cleanup.
  const expiredGuests = dbAll("SELECT id FROM users WHERE account_type = 'guest' AND guest_expires_at IS NOT NULL AND guest_expires_at <= ?", [nowIso()]).map(row => row.id);
  if (expiredGuests.length) {
    const placeholders = expiredGuests.map(() => '?').join(',');
    dbRun(`DELETE FROM matches WHERE user1_id IN (${placeholders}) OR user2_id IN (${placeholders})`, [...expiredGuests, ...expiredGuests]);
    dbRun(`DELETE FROM blocks WHERE blocker_id IN (${placeholders}) OR blocked_id IN (${placeholders})`, [...expiredGuests, ...expiredGuests]);
    dbRun(`DELETE FROM reports WHERE reporter_id IN (${placeholders}) OR reported_id IN (${placeholders})`, [...expiredGuests, ...expiredGuests]);
    dbRun(`DELETE FROM users WHERE id IN (${placeholders})`, expiredGuests);
  }
  startupUserResetStatus = 'not_requested';
  const resetAlreadyDone = Boolean(dbGet("SELECT id FROM admin_audit_log WHERE action = 'solvi_initial_user_reset' LIMIT 1"));
  if (resetAlreadyDone) startupUserResetStatus = 'completed';
  else if (String(process.env.SOLVI_PURGE_NON_OWNER_USERS || '') === '1') {
    const ownerPublicId = String(process.env.OWNER_PUBLIC_ID || '').trim();
    const owner = ownerPublicId ? dbGet("SELECT id FROM users WHERE public_id = ? AND account_type = 'registered'", [ownerPublicId]) : null;
    if (!owner) {
      startupUserResetStatus = ownerPublicId ? 'skipped_owner_not_found' : 'skipped_owner_not_configured';
      console.error('[SOLVI] User reset skipped: the configured permanent owner account could not be verified.');
    } else {
      const removed = dbAll('SELECT id, avatar_file FROM users WHERE id != ?', [owner.id]);
      if (removed.length) {
        const ids = removed.map(row => row.id), marks = ids.map(() => '?').join(',');
        const matchIds = dbAll(`SELECT id FROM matches WHERE user1_id IN (${marks}) OR user2_id IN (${marks})`, [...ids, ...ids]).map(row => row.id);
        const matchMarks = matchIds.map(() => '?').join(',');
        const avatarFiles = removed.map(row => row.avatar_file).filter(Boolean);
        const mediaFiles = dbAll(`SELECT stored_name FROM media_files WHERE owner_id IN (${marks})${matchIds.length ? ` OR match_id IN (${matchMarks})` : ''}`, matchIds.length ? [...ids, ...matchIds] : ids);
        transaction(() => {
          dbRun(`DELETE FROM support_ticket_messages WHERE sender_id IN (${marks}) OR ticket_id IN (SELECT id FROM support_tickets WHERE user_id IN (${marks}))`, [...ids, ...ids]);
          dbRun(`DELETE FROM support_tickets WHERE user_id IN (${marks})`, ids);
          dbRun(`DELETE FROM favorite_chat_drafts WHERE user_id IN (${marks}) OR partner_id IN (${marks})`, [...ids, ...ids]);
          dbRun(`DELETE FROM favorite_chats WHERE user_id IN (${marks}) OR partner_id IN (${marks})`, [...ids, ...ids]);
          dbRun(`DELETE FROM messages WHERE sender_id IN (${marks})${matchIds.length ? ` OR match_id IN (${matchMarks})` : ''}`, matchIds.length ? [...ids, ...matchIds] : ids);
          dbRun(`DELETE FROM media_files WHERE owner_id IN (${marks})${matchIds.length ? ` OR match_id IN (${matchMarks})` : ''}`, matchIds.length ? [...ids, ...matchIds] : ids);
          dbRun(`DELETE FROM matches WHERE user1_id IN (${marks}) OR user2_id IN (${marks})`, [...ids, ...ids]);
          dbRun(`DELETE FROM reports WHERE reporter_id IN (${marks}) OR reported_id IN (${marks})`, [...ids, ...ids]);
          dbRun(`DELETE FROM reports_status WHERE reviewed_by IN (${marks})`, ids);
          dbRun(`DELETE FROM blocks WHERE blocker_id IN (${marks}) OR blocked_id IN (${marks})`, [...ids, ...ids]);
          dbRun(`DELETE FROM moderation_actions WHERE actor_id IN (${marks}) OR target_id IN (${marks})`, [...ids, ...ids]);
          dbRun(`DELETE FROM promo_codes WHERE created_by IN (${marks})`, ids);
          dbRun(`DELETE FROM store_price_overrides WHERE updated_by IN (${marks})`, ids);
          dbRun(`DELETE FROM admin_audit_log WHERE actor_id IN (${marks})`, ids);
          dbRun(`DELETE FROM sessions WHERE user_id IN (${marks})`, ids);
          dbRun(`DELETE FROM users WHERE id IN (${marks})`, ids);
          dbRun('INSERT INTO admin_audit_log (id, actor_id, action, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), owner.id, 'solvi_initial_user_reset', null, JSON.stringify({ removedUsers: removed.length, ownerPreserved: true }), nowIso()]);
        });
        for (const file of avatarFiles) { try { fs.unlinkSync(path.join(AVATAR_DIR, path.basename(file))); } catch { /* best-effort */ } }
        removeStoredFiles(mediaFiles);
      } else {
        dbRun('INSERT INTO admin_audit_log (id, actor_id, action, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), owner.id, 'solvi_initial_user_reset', null, JSON.stringify({ removedUsers: 0, ownerPreserved: true }), nowIso()]);
      }
      startupUserResetStatus = 'completed';
      console.log(`[SOLVI] Owner-preserving reset complete; removed ${removed.length} non-owner account(s).`);
    }
  }
  dbRun('DELETE FROM favorite_chat_drafts WHERE expires_at <= ?', [nowIso()]);

  // Preserve explicit 18+ self-attestation timestamps across restarts; they are not identity verification.

  // A process restart ends old in-memory conversations; session messages are intentionally ephemeral.
  dbRun("UPDATE matches SET status = 'ended', ended_at = ?, end_reason = 'server_restart' WHERE status = 'active'", [nowIso()]);
  db.exec('DELETE FROM messages');
  const staleMedia = dbAll('SELECT stored_name FROM media_files');
  db.exec('DELETE FROM media_files');
  removeStoredFiles(staleMedia);
  for (const entry of fs.readdirSync(UPLOAD_DIR, { withFileTypes: true })) {
    if (entry.isFile()) { try { fs.unlinkSync(path.join(UPLOAD_DIR, entry.name)); } catch { /* cleanup is best-effort */ } }
  }
  for (const user of dbAll('SELECT id FROM users')) ensureStarterInventory(user.id);
  if (persistentStore) {
    persistentDirty = true;
    await flushPersistentSnapshot(true);
  }
  console.log('[SOLVI] Миграции завершены; временные чаты и медиа после перезапуска очищены.');

  console.log('[3/5] Поднимаем HTTP API и защитные middleware…');
  const app = express();
  // cloudflared connects over loopback; trust only local proxies, not arbitrary clients.
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      const forwarded = req.get('cf-connecting-ip') ? ' via-cloudflare' : '';
      if (!['/api/health', '/api/ping'].includes(req.path) && !req.path.startsWith('/socket.io/')) console.log(`[HTTP] ${req.method} ${req.path} -> ${res.statusCode} ${Date.now() - started}ms${forwarded}`);
    });
    next();
  });
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null
      }
    },
    crossOriginEmbedderPolicy: false
  }));
  app.post('/api/billing/stripe/webhook', express.raw({ type: 'application/json', limit: '256kb' }), (req, res) => {
    const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    if (!webhookSecret) return res.status(503).send('Stripe webhook is not configured');
    const signature = String(req.get('stripe-signature') || '');
    const timestampPart = signature.split(',').find(part => part.startsWith('t='));
    const signatures = signature.split(',').filter(part => part.startsWith('v1=')).map(part => part.slice(3));
    const timestamp = Number(timestampPart?.slice(2));
    if (!Number.isInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 || !signatures.length || !Buffer.isBuffer(req.body)) return res.status(400).send('Invalid Stripe signature');
    const signedPayload = Buffer.concat([Buffer.from(String(timestamp) + '.'), req.body]);
    const expected = crypto.createHmac('sha256', webhookSecret).update(signedPayload).digest();
    const validSignature = signatures.some(value => {
      let actual; try { actual = Buffer.from(value, 'hex'); } catch { return false; }
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    });
    if (!validSignature) return res.status(400).send('Invalid Stripe signature');
    let event; try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).send('Invalid payload'); }
    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object || {};
      if (session.payment_status === 'paid' && session.mode === 'payment') {
        const userId = String(session.metadata?.userId || '');
        const product = BILLING_PRODUCTS.find(item => item.id === session.metadata?.productId);
        const user = userId ? getUserById(userId) : null;
        const amount = Number(session.amount_total);
        const currency = String(session.currency || '').toLowerCase();
        if (!product || session.metadata?.tier !== product.tier || Number(session.metadata?.days) !== product.days || amount !== product.amountMinor || currency !== product.currency || !user || user.account_type === 'guest') return res.status(400).send('Invalid checkout metadata or payment amount');
        const reference = String(session.id || '');
        if (!reference) return res.status(400).send('Missing checkout reference');
        if (!dbGet('SELECT id FROM payment_records WHERE provider_reference = ?', [reference])) {
          const at = nowIso();
          const currentExpiry = user.paid_subscription_expires_at && Date.parse(user.paid_subscription_expires_at) > Date.now() ? Date.parse(user.paid_subscription_expires_at) : Date.now();
          const nextTier = user.paid_subscription_tier === 'premium' && currentExpiry > Date.now() || product.tier === 'premium' ? 'premium' : 'vip';
          const expires = new Date(currentExpiry + product.days * 86400000).toISOString();
          try {
            transaction(() => {
              dbRun('INSERT INTO payment_records (id,provider,provider_reference,user_id,tier,days,amount_minor,currency,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [crypto.randomUUID(), 'stripe', reference, userId, product.tier, product.days, amount, currency.toUpperCase(), at]);
              dbRun('UPDATE users SET paid_subscription_tier = ?, paid_subscription_expires_at = ? WHERE id = ?', [nextTier, expires, userId]);
            });
          } catch (error) {
            if (!dbGet('SELECT id FROM payment_records WHERE provider_reference = ?', [reference])) throw error;
          }
          io?.to?.(userRoom(userId))?.emit('billing:completed', { tier: nextTier, expiresAt: expires });
        }
      }
    }
    res.json({ received: true });
  });
  app.use(express.json({ limit: '32kb' }));
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Слишком много попыток. Попробуйте позже.' } }));
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));

  app.get('/api/ping', (_req, res) => res.status(200).json({ ok: true, service: 'solvi-chat' }));

  app.get('/api/health', (_req, res) => {
    const ownerConfigured = Boolean(String(process.env.OWNER_PUBLIC_ID || '').trim());
    const ownerAccountPresent = ownerConfigured && Boolean(dbGet("SELECT id FROM users WHERE public_id = ? AND account_type = 'registered'", [process.env.OWNER_PUBLIC_ID]));
    const resetCompleted = Boolean(dbGet("SELECT id FROM admin_audit_log WHERE action = 'solvi_initial_user_reset' LIMIT 1"));
    res.json({ ok: true, service: 'solvi-chat', brand: 'SOLVI', version: APP_VERSION, node: process.version, sqlite: db.prepare('SELECT sqlite_version() AS version').get().version, storage: persistentStore?.ready ? 'node:sqlite+neon-persistent-snapshot' : 'node:sqlite-ephemeral', persistentStorage: Boolean(persistentStore?.ready), online: onlineUserIds().size, publicMode: PUBLIC_MODE, ownerConfigured, ownerAccountPresent, resetCompleted, users: Number(dbGet('SELECT COUNT(*) AS n FROM users').n) });
  });
  app.get('/api/billing/catalog', authMiddleware, (_req, res) => {
    const configured = Boolean(String(process.env.STRIPE_SECRET_KEY || '').trim() && String(process.env.STRIPE_WEBHOOK_SECRET || '').trim() && String(process.env.APP_PUBLIC_URL || process.env.RENDER_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim() && BILLING_PRODUCTS.every(product => product.amountMinor > 0));
    res.json({ configured, currency: BILLING_CURRENCY.toUpperCase(), products: BILLING_PRODUCTS });
  });
  app.post('/api/billing/checkout', authMiddleware, async (req, res) => {
    const secret = String(process.env.STRIPE_SECRET_KEY || '').trim();
    if (!secret || !String(process.env.STRIPE_WEBHOOK_SECRET || '').trim()) return res.status(503).json({ error: 'Онлайн-оплата пока не подключена. Владелец должен добавить STRIPE_SECRET_KEY и STRIPE_WEBHOOK_SECRET в Render.' });
    if (req.user.account_type === 'guest' || isOwner(req.user)) return res.status(403).json({ error: 'Покупка доступна постоянным пользовательским аккаунтам.' });
    const product = BILLING_PRODUCTS.find(item => item.id === req.body?.productId);
    if (!product) return res.status(404).json({ error: 'Тариф оплаты не найден.' });
    if (!Number.isSafeInteger(product.amountMinor) || product.amountMinor < 1) return res.status(503).json({ error: `Владелец должен настроить цены VIP и Premium в ${BILLING_CURRENCY.toUpperCase()} через VIP_PRICE_MINOR и PREMIUM_PRICE_MINOR.` });
    const baseUrl = String(process.env.APP_PUBLIC_URL || process.env.RENDER_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
    if (!/^https:\/\//i.test(baseUrl)) return res.status(503).json({ error: 'Владелец должен указать APP_PUBLIC_URL для возврата после оплаты.' });
    const form = new URLSearchParams({
      mode: 'payment',
      'payment_method_types[0]': 'card',
      success_url: baseUrl + '/?billing=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: baseUrl + '/?billing=cancelled',
      client_reference_id: req.user.id,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': product.currency,
      'line_items[0][price_data][unit_amount]': String(product.amountMinor),
      'line_items[0][price_data][product_data][name]': product.name,
      'line_items[0][price_data][product_data][description]': product.description,
      'metadata[userId]': req.user.id,
      'metadata[tier]': product.tier,
      'metadata[days]': String(product.days),
      'metadata[productId]': product.id
    });
    try {
      const response = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
      const result = await response.json();
      if (!response.ok || !result.url) return res.status(502).json({ error: result.error?.message || 'Не удалось создать платёжную сессию.' });
      res.json({ url: result.url });
    } catch { res.status(502).json({ error: 'Платёжный сервис временно недоступен.' }); }
  });
  app.get('/api/config', (_req, res) => res.json({ languages: LANGUAGES, interests: INTERESTS, flirtInterests: FLIRT_INTERESTS, roleplayInterests: ROLEPLAY_INTERESTS, avatars: AVATARS, stickers: BASE_STICKERS, reactions: ['❤️', '😂', '🔥', '👏'], matchingEnabled: !PUBLIC_MODE || PUBLIC_MATCHING, publicMode: PUBLIC_MODE, inviteRequired: PUBLIC_MODE, guestEnabled: true, socialLinks: dbAll('SELECT id, platform, label, url, icon FROM site_social_links WHERE enabled = 1 ORDER BY sort_order, created_at').map(row => ({...row})), media: { images: true, voice: true, maxImagesPerMessage: { free: 3, vip: 5, premium: 10 }, maxImageBytes: MAX_IMAGE_BYTES, maxAudioBytes: MAX_AUDIO_BYTES, maxVoiceSeconds: { free: 30, vip: 45, premium: 60 } }, economy: { tokensPerMinute: 1, countsWhenBothConnected: true } }));

  function checkPublicInvite(req, res) {
    if (!PUBLIC_MODE) return true;
    if (!PUBLIC_TEST_CODE) {
      res.status(503).json({ error: 'Публичный режим не настроен: организатор должен задать код приглашения.' });
      return false;
    }
    const supplied = typeof req.body?.accessCode === 'string' ? req.body.accessCode.trim() : '';
    const expected = Buffer.from(PUBLIC_TEST_CODE);
    const actual = Buffer.from(supplied);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      res.status(403).json({ error: 'Неверный код приглашения. Попроси его у организатора теста.' });
      return false;
    }
    return true;
  }

  app.post('/api/auth/register', async (req, res) => {
    if (!checkPublicInvite(req, res)) return;
    const username = cleanUsername(req.body?.username);
    const password = req.body?.password;
    if (!username) return res.status(400).json({ error: 'Ник должен содержать от 3 до 20 символов.' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) return res.status(400).json({ error: 'Пароль должен быть длиной от 8 до 72 символов.' });
    const key = usernameKey(username);
    if (dbGet('SELECT id FROM users WHERE username_key = ? LIMIT 1', [key])) {
      return res.status(409).json({ error: 'Этот ник уже занят. Попробуй другой.' });
    }
    const id = crypto.randomUUID();
    const publicId = crypto.randomBytes(5).toString('hex').toUpperCase();
    const passwordHash = await bcrypt.hash(password, 12);
    const createdAt = nowIso();
    try {
      transaction(() => {
        dbRun('INSERT INTO users (id, public_id, username, username_key, password_hash, avatar, adult_asserted_at, settings_json, tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 50, ?)', [id, publicId, username, key, passwordHash, AVATARS[crypto.randomInt(AVATARS.length)], 'NOT_COLLECTED', JSON.stringify(DEFAULT_SETTINGS), createdAt]);
        dbRun('INSERT INTO token_transactions (id, user_id, kind, amount, description, created_at) VALUES (?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), id, 'registration_bonus', 50, 'Бонус за регистрацию', createdAt]);
      });
    } catch (error) {
      if (String(error.message).includes('username_key')) return res.status(409).json({ error: 'Этот ник уже занят. Попробуй другой.' });
      console.error('Registration failed:', error.message);
      return res.status(500).json({ error: 'Не удалось создать аккаунт. Попробуйте ещё раз.' });
    }
    ensureStarterInventory(id);
    const user = getUserById(id);
    res.status(201).json({ token: issueToken(user), user: publicUser(user) });
  });

  app.post('/api/auth/guest', async (req, res) => {
    if (!checkPublicInvite(req, res)) return;
    let username = '';
    let key = '';
    for (let attempt = 0; attempt < 12; attempt += 1) {
      username = `Гость-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      key = usernameKey(username);
      if (!dbGet('SELECT id FROM users WHERE username_key = ? LIMIT 1', [key])) break;
      username = '';
    }
    if (!username) return res.status(503).json({ error: 'Не удалось выдать гостевое имя. Попробуй ещё раз.' });
    const id = crypto.randomUUID();
    const publicId = crypto.randomBytes(5).toString('hex').toUpperCase();
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 8);
    const createdAt = nowIso();
    const guestExpiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    transaction(() => {
      dbRun('INSERT INTO users (id, public_id, username, username_key, password_hash, avatar, adult_asserted_at, settings_json, account_type, guest_expires_at, tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)', [id, publicId, username, key, passwordHash, AVATARS[crypto.randomInt(AVATARS.length)], 'NOT_COLLECTED', JSON.stringify(DEFAULT_SETTINGS), 'guest', guestExpiresAt, createdAt]);
    });
    ensureStarterInventory(id);
    const user = getUserById(id);
    res.status(201).json({ token: issueToken(user), user: publicUser(user) });
  });

  app.post('/api/auth/claim', authMiddleware, (req, res) => {
    if (req.user.account_type !== 'guest') return res.status(400).json({ error: 'Этот аккаунт уже постоянный.' });
    return res.status(403).json({ error: 'Гостевой аккаунт нельзя превратить в постоянный: ник и пароль гостя менять нельзя.' });
  });

  app.post('/api/auth/login', async (req, res) => {
    if (!checkPublicInvite(req, res)) return;
    const username = cleanUsername(req.body?.username);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!username || !password) return res.status(401).json({ error: 'Укажи ник и пароль.' });
    const user = dbGet('SELECT * FROM users WHERE username_key = ? LIMIT 1', [usernameKey(username)]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Неверный ник или пароль.' });
    if (user.suspended_until && user.suspended_until > nowIso()) return res.status(403).json({ error: `Доступ временно ограничен. Причина: ${user.suspension_reason || 'нарушение правил'}.` });
    ensureStarterInventory(user.id);
    res.json({ token: issueToken(user), user: publicUser(getUserById(user.id)) });
  });

  app.post('/api/auth/logout', authMiddleware, (req, res) => {
    transaction(() => dbRun('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ?', [nowIso(), req.authJti, req.user.id]));
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.jti === req.authJti) socket.disconnect(true);
    }
    res.json({ ok: true });
  });

  app.get('/api/me', authMiddleware, (req, res) => {
    ensureStarterInventory(req.user.id);
    const activeMatch = getActiveMatch(req.user.id);
    res.json({ user: publicUser(getUserById(req.user.id)), activeMatch: activeMatch ? matchPayload(activeMatch, req.user.id) : null });
  });
  app.get('/api/sessions', authMiddleware, (req, res) => {
    const sessions = dbAll('SELECT id, created_at, expires_at FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 30', [req.user.id, nowIso()]);
    res.json({ sessions: sessions.map(session => ({ id: session.id, createdAt: session.created_at, expiresAt: session.expires_at, current: session.id === req.authJti })) });
  });
  app.delete('/api/sessions/:sessionId', authMiddleware, (req, res) => {
    if (req.params.sessionId === req.authJti) return res.status(400).json({ error: 'Текущую сессию заверши кнопкой «Выйти».' });
    const target = dbGet('SELECT id FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL', [req.params.sessionId, req.user.id]);
    if (!target) return res.status(404).json({ error: 'Активная сессия не найдена.' });
    transaction(() => dbRun('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL', [nowIso(), req.params.sessionId, req.user.id]));
    for (const socket of io.sockets.sockets.values()) if (socket.data.jti === req.params.sessionId) socket.disconnect(true);
    res.json({ ok: true });
  });

  app.patch('/api/profile', authMiddleware, (req, res) => {
    const hasAvatarChoice = Object.prototype.hasOwnProperty.call(req.body || {}, 'avatar');
    const avatar = req.body?.avatar;
    if (hasAvatarChoice && !AVATARS.includes(avatar)) return res.status(400).json({ error: 'Выберите аватар из каталога.' });

    if (req.user.account_type === 'guest') {
      // Guests may personalize their avatar without changing account identity.
      if (!hasAvatarChoice) return res.status(403).json({ error: 'Гостевой профиль может менять только аватар.' });
      const oldAvatarFile = req.user.avatar_file;
      transaction(() => dbRun('UPDATE users SET avatar = ?, avatar_file = NULL, avatar_mime = NULL WHERE id = ?', [avatar, req.user.id]));
      if (oldAvatarFile) { try { fs.unlinkSync(path.join(AVATAR_DIR, path.basename(oldAvatarFile))); } catch { /* best-effort cleanup */ } }
      return res.json({ user: publicUser(getUserById(req.user.id)) });
    }

    const username = cleanUsername(req.body?.username);
    const description = typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 160) : (req.user.description || '');
    const gender = req.body?.gender === undefined ? (req.user.gender || '') : String(req.body.gender).trim();
    if (!['', 'male', 'female', 'other'].includes(gender)) return res.status(400).json({ error: 'Выбери допустимое значение пола.' });
    if (!username) return res.status(400).json({ error: 'Ник должен содержать от 3 до 20 символов.' });
    const key = usernameKey(username);
    const taken = dbGet('SELECT id FROM users WHERE username_key = ? AND id != ? LIMIT 1', [key, req.user.id]);
    if (taken) return res.status(409).json({ error: 'Этот ник уже занят. Выбери другой.' });
    const oldAvatarFile = hasAvatarChoice ? req.user.avatar_file : null;
    transaction(() => {
      if (hasAvatarChoice) dbRun('UPDATE users SET username = ?, username_key = ?, avatar = ?, avatar_file = NULL, avatar_mime = NULL, description = ?, gender = ? WHERE id = ?', [username, key, avatar, description, gender, req.user.id]);
      else dbRun('UPDATE users SET username = ?, username_key = ?, description = ?, gender = ? WHERE id = ?', [username, key, description, gender, req.user.id]);
    });
    if (oldAvatarFile) { try { fs.unlinkSync(path.join(AVATAR_DIR, path.basename(oldAvatarFile))); } catch { /* best-effort cleanup */ } }
    res.json({ user: publicUser(getUserById(req.user.id)) });
  });

  app.get('/api/store', authMiddleware, (req, res) => {
    ensureStarterInventory(req.user.id);
    const user = getUserById(req.user.id);
    const owned = new Set(dbAll('SELECT item_id FROM store_inventory WHERE user_id = ?', [req.user.id]).map(row => row.item_id));
    const equipped = getEquippedItems(req.user.id);
    const items = STORE_CATALOG.map(item => {
      const override = storePrice(item.id, item.price);
      return { ...item, price: override.price, enabled: override.enabled, owned: owned.has(item.id), equipped: equipped[item.slot] === item.id };
    });
    const inventory = dbAll('SELECT item_id, acquired_at, source FROM store_inventory WHERE user_id = ? ORDER BY acquired_at DESC', [req.user.id]);
    const collections = [...new Set(STORE_CATALOG.map(item => item.collection).filter(Boolean))].map(name => ({ name, total: STORE_CATALOG.filter(item => item.collection === name).length, owned: STORE_CATALOG.filter(item => item.collection === name && owned.has(item.id)).length }));
    res.json({ balance: Number(user.tokens || 0), categories: ['Все', ...new Set(STORE_CATALOG.map(item => item.category))], collections, equipped, items, inventory,
      memberships: MEMBERSHIP_PACKAGES.map(item => ({ ...item, current: effectiveSubscription(user) === item.tier })),
      bundles: STORE_BUNDLES.map(bundle => ({ ...bundle, owned: Boolean(dbGet('SELECT id FROM store_purchases WHERE user_id = ? AND item_id = ?', [req.user.id, bundle.id])), available: bundle.tier === 'vip' ? ['vip','premium'].includes(effectivePaidSubscription(user)) : effectivePaidSubscription(user) === 'premium', requirement: 'Только при активной привилегии, оплаченной реальными деньгами' })) });
  });
  app.get('/api/inventory', authMiddleware, (req, res) => {
    ensureStarterInventory(req.user.id);
    const ownedRows = dbAll('SELECT item_id, acquired_at, source FROM store_inventory WHERE user_id = ? ORDER BY acquired_at DESC', [req.user.id]);
    const equipped = getEquippedItems(req.user.id);
    const items = ownedRows.map(row => {
      const item = STORE_CATALOG.find(entry => entry.id === row.item_id);
      return item ? { ...item, acquiredAt: row.acquired_at, source: row.source, equipped: equipped[item.slot] === item.id } : null;
    }).filter(Boolean);
    res.json({ balance: Number(getUserById(req.user.id).tokens || 0), items, equipped, memberships: { tier: effectiveSubscription(req.user), expiresAt: req.user.subscription_expires_at || null } });
  });
  app.post('/api/store/buy', authMiddleware, (req, res) => {
    const item = STORE_CATALOG.find(row => row.id === req.body?.itemId);
    if (!item) return res.status(404).json({ error: 'Товар не найден.' });
    if (item.bundleOnly) return res.status(403).json({ error: 'Этот предмет доступен только в составе фирменного набора.' });
    ensureStarterInventory(req.user.id);
    const priceInfo = storePrice(item.id, item.price);
    if (!priceInfo.enabled) return res.status(404).json({ error: 'Этот предмет временно снят с продажи.' });
    const price = priceInfo.price;
    try {
      transaction(() => {
        if (dbGet('SELECT item_id FROM store_inventory WHERE user_id = ? AND item_id = ?', [req.user.id, item.id])) throw new Error('Этот предмет уже есть в коллекции.');
        const current = dbGet('SELECT tokens FROM users WHERE id = ?', [req.user.id]);
        if (!current || Number(current.tokens) < price) throw new Error('Недостаточно токенов. Баланс пополняется по 1 токену за каждую полную минуту активного диалога.');
        if (price > 0) dbRun('UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ?', [price, req.user.id, price]);
        dbRun('INSERT INTO store_inventory (user_id, item_id, acquired_at, source) VALUES (?, ?, ?, ?)', [req.user.id, item.id, nowIso(), price === 0 ? 'free' : 'purchase']);
        if (price > 0) {
          dbRun('INSERT INTO store_purchases (id, user_id, item_id, price, created_at) VALUES (?, ?, ?, ?, ?)', [crypto.randomUUID(), req.user.id, item.id, price, nowIso()]);
          dbRun('INSERT INTO token_transactions (id, user_id, kind, amount, description, created_at) VALUES (?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), req.user.id, 'purchase', -price, `Покупка: ${item.name}`, nowIso()]);
        }
      });
    } catch (error) { return res.status(400).json({ error: error.message }); }
    res.json({ ok: true, balance: Number(getUserById(req.user.id).tokens || 0), itemId: item.id });
  });
  app.post('/api/store/bundle', authMiddleware, (req, res) => {
    const bundle = STORE_BUNDLES.find(item => item.id === req.body?.bundleId);
    if (!bundle) return res.status(404).json({ error: 'Фирменный набор не найден.' });
    const paidTier = effectivePaidSubscription(req.user);
    if (bundle.tier === 'premium' ? paidTier !== 'premium' : !['vip', 'premium'].includes(paidTier)) return res.status(403).json({ error: 'Наборы доступны только при активной VIP/Premium-привилегии, оплаченной реальными деньгами. Покупка статуса за токены не подходит.' });
    try {
      transaction(() => {
        if (dbGet('SELECT id FROM store_purchases WHERE user_id = ? AND item_id = ?', [req.user.id, bundle.id])) throw new Error('Этот набор уже приобретён.');
        const current = dbGet('SELECT tokens FROM users WHERE id = ?', [req.user.id]);
        if (!current || Number(current.tokens) < bundle.price) throw new Error('Недостаточно токенов для покупки набора.');
        const createdAt = nowIso();
        dbRun('UPDATE users SET tokens = tokens - ? WHERE id = ? AND tokens >= ?', [bundle.price, req.user.id, bundle.price]);
        dbRun('INSERT INTO store_purchases (id, user_id, item_id, price, created_at) VALUES (?, ?, ?, ?, ?)', [crypto.randomUUID(), req.user.id, bundle.id, bundle.price, createdAt]);
        for (const itemId of bundle.itemIds) dbRun('INSERT OR IGNORE INTO store_inventory (user_id, item_id, acquired_at, source) VALUES (?, ?, ?, ?)', [req.user.id, itemId, createdAt, bundle.id]);
        dbRun('INSERT INTO token_transactions (id, user_id, kind, amount, description, created_at) VALUES (?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), req.user.id, 'bundle_purchase', -bundle.price, `Фирменный набор: ${bundle.name}`, createdAt]);
      });
    } catch (error) { return res.status(400).json({ error: error.message }); }
    res.json({ ok: true, balance: Number(getUserById(req.user.id).tokens || 0), itemIds: bundle.itemIds });
  });
  app.post('/api/store/membership', authMiddleware, (req, res) => {
    const pack = MEMBERSHIP_PACKAGES.find(item => item.id === req.body?.packageId);
    if (!pack) return res.status(404).json({ error: 'Пакет привилегии не найден.' });
    if (isOwner(req.user)) return res.status(400).json({ error: 'Владельцу не требуется покупать привилегии.' });
    try {
      transaction(() => {
        const current = dbGet('SELECT tokens, subscription_tier, subscription_expires_at FROM users WHERE id = ?', [req.user.id]);
        if (!current || Number(current.tokens) < pack.price) throw new Error('Недостаточно токенов для покупки привилегии.');
        const now = Date.now();
        const oldExpires = current.subscription_expires_at && Date.parse(current.subscription_expires_at) > now ? Date.parse(current.subscription_expires_at) : now;
        const activeTier = current.subscription_expires_at && Date.parse(current.subscription_expires_at) > now ? current.subscription_tier : 'free';
        const tier = activeTier === 'premium' || pack.tier === 'premium' ? 'premium' : 'vip';
        const expires = new Date(oldExpires + pack.hours * 3600000).toISOString();
        dbRun('UPDATE users SET tokens = tokens - ?, subscription_tier = ?, subscription_expires_at = ? WHERE id = ?', [pack.price, tier, expires, req.user.id]);
        dbRun('INSERT INTO token_transactions (id, user_id, kind, amount, description, created_at) VALUES (?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), req.user.id, 'membership', -pack.price, `${pack.name} · ${pack.hours} ч.`, nowIso()]);
      });
    } catch (error) { return res.status(400).json({ error: error.message }); }
    res.json({ ok: true, user: publicUser(getUserById(req.user.id)) });
  });
  app.post('/api/promos/redeem', authMiddleware, (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase().replace(/\s+/g, '') : '';
    if (!/^[A-Z0-9-]{4,32}$/.test(code)) return res.status(400).json({ error: 'Промокод имеет неверный формат.' });
    const promo = dbGet('SELECT * FROM promo_codes WHERE code = ? AND active = 1 AND (target_user_id IS NULL OR target_user_id = ?)', [code, req.user.id]);
    if (!promo) return res.status(404).json({ error: 'Промокод не найден или отключён.' });
    const now = nowIso();
    if (promo.starts_at && promo.starts_at > now) return res.status(400).json({ error: 'Промокод ещё не активен.' });
    if (promo.expires_at && promo.expires_at <= now) return res.status(400).json({ error: 'Срок действия промокода истёк.' });
    if (Number(promo.uses) >= Number(promo.max_uses)) return res.status(400).json({ error: 'Лимит активаций этого промокода исчерпан.' });
    if (promo.item_id && !STORE_CATALOG.some(item => item.id === promo.item_id)) return res.status(400).json({ error: 'Награда промокода больше недоступна.' });
    try {
      transaction(() => {
        if (dbGet('SELECT promo_id FROM promo_redemptions WHERE promo_id = ? AND user_id = ?', [promo.id, req.user.id])) throw new Error('Ты уже активировал этот промокод.');
        if (promo.item_id && dbGet('SELECT item_id FROM store_inventory WHERE user_id = ? AND item_id = ?', [req.user.id, promo.item_id])) throw new Error('Эта награда уже есть в твоей коллекции.');
        dbRun('INSERT INTO promo_redemptions (promo_id, user_id, redeemed_at) VALUES (?, ?, ?)', [promo.id, req.user.id, now]);
        dbRun('UPDATE promo_codes SET uses = uses + 1 WHERE id = ?', [promo.id]);
        if (promo.token_reward > 0) {
          dbRun('UPDATE users SET tokens = tokens + ? WHERE id = ?', [promo.token_reward, req.user.id]);
          dbRun('INSERT INTO token_transactions (id, user_id, kind, amount, description, created_at) VALUES (?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), req.user.id, 'promo', promo.token_reward, `Промокод ${code}`, now]);
        }
        if (promo.item_id) dbRun('INSERT INTO store_inventory (user_id, item_id, acquired_at, source) VALUES (?, ?, ?, ?)', [req.user.id, promo.item_id, now, 'promo']);
        if (['vip', 'premium'].includes(promo.membership_tier) && [1, 7, 30, 90].includes(Number(promo.membership_days))) {
          const current = dbGet('SELECT subscription_expires_at FROM users WHERE id = ?', [req.user.id]);
          const old = current?.subscription_expires_at && Date.parse(current.subscription_expires_at) > Date.now() ? Date.parse(current.subscription_expires_at) : Date.now();
          dbRun('UPDATE users SET subscription_tier = ?, subscription_expires_at = ? WHERE id = ?', [promo.membership_tier, new Date(old + Number(promo.membership_days) * 86400000).toISOString(), req.user.id]);
        }
      });
    } catch (error) { return res.status(400).json({ error: error.message }); }
    res.json({ ok: true, user: publicUser(getUserById(req.user.id)), reward: { tokens: Number(promo.token_reward || 0), itemId: promo.item_id || null, membershipTier: promo.membership_tier || null, membershipDays: promo.membership_days || null } });
  });
  app.post('/api/store/equip', authMiddleware, (req, res) => {
    const item = STORE_CATALOG.find(row => row.id === req.body?.itemId);
    if (!item) return res.status(404).json({ error: 'Предмет не найден.' });
    const owned = dbGet('SELECT item_id FROM store_inventory WHERE user_id = ? AND item_id = ?', [req.user.id, item.id]);
    if (!owned) return res.status(403).json({ error: 'Сначала приобрети предмет.' });
    transaction(() => dbRun('INSERT INTO store_equipped (user_id, slot, item_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, slot) DO UPDATE SET item_id = excluded.item_id, updated_at = excluded.updated_at', [req.user.id, item.slot, item.id, nowIso()]));
    res.json({ ok: true, equipped: getEquippedItems(req.user.id) });
  });
  app.delete('/api/store/equip/:slot', authMiddleware, (req, res) => {
    if (!['theme', 'wallpaper', 'bubble', 'frame', 'sound', 'stickers', 'title'].includes(req.params.slot)) return res.status(400).json({ error: 'Неизвестная категория оформления.' });
    transaction(() => dbRun('DELETE FROM store_equipped WHERE user_id = ? AND slot = ?', [req.user.id, req.params.slot]));
    res.json({ ok: true, equipped: getEquippedItems(req.user.id) });
  });

  app.get('/api/favorite-chats', authMiddleware, (req, res) => {
    dbRun('DELETE FROM favorite_chat_drafts WHERE user_id = ? AND expires_at <= ?', [req.user.id, nowIso()]);
    const rows = dbAll('SELECT id, match_id, partner_username, partner_avatar, created_at, messages_json FROM favorite_chats WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', [req.user.id]);
    const drafts = dbAll('SELECT match_id, partner_username, partner_avatar, created_at, messages_json, expires_at FROM favorite_chat_drafts WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', [req.user.id]);
    res.json({
      chats: rows.map(row => ({ id: row.id, matchId: row.match_id, partnerUsername: row.partner_username, partnerAvatar: row.partner_avatar, createdAt: row.created_at, messageCount: safeJsonArray(row.messages_json).length })),
      drafts: drafts.map(row => ({ matchId: row.match_id, partnerUsername: row.partner_username, partnerAvatar: row.partner_avatar, createdAt: row.created_at, messageCount: safeJsonArray(row.messages_json).length, expiresAt: row.expires_at }))
    });
  });
  app.post('/api/favorite-chats', authMiddleware, (req, res) => {
    const matchId = typeof req.body?.matchId === 'string' ? req.body.matchId.slice(0, 64) : '';
    if (!matchId) return res.status(400).json({ error: 'Не указан завершённый диалог.' });
    const draft = dbGet('SELECT * FROM favorite_chat_drafts WHERE user_id = ? AND match_id = ? AND expires_at > ?', [req.user.id, matchId, nowIso()]);
    if (!draft) return res.status(404).json({ error: 'Архив не найден или срок сохранения истёк.' });
    const id = crypto.randomUUID();
    transaction(() => {
      dbRun('INSERT OR IGNORE INTO favorite_chats (id, user_id, match_id, partner_id, partner_username, partner_avatar, messages_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, req.user.id, draft.match_id, draft.partner_id, draft.partner_username, draft.partner_avatar, draft.messages_json, draft.created_at]);
      dbRun('DELETE FROM favorite_chat_drafts WHERE user_id = ? AND match_id = ?', [req.user.id, matchId]);
    });
    const saved = dbGet('SELECT id FROM favorite_chats WHERE user_id = ? AND match_id = ?', [req.user.id, matchId]);
    res.status(201).json({ ok: true, id: saved?.id || id });
  });
  app.get('/api/favorite-chats/:id', authMiddleware, (req, res) => {
    const row = dbGet('SELECT id, match_id, partner_username, partner_avatar, created_at, messages_json FROM favorite_chats WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!row) return res.status(404).json({ error: 'Сохранённый диалог не найден.' });
    res.json({ chat: { id: row.id, matchId: row.match_id, partnerUsername: row.partner_username, partnerAvatar: row.partner_avatar, createdAt: row.created_at }, messages: safeJsonArray(row.messages_json) });
  });
  app.delete('/api/favorite-chats/:id', authMiddleware, (req, res) => {
    const result = dbRun('DELETE FROM favorite_chats WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ ok: true, removed: Number(result.changes || 0) > 0 });
  });

  app.get('/api/favorites', authMiddleware, (req, res) => {
    const rows = dbAll('SELECT u.id, u.username, u.avatar, u.avatar_file, u.created_at FROM favorites f JOIN users u ON u.id = f.target_user_id WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT 100', [req.user.id]);
    res.json({ favorites: rows.map(row => ({ id: row.id, username: row.username, avatar: row.avatar, avatarUrl: row.avatar_file ? `/api/avatar/${encodeURIComponent(row.id)}?v=${encodeURIComponent(row.avatar_file)}` : null, createdAt: row.created_at })) });
  });
  app.post('/api/favorites', authMiddleware, (req, res) => {
    const match = getActiveMatch(req.user.id);
    if (!match || match.id !== req.body?.matchId) return res.status(409).json({ error: 'Добавить в избранное можно только текущего собеседника.' });
    const targetId = otherUserId(match, req.user.id);
    transaction(() => dbRun('INSERT OR IGNORE INTO favorites (user_id, target_user_id, created_at) VALUES (?, ?, ?)', [req.user.id, targetId, nowIso()]));
    res.status(201).json({ ok: true });
  });
  app.delete('/api/favorites/:userId', authMiddleware, (req, res) => {
    transaction(() => dbRun('DELETE FROM favorites WHERE user_id = ? AND target_user_id = ?', [req.user.id, req.params.userId]));
    res.json({ ok: true });
  });

  app.get('/api/store/transactions', authMiddleware, (req, res) => {
    const items = dbAll('SELECT id, kind, amount, description, created_at FROM token_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', [req.user.id]);
    res.json({ transactions: items });
  });

  app.patch('/api/settings', authMiddleware, (req, res) => {
    const incoming = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const current = safeSettings(req.user.settings_json);
    const next = { ...current };
    if ('theme' in incoming) {
      if (!['light', 'dark', 'system'].includes(incoming.theme)) return res.status(400).json({ error: 'Недопустимое значение темы.' });
      next.theme = incoming.theme;
    }
    if ('sounds' in incoming) {
      if (typeof incoming.sounds !== 'boolean') return res.status(400).json({ error: 'Параметр звуков должен быть логическим.' });
      next.sounds = incoming.sounds;
    }
    if ('soundVolume' in incoming) {
      if (!Number.isInteger(incoming.soundVolume) || incoming.soundVolume < 0 || incoming.soundVolume > 100) return res.status(400).json({ error: 'Громкость должна быть от 0 до 100.' });
      next.soundVolume = incoming.soundVolume;
    }
    if ('messageScale' in incoming) {
      if (!['small', 'normal', 'large'].includes(incoming.messageScale)) return res.status(400).json({ error: 'Недопустимый размер текста.' });
      next.messageScale = incoming.messageScale;
    }
    if ('reducedMotion' in incoming) {
      if (typeof incoming.reducedMotion !== 'boolean') return res.status(400).json({ error: 'Параметр анимаций должен быть логическим.' });
      next.reducedMotion = incoming.reducedMotion;
    }
    for (const key of ['enterToSend', 'compactChat', 'browserNotifications']) {
      if (key in incoming) { if (typeof incoming[key] !== 'boolean') return res.status(400).json({ error: `Параметр ${key} должен быть логическим.` }); next[key] = incoming[key]; }
    }
    transaction(() => dbRun('UPDATE users SET settings_json = ? WHERE id = ?', [JSON.stringify(next), req.user.id]));
    res.json({ settings: next });
  });

  const avatarUploadLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false });
  app.post('/api/avatar/upload', authMiddleware, avatarUploadLimiter, express.raw({ type: '*/*', limit: '12mb' }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 16) return res.status(400).json({ error: 'Файл пустой или слишком маленький.' });
    const avatarLimit = membershipLimits(req.user).avatarBytes;
    if (req.body.length > avatarLimit) return res.status(413).json({ error: `Аватар для твоего статуса должен быть не больше ${Math.round(avatarLimit / 1024 / 1024)} МБ.` });
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const formats = {
      'image/jpeg': { ext: '.jpg', ok: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
      'image/png': { ext: '.png', ok: b => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) },
      'image/webp': { ext: '.webp', ok: b => b.length >= 12 && b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP' }
    };
    const format = formats[mime];
    if (!format || !format.ok(req.body)) return res.status(415).json({ error: 'Поддерживаются корректные изображения JPG, PNG и WebP.' });
    const storedName = `${crypto.randomUUID()}${format.ext}`;
    const fullPath = path.join(AVATAR_DIR, storedName);
    try {
      fs.writeFileSync(fullPath, req.body, { flag: 'wx' });
      const old = req.user.avatar_file;
      transaction(() => dbRun('UPDATE users SET avatar_file = ?, avatar_mime = ? WHERE id = ?', [storedName, mime, req.user.id]));
      if (old) { try { fs.unlinkSync(path.join(AVATAR_DIR, path.basename(old))); } catch { /* best-effort cleanup */ } }
      res.status(201).json({ user: publicUser(getUserById(req.user.id)) });
    } catch (error) {
      try { fs.unlinkSync(fullPath); } catch { /* ignore cleanup errors */ }
      console.error('[SOLVI] Avatar upload failed:', error.message);
      res.status(500).json({ error: 'Не удалось сохранить аватар.' });
    }
  });
  app.get('/api/avatar/:userId', (req, res) => {
    const user = dbGet('SELECT avatar_file, avatar_mime FROM users WHERE id = ?', [req.params.userId]);
    if (!user?.avatar_file) return res.status(404).end();
    const filename = path.basename(user.avatar_file);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(user.avatar_mime || 'image/jpeg').sendFile(path.join(AVATAR_DIR, filename), error => { if (error && !res.headersSent) res.status(404).end(); });
  });

  const mediaUploadLimiter = rateLimit({ windowMs: 5 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Слишком много загрузок. Подожди несколько минут.' } });
  app.post('/api/media/upload', authMiddleware, mediaUploadLimiter, express.raw({ type: '*/*', limit: '12mb' }), (req, res) => {
    const matchId = typeof req.headers['x-match-id'] === 'string' ? req.headers['x-match-id'] : '';
    const kind = typeof req.headers['x-media-kind'] === 'string' ? req.headers['x-media-kind'] : '';
    const match = getActiveMatch(req.user.id);
    if (!match || match.id !== matchId) return res.status(409).json({ error: 'Диалог уже завершён. Открой новый чат для отправки медиа.' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Файл пустой или не был передан.' });
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const data = req.body;
    let extension = '';
    let mediaKind = '';
    let signatureOk = false;
    if (kind === 'image') {
      const imageLimit = membershipLimits(req.user).imageBytes;
      if (data.length > imageLimit) return res.status(413).json({ error: `Фото для твоего статуса должно быть не больше ${Math.round(imageLimit / 1024 / 1024)} МБ.` });
      const types = {
        'image/jpeg': { ext: '.jpg', ok: b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
        'image/png': { ext: '.png', ok: b => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) },
        'image/webp': { ext: '.webp', ok: b => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' }
      };
      const definition = types[mime];
      if (!definition) return res.status(415).json({ error: 'Поддерживаются только JPG, PNG и WebP.' });
      extension = definition.ext;
      signatureOk = definition.ok(data);
      mediaKind = 'image';
    } else if (kind === 'audio') {
      const audioLimit = membershipLimits(req.user).audioBytes;
      if (data.length > audioLimit) return res.status(413).json({ error: `Голосовое сообщение для твоего статуса должно быть не больше ${Math.round(audioLimit / 1024 / 1024)} МБ.` });
      const types = {
        'audio/webm': { ext: '.webm', ok: b => b.length >= 4 && b.subarray(0, 4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) },
        'audio/ogg': { ext: '.ogg', ok: b => b.length >= 4 && b.toString('ascii', 0, 4) === 'OggS' },
        'audio/mp4': { ext: '.m4a', ok: b => b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp' }
      };
      const definition = types[mime];
      if (!definition) return res.status(415).json({ error: 'Формат голосового сообщения не поддерживается этим браузером.' });
      extension = definition.ext;
      signatureOk = definition.ok(data);
      mediaKind = 'audio';
    } else return res.status(400).json({ error: 'Неизвестный тип медиа.' });
    if (!signatureOk) return res.status(415).json({ error: 'Содержимое файла не соответствует заявленному формату.' });

    const id = crypto.randomUUID();
    const storedName = `${id}${extension}`;
    const fullPath = path.join(UPLOAD_DIR, storedName);
    try {
      fs.writeFileSync(fullPath, data, { flag: 'wx' });
      transaction(() => dbRun('INSERT INTO media_files (id, match_id, owner_id, stored_name, media_kind, mime_type, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, match.id, req.user.id, storedName, mediaKind, mime, data.length, nowIso()]));
    } catch (error) {
      try { fs.unlinkSync(fullPath); } catch { /* ignore cleanup errors */ }
      console.error('[SOLVI] Media upload failed:', error.message);
      return res.status(500).json({ error: 'Не удалось сохранить файл. Попробуй ещё раз.' });
    }
    res.status(201).json({ file: mediaPublic({ id, media_kind: mediaKind, mime_type: mime, byte_size: data.length }) });
  });

  app.delete('/api/media/:id', authMiddleware, (req, res) => {
    const file = dbGet('SELECT * FROM media_files WHERE id = ? AND owner_id = ?', [req.params.id, req.user.id]);
    if (!file) return res.status(404).json({ error: 'Временное вложение не найдено.' });
    const match = getActiveMatch(req.user.id);
    if (!match || match.id !== file.match_id) return res.status(409).json({ error: 'Диалог уже завершён.' });
    const referenced = dbAll('SELECT attachments_json FROM messages WHERE match_id = ?', [match.id]).some(row => safeJsonArray(row.attachments_json).some(item => item.id === file.id));
    if (referenced) return res.status(409).json({ error: 'Файл уже прикреплён к отправленному сообщению.' });
    transaction(() => dbRun('DELETE FROM media_files WHERE id = ?', [file.id]));
    removeStoredFiles([{ stored_name: file.stored_name }]);
    res.json({ ok: true });
  });

  app.get('/api/media/:id', authMiddleware, (req, res) => {
    const file = dbGet('SELECT * FROM media_files WHERE id = ?', [req.params.id]);
    if (!file) return res.status(404).json({ error: 'Медиафайл не найден или уже удалён.' });
    const match = dbGet("SELECT id FROM matches WHERE id = ? AND status = 'active' AND (user1_id = ? OR user2_id = ?)", [file.match_id, req.user.id, req.user.id]);
    if (!match) return res.status(404).json({ error: 'Медиафайл недоступен вне активного диалога.' });
    const storedName = path.basename(file.stored_name);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(file.mime_type).sendFile(path.join(UPLOAD_DIR, storedName), error => {
      if (error && !res.headersSent) res.status(404).end();
    });
  });

  const ticketCreateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Слишком много новых обращений. Попробуй позже.' } });
  const ticketReplyLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Слишком много сообщений в тикетах. Подожди немного.' } });
  const taskSubmitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Слишком много заявок на награду. Попробуй позже.' } });
  app.get('/api/growth', authMiddleware, (req, res) => {
    const tasks = dbAll(`SELECT t.id, t.title, t.description, t.platform, t.url, t.reward_tokens, t.sponsor_name,
      s.status AS submission_status, s.review_note, s.created_at AS submitted_at
      FROM reward_tasks t LEFT JOIN reward_task_submissions s ON s.task_id = t.id AND s.user_id = ?
      WHERE t.active = 1 ORDER BY t.created_at DESC LIMIT 100`, [req.user.id]);
    res.json({ tasks, socialLinks: dbAll('SELECT id, platform, label, url, icon FROM site_social_links WHERE enabled = 1 ORDER BY sort_order, created_at') });
  });
  app.post('/api/tasks/:id/submit', authMiddleware, taskSubmitLimiter, (req, res) => {
    if (req.user.account_type === 'guest') return res.status(403).json({ error: 'Для заданий нужен постоянный аккаунт.' });
    const task = dbGet('SELECT * FROM reward_tasks WHERE id = ? AND active = 1', [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Задание больше недоступно.' });
    if (Number(task.max_claims)>0 && Number(dbGet('SELECT COUNT(*) AS n FROM reward_task_submissions WHERE task_id=?',[task.id]).n)>=Number(task.max_claims)) return res.status(409).json({error:'Лимит участников для этого задания уже достигнут.'});
    const proofUrl = typeof req.body?.proofUrl === 'string' ? req.body.proofUrl.trim().slice(0, 500) : '';
    let parsed; try { parsed = new URL(proofUrl); } catch { return res.status(400).json({ error: 'Добавь ссылку на подтверждение (например, скриншот).' }); }
    if (parsed.protocol !== 'https:') return res.status(400).json({ error: 'Ссылка подтверждения должна начинаться с https://.' });
    const existing = dbGet('SELECT status FROM reward_task_submissions WHERE task_id = ? AND user_id = ?', [task.id, req.user.id]);
    if (existing) return res.status(409).json({ error: existing.status === 'pending' ? 'Заявка уже ожидает проверки.' : 'Это задание уже было отправлено.' });
    const id = crypto.randomUUID(), createdAt = nowIso();
    dbRun('INSERT INTO reward_task_submissions (id, task_id, user_id, proof_url, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, task.id, req.user.id, proofUrl, 'pending', createdAt]);
    res.status(201).json({ ok: true, id, status: 'pending' });
  });
  app.get('/api/tickets', authMiddleware, (req, res) => {
    const rows = dbAll(`SELECT t.id, t.category, t.title, t.status, t.created_at, t.updated_at,
      (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS message_count,
      (SELECT body FROM support_ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
      FROM support_tickets t WHERE t.user_id = ? ORDER BY t.updated_at DESC LIMIT 100`, [req.user.id]);
    res.json({ tickets: rows });
  });
  app.post('/api/tickets', authMiddleware, ticketCreateLimiter, (req, res) => {
    const category = ['idea','bug'].includes(req.body?.category) ? req.body.category : '';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 100) : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim().slice(0, 1500) : '';
    if (!category) return res.status(400).json({ error: 'Выбери идею или сообщение об ошибке.' });
    if (title.length < 5) return res.status(400).json({ error: 'Заголовок должен содержать хотя бы 5 символов.' });
    if (body.length < 15) return res.status(400).json({ error: 'Опиши обращение подробнее (минимум 15 символов).' });
    const openCount = Number(dbGet("SELECT COUNT(*) AS n FROM support_tickets WHERE user_id = ? AND status != 'closed'", [req.user.id]).n);
    if (openCount >= 5) return res.status(429).json({ error: 'У тебя уже 5 открытых обращений. Дождись ответа или закрой завершённый тикет.' });
    const id = crypto.randomUUID(), createdAt = nowIso();
    transaction(() => {
      dbRun('INSERT INTO support_tickets (id, user_id, category, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, req.user.id, category, title, 'open', createdAt, createdAt]);
      dbRun('INSERT INTO support_ticket_messages (id, ticket_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)', [crypto.randomUUID(), id, req.user.id, body, createdAt]);
    });
    res.status(201).json({ ok: true, id });
  });
  app.post('/api/tickets/:id/close', authMiddleware, (req,res)=>{
    const ticket=dbGet('SELECT id,status FROM support_tickets WHERE id=? AND user_id=?',[req.params.id,req.user.id]);
    if(!ticket)return res.status(404).json({error:'Обращение не найдено.'});
    if(ticket.status==='closed')return res.json({ok:true});
    const at=nowIso();dbRun("UPDATE support_tickets SET status='closed',updated_at=? WHERE id=?",[at,ticket.id]);
    dbRun('INSERT INTO support_ticket_messages (id,ticket_id,sender_id,body,created_at) VALUES (?,?,?,?,?)',[crypto.randomUUID(),ticket.id,req.user.id,'Пользователь закрыл обращение.',at]);
    res.json({ok:true});
  });
  app.get('/api/tickets/:id', authMiddleware, (req, res) => {
    const ticket = dbGet('SELECT id, category, title, status, created_at, updated_at FROM support_tickets WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!ticket) return res.status(404).json({ error: 'Обращение не найдено.' });
    const messages = dbAll('SELECT m.id, m.sender_id, u.username AS sender_name, m.body, m.created_at FROM support_ticket_messages m JOIN users u ON u.id = m.sender_id WHERE m.ticket_id = ? ORDER BY m.created_at ASC', [ticket.id])
      .map(m => ({ id: m.id, senderId: m.sender_id, senderName: m.sender_name, fromOwner: isOwner(getUserById(m.sender_id)), body: m.body, createdAt: m.created_at }));
    res.json({ ticket, messages });
  });
  app.post('/api/tickets/:id/messages', authMiddleware, ticketReplyLimiter, (req, res) => {
    const ticket = dbGet('SELECT id, status FROM support_tickets WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!ticket) return res.status(404).json({ error: 'Обращение не найдено.' });
    if (ticket.status === 'closed') return res.status(409).json({ error: 'Обращение закрыто. Создай новое, чтобы продолжить.' });
    const body = typeof req.body?.body === 'string' ? req.body.body.trim().slice(0, 1500) : '';
    if (body.length < 3) return res.status(400).json({ error: 'Сообщение должно содержать хотя бы 3 символа.' });
    const createdAt = nowIso();
    transaction(() => {
      dbRun('INSERT INTO support_ticket_messages (id, ticket_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)', [crypto.randomUUID(), ticket.id, req.user.id, body, createdAt]);
      dbRun('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?', ['open', createdAt, ticket.id]);
    });
    res.status(201).json({ ok: true });
  });

  app.post('/api/report', authMiddleware, (req, res) => {
    const match = getActiveMatch(req.user.id);
    if (!match) return res.status(400).json({ error: 'Нет активного диалога для жалобы.' });
    const reportedId = otherUserId(match, req.user.id);
    const categories = ['Спам', 'Оскорбления', 'Преследование', 'Мошенничество', 'Опасный контент', 'Другое'];
    const category = categories.includes(req.body?.category) ? req.body.category : 'Другое';
    const details = typeof req.body?.details === 'string' ? req.body.details.trim().slice(0, 500) : '';
    const context = dbAll('SELECT sender_id, content, created_at FROM messages WHERE match_id = ? ORDER BY created_at DESC LIMIT 5', [match.id]).reverse();
    const reportId = crypto.randomUUID();
    transaction(() => { dbRun('INSERT INTO reports (id, reporter_id, reported_id, category, details, context_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [reportId, req.user.id, reportedId, category, details, JSON.stringify(context), nowIso()]); dbRun("INSERT INTO reports_status (report_id, status) VALUES (?, 'open')", [reportId]); });
    endMatch(match.id, 'reported', req.user.id);
    res.status(201).json({ ok: true, message: 'Жалоба отправлена. Диалог завершён.' });
  });

  app.post('/api/block', authMiddleware, (req, res) => {
    const match = getActiveMatch(req.user.id);
    if (!match) return res.status(400).json({ error: 'Нет активного собеседника.' });
    const blockedId = otherUserId(match, req.user.id);
    transaction(() => dbRun('INSERT OR IGNORE INTO blocks (id, blocker_id, blocked_id, created_at) VALUES (?, ?, ?, ?)', [crypto.randomUUID(), req.user.id, blockedId, nowIso()]));
    endMatch(match.id, 'blocked', req.user.id);
    res.json({ ok: true, message: 'Пользователь заблокирован. Диалог завершён.' });
  });
  app.get('/api/blocks', authMiddleware, (req, res) => {
    const rows = dbAll('SELECT u.id, u.public_id, u.username, u.description, u.avatar, u.avatar_file, b.created_at FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC LIMIT 200', [req.user.id]);
    res.json({ blocked: rows.map(row => ({ id: row.id, publicId: row.public_id, username: row.username, description: row.description || '', avatar: row.avatar, avatarUrl: row.avatar_file ? `/api/avatar/${encodeURIComponent(row.id)}?v=${encodeURIComponent(row.avatar_file)}` : null, createdAt: row.created_at })) });
  });
  app.delete('/api/blocks/:userId', authMiddleware, (req, res) => {
    const result = dbRun('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', [req.user.id, req.params.userId]);
    res.json({ ok: true, removed: Number(result.changes || 0) > 0 });
  });

  app.delete('/api/account', authMiddleware, (req, res) => {
    const userId = req.user.id;
    const avatarFile = req.user.avatar_file;
    const active = getActiveMatch(userId);
    if (active) endMatch(active.id, 'account_deleted', userId);
    transaction(() => {
      dbRun('DELETE FROM messages WHERE sender_id = ?', [userId]);
      dbRun('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?', [userId, userId]);
      dbRun('DELETE FROM reports WHERE reporter_id = ? OR reported_id = ?', [userId, userId]);
      dbRun('DELETE FROM matches WHERE user1_id = ? OR user2_id = ?', [userId, userId]);
      dbRun('DELETE FROM users WHERE id = ?', [userId]);
    });
    removeFromQueue(userId);
    if (avatarFile) { try { fs.unlinkSync(path.join(AVATAR_DIR, path.basename(avatarFile))); } catch { /* best-effort cleanup */ } }
    io.to(userRoom(userId)).emit('account:deleted');
    res.json({ ok: true });
  });

  function ownerOnly(req, res, next) {
    if (!isOwner(req.user)) return res.status(403).json({ error: 'Функция доступна только владельцу проекта.' });
    next();
  }

  // Render control-plane credentials are server-only. Never serialize the API key to the browser.
  const renderControlConfig = () => ({
    configured: Boolean(String(process.env.RENDER_API_KEY || '').trim() && String(process.env.RENDER_SERVICE_ID || '').trim()),
    apiKey: String(process.env.RENDER_API_KEY || '').trim(),
    serviceId: String(process.env.RENDER_SERVICE_ID || '').trim(),
    actionsUrl: String(process.env.SOVLI_GITHUB_ACTIONS_URL || '').trim(),
    dashboardUrl: String(process.env.RENDER_DASHBOARD_URL || '').trim(),
    publicUrl: String(process.env.RENDER_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '')
  });
  async function renderApiRequest(endpoint, method = 'GET') {
    const cfg = renderControlConfig();
    if (!cfg.configured) throw new Error('Облачное управление не настроено. Добавь RENDER_API_KEY в переменные окружения Render; RENDER_SERVICE_ID предоставляется Render автоматически.');
    const response = await fetch(`https://api.render.com/v1${endpoint}`, {
      method,
      headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.message || payload?.error || `Render API вернул HTTP ${response.status}`;
      throw new Error(String(message).slice(0, 300));
    }
    return payload;
  }
  app.get('/api/admin/platform/render', authMiddleware, ownerOnly, async (_req, res) => {
    const cfg = renderControlConfig();
    if (!cfg.configured) {
      return res.json({ configured: false, provider: 'render', message: 'Добавь RENDER_API_KEY в Render Environment. RENDER_SERVICE_ID Render добавляет автоматически; затем перезапусти сервис.' });
    }
    try {
      const payload = await renderApiRequest(`/services/${encodeURIComponent(cfg.serviceId)}`);
      const service = payload?.service || payload;
      const details = service?.serviceDetails || {};
      const publicUrl = cfg.publicUrl || details.url || '';
      let health = { reachable: false, status: null, version: null };
      if (publicUrl) {
        try {
          const response = await fetch(new URL('/api/health', publicUrl), { signal: AbortSignal.timeout(7000), headers: { Accept: 'application/json' } });
          const data = await response.json().catch(() => ({}));
          health = { reachable: response.ok && data.ok === true, status: response.status, version: data.version || null, online: Number(data.online || 0) };
        } catch (error) { health = { reachable: false, status: null, error: String(error.message || error).slice(0, 180) }; }
      }
      res.json({
        configured: true,
        provider: 'render',
        name: service?.name || 'SOLVI',
        serviceId: cfg.serviceId,
        actionsUrl: cfg.actionsUrl,
        state: service?.suspended === 'suspended' ? 'suspended' : 'active',
        suspended: service?.suspended === 'suspended',
        publicUrl,
        dashboardUrl: cfg.dashboardUrl || service?.dashboardUrl || '',
        region: service?.region || details?.region || null,
        plan: service?.plan || details?.buildPlan || null,
        health
      });
    } catch (error) {
      res.status(502).json({ configured: true, provider: 'render', error: error.message });
    }
  });
  app.post('/api/admin/platform/render/restart', authMiddleware, ownerOnly, async (req, res) => {
    try {
      const cfg = renderControlConfig();
      if (!cfg.configured) return res.status(503).json({ error: 'Не настроен RENDER_API_KEY; RENDER_SERVICE_ID предоставляется Render автоматически.' });
      await renderApiRequest(`/services/${encodeURIComponent(cfg.serviceId)}/restart`, 'POST');
      auditAdmin(req.user.id, 'render_service_restart', cfg.serviceId, { source: 'owner_mobile_panel' });
      res.status(202).json({ ok: true, message: 'Команда перезапуска отправлена в Render. Текущий запрос может оборваться на время перезапуска.' });
    } catch (error) { res.status(502).json({ error: `Не удалось перезапустить Render-сервис: ${error.message}` }); }
  });
  app.post('/api/admin/platform/render/suspend', authMiddleware, ownerOnly, async (req, res) => {
    try {
      const cfg = renderControlConfig();
      if (!cfg.configured) return res.status(503).json({ error: 'Не настроен RENDER_API_KEY.' });
      await renderApiRequest(`/services/${encodeURIComponent(cfg.serviceId)}/suspend`, 'POST');
      auditAdmin(req.user.id, 'render_service_suspend', cfg.serviceId, { source: 'owner_mobile_panel' });
      res.status(202).json({ ok: true, message: 'Команда остановки отправлена. Для последующего запуска используй Render Dashboard → Resume или GitHub Actions.' });
    } catch (error) { res.status(502).json({ error: `Не удалось приостановить Render-сервис: ${error.message}` }); }
  });

  app.get('/api/admin/runtime', authMiddleware, ownerOnly, (_req, res) => {
    res.json({
      version: APP_VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
      publicMode: PUBLIC_MODE,
      publicMatching: PUBLIC_MATCHING,
      inviteCode: PUBLIC_MODE ? PUBLIC_TEST_CODE : '',
      tunnel: { state: tunnelRuntime.state, url: tunnelRuntime.url || String(process.env.CLOUDFLARE_PUBLIC_URL || ''), protocol: process.env.CLOUDFLARE_TUNNEL_TOKEN ? 'named' : tunnelRuntime.protocol, type: process.env.CLOUDFLARE_TUNNEL_TOKEN ? 'named' : 'quick', error: tunnelRuntime.error, startedAt: tunnelRuntime.startedAt, logs: tunnelRuntime.logs.slice(-20) },
      hosting: { provider: process.env.RENDER === 'true' ? 'render' : 'self-hosted', publicUrl: String(process.env.RENDER_EXTERNAL_URL || '').trim(), serviceIdAvailable: Boolean(process.env.RENDER_SERVICE_ID) },
      server: { host: HOST, port: PORT, pid: process.pid, node: process.version }
    });
  });
  app.post('/api/admin/runtime/public/start', authMiddleware, ownerOnly, (req, res) => {
    try {
      const protocol = ['auto', 'http2', 'quic'].includes(req.body?.protocol) ? req.body.protocol : 'auto';
      PUBLIC_MODE = true;
      PUBLIC_MATCHING = req.body?.matching !== false;
      if (!tunnelRuntime.process || !PUBLIC_TEST_CODE) PUBLIC_TEST_CODE = crypto.randomBytes(6).toString('hex').toUpperCase();
      const result = startCloudflareQuickTunnel(protocol);
      auditAdmin(req.user.id, 'public_tunnel_start', null, { protocol, matching: PUBLIC_MATCHING });
      res.status(202).json({ ...result, inviteCode: PUBLIC_TEST_CODE, publicMode: PUBLIC_MODE, publicMatching: PUBLIC_MATCHING });
    } catch (error) {
      PUBLIC_MODE = false;
      PUBLIC_MATCHING = false;
      PUBLIC_TEST_CODE = '';
      res.status(503).json({ error: error.message });
    }
  });
  app.post('/api/admin/runtime/public/stop', authMiddleware, ownerOnly, (req, res) => {
    stopCloudflareQuickTunnel();
    PUBLIC_MODE = false;
    PUBLIC_MATCHING = false;
    PUBLIC_TEST_CODE = '';
    auditAdmin(req.user.id, 'public_tunnel_stop', null, {});
    res.json({ ok: true, publicMode: false, tunnel: { state: tunnelRuntime.state } });
  });
  app.patch('/api/admin/runtime/matching', authMiddleware, ownerOnly, (req, res) => {
    PUBLIC_MATCHING = req.body?.enabled === true;
    auditAdmin(req.user.id, 'matching_toggle', null, { enabled: PUBLIC_MATCHING });
    res.json({ ok: true, enabled: PUBLIC_MATCHING });
  });
  app.post('/api/admin/users/:id/membership', authMiddleware, ownerOnly, (req, res) => {
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден.' });
    if (isOwner(target)) return res.status(400).json({ error: 'У владельца уже есть полный доступ.' });
    const tier = req.body?.tier;
    const days = Number(req.body?.days);
    if (!['vip', 'premium', 'free'].includes(tier) || ![1, 7, 30, 90].includes(days) && tier !== 'free') return res.status(400).json({ error: 'Недопустимый статус или срок.' });
    const expiresAt = tier === 'free' ? null : new Date(Date.now() + days * 86400000).toISOString();
    transaction(() => { dbRun('UPDATE users SET subscription_tier = ?, subscription_expires_at = ? WHERE id = ?', [tier, expiresAt, target.id]); auditAdmin(req.user.id, 'membership_change', target.id, { tier, days }); });
    res.json({ ok: true, user: publicUser(getUserById(target.id)) });
  });
  app.post('/api/admin/users/:id/role', authMiddleware, ownerOnly, (req, res) => {
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден.' });
    if (isOwner(target)) return res.status(400).json({ error: 'Роль владельца задаётся только серверной конфигурацией.' });
    const role = req.body?.role;
    if (!['member', 'moderator', 'developer'].includes(role)) return res.status(400).json({ error: 'Недопустимая роль.' });
    transaction(() => { dbRun('UPDATE users SET role = ? WHERE id = ?', [role, target.id]); auditAdmin(req.user.id, 'role_change', target.id, { role }); });
    res.json({ ok: true, user: publicUser(getUserById(target.id)) });
  });

  app.get('/api/admin/users', authMiddleware, ownerOnly, (req, res) => {
    const query = String(req.query.q || '').trim().slice(0, 80);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
    const offset = Math.max(0, Math.min(1000000, Number(req.query.offset) || 0));
    const like = `%${query}%`;
    const projection = "id, public_id, username, account_type, role, subscription_tier, subscription_expires_at, paid_subscription_tier, paid_subscription_expires_at, tokens, suspended_until, suspension_reason, created_at, EXISTS(SELECT 1 FROM admin_audit_log l WHERE l.target_id = users.id AND l.action = 'starter_pack') AS starter_gifted";
    const total = Number((query
      ? dbGet('SELECT COUNT(*) AS n FROM users WHERE username LIKE ? OR public_id LIKE ?', [like, like])
      : dbGet('SELECT COUNT(*) AS n FROM users')).n || 0);
    const rows = query
      ? dbAll(`SELECT ${projection} FROM users WHERE username LIKE ? OR public_id LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?`, [like, like, limit, offset])
      : dbAll(`SELECT ${projection} FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?`, [limit, offset]);
    res.json({ users: rows.map(row => ({ ...row, owner: isOwner(row), online: onlineUserIds().has(row.id) })), total, offset, hasMore: offset + rows.length < total });
  });
  app.get('/api/admin/users/:id', authMiddleware, ownerOnly, (req, res) => {
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден.' });
    const statsParams = [target.id, target.id, nowIso(), target.id, ...Array.from({ length: 17 }, () => target.id)];
    const stats = dbGet(`SELECT
      (SELECT COUNT(*) FROM sessions WHERE user_id = ?) AS total_sessions,
      (SELECT COUNT(*) FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?) AS active_sessions,
      (SELECT MAX(created_at) FROM sessions WHERE user_id = ?) AS last_login_at,
      (SELECT COUNT(*) FROM matches WHERE user1_id = ? OR user2_id = ?) AS total_matches,
      (SELECT COUNT(*) FROM matches WHERE status = 'active' AND (user1_id = ? OR user2_id = ?)) AS active_matches,
      (SELECT COALESCE(SUM(active_seconds), 0) FROM matches WHERE user1_id = ? OR user2_id = ?) AS active_seconds,
      (SELECT COUNT(*) FROM messages m JOIN matches x ON x.id = m.match_id WHERE x.user1_id = ? OR x.user2_id = ?) AS total_messages,
      (SELECT COUNT(*) FROM messages WHERE sender_id = ?) AS sent_messages,
      (SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) FROM token_transactions WHERE user_id = ?) AS tokens_earned,
      (SELECT COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) FROM token_transactions WHERE user_id = ?) AS tokens_spent,
      (SELECT COUNT(*) FROM store_inventory WHERE user_id = ?) AS inventory_count,
      (SELECT COUNT(*) FROM promo_redemptions WHERE user_id = ?) AS promo_redemptions,
      (SELECT COUNT(*) FROM support_tickets WHERE user_id = ?) AS ticket_count,
      (SELECT COUNT(*) FROM reports WHERE reported_id = ?) AS reports_received,
      (SELECT COUNT(*) FROM reports WHERE reporter_id = ?) AS reports_made,
      (SELECT COUNT(*) FROM moderation_actions WHERE target_id = ?) AS moderation_count`, statsParams);
    const user = {
      id: target.id, publicId: target.public_id, username: target.username, avatar: target.avatar,
      description: target.description || '', gender: target.gender || '', accountType: target.account_type,
      role: isOwner(target) ? 'owner' : target.role, owner: isOwner(target), online: onlineUserIds().has(target.id),
      tokens: Number(target.tokens || 0), subscriptionTier: effectiveSubscription(target),
      subscriptionExpiresAt: target.subscription_expires_at, paidSubscriptionTier: target.paid_subscription_tier || 'free',
      paidSubscriptionExpiresAt: target.paid_subscription_expires_at, suspendedUntil: target.suspended_until,
      suspensionReason: target.suspension_reason || '', createdAt: target.created_at,
      starterGifted: Boolean(dbGet("SELECT id FROM admin_audit_log WHERE action = 'starter_pack' AND target_id = ? LIMIT 1", [target.id]))
    };
    res.json({
      user,
      stats: {
        ...stats, totalSessions: Number(stats.total_sessions || 0), activeSessions: Number(stats.active_sessions || 0),
        totalMatches: Number(stats.total_matches || 0), activeMatches: Number(stats.active_matches || 0),
        activeMinutes: Math.floor(Number(stats.active_seconds || 0) / 60), totalMessages: Number(stats.total_messages || 0),
        sentMessages: Number(stats.sent_messages || 0), tokensEarned: Number(stats.tokens_earned || 0),
        tokensSpent: Number(stats.tokens_spent || 0), inventoryCount: Number(stats.inventory_count || 0),
        promoRedemptions: Number(stats.promo_redemptions || 0), ticketCount: Number(stats.ticket_count || 0),
        reportsReceived: Number(stats.reports_received || 0), reportsMade: Number(stats.reports_made || 0),
        moderationCount: Number(stats.moderation_count || 0), lastLoginAt: stats.last_login_at || null
      },
      transactions: dbAll('SELECT kind, amount, description, created_at FROM token_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 8', [target.id]),
      moderation: dbAll('SELECT action, reason, expires_at, created_at FROM moderation_actions WHERE target_id = ? ORDER BY created_at DESC LIMIT 8', [target.id]),
      personalPromos: dbAll('SELECT id, code, token_reward, membership_tier, membership_days, uses, max_uses, active, expires_at FROM promo_codes WHERE target_user_id = ? ORDER BY created_at DESC LIMIT 10', [target.id])
    });
  });
  app.post('/api/admin/users/:id/promo', authMiddleware, ownerOnly, (req, res) => {
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден.' });
    if (isOwner(target)) return res.status(403).json({ error: 'Персональную награду нельзя выдать владельцу.' });
    const code = String(req.body?.code || `SOLVI-${crypto.randomBytes(4).toString('hex').toUpperCase()}`).trim().toUpperCase().replace(/\s+/g, '');
    const tokens = Math.trunc(Number(req.body?.tokens) || 0);
    const itemId = req.body?.itemId ? String(req.body.itemId) : null;
    const tier = ['vip', 'premium'].includes(req.body?.membershipTier) ? req.body.membershipTier : null;
    const days = tier ? Math.trunc(Number(req.body?.membershipDays)) : null;
    const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : new Date(Date.now() + 30 * 86400000);
    if (!/^[A-Z0-9-]{4,32}$/.test(code) || !Number.isFinite(expiresAt.getTime())) return res.status(400).json({ error: 'Проверь код и дату окончания.' });
    if (tokens < 0 || tokens > 1000000 || (itemId && !STORE_CATALOG.some(item => item.id === itemId)) || (tier && ![1, 7, 30, 90].includes(days)) || (!tokens && !itemId && !tier)) return res.status(400).json({ error: 'Укажи хотя бы одну допустимую награду.' });
    const id = crypto.randomUUID();
    try {
      transaction(() => {
        dbRun('INSERT INTO promo_codes (id, code, token_reward, item_id, membership_tier, membership_days, max_uses, starts_at, expires_at, created_by, created_at, target_user_id) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)', [id, code, tokens, itemId, tier, days, nowIso(), expiresAt.toISOString(), req.user.id, nowIso(), target.id]);
        auditAdmin(req.user.id, 'personal_promo_create', target.id, { promoId: id, code, tokens, itemId, tier, days, expiresAt: expiresAt.toISOString() });
      });
    } catch (error) { return res.status(409).json({ error: String(error.message).includes('UNIQUE') ? 'Такой промокод уже существует.' : 'Не удалось создать персональный промокод.' }); }
    res.status(201).json({ ok: true, promo: dbGet('SELECT * FROM promo_codes WHERE id = ?', [id]) });
  });
  app.post('/api/admin/users/:id/logout', authMiddleware, ownerOnly, (req, res) => {
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден.' });
    if (isOwner(target)) return res.status(403).json({ error: 'Нельзя завершить сессии владельца через эту операцию.' });
    const activeMatch = getActiveMatch(target.id);
    if (activeMatch) endMatch(activeMatch.id, 'owner_session_revoke', req.user.id);
    removeFromQueue(target.id);
    const revokedAt = nowIso();
    const result = transaction(() => {
      const changed = dbRun('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [revokedAt, target.id]);
      auditAdmin(req.user.id, 'revoke_user_sessions', target.id, { sessionCount: changed.changes });
      return changed.changes;
    });
    for (const socket of io.sockets.sockets.values()) if (socket.data.userId === target.id) socket.disconnect(true);
    res.json({ ok: true, revokedSessions: result });
  });
  app.post('/api/admin/users/:id/tokens', authMiddleware, ownerOnly, (req, res) => {
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден.' });
    const amount = Math.trunc(Number(req.body?.amount));
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 160) : (typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 160) : '');
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1000000) return res.status(400).json({ error: 'Укажи сумму от 1 до 1 000 000 или от -1 до -1 000 000.' });
    const current = Number(target.tokens || 0);
    if (current + amount < 0) return res.status(400).json({ error: 'Нельзя списать больше текущего баланса.' });
    transaction(() => {
      dbRun('UPDATE users SET tokens = tokens + ? WHERE id = ?', [amount, target.id]);
      dbRun('INSERT INTO token_transactions (id, user_id, kind, amount, description, created_at) VALUES (?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), target.id, 'admin_adjustment', amount, comment || 'Корректировка владельцем', nowIso()]);
      auditAdmin(req.user.id, 'token_adjustment', target.id, { amount, comment });
    });
    res.json({ ok: true, balance: Number(getUserById(target.id).tokens) });
  });
  app.post('/api/admin/users/:id/starter-pack', authMiddleware, ownerOnly, (req, res) => {
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден.' });
    if (isOwner(target)) return res.status(400).json({ error: 'Подарок предназначен участникам, а не владельцу.' });
    const tokens = Math.trunc(Number(req.body?.tokens ?? 100));
    const days = Math.trunc(Number(req.body?.days ?? 7));
    const requestedTier = req.body?.tier === 'premium' ? 'premium' : 'vip';
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 240) : '';
    if (!Number.isInteger(tokens) || tokens < 1 || tokens > 10000 || ![1, 7, 30, 90].includes(days)) return res.status(400).json({ error: 'Проверь сумму токенов и срок награды.' });
    if (dbGet("SELECT id FROM admin_audit_log WHERE action = 'starter_pack' AND target_id = ? LIMIT 1", [target.id])) return res.status(409).json({ error: 'Стартовый подарок этому пользователю уже выдавался.' });
    const currentTier = effectiveSubscription(target);
    const tier = currentTier === 'premium' ? 'premium' : requestedTier;
    const currentExpiry = target.subscription_expires_at && Date.parse(target.subscription_expires_at) > Date.now() ? Date.parse(target.subscription_expires_at) : Date.now();
    const expiresAt = new Date(currentExpiry + days * 86400000).toISOString();
    transaction(() => {
      dbRun('UPDATE users SET tokens = tokens + ?, subscription_tier = ?, subscription_expires_at = ? WHERE id = ?', [tokens, tier, expiresAt, target.id]);
      dbRun('INSERT INTO token_transactions (id, user_id, kind, amount, description, created_at) VALUES (?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), target.id, 'owner_gift', tokens, 'Стартовый подарок от владельца SOLVI' + (comment ? ' · ' + comment : ''), nowIso()]);
      auditAdmin(req.user.id, 'starter_pack', target.id, { tokens, tier, days, expiresAt, comment });
    });
    res.json({ ok: true, balance: Number(getUserById(target.id).tokens || 0), tier, expiresAt });
  });
  app.get('/api/admin/matches', authMiddleware, ownerOnly, (_req, res) => {
    const online = onlineUserIds();
    const rows = dbAll(`SELECT m.id, m.user1_id, m.user2_id, m.created_at, m.active_seconds, m.credited_minutes,
      a.username AS user1, a.public_id AS user1_public_id, b.username AS user2, b.public_id AS user2_public_id,
      (SELECT COUNT(*) FROM messages WHERE match_id = m.id) AS message_count,
      (SELECT MAX(created_at) FROM messages WHERE match_id = m.id) AS last_message_at
      FROM matches m JOIN users a ON a.id = m.user1_id JOIN users b ON b.id = m.user2_id
      WHERE m.status = 'active' ORDER BY m.created_at DESC LIMIT 200`);
    res.json({ matches: rows.map(row => ({ ...row, user1Online: online.has(row.user1_id), user2Online: online.has(row.user2_id), bothOnline: online.has(row.user1_id) && online.has(row.user2_id) })) });
  });
  app.post('/api/admin/matches/:id/inspect', authMiddleware, ownerOnly, (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 240) : '';
    if (reason.length < 6) return res.status(400).json({ error: 'Укажи причину просмотра минимум из 6 символов.' });
    const match = dbGet("SELECT * FROM matches WHERE id = ? AND status = 'active'", [req.params.id]);
    if (!match) return res.status(404).json({ error: 'Диалог уже завершён или не найден.' });
    const messages = dbAll(`SELECT m.id, m.sender_id, m.content, m.created_at, m.message_type, m.sticker_code, m.attachments_json, u.username AS sender
      FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.match_id = ? ORDER BY m.created_at DESC LIMIT 100`, [match.id]).reverse().map(row => ({
        id: row.id, sender: row.sender, content: String(row.content || '').slice(0, 2000), created_at: row.created_at,
        messageType: row.message_type || 'text', stickerCode: row.sticker_code || null,
        hasAttachments: safeJsonArray(row.attachments_json).length > 0
      }));
    auditAdmin(req.user.id, 'inspect_active_match', match.id, { reason, messageCount: messages.length });
    const notice = { message: `Владелец SOLVI открыл активный диалог для проверки. Причина: ${reason}`, sentAt: nowIso() };
    io.to(userRoom(match.user1_id)).emit('moderation:notice', notice);
    io.to(userRoom(match.user2_id)).emit('moderation:notice', notice);
    res.json({ matchId: match.id, messages });
  });
  app.post('/api/admin/matches/:id/notice', authMiddleware, ownerOnly, (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 240) : '';
    if (message.length < 3) return res.status(400).json({ error: 'Уведомление должно содержать минимум 3 символа.' });
    const match = dbGet("SELECT * FROM matches WHERE id = ? AND status = 'active'", [req.params.id]);
    if (!match) return res.status(404).json({ error: 'Активный диалог не найден.' });
    const payload = { message, sentAt: nowIso() };
    io.to(userRoom(match.user1_id)).emit('moderation:notice', payload);
    io.to(userRoom(match.user2_id)).emit('moderation:notice', payload);
    auditAdmin(req.user.id, 'match_notice', match.id, { message });
    res.json({ ok: true });
  });
  app.post('/api/admin/matches/:id/end', authMiddleware, ownerOnly, (req, res) => {
    const match = dbGet("SELECT * FROM matches WHERE id = ? AND status = 'active'", [req.params.id]);
    if (!match) return res.status(404).json({ error: 'Активный диалог не найден.' });
    endMatch(match.id, 'owner_action', req.user.id);
    auditAdmin(req.user.id, 'end_match', match.id, { reason: String(req.body?.reason || 'owner_action').slice(0, 160) });
    res.json({ ok: true });
  });
  app.post('/api/admin/promos', authMiddleware, ownerOnly, (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase().replace(/\s+/g, '') : '';
    const tokens = Math.trunc(Number(req.body?.tokens) || 0);
    const itemId = req.body?.itemId ? String(req.body.itemId) : null;
    const tier = ['vip', 'premium'].includes(req.body?.membershipTier) ? req.body.membershipTier : null;
    const days = tier ? Math.trunc(Number(req.body?.membershipDays)) : null;
    const maxUses = Math.trunc(Number(req.body?.maxUses) || 1);
    const parseOptionalDate = value => {
      if (!value) return null;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
    };
    const startsAt = parseOptionalDate(req.body?.startsAt);
    const expiresAt = parseOptionalDate(req.body?.expiresAt);
    if (startsAt === undefined || expiresAt === undefined || (startsAt && expiresAt && expiresAt <= startsAt)) return res.status(400).json({ error: 'Проверь даты начала и окончания промокода.' });
    if (!/^[A-Z0-9-]{4,32}$/.test(code)) return res.status(400).json({ error: 'Код должен содержать 4–32 символа A-Z, 0-9 или дефис.' });
    if (tokens < 0 || tokens > 1000000 || (itemId && !STORE_CATALOG.some(item => item.id === itemId)) || (tier && ![1,7,30,90].includes(days)) || maxUses < 1 || maxUses > 100000 || (!tokens && !itemId && !tier)) return res.status(400).json({ error: 'Неверная награда или лимит активаций.' });
    try {
      const id = crypto.randomUUID();
      transaction(() => {
        dbRun('INSERT INTO promo_codes (id, code, token_reward, item_id, membership_tier, membership_days, max_uses, starts_at, expires_at, created_by, created_at, target_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)', [id, code, tokens, itemId, tier, days, maxUses, startsAt, expiresAt, req.user.id, nowIso()]);
        auditAdmin(req.user.id, 'promo_create', id, { code, tokens, itemId, tier, days, maxUses });
      });
      res.status(201).json({ ok: true, promo: dbGet('SELECT * FROM promo_codes WHERE id = ?', [id]) });
    } catch (error) { res.status(409).json({ error: String(error.message).includes('UNIQUE') ? 'Такой промокод уже существует.' : 'Не удалось создать промокод.' }); }
  });
  app.get('/api/admin/promos', authMiddleware, ownerOnly, (_req, res) => {
    const promos = dbAll(`SELECT p.id, p.code, p.token_reward, p.item_id, p.membership_tier, p.membership_days,
      p.max_uses, p.uses, p.starts_at, p.expires_at, p.active, p.created_at, p.target_user_id,
      u.username AS target_username,
      (SELECT COUNT(*) FROM promo_redemptions r WHERE r.promo_id = p.id) AS redemption_count
      FROM promo_codes p LEFT JOIN users u ON u.id = p.target_user_id
      ORDER BY p.created_at DESC LIMIT 200`);
    res.json({ promos });
  });
  app.get('/api/admin/promos/:id', authMiddleware, ownerOnly, (req, res) => {
    const promo = dbGet(`SELECT p.*, u.username AS target_username FROM promo_codes p
      LEFT JOIN users u ON u.id = p.target_user_id WHERE p.id = ?`, [req.params.id]);
    if (!promo) return res.status(404).json({ error: 'Промокод не найден.' });
    const redemptions = dbAll(`SELECT r.redeemed_at, u.id AS user_id, u.username, u.public_id
      FROM promo_redemptions r JOIN users u ON u.id = r.user_id
      WHERE r.promo_id = ? ORDER BY r.redeemed_at DESC LIMIT 100`, [promo.id]);
    res.json({ promo, redemptions, stats: { uses: Number(promo.uses || 0), maxUses: Number(promo.max_uses || 0), uniqueUsers: redemptions.length } });
  });
  app.patch('/api/admin/promos/:id', authMiddleware, ownerOnly, (req, res) => {
    const old = dbGet('SELECT * FROM promo_codes WHERE id = ?', [req.params.id]);
    if (!old) return res.status(404).json({ error: 'Промокод не найден.' });
    const code = String(req.body?.code ?? old.code).trim().toUpperCase().replace(/\s+/g, '');
    const maxUses = req.body?.maxUses === undefined ? Number(old.max_uses) : Math.trunc(Number(req.body.maxUses));
    const parseDate = (value, fallback) => {
      if (value === undefined) return fallback;
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    };
    const startsAt = parseDate(req.body?.startsAt, old.starts_at);
    const expiresAt = parseDate(req.body?.expiresAt, old.expires_at);
    const active = req.body?.active === undefined ? Number(old.active) : (req.body.active === false ? 0 : 1);
    if (!/^[A-Z0-9-]{4,32}$/.test(code) || !Number.isInteger(maxUses) || maxUses < Number(old.uses) || maxUses > 100000 || startsAt === undefined || expiresAt === undefined || (startsAt && expiresAt && expiresAt <= startsAt)) {
      return res.status(400).json({ error: 'Проверь код, даты и лимит. Лимит нельзя сделать меньше числа активаций.' });
    }
    try {
      dbRun('UPDATE promo_codes SET code = ?, max_uses = ?, starts_at = ?, expires_at = ?, active = ? WHERE id = ?', [code, maxUses, startsAt, expiresAt, active, old.id]);
    } catch (error) { return res.status(409).json({ error: String(error.message).includes('UNIQUE') ? 'Такой промокод уже существует.' : 'Не удалось изменить промокод.' }); }
    auditAdmin(req.user.id, 'promo_update', old.id, { code, maxUses, startsAt, expiresAt, active: Boolean(active) });
    res.json({ ok: true, active: Boolean(active) });
  });
  app.patch('/api/admin/store/:itemId/price', authMiddleware, ownerOnly, (req, res) => {
    const item = STORE_CATALOG.find(row => row.id === req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Товар не найден.' });
    const price = Math.trunc(Number(req.body?.price));
    if (!Number.isFinite(price) || price < 0 || price > 10000000) return res.status(400).json({ error: 'Цена должна быть от 0 до 10 000 000.' });
    const enabled = req.body?.enabled === false ? 0 : 1;
    transaction(() => {
      dbRun('INSERT INTO store_price_overrides (item_id, price, enabled, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET price=excluded.price, enabled=excluded.enabled, updated_by=excluded.updated_by, updated_at=excluded.updated_at', [item.id, price, enabled, req.user.id, nowIso()]);
      auditAdmin(req.user.id, 'store_price', item.id, { price, enabled: Boolean(enabled) });
    });
    res.json({ ok: true, itemId: item.id, price, enabled: Boolean(enabled) });
  });
  app.get('/api/admin/economy', authMiddleware, ownerOnly, (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const earnedToday = Number(dbGet('SELECT COALESCE(SUM(earned),0) AS n FROM token_earning_daily WHERE day = ?', [today]).n);
    const totalTokens = Number(dbGet('SELECT COALESCE(SUM(tokens),0) AS n FROM users').n);
    const tx = dbAll('SELECT kind, COALESCE(SUM(amount),0) AS amount, COUNT(*) AS count FROM token_transactions WHERE created_at >= ? GROUP BY kind ORDER BY kind', [`${today}T00:00:00.000Z`]);
    res.json({ today, earnedToday, totalTokens, transactions: tx });
  });
  app.get('/api/admin/audit', authMiddleware, ownerOnly, (_req, res) => {
    res.json({ entries: dbAll('SELECT action, target_id, details_json, created_at FROM admin_audit_log ORDER BY created_at DESC LIMIT 200').map(row => ({ ...row, details: JSON.parse(row.details_json || '{}') })) });
  });
  app.get('/api/admin/overview', authMiddleware, ownerOnly, (_req, res) => {
    const users = Number(dbGet('SELECT COUNT(*) AS n FROM users').n);
    const guests = Number(dbGet("SELECT COUNT(*) AS n FROM users WHERE account_type = 'guest'").n);
    const activeMatches = Number(dbGet("SELECT COUNT(*) AS n FROM matches WHERE status = 'active'").n);
    const openReports = Number(dbGet("SELECT COUNT(*) AS n FROM reports r LEFT JOIN reports_status s ON s.report_id = r.id WHERE COALESCE(s.status, 'open') = 'open'").n);
    const tokenTotal = Number(dbGet('SELECT COALESCE(SUM(tokens),0) AS n FROM users').n);
    res.json({ users, guests, activeMatches, openReports, tokenTotal, recentUsers: dbAll("SELECT id, public_id, username, account_type, CASE WHEN public_id = ? THEN 'owner' ELSE role END AS role, subscription_tier, subscription_expires_at, created_at FROM users ORDER BY created_at DESC LIMIT 12", [process.env.OWNER_PUBLIC_ID || '']) });
  });
  app.post('/api/admin/users/:id/paid-membership', authMiddleware, ownerOnly, (req, res) => {
    const target = getUserById(req.params.id);
    if (!target || target.account_type === 'guest' || isOwner(target)) return res.status(404).json({ error: 'Постоянный пользовательский аккаунт не найден.' });
    const tier = ['vip', 'premium'].includes(req.body?.tier) ? req.body.tier : '';
    const days = Number(req.body?.days);
    const amountMinor = Number(req.body?.amountMinor);
    const currency = String(req.body?.currency || 'EUR').trim().toUpperCase().slice(0, 3);
    const paymentReference = String(req.body?.paymentReference || '').trim().slice(0, 120);
    if (!tier || !Number.isInteger(days) || days < 1 || days > 365 || !Number.isInteger(amountMinor) || amountMinor < 1 || paymentReference.length < 4 || !/^[A-Z]{3}$/.test(currency)) return res.status(400).json({ error: 'Укажи тариф, срок, фактически полученную сумму и подтверждённый ID платежа.' });
    const current = target.paid_subscription_expires_at && Date.parse(target.paid_subscription_expires_at) > Date.now() ? Date.parse(target.paid_subscription_expires_at) : Date.now();
    const nextTier = target.paid_subscription_tier === 'premium' && current > Date.now() || tier === 'premium' ? 'premium' : 'vip';
    const expires = new Date(current + days * 86400000).toISOString();
    try {
      transaction(() => {
        dbRun('INSERT INTO payment_records (id,provider,provider_reference,user_id,tier,days,amount_minor,currency,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [crypto.randomUUID(), 'manual', paymentReference, target.id, tier, days, amountMinor, currency, nowIso()]);
        dbRun('UPDATE users SET paid_subscription_tier = ?, paid_subscription_expires_at = ? WHERE id = ?', [nextTier, expires, target.id]);
        auditAdmin(req.user.id, 'paid_membership_verified', target.id, { tier, days, amountMinor, currency, paymentReference, expires });
      });
    } catch (error) { return res.status(409).json({ error: String(error.message).includes('provider_reference') ? 'Этот платёж уже был учтён.' : error.message }); }
    res.json({ ok: true, expiresAt: expires });
  });
  app.get('/api/admin/growth', authMiddleware, ownerOnly, (_req, res) => {
    res.json({
      socialLinks: dbAll('SELECT * FROM site_social_links ORDER BY sort_order, created_at DESC'),
      tasks: dbAll(`SELECT t.*, (SELECT COUNT(*) FROM reward_task_submissions s WHERE s.task_id = t.id) AS submissions,
        (SELECT COUNT(*) FROM reward_task_submissions s WHERE s.task_id = t.id AND s.status = 'approved') AS approved
        FROM reward_tasks t ORDER BY t.created_at DESC`),
      submissions: dbAll(`SELECT s.*, t.title AS task_title, t.reward_tokens, u.username, u.public_id
        FROM reward_task_submissions s JOIN reward_tasks t ON t.id = s.task_id JOIN users u ON u.id = s.user_id
        ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.created_at DESC LIMIT 300`),
      revenue: dbAll('SELECT currency, COALESCE(SUM(amount_minor), 0) AS amount_minor, COUNT(*) AS payments FROM payment_records GROUP BY currency')
    });
  });
  app.post('/api/admin/social-links', authMiddleware, ownerOnly, (req, res) => {
    const platform=String(req.body?.platform||'').trim().slice(0,40),label=String(req.body?.label||'').trim().slice(0,60),url=String(req.body?.url||'').trim().slice(0,500),icon=String(req.body?.icon||'↗').trim().slice(0,8);
    let parsed;try{parsed=new URL(url)}catch{return res.status(400).json({error:'Укажи корректную ссылку.'})}
    if(!platform||!label||parsed.protocol!=='https:')return res.status(400).json({error:'Нужны название сети, подпись и HTTPS-ссылка.'});
    const id=crypto.randomUUID(),at=nowIso();dbRun('INSERT INTO site_social_links (id,platform,label,url,icon,enabled,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?,?)',[id,platform,label,url,icon,Number(req.body?.sortOrder)||0,at,at]);auditAdmin(req.user.id,'social_link_create',id,{platform,label,url});res.status(201).json({ok:true,id});
  });
  app.patch('/api/admin/social-links/:id', authMiddleware, ownerOnly, (req,res)=>{
    const old=dbGet('SELECT * FROM site_social_links WHERE id=?',[req.params.id]);if(!old)return res.status(404).json({error:'Ссылка не найдена.'});
    const enabled=req.body?.enabled===undefined?old.enabled:(req.body.enabled?1:0);
    const platform=typeof req.body?.platform==='string'?req.body.platform.trim().slice(0,40):old.platform;
    const label=typeof req.body?.label==='string'?req.body.label.trim().slice(0,60):old.label;
    const url=typeof req.body?.url==='string'?req.body.url.trim().slice(0,500):old.url;
    const icon=typeof req.body?.icon==='string'?req.body.icon.trim().slice(0,8):old.icon;
    const sortOrder=req.body?.sortOrder===undefined?Number(old.sort_order):Math.max(0,Math.min(10000,Math.trunc(Number(req.body.sortOrder)||0)));
    let parsed;try{parsed=new URL(url)}catch{return res.status(400).json({error:'Некорректная ссылка.'})}
    if(parsed.protocol!=='https:'||!platform||!label||!icon)return res.status(400).json({error:'Нужны платформа, подпись, иконка и HTTPS-ссылка.'});
    dbRun('UPDATE site_social_links SET platform=?,label=?,url=?,icon=?,sort_order=?,enabled=?,updated_at=? WHERE id=?',[platform,label,url,icon,sortOrder,enabled,nowIso(),old.id]);
    auditAdmin(req.user.id,'social_link_update',old.id,{platform,label,url,icon,sortOrder,enabled});
    res.json({ok:true});
  });
  app.delete('/api/admin/social-links/:id', authMiddleware, ownerOnly, (req,res)=>{
    const old=dbGet('SELECT id FROM site_social_links WHERE id=?',[req.params.id]);if(!old)return res.status(404).json({error:'Ссылка не найдена.'});
    dbRun('DELETE FROM site_social_links WHERE id=?',[old.id]);auditAdmin(req.user.id,'social_link_delete',old.id,{});res.json({ok:true});
  });
  app.post('/api/admin/tasks', authMiddleware, ownerOnly, (req,res)=>{
    const title=String(req.body?.title||'').trim().slice(0,100),description=String(req.body?.description||'').trim().slice(0,500),platform=String(req.body?.platform||'').trim().slice(0,40),url=String(req.body?.url||'').trim().slice(0,500),sponsor=String(req.body?.sponsorName||'').trim().slice(0,80),reward=Number(req.body?.rewardTokens),maxClaims=Math.max(0,Math.min(100000,Number(req.body?.maxClaims)||0));
    let parsed;try{parsed=new URL(url)}catch{return res.status(400).json({error:'Укажи ссылку на канал или рекламную страницу.'})}
    if(title.length<4||description.length<10||!platform||parsed.protocol!=='https:'||!Number.isInteger(reward)||reward<1||reward>5000)return res.status(400).json({error:'Проверь заголовок, описание, HTTPS-ссылку и награду от 1 до 5000 токенов.'});
    const id=crypto.randomUUID(),at=nowIso();dbRun('INSERT INTO reward_tasks (id,title,description,platform,url,reward_tokens,sponsor_name,active,max_claims,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?,?)',[id,title,description,platform,url,reward,sponsor,maxClaims,at,at]);auditAdmin(req.user.id,'reward_task_create',id,{title,reward,sponsor});res.status(201).json({ok:true,id});
  });
  app.patch('/api/admin/tasks/:id', authMiddleware, ownerOnly, (req,res)=>{
    const task=dbGet('SELECT * FROM reward_tasks WHERE id=?',[req.params.id]);if(!task)return res.status(404).json({error:'Задание не найдено.'});
    const title=typeof req.body?.title==='string'?req.body.title.trim().slice(0,100):task.title;
    const description=typeof req.body?.description==='string'?req.body.description.trim().slice(0,500):task.description;
    const platform=typeof req.body?.platform==='string'?req.body.platform.trim().slice(0,40):task.platform;
    const url=typeof req.body?.url==='string'?req.body.url.trim().slice(0,500):task.url;
    const reward=req.body?.rewardTokens===undefined?Number(task.reward_tokens):Math.trunc(Number(req.body.rewardTokens));
    const sponsor=typeof req.body?.sponsorName==='string'?req.body.sponsorName.trim().slice(0,80):task.sponsor_name;
    const maxClaims=req.body?.maxClaims===undefined?Number(task.max_claims):Math.max(0,Math.min(100000,Math.trunc(Number(req.body.maxClaims)||0)));
    const active=req.body?.active===undefined?Number(task.active):(req.body.active?1:0);
    let parsed;try{parsed=new URL(url)}catch{return res.status(400).json({error:'Укажи корректную HTTPS-ссылку.'})}
    if(title.length<4||description.length<10||!platform||parsed.protocol!=='https:'||!Number.isInteger(reward)||reward<1||reward>5000||!Number.isInteger(maxClaims))return res.status(400).json({error:'Проверь название, описание, платформу, ссылку, награду и лимит.'});
    dbRun('UPDATE reward_tasks SET title=?,description=?,platform=?,url=?,reward_tokens=?,sponsor_name=?,max_claims=?,active=?,updated_at=? WHERE id=?',[title,description,platform,url,reward,sponsor,maxClaims,active,nowIso(),task.id]);
    auditAdmin(req.user.id,'reward_task_update',task.id,{title,description,platform,url,reward,sponsor,maxClaims,active});
    res.json({ok:true});
  });
  app.delete('/api/admin/tasks/:id', authMiddleware, ownerOnly, (req,res)=>{
    const task=dbGet('SELECT id,title FROM reward_tasks WHERE id=?',[req.params.id]);if(!task)return res.status(404).json({error:'Задание не найдено.'});
    const submissionCount=Number(dbGet('SELECT COUNT(*) AS n FROM reward_task_submissions WHERE task_id=?',[task.id]).n||0);
    if(submissionCount){
      dbRun('UPDATE reward_tasks SET active=0,updated_at=? WHERE id=?',[nowIso(),task.id]);
      auditAdmin(req.user.id,'reward_task_archive',task.id,{submissionCount});
      return res.json({ok:true,archived:true,submissionCount});
    }
    dbRun('DELETE FROM reward_tasks WHERE id=?',[task.id]);
    auditAdmin(req.user.id,'reward_task_delete',task.id,{});
    res.json({ok:true,archived:false,submissionCount:0});
  });
  app.post('/api/admin/task-submissions/:id/review', authMiddleware, ownerOnly, (req,res)=>{
    const submission=dbGet(`SELECT s.*,t.title,t.reward_tokens FROM reward_task_submissions s JOIN reward_tasks t ON t.id=s.task_id WHERE s.id=?`,[req.params.id]);
    if(!submission)return res.status(404).json({error:'Заявка не найдена.'});if(submission.status!=='pending')return res.status(409).json({error:'Заявка уже проверена.'});
    const decision=req.body?.decision==='approve'?'approved':req.body?.decision==='reject'?'rejected':'';if(!decision)return res.status(400).json({error:'Выбери решение.'});
    const note=String(req.body?.note||'').trim().slice(0,300),at=nowIso();
    transaction(()=>{dbRun("UPDATE reward_task_submissions SET status=?,review_note=?,reviewed_at=?,reviewed_by=? WHERE id=? AND status='pending'",[decision,note,at,req.user.id,submission.id]);if(decision==='approved'){dbRun('UPDATE users SET tokens=tokens+? WHERE id=?',[submission.reward_tokens,submission.user_id]);dbRun('INSERT INTO token_transactions (id,user_id,kind,amount,description,created_at) VALUES (?,?,?,?,?,?)',[crypto.randomUUID(),submission.user_id,'task_reward',submission.reward_tokens,`Награда за задание: ${submission.title}`,at]);}auditAdmin(req.user.id,'task_submission_'+decision,submission.id,{taskId:submission.task_id,userId:submission.user_id,reward:decision==='approved'?submission.reward_tokens:0,note});});
    res.json({ok:true,status:decision});
  });
  app.get('/api/admin/tickets', authMiddleware, ownerOnly, (_req, res) => {
    const tickets = dbAll(`SELECT t.id, t.category, t.title, t.status, t.created_at, t.updated_at, u.username, u.public_id,
      (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS message_count,
      (SELECT body FROM support_ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
      FROM support_tickets t JOIN users u ON u.id = t.user_id ORDER BY t.updated_at DESC LIMIT 200`);
    res.json({ tickets });
  });
  app.get('/api/admin/tickets/:id', authMiddleware, ownerOnly, (req, res) => {
    const ticket = dbGet('SELECT t.*, u.username, u.public_id FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?', [req.params.id]);
    if (!ticket) return res.status(404).json({ error: 'Обращение не найдено.' });
    const messages = dbAll('SELECT m.id, m.sender_id, u.username AS sender_name, m.body, m.created_at FROM support_ticket_messages m JOIN users u ON u.id = m.sender_id WHERE m.ticket_id = ? ORDER BY m.created_at ASC', [ticket.id]);
    res.json({ ticket, messages });
  });
  app.post('/api/admin/tickets/:id/reply', authMiddleware, ownerOnly, (req, res) => {
    const ticket = dbGet('SELECT id FROM support_tickets WHERE id = ?', [req.params.id]);
    if (!ticket) return res.status(404).json({ error: 'Обращение не найдено.' });
    const body = typeof req.body?.body === 'string' ? req.body.body.trim().slice(0, 1500) : '';
    const status = ['open','in_progress','closed'].includes(req.body?.status) ? req.body.status : 'in_progress';
    if (body.length < 3) return res.status(400).json({ error: 'Ответ должен содержать хотя бы 3 символа.' });
    const createdAt = nowIso();
    transaction(() => {
      dbRun('INSERT INTO support_ticket_messages (id, ticket_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)', [crypto.randomUUID(), ticket.id, req.user.id, body, createdAt]);
      dbRun('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?', [status, createdAt, ticket.id]);
      auditAdmin(req.user.id, 'support_ticket_reply', ticket.id, { status });
    });
    const ticketOwner=dbGet('SELECT user_id FROM support_tickets WHERE id=?',[ticket.id]);
    if(ticketOwner)io.to(userRoom(ticketOwner.user_id)).emit('ticket:updated',{ticketId:ticket.id});
    res.json({ ok: true });
  });

  app.get('/api/admin/reports', authMiddleware, ownerOnly, (_req, res) => {
    const reports = dbAll(`SELECT r.id, r.category, r.details, r.context_json, r.created_at, r.reporter_id, r.reported_id,
      reporter.username AS reporter_name, reporter.public_id AS reporter_public_id,
      reported.username AS reported_name, reported.public_id AS reported_public_id,
      COALESCE(rs.status, 'open') AS status, rs.resolution, rs.reviewed_at
      FROM reports r JOIN users reporter ON reporter.id = r.reporter_id JOIN users reported ON reported.id = r.reported_id
      LEFT JOIN reports_status rs ON rs.report_id = r.id ORDER BY r.created_at DESC LIMIT 100`);
    res.json({ reports: reports.map(row => ({ id: row.id, category: row.category, details: row.details, context: safeJsonArray(row.context_json), createdAt: row.created_at, reporter: row.reporter_name, reporterId: row.reporter_id, reporterPublicId: row.reporter_public_id, reported: row.reported_name, reportedId: row.reported_id, reportedPublicId: row.reported_public_id, status: row.status, resolution: row.resolution || '', reviewedAt: row.reviewed_at || null })) });
  });
  app.post('/api/admin/reports/:id/resolve', authMiddleware, ownerOnly, (req, res) => {
    const report = dbGet('SELECT id FROM reports WHERE id = ?', [req.params.id]);
    if (!report) return res.status(404).json({ error: 'Жалоба не найдена.' });
    const resolution = typeof req.body?.resolution === 'string' ? req.body.resolution.trim().slice(0, 300) : '';
    transaction(() => { dbRun(`INSERT INTO reports_status (report_id, status, reviewed_by, reviewed_at, resolution) VALUES (?, 'resolved', ?, ?, ?) ON CONFLICT(report_id) DO UPDATE SET status='resolved', reviewed_by=excluded.reviewed_by, reviewed_at=excluded.reviewed_at, resolution=excluded.resolution`, [report.id, req.user.id, nowIso(), resolution]); auditAdmin(req.user.id, 'report_resolve', report.id, { resolution }); });
    res.json({ ok: true });
  });
  app.post('/api/admin/users/:id/suspend', authMiddleware, ownerOnly, (req, res) => {
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден.' });
    if (isOwner(target)) return res.status(403).json({ error: 'Нельзя ограничить владельца через эту панель.' });
    const minutes = Number(req.body?.minutes);
    if (![10, 60, 1440, 10080].includes(minutes)) return res.status(400).json({ error: 'Выбери допустимый срок ограничения.' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 240) : '';
    const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
    transaction(() => {
      dbRun('UPDATE users SET suspended_until = ?, suspension_reason = ? WHERE id = ?', [expiresAt, reason || 'нарушение правил сообщества', target.id]);
      dbRun('INSERT INTO moderation_actions (id, actor_id, target_id, action, reason, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), req.user.id, target.id, 'suspend', reason, expiresAt, nowIso()]);
    });
    for (const socket of io.sockets.sockets.values()) if (socket.data.userId === target.id) socket.disconnect(true);
    const match = getActiveMatch(target.id); if (match) endMatch(match.id, 'moderation', req.user.id);
    removeFromQueue(target.id);
    auditAdmin(req.user.id, 'suspend_user', target.id, { minutes, reason });
    res.json({ ok: true, expiresAt });
  });
  app.delete('/api/admin/users/:id/suspend', authMiddleware, ownerOnly, (req, res) => {
    const target = getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден.' });
    if (isOwner(target)) return res.status(403).json({ error: 'Нельзя снять ограничение с владельца этой операцией.' });
    dbRun('UPDATE users SET suspended_until = NULL, suspension_reason = NULL WHERE id = ?', [target.id]);
    auditAdmin(req.user.id, 'unsuspend_user', target.id, {});
    res.json({ ok: true });
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint не найден.' }));
  app.get('/owner', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'owner.html')));
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
  app.get('/*path', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
  app.use((error, _req, res, _next) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Файл слишком большой.' });
    if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Некорректный JSON.' });
    console.error('[SOLVI] HTTP error:', error?.stack || error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера.' });
  });

  console.log('[4/5] Поднимаем WebSocket…');
  const server = http.createServer(app);
  io = new Server(server, {
    serveClient: true,
    maxHttpBufferSize: 64 * 1024,
    cors: { origin: false }
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Требуется авторизация.'));
      const payload = jwt.verify(token, JWT_SECRET, { issuer: 'orbit-chat', ignoreExpiration: true });
      const user = getUserById(payload.sub);
      const session = dbGet('SELECT id, revoked_at, expires_at FROM sessions WHERE id = ? AND user_id = ?', [payload.jti, payload.sub]);
      if (!user || !session || session.revoked_at || session.expires_at <= nowIso()) return next(new Error('Сессия недействительна. Войдите снова.'));
      if (Number(payload.exp || 0) * 1000 <= Date.now() && user.account_type !== 'guest') return next(new Error('Сессия истекла. Войдите снова.'));
      if (user.suspended_until && user.suspended_until > nowIso()) return next(new Error(`Доступ ограничен: ${user.suspension_reason || 'нарушение правил'}.`));
      if (user.account_type === 'guest' && user.guest_expires_at && user.guest_expires_at <= nowIso()) return next(new Error('Срок гостевого доступа истёк.'));
      socket.data.userId = user.id;
      socket.data.jti = payload.jti;
      socket.data.guestExpiresAt = user.account_type === 'guest' ? user.guest_expires_at : null;
      next();
    } catch { next(new Error('Сессия истекла. Войдите снова.')); }
  });

  io.on('connection', socket => {
    const userId = socket.data.userId;
    socket.join(userRoom(userId));
    if (socket.data.guestExpiresAt) {
      const expiryDelay = Math.max(0, Date.parse(socket.data.guestExpiresAt) - Date.now());
      const expiryTimer = setTimeout(() => {
        guestExpiryTimers.delete(socket.id);
        const currentUser = getUserById(userId);
        if (currentUser?.account_type !== 'guest' || !currentUser.guest_expires_at || currentUser.guest_expires_at > nowIso()) return;
        removeFromQueue(userId);
        const match = getActiveMatch(userId);
        if (match) endMatch(match.id, 'guest_expired', userId);
        socket.emit('auth:expired', { reason: 'guest_expired' });
        socket.disconnect(true);
      }, expiryDelay);
      guestExpiryTimers.set(socket.id, expiryTimer);
    }
    const pendingTimer = disconnectTimers.get(userId);
    if (pendingTimer) { clearTimeout(pendingTimer); disconnectTimers.delete(userId); }
    emitOnlineCount();

    const aiSession = aiSessions.get(userId);
    const requestedMatchId = socket.handshake.auth?.lastMatchId;
    if (aiSession && (!requestedMatchId || requestedMatchId === aiSession.id)) {
      socket.data.activeMatchId = aiSession.id;
      socket.emit('chat:restored', {
        matchId: aiSession.id, isAi: true, mode: 'chat', startedAt: new Date(aiSession.createdAt).toISOString(),
        partner: aiSession.partner, commonInterests: aiSession.interests.slice(0, 3), messages: aiSession.messages || []
      });
    }
    const activeMatch = getActiveMatch(userId);
    if (!aiSession && activeMatch) {
      socket.data.activeMatchId = activeMatch.id;
      const partnerId = otherUserId(activeMatch, userId);
      const messages = dbAll('SELECT * FROM messages WHERE match_id = ? ORDER BY created_at ASC LIMIT 200', [activeMatch.id]).map(row => serializeMessage(row, userId));
      socket.emit('chat:restored', { ...matchPayload(activeMatch, userId), messages, partnerOnline: onlineUserIds().has(partnerId) });
    } else if (typeof socket.handshake.auth?.lastMatchId === 'string' && socket.handshake.auth.lastMatchId) {
      socket.emit('chat:ended', { matchId: socket.handshake.auth.lastMatchId, reason: 'server_restart', actorId: null });
    }

    socket.on('queue:join', (preferences, ack = () => {}) => {
      const result = addToQueue(socket, preferences || {});
      ack(result);
      if (result.ok && queue.has(userId)) socket.emit('queue:waiting', { joinedAt: queue.get(userId).joinedAt });
    });
    socket.on('queue:cancel', (ack = () => {}) => {
      removeFromQueue(userId);
      socket.emit('queue:cancelled');
      ack({ ok: true });
    });

    socket.on('chat:next', (payload, ack = () => {}) => {
      const aiSession = aiSessions.get(userId);
      if (aiSession && aiSession.id === payload?.matchId) {
        aiSessions.delete(userId);
        const result = addToQueue(socket, payload?.preferences || {});
        ack(result);
        if (result.ok && queue.has(userId)) socket.emit('queue:waiting', { joinedAt: queue.get(userId).joinedAt });
        return;
      }
      const match = getActiveMatch(userId);
      if (!match || match.id !== payload?.matchId) return ack({ ok: false, error: 'Диалог уже завершён.' });
      endMatch(match.id, 'user_next', userId);
      const result = addToQueue(socket, payload?.preferences || {});
      ack(result);
      if (result.ok && queue.has(userId)) socket.emit('queue:waiting', { joinedAt: queue.get(userId).joinedAt });
    });

    socket.on('chat:send', (payload, ack = () => {}) => {
      const match = getActiveMatch(userId);
      if (!match || match.id !== payload?.matchId) return ack({ ok: false, error: 'Диалог уже завершён.' });
      if (isBlocked(userId, otherUserId(match, userId))) return ack({ ok: false, error: 'Сообщение не отправлено.' });
      const now = Date.now();
      const window = messageWindows.get(userId) || { startedAt: now, count: 0 };
      if (now - window.startedAt > 10_000) { window.startedAt = now; window.count = 0; }
      if (window.count >= 12) return ack({ ok: false, error: 'Слишком быстро. Сделай небольшую паузу перед следующим сообщением.' });
      window.count += 1;
      messageWindows.set(userId, window);
      const membership = membershipLimits(getUserById(userId));
      const messageLimit = membership.messageLength;
      const content = typeof payload?.content === 'string' ? payload.content.trim() : '';
      const clientId = typeof payload?.clientId === 'string' && payload.clientId.length <= 80 ? payload.clientId : '';
      const requestedSticker = payload?.sticker;
      const equippedStickerPack = getEquippedItems(userId).stickers;
      const allowedStickers = new Set([...BASE_STICKERS, ...(STICKER_PACKS[equippedStickerPack] || [])]);
      const sticker = allowedStickers.has(requestedSticker) ? requestedSticker : null;
      const requestedAttachmentIds = Array.isArray(payload?.attachments) ? [...new Set(payload.attachments.filter(id => typeof id === 'string' && id.length <= 64))] : [];
      if (requestedAttachmentIds.length > membership.attachmentLimit) return ack({ ok: false, error: `Для твоего статуса можно отправить до ${membership.attachmentLimit} фото за раз.` });
      const attachmentIds = requestedAttachmentIds;
      if (!clientId || content.length > messageLimit || (!content && !sticker && !attachmentIds.length)) {
        return ack({ ok: false, error: `Добавь текст, стикер или вложение. Твой лимит — до ${messageLimit.toLocaleString('ru-RU')} символов.` });
      }
      const existing = dbGet('SELECT * FROM messages WHERE sender_id = ? AND client_id = ?', [userId, clientId]);
      if (existing) return ack({ ok: true, message: serializeMessage(existing, userId), duplicate: true });
      const mediaRows = attachmentIds.length
        ? dbAll(`SELECT * FROM media_files WHERE match_id = ? AND owner_id = ? AND id IN (${attachmentIds.map(() => '?').join(',')})`, [match.id, userId, ...attachmentIds])
        : [];
      if (mediaRows.length !== attachmentIds.length) return ack({ ok: false, error: 'Одно из вложений не принадлежит этому диалогу. Загрузи его ещё раз.' });
      const attachments = mediaRows.map(mediaPublic);
      const replyToId = typeof payload?.replyToId === 'string' ? payload.replyToId : null;
      if (replyToId) {
        const parent = dbGet('SELECT id, sender_id FROM messages WHERE id = ? AND match_id = ?', [replyToId, match.id]);
        if (!parent) return ack({ ok: false, error: 'Сообщение для ответа не найдено.' });
        if (parent.sender_id === userId) return ack({ ok: false, error: 'Нельзя отвечать на собственное сообщение.' });
      }
      const messageType = sticker ? 'sticker' : (attachments.some(file => file.kind === 'audio') ? 'voice' : (attachments.length ? 'media' : 'text'));
      const message = {
        id: crypto.randomUUID(), match_id: match.id, sender_id: userId, client_id: clientId,
        content, created_at: nowIso(), delivered_at: null, read_at: null,
        message_type: messageType, sticker_code: sticker, attachments_json: JSON.stringify(attachments), reply_to_id: replyToId,
        type: messageType, sticker, attachments, reactions: [], replyTo: replyToId ? (() => { const r = dbGet('SELECT id, sender_id, content, message_type FROM messages WHERE id = ?', [replyToId]); return r ? { id: r.id, senderId: r.sender_id, content: r.content, type: r.message_type } : null; })() : null
      };
      const recipientId = otherUserId(match, userId);
      const recipientOnline = onlineUserIds().has(recipientId);
      if (recipientOnline) message.delivered_at = nowIso();
      transaction(() => dbRun('INSERT INTO messages (id, match_id, sender_id, client_id, content, created_at, delivered_at, message_type, sticker_code, attachments_json, reply_to_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [message.id, message.match_id, message.sender_id, message.client_id, message.content, message.created_at, message.delivered_at, message.message_type, message.sticker_code, message.attachments_json, message.reply_to_id]));
      io.to(userRoom(userId)).emit('chat:message', message);
      io.to(userRoom(recipientId)).emit('chat:message', message);
      ack({ ok: true, message });
      if (recipientOnline) io.to(userRoom(userId)).emit('chat:status', { messageId: message.id, status: 'delivered', at: message.delivered_at });
    });

    socket.on('ai:send', (payload, ack = () => {}) => {
      const session = aiSessions.get(userId);
      if (!session || session.id !== payload?.sessionId) return ack({ ok: false, error: 'ИИ-диалог завершился или сервер перезапустился. Начни новый поиск собеседника.' });
      const content = typeof payload?.content === 'string' ? payload.content.trim().slice(0, 1200) : '';
      const sticker = typeof payload?.sticker === 'string' ? payload.sticker.slice(0, 16) : '';
      if (Array.isArray(payload?.attachments) && payload.attachments.length) return ack({ ok: false, error: 'ИИ-собеседник пока поддерживает текст и стикеры, но не фото и голосовые.' });
      if (!content && !sticker) return ack({ ok: false, error: 'Напиши сообщение или отправь стикер.' });
      const now = Date.now();
      const window = messageWindows.get(userId) || { startedAt: now, count: 0 };
      if (now - window.startedAt > 10_000) { window.startedAt = now; window.count = 0; }
      if (window.count >= 12) return ack({ ok: false, error: 'Слишком быстро. Сделай небольшую паузу.' });
      window.count += 1;
      messageWindows.set(userId, window);
      const text = content || `Пользователь отправил стикер ${sticker}`;
      const userMessage = { id: crypto.randomUUID(), match_id: session.id, sender_id: userId, client_id: `user:${payload?.clientId || crypto.randomUUID()}`, content: text, created_at: nowIso(), message_type: sticker ? 'sticker' : 'text', type: sticker ? 'sticker' : 'text', sticker: sticker || null, attachments: [], reactions: [], replyTo: null };
      session.messages.push(userMessage);
      ack({ ok: true });
      queueAiTurn(userId, session, text);
    });

    socket.on('chat:react', ({ matchId, messageId, emoji } = {}, ack = () => {}) => {
      const match = getActiveMatch(userId);
      if (!match || match.id !== matchId || !['❤️', '😂', '🔥', '👏'].includes(emoji)) return ack({ ok: false, error: 'Реакция недоступна.' });
      const message = dbGet('SELECT id FROM messages WHERE id = ? AND match_id = ?', [messageId, matchId]);
      if (!message) return ack({ ok: false, error: 'Сообщение не найдено.' });
      const original = dbGet('SELECT sender_id FROM messages WHERE id = ?', [messageId]);
      if (!original || original.sender_id === userId) return ack({ ok: false, error: 'Реакции можно ставить только на сообщения собеседника.' });
      const previous = dbGet('SELECT id, emoji FROM message_reactions WHERE message_id = ? AND user_id = ?', [messageId, userId]);
      transaction(() => {
        if (previous?.emoji === emoji) dbRun('DELETE FROM message_reactions WHERE id = ?', [previous.id]);
        else if (previous) dbRun('UPDATE message_reactions SET emoji = ?, created_at = ? WHERE id = ?', [emoji, nowIso(), previous.id]);
        else dbRun('INSERT INTO message_reactions (id, message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)', [crypto.randomUUID(), messageId, userId, emoji, nowIso()]);
      });
      const reactionsForUser1 = getMessageReactions(messageId, match.user1_id);
      const reactionsForUser2 = getMessageReactions(messageId, match.user2_id);
      io.to(userRoom(match.user1_id)).emit('chat:reactions', { messageId, reactions: reactionsForUser1 });
      io.to(userRoom(match.user2_id)).emit('chat:reactions', { messageId, reactions: reactionsForUser2 });
      ack({ ok: true, reactions: userId === match.user1_id ? reactionsForUser1 : reactionsForUser2 });
    });

    socket.on('chat:read', ({ matchId } = {}, ack = () => {}) => {
      const match = getActiveMatch(userId);
      if (!match || match.id !== matchId) return ack({ ok: false });
      const readAt = nowIso();
      const unread = dbAll('SELECT id FROM messages WHERE match_id = ? AND sender_id != ? AND read_at IS NULL', [matchId, userId]);
      if (unread.length) {
        transaction(() => dbRun('UPDATE messages SET delivered_at = COALESCE(delivered_at, ?), read_at = ? WHERE match_id = ? AND sender_id != ? AND read_at IS NULL', [readAt, readAt, matchId, userId]));
        const senderIds = [...new Set(dbAll('SELECT sender_id FROM messages WHERE match_id = ? AND sender_id != ?', [matchId, userId]).map(row => row.sender_id))];
        for (const senderId of senderIds) io.to(userRoom(senderId)).emit('chat:read-receipt', { messageIds: unread.map(row => row.id), readAt });
      }
      ack({ ok: true });
    });

    socket.on('chat:typing', ({ matchId, typing } = {}) => {
      const match = getActiveMatch(userId);
      if (!match || match.id !== matchId) return;
      io.to(userRoom(otherUserId(match, userId))).emit('chat:typing', { typing: Boolean(typing), userId });
    });

    socket.on('chat:recording', ({ matchId, recording } = {}) => {
      const match = getActiveMatch(userId);
      if (!match || match.id !== matchId) return;
      io.to(userRoom(otherUserId(match, userId))).emit('chat:recording', { recording: Boolean(recording), userId });
    });

    socket.on('chat:end', ({ matchId } = {}, ack = () => {}) => {
      const aiSession = aiSessions.get(userId);
      if (aiSession && aiSession.id === matchId) {
        aiSessions.delete(userId);
        socket.emit('chat:ended', { matchId, reason: 'user_ended', actorId: userId });
        ack({ ok: true });
        return;
      }
      const match = getActiveMatch(userId);
      if (!match || match.id !== matchId) return ack({ ok: false, error: 'Диалог уже завершён.' });
      endMatch(matchId, 'user_ended', userId);
      ack({ ok: true });
    });

    socket.on('disconnect', () => {
      const guestExpiryTimer = guestExpiryTimers.get(socket.id);
      if (guestExpiryTimer) { clearTimeout(guestExpiryTimer); guestExpiryTimers.delete(socket.id); }
      if (!io.sockets.adapter.rooms.get(userRoom(userId))?.size) {
        removeFromQueue(userId);
        messageWindows.delete(userId);
        const timer = setTimeout(() => {
          disconnectTimers.delete(userId);
          if (io.sockets.adapter.rooms.get(userRoom(userId))?.size) return;
          aiSessions.delete(userId);
          const match = getActiveMatch(userId);
          if (match) endMatch(match.id, 'connection_lost', userId);
          emitOnlineCount();
        }, RECONNECT_GRACE_MS);
        disconnectTimers.set(userId, timer);
      }
      emitOnlineCount();
    });
  });

  server.on('error', error => {
    if (error.code === 'EADDRINUSE') console.error(`[SOLVI] Порт ${PORT} уже занят. Закрой другое окно SOLVI или измени PORT в start.bat.`);
    else console.error('[SOLVI] Ошибка HTTP-сервера:', error);
    process.exitCode = 1;
  });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 120_000;
  server.listen(PORT, HOST, () => {
    console.log('[5/5] Сервер успешно слушает порт.');
    console.log(`\n  SOLVI v${APP_VERSION} — сервер запущен`);
    console.log(`  Локально: http://localhost:${PORT}`);
    console.log(`  В сети:   http://<IP-ЭТОГО-КОМПЬЮТЕРА>:${PORT}`);
    console.log(`  Режим: ${PUBLIC_MODE ? 'закрытый публичный тест' : 'локальный / LAN'}; поиск ${(!PUBLIC_MODE || PUBLIC_MATCHING) ? 'включён' : 'отключён'}`);
    console.log('  Для доступа друзьям запустите start-public.bat и передайте им URL + код приглашения.');
    console.log('  Остановка: Ctrl + C\n');
    console.log(`  Готово за ${Date.now() - BOOT_STARTED_AT} мс.\n`);
    if (process.env.SOVLI_AUTO_START_TUNNEL === '1') {
      if (!PUBLIC_TEST_CODE) PUBLIC_TEST_CODE = crypto.randomBytes(6).toString('hex').toUpperCase();
      PUBLIC_MODE = true; PUBLIC_MATCHING = true;
      console.log('[TUNNEL] Автоматически запускаем Quick Tunnel…');
      try { startCloudflareQuickTunnel(process.env.SOVLI_TUNNEL_PROTOCOL || 'auto'); }
      catch (error) { console.error(`[TUNNEL] Не удалось запустить туннель: ${error.message}`); }
      console.log(`[TUNNEL] Код приглашения: ${PUBLIC_TEST_CODE}`);
    }
  });

  const economyTicker = setInterval(tickActiveMatches, 5000);
  economyTicker.unref();
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(economyTicker);
    stopCloudflareQuickTunnel();
    tickActiveMatches();
    for (const timer of disconnectTimers.values()) clearTimeout(timer);
    for (const timer of guestExpiryTimers.values()) clearTimeout(timer);
    const hardStop = setTimeout(() => {
      console.error('[SOLVI] Принудительное завершение после тайм-аута остановки.');
      process.exit(1);
    }, 12000);
    (async () => {
      try { await flushPersistentSnapshot(true); }
      catch (error) { console.error('[SOLVI] Последнее сохранение Neon не удалось:', error.message); }
      io.close(async () => {
        try { db.close(); } catch (error) { console.warn('[SOLVI] Ошибка закрытия SQLite:', error.message); }
        try { await persistentStore?.close(); } catch (error) { console.warn('[SOLVI] Ошибка закрытия Neon:', error.message); }
        clearTimeout(hardStop);
        process.exit(0);
      });
    })().catch(error => {
      console.error('[SOLVI] Ошибка остановки сервера:', error.message);
      clearTimeout(hardStop);
      process.exit(1);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const BOOT_STARTED_AT = Date.now();
process.on('unhandledRejection', error => { console.error('[SOLVI] Необработанная ошибка Promise:', error); });
process.on('uncaughtException', error => { console.error('[SOLVI] Критическая ошибка Node.js:', error); process.exit(1); });
main().catch(error => {
  console.error('[SOLVI] Не удалось запустить сервер:', error?.stack || error);
  process.exit(1);
});
