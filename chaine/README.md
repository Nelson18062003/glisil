# Nos wallets — le veilleur de chaîne

Glisil garde les cryptos de ses clients comme une plateforme d'échange :
chaque client a **son adresse de dépôt**, la plateforme voit arriver les dépôts,
les crédite, et envoie les retraits depuis **son wallet chaud**. Ce dossier est
le service qui fait tout cela, sans prestataire : les clés sont les nôtres.

Deux réseaux, le même service : la **BNB Smart Chain (BEP20)** et **Tron
(TRC20)**. La logique d'argent est écrite une seule fois (`src/veilleur.ts`) ;
chaque réseau ne fait que parler sa langue (`src/evm.ts`, `src/tron.ts`).

## Ce que fait le veilleur, à chaque tour (toutes les 15 s), sur chaque réseau

1. **Il garde des adresses de dépôt prêtes.** Toutes viennent d'une seule
   *graine* (24 mots) : l'adresse n° 1, n° 2, n° 3… La base ne connaît que
   l'adresse et son numéro — **jamais une clé**.
2. **Il crédite les dépôts confirmés.** Un USDT qui arrive sur l'adresse d'un
   client est crédité après ses confirmations (15 blocs BEP20, 20 blocs
   TRC20), au centime, une seule fois. Si le moteur ne répond pas, le veilleur
   ne passe pas le bloc : il le relira au tour suivant.
3. **Il balaie.** Les USDT des adresses de dépôt rejoignent le wallet chaud
   (le chaud avance les quelques centimes de BNB ou de TRX du transfert).
4. **Il envoie les retraits.** Le wallet chaud signe ; la transaction signée
   est **notée dans la base avant d'être diffusée** : si le courant coupe entre
   les deux, c'est la même transaction qui repart — un retrait ne part jamais
   deux fois.
5. **Il remplace une transaction morte, et seulement elle.** Une transaction
   notée qui ne pourra plus JAMAIS entrer dans un bloc — Tron : son échéance
   est passée (le veilleur la fixe à 2 minutes) ; BNB : son numéro d'ordre a
   été pris par une autre — est remplacée par une nouvelle. Le veilleur le
   juge sur des **blocs confirmés**, jamais sur sa propre horloge, et la base
   garde l'ancienne à côté de la nouvelle. Une transaction qui tarde n'est pas
   morte : elle n'est pas remplacée.
6. **Il met au froid.** Au-delà d'un plafond (20 000 USDT par défaut), le
   surplus du chaud part vers le **wallet froid** — sauf ce que les retraits en
   attente demandent. Il ne fait jamais l'inverse : le froid ne se signe pas
   ici.
7. **Les XAFe rendus sont détruits là où ils arrivent**, puis recrédités.
8. **Il publie ce qu'il voit** pour la page « Wallets » de l'administration :
   soldes du chaud et du froid, BNB/TRX pour les frais, alertes, adresses XAFe
   à inscrire, dépôts qui n'ont crédité personne.

Un dépôt sur une adresse jamais montrée à un client ne crédite personne : il est
gardé dans la base (`chaine_orphelins`) et affiché à l'équipe.

## Où il tourne : dans Supabase, sans serveur

Le veilleur est aussi une **fonction Supabase** (`supabase/functions/veilleur`),
réveillée **chaque minute** par pg_cron (migration 0006), un réseau par appel.
Rien à héberger, rien à garder allumé : le projet Supabase suffit.

- Ses réglages viennent de **la base** (`chaine_configuration`, migration
  0007) : les nœuds, les contrats, le froid, les confirmations dans le
  paramètre `chaine` ; le jeton du réveil dans le **coffre** de Supabase.
  Sur un réseau d'essai (`"essai": true`), la graine d'essai et la clé admin
  d'essai y sont aussi. **En production (`"essai": false`), la base ne donne
  jamais la graine** : c'est un secret de la fonction, `XAFE_GRAINE`, que le
  propriétaire saisit lui-même (Supabase → Edge Functions → Secrets). Un
  secret de la fonction passe toujours avant la base.
- Le réveil lit l'adresse de la fonction et son jeton dans le **coffre** de
  Supabase (`veilleur_url`, `veilleur_jeton`) : tant qu'ils n'y sont pas, rien
  ne part.
- Un **bail** (`chaine_prendre_tour`) garantit un seul tour à la fois par
  réseau, même si un tour dure plus d'une minute.
