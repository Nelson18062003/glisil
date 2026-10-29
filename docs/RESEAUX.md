# Les réseaux : un solde, plusieurs chaînes

Comment Glisil tient le XAFe et l'USDT sur plusieurs blockchains (BSC, Tron,
puis Ethereum, Base, Polygon, et un jour Solana) sans jamais compter deux fois
le même franc. Le registre vit dans la base (migration 0018) ; ce document dit
pourquoi il est fait ainsi.

## 1. Ce que voit le client : un solde, puis un réseau

Comme chez Binance, le client a **un** solde de XAFe et **un** solde d'USDT.
Le réseau n'existe qu'au moment où l'argent entre ou sort :

- **Déposer des USDT** : il choisit le réseau (BEP20, TRC20…), et reçoit
  l'adresse de CE réseau. Chaque réseau a sa propre adresse.
- **Retirer** : il colle l'adresse de son wallet. Une adresse `T…` n'existe
  que sur Tron : le réseau est pris d'office. Une adresse `0x…` vaut pour
  **tous** les réseaux EVM (BSC, Ethereum, Base, Polygon ont la même forme) :
  dès que deux réseaux EVM sont ouverts, l'écran **demande** lequel, et ne
  coche rien d'office. Envoyer sur la mauvaise chaîne est l'erreur la plus
  coûteuse de la crypto ; l'écran ne la commet pas à la place du client.

La liste des réseaux vient du moteur (`parametres_publics → crypto.reseaux`) :
quand l'équipe ouvre Base, l'application le propose sans être recompilée.

## 2. Ce qui se passe sur les chaînes : la réserve maison

La réserve de XAFe vit sur **un** réseau, le réseau maison : **BSC** (BEP20).
Chaque XAF reçu sur un float MoMo/OM devient un XAFe **frappé dans la réserve**
(migration 0015) ; chaque XAF rendu détruit un XAFe de la réserve.

**La réserve est tenue par le contrat lui-même** (`address(this)`), et elle est
**intransférable** : elle ne fait que se frapper (`frapperReserve`) et se
détruire (`detruireReserve`). Rien n'y entre par transfert, rien n'en sort
sinon brûlé — une clé chaude volée ne peut pas la vider. Son adresse, sur la
page de preuve et dans la trace de chaque mouvement, est celle du contrat
(0040). Le contrat borne aussi la frappe vers les wallets externes : un
**plafond par jour et par chaîne** (1 000 000 000 XAF au départ), que l'admin
du contrat change à tout moment ; la réserve n'y est pas soumise.

Un retrait de XAFe vers le wallet d'un client, sur un réseau R :

1. les XAFe sont **détruits** dans la réserve, sur BSC ;
2. les mêmes XAFe sont **créés** sur R, à l'adresse du client.

C'est le principe du « burn and mint » de Circle (CCTP) pour l'USDC : jamais de
pont qui « garde » des jetons verrouillés, jamais deux copies du même franc. Un
retour (le client renvoie des XAFe à son adresse de dépôt) fait l'inverse.

La conséquence, vérifiée toutes les cinq minutes par la parité (0016) :

    somme, sur tous les réseaux, des XAFe en circulation  =  registre de Glisil  ≤  floats MoMo/OM

Ce n'est pas un réseau qui doit égaler le registre, c'est **leur somme**.

**Livraison 1** : BSC (BEP20, le réseau maison, où vit la réserve) puis Tron
(TRC20, ouvert après l'essai de bout en bout). Ethereum reste fermé jusqu'à
la livraison 2, avec l'USDC (natif sur Ethereum, « Binance-Peg » sur BSC ;
pas de Tron, que Circle a quitté).

## 3. Le registre (table `reseaux`, migration 0018)

| Réseau | Famille | Compte HD | Frais en | État au départ |
|---|---|---|---|---|
| BNB Smart Chain (BEP20) | EVM | 0 | BNB | ouvert, **maison** |
| Tron (TRC20) | Tron | 0 | TRX | ouvert |
| Ethereum (ERC20) | EVM | 1 | ETH | fermé : contrat à déployer |
| Base | EVM | 2 | ETH | fermé : contrat à déployer |
| Polygon | EVM | 3 | POL | fermé : contrat à déployer |
| Solana (SPL) | Solana | — | SOL | fermé : **aucun veilleur ne sait le lire** |

- **Ouvert** (`actif`) : les clients y déposent et y retirent. Seule
  l'équipe (droit « paramètres ») ouvre ou ferme, depuis Wallets → Réseaux.
- Le moteur **refuse d'ouvrir** un réseau sans contrat XAFe posé, ou qu'aucun
  veilleur ne sait lire (Solana). Il refuse de **fermer** le réseau maison.
