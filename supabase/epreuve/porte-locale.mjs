// La porte de TOTEM, servie en local devant la pile d'épreuve : le VRAI
// porte.ts, branché exactement comme dans supabase/functions/*/index.ts
// (clé du terminal lue avec la clé de service, chaque ligne au moteur par
// RPC). Seul « Deno.serve » est remplacé par le serveur HTTP de Node — Edge
// Runtime ne tourne pas sans réseau sortant pour ses imports.
//   node --experimental-strip-types supabase/epreuve/porte-locale.mjs
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { lireEntetes, traiterCommandes, traiterSms, verifier } from "../functions/_shared/porte.ts";

const REST = `http://127.0.0.1:${process.env.PORT_REST ?? 53000}`;
const SECRET = process.env.SECRET ?? "super-secret-jwt-token-with-at-least-32-characters-long";
const PORT = Number(process.env.PORT_PORTE ?? 54321);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const tete = b64({ alg: "HS256", typ: "JWT" });
const corpsJwt = b64({ role: "service_role", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 });
const SERVICE = `${tete}.${corpsJwt}.${createHmac("sha256", SECRET).update(`${tete}.${corpsJwt}`).digest("base64url")}`;
const entetes = { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" };

const cleDuTerminal = async (terminal) => {
  const r = await fetch(`${REST}/terminaux?id=eq.${encodeURIComponent(terminal)}&select=cle`, { headers: entetes });
  const j = await r.json();
  return j?.[0]?.cle ?? null;
};
const rpc = async (nom, args) => {
  const r = await fetch(`${REST}/rpc/${nom}`, { method: "POST", headers: entetes, body: JSON.stringify(args) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.message ?? `${r.status}`);
  return j;
};

createServer(async (req, res) => {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  const corps = Buffer.concat(morceaux).toString("utf8");
  const url = new URL(req.url, `http://${req.headers.host}`);
  const h = lireEntetes({ get: (n) => req.headers[n] ?? null });
  let rep = await verifier(h, req.method, url, corps, cleDuTerminal);
  if (!rep) {
    let charge = null;
    try { charge = corps ? JSON.parse(corps) : null; } catch { rep = { statut: 400, corps: { erreur: "JSON illisible" } }; }
    if (!rep) {
      if (url.pathname.startsWith("/functions/v1/totem-sms")) rep = await traiterSms(rpc, h.terminal, charge);
      else if (url.pathname.startsWith("/functions/v1/totem-commandes")) rep = await traiterCommandes(rpc, h.terminal, req.method, url, charge);
      else rep = { statut: 404, corps: { erreur: "inconnu" } };
    }
  }
  res.writeHead(rep.statut, { "content-type": "application/json; charset=utf-8", date: new Date().toUTCString() });
  res.end(JSON.stringify(rep.corps));
}).listen(PORT, "127.0.0.1", () => console.log(`· porte locale (porte.ts réel) sur ${PORT}`));
