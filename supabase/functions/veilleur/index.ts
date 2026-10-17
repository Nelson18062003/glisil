// Le veilleur de chaîne, dans Supabase : un tour par appel, un réseau par appel.
//   POST /functions/v1/veilleur?reseau=bep20|trc20|base…     en-tête x-veilleur-jeton
// pg_cron le réveille chaque minute (migration 0006). La logique est celle de
// chaine/src/veilleur.ts, la même que le service Node et que l'épreuve.
// Les réglages viennent de la base (chaine_configuration, migration 0007) ;
// un secret de la fonction du même nom passe avant — en production, XAFE_GRAINE
// est un secret que le propriétaire saisit lui-même (chaine/README.md).
import { envDepuisConfiguration, veilleursDepuis, type ConfigurationMoteur } from "../../../chaine/src/service.ts";
import { estReseau, RESEAUX, variableDuNoeud, type Reseau } from "../../../chaine/src/cles.ts";

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

async function unTour(reseau: Reseau, reglages: Record<string, string | undefined>) {
  // un réseau pas encore configuré : rien à faire, et rien à crier chaque minute
  if (!reglages[variableDuNoeud(reseau)]) return { reseau, saute: "réseau pas encore configuré" };
  // un tour à la fois : si le précédent tourne encore, celui-ci s'efface
  if (!(await rpc("chaine_prendre_tour", { p_reseau: reseau, p_secondes: 300 }))) return { reseau, saute: "un tour est déjà en cours" };
  try {
    const [v] = await veilleursDepuis(reglages, [reseau], (l) => console.log(`[${reseau}] ${l}`));
    return { reseau, ...(await v.tour(rpc)) };
  } finally {
    await rpc("chaine_rendre_tour", { p_reseau: reseau }).catch(() => null);
  }
}

Deno.serve(async (req) => {
  let reglages: Record<string, string | undefined>;
  try { reglages = envDepuisConfiguration(await rpc("chaine_configuration", {}) as ConfigurationMoteur, env); }
  catch (e) { return new Response(JSON.stringify({ erreur: `configuration illisible : ${(e as Error).message}` }), { status: 503 }); }
  const jeton = reglages.VEILLEUR_JETON ?? "";
  if (jeton.length < 32 || !memes(req.headers.get("x-veilleur-jeton") ?? "", jeton)) {
    return new Response(JSON.stringify({ erreur: "jeton refusé" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  const reseau = new URL(req.url).searchParams.get("reseau");
  if (!estReseau(reseau)) return new Response(JSON.stringify({ erreur: `reseau=${Object.keys(RESEAUX).join("|")}` }), { status: 400 });
  const tour = unTour(reseau, reglages).then(
    (b) => { console.log(JSON.stringify(b)); return b; },
    (e) => { console.error(`✗ ${reseau} : ${(e as Error).message}`); return { reseau, erreur: (e as Error).message }; },
  );
  // ?attendre=1 : la réponse porte le bilan du tour (pour vérifier à la main) ; sinon on rend la main tout de suite
  if (new URL(req.url).searchParams.get("attendre") === "1") return new Response(JSON.stringify(await tour), { headers: { "content-type": "application/json" } });
  // @ts-ignore EdgeRuntime est fourni par Supabase : le tour continue après la réponse
  EdgeRuntime.waitUntil(tour);
  return new Response(JSON.stringify({ reseau, lance: true }), { status: 202, headers: { "content-type": "application/json" } });
});
