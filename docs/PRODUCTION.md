# Passer en production

La bêta tourne sur des réseaux d'essai, avec de l'argent de test
([BETA.md](BETA.md)). La production est **un autre projet**, monté à neuf :
`glisil-prod` (`dfixghiwqlwulmzixlpf`). Ce document est la liste de ce qu'il
faut faire, **dans l'ordre**, et de qui le fait : **[P]** le propriétaire,
**[C]** Claude. Rien de secret ne passe jamais par le chat.

> Règle d'or : **rien de la bêta ne passe en production**. Pas de copie de
> base, pas de comptes, pas de soldes. Le schéma se monte sur un projet vide,
> en UNE transaction, et l'argent de test n'y peut pas exister (0041).

## Ce que la production est, d'emblée

| | Bêta | Production |
|---|---|---|
| Projet Supabase | `erngzpklfslbfznioxxr` | `dfixghiwqlwulmzixlpf` |
| Profil | aucun (`profil_de_la_base` vide) | `production`, immuable (0041) |
| Argent de test | dotation à l'inscription, robots | **impossible** : dotation, bêta, robots, réseau d'essai et démo refusés même en SQL |
| Chaîne | BSC Testnet, Tron Nile | BSC et Tron principaux (`chaine.essai = false`) |
| Réseaux ouverts | BSC, Tron | BSC seul ; Tron s'ouvre après l'essai de bout en bout |
| Crypto | ouverte | dépôts et retraits **fermés** jusqu'à l'essai de bout en bout |
| Sorties MoMo/OM | — | **manuelles**, prouvées par le SMS de la puce (0038) ; pas de forçage ; le propriétaire paie seul |
| Garde des faux SMS | — | `continuite.mode = exiger` (0039) |
| Connexion | mot de passe + application d'authentification | la même, + inscriptions **fermées** jusqu'à l'ouverture |
| Plafonds | — | aucun (paliers et opérateurs à `null`) ; le contrat borne la frappe à 1 000 000 000 XAF par jour et par chaîne |
| Frais | ceux de la bêta | **les mêmes** (placeur 0,05 %, preneur 0,10 %, sortie 0,5 %, crypto 1 USDT / 500 XAFe, rapide 1 %) — à confirmer par [P] avant l'ouverture, 0041 n'y touche pas |

Le constat du profil se lit à tout moment : admin → Paramètres → « Profil de
production » (pastille rouge **PRODUCTION · argent réel** en tête de chaque
page), ou `select verifier_le_profil_production(false);`.

## Où on en est (29/10)

- **F, G faits par Claude** : Glisil est installé sur `glisil-prod` (profil
  « production » posé à 12 h 28 UTC, constat vert, aucun refus, aucun
  avertissement) ; le coffre porte `veilleur_url`, `veilleur_jeton`,
  `courriel_url`. Reste au propriétaire : `courriel_jeton` (la même valeur que
  `COURRIEL_JETON` dans Infisical).
- Migrations déjà appliquées à la production après l'installation : 0043.
  Toute migration suivante s'y applique seule, puis le constat.

## A [C] Le code et ses preuves

- Tous les chantiers de la livraison 1 sur `main`, et le consolidé refait :
  `python3 supabase/consolider.py`.
- Lancés et verts : `sh moteur/verifier-le-moteur.sh`,
  `sh moteur/rouge-puis-vert/rouge-puis-vert.sh`,
  `sh supabase/production/eprouver-le-profil.sh` (exige `postgresql-16-cron`),
  `node --experimental-strip-types supabase/functions/verifier-*.ts`,
  `cd chaine && npm test`, `cd contracts && npx hardhat test`, app et admin
  (`npx tsc --noEmit -p tsconfig.json`, `npm test`, `npm run build`,
  `node scripts/parcourir.mjs`, `node --experimental-strip-types
  scripts/verifier-le-build-de-production.mjs`), `node app/scripts/langue.mjs`.

## B [P] Les comptes

- Double authentification **par application** (pas par e-mail) sur Supabase,
  Vercel, GitHub, Infisical, Resend, Google Cloud, le registraire du domaine,
  TronGrid, le fournisseur RPC BSC, BscScan.
- Organisation Supabase : retirer tout membre inutile. `glisil-prod` est sur
  l'organisation Pro (sauvegardes quotidiennes).

## C [P] Le tableau de bord de `glisil-prod`, AVANT l'installation

- **Database → Extensions** : activer `http` (schéma `extensions`) — sans lui,
  pas de cours de référence. `pg_cron` et `pg_net`, les migrations les créent.
