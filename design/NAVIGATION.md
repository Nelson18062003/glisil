# Glisil · la navigation

*Comment on entre dans chaque écran, comment on en sort, et ce qui relie les
écrans entre eux. C'est la règle que le code suit ; un écran qui n'est pas ici
n'existe pas.*

## 1. Les quatre maisons

L'application a **quatre onglets**, toujours visibles sur les écrans racines :
**Accueil · Marché · Historique · Compte**. Chaque onglet a sa propre pile
d'écrans. Les **parcours d'argent** (entrer, sortir, crypto) s'ouvrent
**par-dessus** les onglets, en plein écran, avec leur propre pile et une
sortie unique : ils se terminent toujours par un écran de fin qui ramène à un
onglet. On ne peut pas « se perdre » dans un parcours.

```
                 ┌──────────── Bienvenue ─────────────┐
                 │  numéro → code SMS → (nom + code)   │
                 └──────────────────┬──────────────────┘
                                    ▼
   ┌──────────┬────────────┬──────────────┬──────────┐
   │ Accueil  │  Marché    │  Historique  │  Compte  │   ← barre du bas
   └────┬─────┴─────┬──────┴──────┬───────┴────┬─────┘
        │           │             │            │
   parcours      graphique     détail      numéros, paliers,
   entrer /      carnet        d'une       sécurité, API, aide
   sortir /      ordres        opération
   crypto
```

## 2. Entrer dans l'application

| Situation | Ce qui s'ouvre | Ensuite |
|---|---|---|
| Première ouverture | **Bienvenue** (numéro) | code SMS → si nouveau compte : nom + choix du code secret → **Accueil** |
| Ouverture suivante | **Verrouillage** (code secret ou empreinte) | **Accueil** |
| Notification « XAFe crédités » | Verrouillage | **Détail de l'opération** (pile Historique) |
| Notification « ordre exécuté » | Verrouillage | **Mes ordres** (pile Marché) |
| Notification « sortie envoyée » | Verrouillage | **Détail de l'opération** |
| Lien de parrainage ou de dépôt | Bienvenue | puis l'écran visé une fois connecté |

Le bouton **retour d'Android** suit la pile de l'onglet. Sur la racine d'un
onglet secondaire, il ramène à **Accueil** ; sur Accueil, il ferme
l'application. Dans un parcours d'argent, il recule d'une étape ; sur la
première étape, il quitte le parcours sans rien créer.

## 3. Accueil

Ce qu'on y voit : le solde, trois tuiles, le prix. Rien d'autre.

