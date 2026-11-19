@echo off
rem YouTube download : lance le serveur local (double-clic).
rem Met d'abord yt-dlp à jour (YouTube change souvent, une vieille version cesse de marcher), puis ouvre l'outil.
title YouTube download helper
cd /d "%~dp0"

set PY=python
where python >nul 2>nul || set PY=py
where %PY% >nul 2>nul || (
  echo Python is not installed: get it from https://www.python.org/downloads/ ^(tick "Add to PATH"^).
  pause
  exit /b 1
)

echo Updating yt-dlp...
%PY% -m pip install --user -U --quiet --disable-pip-version-check "yt-dlp[default]" imageio-ffmpeg
%PY% yt_server.py
pause