- **Authentication → Sign In / Providers** : « Allow new users to sign up »
  **désactivé**. Ce sont les portes fermées (Google compris).
- **Settings → API Keys** : garder les clés héritées (anon, service_role)
  actives ; noter la clé anon.
- **Database → Connect → Session pooler** (IPv4, port 5432) : cette adresse va
  dans Infisical, `prod /outils PROD_DB_URL`.

## D [P] Infisical, projet « glisil », environnement `prod`

| Dossier | Synchronisé vers | Contenu |
|---|---|---|
| `/supabase-fonctions` | secrets des fonctions de `dfixghiwqlwulmzixlpf` (Auto-Sync, **Disable Secret Deletion**) | `XAFE_GRAINE`, `EVM_RPC_KEY` (Alchemy : BNB Chain et Ethereum), `TRONGRID_KEY`, `RESEND_API_KEY`, `COURRIEL_JETON` |
| `/vercel-app` | Vercel `glisil-app`, Production | `VITE_SUPABASE_URL=https://dfixghiwqlwulmzixlpf.supabase.co`, `VITE_SUPABASE_ANON_KEY`, `VITE_PROFIL=production`, `VITE_SUPPORT_WHATSAPP` |
| `/vercel-admin` | Vercel `glisil-admin`, Production | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PROFIL=production` |
| `/outils` | rien (`infisical run` seulement) | `PROD_DB_URL`, `MOTEUR_URL=https://dfixghiwqlwulmzixlpf.supabase.co/rest/v1`, `MOTEUR_CLE` (service), `SUPABASE_ACCESS_TOKEN`, `CLE_BSCSCAN`, `CLE_DE_MISE_EN_SERVICE` |
| `/auth`, `/totem` | rien (archive) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, la clé SMTP Resend ; `XAFE_TERMINAL_CLE` |

`EVM_RPC_KEY`, `TRONGRID_KEY` et `PROD_DB_PASSWORD` sont **déjà** dans
Production (fait le 29/10, à la racine). Créer le dossier `supabase-fonctions`
et y **déplacer** `EVM_RPC_KEY` et `TRONGRID_KEY` ; `PROD_DB_PASSWORD` reste à
la racine, jamais synchronisé. Le veilleur fabrique lui-même les adresses des
nœuds à partir de ces deux clés (`chaine/src/service.ts`, `noeudsDesCles`).

**Jamais** dans Infisical : les phrases de récupération MetaMask / TronLink,
les futurs signataires du Safe, quoi que ce soit de la bêta. **Jamais**
synchronisé : `VEILLEUR_JETON` (le coffre de la base en est la seule source).

## E [P] La graine, sur votre ordinateur

1. En ligne : `cd chaine && npm ci`.
2. **Wi-Fi coupé** : `npm run mise-en-service -- graine` ; recopier les 24 mots
   sur papier, deux fois, rangés en deux lieux.
3. Wi-Fi rétabli : taper les mots dans Infisical `/supabase-fonctions
   XAFE_GRAINE`.
4. `infisical run --env=prod --path=/supabase-fonctions -- npm run
   mise-en-service -- adresses` : donner à Claude les deux wallets chauds
   (adresses publiques).
5. `clear`, et vider l'historique du terminal.

## F [C] L'installation : UNE instruction

Claude installe par la connexion Supabase du chantier, en **une seule
instruction SQL** (`supabase/production/installer.py` la fabrique : l'annonce,
chaque migration, puis le constat, dans un même bloc) — une instruction est
toujours tout ou rien. Le fichier fait près d'un mégaoctet : la base le
télécharge elle-même (extension `http`), à un commit précis, vérifie son
empreinte md5, puis l'exécute — dans la même instruction. Le même résultat,
par `psql`, si besoin :

```sh
infisical run --env=prod --path=/outils -- sh -c 'psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
  -f supabase/production/annoncer-la-production.sql \
  -f migrations/<AAAAMMJJ>_consolidated.sql \
  -f supabase/production/verifier-la-production.sql'
```

Elle se termine par un JSON `"ok": true`. Les seuls avertissements attendus :
le coffre (`veilleur_url`, `veilleur_jeton`, posés en G). **Sur une erreur,
rien n'est écrit** : envoyer le texte de l'erreur à Claude.

Jamais l'éditeur SQL, `apply_migration` ou `supabase db push` pour
l'installation : hors d'une transaction unique, la tâche des robots et la bêta
seraient validées avant 0041, un tour de pg_cron doterait les robots, et la
base refuserait ensuite de devenir la production — il faudrait un projet neuf.
`eprouver-le-profil.sh` rejoue cette fenêtre pour témoin.

