/* Le moteur, vu du veilleur : des RPC appelées avec la clé de service. */
export type Rpc = (nom: string, args: Record<string, unknown>) => Promise<any>;

export function moteur(url: string, cleService: string): Rpc {
  const base = url.replace(/\/$/, "");
  return async (nom, args) => {
    const r = await fetch(`${base}/rpc/${nom}`, {
      method: "POST",
      headers: { apikey: cleService, authorization: `Bearer ${cleService}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.message ?? `moteur ${r.status}`);
    return j;
  };
}
