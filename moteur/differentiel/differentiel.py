# -*- coding: utf-8 -*-
"""LE TEST DIFFÉRENTIEL : le vrai moteur et le moteur de référence, sur le
même flux d'ordres tirés au hasard, doivent tomber d'accord sur TOUT :

  · chaque réponse (accepté, ou la même phrase de refus) ;
  · chaque échange, dans l'ordre : qui achète à qui, qui prenait, à quel prix,
    combien, combien de XAFe, quels frais ;
  · l'état final de chaque ordre (restant, exécuté, bloqué) ;
  · les soldes de chaque compte et de la maison, au centime.

Il porte ses TÉMOINS : la référence faussée exprès (le prix du preneur au lieu
de celui qui attendait ; le dernier arrivé avant le premier) doit DIVERGER. Un
comparateur qui ne voit pas ces deux fautes-là ne mesurerait rien.

    python3 differentiel.py flux.json            # vérifier
    python3 differentiel.py flux.json --temoins  # vérifier, et exiger que les témoins divergent
"""
import json
import sys
from decimal import Decimal as D

from reference import Moteur, Refus


def dec(x):
    return None if x is None else D(str(x))


def rejouer(flux, temoin=None):
    soldes = {i + 1: {"XAFe": [dec(x), D(0)], "USDT": [dec(u), D(0)]}
              for i, (x, u) in enumerate(zip(flux["depart"]["xafe"], flux["depart"]["usdt"]))}
    m = Moteur(flux["regles"], flux["frais"], soldes, temoin=temoin)
    reponses = []
    for g in flux["flux"]:
        try:
            if g["action"] == "placer":
                m.placer(g["seq"], g["compte"], g["cote"], g["type"], dec(g["prix"]), dec(g["quantite"]))
            else:
                m.annuler(g["compte"], g["cible"])
            reponses.append((g["seq"], True, None))
        except Refus as e:
            reponses.append((g["seq"], False, str(e)))
    return m, reponses


def comparer(flux, m, reponses):
    """Les écarts, en clair ; une liste vide si les deux moteurs tombent d'accord."""
    ecarts = []
    for g, (seq, ok, err) in zip(flux["flux"], reponses):
        if g["ok"] != ok or (not ok and g["erreur"] != err):
            ecarts.append(f"geste {seq} ({g['action']} {g.get('cote') or ''} {g.get('type') or ''} {g.get('prix')} × {g.get('quantite')}) : "
                          f"moteur {'accepté' if g['ok'] else repr(g['erreur'])}, référence {'accepté' if ok else repr(err)}")
            if len(ecarts) > 5:
                return ecarts
    vrais = flux["executions"]
    if len(vrais) != len(m.executions):
        ecarts.append(f"{len(vrais)} échanges au moteur, {len(m.executions)} à la référence")
    for i, (a, b) in enumerate(zip(vrais, m.executions)):
        diff = [k for k in ("achat", "vente", "preneur", "prix", "quantite", "xafe", "frais_acheteur", "frais_vendeur")
                if (dec(a[k]) if k not in ("achat", "vente", "preneur") else a[k]) != b[k]]
        if diff:
            ecarts.append(f"échange n° {i + 1} : {', '.join(f'{k} {a[k]} ≠ {b[k]}' for k in diff)}")
            break
    for o in flux["ordres"]:
        r = m.ordres.get(o["seq"])
        if r is None:
            ecarts.append(f"l'ordre du geste {o['seq']} n'existe pas à la référence")
            break
        for k in ("etat", "restant", "executee", "bloque", "total_xafe"):
            v = o[k] if k == "etat" else dec(o[k])
            if v != getattr(r, k):
                ecarts.append(f"ordre du geste {o['seq']} : {k} {o[k]} au moteur, {getattr(r, k)} à la référence")
                break
    for s in flux["soldes"]:
        for actif, cle in (("XAFe", "xafe"), ("USDT", "usdt")):
            vrai = [dec(x) for x in s[cle]]
            if vrai != m.soldes[s["compte"]][actif]:
                ecarts.append(f"compte {s['compte']} {actif} : {vrai} au moteur, {m.soldes[s['compte']][actif]} à la référence")
    for actif, cle in (("XAFe", "xafe"), ("USDT", "usdt")):
        if dec(flux["maison"][cle] or 0) != m.maison[actif]:
            ecarts.append(f"maison {actif} : {flux['maison'][cle]} au moteur, {m.maison[actif]} à la référence")
    return ecarts


def main():
    flux = json.load(open(sys.argv[1]))
    m, reponses = rejouer(flux)
    ecarts = comparer(flux, m, reponses)
    refus = {}
    for _, ok, err in reponses:
        if not ok:
            refus[err] = refus.get(err, 0) + 1
    if ecarts:
        print("✗ le moteur et la référence divergent :")
        for e in ecarts[:8]:
            print(f"    {e}")
        sys.exit(1)
    acceptes = sum(1 for _, ok, _ in reponses if ok)
    print(f"  {len(reponses)} gestes, {acceptes} acceptés, {len(m.executions)} échanges — identiques au centime ; "
          f"refus : {', '.join(f'{k} {v}' for k, v in sorted(refus.items()))}")
    if "--temoins" in sys.argv:
        for t in ("prix-du-preneur", "dernier-arrive"):
            mt, rt = rejouer(flux, temoin=t)
            if not comparer(flux, mt, rt):
                print(f"✗ LE TÉMOIN « {t} » PASSE : le comparateur ne voit pas cette faute, il ne mesure rien")
                sys.exit(1)
        print("  témoins pris : le prix du preneur et le dernier arrivé d'abord divergent bien")


if __name__ == "__main__":
    main()
