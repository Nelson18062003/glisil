/*
 * L'ENTRÉE DANS L'ADMINISTRATION, comme une fonction pure : d'après ce que
 * Supabase Auth et la base disent de la session, l'étape où mener la personne.
 *
 *   pas de session                     → l'adresse et le mot de passe
 *   pas entrée par son mot de passe    → refusée (la session est fermée) : un
 *                                         code e-mail seul ne mène jamais à
 *                                         l'administration — pas de Google ici
 *   adresse pas encore confirmée       → le code reçu par e-mail
 *   pas de mot de passe                → le choisir
 *   aucune application enrôlée         → l'enrôler
 *   application enrôlée, pas vérifiée  → son code à six chiffres
 *   codes de secours pas notés         → les noter
 *   tout est là                        → entrer (entrer_administration décide
 *                                         si l'adresse administre Glisil)
 *
 * « Mot de passe oublié » est un détour : la session y vient d'un code e-mail,
 * et n'ouvre que le code de l'application (s'il y en a une), puis le nouveau
 * mot de passe. La base revérifie tout (session_forte, entrer_administration) :
 * l'écran ne fait que mener au bon endroit. Même règle que app/src/noyau/entree.ts.
 */

export type EtatAuth = {
  session: boolean;
  /** le premier facteur de la session, lu dans « amr » */
  premierFacteur: "password" | "oauth" | "autre" | null;
  aalActuel: "aal1" | "aal2" | null;
  aalSuivant: "aal1" | "aal2" | null;
  emailConfirme: boolean;
  motDePasse: boolean;
  codesDeSecours: boolean;
};

export type PhaseAdmin =
  | { phase: "anonyme"; raison?: "facteur_faible" }
  | { phase: "email_a_confirmer" }
  | { phase: "mot_de_passe_a_choisir" }
  | { phase: "deux_facteurs_a_enroler" }
  | { phase: "deux_facteurs_a_verifier" }
  | { phase: "codes_a_noter" }
  | { phase: "recuperation"; etape: "deux_facteurs" | "nouveau" }
  | { phase: "pret" };

export const AUTH_VIDE: EtatAuth = { session: false, premierFacteur: null, aalActuel: null, aalSuivant: null, emailConfirme: false, motDePasse: false, codesDeSecours: false };

/** Le premier facteur d'après la liste amr de GoTrue (objets {method, timestamp} ou chaînes, selon le jeton). */
export function premierFacteurDe(amr: ReadonlyArray<{ method?: string } | string> | null | undefined): EtatAuth["premierFacteur"] {
  if (!amr || amr.length === 0) return null;
  const methodes = amr.map((e) => (typeof e === "string" ? e : e?.method ?? ""));
  if (methodes.includes("password")) return "password";
  if (methodes.includes("oauth")) return "oauth";
  return "autre";
}

export function phaseAdmin(e: EtatAuth, recuperationEnCours: boolean): PhaseAdmin {
  if (!e.session) return { phase: "anonyme" };
  if (recuperationEnCours) {
    return e.aalSuivant === "aal2" && e.aalActuel !== "aal2" ? { phase: "recuperation", etape: "deux_facteurs" } : { phase: "recuperation", etape: "nouveau" };
  }
  /* l'administration n'offre que le mot de passe : un code e-mail seul, ou Google, n'y entre pas */
  if (e.premierFacteur !== "password") return { phase: "anonyme", raison: "facteur_faible" };
  if (!e.emailConfirme) return { phase: "email_a_confirmer" };
  if (!e.motDePasse) return { phase: "mot_de_passe_a_choisir" };
  if (e.aalSuivant !== "aal2") return { phase: "deux_facteurs_a_enroler" };
  if (e.aalActuel !== "aal2") return { phase: "deux_facteurs_a_verifier" };
  if (!e.codesDeSecours) return { phase: "codes_a_noter" };
  return { phase: "pret" };
}

/** La règle d'Auth (supabase/config.toml), la même que app/src/noyau/motDePasse.ts : dix caractères au
    moins, des lettres et des chiffres ASCII (Auth ne compte qu'eux), 72 octets au plus (bcrypt ignore la suite). */
export const MOT_DE_PASSE_MIN = 10;
export const motDePasseValide = (m: string): boolean =>
  m.length >= MOT_DE_PASSE_MIN && new TextEncoder().encode(m).length <= 72 && /[A-Za-z]/.test(m) && /[0-9]/.test(m);
