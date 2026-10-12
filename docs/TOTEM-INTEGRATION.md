# TOTEM ↔ XAFe Exchange · le contrat

TOTEM est le boîtier qui porte les cartes SIM des floats (les numéros MoMo
que les clients paient) : il lit les SMS de l'opérateur et compose les
transferts USSD. XAFe Exchange ne parle jamais à MTN ni à Orange : il parle à
TOTEM. Ce document dit exactement ce qui passe, dans les deux sens.

## Deux sens, deux portes

```
  TOTEM ──(1) SMS d'argent reçu ─────────▶  totem-sms        ─▶ totem_sms_recu()
  TOTEM ◀─(2) transferts à composer ──────  totem-commandes  ◀─ commandes (en_attente)
  TOTEM ──(2') résultat du transfert ─────▶  totem-commandes  ─▶ totem_resultat_commande()
```

Chaque appel porte l'identifiant du terminal et une signature HMAC-SHA256
du corps avec la clé du terminal (`terminaux.cle_hash` en garde l'empreinte).
Un terminal ne voit que **ses** commandes et ne peut écrire que pour **ses**
cartes.

## (1) Un SMS d'argent reçu

TOTEM lit déjà chaque SMS, le décode (montant, numéro de l'expéditeur,
référence de l'opérateur, solde après) et le pousse dans sa propre base
(`paiements`). Pour XAFe, il pousse **la même ligne** vers la porte
`totem-sms`, avec les mêmes champs. Rien de nouveau à apprendre au robot : un
second destinataire dans `nuage.py`, même forme, même reprise hors ligne.

```json
POST /functions/v1/totem-sms
{
  "terminal": "akwa-1",
  "source_id": 48213,              // n° de ligne du journal du Pi : la clé d'unicité
  "operateur": "mtn",
  "float_numero": "677000000",     // la carte qui a reçu
  "sens": "entree",
  "montant": 1000000,
  "numero": "677123456",           // l'expéditeur, tel que le SMS le donne
  "tiers": "JEAN KAMDEM",
  "reference": "1234567890",       // référence de l'opérateur
  "texte": "Vous avez recu 1,000,000 FCFA de JEAN KAMDEM (677123456). Ref: 1234567890. ...",
  "emis_le": "2026-10-12T13:02:11Z",
  "recu_le": "2026-10-12T13:02:12Z"
}
```

Réponse : `{"resultat": "credite", "reference": "XAFe-DP-000418"}` ou
`{"resultat": "retenue", "id": 17}`. Le même `(terminal, source_id)` renvoyé
deux fois rend la même réponse et ne crédite pas deux fois.

Ce que la base en fait (`totem_sms_recu`) :

1. cherche un dépôt **en attente ou partiel** sur ce float, **du même numéro
   payeur**, dont il reste au moins ce montant à recevoir ; le plus ancien
   d'abord, et de préférence celui dont il reste exactement ce montant ;
2. s'il existe : crédite les XAFe **de ce SMS** tout de suite, note le
   paiement, et marque le dépôt « crédité » quand le total attendu est
   atteint ;
3. sinon : range le SMS dans `entrees_retenues`. Personne n'est crédité ;
   l'admin rapproche ou rembourse.

Un dépôt expiré depuis moins de deux heures est encore accepté : le client a
pu payer en retard.

## (2) Les transferts à composer

Une sortie XAFe → XAF crée une ou plusieurs lignes dans `commandes`, une par
transfert au plafond de l'opérateur (MTN : 1 000 000 par transfert). TOTEM
les relève exactement comme il relève sa propre table `commandes` :

```
GET  /functions/v1/totem-commandes?terminal=akwa-1          → les commandes en_attente de ce terminal
PATCH /functions/v1/totem-commandes/:id  {"etat": "en_cours"}   → la réclame (refusée si déjà prise)
PATCH /functions/v1/totem-commandes/:id  {"etat": "faite", "resultat": "...", "reference_operateur": "..."}
PATCH /functions/v1/totem-commandes/:id  {"etat": "echouee", "resultat": "réseau muet"}
```

Chaque commande porte `parametres` : `{"operateur": "mtn", "float_numero":
"677000000", "numero": "677123456", "montant": 746250}` et une **clé
d'intention** unique : un transfert composé deux fois enverrait l'argent deux
fois ; le robot ne compose que ce qu'il a réclamé, et la réclamation est un
`update … where etat = 'en_attente'` qui ne réussit qu'une fois.

Ce que la base en fait (`totem_resultat_commande`) :

- `faite` : les XAFe de ce transfert sont **détruits** (ils sont sortis en
  XAF), les frais vont au compte maison ; quand tous les transferts d'une
  sortie sont faits, la sortie est « envoyée » ;
- `echouee` : la commande repasse en attente, jusqu'à trois reprises ; à la
  troisième, elle est définitivement échouée et **les XAFe de ce transfert
  reviennent au client** (disponible). Une sortie dont une partie est passée
  est « partielle » : le client voit ce qui est parti et ce qui est revenu.

## Ce que TOTEM doit encore apprendre (côté robot)

- un second destinataire pour les SMS (`nuage.py` : même charge, autre URL,
  signature HMAC) ;
- un second guichet de commandes (`pilotage.py` : même boucle « relever,
  réclamer, composer, rendre compte ») ;
- le **numéro du float** dans chaque ligne poussée (TOTEM pousse aujourd'hui
  l'ICCID de la carte ; XAFe reconnaît un float par son numéro).

Rien ne change dans ce que TOTEM fait pour Bonzini : ce sont des destinations
en plus, pas des comportements en moins.
