/* Le moteur, vu du veilleur : des RPC appelées avec la clé de service. */
export type Rpc = (nom: string, args: Record<string, unknown>) => Promise<any>;

/**
 * Les en-têtes d'un appel avec la clé de service. Une clé « héritée » est un
 * JWT : apikey ET Bearer. Une clé neuve de Supabase (sb_secret_…) n'est PAS un
 * JWT : en Bearer, l'API la refuse — elle ne va que dans apikey.
 * Éprouvé par supabase/functions/verifier-la-cle-de-service.ts.
 */
export function entetesDeService(cle: string): Record<string, string> {
  const e: Record<string, string> = { apikey: cle, "content-type": "application/json" };
  if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(cle)) e.authorization = `Bearer ${cle}`;
  return e;
}

export function moteur(url: string, cleService: string): Rpc {
  const base = url.replace(/\/$/, "");
  return async (nom, args) => {
    const r = await fetch(`${base}/rpc/${nom}`, {
      method: "POST",
      headers: entetesDeService(cleService),
      body: JSON.stringify(args),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.message ?? `moteur ${r.status}`);
    return j;
  };
}
