# Passer en production

La bêta tourne sur des réseaux d'essai, avec de l'argent de test
([BETA.md](BETA.md)). La production est **un autre environnement**, monté à
neuf. Ce document est la liste de ce qu'il faut faire, dans l'ordre, et de
qui le fait. Rien ici n'est encore fait.

> Règle d'or : **rien de la bêta ne passe en production**. Pas de copie de
> base, pas de comptes, pas de soldes. On rejoue les migrations sur un projet
> vide, et la bêta s'éteint de son côté.

## 0. Avant tout : le droit

Émettre une monnaie adossée au franc CFA et tenir un marché USDT/XAF touche
à la réglementation de la **BEAC** et de la **COBAC** (monnaie électronique,
services de paiement, change), et à la lutte contre le blanchiment (ANIF au
Cameroun). **Un avocat spécialisé valide le modèle avant le lancement** :
statut à obtenir (établissement de paiement, partenariat avec une banque ou
un EME agréé), plafonds, obligations KYC, déclaration de soupçon. C'est la
seule étape qui peut changer le produit ; elle passe en premier.

## 1. Un environnement neuf

| Quoi | Bêta (aujourd'hui) | Production |
|---|---|---|
| Base | projet Supabase `erngzpklfslbfznioxxr` | **un nouveau projet**, région la plus proche (Europe) |
| Migrations | 0001 → 0024 | les mêmes, rejouées sur la base vide (`migrations/…_consolidated.sql`) |
| Paramètres | `beta.actif = true` | **`beta.actif = false`** dès la première minute, `robots.actif = false` |
| Robots | 15 comptes | **supprimés** : les 15 comptes et leurs lignes `robots` effacés avant l'ouverture, tâche `glisil-robots` retirée |
| Chaîne | BSC Testnet, Tron Nile | BSC et Tron **mainnet** (`chaine.essai = false`) |
| Application, admin | Vercel (préversion) | domaine définitif, variables d'environnement de la production |

Avec `beta.actif = false` : plus de dotation, les dépôts réels s'ouvrent, et
les robots retirent tout au tour suivant. On rouvre ensuite les sorties et les
retraits crypto par leurs interrupteurs (Paramètres → « sortie », « crypto »).

## 2. Les clés — personne ne les tape dans un chat

1. **La graine de production** : générée **hors ligne**, par le propriétaire,
   sur une machine qui n'a jamais été en ligne (ou un wallet matériel). Écrite
   sur papier (deux copies, deux lieux). Elle devient un **secret** de la
   fonction `veilleur` (tableau de bord Supabase → Edge Functions → Secrets),
   **jamais** dans la base, jamais dans le dépôt, jamais dans une conversation.
   En bêta, la graine d'essai vit dans le Vault de la base : c'est acceptable
   pour de l'argent de test, pas pour de l'argent réel.
2. **L'admin du contrat XAFe** (`DEFAULT_ADMIN_ROLE`) : un **Safe 2-sur-3**
   sur wallets matériels (BSC) ; sur Tron, une permission multi-signature.
3. **Le wallet froid** : où dort la réserve d'USDT au-delà du besoin du jour ;
   un wallet matériel, dont la clé n'est jamais sur un serveur.
4. **Le wallet chaud** (celui du veilleur) : frappe, détruit, paie les
   retraits. Son **plafond de frappe par jour** se règle au volume réel
   attendu, pas plus.

Voir aussi [PARITE.md](PARITE.md), « Avant le vrai réseau ».

## 3. Le contrat XAFe sur le vrai réseau

1. **Audit** par une société indépendante (les tests, Slither et Echidna
   existent ; ce n'est pas un audit).
2. Déploiement : `npm run mise-en-service -- deployer` avec les variables du
   mainnet ; les rôles donnés au Safe et au wallet chaud ; un peu de BNB et de
   TRX pour les frais.
3. Paramètre `chaine` : adresses du contrat et de l'USDT **officiel** de
   chaque réseau, nœud RPC payant (pas un nœud public), bloc de départ.
4. Vérifier : `npm run mise-en-service -- verifier`, un dépôt et un retrait
   de bout en bout avec de petits montants, la parité à zéro.

## 4. L'authentification (les jetons JWT)

Chaque connexion Supabase donne un **jeton signé (JWT)** que l'application
présente à chaque appel ; la base vérifie la signature, puis chaque fonction
vérifie le compte et ses droits. À régler sur le projet de production :

- **Durée des jetons** : 1 heure (défaut) ; la session se renouvelle seule.
  Désactiver un administrateur coupe ses droits **tout de suite** (les droits
  sont relus à chaque appel, pas lus dans le jeton).
- **Clés** : seule la clé publique (`anon` / publishable) va dans
  l'application et l'admin. La clé `service_role` ne sort **jamais** du
  serveur : ni dans Vercel, ni dans le navigateur.
- **E-mails de connexion** : un SMTP à nous (Resend, domaine vérifié SPF/DKIM)
  au lieu de celui de Supabase, limité en débit. La clé Resend se saisit
  directement dans le tableau de bord, pas dans une conversation.
- **Limites** : codes par adresse et par heure (Auth → Rate limits),
  protection contre les mots de passe fuités inutile (pas de mot de passe),
  CAPTCHA à l'inscription si les inscriptions automatiques apparaissent.
- **Fonctions Edge** : `verify_jwt` reste activé partout sauf le veilleur
  (appelé par pg_cron avec son propre jeton secret) et la porte TOTEM (clé
  par boîtier).
- **Conseiller de sécurité** Supabase (Advisors) à zéro avant l'ouverture.

## 5. Les vraies personnes : le KYC

La bêta ne demande qu'un nom et un numéro. En production :

- **Paliers** (déjà dans le moteur) : palier 0 sans pièce avec de petits
  plafonds ; palier 1 pièce d'identité + selfie ; palier 2 entreprise (RCCM).
- Un **prestataire de vérification** (lecture de la pièce, comparaison du
  visage, listes de sanctions) branché sur `demander_verification`.
- **Le code SMS et le délai sur un numéro neuf** reviennent (Paramètres →
  « numeros » : `verification_sms: true`, `delai_heures: 24`) : en bêta ils
  sont coupés, en production ils protègent un compte dont le téléphone a été
  volé.
- Conservation des pièces : stockage privé, durée légale, accès journalisé.

## 6. L'argent réel

- **Floats dédiés** à Glisil (MTN MoMo, Orange Money), au nom de la société,
  séparés de Bonzini.
- **Boîtiers TOTEM** de production, chacun sa clé.
- **Frais** : décider les vrais frais (aujourd'hui tout est à zéro, « Offerts ») :
  Paramètres → « frais », « crypto », « rapide ».
- **Rapprochement mensuel** signé par un comptable, publié avec la page de
  preuve de réserve.

## 7. Le jour de l'ouverture

1. Base neuve, migrations, `beta.actif = false`, robots supprimés.
2. Contrat mainnet vérifié, parité à zéro sur une base vide.
3. Un dépôt réel de 1 000 XAF par l'équipe, puis une sortie, puis un retrait
   crypto : chacun vu sur la page de preuve.
4. Les conditions d'utilisation mises à jour (réseaux, frais, KYC), nouvelle
   version : chacun les accepte.
5. Ouverture par vagues : d'abord les testeurs de la bêta qui le veulent
   (qui recréent leur compte), puis le public.
6. La bêta reste ouverte à part quelques semaines, puis s'éteint
   (`beta.actif = false`, robots arrêtés, projet mis en pause).
