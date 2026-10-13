# Les icônes de la coque, dessinées depuis la marque : un X blanc sur le vert.
#   python3 scripts/icones.py
from PIL import Image, ImageDraw

VERT = (11, 107, 58, 255)
BLANC = (255, 255, 255, 255)
RIEN = (0, 0, 0, 0)


def croix(taille, couleur, fond, epaisseur_rel=0.16, marge_rel=0.28):
    im = Image.new("RGBA", (taille, taille), fond)
    d = ImageDraw.Draw(im)
    m = taille * marge_rel
    e = taille * epaisseur_rel
    d.line([(m, m), (taille - m, taille - m)], fill=couleur, width=int(e))
    d.line([(taille - m, m), (m, taille - m)], fill=couleur, width=int(e))
    r = e / 2
    for (x, y) in [(m, m), (taille - m, taille - m), (taille - m, m), (m, taille - m)]:
        d.ellipse([x - r, y - r, x + r, y + r], fill=couleur)
    return im


def arrondi(im, rayon):
    masque = Image.new("L", im.size, 0)
    ImageDraw.Draw(masque).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], radius=rayon, fill=255)
    sortie = Image.new("RGBA", im.size, RIEN)
    sortie.paste(im, (0, 0), masque)
    return sortie


arrondi(croix(1024, BLANC, VERT), 220).save("assets/icon.png")
croix(1024, BLANC, RIEN, marge_rel=0.34).save("assets/android-icon-foreground.png")
Image.new("RGBA", (1024, 1024), VERT).save("assets/android-icon-background.png")
croix(1024, BLANC, RIEN, marge_rel=0.34).save("assets/android-icon-monochrome.png")
croix(512, BLANC, RIEN, marge_rel=0.22).save("assets/splash-icon.png")
arrondi(croix(96, BLANC, VERT), 20).save("assets/favicon.png")
print("icônes écrites dans assets/")
