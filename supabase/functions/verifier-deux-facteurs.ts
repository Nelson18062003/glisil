// RETIRER LA DOUBLE AUTHENTIFICATION, ATTAQUÉ.
//
//   node --experimental-strip-types supabase/functions/verifier-deux-facteurs.ts
//
// Fait tourner le VRAI code (_shared/deux-facteurs.ts) devant une fausse base
// et un faux Auth, et essaie : sans jeton, avec un jeton forgé, au nom d'un
// autre (un identifiant glissé dans le corps), avec un mauvais code, en
// faisant échouer Auth au milieu, en exécutant la réinitialisation d'un autre
// admin, une seconde fois, trop tard, sans le droit. Chaque exigence a son
// témoin : une variante fautive écrite ici, qui doit échouer.
import assert from "node:assert/strict";
import { entetesCors, traiter, VALIDITE_REINITIALISATION_MS, type Deps } from "./_shared/deux-facteurs.ts";

let n = 0;
const ok = (texte: string) => { n++; console.log(`✓ ${texte}`); };

const AWA = "aaaaaaaa-0000-0000-0000-000000000001", BOB = "bbbbbbbb-0000-0000-0000-000000000002";
const ADMIN = "adadadad-0000-0000-0000-000000000003", AUTRE_ADMIN = "adadadad-0000-0000-0000-000000000004";
const RI = "11111111-2222-3333-4444-555555555555";
const T0 = Date.parse("2026-10-29T10:00:00Z");

/** Une fausse plateforme : des jetons, des facteurs, une base qui juge les codes comme 0035. */
function plateforme(opts: { gotrueRefuse?: boolean; droitAdmin?: boolean; ri?: Partial<{ admin_id: string; faite_le: string | null; demandee_le: string }> } = {}) {
  const jetons: Record<string, string> = { "jeton-awa": AWA, "jeton-bob": BOB, "jeton-admin": ADMIN, "jeton-autre-admin": AUTRE_ADMIN };
  const facteurs: Record<string, string[]> = { [AWA]: ["f-awa-1", "f-awa-2"], [BOB]: ["f-bob"] };
  const codes: Record<string, { code: string; id: number; utilise: boolean }[]> = { [AWA]: [{ code: "7K3QD9WMXA", id: 1, utilise: false }] };
  const appels: { nom: string; args: Record<string, unknown> }[] = [];
  const ri = { id: RI, utilisateur_id: BOB, admin_id: ADMIN, demandee_le: new Date(T0 - 60_000).toISOString(), faite_le: null as string | null, ...opts.ri };
  const deps: Deps = {
    utilisateurDuJeton: async (jwt) => (jetons[jwt] ? { id: jetons[jwt] } : null),
    rpc: async (nom, args) => {
      appels.push({ nom, args });
      if (nom === "_consommer_code_de_secours") {
        const c = (codes[args.p_utilisateur as string] ?? []).find((x) => x.code === args.p_code && !x.utilise);
        if (!c) return { ok: false, erreur: "code de secours incorrect", essais_restants: 4 };
        c.utilise = true;
        return { ok: true, code_id: c.id, restants: 0 };
      }
      if (nom === "_code_de_secours_rendu") { for (const l of Object.values(codes)) for (const c of l) if (c.id === args.p_code_id) c.utilise = false; return null; }
      if (nom === "_deux_facteurs_retires") { if (args.p_reinitialisation) ri.faite_le = new Date(T0).toISOString(); return { ok: true }; }
      if (nom === "_reinitialisation_2fa_echouee") return null;
      throw new Error(`rpc inattendue ${nom}`);
    },
    rpcEnTantQue: async (jwt, nom) => {
      assert.equal(nom, "admin_a_droit");
      return (jetons[jwt] === ADMIN || jetons[jwt] === AUTRE_ADMIN) && opts.droitAdmin !== false;
    },
    reinitialisation: async (id) => (id === RI ? { ...ri } : null),
    facteurs: async (u) => (facteurs[u] ?? []).map((id) => ({ id, type: "totp" })),
    retirerFacteur: async (u, f) => {
      if (opts.gotrueRefuse && f.endsWith("-2")) throw new Error("GoTrue indisponible");
      facteurs[u] = (facteurs[u] ?? []).filter((x) => x !== f);
    },
    maintenant: () => T0,
  };
  return { deps, facteurs, codes, appels, ri };
}

