# XAFe · le jeton

Le franc CFA sur BNB Smart Chain (BEP20), puis Tron (TRC20). 1 XAFe = 1 XAF.

Un XAFe n'existe sur la chaîne que lorsqu'un client sort ses XAFe de la
plateforme vers son propre wallet : la plateforme le **frappe** alors, avec la
référence du retrait (`XAFe-CR-000012`), et une référence ne frappe qu'une
fois. Quand des XAFe reviennent — envoyés à l'adresse de dépôt du client —,
la plateforme les **détruit** et recrédite le compte. La circulation sur la
chaîne est une part des XAFe de la plateforme, couverts un pour un par les
floats MoMo et les comptes en banque (`emissions` dans le moteur).

```sh
npm install
npm test                 # onze épreuves : référence unique, plafond du jour, rôles, pause, gel, reprise
slither . --filter-paths node_modules   # l'analyse statique (0 constat)
sh echidna/eprouver.sh   # 100 000 appels au hasard, six promesses (TEMOIN=1 : un jeton sans plafond doit y tomber)
cp .env.example .env     # CLE_PRIVEE, RPC, CLE_BSCSCAN
PLAFOND_JOUR_XAF=50000000 npm run deployer:testnet   # le plafond de frappe par jour, en XAF
```

| Rôle | Qui | Pouvoir |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | un wallet matériel du propriétaire — et lui seul | donner et retirer les rôles, `fixerPlafondJour`, `inscrireAdressesDeDepot`, `detruireFondsGeles`. Il ne reçoit AUCUN autre rôle à la naissance, et se transmet en deux temps (`beginDefaultAdminTransfer`, deux jours, `acceptDefaultAdminTransfer`) |
| `FRAPPEUR_ROLE` | le signataire de la plateforme (veilleur de chaîne) | `frapper(vers, montant, empreinte)`, jamais au-delà du plafond du jour |
| `DESTRUCTEUR_ROLE` | idem | `detruireDepot(adresse, montant, empreinte)` sur une adresse de dépôt inscrite ; `detruire` sur son propre solde. Chaque destruction porte une empreinte non vide, utilisée une seule fois (`destructionReferencee`) |
| `GELEUR_ROLE` | conformité | `geler(adresse, motif)`, `degeler`. Une adresse gelée n'envoie, ne reçoit, ni ne dépense les autorisations qu'on lui a données ; l'adresse zéro ne se gèle pas |
| `PAUSEUR_ROLE` | astreinte | `pauser()`, `reprendre()` |

Le déploiement exige `ADMIN` hors réseau local : la clé chaude qui déploie
n'administre jamais. Chaque rôle opérationnel se donne ensuite DEPUIS le
wallet admin.

**Le lien avec le moteur** (ce que le veilleur de chaîne doit faire, au
centime) :

- une **sortie vers la chaîne** (`retraits_crypto`, actif `XAFe`) se frappe
  avec `montant × 1 000 000` unités et `empreinte = keccak256(utf8(référence))`
  — par exemple `keccak256("XAFe-CR-000012")` ; une empreinte ne frappe qu'une
  fois. Le moteur rend compte par `chaine_resultat_retrait(référence, ok,
  tx_hash)`, et compte ces XAFe en `circulation_chaine()` ;
- un **retour** arrive sur l'adresse de dépôt du client (`adresses_crypto`,
  inscrite d'avance par lots avec `inscrireAdressesDeDepot`). Le veilleur
  appelle `crediter_crypto(compte, 'XAFe', réseau, montant, tx_hash, adresse)`
  puis `detruireDepot(adresse, montant × 1 000 000, keccak256(tx_hash))` : la
  même empreinte se rapproche ligne à ligne.

**Une clé de frappe vit sur un serveur : elle peut être volée.** Un
FRAPPEUR compromis ne frappe donc pas plus que `plafondJour` par jour (toutes
frappes confondues), et seul l'ADMIN — une autre clé, hors ligne — relève le
plafond. Ce qui a été frappé à tort se reprend : `geler` l'adresse (un geste
qui se voit), puis `detruireFondsGeles(adresse, empreinte)`.

Il n'y a plus de `rendre` : un client brûlait ses XAFe contre une
« empreinte de compte » que le moteur ne sait pas lire — l'argent était
détruit sans recrédit possible. Un XAFe revient en l'envoyant à son adresse
de dépôt.

Repris du contrat cXAF de 2025 (`Nelson18062003/cxaf-token`), réécrit en
français, avec le gel d'adresse en plus et une erreur de syntaxe en moins.

## Le logo et la fiche du jeton

**Le logo n'est pas dans le contrat.** Un ERC-20 ou un TRC-20 ne porte que son
nom, son symbole et ses décimales. Les explorateurs et les wallets gardent
chacun leur propre registre de logos, rempli à la demande de l'émetteur. Tant
que personne ne le demande, ils affichent une pastille grise et « unknown
token ».

Les fichiers sont produits par `design/marque/jeton.py` et
`design/marque/jeton-png.mjs` (dans `design/marque/xafe/`). Ils sont publiés,
avec la fiche `xafe.json` (description, site, e-mail, adresses des contrats),
sous `https://app.glisil.com/xafe/`. Les registres demandent un lien public :
c'est celui-là.

| Où | Ce qu'il faut | Le fichier |
|---|---|---|
| **BscScan** | 1. code source vérifié ; 2. propriété de l'adresse prouvée (signature depuis le wallet admin) ; 3. formulaire « Token Update » ; e-mail à `@glisil.com`, site en ligne qui explique le jeton ; gratuit | `xafe-jeton.svg` (32×32) ou `xafe-64.png` |
| **Tronscan** | connecter le wallet **émetteur** (TronLink), page du jeton → mettre à jour ; une signature, sans frais ni transaction | `xafe-100.png` (100×100, 200 Ko au plus) |
| **Trust Wallet** | demande sur assets.trustwallet.com, frais non remboursables ; au moins 10 000 détenteurs et 15 000 transactions | `xafe-256.png` (256×256) |
| **MetaMask** | le logo vient des listes de jetons (CoinGecko…) : un jeton coté | `xafe-512.png` |

**Sur les réseaux d'essai**, rien de tout cela ne s'affiche vraiment :
BscScan et les wallets ne montrent les logos que sur le réseau principal. Les
étapes se font une fois le jeton déployé sur BNB Smart Chain et Tron
principaux, depuis le wallet matériel qui l'administre.

Ce qui se prépare dès maintenant, la vérification du code sur le réseau
d'essai (les arguments sont ceux du déploiement, relus sur la chaîne) :

```sh
CLE_BSCSCAN=… npx hardhat verify --network bsctestnet \
  0x750E774368240063BD5CF52b30b91183Efa4dAf3 \
  0x3d24e52b2Ea0A0cAb50163e494384a7f6027582E 50000000000000
```

Sur Tron, la vérification passe par le formulaire « Contract Verification »
de Tronscan : téléverser `contracts/XAFe.sol` et ses imports, compilateur
0.8.28, optimiseur à 200 exécutions.
