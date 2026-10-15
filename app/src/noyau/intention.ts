/*
 * La clé d'intention d'un geste d'argent appartient à l'INTENTION — ce que
 * la personne veut faire : tel montant vers tel numéro, tel ordre à tel prix —
 * pas à l'écran qui la porte.
 *
 * Elle vivait dans l'écran du code : revenir en arrière puis y retourner en
 * fabriquait une neuve ; une sortie dont la réponse s'était perdue en route
 * repartait alors une seconde fois, avec une clé que le moteur ne
 * reconnaissait pas. Et l'inverse pour un ordre : la même clé restait sur un
 * formulaire dont on changeait le prix, et le moteur rendait l'ANCIEN ordre
 * (« déjà placé ») en face du nouveau.
 *
 * Règle : la même intention garde la même clé jusqu'à ce que le geste
 * RÉUSSISSE ; alors elle est oubliée (deux sorties identiques voulues, l'une
 * après l'autre, sont deux gestes). Une intention différente a sa propre clé.
 * Le registre survit à un rechargement de la page (sessionStorage), pas à la
 * fermeture de l'onglet.
 */
import { nouvelleCle } from "./argent";

const STOCKAGE = "xafe-intentions";
let registre: Record<string, string> | null = null;

function lire(): Record<string, string> {
  if (registre) return registre;
  try { registre = JSON.parse(globalThis.sessionStorage?.getItem(STOCKAGE) ?? "{}") ?? {}; } catch { registre = {}; }
  return registre!;
}
function ecrire() {
  try { globalThis.sessionStorage?.setItem(STOCKAGE, JSON.stringify(registre ?? {})); } catch { /* navigation privée : la mémoire suffit */ }
}

/** Ce qui définit l'intention, sous une forme stable (l'ordre des champs ne compte pas). */
export function empreinteIntention(prefixe: string, intention: unknown): string {
  const stable = (v: unknown): unknown =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]))
      : v;
  return `${prefixe}:${JSON.stringify(stable(intention))}`;
}

/** La clé de cette intention : la même tant qu'elle n'a pas réussi. */
export function cleDeLIntention(prefixe: string, intention: unknown): string {
  const r = lire();
  const id = empreinteIntention(prefixe, intention);
  if (!r[id]) { r[id] = nouvelleCle(prefixe); ecrire(); }
  return r[id];
}

/** Le geste a réussi : la prochaine intention identique sera un geste neuf. */
export function intentionAccomplie(prefixe: string, intention: unknown): void {
  const r = lire();
  delete r[empreinteIntention(prefixe, intention)];
  ecrire();
}

/** Pour les épreuves : repartir d'un registre vide. */
export function oublierToutesLesIntentions(): void { registre = {}; ecrire(); }