/* ------------------------------------------------------------- l'appelant */
{
  const p = plateforme();
  for (const auth of [undefined, null, "", "jeton-awa", "Bearer", "Bearer jeton-forge", "Basic jeton-awa"]) {
    const r = await traiter(p.deps, auth, { action: "code_de_secours", code: "7K3QD9WMXA" });
    assert.equal(r.statut, 401, `« ${auth} » : refusé`);
  }
  assert.equal(p.appels.length, 0, "rien n'atteint la base sans un jeton valable");
  /* le corps nomme Awa, le jeton est celui de Bob : c'est Bob qui essaie (et n'a pas ce code) */
  const r = await traiter(p.deps, "Bearer jeton-bob", { action: "code_de_secours", code: "7K3QD9WMXA", utilisateur: AWA, p_utilisateur: AWA });
  assert.equal(r.corps.erreur, "code de secours incorrect");
  assert.equal(p.appels[0].args.p_utilisateur, BOB, "l'utilisateur vient du jeton, jamais du corps");
  assert.deepEqual(p.facteurs[AWA], ["f-awa-1", "f-awa-2"], "les facteurs d'Awa sont intacts");
  ok("sans jeton valable, rien ; un identifiant glissé dans le corps est ignoré : on n'agit que sur soi");

  /* témoin : une version qui lit l'utilisateur dans le corps retirerait les facteurs d'Awa */
  const naive = async (corps: Record<string, unknown>) => {
    const u = String(corps.utilisateur);
    const v = (await p.deps.rpc("_consommer_code_de_secours", { p_utilisateur: u, p_code: corps.code })) as { ok: boolean };
    if (v.ok) for (const f of await p.deps.facteurs(u)) await p.deps.retirerFacteur(u, f.id);
  };
  await naive({ utilisateur: AWA, code: "7K3QD9WMXA" });
  assert.deepEqual(p.facteurs[AWA], [], "témoin : lire l'utilisateur dans le corps vide les facteurs d'un autre");
  ok("témoin : une fonction qui croit le corps retire la double authentification d'un autre");
}

/* ----------------------------------------------------- le code de secours */
{
  const p = plateforme();
  const faux = await traiter(p.deps, "Bearer jeton-awa", { action: "code_de_secours", code: "AAAAAAAAAA" });
  assert.deepEqual(faux, { statut: 200, corps: { erreur: "code de secours incorrect", essais_restants: 4 } }, "le refus de la base, tel quel, avec ses essais");
  assert.deepEqual(p.facteurs[AWA], ["f-awa-1", "f-awa-2"], "un mauvais code ne retire rien");
  for (const code of [undefined, 42, "", "x".repeat(41)]) {
    assert.equal((await traiter(p.deps, "Bearer jeton-awa", { action: "code_de_secours", code })).corps.erreur, "code de secours incorrect");
  }
  const bon = await traiter(p.deps, "Bearer jeton-awa", { action: "code_de_secours", code: "7K3QD9WMXA" });
  assert.deepEqual(bon, { statut: 200, corps: { ok: true, facteurs: 2 } });
  assert.deepEqual(p.facteurs[AWA], [], "TOUS les facteurs partent, l'enrôlement abandonné compris");
  assert.deepEqual(p.facteurs[BOB], ["f-bob"], "ceux de Bob restent");
  const fin = p.appels.at(-1)!;
  assert.deepEqual(fin, { nom: "_deux_facteurs_retires", args: { p_utilisateur: AWA, p_cause: "code_de_secours", p_reinitialisation: null, p_facteurs: 2 } });
  const rejoue = await traiter(p.deps, "Bearer jeton-awa", { action: "code_de_secours", code: "7K3QD9WMXA" });
  assert.equal(rejoue.corps.erreur, "code de secours incorrect", "un code ne sert qu'une fois");
  ok("un mauvais code ne retire rien et dit ses essais ; le bon retire tous les facteurs de la personne, une fois");
}

/* ------------------------------------------ Auth refuse au milieu : le code est rendu */
{
  const p = plateforme({ gotrueRefuse: true });
  const r = await traiter(p.deps, "Bearer jeton-awa", { action: "code_de_secours", code: "7K3QD9WMXA" });
  assert.equal(r.statut, 502);
  assert.equal(p.codes[AWA][0].utilise, false, "le code brûlé est rendu");
  assert.ok(!p.appels.some((a) => a.nom === "_deux_facteurs_retires"), "la base n'efface pas les codes d'un retrait qui n'a pas eu lieu");
  /* une seconde tentative, Auth revenu : le même code sert */
  const p2 = { ...p, deps: { ...p.deps, retirerFacteur: async (u: string, f: string) => { p.facteurs[u] = p.facteurs[u].filter((x) => x !== f); } } };
  assert.deepEqual((await traiter(p2.deps, "Bearer jeton-awa", { action: "code_de_secours", code: "7K3QD9WMXA" })).corps, { ok: true, facteurs: 1 });
  ok("Auth refuse au milieu : le code est rendu, rien n'est effacé, et le même code sert au second essai");
}

