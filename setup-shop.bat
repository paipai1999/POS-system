@echo off
rem One-time setup of this PC as the POS counter and server. Double-click it. It asks before it changes anything.
rem   setup-shop.bat          checks the PC, then sets up what is missing
rem   setup-shop.bat /check   only checks and reports; changes nothing (safe to run any time)
rem It uses the other .bat files in this folder; each one can still be run by itself.
cd /d "%~dp0"
title Restaurant POS - setup
set "MODE=%~1"
set "TODO=0"
echo.
echo  Restaurant POS - setting up this PC
echo  ------------------------------------
echo  [ok] = ready     [..] = still to do     [!!] = needs attention
echo.

rem ---- 1. Node.js 22.5 or newer
where node >nul 2>nul
if errorlevel 1 goto node_missing
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)"
if errorlevel 1 goto node_old
for /f "delims=" %%v in ('node -v') do echo  [ok] Node.js %%v is installed
goto node_done
:node_missing
echo  [!!] Node.js is not installed.
goto node_fix
:node_old
echo  [!!] Node.js is too old. The POS needs version 22.5 or newer.
:node_fix
if /i "%MODE%"=="/check" goto check_node_failed
where winget >nul 2>nul
if errorlevel 1 goto node_manual
echo.
echo  This can install the current Node.js LTS for you with the Windows Package Manager.
choice /c YN /m "  Install Node.js now"
if errorlevel 2 goto node_manual
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
echo.
echo  Node.js is installed. Close this window and double-click setup-shop.bat again:
echo  Windows only shows a new program to windows that are opened after it was installed.
pause
exit /b 0
:node_manual
echo.
echo  Download the LTS version from https://nodejs.org , install it, then double-click setup-shop.bat again.
pause
exit /b 1
:check_node_failed
echo.
echo  Install Node.js ^(LTS, from https://nodejs.org^) before anything else.
exit /b 1
:node_done

rem ---- 2. Is the server already running on this PC?
set "RUNNING=0"
netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul 2>nul
if not errorlevel 1 set "RUNNING=1"
if "%RUNNING%"=="1" echo  [ok] A server is already running on port 3000
if "%RUNNING%"=="0" echo  [..] The POS server is not running yet

rem ---- 3. Firewall rule so phones on the shop Wi-Fi can reach it
netsh advfirewall firewall show rule name="Restaurant POS" >nul 2>nul
if errorlevel 1 goto fw_missing
echo  [ok] Phones on the shop Wi-Fi are allowed in ^(firewall rule exists^)
set "FW=1"
goto fw_done
:fw_missing
echo  [..] The firewall does not yet let phones reach the POS
set "FW=0"
set /a TODO+=1
:fw_done

rem ---- 4. Start by itself when Windows starts
schtasks /query /tn "Restaurant POS server" >nul 2>nul
if errorlevel 1 goto auto_missing
echo  [ok] The server starts by itself when you sign in to Windows
set "AUTO=1"
goto auto_done
:auto_missing
echo  [..] The server does not yet start by itself when you sign in to Windows
set "AUTO=0"
set /a TODO+=1
:auto_done

rem ---- 5. Chrome (the printer station needs it) and a default printer
set "CHROME=0"
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" >nul 2>nul
if not errorlevel 1 set "CHROME=1"
reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" >nul 2>nul
if not errorlevel 1 set "CHROME=1"
if "%CHROME%"=="1" echo  [ok] Google Chrome is installed
if "%CHROME%"=="0" echo  [!!] Google Chrome is not installed. It is needed so the bill prints without a print window.
powershell -NoProfile -Command "if (Get-CimInstance Win32_Printer | Where-Object Default) { exit 0 } else { exit 1 }" >nul 2>nul
if errorlevel 1 goto printer_missing
echo  [ok] A default printer is set
goto printer_done
:printer_missing
echo  [!!] No default printer is set. Set the receipt printer as the default printer in Windows.
:printer_done

rem ---- 6. The Wi-Fi / network must be "Private", or phones cannot connect
powershell -NoProfile -Command "if (Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' }) { exit 1 } else { exit 0 }" >nul 2>nul
if errorlevel 1 goto net_public
echo  [ok] The network is not set to Public
goto net_done
:net_public
echo  [!!] A network is set to "Public". Change it to "Private" in Windows Settings, Network.
:net_done

if /i "%MODE%"=="/check" goto finish_check

rem ================== setting up what is missing ==================
echo.
if "%FW%"=="1" goto do_auto
echo  Step A - let phones reach the POS. Windows will ask for administrator permission.
choice /c YN /m "  Do it now"
if errorlevel 2 goto do_auto
powershell -NoProfile -Command "try { Start-Process -FilePath '%~dp0allow-firewall.bat' -Verb RunAs -Wait; exit 0 } catch { exit 1 }"
if errorlevel 1 echo  Administrator permission was not given, so the firewall was not changed. Run allow-firewall.bat later.
:do_auto
if "%AUTO%"=="1" goto do_server
echo.
echo  Step B - start the server by itself when Windows starts.
choice /c YN /m "  Do it now"
if errorlevel 2 goto do_server
call "%~dp0install-autostart.bat"
:do_server
if "%RUNNING%"=="1" goto do_open
echo.
echo  Step C - starting the POS server in its own window. Keep that window open, or minimise it.
start "Restaurant POS server" "%~dp0start-server.bat"
set "TRIES=0"
:wait_server
powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://localhost:3000/api/health' -TimeoutSec 2; if ($r.ok) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 goto server_up
set /a TRIES+=1
if %TRIES% GEQ 20 goto server_down
timeout /t 1 /nobreak >nul
goto wait_server
:server_down
echo  [!!] The server did not answer. Look at the "Restaurant POS server" window for the reason.
goto do_open
:server_up
echo  [ok] The server is running
echo.
echo  Phones, tablets and the kitchen screen open one of these addresses on the shop Wi-Fi:
powershell -NoProfile -Command "$h = Invoke-RestMethod -Uri 'http://localhost:3000/api/health'; foreach ($a in $h.addresses) { '     http://' + $a + ':' + $h.port }"
:do_open
echo.
echo  Step D - open the counter screen.
choice /c YN /m "  Open it now"
if errorlevel 2 goto finish_setup
if "%CHROME%"=="1" call "%~dp0open-counter.bat"
if "%CHROME%"=="0" start "" http://localhost:3000

:finish_setup
echo.
echo  ------------------------------------
echo  Still to do by hand ^(see docs\SETUP-CHECKLIST.md^):
echo    1. Sign in as Admin ^(PIN 1234^) and choose your own PIN when asked. Do the same for every person.
echo    2. Settings: tick "This device is the printer station", then press "Print test page".
echo    3. Settings, Data and backup: add a USB drive or cloud folder under "Backup folders".
echo    4. In the router, give this PC a fixed address ^(DHCP reservation^).
echo    5. Walk through docs\SETUP-CHECKLIST.md with the staff and real phones.
echo.
pause
exit /b 0

:finish_check
echo.
if "%TODO%"=="0" echo  Nothing is missing that this script can set up.
if not "%TODO%"=="0" echo  %TODO% thing^(s^) can be set up by running setup-shop.bat without /check.
exit /b 0
