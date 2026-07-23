@echo off
title Camoscio - Avvio App
echo ====================================================
echo    CAMOSCIO - APPLICAZIONE SOCIAL HIKING LOCALE
echo ====================================================
echo.

:: Controlla se la cartella node_modules esiste
if not exist node_modules (
    echo [INFO] Dipendenze non trovate. Installazione in corso...
    call cmd.exe /c npm install
    if %errorlevel% neq 0 (
        echo [ERRORE] Impossibile installare le dipendenze automaticamente.
        echo Assicurati che Node.js sia installato ed esegui 'npm install' manualmente.
        pause
        exit /b
    )
)

:: Avvia il server Node.js in una finestra separata
echo [INFO] Avvio del server Node.js su http://localhost:3000...
start "Camoscio Server" cmd /k "node server.js"

:: Attesa per consentire al server di avviarsi (2 secondi)
timeout /t 2 >nul

:: Apertura del browser predefinito
echo [INFO] Apertura del sito web nel browser...
start http://localhost:3000

echo.
echo ====================================================
echo [OK] Camoscio e avviato!
echo Puoi usare la finestra 'Camoscio Server' per monitorare i log.
echo Premi un tasto qualsiasi per chiudere questo avviatore.
echo ====================================================
pause >nul
