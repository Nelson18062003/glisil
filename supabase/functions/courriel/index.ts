// La fonction qui vide la boîte d'envoi de la base (courriels_a_envoyer, 0036)
// et fait partir chaque e-mail par Resend.
//   POST /functions/v1/courriel   en-tête x-courriel-jeton
// Réveillée par la base elle-même (pg_net, à chaque e-mail mis en file, puis
// chaque minute par pg_cron) : personne d'autre n'a le jeton. Toute la logique
// est dans _shared/courriel.ts, éprouvée par verifier-les-courriels.ts.
//
// Secrets de la fonction : RESEND_API_KEY, COURRIEL_JETON (le même que le
// secret « courriel_jeton » du Vault), COURRIEL_EXPEDITEUR (facultatif).
// Voir docs/CONNEXION.md.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { envoyerParResend, jetonValide, traiterLaBoite } from "../_shared/courriel.ts";

const json = (statut: number, corps: unknown) =>
  new Response(JSON.stringify(corps), { status: statut, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { erreur: "POST seulement" });
  if (!jetonValide(req.headers.get("x-courriel-jeton"), Deno.env.get("COURRIEL_JETON"))) return json(401, { erreur: "jeton refusé" });

  const url = Deno.env.get("SUPABASE_URL"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), resend = Deno.env.get("RESEND_API_KEY");
  if (!url || !service || !resend) return json(500, { erreur: "configuration incomplète : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY et RESEND_API_KEY sont nécessaires" });

  const sb = createClient(url, service, { auth: { persistSession: false } });
  const rpc = async (nom: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(nom, args);
    if (error) throw new Error(error.message);
    return data;
  };
  const bilan = await traiterLaBoite({
    rpc,
    envoyer: envoyerParResend(resend, Deno.env.get("COURRIEL_EXPEDITEUR") || "Glisil <code@glisil.com>"),
    journal: (m) => console.log(m),
  });
  return json(200, bilan);
});