**Les migrations suivantes, sur la production** : le SEUL fichier neuf, puis
le constat, sans l'annonce :

```sh
infisical run --env=prod --path=/outils -- sh -c 'psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
  -f supabase/migrations/00NN_….sql -f supabase/production/verifier-la-production.sql'
```

(Le consolidé entier se rejoue aussi — `eprouver-le-profil.sh` le vérifie sur
une production vide — mais une vieille migration rejouée sur une base pleine
peut reposer une contrainte plus étroite que les lignes d'aujourd'hui.)

[C] ensuite, en lecture : `select jobname from cron.job` (`xafe-expirer-depots`,
`glisil-rapprocher`, `glisil-cours`, `glisil-menage-cron` ; jamais
`glisil-robots`), `select verifier_le_profil_production(false)`, les
conseillers Supabase (sécurité, performance).

## G [C] Le coffre (Vault)

```sql
select vault.create_secret('https://dfixghiwqlwulmzixlpf.supabase.co/functions/v1/veilleur', 'veilleur_url', 'adresse du veilleur');
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'veilleur_jeton', 'réveil du veilleur');
select vault.create_secret('https://dfixghiwqlwulmzixlpf.supabase.co/functions/v1/courriel', 'courriel_url', 'adresse des courriels');
-- courriel_jeton : la MÊME valeur que COURRIEL_JETON (Infisical) — [P] la colle dans Database → Vault
```

Jamais `essai_graine` ni `essai_admin_cle` : le constat les refuse.

## H [P] Les fournisseurs

- Alchemy (BNB Chain + Ethereum) et TronGrid : **faits le 29/10**
  (`EVM_RPC_KEY`, `TRONGRID_KEY`). Le nœud ne va **jamais** dans les
  paramètres : ils sont lisibles par tout client connecté.
