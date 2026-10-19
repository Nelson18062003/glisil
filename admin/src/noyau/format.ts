/*
 * Les formats : comment un montant, un prix, un numéro ou une date se LISENT.
 * Une seule écriture pour tous les écrans — un chiffre qu'on tape se lit comme
 * on le dit : « 1 000 000 », « 618,40 », « 6 77 12 34 56 ».
 */

const ESPACE = " ";

/** « 1234567 » → « 1 234 567 » ; décimales séparées par une virgule. */
export function enTranches(n: number, decimales = 0): string {
  if (!Number.isFinite(n)) return "—";
  const signe = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  const fixe = abs.toFixed(decimales);
  const [ent, dec] = fixe.split(".");
  const tranches = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ESPACE);
  return signe + (dec !== undefined ? `${tranches},${dec}` : tranches);
}

/** Un montant en XAF / XAFe : entier, en tranches. */
export function xaf(n: number): string {
  return enTranches(Math.round(n), 0);
}

/** Un prix en XAFe par USDT : deux décimales, toujours. */
export function prix(n: number): string {
  return enTranches(n, 2);
}

/** Une quantité d'USDT : entière si elle l'est, sinon deux décimales. */
export function usdt(n: number): string {
  return Number.isInteger(Math.round(n * 100) / 100) && Number.isInteger(n) ? enTranches(n, 0) : enTranches(n, 2);
}

/** Un montant signé pour une liste : « +1 000 000 », « −500 000 ». */
export function signe(n: number, decimales = 0): string {
  const corps = enTranches(Math.abs(n), decimales);
  return n >= 0 ? `+${corps}` : `−${corps}`;
}

/** « 677123456 » → « 6 77 12 34 56 » ; une saisie partielle se lit aussi. */
export function numeroEnTranches(brut: string): string {
  const chiffres = brut.replace(/\D/g, "").replace(/^237/, "").slice(0, 9);
  if (!chiffres) return "";
  const morceaux = [chiffres.slice(0, 1), chiffres.slice(1, 3), chiffres.slice(3, 5), chiffres.slice(5, 7), chiffres.slice(7, 9)];
  return morceaux.filter((m) => m.length > 0).join(ESPACE);
}

/** Ce qui part au moteur : neuf chiffres, sans indicatif ni espace. */
export function numeroSaisi(brut: string): string {
  return brut.replace(/\D/g, "").replace(/^237/, "").slice(0, 9);
}

export function numeroValide(brut: string): boolean {
  return /^6\d{8}$/.test(numeroSaisi(brut));
}

/** L'opérateur qu'un numéro camerounais laisse deviner, d'après son préfixe. */
export function operateurDuNumero(brut: string): "mtn" | "om" | null {
  const n = numeroSaisi(brut);
  if (n.length < 3) return null;
  // Les cartes de la démo vivante de TOTEM (600 0x pour MTN, 600 9x pour
  // Orange) : la base ne les reconnaît que pendant la bêta (0028) — elle
  // refusera hors bêta ; l'écran, lui, ne bloque pas avant elle.
  if (n.startsWith("6000")) return "mtn";
  if (n.startsWith("6009")) return "om";
  const p = Number(n.slice(0, 3));
  if ((p >= 650 && p <= 654) || (p >= 670 && p <= 689)) return "mtn";
  if ((p >= 655 && p <= 659) || (p >= 690 && p <= 699)) return "om";
  return null;
}

/**
 * Un transaction ID d'opérateur, tel qu'on le compare : majuscules, sans espaces
 * ni ponctuation. MTN écrit « 20394817104 », Orange « MP261012.1402.A12345 » ;
 * le client le recopie comme il peut.
 */
export function transactionIdNormalise(brut: string): string {
  return brut.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* ------------------------------------------------------------------ pavé */

/** Une touche du pavé appliquée à la saisie courante (chiffres seuls). */
export function apresFrappe(saisie: string, touche: string, maxChiffres = 10): string {
  if (touche === "⌫") return saisie.slice(0, -1);
  const suite = (saisie + touche).replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return suite.slice(0, maxChiffres);
}

export function montantDepuisSaisie(saisie: string): number {
  return saisie ? Number(saisie) : 0;
}

/* ----------------------------------------------------------------- dates */

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export function heure(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function heureSecondes(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${heure(d)}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function memeJour(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** « Aujourd'hui », « Hier », sinon « 12 oct. » (et l'année si elle diffère). */
export function jourRelatif(iso: string | Date, maintenant = new Date()): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (memeJour(d, maintenant)) return "Aujourd'hui";
  const hier = new Date(maintenant);
  hier.setDate(hier.getDate() - 1);
  if (memeJour(d, hier)) return "Hier";
  const base = `${d.getDate()} ${MOIS[d.getMonth()]}`;
  return d.getFullYear() === maintenant.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** « aujourd'hui à 14:02 » — pour une fiche. */
export function quand(iso: string | Date, maintenant = new Date()): string {
  const j = jourRelatif(iso, maintenant);
  const jour = j === "Aujourd'hui" ? "aujourd'hui" : j === "Hier" ? "hier" : `le ${j}`;
  return `${jour} à ${heure(iso)}`;
}

/** Une durée en secondes → « 40 s », « 2 min 05 ». */
export function duree(secondes: number): string {
  const s = Math.max(0, Math.round(secondes));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, "0")}`;
}

export function initiales(nom: string | null | undefined): string {
  if (!nom) return "?";
  return nom
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((m) => m[0]?.toUpperCase() ?? "")
    .join("");
}

/** « 0x3fA8…9C21 » — une adresse longue dans une liste. */
export function adresseCourte(adresse: string): string {
  return adresse.length <= 14 ? adresse : `${adresse.slice(0, 6)}…${adresse.slice(-4)}`;
}
