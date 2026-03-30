@echo off
chcp 65001 >nul
title Figlink
cd /d "%~dp0"

:: Check Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   +----------------------------------------------------------+
    echo   ^|                                                          ^|
    echo   ^|   Node.js is not installed on this machine.              ^|
    echo   ^|                                                          ^|
    echo   ^|   Figlink requires Node.js to run.                       ^|
    echo   ^|                                                          ^|
    echo   ^|   Download it free from:                                 ^|
    echo   ^|     https://nodejs.org/en/download                       ^|
    echo   ^|                                                          ^|
    echo   ^|   Install Node.js, then double-click this file again.    ^|
    echo   ^|                                                          ^|
    echo   +----------------------------------------------------------+
    echo.
    pause
    exit /b 1
)

:: Run the launcher
node start.js

:: Keep window open if it exits unexpectedly
echo.
pause