- **L'offre gratuite d'Alchemy ne lit les journaux que 10 blocs à la fois**
  (et 30 millions d'unités par mois). Le veilleur s'y adapte seul (lectures
  par dix), mais il consomme alors davantage, un tour par minute : prévoir de
  passer Alchemy en « Pay As You Go » si le tableau d'Alchemy approche de la
  limite — on règle ensuite `BEP20_BLOCS_PAR_REQUETE=2000` pour lire moins
  souvent. À regarder la première semaine.
- Resend (domaine `glisil.com` vérifié) : deux clés « Sending », l'une pour les
  fonctions (`RESEND_API_KEY`), l'autre pour le SMTP d'Auth (`/auth`). Passer
  à l'offre Pro avant l'ouverture (l'offre gratuite : 100 e-mails par jour).
- Attendre la synchronisation.

## I [C] Les fonctions

```sh
infisical run --env=prod --path=/outils -- npx supabase functions deploy \
  totem-sms totem-commandes veilleur courriel deux-facteurs --project-ref dfixghiwqlwulmzixlpf
```

**Toujours `--project-ref`** : `supabase/config.toml` porte l'identifiant de la
bêta. Puis, en SQL : `select reveiller_veilleur('bep20');` et
`net._http_response` (202, ou « réseau pas encore configuré » avant K) ; un
appel à `totem-sms` sans signature reçoit 401.

## J [P] L'authentification

Les réglages exacts sont dans [CONNEXION.md](CONNEXION.md) : SMTP Resend
(`smtp.resend.com:465`, expéditeur `code@glisil.com`), les modèles d'e-mail,
« Confirm email » activé, la double authentification TOTP, la protection des
mots de passe divulgués, au moins 100 e-mails par heure. **Sessions**
(Authentication → Sessions) : « Inactivity timeout » **7 jours**,
« Time-box user sessions » **30 jours** (votre décision du 29/10). URL : Site URL
`https://app.glisil.com` ; Redirect URLs `https://app.glisil.com/**`,
`https://admin.glisil.com/**`, `glisil://auth-retour` (Google dans l'application
Android : la coque l'ouvre dans un onglet du système et Google revient par
là) — **aucun domaine de la bêta**. La coque qui sait le faire (pont v2) part
chez les téléphones par une mise à jour à distance (`cd coque && npm run
update:production`) : rien de natif n'a changé. Google Cloud :
écran de consentement « Glisil », client Web (origines app et admin ; retour
`https://dfixghiwqlwulmzixlpf.supabase.co/auth/v1/callback`), l'ID et le
secret dans Supabase → Providers → Google, et dans `/auth`.

## K [P + C] Les contrats, BSC puis Tron

Le contrat corrigé tient lui-même la réserve, intransférable ; le constructeur
pose tous les rôles et le plafond du jour (1 000 000 000 XAF). Voir
[chaine/README.md](../chaine/README.md).

1. [P + C] **Le patron des contrats, AVANT le déploiement** (décidé le 29/10) :
   - trois comptes MetaMask (votre ordinateur, vos deux téléphones), chacun
     avec sa phrase de récupération sur papier ;
   - un **Safe** sur BNB Chain (app.safe.global) avec ces trois comptes, **2
     signatures sur 3** ; son adresse est l'**admin** du contrat BSC (et plus
     tard d'Ethereum) ;
   - Tron n'a pas de Safe : un compte TronLink, dont la permission
     « propriétaire » passe à 2 sur 3 (trois clés) ; il est l'admin du contrat
     Tron ;
   - le **pauseur** et le **geleur** : l'un de vos comptes MetaMask (BSC) et
     votre compte TronLink — il faut pouvoir arrêter vite, seul.
   Donner à Claude les adresses PUBLIQUES (Safe, MetaMask, TronLink).
2. [P] Une clé de mise en service NEUVE (`CLE_DE_MISE_EN_SERVICE`, `/outils`),
   financée : ≈ 0,01 BNB ; ≈ 300 TRX. Le wallet chaud : 0,06 BNB ; 900 TRX.
Chaque commande de mise en service lit deux dossiers d'Infisical (la clé et
la base dans `/outils`, la graine et les nœuds dans `/supabase-fonctions`) :
`PROD="infisical run --env=prod --path=/supabase-fonctions -- infisical run --env=prod --path=/outils --"`.

3. [P] `$PROD npm --prefix chaine run mise-en-service -- deployer --production --reseau bep20 --chaud <chaud BEP20> --admin <Safe> --pauseur <MetaMask> --geleur <MetaMask> --usdt 0x55d398326f99059fF775485246999027B3197955`
   — un réseau principal sans `--production` est refusé. Noter l'adresse et le
   bloc.
4. [P] `$PROD npm --prefix chaine run mise-en-service -- preinscrire --reseau bep20 --xafe <contrat> --de 1 --a 2000 --renoncer` (avec `XAFE_GRAINE`).
5. [C] `cd contracts && npx hardhat verify --network bsc <contrat> <les sept arguments imprimés>`.
6. Tron : les mêmes pas, `--reseau trc20`, l'admin = le compte TronLink 2 sur 3,
   `--usdt TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`, `--a 600` ; vérifier sur
   Tronscan (solc 0.8.28, optimiseur 200).
7. [C] Le paramètre `chaine` (sans nœud) :
   ```sql
   update parametres set valeur = jsonb_build_object('essai', false, 'reserve', 'bep20',
     'bep20', jsonb_build_object('xafe', '<0x…>', 'usdt', '0x55d398326f99059fF775485246999027B3197955', 'depart', <bloc>, 'confirmations', 15),
     'trc20', jsonb_build_object('xafe', '<T…>', 'usdt', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'depart', <bloc>, 'confirmations', 20))
    where cle = 'chaine';
   ```
   Les tâches `xafe-veilleur-bep20` et `xafe-veilleur-trc20` se posent seules.
8. [C] `$PROD npm --prefix chaine run mise-en-service -- verifier` : tout vert (la clé de mise en service n'a plus aucun rôle), puis `select chaine_etat('bep20')`.
9. [P] Jeter la clé de mise en service.

Le plafond se change à tout moment par l'admin — sur BSC, une transaction du
Safe (deux signatures) : `fixerPlafondJour(n × 1 000 000)` ;
`mise-en-service plafond --xaf N` imprime le nombre exact. Sans borne haute,
effet immédiat, chaîne par chaîne.

## L [P] Vercel

- Si les projets de la bêta tiennent `app.glisil.com` ou `admin.glisil.com`,
  les déplacer d'abord (`beta.glisil.com`, `admin-beta.glisil.com`) et mettre
  à jour les URL de la bêta dans Supabase.
- Nouveaux projets `glisil-app` (dossier `app/`) et `glisil-admin`
  (`admin/`), branche de production `main` ; l'environnement Production vient
  d'Infisical, Preview = la bêta.
- Domaines `app.glisil.com`, `admin.glisil.com` (CNAME `cname.vercel-dns.com`).
- Déployer. **Le build se ferme** s'il manque une variable, ou si
  `VITE_PROFIL=production` vise un autre projet que la production.

## M [P] Le premier super admin, et vos comptes clients

1. Supabase → Authentication → Users → **Add user** : l'adresse
   d'administration, un mot de passe du gestionnaire, **Auto Confirm**.
2. SQL : `insert into administrateurs_invites (email, nom, role) values ('<adresse>', '<Nom>', 'super_admin');`
3. `admin.glisil.com` : mot de passe → application d'authentification → dix
   codes de secours notés → l'invitation devient l'administrateur.
4. [C] vérifie `journal_admin` (`invitation_acceptee`).
5. Le même « Add user » pour vos deux adresses clientes (une adresse par
   compte), puis l'inscription dans l'application.

## N [P + C] TOTEM

1. admin → Terminaux : créer `douala-1` (jamais `totem-demo` : refusé). La clé
   s'affiche une fois → Infisical `/totem`.
2. Un float par puce **dédiée** (opérateur, numéro, terminal, code marchand,
   titulaire exactement comme l'opérateur l'affiche). Une puce partagée avec
   Bonzini enverrait ses paiements comme preuves de sortie.
3. Le Pi : `/etc/totem.conf` (mode 600, au robot), `TOTEM_CONF=/etc/totem.conf`
   dans l'unité systemd ; effacer `/boot/firmware/totem.conf` et
   `./totem.conf`. Section `[xafe]` : `url = https://dfixghiwqlwulmzixlpf.supabase.co`,
   `cle = <clé>`, `terminal = douala-1`, `anon` vide, `transferts = non`,
   `sorties = oui`. `git pull` de `main` sur le boîtier.
4. Déclarer le numéro de chaque carte dans les réglages de TOTEM, relancer le
   robot. [C] vérifie que `terminaux.vu_le` a moins d'une minute.
5. **Une consultation de solde par puce** depuis TOTEM : sans ce premier solde
   sûr, le premier dépôt réel serait retenu (garde des faux SMS, 0039).

La démonstration de TOTEM reste sur le projet de la bêta.

## O [P] L'essai de bout en bout, en petits montants ([C] vérifie en SQL)

1. Dépôt MoMo de 1 000 XAF → déclaré → 1 000 XAFe crédités, frappés dans la
   réserve (BscScan), `rapprocher()` juste.
2. La même chose avec Orange Money.
3. `crypto.depots_ouverts = true` (les portes restent fermées au public) :
   5 USDT BEP20 et 5 USDT TRC20 vers vos adresses → crédités après 15 / 20
   confirmations.
4. Un échange entre vos deux comptes.
5. Un retrait de 1 000 XAFe vers MoMo : mot de passe + code e-mail +
   application → vous payez depuis la puce → l'ID tapé → le SMS de la puce le
   prouve → détruit → e-mail reçu.
6. `crypto.retraits_ouverts = true` : 2 USDT et 1 000 XAFe vers un wallet
   externe, sur les deux réseaux.
7. 500 XAFe renvoyés à une adresse de dépôt inscrite → détruits, crédités.
8. `select rapprocher()` : écart nul ; `select verifier_le_profil_production(false)` : aucun refus.

## P [P] Ouvrir les portes

- Les conditions de production (`conditions.version`), le support (e-mail,
  WhatsApp).
- Tron ouvert (admin → Wallets → Réseaux), crypto ouverte.
- Supabase : « Allow new users to sign up » **activé** ; Google activé.
- Annoncer.

## Q Plus tard

- Un pauseur et un geleur confiés à d'autres personnes.
- Livraison 2 : Ethereum, USDC.

## Ce qui reste à surveiller

- Une clé chaude volée ne peut plus vider la réserve (le contrat la tient) ;
  elle peut frapper vers un wallet jusqu'au plafond du jour — visible à la
  parité, ligne « inconnue » ; geler, puis l'admin détruit les fonds gelés.
- Le Safe (BSC) et le compte TronLink 2 sur 3 : un téléphone volé ne suffit
  pas. Les phrases de récupération sur papier seulement, jamais en photo ni
  dans Infisical.
- `XAFE_GRAINE` vit dans Infisical et dans les secrets des fonctions :
  quiconque est propriétaire de l'un ou de l'autre peut déplacer les wallets
  chauds et de dépôt. Double authentification partout, membres au minimum.
- La clé du boîtier TOTEM fabrique des SMS d'opérateur : `/etc/totem.conf`
  seulement, jamais sur la carte SD en clair.