- Sur un **réseau d'essai seulement**, `BEP20_ADMIN_CLE_ESSAI` /
  `TRC20_ADMIN_CLE_ESSAI` laissent le veilleur inscrire lui-même les adresses
  XAFe au contrat. En production, jamais : l'admin du contrat est votre wallet
  matériel, et la page « Wallets » liste ce qu'il reste à inscrire.

Le service Node (`npm run veilleur`) reste possible ailleurs : même code, mêmes
variables (`src/service.ts`).

## En service aujourd'hui (réseau d'essai)

| | Tron Nile (essai) | BNB Smart Chain testnet |
|---|---|---|
| Contrat XAFe | `TFtfFFmagGUjxGrG3cM4MX4kTv8YvBgLnk` | `0x750E774368240063BD5CF52b30b91183Efa4dAf3` |
| USDT d'essai | `TVf3Zt1YBobZqFRj98PqDfr3RStNJ1N9pE` | `0xfDd6c413E596aE064f4d1344fBc5Af50c4078516` |
| Wallet chaud | `TEW4N3ZiF23GxHTYu8pen6r8uhHeZpALYZ` | `0x771C971497E4409d0225350C49609691E955465C` |
| Admin d'essai | `TFYWRHPe6YdfK3UUvHSy2euHS2dqgAh8Du` | `0x3d24e52b2Ea0A0cAb50163e494384a7f6027582E` |

Premier aller-retour sur chaque réseau, joué par la fonction Supabase seule :
80 USDT déposés, crédités au compte d'essai et balayés vers le chaud ; un
retrait de 20 USDT signé, envoyé et confirmé (Nile : bloc 71855181 ; BSC
testnet : bloc 137003151) ; vérifié sur chaque chaîne.
La graine et la clé admin d'essai sont dans le coffre de Supabase : elles ne
servent qu'à la monnaie d'essai, **jamais** à de l'argent réel.

## Les clés

| Clé | Où elle vit | Ce qu'elle peut faire |
|---|---|---|
| **La graine** (`XAFE_GRAINE`) | sur papier (deux exemplaires, deux lieux), et dans la configuration du service — ni dans le dépôt, ni dans la base, ni au journal | tout : elle refait toutes les adresses et le wallet chaud des deux réseaux |
| **Le wallet chaud** (adresse n° 0 de la graine, une par réseau) | dérivé de la graine | envoyer les retraits, payer les frais, frapper et détruire des XAFe (rôles `FRAPPEUR` et `DESTRUCTEUR` du contrat) |
| **L'admin du contrat XAFe** | un wallet matériel, chez vous | donner et retirer les rôles, changer le plafond de frappe du jour (`fixerPlafondJour`), reprendre après une pause (`reprendre`), inscrire une adresse qui a déjà reçu des XAFe |
| **Le pauseur, le geleur** | des wallets du propriétaire, jamais le chaud | mettre le contrat en pause (sans pouvoir reprendre) ; geler une adresse |
| **La clé de mise en service** (`CLE_DE_MISE_EN_SERVICE`) | neuve, le temps du déploiement | déployer, inscrire d'avance les adresses de dépôt XAFe NEUVES (`INSCRIPTEUR`), puis renoncer : elle ne garde aucun rôle, `verifier` le prouve, on la jette |
| **Le wallet froid** | hors ligne, une adresse par réseau | garder le gros des USDT ; le veilleur y envoie, il n'en retire jamais |

Perdre la graine, c'est perdre l'accès aux adresses de dépôt ; la voler, c'est
pouvoir vider les USDT des adresses et du chaud. **Pas la réserve de XAFe** :
elle est tenue par le contrat lui-même (`address(this)`), intransférable ; le
chaud ne peut que frapper vers des wallets dans la limite du plafond du jour
(visible à la parité, ligne « inconnue » ; gel, puis destruction des fonds
gelés par l'admin).

## La mise en service, dans l'ordre

Tout se fait avec `npm run mise-en-service -- <geste>` (voir l'en-tête de
`src/mise-en-service.ts`). D'abord sur les réseaux d'**essai** : BSC testnet et
Tron Nile.

**1. La graine — chez vous, pas sur le serveur.**
```sh
cd chaine && npm install
npm run mise-en-service -- graine
```
Elle s'affiche une fois, dans le terminal (elle refuse de s'écrire dans un
fichier ou un tuyau). Recopiez les 24 mots sur papier, deux fois, rangez-les
dans deux lieux différents. Notez les deux **wallets chauds** affichés.

**2. Des fonds d'essai pour l'admin.** Une adresse admin d'essai (pas le wallet
matériel) reçoit des BNB de test (robinet BNB Chain testnet) et des TRX de test
(robinet Nile). Les robinets demandent un captcha : c'est à vous de le faire.

