# Entrer dans Glisil

Clients et administrateurs entrent de la même façon (0035) : **une adresse
e-mail et un mot de passe, puis le code de l'application d'authentification**
(Google Authenticator, Microsoft Authenticator). La double authentification
est obligatoire pour tout le monde, et la base la redemande avant chaque
requête (`session_forte`, le crochet de PostgREST). Pas de SMS, nulle part.

Avant qu'un argent sorte (retrait MoMo/Orange, retrait crypto, fermeture du
compte, retrait d'un numéro), on demande en plus le mot de passe et un code
reçu par e-mail qui dit le montant et la destination (0036).

## Le parcours du client (`app/`)

1. **Créer un compte** (`/bienvenue`) : l'adresse et un mot de passe (dix
   caractères au moins, des lettres et des chiffres) — ou Google, qui demande
   ensuite de choisir un mot de passe.
2. **Le code reçu par e-mail** (`/bienvenue/code`) confirme l'adresse.
3. **L'application d'authentification** (`/bienvenue/deux-facteurs`) :
   l'ajouter, puis taper les six chiffres qu'elle affiche.
4. **Dix codes de secours** (`/bienvenue/codes-de-secours`), montrés une fois :
   ils rendent l'accès si le téléphone est perdu (« J'ai perdu mon téléphone »,
   fonction `deux-facteurs`).