/* ------------------------------------------------- la réinitialisation par l'équipe */
{
  const reinit = (p: ReturnType<typeof plateforme>, jeton: string, id = RI) => traiter(p.deps, `Bearer ${jeton}`, { action: "reinitialisation", id });

  const p = plateforme();
  assert.equal((await reinit(p, "jeton-awa")).statut, 403, "un client n'exécute rien");
  assert.equal((await reinit(p, "jeton-autre-admin")).statut, 404, "un autre admin n'exécute pas l'autorisation d'un collègue");
  assert.equal((await reinit(p, "jeton-admin", "pas-un-uuid")).statut, 400);
  assert.equal((await reinit(p, "jeton-admin", "99999999-2222-3333-4444-555555555555")).statut, 404);
  assert.deepEqual(p.facteurs[BOB], ["f-bob"], "rien n'a bougé");
  const r = await reinit(p, "jeton-admin");
  assert.deepEqual(r, { statut: 200, corps: { ok: true, facteurs: 1 } });
  assert.deepEqual(p.facteurs[BOB], [], "les facteurs de la personne visée, et d'elle seule");
  assert.deepEqual(p.facteurs[AWA], ["f-awa-1", "f-awa-2"]);
  assert.deepEqual(p.appels.at(-1), { nom: "_deux_facteurs_retires", args: { p_utilisateur: BOB, p_cause: "administration", p_reinitialisation: RI, p_facteurs: 1 } });
  assert.equal((await reinit(p, "jeton-admin")).statut, 409, "une autorisation ne s'exécute qu'une fois");
  ok("la réinitialisation : par l'admin qui l'a posée, sur la personne visée seulement, une fois");

  const sansDroit = plateforme({ droitAdmin: false });
  assert.equal((await reinit(sansDroit, "jeton-admin")).statut, 403, "un admin qui a perdu le droit (désactivé, rétrogradé) n'exécute plus rien");
  const tard = plateforme({ ri: { demandee_le: new Date(T0 - VALIDITE_REINITIALISATION_MS - 1).toISOString() } });
  assert.equal((await reinit(tard, "jeton-admin")).statut, 410, "une autorisation de plus d'un quart d'heure est périmée");
  const futur = plateforme({ ri: { demandee_le: new Date(T0 + 60_000).toISOString() } });
  assert.equal((await reinit(futur, "jeton-admin")).statut, 410, "une date dans le futur n'est pas une autorisation fraîche");
  const echoue = plateforme({ gotrueRefuse: true, ri: {} });
  echoue.facteurs[BOB] = ["f-bob-1", "f-bob-2"];
  assert.equal((await reinit(echoue, "jeton-admin")).statut, 502);
  assert.ok(echoue.appels.some((a) => a.nom === "_reinitialisation_2fa_echouee"), "l'échec est écrit");
  assert.ok(!echoue.appels.some((a) => a.nom === "_deux_facteurs_retires"));
  ok("sans le droit, trop tard, ou Auth qui refuse : rien n'est fait, et l'échec est écrit");
}

/* ------------------------------------------------------------------ divers */
{
  const p = plateforme();
  assert.equal((await traiter(p.deps, "Bearer jeton-awa", { action: "tout_retirer" })).statut, 400);
  assert.equal((await traiter(p.deps, "Bearer jeton-awa", null)).statut, 400);
  assert.deepEqual(p.facteurs[AWA], ["f-awa-1", "f-awa-2"]);
  const cors = entetesCors("https://app.glisil.com", ["https://app.glisil.com"]);
  assert.equal(cors["access-control-allow-origin"], "https://app.glisil.com");
  assert.equal(entetesCors("https://piege.example", ["https://app.glisil.com"])["access-control-allow-origin"], undefined, "une autre origine n'est pas autorisée");
  assert.equal(entetesCors(null, ["https://app.glisil.com"])["access-control-allow-origin"], undefined);
  ok("une action inconnue ne fait rien ; seules les adresses de Glisil sont autorisées par le navigateur");
}

console.log(`✓ la double authentification se retire comme il faut (${n} vérifications)`);
