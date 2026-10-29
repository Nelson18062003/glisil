// RETIRER LA DOUBLE AUTHENTIFICATION : ce que seul Auth sait faire, décidé par la base.
//
// Deux chemins, tous deux décrits dans 0035 (section 7) :
//   · code_de_secours — la personne a perdu son téléphone. Elle est entrée avec
//     son mot de passe (session aal1) et donne un code de secours. La BASE juge
//     le code (essais, verrou : _consommer_code_de_secours) ; la fonction retire
//     les facteurs chez GoTrue, puis la base efface les codes et prévient
//     (_deux_facteurs_retires). Si GoTrue refuse, le code brûlé est RENDU :
//     personne ne reste sans facteur ET sans ce code.
//   · reinitialisation — un super admin a vérifié l'identité et posé un motif
//     (admin_autoriser_reinitialisation_2fa, avec SA session). La fonction
//     exécute cette autorisation-là, une fois, pour l'admin qui l'a posée, dans
//     le quart d'heure, et revérifie son droit avec son propre jeton.
//
// L'appelant est TOUJOURS celui du jeton (Authorization), jamais un identifiant
// lu dans le corps. Rien ici ne parle à Supabase directement : la fonction lui
// passe ses dépendances ; verifier-deux-facteurs.ts passe des faux.

export type Facteur = { id: string; type: string };
export type Deps = {
  /** l'utilisateur du jeton, vérifié par Auth (auth.getUser) — null si le jeton ne vaut rien */
  utilisateurDuJeton: (jwt: string) => Promise<{ id: string } | null>;
  /** les fonctions internes de la base, avec la clé de service */
  rpc: (nom: string, args: Record<string, unknown>) => Promise<unknown>;
  /** une fonction de la base, AU NOM de l'appelant (son jeton) : auth.uid() est le sien */
  rpcEnTantQue: (jwt: string, nom: string, args: Record<string, unknown>) => Promise<unknown>;
  /** la ligne d'autorisation d'une réinitialisation (clé de service) */
  reinitialisation: (id: string) => Promise<{ id: string; utilisateur_id: string; admin_id: string; demandee_le: string; faite_le: string | null } | null>;
  facteurs: (utilisateur: string) => Promise<Facteur[]>;
  retirerFacteur: (utilisateur: string, facteur: string) => Promise<void>;
  maintenant?: () => number;
};
export type Reponse = { statut: number; corps: Record<string, unknown> };

/** Une autorisation de l'administration ne vaut qu'un quart d'heure : on l'exécute tout de suite, ou on la redemande. */
export const VALIDITE_REINITIALISATION_MS = 15 * 60_000;

const refus = (statut: number, erreur: string, plus: Record<string, unknown> = {}): Reponse => ({ statut, corps: { erreur, ...plus } });

function jetonDe(authorization: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  return m ? m[1] : null;
}

/** Retire TOUS les facteurs de la personne (vérifiés ou non : un enrôlement abandonné ne doit pas survivre). Lève au premier refus. */
async function toutRetirer(deps: Deps, utilisateur: string): Promise<number> {
  const liste = await deps.facteurs(utilisateur);
  for (const f of liste) await deps.retirerFacteur(utilisateur, f.id);
  return liste.length;
}

export async function traiter(deps: Deps, authorization: string | null | undefined, corps: unknown): Promise<Reponse> {
  const jwt = jetonDe(authorization);
  if (!jwt) return refus(401, "session requise");
  const moi = await deps.utilisateurDuJeton(jwt).catch(() => null);
  if (!moi) return refus(401, "session requise");
  const c = (corps ?? {}) as Record<string, unknown>;

  if (c.action === "code_de_secours") {
    if (typeof c.code !== "string" || c.code.length === 0 || c.code.length > 40) return refus(200, "code de secours incorrect");
    const r = (await deps.rpc("_consommer_code_de_secours", { p_utilisateur: moi.id, p_code: c.code })) as Record<string, unknown> | null;
    if (!r || r.ok !== true) {
      /* le refus de la base, tel quel : son message et ses essais (l'application les montre sous le titre) */
      const { ok: _ok, ...reste } = r ?? { erreur: "code de secours incorrect" };
      return { statut: 200, corps: { erreur: String(reste.erreur ?? "code de secours incorrect"), ...reste } };
    }
    let n: number;
    try {
      n = await toutRetirer(deps, moi.id);
    } catch {
      await deps.rpc("_code_de_secours_rendu", { p_code_id: r.code_id }).catch(() => undefined);
      return refus(502, "la double authentification n'a pas pu être retirée", { detail: "votre code de secours vous est rendu : réessayez dans un instant" });
    }
    await deps.rpc("_deux_facteurs_retires", { p_utilisateur: moi.id, p_cause: "code_de_secours", p_reinitialisation: null, p_facteurs: n });
    return { statut: 200, corps: { ok: true, facteurs: n } };
  }

  if (c.action === "reinitialisation") {
    if (typeof c.id !== "string" || !/^[0-9a-f-]{36}$/i.test(c.id)) return refus(400, "réinitialisation inconnue");
    /* le droit, revérifié au nom de l'appelant : un admin désactivé, ou sans le droit, n'exécute rien */
    const droit = await deps.rpcEnTantQue(jwt, "admin_a_droit", { p_droit: "administrateurs" }).catch(() => false);
    if (droit !== true) return refus(403, "accès refusé");
    const ri = await deps.reinitialisation(c.id);
    if (!ri || ri.admin_id !== moi.id) return refus(404, "réinitialisation inconnue");
    if (ri.faite_le) return refus(409, "réinitialisation déjà faite");
    const age = (deps.maintenant ?? Date.now)() - Date.parse(ri.demandee_le);
    if (!(age >= 0 && age <= VALIDITE_REINITIALISATION_MS)) return refus(410, "autorisation expirée", { detail: "posez une nouvelle autorisation" });
    let n: number;
    try {
      n = await toutRetirer(deps, ri.utilisateur_id);
    } catch (e) {
      await deps.rpc("_reinitialisation_2fa_echouee", { p_id: ri.id, p_erreur: e instanceof Error ? e.message : String(e) }).catch(() => undefined);
      return refus(502, "la double authentification n'a pas pu être retirée");
    }
    await deps.rpc("_deux_facteurs_retires", { p_utilisateur: ri.utilisateur_id, p_cause: "administration", p_reinitialisation: ri.id, p_facteurs: n });
    return { statut: 200, corps: { ok: true, facteurs: n } };
  }

  return refus(400, "action inconnue");
}

/* --------------------------------------------------------------- CORS */

/** Les origines de l'application et de l'administration (ORIGINES : liste séparée par des virgules). */
export function entetesCors(origine: string | null, autorisees: string[]): Record<string, string> {
  const h: Record<string, string> = {
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "Origin",
  };
  if (origine && autorisees.includes(origine)) h["access-control-allow-origin"] = origine;
  return h;
}
