# Glisil · l'architecture

*Ce que le système est, pièce par pièce, et où vit chaque règle.*

## Les quatre maisons

```
 [Téléphone du client]        [Navigateur de l'admin]        [TOTEM, Douala]
  app/ (React + MUI)            admin/ (React + MUI)          robot Python + SIM
        │ jeton Supabase               │ jeton Supabase               │ clé TOTEM (HMAC)
        └───────────────┬──────────────┘                              │
                        ▼                                             ▼
          ┌──────────────────────────────────────────────────────────────────┐
          │  SUPABASE : Postgres + Auth + Edge Functions                      │
          │  supabase/migrations/  = LE MOTEUR : soldes, grand livre, dépôts, │
          │  sorties, carnet, appariement, émissions. Tout en SQL, verrouillé.│
          │  supabase/functions/totem-*  = la porte de TOTEM (vérifie la clé, │
          │  appelle les RPC avec la clé de service).                         │
          └──────────────────────────────────────────────────────────────────┘
                        │
                        ▼
          ┌──────────────────────────────┐
          │  BNB Smart Chain · Tron      │   contracts/ : XAFe (ERC-20 / TRC-20)
          │  USDT entrants, XAFe sortants│   veilleur de chaîne (chaine/)    
          └──────────────────────────────┘
```

## Le principe qui commande tout

**Une règle d'argent vit dans la base, à l'endroit où l'on écrit.** Pas dans
l'écran, pas dans une fonction qui lit puis écrit. Chaque mouvement passe par
une fonction SQL `security definer` qui verrouille la ligne de solde
(`for update`), écrit en **relatif** (`disponible = disponible - x`), et laisse
une écriture au grand livre. Les contraintes `disponible >= 0` et
`bloque >= 0` sont le dernier rempart : on ne peut pas les contourner depuis
l'application. C'est la leçon de Bonzini et de TOTEM, reprise telle quelle.

## Les objets

| Objet | Table | Ce qu'il porte |
|---|---|---|
| Compte | `comptes` | téléphone, nom, palier, le compte « maison » qui encaisse les frais |
| Numéro MoMo | `numeros` | opérateur, numéro, vérifié le, **actif après 24 h**, retiré le |
| Solde | `soldes` | par compte et par actif (XAFe, USDT) : `disponible`, `bloque` |
| Grand livre | `ecritures` | chaque mouvement, en ajout seul, avec sa nature et sa source |
| Émissions | `emissions` | chaque XAFe créé (dépôt crédité) ou détruit (sortie envoyée) : la circulation |
| Dépôt | `depots` + `depot_paiements` | référence, float visé, montant attendu, **montant reçu**, les SMS qui l'ont payé |
| Entrée retenue | `entrees_retenues` | un SMS d'argent qui ne correspond à aucune référence : jamais crédité au hasard |
| Sortie | `sorties` + `commandes` | ce que le client sort, découpé en transferts au plafond de l'opérateur, que TOTEM exécute |
| Ordre | `ordres` | achat ou vente, limite ou marché, restant, bloqué |
| Exécution | `executions` | chaque appariement : prix, quantité, frais, qui était preneur |
| Float | `floats` | les numéros MoMo que les clients paient, portés par un terminal TOTEM |
| Terminal | `terminaux` | un boîtier TOTEM, sa clé, son dernier signe de vie |

## Les règles, et où elles sont

| Règle | Où |
|---|---|
| 1 XAFe = 1 XAF : on n'émet qu'à la réception d'un SMS de paiement, on ne détruit qu'au transfert sorti | `totem_sms_recu`, `totem_resultat_commande` |
| Un SMS ne crédite qu'une fois | `depot_paiements (terminal, source_id)` unique |
| Un SMS sans référence est retenu, jamais crédité | `totem_sms_recu` → `entrees_retenues` |
| Le numéro qui a payé décide à qui va le paiement, pas le premier qui tape l'ID | `_apparier` |
| Un SMS ne crédite que s'il vient d'un float porté par le terminal qui le pousse | `totem_sms_recu` |
| Le même SMS, ou un ID et son SMS, arrivant au même instant se voient | verrous consultatifs `sms:` puis `tx:` |
| Un dépôt se paie en plusieurs transferts, chacun crédite dès son SMS | `depots.montant_recu`, état `partiel` |
| Une sortie ne va qu'à un numéro vérifié depuis 24 h | `demander_sortie` |
| Une sortie au-delà du plafond opérateur est découpée | `demander_sortie` → `commandes` |
| Un transfert échoué est repris trois fois, puis recrédité | `totem_resultat_commande` |
| Tout ce qui est au carnet est déjà déposé | `placer_ordre` bloque avant d'inscrire |
| Prix-temps : le meilleur prix d'abord, puis le plus ancien | `placer_ordre` |
| Le prix d'exécution est celui de l'ordre qui attendait | `placer_ordre` |
| Pas d'auto-négociation : l'ordre entrant s'arrête | `placer_ordre` |
| Frais : placeur 0,05 %, preneur 0,10 %, dans l'actif reçu ; sortie 0,5 % | `parametres`, `placer_ordre`, `demander_sortie` |
| Un geste part une fois | clé d'intention sur dépôts, sorties, ordres |
| Un client ne voit que ses lignes | politiques RLS, lecture seule ; toute écriture passe par une RPC |
| Un client n'exécute que ce qui lit sa session ; anon rien | `0004_droits.sql` : tout fermé, la liste ouverte |
| Un compte désactivé ne fait plus aucun geste d'argent | `_exiger_compte_actif` |
| Le plafond du palier compte les sorties MoMo ET la chaîne, sous verrou du compte | `_sorties_du_jour`, `demander_sortie`, `demander_retrait_crypto` |
| Un résultat de TOTEM vaut pour la commande réclamée et SA tentative | `totem_resultat_commande` |
| Les empreintes des codes ne sont dans aucune table lisible | `codes_secrets`, `numeros_codes` |

