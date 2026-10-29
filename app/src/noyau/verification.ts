/*
 * LA VÉRIFICATION AVANT SORTIE, côté écran : ce qui se décide sans React.
 * Chaque sortie d'argent demande trois preuves — le mot de passe, un code reçu
 * par e-mail (lié à CETTE opération, dix minutes, une fois), et un code tout
 * neuf de l'application d'authentification. La base juge (0036) ; l'écran
 * place chaque refus sur le champ qu'il concerne.
 */

/** Où se dit un refus du moteur. null : ce n'est pas un refus de la vérification — il remonte tel quel. */
export type ChampDeLErreur = "totp" | "mot_de_passe" | "code_email" | "nouveau_code" | "verrou" | "mot_de_passe_a_choisir";

export function champDeLErreur(message: string): ChampDeLErreur | null {
  const m = message.trim().toLowerCase();
  if (m.startsWith("code de l'application") || m.startsWith("aucune application d'authentification")) return "totp"; // langue-ok
  if (m.startsWith("mot de passe incorrect")) return "mot_de_passe"; // langue-ok
  if (m.startsWith("code e-mail incorrect")) return "code_email"; // langue-ok
  if (m.startsWith("mot de passe à choisir")) return "mot_de_passe_a_choisir"; // langue-ok
  if (m.startsWith("vérifications verrouillées")) return "verrou"; // langue-ok
  if (/^vérification (expirée|épuisée|remplacée|déjà utilisée|inconnue)/.test(m) || m.startsWith("la vérification ne correspond pas")) return "nouveau_code"; // langue-ok
  return null;
}

/** Les secondes qui restent avant `iso` (0 quand c'est passé, ou que la date ne se lit pas). */
export function secondesAvant(iso: string | null | undefined, maintenant = Date.now()): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - maintenant) / 1000)) : 0;
}

/** Six chiffres, rien d'autre : ce qu'on colle avec des espaces (« 482 913 ») se tape quand même. */
export const sixChiffres = (brut: string): string => brut.replace(/\D/g, "").slice(0, 6);

/** Le formulaire peut partir : un mot de passe, et deux codes complets. */
export const preuvesCompletes = (motDePasse: string, codeEmail: string, totp: string): boolean =>
  motDePasse.length > 0 && /^\d{6}$/.test(codeEmail) && /^\d{6}$/.test(totp);

/** L'e-mail est-il parti ? `echoue` ou `abandonne` : il faut renvoyer un code. */
export const courrielEnPanne = (etat: string | null | undefined): boolean => etat === "echoue" || etat === "abandonne";
