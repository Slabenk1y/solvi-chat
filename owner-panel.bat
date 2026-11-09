@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
set "PORT=3000"
if exist ".env" for /f "usebackq tokens=1,* delims==" %%A in (".env") do if /i "%%A"=="PORT" if not "%%B"=="" set "PORT=%%B"
echo Открываем панель владельца SOVLI...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/api/health' -TimeoutSec 2; if($r.StatusCode -eq 200){ Start-Process 'http://127.0.0.1:%PORT%/owner'; exit 0 } } catch {}; exit 1"
if errorlevel 1 (
  echo Сервер SOVLI не запущен. Сначала запусти start.bat на компьютере.
  pause
)
endlocal
