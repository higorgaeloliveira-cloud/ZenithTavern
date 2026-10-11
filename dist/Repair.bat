@echo off
title ZenithTavern Repair
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is required. Install the LTS version from https://nodejs.org then run this again.
    pause
    exit /b 1
)
if exist "%~dp0ZenithTavern.cjs" (
    node "%~dp0ZenithTavern.cjs" --repair %*
) else (
    node "%~dp0src\repair.cjs" %*
)
pause
