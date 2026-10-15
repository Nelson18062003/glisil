// Le veilleur de chaîne, dans Supabase : un tour par appel, un réseau par appel.
//   POST /functions/v1/veilleur?reseau=bep20|trc20     en-tête x-veilleur-jeton
// pg_cron le réveille chaque minute (migration 0006). La logique est celle de
// chaine/src/veilleur.ts, la même que le service Node et que l'épreuve.
// Secrets de la fonction : VEILLEUR_JETON, XAFE_GRAINE, BEP20_*, TRC20_* (chaine/README.md).
import { veilleursDepuis } from "../../../chaine/src/service.ts";
import type { Reseau } from "../../../chaine/src/cles.ts";

const env = Deno.env.toObject();
// dans Supabase : l'API du projet et la clé de service, fournies d'office ; ailleurs (l'épreuve) : MOTEUR_URL, MOTEUR_CLE
const moteur = env.MOTEUR_URL ?? `${env.SUPABASE_URL}/rest/v1`;
const cle = env.MOTEUR_CLE ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const rpc = async (nom: string, args: Record<string, unknown>) => {
  const r = await fetch(`${moteur}/rpc/${nom}`, {
    method: "POST",
    headers: { apikey: cle, authorization: `Bearer ${cle}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.message ?? `moteur ${r.status}`);
  return j;
};

/** comparaison en temps constant : un jeton ne se devine pas caractère par caractère */
function memes(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function unTour(reseau: Reseau) {
  // un tour à la fois : si le précédent tourne encore, celui-ci s'efface
  if (!(await rpc("chaine_prendre_tour", { p_reseau: reseau, p_secondes: 300 }))) return { reseau, saute: "un tour est déjà en cours" };
  try {
    const [v] = await veilleursDepuis(env, [reseau], (l) => console.log(`[${reseau}] ${l}`));
    return { reseau, ...(await v.tour(rpc)) };
  } finally {
    await rpc("chaine_rendre_tour", { p_reseau: reseau }).catch(() => null);
  }
}

Deno.serve(async (req) => {
  const jeton = env.VEILLEUR_JETON ?? "";
  if (jeton.length < 32 || !memes(req.headers.get("x-veilleur-jeton") ?? "", jeton)) {
    return new Response(JSON.stringify({ erreur: "jeton refusé" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  const reseau = new URL(req.url).searchParams.get("reseau");
  if (reseau !== "bep20" && reseau !== "trc20") return new Response(JSON.stringify({ erreur: "reseau=bep20 ou trc20" }), { status: 400 });
  const tour = unTour(reseau).then(
    (b) => { console.log(JSON.stringify(b)); return b; },
    (e) => { console.error(`✗ ${reseau} : ${(e as Error).message}`); return { reseau, erreur: (e as Error).message }; },
  );
  // ?attendre=1 : la réponse porte le bilan du tour (pour vérifier à la main) ; sinon on rend la main tout de suite
  if (new URL(req.url).searchParams.get("attendre") === "1") return new Response(JSON.stringify(await tour), { headers: { "content-type": "application/json" } });
  // @ts-ignore EdgeRuntime est fourni par Supabase : le tour continue après la réponse
  EdgeRuntime.waitUntil(tour);
  return new Response(JSON.stringify({ reseau, lance: true }), { status: 202, headers: { "content-type": "application/json" } });
});
