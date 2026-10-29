/*
 * « Continuer avec Google » : où il marche, et où il vaut mieux le taire.
 *
 *   le navigateur                   une redirection ordinaire, retour sur /bienvenue/retour
 *   la coque Android, pont v2       la coque ouvre Google dans un onglet du système
 *                                   (Google refuse une WebView : disallowed_useragent)
 *                                   et rend le code par glisil://auth-retour
 *   la coque d'avant (pont v1)      caché : la session ne reviendrait jamais
 *   un navigateur d'application     caché, avec un conseil : WhatsApp, Facebook,
 *   (WhatsApp, Facebook, Instagram)  Instagram ouvrent les liens dans une WebView
 *   la démonstration                caché : pas de Google sans projet
 */

export type Coque = { version?: number; google?: boolean } | undefined;

export type VoieGoogle =
  | { voie: "web" }
  | { voie: "coque" }
  | { voie: "aucune"; raison: "demo" | "coque_ancienne" | "navigateur_integre" };

const NAVIGATEUR_INTEGRE = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp/i;

export function voieGoogle(p: { demo: boolean; coque: Coque; agent: string }): VoieGoogle {
  if (p.demo) return { voie: "aucune", raison: "demo" };
  if (p.coque) return (p.coque.version ?? 1) >= 2 && p.coque.google ? { voie: "coque" } : { voie: "aucune", raison: "coque_ancienne" };
  if (NAVIGATEUR_INTEGRE.test(p.agent)) return { voie: "aucune", raison: "navigateur_integre" };
  return { voie: "web" };
}

/** Le pont posé par la coque (coque/src/pont.ts), lu au moment où l'on en a besoin. */
export function coqueActuelle(): Coque {
  return typeof window === "undefined" ? undefined : (window as unknown as { __xafeCoque?: Coque }).__xafeCoque;
}

/** Ce qu'un retour OAuth porte : le code à échanger, ou la raison d'un refus (« access_denied »…). */
export function lireRetourOAuth(url: string): { code: string | null; erreur: string | null } {
  try {
    const u = new URL(url);
    const hash = new URLSearchParams(u.hash.replace(/^#/, ""));
    const lire = (k: string) => u.searchParams.get(k) ?? hash.get(k);
    return { code: lire("code"), erreur: lire("error_description") ?? lire("error") };
  } catch {
    return { code: null, erreur: null };
  }
}
