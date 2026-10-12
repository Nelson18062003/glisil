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
npm test                 # neuf épreuves : référence unique, rôles, pause, gel
cp .env.example .env     # CLE_PRIVEE, RPC, CLE_BSCSCAN
npm run deployer:testnet
```

| Rôle | Qui | Pouvoir |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | un wallet matériel du propriétaire | donner et retirer les rôles |
| `FRAPPEUR_ROLE` | le signataire de la plateforme (veilleur de chaîne) | `frapper(vers, montant, reference)` |
| `DESTRUCTEUR_ROLE` | idem | `detruire(montant, reference)` sur son propre solde |
| `GELEUR_ROLE` | conformité | `geler(adresse, motif)`, `degeler` |
| `PAUSEUR_ROLE` | astreinte | `pauser()`, `reprendre()` |

Repris du contrat cXAF de 2025 (`Nelson18062003/cxaf-token`), réécrit en
français, avec le gel d'adresse en plus et une erreur de syntaxe en moins.
