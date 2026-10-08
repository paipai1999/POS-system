@echo off
rem Starts the Restaurant POS server and restarts it if it ever stops unexpectedly.
rem Keep this window open while the restaurant is using the POS (it can be minimised).
cd /d "%~dp0"
title Restaurant POS server
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org and install it.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)"
if errorlevel 1 (
  echo Your Node.js is too old. The POS server needs version 22.5 or newer.
  echo Download the LTS version from https://nodejs.org, install it, then run this file again.
  pause
  exit /b 1
)
:run
node server\server.js
set code=%errorlevel%
if "%code%"=="0" exit /b 0
if "%code%"=="2" (
  echo The POS server is already running on this PC.
  pause
  exit /b 2
)
echo.
echo The POS server stopped unexpectedly ^(code %code%^). Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto run
