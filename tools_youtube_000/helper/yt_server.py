"""
YouTube download — le petit serveur local de l'outil tools_youtube_000.

La page (en ligne sur GitHub Pages, ou servie ici même) ne peut pas télécharger
YouTube seule : ce serveur, lancé sur ton ordinateur, s'en charge avec yt-dlp.
Il n'écoute que sur 127.0.0.1 (ton ordinateur) et ne répond qu'à la page de l'outil.

  · http://127.0.0.1:8765/                         les outils, servis depuis le dossier du dépôt
  · GET  /api/status                               versions, ffmpeg trouvé ou non
  · GET  /api/info?url=…                           titre, chaîne, durée, miniature, hauteurs
  · POST /api/download {url, kind, height}         lance un téléchargement (mp4 / mp3 320 kb/s)
  · GET  /api/job?id=…                             avancement
  · GET  /api/file?id=…                            le fichier terminé, en pièce jointe

Lancer : start.bat (Windows) ou start.command (macOS), ou « python yt_server.py ».
"""
import json
import os
import re
import secrets
import shutil
import sys
import tempfile
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

try:
    import yt_dlp
except ImportError:
    sys.exit('yt-dlp is missing: python -m pip install --user -U "yt-dlp[default]" imageio-ffmpeg')

PORT = 8765
HOST = "127.0.0.1"
ROOT = Path(__file__).resolve().parents[2]          # MULTI-DIGITAL TOOLS/
TOOL_PATH = "/tools_youtube_000/"
WORK = Path(tempfile.gettempdir()) / "digital_tools_youtube"

# Pages autorisées à parler au serveur : le site en ligne, et ce serveur / un serveur local de dev
ALLOWED_ORIGIN = re.compile(r"^(https://logival2\.github\.io|https?://(localhost|127\.0\.0\.1)(:\d+)?)$")
# Liens acceptés : YouTube seulement (vidéo, short, youtu.be, music)
YOUTUBE_URL = re.compile(r"^https?://([a-z0-9-]+\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)/", re.I)


def find_ffmpeg():
    """ffmpeg du système, sinon celui livré avec imageio-ffmpeg (pip)."""
    path = shutil.which("ffmpeg")
    if path:
        return path
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


FFMPEG = find_ffmpeg()


def base_args():
    args = ["--no-playlist", "--js-runtimes", "node", "--no-warnings", "--windows-filenames"]
    if FFMPEG:
        args += ["--ffmpeg-location", FFMPEG]
    return args


def ydl_options(cli_args):
    """Options yt-dlp écrites comme en ligne de commande (plus lisible, et suit les évolutions de yt-dlp)."""
    return yt_dlp.parse_options(cli_args).ydl_opts


# ── Téléchargements ──
JOBS = {}
JOBS_LOCK = threading.Lock()


def job_args(kind, height, outdir):
    template = str(outdir / "%(title).150B [%(id)s].%(ext)s")
    args = base_args() + ["-o", template, "--no-progress", "--embed-metadata"]
    if kind == "mp3":
        # le meilleur son disponible, réencodé en MP3 à 320 kb/s, la miniature en pochette
        return args + ["-f", "ba/b", "-x", "--audio-format", "mp3", "--audio-quality", "320K",
                       "--embed-thumbnail", "--convert-thumbnails", "jpg"]
    # (pas de miniature dans le MP4 : elle s'y range comme une 2e piste vidéo, qui gêne les logiciels de montage)
    # MP4 : vidéo seule + son, assemblés par ffmpeg. Hauteur limitée → H.264 / AAC en priorité
    # (lisible partout, After Effects et Premiere compris) ; « max » → la meilleure image, quel que soit le codec.
    sort = "acodec:aac" if height == "max" else f"res:{int(height)},vcodec:h264,acodec:aac"
    return args + ["-f", "bv+ba/b", "-S", sort, "--merge-output-format", "mp4"]


def run_job(job):
    def hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            info = d.get("info_dict") or {}
            stream = "audio" if info.get("vcodec") == "none" else "video"
            job.update(state="downloading", stream=stream,
                       progress=(done / total) if total else None,
                       speed=d.get("speed"), eta=d.get("eta"))
        elif d["status"] == "finished":
            job.update(progress=1, speed=None, eta=None)

    def post_hook(d):
        if d.get("status") == "started":
            job.update(state="processing")

    try:
        opts = ydl_options(job_args(job["kind"], job["height"], job["dir"]))
        opts["progress_hooks"] = [hook]
        opts["postprocessor_hooks"] = [post_hook]
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([job["url"]])
        files = [p for p in job["dir"].iterdir() if p.suffix.lower() in (".mp4", ".mp3")]
        if not files:
            raise RuntimeError("no file was produced")
        out = max(files, key=lambda p: p.stat().st_size)
        job.update(state="done", progress=1, path=str(out), filename=out.name, size=out.stat().st_size)
    except Exception as err:  # message lisible pour la page
        msg = re.sub(r"\x1b\[[0-9;]*m", "", str(err)).replace("ERROR: ", "")
        job.update(state="error", error=msg[:400])


