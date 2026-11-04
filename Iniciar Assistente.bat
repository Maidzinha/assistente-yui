@echo off
rem Abre o Assistente (Yui). Funciona com dois cliques, sem mudar a politica do PowerShell.
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias pela primeira vez...
  call npm.cmd install || goto erro
)
call npm.cmd run dev || goto erro
exit /b 0

:erro
echo.
echo Nao foi possivel iniciar o Assistente. Veja a mensagem acima.
pause
