@echo off
rem Opens the POS on the counter PC in its own Chrome window that prints straight to the default
rem printer without showing the print dialog (needed for the printer station). Start the server first.
start "" chrome --user-data-dir="%LOCALAPPDATA%\RestaurantPOS-Chrome" --kiosk-printing --new-window http://localhost:3000
