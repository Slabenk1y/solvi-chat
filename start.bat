@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title SOVLI v1.2.0 - Local server

set "HOST=0.0.0.0"
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do if /i "%%A"=="PORT" if not defined PORT set "PORT=%%B"
)
if not defined PORT set "PORT=3000"
set "PUBLIC_MODE=0"
set "PUBLIC_MATCHING=1"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo Install Node.js 22.16 or newer from https://nodejs.org/ and run start.bat again.
  pause
  exit /b 1
)

for /f %%V in ('node -p "process.versions.node"') do set "NODE_VERSION=%%V"
node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=16)?0:1)" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] SOVLI needs Node.js 22.16 or newer because it uses built-in SQLite.
  echo Your version: %NODE_VERSION%
  echo Install the current LTS from https://nodejs.org/.
  pause
  exit /b 1
)
echo [SOVLI] Node.js %NODE_VERSION% detected.
echo [SOVLI] Checking required packages...

node -e "for (const m of ['express','socket.io','bcryptjs','jsonwebtoken','express-rate-limit','helmet','dotenv']) require.resolve(m)" >nul 2>nul
if errorlevel 1 (
  echo [SOVLI] Installing dependencies. This is needed only on first launch or after an update...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] npm install failed. Check internet access and run npm install manually.
    pause
    exit /b 1
  )
  node -e "for (const m of ['express','socket.io','bcryptjs','jsonwebtoken','express-rate-limit','helmet','dotenv']) require.resolve(m)" >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] Some packages are still missing. Run: npm install
    pause
    exit /b 1
  )
)

echo.
echo [SOVLI] Checking JavaScript syntax and project wiring...
call npm run check
if errorlevel 1 (
  echo [ERROR] Syntax check failed. Read the error above and do not continue.
  pause
  exit /b 1
)
call npm run verify
if errorlevel 1 (
  echo [ERROR] Project consistency check failed. Read the error above.
  pause
  exit /b 1
)

echo [SOVLI] Running preflight diagnostics...
node scripts\doctor.cjs
if errorlevel 1 (
  echo.
  echo [ERROR] Preflight failed. Fix the messages above before launch.
  pause
  exit /b 1
)

echo.
echo ================================================================
echo  SOVLI v1.2.0 - LOCAL / LAN TEST
echo  Local: http://localhost:%PORT%
set "LAN_IP="
for /f "tokens=2 delims=:" %%I in ('ipconfig ^| findstr /i /c:"IPv4"') do if not defined LAN_IP for /f "tokens=1" %%J in ("%%I") do set "LAN_IP=%%J"
if defined LAN_IP echo  Phone on same Wi-Fi: http://%LAN_IP%:%PORT%
echo.
echo  If Windows Firewall asks, allow Node.js on Private networks.
echo  Keep this window open. Stop with Ctrl+C.
echo ================================================================
echo.
echo [SOVLI] Launching Node server directly (no npm wrapper)...
node server.js
set "SERVER_EXIT=%ERRORLEVEL%"
if not "%SERVER_EXIT%"=="0" (
  echo.
  echo [ERROR] Server exited with code %SERVER_EXIT%.
  echo Copy the complete error text above when asking for help.
  pause
)
endlocal
