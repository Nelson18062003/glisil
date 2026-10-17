# -*- coding: utf-8 -*-
"""LE MOTEUR DE RÉFÉRENCE — le règlement du marché (docs/REGLES-DU-MARCHE.md),
écrit une seconde fois, autrement : en Python, en mémoire, avec des listes au
lieu de requêtes et de verrous. Il ne partage RIEN avec le vrai moteur (le
SQL de _placer_ordre) que le règlement lui-même.

Le test différentiel (differentiel.py) donne aux deux le même flux d'ordres
tirés au hasard et exige les mêmes réponses, les mêmes échanges, les mêmes
soldes, au centime. Deux écritures indépendantes qui tombent d'accord sur des
milliers d'ordres : c'est là qu'une erreur de l'une se voit.

Les montants sont des Decimal, arrondis comme PostgreSQL les arrondit
(au plus proche, la moitié en s'éloignant de zéro).
"""
import copy
from dataclasses import dataclass, field
from decimal import ROUND_CEILING, ROUND_DOWN, ROUND_FLOOR, ROUND_HALF_UP, Decimal as D

CENTIME = D("0.01")


def r2(x):
    return x.quantize(CENTIME, ROUND_HALF_UP)


def r0(x):
    return x.quantize(D("1"), ROUND_HALF_UP)


def t2(x):
    return x.quantize(CENTIME, ROUND_DOWN)


class Refus(Exception):
    """Un ordre refusé par une règle : la phrase est celle que voit le client."""


@dataclass
class Ordre:
    seq: int
    compte: int
    cote: str
    type: str
    prix: D | None
    quantite: D
    rang: int
    restant: D = D(0)
    executee: D = D(0)
    total_xafe: D = D(0)
    bloque: D = D(0)
    etat: str = "ouvert"


