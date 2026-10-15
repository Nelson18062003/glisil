# Les icônes de la coque, dessinées depuis la marque Glisil : la comète — une
# pièce d'or lancée en diagonale, sa traînée derrière elle. Même géométrie que
# le composant Marque (app/, admin/, design/maquettes/) : un carré de 100,
# la traînée et la pièce tournées de 35° vers le haut autour du centre, puis
# poussées de (3, -1).
#   python3 scripts/icones.py
import math

from PIL import Image, ImageDraw

VERT = (11, 107, 58, 255)
OR = (232, 163, 61, 255)
BLANC = (255, 255, 255, 255)
RIEN = (0, 0, 0, 0)
SUR = 4  # dessiné quatre fois plus grand, puis réduit : des bords lisses
ANGLE = -35  # comme rotate(-35 50 50) en SVG
# puis translate(3 -1) : entre le centre de la masse et celui du cadre, pour l'œil
DECALAGE = (3, -1)


def bezier(p0, p1, p2, p3, n=48):
    return [tuple((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d
                  for a, b, c, d in zip(p0, p1, p2, p3)) for t in (i / n for i in range(n + 1))]


def trainee():
    # M6 50 C28 46 44 36 60 34 · A16 16 0 0 1 60 66 · C44 64 28 54 6 50 Z
    haut = bezier((6, 50), (28, 46), (44, 36), (60, 34))
    tete = [(60 + 16 * math.cos(math.radians(a)), 50 + 16 * math.sin(math.radians(a))) for a in range(-90, 91, 3)]
    bas = bezier((60, 66), (44, 64), (28, 54), (6, 50))
    return haut + tete + bas


def tourner(p):
    a = math.radians(ANGLE)
    x, y = p[0] - 50, p[1] - 50
    return (50 + DECALAGE[0] + x * math.cos(a) - y * math.sin(a), 50 + DECALAGE[1] + x * math.sin(a) + y * math.cos(a))


def comete(taille, queue, piece, fond, echelle=1.0):
    """La comète dans un carré de `taille` ; `echelle` < 1 la resserre au centre (zone sûre d'Android)."""
    T = taille * SUR
    im = Image.new("RGBA", (T, T), fond)
    d = ImageDraw.Draw(im)
    k = T / 100 * echelle
    o = T / 2 - 50 * k
    pt = lambda p: (o + p[0] * k, o + p[1] * k)
    d.polygon([pt(tourner(p)) for p in trainee()], fill=queue)
    cx, cy = pt(tourner((62, 50)))
    r = 12.5 * k
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=piece)
    return im.resize((taille, taille), Image.LANCZOS)


def arrondi(im, rayon):
    masque = Image.new("L", im.size, 0)
    ImageDraw.Draw(masque).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], radius=rayon, fill=255)
    sortie = Image.new("RGBA", im.size, RIEN)
    sortie.paste(im, (0, 0), masque)
    return sortie


if __name__ == "__main__":
    arrondi(comete(1024, BLANC, OR, VERT, 0.86), 220).save("assets/icon.png")
    comete(1024, BLANC, OR, RIEN, 0.62).save("assets/android-icon-foreground.png")
    Image.new("RGBA", (1024, 1024), VERT).save("assets/android-icon-background.png")
    comete(1024, BLANC, BLANC, RIEN, 0.62).save("assets/android-icon-monochrome.png")
    comete(512, BLANC, OR, RIEN, 0.9).save("assets/splash-icon.png")
    arrondi(comete(96, BLANC, OR, VERT, 0.9), 20).save("assets/favicon.png")
    print("icônes écrites dans assets/")
