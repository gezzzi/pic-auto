@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "APP_DIR=%SCRIPT_DIR%"
set "APP_PORT=3000"
set "WAIT_SECONDS=60"

if not "%~1"=="" (
    if exist "%~f1\" (
        set "APP_DIR=%~f1"
    ) else (
        echo [pic-auto] Provided path "%~1" does not exist.
        exit /b 1
    )
)

if not exist "%APP_DIR%\package.json" (
    echo [pic-auto] Could not find package.json in "%APP_DIR%".
    echo [pic-auto] Please run the script from the repo or pass the project root as the first argument.
    exit /b 1
)

pushd "%APP_DIR%"

echo [pic-auto] Working directory: %APP_DIR%

if not exist node_modules (
    echo [pic-auto] Installing dependencies (node_modules not found)...
    npm install
    if errorlevel 1 (
        echo [pic-auto] npm install failed. Please check the errors above.
        pause
        popd
        exit /b 1
    )
)

if not exist ".next" (
    echo [pic-auto] Production build not found. Running npm run build...
    npm run build
    if errorlevel 1 (
        echo [pic-auto] npm run build failed. Please check the errors above.
        pause
        popd
        exit /b 1
    )
)

echo [pic-auto] Starting production server (npm run start) in a new window...
start "pic-auto server" cmd /k "cd /d ""%APP_DIR%"" && npm run start"

echo [pic-auto] Waiting for http://localhost:%APP_PORT% (timeout: %WAIT_SECONDS%s) ...
for /l %%i in (1,1,%WAIT_SECONDS%) do (
    powershell -NoLogo -Command "$test = Test-NetConnection -ComputerName 'localhost' -Port %APP_PORT% -WarningAction SilentlyContinue; if ($test.TcpTestSucceeded) { exit 0 } else { exit 1 }" >nul
    if not errorlevel 1 goto :ServerReady
    timeout /t 1 >nul
)

echo [pic-auto] Could not confirm the dev server within %WAIT_SECONDS% seconds, continuing anyway.
goto :OpenBrowser

:ServerReady
echo [pic-auto] Dev server is up. Opening the browser...

:OpenBrowser
start "" "http://localhost:%APP_PORT%/"
echo [pic-auto] The dev server is running in the other window. Close it when you are done.
popd
exit /b 0
