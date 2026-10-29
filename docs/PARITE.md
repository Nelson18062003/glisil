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

## Avant le vrai réseau (mainnet) — à faire, pas encore fait

Aujourd'hui tout tourne sur les **réseaux d'essai** (BSC testnet, Tron Nile) :
les jetons n'y ont pas de valeur. Avant d'émettre de vrais XAFe :

1. **Audit du contrat** par une société indépendante (le contrat a déjà ses
   épreuves : 11 tests, Slither sans constat, Echidna 100 000 appels — ce
   n'est pas un audit).
2. **Clés à plusieurs signatures** :
   - `DEFAULT_ADMIN_ROLE` → un **Safe** (BSC) 2-sur-3 sur wallets matériels ;
     sur Tron, une permission multi-signature du compte admin. La
     transmission de l'admin a déjà un délai de deux jours.
   - `PAUSEUR_ROLE` et `GELEUR_ROLE` → personnes distinctes du signataire chaud.
   - Le signataire chaud (`FRAPPEUR`/`DESTRUCTEUR`) garde le **plafond de
     frappe par jour** ; le fixer au volume réel attendu, pas plus.
3. **La graine de production** n'est jamais dans la base : un secret de la
   fonction `veilleur`, saisi par le propriétaire (`chaine/README.md`).
4. **Les floats dédiés** : tant qu'un float sert aussi à Bonzini, la colonne 1
   mélange deux activités ; la couverture reste vraie, mais moins lisible.
5. **Un rapprochement mensuel signé par un comptable** (relevés opérateurs +
   page de preuve + export de `parite_releves`), publié.
6. Déployer le contrat sur mainnet, poser `chaine.essai = false`, les
   adresses et le bloc de départ (`depart`) de chaque réseau.
