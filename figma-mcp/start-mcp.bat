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

:: -- 3. Start MCP server -----------------------------------------
echo.
echo   Starting MCP server on http://localhost:3000
echo.
echo   ------------------------------------------------------------
echo.
echo   NEXT: Expose to the web with ngrok.
echo.
echo   If you don't have ngrok installed:
echo     1. Create a free account at https://ngrok.com
echo     2. Download and install ngrok
echo     3. Run: ngrok config add-authtoken ^<your-token^>
echo.
echo   Then in a new terminal, run:
echo     ngrok http 3000
echo.
echo   Copy the "Forwarding" URL (e.g. https://xxxx.ngrok-free.app)
echo   and paste it into your web AI's MCP endpoint field.
echo.
echo   No bearer token is needed -- the MCP protocol doesn't
echo   require one. If Notion AI requires a field, leave it empty.
echo   If you want to add protection, use ngrok's built-in auth:
echo     ngrok http 3000 --basic-auth "user:pass"
echo   then provide those credentials to the AI platform.
echo.
echo   ------------------------------------------------------------
echo.

start "Figlink MCP" /D "%~dp0" cmd /c "node server.js && pause"
