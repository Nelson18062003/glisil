# Glisil · l'administration

L'application web de l'équipe : les réserves, les entrées (dossiers de dépôt,
SMS retenus à rapprocher ou rembourser), les sorties que TOTEM compose, les
terminaux et leurs floats, les clients et leurs paliers, le marché, les
paramètres, et le journal de ce que l'administration fait. Même pile que
l'application cliente (React, MUI, react-router, TanStack Query, supabase-js).

```sh
npm install
npm run dev            # http://localhost:5190 — sans .env, en DÉMONSTRATION
npm test               # la parité des droits avec la migration 0003
npm run build
node scripts/parcourir.mjs   # l'administration parcourue dans un vrai Chromium
```

## Les droits

Chaque RPC `admin_*` est gardée en base par `admin_a_droit('<droit>')`
(`supabase/migrations/0003_administration.sql`) — jamais par « est
administrateur » seul. L'écran n'en porte qu'une copie (`src/noyau/droits.ts`)
pour cacher ce que la base refuserait de toute façon ; `droits.test.ts` lit
la migration et compare.

| Rôle | Droits |
|---|---|
| super_admin | tout, administrateurs compris |
| operateur | voir, rapprocher, sorties, terminaux, clients |
| tresorier | voir, rembourser, paramètres, marché, clients |
| support | voir, clients |

## Démonstration

Sans `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, une maison déjà vivante
tourne en mémoire : trois boîtiers, cinq floats, douze clients, des SMS
retenus, une sortie coincée. Comptes : `nelson@glisil.com` (super admin),
`ops@glisil.com` (opérateur), `support@glisil.com` (support), mot de
passe `demo`.

Avec les deux variables, la connexion est par e-mail et mot de passe
(Supabase Auth) et l'administrateur doit avoir sa ligne dans
`administrateurs` — créée par un super admin (`admin_creer_administrateur`)
ou à la main dans la base pour le tout premier.
