@echo off
chcp 65001 >nul
title ZenithTavern
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is required. Install the LTS version from https://nodejs.org then run this again.
    pause
    exit /b 1
)
where git >nul 2>&1
if errorlevel 1 (
    echo Git is required. Install it from https://git-scm.com/download/win then run this again.
    pause
    exit /b 1
)
if exist "%~dp0ZenithTavern.cjs" (
    node "%~dp0ZenithTavern.cjs" --panel %*
) else (
    node "%~dp0src\launcher.cjs" --panel %*
)
if errorlevel 1 pause