- **Fermer** n'abandonne rien : les retraits déjà demandés partent, et ce qui
  arrive encore sur une adresse déjà donnée est crédité. Le veilleur continue
  tant que le réseau est configuré.
- Un réseau inconnu du registre n'entre nulle part : les tables d'adresses,
  de retraits, de réserve et de mouvements ont une clé étrangère vers lui.

### Pourquoi un compte de dérivation par réseau

Toutes les adresses découlent d'une seule graine. Sur EVM, le chemin est
`m/44'/60'/<compte>'/0/<i>`. BSC garde le compte 0 (ses adresses d'avant ne
bougent pas) ; Ethereum, Base et Polygon ont chacun le leur. Deux réseaux EVM
n'ont donc **jamais** la même adresse de dépôt :

- la base exige qu'une adresse ne serve qu'une fois ;
- un USDT envoyé par erreur sur Base à une adresse BSC arrive quand même à une
  adresse que la graine contrôle : il se récupère, à la main (il apparaît dans
  « Dépôts qui n'ont crédité personne » une fois Base veillé).

Le même registre est écrit dans le code (`chaine/src/cles.ts`). Un test
(`cles.test.ts`) exige que les deux disent la même famille et le même compte,
et le veilleur **refuse de tourner** si la base et le code divergent : sinon
une clé ne se retrouverait plus.

## 4. Ouvrir un nouveau réseau EVM (Base, par exemple)

1. **Essai** : sur Base Sepolia,
   `npm run mise-en-service -- deployer --reseau base --chaud <adresse>` (avec
   `BASE_RPC` et `ADMIN_CLE`). La commande déploie le contrat XAFe — le
   constructeur pose tous les rôles et le plafond du jour —, envoie de l'ETH au
   wallet chaud pour les frais ; puis `preinscrire … --renoncer` inscrit le
   stock d'adresses de dépôt XAFe neuves.
2. **Configurer** : le paramètre `chaine` reçoit
   `"base": { "noeud": …, "xafe": …, "usdt": … }`. Le déclencheur de 0018
   recalcule les tâches : le veilleur de Base tourne dans la minute.
3. **Vérifier** : `npm run mise-en-service -- verifier`, puis un dépôt et un
   retrait de bout en bout, et la parité qui reste à zéro.
4. **Ouvrir** : Wallets → Réseaux → Base → Ouvrir.
5. **Production** : la même chose sur le vrai réseau, avec l'admin du contrat
   sur un wallet matériel (voir PARITE.md, « avant le vrai réseau »).

Les conditions générales nomment les réseaux (« BEP20, TRC20 ») : les mettre à
jour, avec une nouvelle version, le jour où un réseau s'ouvre.

## 5. Solana : ce qui manque

Solana n'est pas EVM : ni la même forme d'adresse, ni les mêmes clés
(ed25519), ni les mêmes jetons (SPL). Il faut :

- un **contrat** XAFe en programme SPL (Token-2022, avec une autorité de
  frappe et de destruction tenue par le wallet chaud, et les empreintes de
  référence en mémo) ;
- un **adaptateur** `chaine/src/solana.ts` qui implémente l'interface `Chaine`
  (lire les transferts vers nos adresses, envoyer, frapper, détruire, lire
  l'offre) ;
- la dérivation `m/44'/501'/<i>'/0'` ajoutée à `cles.ts`, et la famille
  `solana` déclarée lisible dans `_reseau_lisible` (0018).

D'ici là, le registre la porte fermée, et le moteur refuse de l'ouvrir.

## 6. Comment on le prouve

- `moteur/scenarios.sql`, **11.40** : réseau inconnu refusé partout ; fermé,
  pas d'adresse ni de retrait ; adresse de la mauvaise famille refusée ;
  ouverture refusée sans contrat, sans veilleur, ou par le support ; le réseau
  maison ne se ferme pas ; le veilleur, ses tâches et la parité suivent le
  registre ; fermer n'abandonne pas un retrait en route.
- `chaine/src/cles.test.ts` : adresses de BSC inchangées, aucun réseau ne
  partage une adresse avec un autre, registre du code = registre de la base
  (le test échoue si l'on donne à Base le compte de BSC).
- `app/src/noyau/noyau.test.ts` : une adresse `0x` avec Base ouvert n'est pas
  choisie d'office ; une adresse `T` l'est ; une liste abîmée garde l'ancienne.
- `app/scripts/parcourir.mjs` et `admin/scripts/parcourir.mjs` : l'écran,
  vraiment cliqué (Base au dépôt, le choix au retrait, l'ouverture par l'équipe).