**3. Déployer le contrat, donner les rôles, payer les frais du chaud.**
```sh
cd ../contracts && npx hardhat compile && cd ../chaine
ADMIN_CLE=<clé de l'admin d'ESSAI> BEP20_RPC=https://bsc-testnet-rpc.publicnode.com \
  npm run mise-en-service -- deployer --reseau bep20 --chaud <chaud BEP20> --usdt-essai
ADMIN_CLE=<la même> TRC20_NOEUD=https://nile.trongrid.io \
  npm run mise-en-service -- deployer --reseau trc20 --chaud <chaud TRC20> --usdt-essai
```
Sur Nile, l'USDT d'essai de Tron existe déjà (`TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf`,
6 décimales, donné par le robinet) : on peut remplacer `--usdt-essai` par
`--usdt TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf`. La BSC testnet n'a pas d'USDT
officiel : `--usdt-essai` y déploie le nôtre.
Chaque commande déploie XAFe (et un USDT d'essai) — le constructeur donne au
chaud `FRAPPEUR` et `DESTRUCTEUR`, pose le pauseur, le geleur, l'inscripteur et
le plafond du jour —, envoie au chaud 0,05 BNB ou 200 TRX, et écrit les lignes
de configuration du veilleur. Puis le stock d'adresses de dépôt XAFe s'inscrit
d'avance, et la clé renonce à l'inscripteur :
```sh
npm run mise-en-service -- preinscrire --reseau bep20 --xafe <contrat> --de 1 --a 2000 --renoncer
```

**4. Vérifier, puis lancer.**
```sh
XAFE_GRAINE="…24 mots…" MOTEUR_URL=https://<projet>.supabase.co/rest/v1 MOTEUR_CLE=<clé de service> \
BEP20_RPC=… BEP20_USDT=… BEP20_XAFE=… TRC20_NOEUD=… TRC20_USDT=… TRC20_XAFE=… \
BEP20_FROID=<froid BEP20> TRC20_FROID=<froid TRC20> \
  npm run mise-en-service -- verifier && npm run veilleur
```
`verifier` n'envoie rien : il contrôle la graine, le moteur, chaque nœud, les
contrats et leurs décimales, les rôles du chaud, ses frais, le froid. Il dit
précisément ce qui manque.

**5. Inscrire les adresses XAFe.** Le veilleur prépare les adresses de dépôt
XAFe ; tant qu'elles ne sont pas inscrites au contrat, aucun client n'en
reçoit. Le stock préinscrit (étape 3) les couvre ; quand il s'épuise, la page
« Wallets » le dit et un nouveau `preinscrire` s'en charge. Une adresse qui a
déjà reçu des XAFe ne s'inscrit qu'avec la clé de l'admin :
```sh
ADMIN_CLE=… BEP20_RPC=… MOTEUR_URL=… MOTEUR_CLE=… npm run mise-en-service -- inscrire --reseau bep20 --xafe <contrat>
```

**6. Ouvrir les retraits** (`crypto.retraits_ouverts`, page Paramètres) une fois
que `verifier` est vert et qu'un dépôt et un retrait d'essai sont passés.

### Variables du veilleur

| Variable | Défaut | |
|---|---|---|
| `XAFE_GRAINE`, `MOTEUR_URL`, `MOTEUR_CLE` | — | obligatoires |
| `BEP20_RPC`, `BEP20_USDT`, `BEP20_XAFE`, `BEP20_CONFIRMATIONS` | —, —, —, 15 | BNB Smart Chain (BSC-USD : `0x55d398326f99059fF775485246999027B3197955`) |
| `TRC20_NOEUD`, `TRC20_USDT`, `TRC20_XAFE`, `TRC20_CONFIRMATIONS`, `TRC20_CLE_API` | —, —, —, 20, — | Tron (USDT : `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`) ; la clé TronGrid évite les limites de débit |
| `BEP20_FROID`, `TRC20_FROID` | — | sans elles, rien ne part au froid |
| `*_PLAFOND_CHAUD_USDT`, `*_GARDER_CHAUD_USDT` | 20 000, 10 000 | au-delà du plafond, on redescend à « garder » |
| `*_NATIF_MINIMUM` | 0,01 BNB · 50 TRX | en dessous, l'alerte « manque de BNB / TRX » |
| `RESERVE_ADRESSES`, `ADRESSES_PAR_TOUR`, `SEUIL_BALAYAGE_USDT`, `PAUSE_SECONDES` | 20, 10, 50, 15 | `PAUSE_SECONDES` : le service Node seulement |
| `VEILLEUR_JETON` | — | la fonction Supabase : le jeton qu'apporte le réveil (32 caractères au moins) |
| `BEP20_ADMIN_CLE_ESSAI`, `TRC20_ADMIN_CLE_ESSAI` | — | **réseau d'essai seulement** : inscrire soi-même les adresses XAFe |

En **production**, l'admin du contrat est un wallet matériel : le plafond du
jour, la reprise et les rôles s'y signent (BscScan / TronScan, « Write
contract » ; `mise-en-service plafond --xaf N` imprime le nombre exact à
coller). `ADMIN_CLE` n'est faite que pour les réseaux d'essai.

