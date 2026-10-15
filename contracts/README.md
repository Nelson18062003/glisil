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
| `DEFAULT_ADMIN_ROLE` | un wallet matériel du propriétaire | donner et retirer les rôles, `fixerPlafondJour`, `detruireFondsGeles` |
| `FRAPPEUR_ROLE` | le signataire de la plateforme (veilleur de chaîne) | `frapper(vers, montant, reference)`, jamais au-delà du plafond du jour |
| `DESTRUCTEUR_ROLE` | idem | `detruire(montant, reference)` sur son propre solde |
| `GELEUR_ROLE` | conformité | `geler(adresse, motif)`, `degeler` |
| `PAUSEUR_ROLE` | astreinte | `pauser()`, `reprendre()` |

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
