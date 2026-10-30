/*
 * LE MOT DE PASSE, tel que Supabase Auth l'exige (supabase/config.toml, et le
 * tableau de bord de production : minimum_password_length = 10,
 * password_requirements = "lower_upper_letters_digits_symbols" — décision du
 * propriétaire du 30/10). L'écran le dit pendant qu'on tape ; Auth reste seul
 * juge (et refuse aussi les mots de passe déjà fuités).
 */

export const MOT_DE_PASSE_MIN = 10;
/** bcrypt ne lit que 72 octets : au-delà, la fin ne compterait pas */
export const MOT_DE_PASSE_MAX = 72;
/** Les symboles qu'Auth compte, ni plus ni moins (GoTrue : « lower_upper_letters_digits_symbols ») : l'espace
    et les lettres accentuées n'en sont pas. */
export const SYMBOLES = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

export type ManqueMotDePasse = "longueur" | "minuscules" | "majuscules" | "chiffres" | "symboles" | "trop_long";

/** Ce qui manque, dans l'ordre où on le dit. Auth compte les lettres et les chiffres ASCII, et ses symboles. */
export function manquesDuMotDePasse(mdp: string): ManqueMotDePasse[] {
  const manques: ManqueMotDePasse[] = [];
  if (mdp.length < MOT_DE_PASSE_MIN) manques.push("longueur");
  if (!/[a-z]/.test(mdp)) manques.push("minuscules");
  if (!/[A-Z]/.test(mdp)) manques.push("majuscules");
  if (!/[0-9]/.test(mdp)) manques.push("chiffres");
  if (![...mdp].some((c) => SYMBOLES.includes(c))) manques.push("symboles");
  if (new TextEncoder().encode(mdp).length > MOT_DE_PASSE_MAX) manques.push("trop_long");
  return manques;
}

export const motDePasseValide = (mdp: string): boolean => manquesDuMotDePasse(mdp).length === 0;
