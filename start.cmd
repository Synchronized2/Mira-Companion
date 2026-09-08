@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Run npm ci first.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:5180 in Chrome or Edge.
if not exist .venv\Scripts\python.exe (
  echo Edge-TTS needs setup: run npm run setup:tts first, or choose Windows speech in settings.
)
call npm run dev
pause
