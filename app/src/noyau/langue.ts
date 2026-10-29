/*
 * LA LANGUE DE L'ÉCRAN : français ou anglais. Glisil a beaucoup d'utilisateurs
 * anglophones ; chaque texte s'écrit donc dans les deux langues, côte à côte,
 * là où il s'affiche : t("Bonjour", "Hello"). Pas de clé à inventer, pas de
 * fichier à tenir à part : un texte sans sa traduction se voit dans le code,
 * et le harnais (scripts/langue.mjs) le refuse.
 *
 * Le choix se garde sur l'appareil ; sans choix, la langue du navigateur
 * (anglais si le navigateur ne demande pas le français). Changer de langue
 * remonte l'application entière (LangueProvider) : un texte calculé n'importe
 * où — un composant, une fonction d'aide — est relu dans la nouvelle langue.
 */

export type Langue = "fr" | "en";
export const LANGUES: { id: Langue; nom: string }[] = [{ id: "fr", nom: "Français" }, { id: "en", nom: "English" }];

const CLE = "glisil-langue";

function detecter(): Langue {
  // hors navigateur (les tests sous Node) : le français, la langue de référence des formats
  if (typeof window === "undefined") return "fr";
  try {
    const garde = window.localStorage.getItem(CLE);
    if (garde === "fr" || garde === "en") return garde;
  } catch { /* stockage refusé : on suit le navigateur */ }
  for (const l of navigator.languages ?? [navigator.language]) {
    const court = (l ?? "").slice(0, 2).toLowerCase();
    if (court === "fr" || court === "en") return court;
  }
  return "en";
}

let courante: Langue = detecter();
const abonnes = new Set<() => void>();

export function langue(): Langue {
  return courante;
}

export function choisirLangue(l: Langue) {
  if (l === courante) return;
  courante = l;
  try { window.localStorage.setItem(CLE, l); } catch { /* sans stockage, le choix vaut pour la visite */ }
  if (typeof document !== "undefined") document.documentElement.lang = l;
  abonnes.forEach((f) => f());
}

/** Pour les tests : poser la langue sans toucher au stockage. */
export function poserLangue(l: Langue) {
  courante = l;
}

export function abonnerLangue(f: () => void): () => void {
  abonnes.add(f);
  return () => abonnes.delete(f);
}

/** Le texte dans la langue de l'écran. Toujours les deux : le français d'abord, l'anglais ensuite. */
export function t(fr: string, en: string): string {
  return courante === "en" ? en : fr;
}
