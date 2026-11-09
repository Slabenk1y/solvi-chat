@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title SOVLI v1.2.0 - Owner Console
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 22.16 or newer is required.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=16)?0:1)" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Install Node.js 22.16 or newer from https://nodejs.org/.
  pause
  exit /b 1
)
node -e "for (const m of ['express','socket.io','bcryptjs','jsonwebtoken','express-rate-limit','helmet','dotenv']) require.resolve(m)" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Dependencies are missing. Run start.bat first or execute npm install.
  pause
  exit /b 1
)
echo.
echo SOVLI OWNER CONSOLE
node scripts\owner-console.cjs
if errorlevel 1 echo [OWNER] Console closed with an error.
pause
endlocal