### En production

Les secrets ne se tapent nulle part : ils vivent dans Infisical et se
synchronisent vers les secrets des fonctions Supabase (`XAFE_GRAINE`,
`BEP20_RPC`, `BEP20_BLOCS_JETON_PAR_TOUR`, `TRC20_NOEUD`, `TRC20_CLE_API`).
Le **nœud** (avec sa clé d'API) ne va jamais dans le paramètre `chaine` : les
paramètres sont lisibles par tout client connecté ; le veilleur prend alors le
nœud du secret et le reste (contrat, USDT, bloc de départ) de la base.

Le déploiement sur un réseau principal exige `--production` (le nœud est lu
avant toute signature : BSC 56, Ethereum, Base, Polygon, le nœud Tron de
production), avec `--admin`, `--pauseur`, `--geleur` et l'USDT officiel ; la
clé est `CLE_DE_MISE_EN_SERVICE`, qui préinscrit le stock d'adresses, renonce,
et se jette. L'ordre complet : [docs/PRODUCTION.md](../docs/PRODUCTION.md),
étape K.

### La bêta change de contrat

Le veilleur d'aujourd'hui ne parle plus aux contrats d'avant le correctif de la
réserve. Pour passer la bêta sur de nouveaux contrats d'essai : `pauser()` les
anciens, arrêter le veilleur, `deployer` sur les deux réseaux, `inscrire
--toutes-attribuees`, puis, sur la base de la BÊTA seulement :
```sh
psql "$BETA_DB" --single-transaction -v ON_ERROR_STOP=1 \
  -v bep20_xafe=0x… -v bep20_depart=<bloc> -v trc20_xafe=T… -v trc20_depart=<bloc> \
  -f supabase/beta/changer-de-contrat.sql
```
Le script refuse hors bêta et hors réseau d'essai. Les XAFe d'essai restés sur
des wallets externes de l'ancien contrat reviennent au compte maison, la
réserve se rejoue sur le nouveau contrat, le jeton se relit depuis le
déploiement. Relancer le veilleur, puis `verifier` ; dire aux testeurs, sur le
bandeau, que les jetons de l'ancien contrat ne valent plus rien.

## L'épreuve

```sh
npm test                                # les adresses (Hardhat, TronWeb), l'échéance Tron réécrite, les sommes de contrôle
sh ../supabase/epreuve/eprouver.sh      # tout, sur deux vraies chaînes locales et la vraie pile Supabase
```

L'épreuve (`epreuve/eprouver-les-wallets.ts`) déroule la même vie sur les deux
réseaux — une vraie chaîne EVM (Hardhat) et un vrai nœud Tron (java-tron,
image `tronbox/tre`) : un client reçoit son adresse, un dépôt de 125,50 USDT
attend ses confirmations puis est crédité une fois et balayé ; un retrait coupé
entre la signature et la diffusion repart **une seule fois** ; un retrait dont
la transaction est devenue impossible est remplacé et part une fois ; (BEP20)
une transaction qui tarde n'est pas remplacée ; le surplus part au froid en
laissant au chaud ce qu'un retrait attend ; 150 000 XAFe sont frappés, 100 000
reviennent et sont détruits puis recrédités ; et à la fin **les USDT du grand
livre sont exactement sur nos adresses** (chaud, froid, dépôts).

Avec `TEMOIN=1`, trois veilleurs fautifs rejouent la même vie, et chacun doit
tomber là où il triche : celui qui ne note pas sa transaction (le retrait part
deux fois), celui qui remplace une transaction sans demander à la chaîne (deux
fois aussi), celui qui ne remplace jamais (le retrait reste bloqué). Le second
ne se joue que sur BEP20 : le nœud Tron d'essai met chaque transaction dans un
bloc tout de suite, une transaction n'y tarde jamais — sur Tron, c'est
l'échéance, vérifiée sur un bloc confirmé, qui protège.
