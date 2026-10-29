# Entrer dans Glisil, sans mot de passe

Clients et administrateurs entrent de la même façon : **une adresse e-mail,
puis un code à six chiffres reçu par e-mail.** Il n'y a de mot de passe nulle
part. Le code prouve l'adresse (Supabase Auth, « OTP » par e-mail).

## Le parcours du client (`app/`)

1. **L'adresse e-mail** (`/bienvenue`) → le code part.
2. **Le code** (`/bienvenue/code`) → l'adresse est prouvée. Une adresse déjà
   inscrite arrive sur son compte ; une nouvelle continue.
3. **L'inscription** (`/bienvenue/inscription`), une question par écran :
   - prénom et nom : des lettres, mis en capitales propres (« jean-paul » →
     « Jean-Paul ») ;
   - date de naissance : une vraie date, **18 ans révolus** ;
   - téléphone : le pays (les six pays du franc CFA d'Afrique centrale en
     tête), puis le numéro, mis en forme pendant la frappe et enregistré au
     format international (`+237677123456`). Au Cameroun : 9 chiffres,
     commençant par 6 ou 2. Un numéro ne sert qu'à un compte ;
   - pays et ville de résidence ;
   - le récapitulatif, qu'on certifie exact.
4. **Le code secret** (4 chiffres) des gestes d'argent, puis la bienvenue.

Tout est vérifié deux fois : à l'écran pendant la frappe
(`app/src/noyau/identite.ts`), puis par la base qui a le dernier mot
(`ouvrir_mon_compte`, migration 0009). Le numéro de l'inscription n'est pas un
numéro de sortie : un numéro MoMo s'ajoute et se prouve par SMS dans
Compte → Mes numéros.

## L'administration (`admin/`)

Le super administrateur **invite** une adresse ; la personne entre son adresse,
reçoit le code, et à son premier passage l'invitation devient sa fiche
d'administrateur (`entrer_administration`). Une adresse non invitée est
refusée, même avec un code valide.

Le tout premier administrateur s'invite par SQL (Supabase → SQL Editor) :

```sql
insert into administrateurs_invites (email, nom, role)
values ('votre@adresse.com', 'Votre nom', 'super_admin');
```

Les suivants s'invitent par `admin_inviter_administrateur(email, nom, rôle)`.

## Les réglages du projet Supabase (une fois, dans le tableau de bord)

**Authentication → Sign In / Providers → Email**
- Email : activé ; « Confirm email » : activé.
- **Email OTP Length : 6** · **Email OTP Expiration : 600** secondes.

**Authentication → Emails → Templates** : chaque e-mail part dans UNE langue,
celle de la personne (anglais par défaut, français si elle l'a choisi). Pour
chaque modèle, coller le fichier dans « Body » et la ligne dans « Subject » :

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
