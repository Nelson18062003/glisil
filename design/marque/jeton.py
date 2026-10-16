# Le logo du JETON XAFe : un disque vert Glisil, un X blanc, et la pièce d'or de
# la comète au croisement. Rond, parce que les explorateurs et les wallets
# découpent les jetons en cercle ; lisible à 32 points, parce que c'est la taille
# où BscScan l'affiche. Aucune police : deux traits et deux cercles.
#   python3 design/marque/jeton.py design/marque/xafe
#   node design/marque/jeton-png.mjs design/marque/xafe        (les PNG, par Chromium)
import sys

VERT, OR, BLANC = "#0B6B3A", "#E8A33D", "#FFFFFF"
SORTIE = sys.argv[1]

def jeton(fond=True):
    """Le X : deux traits de 13 aux bouts ronds ; la pièce (r 10) au croisement,
    cernée de vert pour ne pas se fondre dans le blanc."""
    disque = f'<circle cx="50" cy="50" r="50" fill="{VERT}"/>' if fond else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">'
            f'{disque}'
            f'<g stroke="{BLANC}" stroke-width="13" stroke-linecap="round">'
            f'<line x1="31" y1="31" x2="69" y2="69"/><line x1="69" y1="31" x2="31" y2="69"/></g>'
            f'<circle cx="50" cy="50" r="13.5" fill="{VERT}"/>'
            f'<circle cx="50" cy="50" r="10" fill="{OR}"/>'
            f'</svg>\n')

open(f"{SORTIE}/xafe-jeton.svg", "w").write(jeton())
print("jeton écrit")
