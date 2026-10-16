/*
 * Ce qu'un parcours retient d'une étape à l'autre : le montant tapé, le numéro
 * choisi, le côté du formulaire de trading. Un seul registre, en mémoire ; un
 * parcours fini l'efface. Le trading garde son état quand on change d'onglet.
 */
import { useSyncExternalStore } from "react";
import type { Actif, Cote, IdOperateur, Reseau, TypeOrdre } from "../guichet/types";

export type Parcours = {
  /** montant : ce que le client compte envoyer — une indication, le SMS fait foi */
  entrer: { operateur: IdOperateur | null; montant: number };
  /** nom : le nom exact du compte Mobile Money, quand l'équipe paie à la main */
  sortir: { montant: number; numeroId: string | null; nom: string };
  crypto: { actif: Actif; reseau: Reseau; adresse: string; montant: number };
  marche: { cote: Cote; type: TypeOrdre; prix: string; quantite: string };
  /** où revenir après un sous-parcours (ajouter un numéro depuis Sortir) */
  retour: string | null;
};

const INITIAL: Parcours = {
  entrer: { operateur: null, montant: 0 },
  sortir: { montant: 0, numeroId: null, nom: "" },
  crypto: { actif: "USDT", reseau: "bep20", adresse: "", montant: 0 },
  marche: { cote: "achat", type: "limite", prix: "", quantite: "" },
  retour: null,
};

let etat: Parcours = structuredClone(INITIAL);
const auditeurs = new Set<() => void>();

function emettre() { for (const cb of auditeurs) cb(); }

export const parcours = {
  lire: () => etat,
  poser<K extends keyof Parcours>(section: K, valeur: Partial<Parcours[K]>) {
    etat = { ...etat, [section]: typeof etat[section] === "object" && etat[section] !== null ? { ...(etat[section] as object), ...(valeur as object) } : valeur };
    emettre();
  },
  poserRetour(chemin: string | null) { etat = { ...etat, retour: chemin }; emettre(); },
  effacer<K extends keyof Parcours>(section: K) { etat = { ...etat, [section]: structuredClone(INITIAL[section]) }; emettre(); },
  sAbonner(cb: () => void) { auditeurs.add(cb); return () => { auditeurs.delete(cb); }; },
};

export function useParcours<K extends keyof Parcours>(section: K): [Parcours[K], (v: Partial<Parcours[K]>) => void] {
  const tout = useSyncExternalStore(parcours.sAbonner, parcours.lire, parcours.lire);
  return [tout[section], (v) => parcours.poser(section, v)];
}
