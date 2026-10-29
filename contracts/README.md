# XAFe · le jeton

Le franc CFA sur BNB Smart Chain (BEP20), puis Tron (TRC20). 1 XAFe = 1 XAF.

**Chaque XAFe dû par Glisil existe sur la chaîne** (migration 0015). Un
dépôt MoMo ou Orange crédité est **frappé** au même moment dans la RÉSERVE de
Glisil, sous la référence du dossier (`XAFe-DP-000003`) ; un retrait payé en
XAF y est **détruit**. **La réserve est tenue par le contrat lui-même**
(`address(this)`, `frapperReserve` / `detruireReserve`) : elle ne se transfère
pas — rien n'y entre par transfert, rien n'en sort sinon brûlé. Avant, elle
dormait sur le wallet chaud, et une clé chaude volée la vidait d'un transfert. Quand un client sort ses XAFe vers son
propre wallet, la plateforme les frappe chez lui (référence du retrait,
`XAFe-CR-000012`) et les détruit dans la réserve ; quand ils reviennent, elle
les détruit chez lui et les refrappe dans la réserve. L'offre totale du jeton
vaut donc toujours ce que Glisil doit — et cela se prouve, à trois colonnes
(floats, registre, chaîne), sur la page publique `/preuve` : voir
[docs/PARITE.md](../docs/PARITE.md). Une référence ne frappe qu'une fois.

```sh
npm install
npm test                 # 27 épreuves : la réserve dans le contrat, référence unique, plafond du jour, rôles, pause, gel, reprise, inscripteur
slither . --filter-paths node_modules   # l'analyse statique (0 constat)
sh echidna/eprouver.sh   # 100 000 appels au hasard, douze promesses (TEMOIN=1 : quatre jetons mutés doivent y tomber)
cp .env.example .env     # CLE_PRIVEE, RPC, CLE_BSCSCAN
ADMIN=0x… CHAUD=0x… PLAFOND_JOUR_XAF=1000000000 npm run deployer:testnet
```

Le constructeur pose **tous les rôles d'un coup** :
`XAFe(admin, plafond, frappeur, destructeur, pauseur, geleur, inscripteur)` —
une adresse nulle ne reçoit rien. Il n'y a pas de fenêtre où l'admin serait une
clé de déploiement. Le plafond par défaut est **1 000 000 000 XAF par jour et
par chaîne** (`1e15` unités) ; l'ADMIN le change à tout moment, à la hausse
comme à la baisse, effet immédiat (`fixerPlafondJour`). Vérifier sur BscScan
avec les sept arguments (compilateur 0.8.28, optimiseur 200, EVM « paris ») :
`npx hardhat verify --network bsc <adresse> <admin> <plafond> <frappeur> <destructeur> <pauseur> <geleur> <inscripteur>`.

| Rôle | Qui | Pouvoir |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | un wallet matériel du propriétaire — et lui seul (plus tard un Safe 2 sur 3) | donner et retirer les rôles, `fixerPlafondJour`, `inscrireAdressesDeDepot` (inscrire ou retirer), `detruireFondsGeles`, **`reprendre()`**. Il ne reçoit AUCUN autre rôle à la naissance, et se transmet en deux temps (`beginDefaultAdminTransfer`, deux jours, `acceptDefaultAdminTransfer`) |
| `FRAPPEUR_ROLE` | le wallet chaud (indice 0 de la graine) | `frapper(vers, montant, empreinte)` vers un wallet, jamais au-delà du plafond du jour ; `frapperReserve(montant, empreinte)`, sans plafond (rien n'en sort) |
| `DESTRUCTEUR_ROLE` | idem | `detruireReserve(montant, empreinte)` ; `detruireDepot(adresse, montant, empreinte)` sur une adresse de dépôt inscrite. Chaque destruction porte une empreinte non vide, utilisée une seule fois (`destructionReferencee`). Plus de `detruire` : rien ne doit jamais dormir sur le wallet chaud |
| `GELEUR_ROLE` | conformité | `geler(adresse, motif)`, `degeler`. Une adresse gelée n'envoie, ne reçoit, ni ne dépense les autorisations qu'on lui a données ; ni l'adresse zéro ni la réserve ne se gèlent |
| `PAUSEUR_ROLE` | astreinte | `pauser()` seulement : un PAUSEUR arrête, il ne reprend pas — un rôle qui se confie sans crainte |
| `INSCRIPTEUR_ROLE` | la clé de mise en service, un temps | `inscrireAdressesNeuves(adresses)` : des adresses de dépôt NEUVES (zéro XAFe), jamais en retirer. Elle inscrit le stock d'avance, puis y renonce (`renounceRole`) |

Le déploiement exige `ADMIN` et `CHAUD` hors réseau local, et refuse un admin
qui serait le wallet chaud. Ce qu'une clé chaude volée peut encore faire :
frapper vers un wallet jusqu'au plafond du jour (visible à la parité, ligne
« inconnue » ; gel puis `detruireFondsGeles`), ou brûler la réserve (grief
seulement, l'alarme sonne). Elle ne peut plus en déplacer une unité.

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
FRAPPEUR compromis ne frappe donc pas plus que `plafondJour` par jour vers
l'extérieur (la réserve n'y compte pas : ce qui y est frappé n'en sort pas),
et seul l'ADMIN — une autre clé, hors ligne — relève le
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
