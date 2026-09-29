@echo off
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" goto missing
if not exist "bin\yt-dlp.exe" goto missing
set ELECTRON_RUN_AS_NODE=
start "" "node_modules\electron\dist\electron.exe" .
exit /b
:missing
echo Execute instalar.cmd primeiro.
pause
