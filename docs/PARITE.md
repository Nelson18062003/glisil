# La parité : 1 XAFe = 1 XAF, prouvé

Le dire ne prouve rien. Trois chiffres, venus de trois sources qui ne se
connaissent pas, doivent se tenir — et n'importe qui doit pouvoir le
vérifier sans croire Glisil sur parole.

| Colonne | Ce que c'est | D'où ça vient |
|---|---|---|
| **1. Les floats** | l'argent réellement posé chez MTN et Orange | le solde que l'**opérateur** annonce : le « nouveau solde » de chaque SMS relevé par TOTEM, une consultation USSD, ou le **relevé officiel** saisi par l'équipe avec son fichier. Jamais un calcul à nous. |
| **2. Le registre** | ce que Glisil doit à ses clients | `emissions` : chaque XAFe émis contre des XAF reçus, moins chaque XAFe détruit contre des XAF payés |
| **3. La chaîne** | les XAFe qui existent | relus par le veilleur **sur la chaîne elle-même**, transaction par transaction depuis le déploiement du contrat — pas dans ses propres notes d'envoi |

## Les règles, vérifiées toutes les cinq minutes (`rapprocher()`, pg_cron)

1. **Chaîne = registre, au franc près**, une fois comptées les opérations en
   route (une frappe partie, pas encore dans un bloc).
