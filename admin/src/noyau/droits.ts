/*
 * La matrice des droits, copie de `droits_du_role` (0003_administration.sql).
 * Le test de parité (droits.test.ts) lit la migration et compare : si l'une
 * change sans l'autre, il échoue. L'écran ne fait que cacher ce que la base
 * refuse de toute façon.
 */
export type Role = "super_admin" | "operateur" | "tresorier" | "support";
export type Droit = "voir" | "rapprocher" | "rembourser" | "sorties" | "terminaux" | "clients" | "paliers" | "parametres" | "marche" | "administrateurs";

export const DROITS: Record<Role, Droit[]> = {
  super_admin: ["voir", "rapprocher", "rembourser", "sorties", "terminaux", "clients", "paliers", "parametres", "marche", "administrateurs"],
  operateur: ["voir", "rapprocher", "sorties", "terminaux", "clients"],
  tresorier: ["voir", "rembourser", "parametres", "marche", "clients"],
  support: ["voir", "clients"],
};

export const NOMS_DES_ROLES: Record<Role, string> = {
  super_admin: "Super administrateur",
  operateur: "Opérateur",
  tresorier: "Trésorier",
  support: "Support",
};

export function aLeDroit(role: Role | null | undefined, droit: Droit): boolean {
  return Boolean(role && DROITS[role]?.includes(droit));
}
