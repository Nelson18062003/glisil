# Glisil · la marque

## Qui est qui

| Nom | Ce que c'est | Exemple de phrase |
|---|---|---|
| **Glisil** | L'**entreprise**. Elle émet le stablecoin et elle opère le marché. | « Glisil émet le XAFe. » |
| **XAFe** | Le **produit stablecoin** : 1 XAFe = 1 XAF, couvert un pour un par nos floats MoMo et nos comptes en banque. Jeton BEP20 et TRC20. | « Payez en XAFe. » |
| **Glisil** (l'application) | Le **produit marché** : le carnet d'ordres USDT/XAFe, l'achat rapide, les entrées et sorties MoMo, les dépôts et retraits crypto. | « Achetez des USDT sur Glisil. » |

Le modèle est celui de Circle (l'entreprise) et de l'USDC (le jeton) : le
jeton garde son nom partout, l'entreprise signe ce qu'elle émet. Le XAFe doit
pouvoir vivre hors de notre marché (d'autres plateformes, des wallets, des
paiements) ; il ne prend donc pas le nom de l'entreprise.

On n'écrit plus « XAFe Exchange ».

## Le nom

*Glisil* vient de **glissile**, le mot des physiciens pour un défaut du cristal
qui avance en glissant, sans résistance — son contraire est *sessile*, fixé.
C'est la méthode de Paul Graham (X, 30/09/2026) : « l'adjectif que les
scientifiques emploient pour la situation que la technologie veut produire ».
La situation : une monnaie qui était fixée, et qui glisse.

- Prononciation : « GLI-sil », la même en français et en anglais.
- Domaines : `glisil.com` (le nom), `glissil.com` et `glissile.com` (les
  façons de l'écrire à l'oreille) — à garder tous les trois, redirigés.
- Ni l'App Store ni le Play Store n'avaient d'application de ce nom (15/10/2026).

## La marque visible

- **Le symbole, la comète** : une pièce d'or lancée en diagonale, sa traînée
  derrière elle. L'argent qui va vite, et qui va quelque part. Sur l'icône,
  la traînée est blanche sur le carré vert ; seul, le symbole a la traînée
  verte. Dessiné une fois, avec la même géométrie, dans
  `coque/scripts/icones.py` (les icônes de l'application) et dans le
  composant `Marque` (`app/`, `admin/`, `design/maquettes/`).
- **Le nom** : toujours en minuscules, « glisil », en Sora 700, serré
  (−0,04 em). Composant `NomGlisil`. Dans une phrase, on écrit Glisil.
- **Les couleurs** : le vert `#0B6B3A` (la sécurité, le franc CFA) et l'or
  `#E8A33D` (la prospérité, le dollar), sur le papier `#F4F7F4`.
- **Le X** : la pastille du jeton XAFe, dans les soldes et le marché. Elle ne
  représente jamais l'entreprise.
- Le SMS du code de vérification se signe « Glisil : votre code est … »
  (migration 0008).

## Ce qui garde l'ancien nom, et pourquoi

| Où | Pourquoi |
|---|---|
| Le contrat `XAFe.sol` (nom et symbole « XAFe ») | C'est le produit : il garde son nom. |
| Les migrations 0001 à 0007 (en-têtes) | Déjà jouées en production : on ne réécrit pas une migration passée. La 0008 change ce que les clients voient. |
| Le projet Supabase « XAFe » | Son nom ne se voit nulle part ; le renommer ne change rien au code. |
| `window.__xafeCoque`, les comptes d'essai `@xafe.exchange` des harnais | Internes, jamais montrés. |

## Ce qui reste à faire hors du code

- **Le dépôt GitHub** : Settings → Repository name → `glisil`. GitHub redirige
  l'ancienne adresse ; rien à changer dans le code.
- **Les domaines** : `glissil.com` et `glissile.com`, redirigés vers
  `glisil.com`. Puis `app.glisil.com` (l'application) et `admin.glisil.com`
  sur Vercel — la coque ouvre déjà `https://app.glisil.com`.
- **L'identifiant des applications** : `com.glisil.app` (Android et iOS). Il ne
  se change plus une fois publié : c'est maintenant qu'il est posé.
- **La marque déposée** : chercher puis déposer « Glisil » à l'OAPI (Afrique
  centrale et de l'Ouest), puis à l'EUIPO et à l'USPTO.
- **L'entreprise** : la raison sociale (par exemple Glisil SAS) chez le notaire
  et au registre du commerce, et l'adresse e-mail `@glisil.com`.
