/*
 * LE MOT DE PASSE, tel que Supabase Auth l'exige (supabase/config.toml :
 * minimum_password_length = 10, password_requirements = "letters_digits").
 * L'écran le dit pendant qu'on tape ; Auth reste seul juge (et refuse aussi
 * les mots de passe déjà fuités).
 */

export const MOT_DE_PASSE_MIN = 10;
/** bcrypt ne lit que 72 octets : au-delà, la fin ne compterait pas */
export const MOT_DE_PASSE_MAX = 72;

export type ManqueMotDePasse = "longueur" | "lettres" | "chiffres" | "trop_long";

/** Ce qui manque, dans l'ordre où on le dit. Auth compte les lettres et les chiffres ASCII. */
export function manquesDuMotDePasse(mdp: string): ManqueMotDePasse[] {
  const manques: ManqueMotDePasse[] = [];
  if (mdp.length < MOT_DE_PASSE_MIN) manques.push("longueur");
  if (!/[A-Za-z]/.test(mdp)) manques.push("lettres");
  if (!/[0-9]/.test(mdp)) manques.push("chiffres");
  if (new TextEncoder().encode(mdp).length > MOT_DE_PASSE_MAX) manques.push("trop_long");
  return manques;
}

export const motDePasseValide = (mdp: string): boolean => manquesDuMotDePasse(mdp).length === 0;
