@echo off
setlocal

set PLUGIN_NAME=nl.voys.collega-status.sdPlugin
set SRC_DIR=%~dp0%PLUGIN_NAME%
set DEST_DIR=%APPDATA%\Elgato\StreamDeck\Plugins\%PLUGIN_NAME%

echo 1. Nieuwe dist bouwen...
cd /d "%SRC_DIR%"
call npm run build

echo.
echo 2. Stream Deck afsluiten om bestanden te kunnen overschrijven...
taskkill /f /im StreamDeck.exe >nul 2>&1
:: Geef processen even de tijd om volledig te sluiten
timeout /t 2 /nobreak >nul

echo.
echo 3. Plugin bestanden updaten in %DEST_DIR%...
if not exist "%DEST_DIR%" mkdir "%DEST_DIR%"

:: Gebruik robocopy om alles te kopiëren, exclusief de ontwikkel-mappen en node_modules.
:: (node_modules wordt door de plugin zelf geïnstalleerd bij de eerste run)
robocopy "%SRC_DIR%" "%DEST_DIR%" /MIR /XD node_modules .git scripts dist /XF .gitignore package-lock.json /NJH /NJS

:: Robocopy exit codes: 0-7 is succes (bijv. 1 = bestanden gekopieerd, 2 = extra bestanden verwijderd, 3 = beide).
if %ERRORLEVEL% GEQ 8 (
    echo.
    echo [Fout] Er is iets misgegaan tijdens het kopiëren van de bestanden. Zorg dat er geen bestanden gelockt zijn.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo 4. Stream Deck weer opstarten...
:: Controleer of Stream Deck standaard op deze locatie is geïnstalleerd
if exist "C:\Program Files\Elgato\StreamDeck\StreamDeck.exe" (
    start "" "C:\Program Files\Elgato\StreamDeck\StreamDeck.exe"
) else (
    echo Kan StreamDeck.exe niet automatisch vinden. Start Stream Deck a.u.b. handmatig.
)

echo.
echo Klaar! De nieuwe dist is gebouwd en de plugin is succesvol geüpdatet.
pause
