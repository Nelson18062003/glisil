# Les icônes de la coque, dessinées depuis la marque Glisil : un G blanc sur le
# vert, d'un seul trait, dont la barre file vers la droite — ce qui glisse.
# (Le X blanc sur le vert reste le jeton XAFe, dans l'application.)
#   python3 scripts/icones.py
import math

from PIL import Image, ImageDraw

VERT = (11, 107, 58, 255)
BLANC = (255, 255, 255, 255)
RIEN = (0, 0, 0, 0)
SUR = 4  # dessiné quatre fois plus grand, puis réduit : des bords lisses


def g(taille, couleur, fond, marge_rel=0.22, epaisseur_rel=0.11):
    T = taille * SUR
    im = Image.new("RGBA", (T, T), fond)
    d = ImageDraw.Draw(im)
    e = T * epaisseur_rel
    c = T / 2
    r = T / 2 - T * marge_rel  # rayon extérieur de l'arc
    rm = r - e / 2              # rayon au milieu du trait
    # l'arc du G : de 3 h, par le bas, la gauche et le haut, jusqu’à midi passé ;
    # ouvert en haut à droite
    d.arc([c - r, c - r, c + r, c + r], start=0, end=298, fill=couleur, width=int(e))
    bouts = [(c + rm, c), (c + rm * math.cos(math.radians(62)), c - rm * math.sin(math.radians(62)))]
    # la barre : du centre, elle file jusqu'au bord du cercle
    d.rectangle([c, c - e, c + r, c], fill=couleur)
    for (x, y) in bouts[1:] + [(c, c - e / 2)]:
        d.ellipse([x - e / 2, y - e / 2, x + e / 2, y + e / 2], fill=couleur)
    return im.resize((taille, taille), Image.LANCZOS)


def arrondi(im, rayon):
    masque = Image.new("L", im.size, 0)
    ImageDraw.Draw(masque).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], radius=rayon, fill=255)
    sortie = Image.new("RGBA", im.size, RIEN)
    sortie.paste(im, (0, 0), masque)
    return sortie


if __name__ == "__main__":
    arrondi(g(1024, BLANC, VERT), 220).save("assets/icon.png")
    g(1024, BLANC, RIEN, marge_rel=0.30).save("assets/android-icon-foreground.png")
    Image.new("RGBA", (1024, 1024), VERT).save("assets/android-icon-background.png")
    g(1024, BLANC, RIEN, marge_rel=0.30).save("assets/android-icon-monochrome.png")
    g(512, BLANC, RIEN, marge_rel=0.18).save("assets/splash-icon.png")
    arrondi(g(96, BLANC, VERT), 20).save("assets/favicon.png")
    print("icônes écrites dans assets/")
