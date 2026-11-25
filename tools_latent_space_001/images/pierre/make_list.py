# Liste des images de la série « pierre » pour Latent space.
# Le site ne peut pas lire un dossier : relancer ce script après chaque ajout d'images (python make_list.py).
# Il écrit list.js, chargé par ../../index.html (fonctionne aussi en ouvrant le fichier en local).
# Noms reconnus : pierre_X0.45_Y0.00_Z0.00.webp (poids) ou pierre_x3_y0_z0.webp (paliers de 0,15).
import json, re
from pathlib import Path

here = Path(__file__).resolve().parent
pat = re.compile(r"_x(-?\d+(?:\.\d+)?)_y(-?\d+(?:\.\d+)?)_z(-?\d+(?:\.\d+)?)\.(webp|png|jpe?g)$", re.I)
names = sorted(p.name for p in here.iterdir() if p.is_file() and pat.search(p.name))
(here / "list.js").write_text(
    "// écrit par make_list.py : la liste des images de la série, relancer le script après un ajout\n"
    f"window.LATENT_IMAGES = {json.dumps(names, ensure_ascii=False, indent=0)};\n",
    encoding="utf-8")
print(f"{len(names)} images -> list.js")