| Geste | Va vers | Retour |
|---|---|---|
| Tuile **Entrer des XAF** | parcours Entrer, étape 1 | quitte le parcours |
| Tuile **Sortir des XAF** | parcours Sortir, étape 1 | quitte le parcours |
| Tuile **Crypto** | **Crypto** (menu à trois lignes) | Accueil |
| Carte du prix | onglet **Marché** | (changement d'onglet) |
| Avatar | onglet **Compte** | (changement d'onglet) |
| Cloche | **Notifications** (liste) | Accueil |
| Œil sur le solde | masque les montants, partout, jusqu'au prochain appui | — |
| Bandeau « Dépôt en attente » (s'il y en a un) | parcours Entrer, étape **Transaction ID**, reprise | Accueil |

## 4. Parcours « Entrer des XAF »

```
 1 Opérateur ─▶ 2 Payer ─▶ 3 Transaction ID ─▶ (crédit, ID par ID) ─▶ 4 Crédité ─▶ Accueil ou Marché
```

Le client **paie d'abord**, comme il sait le faire : un transfert depuis sa
puce ou sa flotte vers notre float, ou un retrait chez notre code agent. MTN
et Orange donnent toujours un **transaction ID** dans le SMS du payeur ; le
même ID est dans le SMS que TOTEM lit sur notre float. C'est cet ID qui
rapproche — pas une capture d'écran, pas un montant tapé d'avance.

- **1 Opérateur** : MTN MoMo, Orange Money, banque (bientôt). Flèche : Accueil.
- **2 Payer** : le numéro du float à payer (et le code agent quand il y en a
  un), les deux façons de payer, le plafond par transfert de l'opérateur et
  le plafond du palier. Le dossier du dépôt (`XAFe-DP-…`) est ouvert **en
  entrant** sur cet écran, et vaut 30 min. Flèche : étape 1 (si rien n'a été
  déclaré, le dossier se ferme). Bouton : « J'ai payé ».
- **3 Transaction ID** : un champ, « Ajouter ». Chaque ID déclaré apparaît
  dans une liste avec son état : *on cherche le SMS…*, puis **crédité** avec
  le montant lu dans le SMS (temps réel), ou *retenu* avec la raison (palier
  dépassé : l'équipe rembourse). Plusieurs transferts = plusieurs ID. Si TOTEM
  n'a pas encore lu le SMS, la déclaration attend et se crédite toute seule à
  son arrivée. Flèche : étape 2. Croix : quitte le parcours **sans rien
  perdre** ; les ID en attente restent visibles dans Historique et un bandeau
  sur l'Accueil permet d'y revenir. Bouton « Terminer » : étape 4 dès qu'un
  ID au moins est crédité.
- **4 Crédité** : le total crédité, l'heure, les ID. Deux sorties : « Aller au
  marché » ou « Retour à l'accueil ». Pas de flèche retour : un dépôt crédité
  ne se « défait » pas.

## 5. Parcours « Sortir des XAF »

```
 1 Montant ─▶ 2 Destination ─▶ 3 Vérifier ─▶ 4 Code ─▶ 5 Envoyé ─▶ Accueil
```

- **1 Montant** : pavé, « Disponible », « Tout ». Flèche : Accueil.
- **2 Destination** : les numéros vérifiés ; « Ajouter un numéro » ouvre le
  sous-parcours du Compte (le numéro ajouté n'est utilisable qu'après 24 h,
  l'écran le dit, et on revient ici). Flèche : étape 1.
- **3 Vérifier** : montant, frais, reçu, numéro, délai. Flèche : étape 2.
- **4 Code** : le code secret (ou l'empreinte). Trois erreurs : le compte se
  verrouille 15 min, l'écran le dit. Flèche : étape 3.
- **5 Envoyé** : « 497 500 XAF envoyés au 6 77 12 34 56 » dès que TOTEM a
  confirmé le transfert. Si TOTEM met plus de 60 s : « En cours » avec la
  même promesse que l'étape 4 du dépôt (l'écran bascule seul). Sortie unique :
  Accueil. Un échec définitif (numéro invalide, réseau mort après reprises)
  recrédite les XAFe et ouvre le **Détail** de l'opération, qui l'explique.

## 6. Marché

L'onglet **Marché** s'ouvre directement sur **l'écran de trading** (formulaire
+ carnet + ordres ouverts). Depuis lui :

| Geste | Va vers | Retour |
|---|---|---|
| Icône chandelier | **Graphique** | Trading |
| Nom de la paire | sélecteur de paire (feuille en bas ; une seule paire aujourd'hui) | ferme la feuille |
| Une ligne du carnet | remplit le **prix** du formulaire (pas de navigation) | — |
| « Tout voir » des ordres | **Mes ordres** | Trading |
| Une ligne d'ordre ouvert | **Détail de l'ordre** (exécutions, annuler) | Mes ordres ou Trading |
| Bouton **Acheter / Vendre** | feuille de confirmation en bas (prix, quantité, total, frais) → « Confirmer » | — |
| Confirmation d'un ordre **marché** ou d'une limite exécutée tout de suite | **Ordre exécuté** (plein écran) | « Retour au marché » ou « Voir mon portefeuille » |
| Confirmation d'une limite **posée** | un bandeau « Ordre placé » en bas, l'ordre apparaît dans la liste ; pas de navigation | — |

Depuis **Graphique** : onglet Transactions → **Carnet complet** ; Acheter /
Vendre → retour au Trading avec le côté présélectionné.

Depuis **Carnet complet** : une ligne → retour au Trading avec ce prix.

Le trading garde son état quand on change d'onglet et qu'on revient (côté,
type, prix, quantité tapés). Le carnet et le prix se mettent à jour en temps
réel sur tous ces écrans.

## 7. Crypto

```
 Crypto (menu) ─┬─▶ Déposer USDT : Réseau ─▶ Adresse + QR (fin ; crédit automatique, notification)
                ├─▶ Retirer USDT : Réseau ─▶ Adresse (scan ou coller) ─▶ Montant ─▶ Vérifier ─▶ Code ─▶ Envoyé
                └─▶ Retirer XAFe : Réseau ─▶ Adresse ─▶ Montant ─▶ Vérifier ─▶ Code ─▶ Envoyé
```

Mêmes règles que « Sortir des XAF » : flèche = étape précédente, écran de fin
à sortie unique, un échec ouvre le Détail. L'adresse de dépôt est **la même
à chaque fois** pour un réseau donné ; l'écran le dit.

## 8. Historique

- Racine : liste par jour, filtres (Tout, Entrées, Sorties, Ordres, Crypto).
  Une opération **en attente** ou **en cours** est toujours en tête, avec son
  état.
- Une ligne → **Détail** : l'opération, ses références, son reçu. Depuis le
  Détail : « Télécharger le reçu » (partage du PDF), « Reprendre » pour un
  dépôt en attente (ouvre l'étape Transaction ID), « Signaler un problème »
  (aide avec la référence).
- Un ordre → **Détail de l'ordre** (le même que dans Marché).

## 9. Compte

| Ligne | Va vers | Ce qu'on y fait |
|---|---|---|
| Mes numéros MoMo | liste → **Ajouter un numéro** : numéro → code SMS reçu **sur ce numéro** → « actif après 24 h » | retirer un numéro demande le code secret |
| Paliers et limites | **Paliers** : où j'en suis, ce que chaque palier permet → **Vérifier mon identité** (pièce + selfie) ou **Entreprise** (RCCM, bénéficiaires) | on dépose des photos ; l'état « en vérification » s'affiche ici et sur l'Accueil |
| Sécurité | changer le code, empreinte, appareils connectés, « déconnecter partout » | |
| Accès API | clés et webhooks (desks) | |
| Aide | questions fréquentes, WhatsApp, « signaler un problème » | |
| Se déconnecter | **Bienvenue** | la pile est vidée |

## 10. Ce qui est vrai sur tous les écrans

- **Hors ligne** : un bandeau en haut ; les soldes et le prix affichent
  l'heure de leur dernier relevé ; les boutons d'argent sont désactivés avec
  la raison.
- **Session expirée** : l'écran de verrouillage par-dessus l'écran courant ;
  après le code, on revient exactement où l'on était.
- **Une erreur** se dit dans une feuille en bas : ce qui s'est passé, ce que
  ça change pour l'argent, un bouton pour la suite. Jamais un message
  technique brut.
- **Un geste d'argent part une fois** : chaque bouton d'envoi se verrouille
  au premier appui et chaque demande porte une clé d'intention ; recommencer
  après une réponse perdue ne crée pas un second ordre.
- **Les montants se tapent et se lisent en tranches** (« 1 000 000 »),
  les prix avec deux décimales, les quantités d'USDT avec deux décimales.
- **Temps réel** : le prix, le carnet, les ordres et l'état d'un dépôt ou
  d'une sortie se mettent à jour sans recharger, par abonnement.

## 11. Les chemins (adresses des écrans)

```
/bienvenue  /bienvenue/code  /bienvenue/profil  /verrouillage
/           (Accueil)        /notifications
/entrer/operateur  /entrer/payer/:ref  /entrer/transaction/:ref  /entrer/credite/:ref
/sortir/montant  /sortir/destination  /sortir/verifier  /sortir/code  /sortir/envoye/:ref
/marche  /marche/graphique  /marche/carnet  /marche/ordres  /marche/ordres/:id  /marche/execute/:id
/crypto  /crypto/deposer/:actif  /crypto/retirer/:actif/{reseau,adresse,montant,verifier,code}  /crypto/envoye/:ref
/historique  /historique/:ref
/compte  /compte/numeros  /compte/numeros/ajouter  /compte/paliers  /compte/paliers/identite  /compte/paliers/entreprise
/compte/securite  /compte/api  /compte/aide
```
