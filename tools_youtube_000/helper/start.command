#!/bin/bash
# YouTube download : lance le serveur local (double-clic sous macOS, ou « bash start.command »).
# Met d'abord yt-dlp à jour (YouTube change souvent), puis ouvre l'outil.
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null; then
  echo "Python 3 is not installed: get it from https://www.python.org/downloads/"
  read -r -p "Press Enter to close"
  exit 1
fi
echo "Updating yt-dlp..."
python3 -m pip install --user -U --quiet --disable-pip-version-check "yt-dlp[default]" imageio-ffmpeg
python3 yt_server.py
