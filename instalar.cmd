@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js 22.12 ou superior em https://nodejs.org e tente novamente.
  pause
  exit /b 1
)
call npm ci
if errorlevel 1 goto failed
call npm run setup
if errorlevel 1 goto failed
echo Instalacao concluida. Abra iniciar.cmd para usar o Fluxo.
pause
exit /b 0
:failed
echo A instalacao falhou. Confira a conexao e a mensagem acima.
pause
exit /b 1
