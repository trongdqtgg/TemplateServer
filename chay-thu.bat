@echo off
setlocal
cd /d "%~dp0"
rem Chay thu app (khong can build). Bieu tuong se hien duoi khay he thong.
where node >nul 2>nul
if errorlevel 1 (
  echo LOI: May nay chua cai Node.js. Tai tai https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo Dang cai dat thu vien lan dau...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)
call npm start
