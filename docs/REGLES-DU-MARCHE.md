# Le règlement du marché USDT/XAFe

Ce que le moteur fait respecter, écrit pour être lu. Le même texte, en plus
court, est dans l'application : Marché → « Règles du marché ».

Deux écritures indépendantes de ces règles existent et doivent tomber
d'accord : le **moteur** (SQL, `_placer_ordre`, migrations 0001 et 0017) et
le **moteur de référence** (Python, `moteur/differentiel/reference.py`). Voir
« Comment on le prouve », plus bas.

## 1. Comment un échange se fait

1. **Les fonds d'abord.** Un ordre limite bloque ses fonds à la pose : un
   achat bloque `prix × quantité` XAFe (au centime), une vente bloque sa
   quantité d'USDT. Annulé, il les rend.
2. **Priorité prix, puis temps.** Un ordre entrant rencontre le meilleur prix
   en face (la vente la moins chère pour un achat, l'achat le plus cher pour
   une vente) ; à prix égal, l'ordre arrivé le premier.
3. **Au prix de celui qui attendait.** L'échange se fait au prix de l'ordre
   déjà au carnet. Celui qui arrive ne paie jamais plus que sa limite (un
   achat à 620 qui trouve une vente à 618 paie 618, et récupère la
   différence bloquée).
4. **Partiel.** Un ordre peut être servi en plusieurs fois. Ce qui reste
   d'un ordre limite attend au carnet ; ce qui reste d'un ordre au marché est
   annulé.
5. **Pas d'achat à soi-même.** Un ordre qui rencontrerait l'un des ordres du
   même compte s'arrête là ; son reste est annulé et ses fonds rendus.
6. **Un par un.** Les ordres d'une paire passent l'un après l'autre (un verrou
   par paire) : deux ordres simultanés ne prennent jamais le même vendeur.
7. **Un ordre au marché d'achat** s'arrête à ce que le compte peut payer.

## 2. Les paramètres (modifiables par l'équipe : Paramètres → « marche »)

| Règle | Valeur de départ | Pourquoi |
|---|---|---|
| Pas de prix | 0,05 XAFe | des prix comparables |
| Taille d'un ordre | 10 – 1 000 000 USDT | ni poussière, ni ordre démesuré |
| Ordre au marché, au plus | 100 000 USDT | au-delà, un ordre limite (on fixe le prix) |
| Ordres ouverts par compte | 200 | un carnet qui ne s'encombre pas |
| Bande d'un achat limite | 80 % – 110 % de la référence | une faute de frappe n'achète pas à n'importe quel prix |
| Bande d'une vente limite | 90 % – 120 % de la référence | une faute de frappe ne vend pas à 10 XAFe |
| Protection au marché | ± 5 % de la référence | un ordre au marché n'est jamais servi plus loin ; le reste est annulé |
| Frais | 0,05 % (attendait) · 0,10 % (prenait) | l'acheteur en USDT, le vendeur en XAFe |

**Le prix de référence** est la moyenne pondérée des échanges des cinq
dernières minutes, sinon le dernier échange, sinon le prix posé par l'équipe
(`prix_reference`), sinon aucun : le premier ordre fait le marché, sans bande.
Une moyenne, et pas le seul dernier échange, pour qu'un échange minuscule au
bord de la bande ne la déplace pas de 20 % d'un coup.

Les valeurs de départ vivent dans le moteur (`_marche()`) : un paramètre
réécrit en entier par l'équipe ne fait jamais disparaître un garde-fou.

## 3. Le carnet vide (le marché qui démarre)

Sans vendeurs, personne n'achète ; sans prix, pas de bande. Le plan :

1. **Poser un prix de référence** (Paramètres → `marche.prix_reference`),
   par exemple le cours USDT/XAF du jour. L'écran pré-remplit alors les
   ordres avec lui, et la bande protège dès le premier ordre.
2. **Un teneur de marché maison** (à décider : il engage de l'argent de
   Glisil) : un compte de la plateforme qui affiche en permanence un achat et
   une vente autour de la référence, avec un écart et un plafond. C'est ainsi
   que démarrent les petites bourses. Il passe par les mêmes règles que tout
   le monde — aucun passe-droit dans le moteur.
3. **L'achat rapide** reste le chemin simple pour le client : il prend au
   carnet, avec une marge, quand le carnet a des offres.

## 4. Comment on le prouve

- **Les scénarios** (`moteur/scenarios.sql`, 11.39 entre autres) : chaque
  règle refuse avec sa phrase et sa borne.
- **Le hasard** (`moteur/hasard.sql`) : des milliers de gestes, et après
  chacun sept règles qui ne cassent jamais (soldes = circulation, aucun
  négatif, un bloqué exactement justifié…).
- **Le test différentiel** (`moteur/differentiel/`) : 3 graines × 1 500
  ordres au hasard, joués par le vrai moteur et rejoués par le moteur de
  référence ; chaque réponse, chaque échange, chaque solde, au centime, doit
  être identique. Deux témoins faussés exprès (le prix du preneur au lieu de
  celui qui attendait ; le dernier arrivé d'abord) doivent diverger — sinon
  le comparateur ne mesure rien.
- **Les courses** (`moteur/courses.sh`) : des ordres envoyés en même temps.

`sh moteur/verifier-le-moteur.sh` joue tout cela.

## 5. Ce qui n'existe pas encore (Binance l'a)

Ordres stop, stop-limite, OCO, TWAP, ordres échelonnés ; durée de vie
d'un ordre (IOC, FOK) ; « post-only ». Chacun se décrira ici avant d'entrer
dans le moteur, et dans le moteur de référence en même temps.
