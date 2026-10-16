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

**Authentication → Emails → Templates** : pour **« Confirm signup »** et
**« Magic Link »**, coller le contenu de `supabase/templates/code-par-email.html`,
avec pour objet `Votre code Glisil : {{ .Token }}`. Le modèle ne montre que le
code : aucun lien à cliquer.

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
