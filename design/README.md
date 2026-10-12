# Maquettes

Les écrans de XAFe, construits avec le **Simple Design System** de Figma
(composants React, jetons et icônes du dépôt public `figma/sds`, licence MIT,
copiés dans `maquettes/src/ui`). Rien n'est dessiné à la main : chaque écran
est du code qui tourne, capturé en image.

- `maquettes/` : l'application de maquettes (Vite + React + SDS).
  - `npm install`, puis `npm run dev` pour les parcourir dans un navigateur ;
  - `npm run build && npm run preview`, puis `npm run captures` pour refaire
    les images (Playwright ; `PLAYWRIGHT_ROOT` si Playwright vit ailleurs).
  - Client (téléphone, 390 px) : `src/client.tsx`. Admin (web, 1440 px) :
    `src/admin.tsx`. Coquilles communes : `src/shell.tsx`.
- `captures/` : les images, une par écran, numérotées dans l'ordre du parcours.

Les montants, taux et délais sont des exemples. Les limites de paliers et les
adresses de contrats sont laissées entre crochets : à fixer.
