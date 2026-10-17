# La carte des écrans

*Tirée du code par `app/scripts/carte.mjs` — ne pas modifier à la main. Relancer `node scripts/carte.mjs` après tout changement de navigation.*

48 écrans · 134 passages (sans compter la barre d'onglets, présente sur les quatre écrans racines).

## Les modules et leurs passages

```mermaid
flowchart LR
  subgraph m_Entrerdanslapplication["Entrer dans l'application"]
    conditions["/conditions"]
    confidentialite["/confidentialite"]
    preuve["/preuve"]
    bienvenue["/bienvenue"]
    bienvenue_code["/bienvenue/code"]
    bienvenue_inscription["/bienvenue/inscription"]
    bienvenue_profil["/bienvenue/profil"]
  end
  subgraph m_Accueil["Accueil"]
    accueil["/"]
    notifications["/notifications"]
  end
  subgraph m_EntrerdesXAF["Entrer des XAF"]
    entrer_operateur["/entrer/operateur"]
    entrer_montant["/entrer/montant"]
    entrer_payer__ref["/entrer/payer/:ref"]
    entrer_transaction__ref["/entrer/transaction/:ref"]
    entrer_credite__ref["/entrer/credite/:ref"]
  end
  subgraph m_SortirdesXAF["Sortir des XAF"]
    sortir_montant["/sortir/montant"]
    sortir_destination["/sortir/destination"]
    sortir_verifier["/sortir/verifier"]
    sortir_code["/sortir/code"]
    sortir_envoye__ref["/sortir/envoye/:ref"]
  end
  subgraph m_Marche["Marché"]
    marche["/marche"]
    marche_graphique["/marche/graphique"]
    marche_carnet["/marche/carnet"]
    marche_ordres["/marche/ordres"]
    marche_ordres__id["/marche/ordres/:id"]
    marche_execute__id["/marche/execute/:id"]
  end
  subgraph m_Achatrapide["Achat rapide"]
    rapide["/rapide"]
    rapide_prix["/rapide/prix"]
    rapide_fait["/rapide/fait"]
  end
  subgraph m_Crypto["Crypto"]
    crypto["/crypto"]
    crypto_deposer__actif["/crypto/deposer/:actif"]
    crypto_retirer__actif_adresse["/crypto/retirer/:actif/adresse"]
    crypto_retirer__actif_montant["/crypto/retirer/:actif/montant"]
    crypto_retirer__actif_verifier["/crypto/retirer/:actif/verifier"]
    crypto_retirer__actif_code["/crypto/retirer/:actif/code"]
    crypto_envoye__ref["/crypto/envoye/:ref"]
  end
  subgraph m_Historique["Historique"]
    historique["/historique"]
    historique__ref["/historique/:ref"]
  end
  subgraph m_Compte["Compte"]
    compte["/compte"]
    compte_numeros["/compte/numeros"]
    compte_numeros_ajouter["/compte/numeros/ajouter"]
    compte_paliers["/compte/paliers"]
    compte_paliers_identite["/compte/paliers/identite"]
    compte_paliers_entreprise["/compte/paliers/entreprise"]
    compte_securite["/compte/securite"]
    compte_api["/compte/api"]
    compte_aide["/compte/aide"]
    compte_informations["/compte/informations"]
    compte_fermer["/compte/fermer"]
  end
  accueil --> compte
  accueil --> notifications
  accueil --> preuve
  accueil --> entrer_transaction__ref
  accueil --> entrer_operateur
  accueil --> sortir_montant
  accueil --> crypto
  accueil --> marche
  accueil --> rapide
  accueil --> compte_numeros_ajouter
  accueil --> compte_paliers_identite
  accueil --> historique
  bienvenue --> bienvenue_code
  bienvenue_code --> bienvenue
  bienvenue_code --> bienvenue_inscription
  bienvenue_code --> bienvenue_profil
  bienvenue_code --> accueil
  bienvenue_inscription --> bienvenue
  bienvenue_inscription --> bienvenue_profil
  compte --> compte_informations
  compte --> compte_numeros
  compte --> compte_paliers
  compte --> compte_securite
  compte --> compte_api
  compte --> compte_aide
  compte_numeros --> compte_numeros_ajouter
  compte_paliers --> compte_paliers_identite
  compte_paliers --> compte_paliers_entreprise
  compte_paliers_identite --> compte_paliers
  compte_paliers_entreprise --> compte_paliers
  compte_informations --> compte_fermer
  compte_fermer --> marche_ordres
  compte_fermer --> historique
  crypto --> rapide
  crypto --> crypto_deposer__actif
  crypto --> crypto_retirer__actif_adresse
  crypto_retirer__actif_adresse --> crypto_retirer__actif_montant
  crypto_retirer__actif_montant --> crypto_retirer__actif_verifier
  crypto_retirer__actif_verifier --> crypto_retirer__actif_adresse
  crypto_retirer__actif_verifier --> crypto_retirer__actif_code
  crypto_retirer__actif_code --> crypto_retirer__actif_adresse
  crypto_retirer__actif_code --> crypto_envoye__ref
  crypto_envoye__ref --> accueil
  crypto_envoye__ref --> historique__ref
  entrer_operateur --> entrer_montant
  entrer_montant --> entrer_operateur
  entrer_montant --> entrer_payer__ref
  entrer_payer__ref --> entrer_operateur
  entrer_payer__ref --> entrer_transaction__ref
  entrer_transaction__ref --> entrer_credite__ref
  entrer_credite__ref --> historique__ref
  entrer_credite__ref --> marche
  entrer_credite__ref --> accueil
  entrer_credite__ref --> entrer_operateur
  historique --> entrer_operateur
  historique__ref --> marche_ordres__id
  historique__ref --> entrer_transaction__ref
  historique__ref --> compte_aide
  conditions --> accueil
  confidentialite --> accueil
  marche --> marche_graphique
  marche --> rapide
  marche --> marche_carnet
  marche --> marche_ordres
  marche --> marche_ordres__id
  marche_ordres --> marche_ordres__id
  marche --> marche_execute__id
  marche_graphique --> marche
  marche_graphique --> marche_carnet
  marche_carnet --> marche
  marche_execute__id --> marche
  marche_execute__id --> accueil
  preuve --> accueil
  preuve --> conditions
  preuve --> confidentialite
  rapide --> entrer_operateur
  rapide --> crypto_deposer__actif
  rapide --> rapide_prix
  rapide_prix --> rapide
  rapide_prix --> rapide_fait
  rapide_fait --> accueil
  rapide_fait --> marche
  sortir_montant --> crypto_retirer__actif_adresse
  sortir_montant --> marche_ordres
  sortir_montant --> accueil
  sortir_montant --> entrer_operateur
  sortir_montant --> compte_numeros
  sortir_montant --> compte_numeros_ajouter
  sortir_montant --> sortir_destination
  sortir_destination --> compte_numeros_ajouter
  sortir_destination --> sortir_verifier
  sortir_verifier --> sortir_montant
  sortir_verifier --> sortir_code
  sortir_code --> sortir_montant
  sortir_code --> sortir_envoye__ref
  sortir_envoye__ref --> accueil
  sortir_envoye__ref --> historique__ref
```

Les flèches « retour » et les onglets ne sont pas dessinés : chaque écran en a, le tableau ci-dessous le dit.

## Écran par écran

| Écran | Touchers depuis l'Accueil | On en sort par | Mène vers |
|---|---|---|---|
| `/conditions` | 0 | flèche, lien | `/` |
| `/confidentialite` | 0 | flèche, lien | `/` |
| `/preuve` | 0 | lien | `/` `/conditions` `/confidentialite` |
| `/bienvenue` | 0 | lien | `/bienvenue/code` |
| `/bienvenue/code` | 1 | flèche, lien | `/bienvenue` `/bienvenue/inscription` `/bienvenue/profil` `/` |
| `/bienvenue/inscription` | 2 | flèche, lien | `/bienvenue` `/bienvenue/profil` |
| `/bienvenue/profil` | 2 | flèche | — |
| `/` | 0 | onglets, lien | `/compte` `/notifications` `/preuve` `/entrer/transaction/:ref` `/entrer/operateur` `/sortir/montant` `/crypto` `/marche` `/rapide` `/compte/numeros/ajouter` `/compte/paliers/identite` `/historique` |
| `/notifications` | 1 | flèche | — |
| `/entrer/operateur` | 1 | flèche, lien | `/entrer/montant` |
| `/entrer/montant` | 2 | flèche, lien | `/entrer/operateur` `/entrer/payer/:ref` |
| `/entrer/payer/:ref` | 3 | flèche, lien | `/entrer/operateur` `/entrer/transaction/:ref` |
| `/entrer/transaction/:ref` | 1 | flèche, lien | `/entrer/credite/:ref` |
| `/entrer/credite/:ref` | 2 | lien | `/historique/:ref` `/marche` `/` `/entrer/operateur` |
| `/sortir/montant` | 1 | flèche, lien | `/crypto/retirer/:actif/adresse` `/marche/ordres` `/` `/entrer/operateur` `/compte/numeros` `/compte/numeros/ajouter` `/sortir/destination` |
| `/sortir/destination` | 2 | flèche, lien | `/compte/numeros/ajouter` `/sortir/verifier` |
| `/sortir/verifier` | 3 | flèche, lien | `/sortir/montant` `/sortir/code` |
| `/sortir/code` | 4 | flèche, lien | `/sortir/montant` `/sortir/envoye/:ref` |
| `/sortir/envoye/:ref` | 5 | lien, flèche | `/` `/historique/:ref` |
| `/marche` | 1 | lien, onglets | `/marche/graphique` `/rapide` `/marche/carnet` `/marche/ordres` `/marche/ordres/:id` `/marche/execute/:id` |
| `/marche/graphique` | 2 | flèche, lien | `/marche` `/marche/carnet` |
| `/marche/carnet` | 2 | flèche, lien | `/marche` |
| `/marche/ordres` | 2 | lien, flèche | `/marche/ordres/:id` |
| `/marche/ordres/:id` | 2 | flèche | — |
| `/marche/execute/:id` | 2 | flèche, lien | `/marche` `/` |
| `/rapide` | 1 | flèche, lien | `/entrer/operateur` `/crypto/deposer/:actif` `/rapide/prix` |
| `/rapide/prix` | 2 | flèche, lien | `/rapide` `/rapide/fait` |
| `/rapide/fait` | 3 | lien | `/` `/marche` |
| `/crypto` | 1 | flèche, lien | `/rapide` `/crypto/deposer/:actif` `/crypto/retirer/:actif/adresse` |
| `/crypto/deposer/:actif` | 2 | flèche | — |
| `/crypto/retirer/:actif/adresse` | 2 | flèche, lien | `/crypto/retirer/:actif/montant` |
| `/crypto/retirer/:actif/montant` | 3 | flèche, lien | `/crypto/retirer/:actif/verifier` |
| `/crypto/retirer/:actif/verifier` | 4 | flèche, lien | `/crypto/retirer/:actif/adresse` `/crypto/retirer/:actif/code` |
| `/crypto/retirer/:actif/code` | 5 | flèche, lien | `/crypto/retirer/:actif/adresse` `/crypto/envoye/:ref` |
| `/crypto/envoye/:ref` | 6 | lien | `/` `/historique/:ref` |
| `/historique` | 1 | onglets, lien | `/entrer/operateur` |
| `/historique/:ref` | 2 | flèche, lien | `/marche/ordres/:id` `/entrer/transaction/:ref` `/compte/aide` |
| `/compte` | 1 | onglets, lien | `/compte/informations` `/compte/numeros` `/compte/paliers` `/compte/securite` `/compte/api` `/compte/aide` |
| `/compte/numeros` | 2 | flèche, lien | `/compte/numeros/ajouter` |
| `/compte/numeros/ajouter` | 1 | flèche | — |
| `/compte/paliers` | 2 | flèche, lien | `/compte/paliers/identite` `/compte/paliers/entreprise` |
| `/compte/paliers/identite` | 1 | flèche, lien | `/compte/paliers` |
| `/compte/paliers/entreprise` | 3 | flèche, lien | `/compte/paliers` |
| `/compte/securite` | 2 | flèche | — |
| `/compte/api` | 2 | flèche | — |
| `/compte/aide` | 3 | flèche | — |
| `/compte/informations` | 2 | flèche, lien | `/compte/fermer` |
| `/compte/fermer` | 3 | flèche, lien | `/marche/ordres` `/historique` |

## Par-dessus n'importe quel écran

Trois écrans de garde se posent par-dessus l'écran demandé, dans cet ordre, puis rendent la main exactement où l'on était :

1. **Compte fermé ou suspendu** — rien d'autre n'est possible ; écrire au support, se déconnecter.
2. **Le verrou** — le code secret à chaque ouverture (et après deux minutes en arrière-plan).
3. **Les conditions ont changé** — relire, accepter, continuer.
