# Maquettes · Glisil

Les écrans de l'application Android des clients, en **Material Design 3**
(le langage d'Android), avec la bibliothèque MUI et les icônes Material.
Une couleur principale (vert), un accent (l'ambre du logo), des cartes
blanches sur fond clair.

Trois règles, sans exception :

1. **Un écran, une chose.** Un parcours de quatre étapes fait quatre écrans.
2. **Un titre, une ligne.** Pas de paragraphe sur un écran.
3. **Une icône vit dans un cercle coloré** (44 px dans une liste, 56 px sur
   une tuile), toujours de la même famille.

Rien n'est dessiné à la main : chaque écran est du code qui tourne, capturé
en image.

- `maquettes/` : l'application de maquettes (Vite + React + MUI).
  - `npm install`, puis `npm run dev` pour les parcourir dans un navigateur ;
  - `npm run build && npm run preview`, puis `npm run captures` pour refaire
    les images (Playwright ; `PLAYWRIGHT_ROOT` si Playwright vit ailleurs).
  - Écrans : `src/screens/*.tsx`. Pièces communes : `src/ui.tsx`. Couleurs
    et typographie : `src/theme.ts`.
- `captures/` : les images, une par écran, numérotées dans l'ordre du
  parcours (412 × 915, résolution double).

Les montants, taux et délais sont des exemples. Les limites de paliers et les
adresses de contrats restent à fixer. L'application web d'administration
viendra après validation de ces écrans.
