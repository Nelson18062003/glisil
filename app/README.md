# XAFe Exchange · l'application des clients

React + MUI (Material Design 3) + react-router + TanStack Query + supabase-js.
Mobile d'abord ; emballée pour Android dans une coque Expo (WebView).

```sh
npm install
npm run dev            # http://localhost:5180 — sans .env, en DÉMONSTRATION
npm test               # le noyau : formats, arithmétique de l'argent, erreurs
npm run build          # type-check + bundle
node scripts/parcourir.mjs   # le parcours entier, joué dans un vrai Chromium
```

## Démonstration ou vrai moteur

Sans `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (voir `.env.example`),
l'application tourne sur `src/guichet/demo.ts` : un moteur en mémoire qui suit
les règles du vrai (fonds bloqués avant d'inscrire un ordre, frais dans l'actif
reçu, découpage des sorties, appariement prix-temps), avec un faux TOTEM qui
« trouve » le SMS trois secondes après un transaction ID, et un carnet qui vit.
Le code SMS y est toujours `123456` ; le compte `6 77 12 34 56` arrive avec une
vie déjà écrite (code secret `1234`). Un transaction ID crédite ses trois
derniers chiffres × 1 000 ; un ID qui contient `X` n'est jamais trouvé.

Avec les deux variables, `src/guichet/supabase.ts` parle au moteur
(`supabase/migrations`) : OTP SMS de Supabase Auth, RPC pour tout le reste,
abonnement temps réel sur les tables du compte.

## Où est quoi

| Dossier | Ce qu'il porte |
|---|---|
| `src/noyau/` | les formats et l'arithmétique de l'argent, **miroir du moteur** ; testés |
| `src/guichet/` | le contrat (`guichet.ts`), ses deux guichets, les hooks de lecture |
| `src/session/` | qui est connecté, le verrou, l'œil qui masque les montants |
| `src/navigation/` | les chemins (`design/NAVIGATION.md`) et ce qu'un parcours retient |
| `src/ui/` | le kit : écran, barre du bas, cartes, lignes, pavé, feuilles, erreurs |
| `src/ecrans/` | un dossier par maison : bienvenue, accueil, entrer, sortir, marché, crypto, historique, compte |
| `scripts/parcourir.mjs` | le harnais de navigateur ; ses captures vont dans `captures/` |

## Ce que le harnais exige

Connexion, dépôt par transaction ID jusqu'au crédit (+250 000 au franc près),
sortie jusqu'à « 99 500 XAF envoyés », achat au marché exécuté (+9,99 USDT
reçus pour 10 négociés), limite posée puis annulée, historique et détail,
adresse crypto avec son QR, et le verrou qui redemande le code dans un nouvel
onglet — en refusant un code faux. Il échoue à la première erreur de console.
Il a trouvé du premier coup deux défauts qu'aucune relecture n'avait vus : un
guichet qui rendait ses objets vivants (le cache les croyait inchangés, l'écran
ne bougeait plus), et une navigation lancée pendant le rendu qui ramenait au
début du parcours après une sortie réussie.