@dataclass
class Moteur:
    regles: dict
    frais: dict
    soldes: dict          # compte -> {"XAFe": [dispo, bloque], "USDT": [...]}
    temoin: str | None = None
    ordres: dict = field(default_factory=dict)       # seq -> Ordre
    executions: list = field(default_factory=list)
    maison: dict = field(default_factory=lambda: {"XAFe": D(0), "USDT": D(0)})
    rang: int = 0

    # ---- les règles, lues une fois ----
    def regle(self, cle):
        return self.regles.get(cle)

    def reference(self):
        """La moyenne pondérée des échanges récents (tous le sont, ici : le flux
        tient dans une minute), sinon celle que l'équipe a posée, sinon aucune."""
        if self.executions:
            q = sum(e["quantite"] for e in self.executions)
            return r2(sum(e["xafe"] for e in self.executions) / q)
        ref = self.regle("prix_reference")
        return D(str(ref)) if ref is not None else None

    def dans_la_bande_d_execution(self, cote, prix, ref):
        if ref is None:
            return True
        e = D(str(self.regle("bande_execution")))
        return prix <= ref * (1 + e) if cote == "achat" else prix >= ref * (1 - e)

    # ---- les soldes ----
    def mouvement(self, compte, actif, dispo, bloque):
        s = self.soldes[compte][actif]
        if s[0] + dispo < 0 or s[1] + bloque < 0:
            raise Refus("solde insuffisant")
        s[0] += dispo
        s[1] += bloque

    # ---- poser un ordre ----
    def placer(self, seq, compte, cote, type_, prix, quantite):
        avant = copy.deepcopy((self.soldes, self.ordres, self.executions, self.maison, self.rang))
        try:
            return self._placer(seq, compte, cote, type_, prix, quantite)
        except Refus:
            # tout ou rien : un ordre refusé ne laisse aucune trace
            self.soldes, self.ordres, self.executions, self.maison, self.rang = avant
            raise

    def _placer(self, seq, compte, cote, type_, prix, quantite):
        pas = D(str(self.regle("pas_prix")))
        qmin = D(str(self.regle("quantite_min")))
        if quantite is None or quantite < qmin or quantite != r2(quantite):
            raise Refus("quantité invalide")
        if type_ == "limite":
            if prix is None or prix <= 0 or prix % pas != 0:
                raise Refus("prix invalide")
        else:
            prix = None
        if quantite > D(str(self.regle("quantite_max"))):
            raise Refus("quantité trop grande")
        if type_ == "marche" and quantite > D(str(self.regle("marche_quantite_max"))):
            raise Refus("ordre au marché trop grand")
        ref = self.reference()
        if type_ == "limite" and ref is not None:
            bas, haut = (D(str(x)) for x in self.regle("bande_achat" if cote == "achat" else "bande_vente"))
            lo = (ref * bas / pas).to_integral_value(ROUND_CEILING) * pas
            hi = (ref * haut / pas).to_integral_value(ROUND_FLOOR) * pas
            if prix < lo or prix > hi:
                raise Refus("prix hors de la bande")
        if type_ == "limite":
            ouverts = sum(1 for o in self.ordres.values() if o.compte == compte and o.etat in ("ouvert", "partiel"))
            if ouverts >= int(self.regle("ordres_ouverts_max")):
                raise Refus("trop d'ordres ouverts")

        self.rang += 1
        o = Ordre(seq, compte, cote, type_, prix, quantite, self.rang, restant=quantite)
        self.ordres[seq] = o
        # bloquer d'abord : ce qui est au carnet est déjà déposé
        if type_ == "limite":
            if cote == "achat":
                o.bloque = r2(prix * quantite)
                self.mouvement(compte, "XAFe", -o.bloque, o.bloque)
            else:
                o.bloque = quantite
                self.mouvement(compte, "USDT", -quantite, quantite)

        t_pren = D(str(self.frais["preneur"]))
        t_plac = D(str(self.frais["placeur"]))
        frais_usdt = frais_xafe = D(0)
        auto = False
        while o.restant > 0:
            c = self.meilleur_en_face(o)
            if c is None:
                break
            if c.compte == compte:
                auto = True
                break
            if type_ == "marche" and not self.dans_la_bande_d_execution(cote, c.prix, ref):
                break
            q = min(o.restant, c.restant)
            px = c.prix
            if self.temoin == "prix-du-preneur" and type_ == "limite":
                px = prix          # LE TÉMOIN : il exécute au prix de celui qui arrive
            if type_ == "marche" and cote == "achat":
                dispo = self.soldes[compte]["XAFe"][0]
                if dispo < r2(q * px):
                    q = t2(dispo / px)
                if q <= 0:
                    break
            cible = None
            if cote == "achat" and type_ == "limite":
                cible = D(0) if o.restant - q == 0 else r2((o.restant - q) * prix)
                xafe = o.bloque - cible if px == prix else min(r2(q * px), o.bloque - cible)
            elif cote == "vente":
                cible = D(0) if c.restant - q == 0 else r2((c.restant - q) * c.prix)
                xafe = c.bloque - cible
            else:
                xafe = r2(q * px)
            if cote == "achat":
                acheteur, vendeur = compte, c.compte
                fa, fv = r2(q * t_pren), r0(xafe * t_plac)
            else:
                acheteur, vendeur = c.compte, compte
                fa, fv = r2(q * t_plac), r0(xafe * t_pren)
            # l'acheteur paie (de son bloqué s'il est limite) et reçoit ses USDT moins ses frais
            if (cote == "achat" and type_ == "limite") or cote == "vente":
                self.mouvement(acheteur, "XAFe", D(0), -xafe)
            else:
                self.mouvement(acheteur, "XAFe", -xafe, D(0))
            self.mouvement(acheteur, "USDT", q - fa, D(0))
            # le vendeur donne (de son bloqué s'il est limite) et reçoit ses XAFe moins ses frais
            if (cote == "vente" and type_ == "limite") or cote == "achat":
                self.mouvement(vendeur, "USDT", D(0), -q)
            else:
                self.mouvement(vendeur, "USDT", -q, D(0))
            self.mouvement(vendeur, "XAFe", xafe - fv, D(0))
            frais_usdt += fa
            frais_xafe += fv
            if cote == "achat" and type_ == "limite":
                rendu = o.bloque - cible - xafe
                if rendu > 0:
                    self.mouvement(compte, "XAFe", rendu, -rendu)
                o.bloque = cible
            elif type_ == "limite":
                o.bloque -= q
            o.restant -= q
            o.executee += q
            o.total_xafe += xafe
            o.etat = "execute" if o.restant == 0 else "partiel"
            c.restant -= q
            c.executee += q
            c.total_xafe += xafe
            c.bloque = cible if c.cote == "achat" else c.bloque - q
            c.etat = "execute" if c.restant == 0 else "partiel"
            self.executions.append({
                "achat": o.seq if cote == "achat" else c.seq, "vente": c.seq if cote == "achat" else o.seq,
                "preneur": cote, "prix": px, "quantite": q, "xafe": xafe, "frais_acheteur": fa, "frais_vendeur": fv})
        self.maison["USDT"] += frais_usdt
        self.maison["XAFe"] += frais_xafe
        if o.restant > 0 and (type_ == "marche" or auto):
            if type_ == "limite" and o.bloque > 0:
                actif = "XAFe" if cote == "achat" else "USDT"
                self.mouvement(compte, actif, o.bloque, -o.bloque)
            o.etat = "execute" if o.executee > 0 else "annule"
            o.restant = D(0)
            o.bloque = D(0)
        return o

    def meilleur_en_face(self, o):
        """Le meilleur prix d'abord, puis le premier arrivé."""
        en_face = [c for c in self.ordres.values()
                   if c.cote != o.cote and c.etat in ("ouvert", "partiel") and c.seq != o.seq]
        if o.type == "limite":
            en_face = [c for c in en_face if (c.prix <= o.prix if o.cote == "achat" else c.prix >= o.prix)]
        if not en_face:
            return None
        if self.temoin == "dernier-arrive":
            # LE TÉMOIN : à prix égal, le DERNIER arrivé passe d'abord
            return min(en_face, key=lambda c: (c.prix if o.cote == "achat" else -c.prix, -c.rang))
        return min(en_face, key=lambda c: (c.prix if o.cote == "achat" else -c.prix, c.rang))

    # ---- annuler ----
    def annuler(self, compte, cible):
        o = self.ordres.get(cible)
        if o is None or o.compte != compte:
            raise Refus("ordre inconnu")
        if o.etat not in ("ouvert", "partiel"):
            raise Refus("cet ordre ne peut plus être annulé")
        if o.bloque > 0:
            self.mouvement(compte, "XAFe" if o.cote == "achat" else "USDT", o.bloque, -o.bloque)
        o.etat, o.restant, o.bloque = "annule", D(0), D(0)
