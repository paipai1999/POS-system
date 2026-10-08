@echo off
rem Makes the POS server start by itself whenever this Windows user signs in.
rem Run once. To undo, run uninstall-autostart.bat.
cd /d "%~dp0"
schtasks /create /tn "Restaurant POS server" /tr "\"%~dp0start-server.bat\"" /sc onlogon /f
if errorlevel 1 (
  echo.
  echo Could not create the startup task. Try right-clicking this file and choosing "Run as administrator".
  pause
  exit /b 1
)
echo.
echo Done. The POS server will now start automatically when you sign in to Windows.
echo For a PC that should start the POS after a power cut without anyone signing in,
echo set Windows to sign in automatically ^(search "netplwiz"^) and turn on "Restart after power failure" in the BIOS.
pause
