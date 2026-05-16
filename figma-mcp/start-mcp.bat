@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo   ============================================================
echo     Figlink MCP -- Expose Figma to Web AI Models
echo   ============================================================
echo.

:: Check Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   Node.js is not installed.
    echo   Download from https://nodejs.org/en/download then try again.
    pause
    exit /b 1
)

:: -- 1. Start Figlink link-server (ws://localhost:9001) ----------
set "FIGLINK_DIR=%~dp0..\figlink-codebase"
pushd "%FIGLINK_DIR%"

if not exist "link-server\node_modules" (
    echo   Installing Figlink dependencies...
    cd link-server
    call npm install
    cd ..
)

echo   Starting Figlink server on ws://localhost:9001...
start "Figlink Server" /D "%FIGLINK_DIR%" cmd /c "node start.js"

popd

:: -- 2. Install MCP deps if needed -------------------------------
if not exist "node_modules" (
    echo   Installing MCP dependencies...
    call npm install
    echo.
)

:: -- 3. Start ngrok tunnel ---------------------------------------
where ngrok >nul 2>&1
if %errorlevel% equ 0 (
    echo   Starting ngrok tunnel on port 39399...
    start "ngrok Figlink" cmd /c "ngrok http 39399"
) else (
    echo   ngrok not found in PATH -- skipping tunnel.
    echo   Install from https://ngrok.com then run: ngrok http 39399
)

:: -- 4. Start MCP server -----------------------------------------
echo.
echo   Starting MCP server on http://localhost:39399
echo.
echo   ------------------------------------------------------------
echo.
echo   Copy the ngrok "Forwarding" URL (e.g. https://xxxx.ngrok-free.app)
echo   from the ngrok terminal and paste it into your web AI's
echo   MCP endpoint field.
echo.
echo   ------------------------------------------------------------
echo.

start "Figlink MCP" /D "%~dp0" cmd /c "node server.js && pause"