def start_job(url, kind, height):
    job_id = secrets.token_urlsafe(12)
    outdir = WORK / job_id
    outdir.mkdir(parents=True, exist_ok=True)
    job = {"id": job_id, "url": url, "kind": kind, "height": height, "dir": outdir,
           "state": "queued", "progress": 0, "stream": None, "speed": None, "eta": None,
           "filename": None, "size": None, "error": None, "started": time.time()}
    with JOBS_LOCK:
        JOBS[job_id] = job
    threading.Thread(target=run_job, args=(job,), daemon=True).start()
    return job


def public(job):
    return {k: job[k] for k in ("id", "kind", "height", "state", "progress", "stream", "speed",
                                "eta", "filename", "size", "error")}


# ── Infos sur une vidéo ──
def video_info(url):
    opts = ydl_options(base_args() + ["--skip-download"])
    opts["quiet"] = True
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    heights = sorted({f["height"] for f in info.get("formats") or []
                      if f.get("height") and f.get("vcodec") not in (None, "none")})
    return {
        "id": info.get("id"),
        "title": info.get("title"),
        "channel": info.get("channel") or info.get("uploader"),
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "maxHeight": heights[-1] if heights else None,
        "isLive": bool(info.get("is_live")),
    }


# ── Serveur HTTP ──
class Handler(SimpleHTTPRequestHandler):
    server_version = "DigitalToolsYT/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        if "/api/job" not in self.path:   # l'avancement est demandé sans cesse : on ne l'affiche pas
            sys.stderr.write("  %s\n" % (fmt % args))

    # CORS : seules les pages de l'outil (en ligne ou locales) peuvent lire les réponses
    def origin_ok(self):
        origin = self.headers.get("Origin")
        return origin is None or bool(ALLOWED_ORIGIN.match(origin))

    def cors(self):
        origin = self.headers.get("Origin")
        if origin and ALLOWED_ORIGIN.match(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204 if self.origin_ok() else 403)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            return super().do_GET()          # les pages des outils
        if not self.origin_ok():
            return self.send_json({"error": "origin not allowed"}, 403)
        query = parse_qs(parsed.query)
        arg = lambda name: (query.get(name) or [""])[0]

        if parsed.path == "/api/status":
            return self.send_json({"ok": True, "ytdlp": yt_dlp.version.__version__,
                                   "ffmpeg": bool(FFMPEG), "node": bool(shutil.which("node"))})

        if parsed.path == "/api/info":
            url = arg("url").strip()
            if not YOUTUBE_URL.match(url):
                return self.send_json({"error": "Not a YouTube link"}, 400)
            try:
                return self.send_json(video_info(url))
            except Exception as err:
                msg = re.sub(r"\x1b\[[0-9;]*m", "", str(err)).replace("ERROR: ", "")
                return self.send_json({"error": msg[:400]}, 422)

        job = JOBS.get(arg("id"))
        if parsed.path == "/api/job":
            return self.send_json(public(job)) if job else self.send_json({"error": "unknown job"}, 404)

        if parsed.path == "/api/file":
            if not job or job["state"] != "done":
                return self.send_json({"error": "file not ready"}, 404)
            path = Path(job["path"])
            ascii_name = job["filename"].encode("ascii", "ignore").decode().replace('"', "") or "download"
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg" if path.suffix == ".mp3" else "video/mp4")
            self.send_header("Content-Length", str(path.stat().st_size))
            self.send_header("Content-Disposition",
                             f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(job["filename"])}')
            self.end_headers()
            with path.open("rb") as f:
                shutil.copyfileobj(f, self.wfile)
            return

        self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        if urlparse(self.path).path != "/api/download":
            return self.send_json({"error": "not found"}, 404)
        # une page tierce ne peut ni lire la réponse ni déclencher un téléchargement
        if not self.headers.get("Origin") or not self.origin_ok():
            return self.send_json({"error": "origin not allowed"}, 403)
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            return self.send_json({"error": "JSON expected"}, 415)
        try:
            length = min(int(self.headers.get("Content-Length") or 0), 10_000)
            data = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self.send_json({"error": "bad request"}, 400)
        url = str(data.get("url", "")).strip()
        kind = data.get("kind")
        height = str(data.get("height", "1080"))
        if not YOUTUBE_URL.match(url):
            return self.send_json({"error": "Not a YouTube link"}, 400)
        if kind not in ("mp4", "mp3") or not (height == "max" or height.isdigit()):
            return self.send_json({"error": "bad format"}, 400)
        self.send_json(public(start_job(url, kind, height)))


def main():
    shutil.rmtree(WORK, ignore_errors=True)   # les fichiers d'une session précédente
    WORK.mkdir(parents=True, exist_ok=True)
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        print(f"Port {PORT} is busy: the helper is probably already running.")
        webbrowser.open(f"http://{HOST}:{PORT}{TOOL_PATH}")
        return
    url = f"http://{HOST}:{PORT}{TOOL_PATH}"
    print(f"\n  YouTube download helper - yt-dlp {yt_dlp.version.__version__} - "
          f"ffmpeg {'ok' if FFMPEG else 'MISSING'}")
    print(f"  {url}\n  Keep this window open while you use the tool. Ctrl+C to stop.\n")
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        shutil.rmtree(WORK, ignore_errors=True)


if __name__ == "__main__":
    main()