5. **L'inscription** (`/bienvenue/inscription`), une question par écran :
   - prénom et nom : des lettres, mis en capitales propres (« jean-paul » →
     « Jean-Paul ») ;
   - date de naissance : une vraie date, **18 ans révolus** ;
   - téléphone : obligatoire, non vérifié, un numéro par compte ouvert (le
     numéro d'un compte fermé se réutilise) ; enregistré au format
     international (`+237677123456`) ;
   - pays et ville de résidence ;
   - le récapitulatif, qu'on certifie exact, et les conditions acceptées.

Ensuite, chaque connexion : l'adresse, le mot de passe, le code de
l'application. Compte → Sécurité : changer le mot de passe, de nouveaux codes
de secours, changer de téléphone, déconnecter tous les appareils.

Tout est vérifié deux fois : à l'écran pendant la frappe, puis par la base
qui a le dernier mot (`ouvrir_mon_compte`). Le numéro de l'inscription n'est
pas un numéro de sortie : un numéro MoMo s'ajoute dans Compte → Mes numéros.

## L'administration (`admin/`)

Le super administrateur **invite** une adresse. La personne ouvre
l'administration, touche **« Première connexion »**, choisit son mot de passe,
confirme son adresse par le code reçu, ajoute son application
d'authentification et note ses dix codes de secours ; l'invitation devient
alors sa fiche d'administrateur (`entrer_administration`). Une adresse non
invitée est refusée à la fin, même avec tout le reste. Ensuite : l'adresse, le
mot de passe, le code de l'application. Un administrateur d'avant (entré par
code seulement) passe par **« Mot de passe oublié »** pour choisir le sien.

Utiliser pour l'administration une adresse **réservée** à cela, jamais celle
d'un compte client (le vôtre compris).

Le tout premier administrateur s'invite par SQL (Supabase → SQL Editor) :

```sql
insert into administrateurs_invites (email, nom, role)
values ('votre@adresse.com', 'Votre nom', 'super_admin');
```

Les suivants s'invitent par `admin_inviter_administrateur(email, nom, rôle)`.

## Les parcours de sécurité, de bout en bout

| Situation | Ce que fait le client | Ce qui part par e-mail | Retraits |
|---|---|---|---|
| **Mot de passe oublié** | « Mot de passe oublié » → l'adresse → le code reçu (10 min, renvoi après 1 min) → **le code de l'application** (ou un code de secours) → le nouveau mot de passe, deux fois. Toutes les sessions se ferment. | le code ; puis l'alerte « mot de passe changé » | en pause 24 h |
| **Changer son mot de passe** | Compte → Sécurité → le code de l'application → (session de plus de 24 h : un code par e-mail) → le nouveau | l'alerte « mot de passe changé » | en pause 24 h |
| **Changer de téléphone** | Compte → Sécurité → le code de l'ANCIEN téléphone → le nouveau s'enrôle | l'alerte « application ajoutée » | en pause 24 h |
| **Téléphone perdu** | À la connexion, « J'ai perdu mon téléphone » → un code de secours → l'application est retirée ; à la connexion suivante, une nouvelle application et dix nouveaux codes | « application retirée », puis « application ajoutée » | en pause 24 h |
| **Téléphone ET codes perdus** | Le support vérifie l'identité (appel vidéo, pièce) ; Administration → le client → « Réinitialiser la double authentification » (motif obligatoire, au journal) | « application retirée » | en pause 24 h |
| **Nouveaux codes de secours** | Compte → Sécurité → le code de l'application → dix codes, montrés une fois | l'alerte « nouveaux codes » | — |
| **Déconnecter tous les appareils** | Compte → Sécurité | — | — |
| **Changer d'adresse e-mail** | Jamais seul dans l'application : c'est elle qui reçoit les codes et les alertes. Le client écrit au support depuis son adresse actuelle ; s'il l'a perdue, l'équipe vérifie d'abord son identité. | — | — |
| **Avant chaque sortie d'argent** | Le mot de passe, un code par e-mail qui dit le montant et la destination, le code de l'application ; trop d'essais faux : 1 h de verrou | le code ; le verrou | — |

**La pause de 24 h (0048)** : après un mot de passe changé, une application
ajoutée ou retirée, aucun retrait — ni Mobile Money, ni crypto — pendant 24 h
(`parametres.securite.pause_retraits_heures`). Un voleur qui a pris le compte
n'a pas le temps de le vider ; le vrai client, prévenu par l'e-mail, écrit au
support. Dépôts, marché et achat rapide restent ouverts. L'écran le dit avant
le geste (Compte → Sécurité, « mot de passe oublié »), puis sur l'accueil et
sur chaque retrait. La base refuse de toute façon : un verrou sur les codes de
sortie, les sorties et les retraits crypto. Pendant l'inscription (le compte
n'existe pas encore), rien ne part et rien ne se met en pause.

## L'approbation des comptes (0047)

N'importe qui s'inscrit et visite tout Glisil : le marché, les cours, son
compte. Mais tant que l'équipe n'a pas **approuvé** le compte, aucun geste
d'argent ne commence — ni dépôt (Mobile Money ou adresse crypto), ni ordre,
ni achat rapide, ni retrait. L'application le dit avant le premier geste
(« Votre compte est en cours de vérification ») ; la base refuse de toute
façon (« compte en attente d'approbation »), par un verrou posé sur les huit
tables où l'argent commence.

- **Approuver** : Administration → Clients → « N comptes à approuver » →
  le client → « Approuver ce client » (droit `paliers`, le super admin). Le
  client est prévenu par e-mail (`compte_approuve`) et dans l'application.
- **L'interrupteur** : en tête de la page Clients (droit `administrateurs`).
  Éteint, les comptes en attente sont approuvés d'office et les suivants
  naissent approuvés. Rallumé, il ne reprend rien : seuls les comptes ouverts
  après attendent.
- Chaque approbation et chaque bascule vont au journal, avec qui et quand.

## Les portes fermées (production, avant l'ouverture)

Sur la production, « Allow new users to sign up » reste **désactivé** jusqu'à
l'ouverture (Google compris) : l'application dit alors « Les inscriptions
ouvrent très bientôt. ». Le propriétaire crée ses propres comptes dans le
tableau de bord (Authentication → Users → **Add user**, « Auto Confirm ») : la
personne se connecte avec ce mot de passe, puis ajoute son application
d'authentification et fait son inscription comme tout le monde. Le premier
super admin : le même « Add user », puis l'invitation SQL ci-dessus.
[PRODUCTION.md](PRODUCTION.md), étapes C, M et P.

## Les réglages du projet Supabase (une fois, dans le tableau de bord)

**Authentication → Sign In / Providers → Email**
- Email : activé ; « Confirm email » : activé.
- **Email OTP Length : 6** · **Email OTP Expiration : 600** secondes.

**Authentication → Emails → Templates** : rien à coller à la main. Les modèles
vivent dans `supabase/templates/`, leurs objets dans `supabase/config.toml`, et
le robot GitHub `.github/workflows/courriels-auth.yml` les envoie au projet de
production à chaque changement (script `supabase/templates/pousser-vers-supabase.mjs` :
il vérifie le code `{{ .Token }}` et les deux langues, envoie, puis relit
Supabase). Il lui faut une fois le secret GitHub `SUPABASE_ACCESS_TOKEN`
([PRODUCTION.md](PRODUCTION.md), étape J). Chaque e-mail part dans UNE langue,
celle de la personne (anglais par défaut, français si elle l'a choisi) :

| Modèle Supabase | Fichier à coller | Objet (Subject) |
|---|---|---|
| Confirm signup | `supabase/templates/code-par-email.html` | `{{ if eq (printf "%v" .Data.langue) "fr" }}Votre code Glisil : {{ .Token }}{{ else }}Your Glisil code: {{ .Token }}{{ end }}` |
| Magic Link | `supabase/templates/code-par-email.html` | le même que « Confirm signup » |
| Reset Password | `supabase/templates/reinitialisation.html` | `{{ if eq (printf "%v" .Data.langue) "fr" }}Glisil · changer votre mot de passe{{ else }}Glisil · reset your password{{ end }}` |
| Reauthentication | `supabase/templates/reauthentification.html` | `{{ if eq (printf "%v" .Data.langue) "fr" }}Glisil · confirmer le changement de mot de passe{{ else }}Glisil · confirm your password change{{ end }}` |

Les modèles ne montrent qu'un code : aucun lien à cliquer. La langue vient des
métadonnées d'Auth (« langue ») : l'application la pose à l'inscription, et
chaque changement de langue dans l'application la met à jour (0037). Un compte
sans langue — inscrit avec Google, par exemple — reçoit l'anglais. Après avoir
collé, s'envoyer un code à soi-même pour vérifier.

**Authentication → URL Configuration**
- Site URL : `https://app.glisil.com`
- Redirect URLs : `https://app.glisil.com/**`, `https://admin.glisil.com/**`

**Les e-mails partent par Resend** (Authentication → Emails → SMTP Settings) :
- Host `smtp.resend.com` · Port `465` · Username `resend` ;
- Password : la clé API Resend, collée **ici seulement** — jamais dans le code,
  jamais dans Vercel ;
- Sender : `code@glisil.com`, nom « Glisil ».

Avant, sur resend.com : *Domains → Add Domain* `glisil.com`, puis recopier les
enregistrements DNS qu'il donne chez le registraire du domaine ; *API Keys →
Create API Key* (accès « Sending »).

Sans SMTP personnalisé, Supabase n'envoie que **quelques e-mails par heure**,
et seulement aux membres de l'équipe du projet : assez pour un essai, pas pour
des clients.

### Les e-mails de Glisil : le code avant chaque sortie

Le SMTP ci-dessus ne sert qu'à Supabase Auth. Le code envoyé avant une sortie
d'argent (avec le montant et la destination) et l'alerte « retraits bloqués »
sont écrits par la base dans sa boîte d'envoi (0036) et envoyés par la
fonction `courriel`, avec la MÊME clé Resend. Une fois :

1. **Secrets de la fonction** (Edge Functions → Secrets, ou la synchronisation
   Infisical → Supabase) :
   - `RESEND_API_KEY` : la clé Resend (la même que celle du SMTP) ;
   - `COURRIEL_JETON` : une longue valeur au hasard (au moins 32 caractères),
     que personne n'a besoin de connaître ;
   - `COURRIEL_EXPEDITEUR` (facultatif) : `Glisil <code@glisil.com>` par défaut.
2. **Deux secrets du Vault** (Database → Vault), pour que la base réveille la
   fonction :
   - `courriel_url` : `https://<projet>.supabase.co/functions/v1/courriel` ;
   - `courriel_jeton` : la MÊME valeur que `COURRIEL_JETON`.
3. **Extensions** (Database → Extensions) : `pg_cron` et `pg_net` activées.
4. **Déployer** : `npx supabase functions deploy courriel --no-verify-jwt`
   (la fonction vérifie elle-même son jeton ; personne d'autre ne l'appelle).

Chaque e-mail part dans la langue du compte (anglais par défaut). Le code
n'est jamais dans l'objet, ni au journal. Un e-mail que Resend refuse
momentanément (429, 5xx) est repris ; la même ligne ne part jamais deux fois
(clé d'idempotence). Éprouvé par
`node --experimental-strip-types supabase/functions/verifier-les-courriels.ts`.

### Téléphone perdu : la fonction `deux-facteurs`

« J'ai perdu mon téléphone » (à la connexion) : la personne donne un de ses
codes de secours ; la base le juge (5 essais, puis 15 minutes de verrou), et
la fonction `deux-facteurs` retire l'ancienne application d'authentification ;
la personne en ajoute une nouvelle et reçoit dix codes neufs. Elle sert aussi
à la réinitialisation par un super admin (après vérification d'identité).
Une fois :

- **Déployer** : `npx supabase functions deploy deux-facteurs` (avec la
  vérification du jeton : seule une personne connectée l'appelle) ;
- **Secret facultatif** `ORIGINES` : les adresses autorisées à l'appeler, par
  défaut `https://app.glisil.com,https://admin.glisil.com`.

Éprouvé par `node --experimental-strip-types supabase/functions/verifier-deux-facteurs.ts`.
