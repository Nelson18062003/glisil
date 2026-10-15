// Le guichet où TOTEM relève ce qu'il doit faire : les transferts à composer,
// les SMS à envoyer et les remboursements à renvoyer au payeur.
//   GET   /functions/v1/totem-commandes?type=transferts|sms|remboursements
//   PATCH /functions/v1/totem-commandes/:id   {"type", "etat", "resultat", "reference_operateur", "tentative"}
// Signée par le boîtier (voir _shared/porte.ts). Le contrat : docs/TOTEM-INTEGRATION.md.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { lireEntetes, reponseHttp, traiterCommandes, verifier } from "../_shared/porte.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const cleDuTerminal = async (terminal: string) => {
  const { data } = await sb.from("terminaux").select("cle").eq("id", terminal).maybeSingle();
  return (data?.cle as string | undefined) ?? null;
};

const rpc = async (nom: string, args: Record<string, unknown>) => {
  const { data, error } = await sb.rpc(nom, args);
  if (error) throw new Error(error.message);
  return data;
};

Deno.serve(async (req) => {
  const corps = await req.text();
  const entetes = lireEntetes(req.headers);
  const refus = await verifier(entetes, corps, cleDuTerminal);
  if (refus) return reponseHttp(refus);
  let charge: unknown = null;
  if (corps) {
    try { charge = JSON.parse(corps); } catch { return reponseHttp({ statut: 400, corps: { erreur: "JSON illisible" } }); }
  }
  return reponseHttp(await traiterCommandes(rpc, entetes.terminal!, req.method, new URL(req.url), charge));
});
