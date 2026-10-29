/*
 * L'ENTRÉE DANS L'APPLICATION, comme une fonction pure : d'après ce que
 * Supabase Auth et la base disent de la session, où la personne doit aller.
 *
 *   pas de session                    → anonyme (Bienvenue)
 *   entrée par un code e-mail seul    → anonyme : la session est fermée (une
 *                                        session sans mot de passe ni Google
 *                                        n'est jamais forte, même après le TOTP)
 *   adresse pas encore confirmée      → le code reçu par e-mail
 *   pas de mot de passe (Google)      → choisir un mot de passe
 *   aucune application enrôlée        → l'enrôler
 *   application enrôlée, pas vérifiée → son code à six chiffres
 *   codes de secours pas notés        → les noter
 *   pas de compte                     → le profil, sur un écran
 *   tout est là                       → l'application
 *
 * « Mot de passe oublié » est un détour à part (récupération) : la session y
 * vient d'un code e-mail, et n'ouvre que deux écrans — le code de
 * l'application (ou un code de secours), puis le nouveau mot de passe.
 * La base revérifie tout (session_forte, _exiger_aal2) : l'écran ne fait que
 * mener au bon endroit.
 */
import type { EtatDEntree } from "../guichet/types";

export type PhaseDEntree =
  | { phase: "anonyme"; raison?: "facteur_faible" }
  | { phase: "email_a_confirmer" }
  | { phase: "mot_de_passe_a_choisir" }
  | { phase: "deux_facteurs_a_enroler" }
  | { phase: "deux_facteurs_a_verifier" }
  | { phase: "codes_a_noter" }
  | { phase: "inscription" }
  | { phase: "recuperation"; etape: "deux_facteurs" | "nouveau" }
  | { phase: "connecte" };

export const ENTREE_VIDE: EtatDEntree = {
  session: false, premierFacteur: null, aalActuel: null, aalSuivant: null,
  emailConfirme: false, motDePasse: false, codesDeSecours: false, compte: false, facteurTotpId: null,
};

/** Le premier facteur d'après la liste amr de GoTrue (objets {method, timestamp} ou chaînes, selon le jeton). */
export function premierFacteurDe(amr: ReadonlyArray<{ method?: string } | string> | null | undefined): EtatDEntree["premierFacteur"] {
  if (!amr || amr.length === 0) return null;
  const methodes = amr.map((e) => (typeof e === "string" ? e : e?.method ?? ""));
  if (methodes.includes("password")) return "password";
  if (methodes.includes("oauth")) return "oauth";
  return "autre";
}

export function phaseDEntree(e: EtatDEntree, recuperationEnCours: boolean): PhaseDEntree {
  if (!e.session) return { phase: "anonyme" };
  if (recuperationEnCours) {
    /* le code e-mail de réinitialisation a ouvert la session : l'application d'abord, s'il y en a une */
    return e.aalSuivant === "aal2" && e.aalActuel !== "aal2" ? { phase: "recuperation", etape: "deux_facteurs" } : { phase: "recuperation", etape: "nouveau" };
  }
  if (e.premierFacteur !== "password" && e.premierFacteur !== "oauth") return { phase: "anonyme", raison: "facteur_faible" };
  if (!e.emailConfirme) return { phase: "email_a_confirmer" };
  if (!e.motDePasse) return { phase: "mot_de_passe_a_choisir" };
  if (e.aalSuivant !== "aal2") return { phase: "deux_facteurs_a_enroler" };
  if (e.aalActuel !== "aal2") return { phase: "deux_facteurs_a_verifier" };
  if (!e.codesDeSecours) return { phase: "codes_a_noter" };
  if (!e.compte) return { phase: "inscription" };
  return { phase: "connecte" };
}

/** Chaque phase a son chemin : la Porte et la Garde y ramènent. */
export function cheminDeLaPhase(p: PhaseDEntree | { phase: "chargement" }): string {
  switch (p.phase) {
    case "chargement": return "/bienvenue";
    case "anonyme": return "/bienvenue";
    case "email_a_confirmer": return "/bienvenue/code";
    case "mot_de_passe_a_choisir": return "/bienvenue/mot-de-passe";
    case "deux_facteurs_a_enroler": return "/bienvenue/deux-facteurs";
    case "deux_facteurs_a_verifier": return "/bienvenue/deux-facteurs/code";
    case "codes_a_noter": return "/bienvenue/codes-de-secours";
    case "inscription": return "/bienvenue/inscription";
    case "recuperation": return p.etape === "deux_facteurs" ? "/bienvenue/deux-facteurs/code" : "/bienvenue/oubli/nouveau";
    case "connecte": return "/";
  }
}

/** Les chemins d'entrée qu'une phase laisse ouverts (au-delà du sien). */
export function cheminPermis(p: PhaseDEntree, chemin: string): boolean {
  if (chemin === cheminDeLaPhase(p)) return true;
  switch (p.phase) {
    case "anonyme":
      return chemin === "/bienvenue" || chemin === "/bienvenue/code" || chemin === "/bienvenue/retour" || chemin.startsWith("/bienvenue/oubli");
    case "email_a_confirmer":
      return chemin === "/bienvenue";
    case "deux_facteurs_a_verifier":
      return chemin === "/bienvenue/secours";
    case "recuperation":
      return p.etape === "deux_facteurs" && chemin === "/bienvenue/secours";
    default:
      return false;
  }
}
