@echo off
rem Removes the automatic start created by install-autostart.bat.
schtasks /delete /tn "Restaurant POS server" /f
pause
