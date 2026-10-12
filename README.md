# XAFe Exchange

Le franc CFA sur la blockchain, et un vrai marché spot USDT/XAFe. 1 XAFe = 1 XAF,
couvert un pour un par les floats MoMo et les comptes en banque de la plateforme.

- Un client **entre des XAF** en payant notre float (MTN MoMo ou Orange Money),
  puis tape le **transaction ID** de son SMS ; TOTEM, le boîtier qui porte nos
  cartes, lit le même ID sur le float et les XAFe sont crédités, tout de suite.
- Il **sort des XAF** vers un numéro vérifié ; TOTEM compose le transfert.
- Il **achète et vend des USDT** sur un carnet d'ordres, limite ou marché.
- Il **sort ses XAFe sur la chaîne** (BEP20, puis TRC20) vers son propre wallet.

| Dossier | Ce que c'est | Vérifier |
|---|---|---|
| `supabase/migrations/` | LE MOTEUR : soldes, grand livre, dépôts, sorties, carnet, compte, administration — tout en SQL, verrouillé | `sh moteur/verifier-le-moteur.sh` |
| `supabase/functions/` | la porte de TOTEM (SMS lus, transferts et SMS à composer), signée | `node --experimental-strip-types supabase/functions/verifier-la-porte.ts` |
| `app/` | l'application des clients (Android, Material Design 3) | `cd app && npm test && npm run build && node scripts/parcourir.mjs` |
| `admin/` | l'administration (web) | `cd admin && npm test && npm run build && node scripts/parcourir.mjs` |
| `contracts/` | le jeton XAFe (ERC-20) | `cd contracts && npm test` |
| `design/` | les maquettes et la carte de navigation | `cd design/maquettes && npm run build` |
| `docs/` | l'architecture, le contrat TOTEM | — |

Lire d'abord `docs/ARCHITECTURE.md`, puis `design/NAVIGATION.md` et
`docs/TOTEM-INTEGRATION.md`. Chaque harnais a été écrit pour prendre en défaut,
et chacun l'a fait au moins une fois (les commits le racontent).
