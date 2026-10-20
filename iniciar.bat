@echo off
title TV Music
cd /d "%~dp0"

where node >nul 2>nul || (
  echo Instale o Node.js 22 ou mais novo: https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias...
  call npm install --omit=dev || (pause & exit /b 1)
)

call npm start
pause
