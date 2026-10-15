"""Les maquettes face aux vraies captures de l'application : une image par écran,
puis quatre planches. python3 design/comparer.py (après app/scripts/parcourir.mjs)."""
import glob, os
from PIL import Image, ImageDraw, ImageFont

ICI = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ICI, "..", "app", "captures")
PAIRES = [("01-connexion", "bienvenue"), ("02-code", "bienvenue-code"), ("03-accueil", "accueil"),
          ("04-entrer-operateur", "entrer-operateur"), ("05-entrer-montant", "entrer-montant"), ("06-entrer-payer", "entrer-payer"),
          ("07-entrer-confirme", "entrer-credite"), ("08-sortir-montant", "sortir-montant"), ("09-sortir-destination", "sortir-destination"),
          ("10-sortir-recap", "sortir-verifier"), ("11-marche", "marche"), ("12-marche-graphique", "marche-graphique"),
          ("13-marche-carnet", "marche-carnet"), ("14-marche-ordres", "marche-ordres"), ("15-marche-ordre-place", "marche-execute"),
          ("16-crypto", "crypto"), ("17-crypto-deposer", "crypto-deposer"), ("18-historique", "historique"),
          ("19-historique-detail", "historique-detail"), ("20-compte", "compte")]

def capture(nom):
    for f in sorted(glob.glob(os.path.join(APP, "*.png"))):
        if os.path.basename(f)[3:-4] == nom:
            return f
    return None

try:
    police = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
except OSError:
    police = ImageFont.load_default()
sortie = os.path.join(ICI, "comparaison")
os.makedirs(sortie, exist_ok=True)
images = []
for m, a in PAIRES:
    im = Image.new("RGB", (412 * 2 + 30, 915 + 40), "white")
    d = ImageDraw.Draw(im)
    mq = Image.open(os.path.join(ICI, "captures", f"{m}.png")).convert("RGB"); mq.thumbnail((412, 915)); im.paste(mq, (0, 40))
    d.text((10, 8), "MAQUETTE", fill="black", font=police)
    f = capture(a)
    if f:
        ap = Image.open(f).convert("RGB"); ap = ap.crop((0, 0, ap.width, min(ap.height, 1830))); ap.thumbnail((412, 915)); im.paste(ap, (442, 40))
        d.text((452, 8), "APPLICATION", fill="black", font=police)
    else:
        d.text((452, 400), "(capture absente)", fill="red", font=police)
    chemin = os.path.join(sortie, f"{m}.png"); im.save(chemin); images.append(im)
for k in range(4):
    g = images[k * 5:(k + 1) * 5]
    out = Image.new("RGB", (g[0].width, sum(i.height for i in g) + 30 * (len(g) - 1)), "#9e9e9e"); y = 0
    for i in g: out.paste(i, (0, y)); y += i.height + 30
    out.save(os.path.join(sortie, f"planche-{k + 1}.png"), optimize=True)
print(f"✓ {len(PAIRES)} écrans comparés dans design/comparaison/")
