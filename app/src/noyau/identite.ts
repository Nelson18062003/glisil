/*
 * L'IDENTITÉ D'UN CLIENT, mise en forme et vérifiée pendant qu'il tape —
 * le miroir des règles de la base (supabase/migrations/0009) : la base a le
 * dernier mot, l'écran évite seulement d'y envoyer ce qu'elle refusera.
 *
 *   noms et villes  des lettres, séparées par espace, trait d'union, apostrophe
 *                   ou point ; une capitale à chaque mot (« jean-paul » → « Jean-Paul »)
 *   e-mail          en minuscules, sans espace
 *   naissance       une vraie date, 18 ans révolus, 120 ans au plus
 *   téléphone       au format international, vérifié pour le pays choisi
 *                   (au Cameroun : 9 chiffres, commençant par 6 ou 2)
 */
import { AsYouType, getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";
import { abonnerLangue, langue } from "./langue";

/* ---------------------------------------------------------------- noms */

const NOM = /^\p{L}+([ '.-]+\p{L}+)*\.?$/u;

/** Mis en forme pendant la frappe : espaces resserrés, une capitale au début de chaque mot. */
export function nomPropre(brut: string): string {
  const v = brut.replace(/’/g, "'").replace(/\s+/g, " ").replace(/^ /, "");
  return v.toLocaleLowerCase("fr").replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, avant: string, l: string) => avant + l.toLocaleUpperCase("fr"));
}

export function nomValide(brut: string): boolean {
  const v = nomPropre(brut).trim();
  return v.length >= 2 && v.length <= 60 && NOM.test(v);
}

/* -------------------------------------------------------------- e-mail */

export const emailNormalise = (brut: string): string => brut.trim().toLowerCase();
export const emailValide = (brut: string): boolean => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(emailNormalise(brut)) && brut.trim().length <= 254;

/* ----------------------------------------------------------- naissance */

export const MAJORITE = 18;

/** « 14 », « 5 », « 1990 » → « 1990-05-14 », ou null si la date n'existe pas (31 février…). */
export function dateDepuis(jour: string, mois: string, annee: string): string | null {
  const j = Number(jour), m = Number(mois), a = Number(annee);
  if (!/^\d{1,2}$/.test(jour) || !/^\d{1,2}$/.test(mois) || !/^\d{4}$/.test(annee)) return null;
  const d = new Date(Date.UTC(a, m - 1, j));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== j) return null;
  return `${a}-${String(m).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
}

/** L'âge en années révolues à la date `le` (aujourd'hui par défaut). */
export function ageAu(naissance: string, le: Date = new Date()): number {
  const [a, m, j] = naissance.split("-").map(Number);
  let age = le.getFullYear() - a;
  if (le.getMonth() + 1 < m || (le.getMonth() + 1 === m && le.getDate() < j)) age--;
  return age;
}

export type VerdictNaissance = { ok: true; age: number } | { ok: false; raison: "incomplete" | "inexistante" | "future" | "mineur" | "trop_ancienne"; age?: number };

export function verdictNaissance(jour: string, mois: string, annee: string, le: Date = new Date()): VerdictNaissance {
  if (!jour || !mois || annee.length < 4) return { ok: false, raison: "incomplete" };
  const iso = dateDepuis(jour, mois, annee);
  if (!iso) return { ok: false, raison: "inexistante" };
  const age = ageAu(iso, le);
  if (age < 0) return { ok: false, raison: "future" };
  if (age < MAJORITE) return { ok: false, raison: "mineur", age };
  if (age > 120) return { ok: false, raison: "trop_ancienne", age };
  return { ok: true, age };
}

/* ---------------------------------------------------------- les pays */

export type Pays = { code: CountryCode; nom: string; indicatif: string; drapeau: string };

const drapeau = (code: string) => String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
/* Le nom d'un pays dans la langue de l'écran (« Cameroun », « Cameroon ») : lu à chaque affichage, pas figé à l'import. */
const nomsParLangue = new Map<string, Intl.DisplayNames | null>();
function nomDuPays(code: string): string {
  const l = langue();
  if (!nomsParLangue.has(l)) nomsParLangue.set(l, typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames([l], { type: "region" }) : null); // langue-ok
  return nomsParLangue.get(l)?.of(code) ?? code;
}

/** En tête de liste : la zone du franc CFA d'Afrique centrale (le XAF), puis les voisins et les partenaires fréquents. */
export const PAYS_EN_TETE: CountryCode[] = ["CM", "GA", "CG", "TD", "CF", "GQ", "NG", "CI", "SN", "CD", "FR", "BE", "CN", "AE", "US"];

/* Chaque pays porte son nom en accesseur ; la liste reste le même tableau, retrié
   sur place quand la langue change (l'ordre alphabétique n'est pas le même). */
export const PAYS: Pays[] = getCountries().map((code) => ({ code, get nom() { return nomDuPays(code); }, indicatif: `+${getCountryCallingCode(code)}`, drapeau: drapeau(code) }));

function trierLesPays() {
  const tete = PAYS_EN_TETE.map((c) => PAYS.find((p) => p.code === c)).filter((p): p is Pays => Boolean(p));
  const reste = PAYS.filter((p) => !PAYS_EN_TETE.includes(p.code)).sort((a, b) => a.nom.localeCompare(b.nom, langue()));
  PAYS.splice(0, PAYS.length, ...tete, ...reste);
}
trierLesPays();
abonnerLangue(trierLesPays);

export const paysDe = (code: string): Pays | undefined => PAYS.find((p) => p.code === code);

/* ----------------------------------------------------------- téléphone */

/** Le numéro tel qu'il s'affiche pendant la frappe, pour le pays choisi : « 677123 » → « 6 77 12 3 ». */
export function telephoneEnDirect(pays: CountryCode, saisie: string): string {
  const chiffres = saisie.replace(/[^\d+]/g, "");
  if (!chiffres) return "";
  return new AsYouType(pays).input(chiffres);
}

/** Le numéro au format international (« +237677123456 ») s'il est valide pour ce pays, sinon null. */
export function telephoneE164(pays: CountryCode, saisie: string): string | null {
  const n = parsePhoneNumberFromString(saisie.trim(), pays);
  if (!n || !n.isValid()) return null;
  if (n.country && n.country !== pays && !(saisie.trim().startsWith("+"))) return null;
  if (n.number.startsWith("+237") && !/^\+237[62]\d{8}$/.test(n.number)) return null;
  return n.number;
}

/** Pour l'affichage : « +237677123456 » → « +237 6 77 12 34 56 » ; un ancien numéro local reste tel quel. */
export function telephoneLisible(e164: string): string {
  if (!e164.startsWith("+")) return e164;
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

/* --------------------------------------------------------------- villes */

/** Les villes proposées pendant la frappe ; on peut toujours en taper une autre. Des noms propres : ils ne se traduisent pas. */
export const VILLES: Partial<Record<CountryCode, string[]>> = {
  CM: ["Douala", "Yaoundé", "Bafoussam", "Bamenda", "Garoua", "Maroua", "Ngaoundéré", "Bertoua", "Kribi", "Limbé", "Buea", "Ebolowa", "Kumba", // langue-ok
       "Nkongsamba", "Edéa", "Dschang", "Foumban", "Mbalmayo", "Loum", "Kousséri", "Mbouda", "Sangmélima", "Bafang", "Bangangté", "Batouri", "Mokolo", "Tiko", "Yagoua", "Meiganga", "Guider"], // langue-ok
  GA: ["Libreville", "Port-Gentil", "Franceville", "Oyem", "Moanda", "Lambaréné", "Mouila"], // langue-ok
  CG: ["Brazzaville", "Pointe-Noire", "Dolisie", "Nkayi", "Owando"], // langue-ok
  TD: ["N'Djaména", "Moundou", "Sarh", "Abéché", "Kélo"], // langue-ok
  CF: ["Bangui", "Bimbo", "Berbérati", "Carnot", "Bambari"], // langue-ok
  GQ: ["Malabo", "Bata", "Ebebiyín", "Mongomo"], // langue-ok
};
