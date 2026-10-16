/*
 * Les deux façons de nous payer, telles que le document « Coordonnées Mobile
 * Money » les donne aux clients :
 *   1. FLOAT    un transfert vers notre numéro (depuis une puce, ou une flotte d'agent) ;
 *   2. RETRAIT  un retrait à notre point : un code USSD, montant compris.
 *        MTN     *126*14*<notre numéro>*<montant>#
 *        Orange  #150*14*<notre code agent>*<notre numéro>*<montant>#
 * Le code se compose tel quel : on l'affiche en tranches pour le lire, et on
 * le donne au clavier du téléphone sans espaces.
 */
import type { IdOperateur } from "../guichet/types";

/** Le code de retrait à composer ; null quand l'opérateur en demande un que ce float n'a pas (Orange sans code agent). */
export function codeDeRetrait(operateur: IdOperateur, floatNumero: string, codeAgent: string | null, montant: number | null): string | null {
  const numero = floatNumero.replace(/\D/g, "").slice(-9);
  if (!/^6\d{8}$/.test(numero)) return null;
  const m = montant && Number.isSafeInteger(montant) && montant > 0 ? String(montant) : "MONTANT";
  if (operateur === "mtn") return `*126*14*${numero}*${m}#`;
  const code = (codeAgent ?? "").replace(/\D/g, "");
  return code ? `#150*14*${code}*${numero}*${m}#` : null;
}

/** Le lien qui ouvre le clavier du téléphone avec le code déjà tapé (« # » doit s'écrire %23 dans un lien). */
export function lienUssd(code: string): string | null {
  return code.includes("MONTANT") ? null : `tel:${code.replace(/#/g, "%23")}`;
}
