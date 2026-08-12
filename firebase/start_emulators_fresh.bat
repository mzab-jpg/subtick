@echo off
setlocal EnableDelayedExpansion
title SubTick Emulators
cd /d c:\2SubTick\firebase

echo ============================================================
echo SubTick Emulators - production data auto-sync
echo ============================================================

REM ---- Sync every start unless SKIP_SYNC.flag exists ----
set SKIP=0
if exist SKIP_SYNC.flag set SKIP=1

REM ---- Launch emulators in their own window (must stay open) ----
echo Launching Auth (9099) + Firestore (8080) + Functions (5001)...
start "SubTick Emulators - KEEP THIS WINDOW OPEN" cmd /k "cd /d c:\2SubTick\firebase && firebase emulators:start --only auth,firestore,functions"

REM ---- Wait for the Firestore emulator to accept connections ----
echo.
echo Waiting for the Firestore emulator...
set /a tries=0
:waitfire
curl -s -o nul http://127.0.0.1:8080/ >nul 2>&1
if errorlevel 1 (
    set /a tries+=1
    if !tries! geq 45 (
        echo ERROR: Firestore emulator did not start within 90 seconds.
        echo Check the "SubTick Emulators" window for errors.
        pause
        exit /b 1
    )
    timeout /t 2 /nobreak >nul
    goto waitfire
)
echo Firestore emulator is ready.

REM ---- Sync production data into the emulator ----
if "%SKIP%"=="1" (
    echo.
    echo SKIP_SYNC.flag found - skipping production sync.
    echo Delete firebase\SKIP_SYNC.flag to sync again on the next start.
) else (
    echo.
    echo Syncing production data into the emulator...
    echo   (articles, feeds, publishers, system/scoringConfig, system/previewConfig)
    node scripts\sync-prod-to-emulator.js
    if errorlevel 1 (
        echo.
        echo SYNC FAILED - the emulator has NO data.
        echo   Check you are logged in with the account that owns subtick-bbd55:
        echo     gcloud auth application-default login
        echo   Then close this window and run it again.
        pause
        exit /b 1
    )
)

REM ---- Wait for the Functions emulator to finish compiling ----
echo.
echo Waiting for the Functions emulator...
set /a tries=0
:waitfn
curl -s -o nul http://127.0.0.1:5001/ >nul 2>&1
if errorlevel 1 (
    set /a tries+=1
    if !tries! geq 60 (
        echo NOTE: Functions emulator still warming up (in the other window).
        echo It usually finishes within a couple of minutes.
        goto ready
    )
    timeout /t 2 /nobreak >nul
    goto waitfn
)

:ready
echo.
echo ============================================================
echo  ALL READY!
echo.
echo   Emulator UI : http://127.0.0.1:4000
echo   Matrix UI   : open scripts\start_matrix.bat then
echo                 http://localhost:3000/high_fidelity_matrix.html
echo.
echo   IMPORTANT: Keep BOTH windows open while testing.
echo ============================================================
pause