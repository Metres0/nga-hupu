@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ============================================================
echo   NGA Mirror Station v4.0 — Start Server
echo ============================================================
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\manage.ps1" start %*
pause
