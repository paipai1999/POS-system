@echo off
rem Puts a backup copy back as the POS data. Close the POS server window first.
rem   restore-backup.bat                          lists the copies it can find
rem   restore-backup.bat "D:\POS-backups\pos-2026-10-12.db"      (or drag a backup file onto this file)
cd /d "%~dp0"
title Restore a POS backup
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org and install it.
  pause
  exit /b 1
)
if "%~1"=="" (
  node server\restore.js --list
  echo To restore one, drag its file onto restore-backup.bat, or type:  restore-backup.bat "full path of the file"
  pause
  exit /b 0
)
node server\restore.js "%~1"
pause
