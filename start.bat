@echo off
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo [Maestrale] Node.js non e' installato su questo PC.
  echo Senza Node non si puo' avviare l'app in dev.
  echo.
  echo Installalo con:   winget install OpenJS.NodeJS.LTS
  echo Poi CHIUDI e RIAPRI questa finestra e rilancia start.bat
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [Maestrale] Installo le dipendenze...
  call npm install
  if errorlevel 1 (
    echo [Maestrale] npm install fallito.
    pause
    exit /b 1
  )
)

npm run dev
if errorlevel 1 (
  echo.
  echo [Maestrale] avvio fallito - leggi l'errore qui sopra.
  pause
)