## Les surfaces

- **`app/`** : l'application des clients. React, MUI (Material Design 3),
  react-router pour la navigation décrite dans `design/NAVIGATION.md`,
  TanStack Query pour les données, Supabase pour l'auth (OTP par SMS) et les
  RPC. Mobile d'abord, emballée pour Android dans une coque Expo (WebView,
  comme BONZINI HQ) ; les briques natives (notifications, empreinte,
  caméra) passent par le pont de la coque.
- **`admin/`** : l'administration, même pile : le tableau des réserves, les
  entrées (dossiers, SMS retenus à rapprocher ou rembourser), les sorties
  que TOTEM compose, les terminaux et leurs floats, les clients et leurs
  paliers, le marché, les wallets, les paramètres, le journal. Chaque action est gardée
  en base par `admin_a_droit('<droit>')` (migration 0003).
- **`supabase/functions/totem-sms`** et **`totem-commandes`** : la porte de
  TOTEM, voir `docs/TOTEM-INTEGRATION.md`.
- **`contracts/`** : le jeton XAFe, le même contrat sur BNB Smart Chain et
  sur Tron, frappé à la sortie vers un wallet externe, détruit au retour.
- **`chaine/`** : le veilleur de chaîne — nos propres wallets sur les deux
  réseaux (une graine, des adresses dérivées, un wallet chaud, un froid), et
  l'outil de mise en service. Voir `chaine/README.md`.

## Vérifier avant d'annoncer

```sh
sh moteur/verifier-le-moteur.sh      # un PostgreSQL neuf façon Supabase : scénarios, courses, hasard, charge
sh moteur/rouge-puis-vert/rouge-puis-vert.sh   # chaque défaut de la revue : présent avant (6d453d3), absent aujourd'hui
sh supabase/epreuve/eprouver.sh      # tout cela sur les VRAIES images Supabase, plus l'API attaquée (Docker)
cd app && npm test                   # le noyau de l'application : formats, argent, erreurs
cd app && npm run build              # l'application cliente, type-check compris
cd app && node scripts/parcourir.mjs # le parcours entier, joué dans un vrai Chromium
node --experimental-strip-types supabase/functions/verifier-la-porte.ts  # la porte de TOTEM, attaquée
cd admin && npm test                 # la parité des droits avec la migration 0003
cd admin && npm run build            # l'administration
cd admin && node scripts/parcourir.mjs # l'administration parcourue dans Chromium, super admin puis support
cd contracts && npm test             # le jeton XAFe : référence unique, rôles, pause, gel
cd design/maquettes && npm run build # les maquettes
```

`verifier-le-moteur` monte un PostgreSQL neuf, joue les migrations, puis
rejoue la vie d'un dépôt, d'une sortie et d'un carnet : SMS rejoué, SMS
étranger, sortie découpée dont un transfert échoue, ordres limite et marché,
appariement partiel, auto-négociation, solde insuffisant, et vérifie à la fin
que la somme des soldes vaut exactement les émissions moins les destructions.
« Le déclencheur est créé » ne dit rien de ce qu'il fait.

**Le harnais imite Supabase, pas un PostgreSQL sage.** Avant les migrations
il pose ce que Supabase pose : `anon` et `authenticated` reçoivent d'office
tous les droits sur ce qui naît dans `public`, pgcrypto vit dans le schéma
`extensions`, `auth.users` existe. Contre un PostgreSQL nu, `revoke … from
public` avait l'air de tout fermer — et chez Supabase, n'importe quel client
pouvait appeler `crediter_crypto` ou `totem_sms_recu`. Le scénario 11.1
compare ce qui est ouvert à ce qui doit l'être.

**Une course ne se voit qu'à deux.** `moteur/courses.sh` ouvre deux
connexions en même temps (le même SMS poussé deux fois ; l'ID tapé à
l'instant où le SMS arrive ; deux sorties contre le même plafond). Chaque
course a son témoin : la fonction privée de son verrou doit reproduire la
faute, sinon la course ne prouve rien.

**Le hasard et la charge voient ce qu'aucun scénario n'imagine.**
`moteur/hasard.sql` tire au sort 4 500 gestes et vérifie sept règles après
chacun (soldes = circulation, grand livre, bloqués justifiés au centime, un
SMS crédité OU retenu…) ; six défauts glissés exprès sont tous pris.
`moteur/charge/` lance seize clients en même temps avec pgbench : elle a
trouvé deux étreintes mortelles (un geste de client qui tombe), que la règle
de l'ordre des verrous, écrite au-dessus de `_mouvement`, empêche : le
compte maison se touche en dernier, un compte se sérialise par « for no key
update ».

**Et sur une vraie pile Supabase.** `sh supabase/epreuve/eprouver.sh` monte
les images de production (la base où `postgres` n'est pas superutilisateur,
GoTrue, PostgREST), y rejoue tout ce qui précède, puis attaque l'API comme
un client, inscription par OTP comprise. `TEMOIN=1` rejoue l'attaque contre
le code d'avant les corrections : elle doit y échouer.

