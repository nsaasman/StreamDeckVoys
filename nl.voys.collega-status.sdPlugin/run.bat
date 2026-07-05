@echo off
SETLOCAL
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Node.js is niet geinstalleerd. Installeer Node.js van https://nodejs.org/
    pause
    exit /b 1
)
cd /d "%~dp0"
if not exist "node_modules\ws" (
    echo Eerste keer - dependencies installeren...
    call npm install --production --no-audit --no-fund
)
node "%~dp0\app.js" %*
ENDLOCAL
