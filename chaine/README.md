# Nos wallets — le veilleur de chaîne

XAFe Exchange garde les cryptos de ses clients comme une plateforme d'échange :
chaque client a **son adresse de dépôt**, la plateforme voit arriver les dépôts,
les crédite, et envoie les retraits depuis **son wallet chaud**. Ce dossier est
le service qui fait tout cela, sans prestataire : les clés sont les nôtres.

## Ce que fait le veilleur, à chaque tour (toutes les 15 s)

1. **Il garde des adresses de dépôt prêtes.** Toutes viennent d'une seule
   *graine* (12 ou 24 mots) : l'adresse n° 1, n° 2, n° 3… La base ne connaît que
   l'adresse et son numéro — **jamais une clé**.
2. **Il crédite les dépôts confirmés.** Un USDT qui arrive sur l'adresse d'un
   client est crédité après 15 blocs (BNB Smart Chain), au centime, une seule
   fois — relire la chaîne ne crédite pas deux fois.
3. **Il balaie.** Les USDT des adresses de dépôt rejoignent le wallet chaud
   (le chaud avance les quelques centimes de BNB que coûte le transfert).
4. **Il envoie les retraits.** Le wallet chaud signe ; la transaction signée
   est **notée dans la base avant d'être diffusée** : si le courant coupe entre
   les deux, c'est la même transaction qui repart — un retrait ne part jamais
   deux fois.
5. **Les XAFe rendus sont détruits là où ils arrivent**, puis recrédités.

Un dépôt sur une adresse qui n'a jamais été montrée à un client ne crédite
personne : le veilleur écrit `ALERTE` dans son journal.

## Les clés

| Clé | Où elle vit | Ce qu'elle peut faire |
|---|---|---|
| **La graine** (`XAFE_GRAINE`) | dans le service seulement — ni dans le dépôt, ni dans la base, ni au journal | tout : elle refait toutes les adresses et le wallet chaud |
| **Le wallet chaud** (adresse n° 0 de la graine) | dérivé de la graine | envoyer les retraits, payer le gaz, frapper et détruire des XAFe (rôles `FRAPPEUR` et `DESTRUCTEUR` du contrat) |
| **L'admin du contrat** | un wallet matériel, chez vous | inscrire les adresses de dépôt XAFe (`src/inscrire.ts`), donner les rôles, reprendre des fonds gelés |
| **Le wallet froid** | hors ligne | garder le gros des USDT : on y envoie, à la main, ce qui dépasse le besoin du chaud |

Perdre la graine, c'est perdre l'accès aux adresses de dépôt ; la voler, c'est
pouvoir tout vider. **Elle s'écrit sur papier, en deux exemplaires, dans deux
lieux différents**, et ne se tape que sur la machine du service.

## En test (aujourd'hui)

```sh
cd chaine && npm install
npm test                      # les adresses : celles de Hardhat, et celle que TronWeb publie pour une clé connue
sh ../supabase/epreuve/eprouver.sh   # tout, sur une vraie chaîne EVM locale et la vraie pile Supabase
```

L'épreuve (`epreuve/eprouver-les-wallets.ts`) déroule une vie entière : un client
reçoit son adresse, un dépôt de 125,50 USDT attend ses confirmations puis est
crédité une fois, il est balayé vers le chaud, un retrait de 50 USDT est coupé
entre la signature et la diffusion puis repart **une seule fois**, 150 000 XAFe
sont frappés vers un wallet, 100 000 reviennent et sont détruits puis
recrédités, et à la fin **les USDT du grand livre sont exactement sur nos
adresses**. Son témoin (`TEMOIN=1`) rejoue la même vie avec un veilleur qui ne
note pas sa transaction avant de la diffuser : le retrait part deux fois, et
l'épreuve échoue — comme elle doit.

## En production (BNB Smart Chain)

```sh
XAFE_GRAINE="…24 mots…" \
MOTEUR_URL=https://<projet>.supabase.co/rest/v1 MOTEUR_CLE=<clé de service> \
BEP20_RPC=https://bsc-dataseed.bnbchain.org BEP20_USDT=0x55d398326f99059fF775485246999027B3197955 \
BEP20_XAFE=<adresse du contrat XAFe> BEP20_CONFIRMATIONS=15 \
npm run veilleur
```

Avant d'ouvrir les retraits (`crypto.retraits_ouverts` dans Paramètres) :
donner au wallet chaud les rôles `FRAPPEUR` et `DESTRUCTEUR`, lui envoyer un peu
de BNB pour le gaz, inscrire les premières adresses XAFe avec la clé admin, et
faire tourner le veilleur d'abord sur le **BSC testnet**.

## Ce qui n'est pas encore fait

- **TRC20 (Tron)** : les adresses Tron se dérivent déjà (et l'adresse calculée
  est celle que Tron calcule), mais le veilleur ne lit ni n'envoie encore sur
  Tron. Les dépôts TRC20 restent fermés.
- **Le wallet froid** : le veilleur ne déplace rien vers lui tout seul ; c'est un
  geste à la main, pour l'instant.
