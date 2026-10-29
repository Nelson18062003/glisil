/*
 * LA MISE EN PAGE D'UN FORMULAIRE, d'après la leçon « Stop guessing your UI form spacing »
 * (Zander Whitehurst, 29/10/2026) : une grille de 4 px, et des GROUPES DE CONTENU — serré à
 * l'intérieur d'un groupe, plus large entre deux groupes. L'œil lit les groupes avant les mots.
 *
 *   titre → sa phrase          8    (EnTete : un seul groupe)
 *   en-tête → premier champ   24    (Groupes)
 *   étiquette → champ          8    (le thème : l'étiquette au-dessus)
 *   champ → son aide           4    (le thème)
 *   champ → champ             20    (Champs)
 *   dernier champ → bouton    20    (Champs : le bouton qui envoie est le dernier du groupe)
 *   bouton → bouton            8    (Actions)
 *
 * On ne devine plus un écart : on choisit le groupe. scripts/mesure-des-formulaires.mjs relit ces
 * nombres en pixels sur chaque écran du parcours, avec ses propres chiffres.
 */
import { Stack, Typography, type StackProps } from "@mui/material";
import type { ReactNode } from "react";

export const ESPACE = { titreTexte: 8, groupes: 24, entreChamps: 20, entreActions: 8 } as const;

/** Le titre d'un formulaire et sa phrase : un groupe, 8 px entre eux. */
export function EnTete({ titre, texte, variante = "h5" }: { titre: ReactNode; texte?: ReactNode; variante?: "h4" | "h5" | "h6" | "subtitle1" }) {
  return (
    <Stack data-en-tete sx={{ gap: `${ESPACE.titreTexte}px` }}>
      <Typography variant={variante} sx={{ textWrap: "balance" }}>{titre}</Typography>
      {texte && <Typography variant="body2">{texte}</Typography>}
    </Stack>
  );
}

/** Des groupes de contenu : 24 px de l'un à l'autre (l'en-tête, les champs, ce qui vient après). */
export function Groupes({ children, sx, ...reste }: StackProps) {
  return <Stack {...reste} sx={{ gap: `${ESPACE.groupes}px`, ...sx }}>{children}</Stack>;
}

/** Les champs, et le bouton qui les envoie : 20 px de l'un à l'autre. */
export function Champs({ children, sx, ...reste }: StackProps) {
  return <Stack {...reste} sx={{ gap: `${ESPACE.entreChamps}px`, ...sx }}>{children}</Stack>;
}

/** Des actions empilées (« Continuer », « Plus tard ») : 8 px, elles se lisent ensemble. */
export function Actions({ children, sx, ...reste }: StackProps) {
  return <Stack {...reste} sx={{ gap: `${ESPACE.entreActions}px`, ...sx }}>{children}</Stack>;
}
