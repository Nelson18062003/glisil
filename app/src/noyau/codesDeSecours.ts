/*
 * LES CODES DE SECOURS : dix codes de dix caractères (alphabet de Crockford,
 * 50 bits chacun), générés par la base, montrés une seule fois. Un code tapé
 * se lit comme la base le lit (_code_de_secours_normalise, 0035) : les
 * minuscules, les espaces et les tirets ne comptent pas ; O se lit 0, I et L
 * se lisent 1. Le même tableau d'essais (codesDeSecours.fixtures.json) peut
 * être joué contre la fonction SQL.
 */

export const ALPHABET_DE_SECOURS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const LONGUEUR_CODE_DE_SECOURS = 10;

/** Le code tel que la base le compare, ou null s'il ne peut pas en être un. */
export function codeDeSecoursNormalise(brut: string): string | null {
  const v = brut.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return new RegExp(`^[${ALPHABET_DE_SECOURS}]{${LONGUEUR_CODE_DE_SECOURS}}$`).test(v) ? v : null;
}

/** « ABCDEFGHJK » → « ABCDE-FGHJK » : deux moitiés, plus faciles à recopier. */
export function codeDeSecoursLisible(code: string): string {
  const v = code.replace(/-/g, "");
  return v.length === LONGUEUR_CODE_DE_SECOURS ? `${v.slice(0, 5)}-${v.slice(5)}` : code;
}

/** Le fichier qu'on garde : une ligne par code, et de quoi se souvenir de ce que c'est. */
export function texteDesCodes(codes: string[], entete: string): string {
  return `${entete}\n\n${codes.map((c, i) => `${String(i + 1).padStart(2, " ")}. ${codeDeSecoursLisible(c)}`).join("\n")}\n`;
}
