# Les fichiers du logo Glisil : la comète (symbole, icône) et le nom « glisil »
# en Sora 700 VECTORISÉ (aucune police à charger), seuls et assemblés.
#   pip install fonttools ; télécharger Sora Bold (Google Fonts, licence OFL)
#   python3 design/marque/logos.py Sora-Bold.ttf design/marque
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

VERT, OR, ENCRE, BLANC = "#0B6B3A", "#E8A33D", "#191C1A", "#FFFFFF"
POLICE, SORTIE = sys.argv[1], sys.argv[2]
TRAINEE = "M6 50 C 28 46 44 36 60 34 A16 16 0 0 1 60 66 C 44 64 28 54 6 50 Z"

f = TTFont(POLICE); gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f["head"].unitsPerEm
track = -0.04 * upm

def mot(texte="glisil"):
    """Le chemin du mot, en unités de la police, y vers le bas, origine à la ligne de base."""
    x, chemins, bornes = 0, [], [1e9, 1e9, -1e9, -1e9]
    for c in texte:
        g = gs[cmap[ord(c)]]
        pen = SVGPathPen(gs)
        g.draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
        bp = BoundsPen(gs); g.draw(TransformPen(bp, (1, 0, 0, -1, x, 0)))
        if bp.bounds:
            b = bp.bounds; bornes = [min(bornes[0], b[0]), min(bornes[1], b[1]), max(bornes[2], b[2]), max(bornes[3], b[3])]
        chemins.append(pen.getCommands()); x += g.width + track
    return " ".join(chemins), bornes

def comete(queue, x, y, taille):
    k = taille / 100
    return (f'<g transform="translate({x:.2f} {y:.2f}) scale({k:.4f}) translate(3 -1) rotate(-35 50 50)">'
            f'<path d="{TRAINEE}" fill="{queue}"/><circle cx="62" cy="50" r="12.5" fill="{OR}"/></g>')

def svg(w, h, corps):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" width="{w:.0f}" height="{h:.0f}">{corps}</svg>\n'

d, (x0, y0, x1, y1) = mot()
H = 100  # hauteur du mot (du haut du l au bas du g) ramenée à 100
k = H / (y1 - y0); lm, hm = (x1 - x0) * k, H
chemin = lambda couleur, ox, oy: f'<path transform="translate({ox:.2f} {oy:.2f}) scale({k:.5f}) translate({-x0:.1f} {-y0:.1f})" d="{d}" fill="{couleur}"/>'

ecrire = lambda nom, txt: open(f"{SORTIE}/{nom}", "w").write(txt)
ecrire("glisil-icone.svg", svg(100, 100, f'<rect width="100" height="100" rx="22" fill="{VERT}"/>' + comete(BLANC, 7, 7, 86)))
ecrire("glisil-symbole.svg", svg(100, 100, comete(VERT, 0, 0, 100)))
ecrire("glisil-symbole-blanc.svg", svg(100, 100, comete(BLANC, 0, 0, 100)))
ecrire("glisil-nom.svg", svg(lm, hm, chemin(ENCRE, 0, 0)))
ecrire("glisil-nom-blanc.svg", svg(lm, hm, chemin(BLANC, 0, 0)))
# Le logo : le symbole, haut comme le mot, puis le mot. La comète remplit ~ 0,48 à 0,76 de son carré :
# un carré de 1,25 H, posé 0,15 H plus haut que le haut du mot, l'aligne à l'œil.
# La comète occupe à peu près x = 0,15 à 0,78 de son carré : on rogne la marge de
# gauche et on rapproche le mot de la pièce.
S = 1.25 * H
gauche, gap = 0.14 * S, -0.12 * H
logo = lambda queue, encre: svg(S - gauche + gap + lm, S, comete(queue, -gauche, 0, S) + chemin(encre, S - gauche + gap, (S - H) / 2 + 0.04 * H))
ecrire("glisil-logo.svg", logo(VERT, ENCRE))
ecrire("glisil-logo-blanc.svg", logo(BLANC, BLANC))
print("logos écrits", round(lm), round(hm))
