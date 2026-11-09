@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title SOVLI v1.2.0 - Local Quick Tunnel fallback

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Установи Node.js 22.16 или новее: https://nodejs.org/
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=16)?0:1)" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Нужен Node.js 22.16 или новее. Текущая версия:
  node -v
  pause
  exit /b 1
)

if not defined PORT set "PORT=3000"
if exist ".env" for /f "usebackq tokens=1,* delims==" %%A in (".env") do if /i "%%A"=="PORT" if not "%%B"=="" set "PORT=%%B"
set "CLOUDFLARED_PATH=%~dp0cloudflared.exe"

node -e "for (const m of ['express','socket.io','bcryptjs','jsonwebtoken','express-rate-limit','helmet','dotenv']) require.resolve(m)" >nul 2>nul
if errorlevel 1 (
  echo [SOVLI] Устанавливаем npm-зависимости...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] npm install не удался. Проверь интернет и повтори запуск.
    pause
    exit /b 1
  )
)

if not exist "%CLOUDFLARED_PATH%" (
  echo [SOVLI] Загружаем Cloudflare Tunnel...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%CLOUDFLARED_PATH%' -UseBasicParsing } catch { Write-Error $_; exit 1 }"
  if errorlevel 1 (
    echo [ERROR] Не удалось скачать cloudflared.exe. Можно скачать вручную из https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    pause
    exit /b 1
  )
)

rem If SOVLI already runs in local mode, do not start a second Node process.
rem Open the owner page; the owner can start the public tunnel from a phone or this PC.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-RestMethod -Uri 'http://127.0.0.1:%PORT%/api/health' -TimeoutSec 2; if($r.ok){ exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo.
  echo ================================================================
  echo  SOVLI SERVER ALREADY RUNNING
  echo  Второй сервер запускать не нужно.
  echo  Открой панель владельца и нажми 'Запустить туннель'.
  echo ================================================================
  echo  На этом ПК: http://127.0.0.1:%PORT%/owner
  set "LAN_IP="
  for /f "tokens=2 delims=:" %%I in ('ipconfig ^| findstr /i /c:"IPv4"') do if not defined LAN_IP for /f "tokens=1" %%J in ("%%I") do set "LAN_IP=%%J"
  if defined LAN_IP echo  На телефоне в той же Wi-Fi: http://%LAN_IP%:%PORT%/owner
  start "" "http://127.0.0.1:%PORT%/owner"
  echo.
  echo Оставь серверное окно открытым. Публичный доступ включается из панели.
  pause
  exit /b 0
)

echo.
echo [SOVLI] Проверяем код, структуру и окружение...
call npm run check
if errorlevel 1 (echo [ERROR] Проверка синтаксиса не прошла.& pause& exit /b 1)
call npm run verify
if errorlevel 1 (echo [ERROR] Проверка проекта не прошла.& pause& exit /b 1)
node scripts\doctor.cjs
if errorlevel 1 (echo [ERROR] Проверка окружения не прошла. Закрой чужой процесс на порту %PORT%.& pause& exit /b 1)

set "HOST=0.0.0.0"
set "PUBLIC_MODE=0"
set "PUBLIC_MATCHING=1"
set "SOVLI_AUTO_START_TUNNEL=1"
set "SOVLI_TUNNEL_PROTOCOL=auto"
echo.
echo ================================================================
echo  SOVLI v1.2.0 - LOCAL QUICK TUNNEL FALLBACK
echo  For always-on public hosting, deploy with render.yaml instead.
echo  Сервер и Cloudflare запускаются под управлением Node.js.
echo  Ссылка и код приглашения появятся в этом окне.
echo  Панель владельца: http://localhost:%PORT%/owner
echo  Для телефона используй LAN IP из логов сервера.
echo  Остановка сервера и туннеля: Ctrl+C
echo ================================================================
echo.
node server.js
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo [ERROR] SOVLI завершился с кодом %EXIT_CODE%.
  pause
)
endlocal
