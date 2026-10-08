@echo off
rem Lets phones and tablets on the restaurant Wi-Fi reach the POS server (port 3000).
rem Needs administrator rights: right-click this file and choose "Run as administrator". Run once.
net session >nul 2>nul
if errorlevel 1 (
  echo This must be run as administrator. Right-click the file and choose "Run as administrator".
  pause
  exit /b 1
)
netsh advfirewall firewall delete rule name="Restaurant POS" >nul 2>nul
netsh advfirewall firewall add rule name="Restaurant POS" dir=in action=allow protocol=TCP localport=3000 profile=private,domain
if errorlevel 1 (
  echo Could not add the firewall rule.
  pause
  exit /b 1
)
echo.
echo Done. Devices on a "Private" network can now open the POS at http://THIS-PC-ADDRESS:3000
echo If this PC's Wi-Fi/Ethernet is set to "Public" in Windows, change it to "Private" ^(Settings, Network^).
pause