2. **Ligne par ligne** : chaque frappe et chaque destruction lue sur la
   chaîne a sa ligne dans le registre — même référence (par son empreinte
   keccak256), même sens, même montant — et l'inverse. Les verdicts :
   `concorde`, `en_route`, `en_retard` (au-delà de 30 min), `refusee`,
   `ecart`, `inconnue` (lue sur la chaîne, le registre ne l'explique pas).
3. **La lecture n'a rien manqué** : l'offre lue au contrat (`totalSupply`, au
   même bloc) = la somme des mouvements relus.
4. **Floats ≥ registre.** Pas l'égalité : les floats portent aussi les frais
   gagnés et l'argent propre de l'entreprise. L'excédent se montre. Un float
   dont le solde a plus de 24 h est « non connu » — jamais 0.

Chaque anomalie ouvre une **alarme** (page Parité de l'administration,
tableau de bord). Vue deux relevés de suite (pour ne pas crier sur une
opération à mi-chemin), elle part **par SMS**, une fois, au numéro posé dans
Paramètres → `parite.alerte_numero` (envoyé par une puce TOTEM). Ce qui
redevient vrai se ferme tout seul.

## Où le voir

- **Tout le monde, sans compte** : `app.glisil.com/preuve` — les trois
  colonnes, l'historique horaire, chaque transaction avec son lien BscScan /
  Tronscan. Aucun nom ni numéro de client.
- **Le client** : sur chaque dépôt (écran « XAFe crédités », détail dans
  l'historique), la carte « Sur la blockchain » et le **reçu PDF**, qui porte
  la transaction, son bloc, l'empreinte et un code à scanner.
- **L'équipe** : Administration → Parité (saisie des relevés d'opérateur,
  alarmes, réglage du SMS).

## Le vérifier soi-même

1. Ouvrir le contrat XAFe dans l'explorateur : son *Total supply* est la colonne 3.
2. Pour une référence (`XAFe-DP-000003`), calculer `keccak256("XAFe-DP-000003")`
   (n'importe quel outil Ethereum) : c'est l'empreinte inscrite dans
   l'événement `Frappe` de la transaction. Le contrat refuse de frapper deux
   fois sous la même.
3. Comparer au relevé de l'opérateur (export MTN / Orange) : la colonne 1.

## Les pièces

| Pièce | Rôle |
|---|---|
| `supabase/migrations/0015_reserve_sur_la_chaine.sql` | chaque ligne d'`emissions` devient une opération sur la réserve |
| `supabase/migrations/0016_parite.sql` | soldes des floats, lecture de la chaîne, rapprochement, alarmes, page publique |
| `chaine/src/veilleur.ts` — `jouerReserve`, `lireLeJeton` | frappe/détruit dans l'ordre ; relit chaque `Transfer` depuis/vers l'adresse zéro |
| `chaine/src/chaine.ts` — `mouvementsDepuisJournaux` | le `Transfer` standard fait foi ; l'empreinte vient du `Frappe`/`Detruit` de la même transaction |
| `supabase/functions/_shared/porte.ts` — `noterSolde` | les soldes que TOTEM relève, signés |
| TOTEM `totem/xafe.py` — `publier_solde`, `solde_apres` | le « nouveau solde » de chaque SMS d'argent et les consultations USSD |
| `moteur/scenarios.sql` 11.38 | chaque façon de mentir déclenche son alarme |

## La garde des faux SMS : la continuité des soldes (0039)

N'importe qui peut écrire à une puce. Un faux « Vous avez reçu 7 500 000 XAF
… », suivi de la même déclaration, était crédité. Le SMS de l'opérateur porte
pourtant de quoi le démasquer : le **nouveau solde** du float. Glisil ne
crédite un encaissement que si

    dernier solde SÛR du float + montant (+ commission, − frais) = nouveau solde annoncé

au franc près. Sinon le SMS est **retenu, bloqué** : ni crédité, ni rapproché,
ni remboursé. Le client voit « Paiement en vérification ».

- **Un solde sûr** : une consultation USSD faite par le boîtier, un relevé
  déposé par l'équipe (page Parité), ou un SMS déjà vérifié. Un solde lu dans
  un SMS seul n'en est jamais un.
- **Le désordre se répare seul** : à chaque nouveau solde sûr, les SMS qui
  suivent sont réexaminés. Les sorties (les paiements faits depuis la puce)
  prolongent la chaîne.
- **L'équipe tranche** (Entrées → SMS retenus, « Solde à vérifier ») : vérifier
  le transaction ID dans l'historique de l'opérateur (*126#, #150#), puis
  **Libérer** avec une note (cocher « point de départ » si le solde annoncé est
  bien celui de l'opérateur : les SMS suivants se vérifient d'eux-mêmes), ou
  **Rejeter : faux SMS**.
- **Le réglage** `continuite` : `exiger` (défaut), `surveiller` (crédité mais
  signalé), `eteinte` ; la démo est exemptée (`demo: eteinte`).
- **La page publique arrondit** les floats et la couverture au million
  inférieur : la garde ne vaut que tant que le solde exact reste secret. Pour
  la même raison, les puces des floats n'ont ni vendeur ni groupe Telegram.

### Avant d'ouvrir les dépôts réels : une consultation de solde par float

Sans solde sûr, le **premier** SMS de chaque float est retenu (« premier solde
du float inconnu »). C'est voulu : sinon un faussaire choisirait le point de
départ. À la mise en service, pour chaque puce float, faire une consultation
de solde depuis TOTEM (bouton Solde) — avec le robot à jour, qui l'étiquette
« ussd » — ou déposer un relevé de l'opérateur (page Parité). Si un mouvement
échappe au robot (un virement de commissions, un achat de crédit), la chaîne
se rompt : refaire une consultation de solde suffit à la réparer.

## La réserve tenue par le contrat, le plafond du jour (0040)

La réserve de XAFe n'est plus sur un wallet : **le contrat la tient lui-même**
(`address(this)`), intransférable — elle se frappe et se détruit, rien d'autre.
La page de preuve et la trace de chaque mouvement montrent donc l'adresse du
CONTRAT comme réserve, avec le plafond de frappe du jour et l'état de pause.

| Rôle | Qui | Ce qu'il peut |
|---|---|---|
| admin (`DEFAULT_ADMIN_ROLE`) | le wallet matériel du propriétaire, seul | rôles, `fixerPlafondJour`, `reprendre`, inscrire une adresse déjà servie, détruire des fonds gelés |
| frappeur, destructeur | le wallet chaud | frapper vers un wallet (sous le plafond du jour) ou dans la réserve (sans plafond) ; détruire dans la réserve ou sur une adresse de dépôt inscrite |
| pauseur, geleur | wallets du propriétaire | arrêter (sans reprendre) ; geler une adresse |
| inscripteur | la clé de mise en service, le temps du stock | inscrire des adresses de dépôt neuves, puis renoncer |

Le plafond du jour ne compte que les frappes vers des wallets externes. Quand
il est atteint, le veilleur garde les retraits XAFe suivants **dans l'ordre**,
jusqu'à minuit UTC ou jusqu'à ce que l'admin relève le plafond ; la page
Wallets le dit. Elle dit aussi, en rouge, la pause du contrat et tout XAFe
qui dormirait sur le wallet chaud (il ne doit jamais en tenir).

Un réseau qui change de contrat (la bêta seulement) porte
`chaine.<réseau>.depuis_le` : les retraits et retours faits sur l'ancien ne
sont plus attendus sur le nouveau ; la réserve, rejouée, l'est. En production,
le réglage n'existe pas et rien n'est filtré.

## Le vrai réseau (livraison 1)

Le passage aux réseaux principaux suit [PRODUCTION.md](PRODUCTION.md), étape K :

1. **Le contrat corrigé** : la réserve tenue par le contrat (0040), le plafond
   de frappe d'un milliard de XAF par jour et par chaîne, que l'admin change à
   tout moment, les rôles posés au déploiement, la clé de mise en service qui
   renonce à tout et se jette.
2. **L'admin** : dès le déploiement, un **Safe 2 sur 3** (trois comptes
   MetaMask du propriétaire) sur BSC, et un compte TronLink dont la permission
   propriétaire est à 2 sur 3 sur Tron (la transmission de l'admin a en plus un
   délai de deux jours). Pauseur et geleur : un compte du propriétaire, seul,
   pour arrêter vite.
3. **La graine de production** n'est jamais dans la base : un secret des
   fonctions (Infisical), et deux copies papier.
4. **Les floats dédiés** à Glisil, et une consultation de solde par puce avant
   le premier dépôt réel (la garde des faux SMS, plus haut).
5. **Le profil de production** (0041) : aucun argent de test ne peut exister
   sur la base de production.
