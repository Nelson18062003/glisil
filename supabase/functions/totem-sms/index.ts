// La porte par laquelle TOTEM dépose les SMS d'argent qu'il a lus.
//   POST /functions/v1/totem-sms   (une ligne, ou {"lignes": [...]}, ou [...])
// Signée par le boîtier (voir _shared/porte.ts) ; appelle totem_sms_recu avec
// la clé de service. Le contrat : docs/TOTEM-INTEGRATION.md.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { lireEntetes, reponseHttp, traiterSms, verifier } from "../_shared/porte.ts";

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
  if (req.method !== "POST") return reponseHttp({ statut: 405, corps: { erreur: "POST seulement" } });
  const corps = await req.text();
  const entetes = lireEntetes(req.headers);
  const refus = await verifier(entetes, corps, cleDuTerminal);
  if (refus) return reponseHttp(refus);
  let charge: unknown;
  try { charge = JSON.parse(corps); } catch { return reponseHttp({ statut: 400, corps: { erreur: "JSON illisible" } }); }
  return reponseHttp(await traiterSms(rpc, entetes.terminal!, charge));
});
