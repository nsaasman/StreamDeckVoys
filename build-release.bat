@echo off
setlocal

set PLUGIN_NAME=nl.voys.collega-status.sdPlugin
set SRC_DIR=%~dp0%PLUGIN_NAME%
set OUTPUT=%~dp0dist\voys-collega-status.streamDeckPlugin
set DOCS=%~dp0dist\handleiding.html

echo.
echo Publieke release build maken...
echo - Geen API tokens, client IDs of client UUIDs
echo - Geen plugin.log of debug-bestanden
echo.

cd /d "%SRC_DIR%"
if not exist "package.json" (
    echo [Fout] Plugin map niet gevonden: %SRC_DIR%
    pause
    exit /b 1
)

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [Fout] Node.js is niet geinstalleerd. Installeer Node.js van https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules\adm-zip" (
    echo Dependencies installeren...
    call npm install --no-audit --no-fund
    if %ERRORLEVEL% NEQ 0 (
        echo [Fout] npm install mislukt.
        pause
        exit /b %ERRORLEVEL%
    )
)

call npm run build:release
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [Fout] Release build mislukt.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo Klaar! Deel deze bestanden met anderen:
echo   Plugin:  %OUTPUT%
echo   Uitleg:  %DOCS%
echo.
echo Installatie: dubbelklik op het .streamDeckPlugin bestand in Stream Deck.
echo Open handleiding.html in je browser voor de volledige uitleg.
echo.
pause
