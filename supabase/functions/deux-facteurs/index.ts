// Retirer la double authentification (téléphone perdu : un code de secours ;
// ou une réinitialisation autorisée par un super admin). Toute la logique est
// dans _shared/deux-facteurs.ts, éprouvée par verifier-deux-facteurs.ts.
//   POST /functions/v1/deux-facteurs   { action: "code_de_secours", code }
//                                       { action: "reinitialisation", id }
// Appelée depuis le navigateur (l'application, l'administration) : la passerelle
// vérifie le jeton (verify_jwt), et la fonction relit l'utilisateur auprès
// d'Auth. Secret facultatif : ORIGINES (les adresses autorisées, séparées par
// des virgules ; par défaut celles de l'application et de l'administration).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { entetesCors, traiter } from "../_shared/deux-facteurs.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const service = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const ORIGINES = (Deno.env.get("ORIGINES") || "https://app.glisil.com,https://admin.glisil.com").split(",").map((o) => o.trim()).filter(Boolean);

const rpc = async (nom: string, args: Record<string, unknown>) => {
  const { data, error } = await service.rpc(nom, args);
  if (error) throw new Error(error.message);
  return data;
};

Deno.serve(async (req) => {
  const cors = entetesCors(req.headers.get("origin"), ORIGINES);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const repondre = (statut: number, corps: unknown) =>
    new Response(JSON.stringify(corps), { status: statut, headers: { ...cors, "content-type": "application/json" } });
  if (req.method !== "POST") return repondre(405, { erreur: "POST seulement" });

  let corps: unknown;
  try { corps = await req.json(); } catch { return repondre(400, { erreur: "JSON illisible" }); }

  const r = await traiter({
    utilisateurDuJeton: async (jwt) => {
      const { data, error } = await service.auth.getUser(jwt);
      return error || !data.user ? null : { id: data.user.id };
    },
    rpc,
    rpcEnTantQue: async (jwt, nom, args) => {
      const sb = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } });
      const { data, error } = await sb.rpc(nom, args);
      if (error) throw new Error(error.message);
      return data;
    },
    reinitialisation: async (id) => {
      const { data, error } = await service.from("reinitialisations_2fa").select("id, utilisateur_id, admin_id, demandee_le, faite_le").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    facteurs: async (utilisateur) => {
      const { data, error } = await service.auth.admin.mfa.listFactors({ userId: utilisateur });
      if (error) throw new Error(error.message);
      return (data?.factors ?? []).map((f) => ({ id: f.id, type: f.factor_type }));
    },
    retirerFacteur: async (utilisateur, facteur) => {
      const { error } = await service.auth.admin.mfa.deleteFactor({ userId: utilisateur, id: facteur });
      if (error) throw new Error(error.message);
    },
  }, req.headers.get("authorization"), corps).catch((e) => {
    console.log(`deux-facteurs : ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
    return { statut: 500, corps: { erreur: "erreur du serveur" } };
  });
  return repondre(r.statut, r.corps);
});
