# La bêta de Glisil

Glisil se teste en grand, avec de vraies personnes, **sans un franc réel en
jeu**. Ce document dit ce que la bêta est, ce qu'elle n'est pas, comment
l'équipe la pilote, et pourquoi rien d'elle ne passe en production.

## 1. Ce que voit un testeur

- À l'inscription, il reçoit de **l'argent de test** : 1 000 000 XAFe et
  2 000 USDT (réglable : Paramètres → « beta » → `dotation`). L'historique le
  dit (« Argent de test », référence `XAFe-BT-…`).
- Un **bandeau** en haut de l'accueil rappelle que tout est de l'argent de
  test, que les dépôts et retraits réels sont fermés, et que le marché est
  animé par des robots. Il porte un lien « Signaler un problème ».
- **Fermé pendant la bêta** : les dépôts Mobile Money réels, les sorties en
  XAF, les retraits crypto. L'écran le dit au lieu d'un formulaire.
- **Ouvert** : le marché USDT/XAFe (ordres limites, au marché, achat rapide),
  l'historique, les reçus, le compte, et « Signaler un problème ».

Pourquoi fermer les dépôts réels : un testeur qui paierait de vrais XAF
recevrait des XAFe qu'il ne pourrait pas ressortir (les sorties sont fermées).
Personne ne paie de vrai argent pour de l'argent de test. Un compte peut être
autorisé à payer en vrai (`comptes.argent_reel`), pour les essais de l'équipe.

## 2. Le marché vivant : quinze robots (migration 0023)

Un carnet vide ne se teste pas. Quinze comptes « robot » l'animent :

| Robot | Ce qu'il fait | Argent de test |
|---|---|---|
| Teneur de marché | Cote **en permanence**, cinq niveaux à l'achat, cinq à la vente, autour du vrai dollar. Écart ≈ 0,4 %. | 12 000 000 XAFe + 20 000 USDT |
| 14 traders | Chacun son humeur (acheteuse, vendeuse) ; achète et vend au hasard, au marché ou en ordres limites qu'il retire au bout de 20 minutes. | 400 000 XAFe + 700 USDT chacun |

- Ils passent par **les mêmes règles que tout le monde** (bande de prix,
  tailles, nombre d'ordres, file d'attente). Aucun passe-droit : un testeur
  qui pose un bon prix est servi par eux.
- Le prix **suit le vrai dollar** (section 3), avec une petite dérive qui
  revient d'elle-même vers lui, et de rares « nouvelles » qui la secouent
  (jusqu'à ±0,8 %, deux fois par jour en moyenne).
- Quand le teneur a trop d'USDT, il baisse ses prix pour en vendre (et
  inversement) : son stock reste équilibré, comme un vrai teneur de marché.
- Un tour toutes les **30 secondes** (pg_cron, tâche `glisil-robots`).
- **Les arrêter** : Bêta → interrupteur « Robots en marche ». Au tour suivant,
  ils retirent tous leurs ordres. Bêta éteinte : même chose.
- **Ménage** : chaque nuit, les ordres de robot jamais échangés de plus de deux
  jours s'effacent (avec leurs deux écritures, qui s'annulent). Rien d'un
  testeur, rien qui ait échangé, ne s'efface.
- **Si un robot n'a plus d'argent** (les testeurs ont tout acheté), il le dit
  dans la colonne « Dernier refus » de la page Bêta. Le recharger : Clients →
  filtre « Robots » → « Donner de l'argent de test ».

Les réglages fins (écart, nombre de niveaux, tailles, fréquence des traders,
volatilité) sont dans Paramètres → « robots ».

## 3. Le vrai dollar (migration 0022)

Le franc CFA est arrimé à l'euro : **1 EUR = 655,957 XAF**, fixe. Le prix du
dollar en XAF ne dépend donc que du cours EUR/USD :

    1 USD = 655,957 / (EUR/USD) XAF

Toutes les heures (tâche `glisil-cours`, à la 17ᵉ minute), la base relève le
cours de la **Banque centrale européenne** (via Frankfurter ; open.er-api.com
en secours) et le pose comme prix de référence du marché. Exemple du 16
octobre 2026 : EUR/USD = 1,1253, donc 1 USD = 582,92 XAF, donc **582,90 XAFe
pour 1 USDT**.

- **Prime** (Paramètres → « cours » → `prime`) : le marché local paie souvent
  le dollar plus cher que le cours officiel. `0.02` = 2 % au-dessus.
- **Garde-fou** : un relevé aberrant, ou qui s'écarte de plus de 5 % du
  dernier cours posé (`saut_max`), est **noté et refusé**. L'équipe vérifie
  sur le site de la BCE, puis Bêta → « Poser un cours ».
- La BCE ne publie pas le week-end : le cours du vendredi reste.

## 4. Ce que l'équipe observe : la page « Bêta »

- Testeurs (total, nouveaux, qui ont échangé, actifs sur 24 h).
- L'argent de test distribué (aux testeurs, aux robots).
- Les robots : dernier tour, milieu du teneur, dérive, solde et refus de
  chacun, échanges sur 24 h (entre robots / avec un testeur).
- Le vrai dollar : dernier cours, prix de référence posé, historique des
  relevés (et ceux refusés, avec leur raison).
- **Ce que les testeurs signalent** : le texte, l'écran d'où il vient,
  l'appareil. « Traiter » → une note, « vu » ou « réglé ». Vingt signalements
  par jour et par compte au plus.

## 5. L'argent de test et la parité

Les XAFe de test sont **frappés sur la chaîne d'essai** (BSC Testnet) comme
des XAFe ordinaires : le registre et la chaîne restent égaux, la parité le
vérifie toutes les cinq minutes. Mais aucun XAF n'est derrière : la parité
les compte **à part** (`xafe_de_test`), et les floats MoMo/OM ne couvrent que
le reste.

Le contrat d'essai plafonne la frappe à **50 000 000 XAFe par jour**. Les
robots en prennent 17,6 M une fois ; chaque inscrit 1 M. Au-delà de ~30
inscriptions le même jour, la frappe attend le lendemain (le registre reste
juste, la chaîne rattrape). Le plafond se relève avec la clé admin du contrat
(`fixerPlafondJour`).

## 6. Pourquoi rien de la bêta ne passe en production

La production est un **environnement neuf** : un autre projet Supabase, un
autre contrat XAFe sur le vrai réseau, une autre graine. Rien de la base de la
bêta ne la suit — ni les comptes, ni les soldes, ni les robots, ni l'argent
de test. Un testeur qui veut continuer crée son compte en production.

C'est voulu : l'argent de test ne doit jamais pouvoir devenir de l'argent
réel, même par erreur, même par une migration oubliée. La migration 0041 le
garantit sur la production (profil immuable, gardes, constat) et reste
**inerte ici** : la bêta garde ses robots, sa dotation et la démo de TOTEM.
La bêta continue de tourner à part, pour la démonstration de TOTEM ;
l'environnement « Preview » de Vercel pointe sur elle ; le boîtier TOTEM, lui,
passe à la production. Voir [PRODUCTION.md](PRODUCTION.md).
