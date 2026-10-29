// L'inscription et la sortie d'un client, comme l'application les fait, contre le VRAI GoTrue de la pile
// d'épreuve : e-mail et mot de passe (session aal1), l'application d'authentification enrôlée et vérifiée par
// GoTrue lui-même (aal2), les codes de secours, puis le compte ouvert. Rien n'est fabriqué ici : pas un jeton
// signé à la main, pas un facteur écrit en base.
//
// Partagé par attaquer-par-l-api.mjs et chaine/epreuve/eprouver-les-wallets.ts.
import { createHmac } from "node:crypto";

export const MOT_DE_PASSE = "Glisil-essai-2026";

/** RFC 6238, comme l'application d'authentification du client. */
export function totp(secret, t = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const cle = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const pas = Buffer.alloc(8);
  pas.writeBigUInt64BE(BigInt(Math.floor(t / 30_000)));
  const h = createHmac("sha1", cle).update(pas).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const entetes = (jeton) => ({ "content-type": "application/json", ...(jeton ? { apikey: jeton, authorization: `Bearer ${jeton}` } : {}) });

/** Le code de l'application, tapé à l'instant : GoTrue rend une session aal2 dont le TOTP est FRAIS
 *  (c'est ce que la vérification avant sortie exige, à moins de cinq minutes). */
async function verifierLeFacteur(AUTH, jeton, facteur, secret) {
  const c = await json(await fetch(`${AUTH}/factors/${facteur}/challenge`, { method: "POST", headers: entetes(jeton), body: "{}" }));
  const v = await json(await fetch(`${AUTH}/factors/${facteur}/verify`, { method: "POST", headers: entetes(jeton), body: JSON.stringify({ challenge_id: c.id, code: totp(secret) }) }));
  if (!v.access_token) throw new Error(`vérification TOTP : ${JSON.stringify(v)}`);
  return v.access_token;
}

export async function inscrireParEmail(AUTH, email) {
  const a = await json(await fetch(`${AUTH}/signup`, { method: "POST", headers: entetes(), body: JSON.stringify({ email, password: MOT_DE_PASSE }) }));
  if (!a.access_token) throw new Error(`inscription ${email} : ${JSON.stringify(a)}`);
  const faible = a.access_token;
  const f = await json(await fetch(`${AUTH}/factors`, { method: "POST", headers: entetes(faible), body: JSON.stringify({ factor_type: "totp", friendly_name: "essai" }) }));
  if (!f.id || !f.totp?.secret) throw new Error(`enrôlement TOTP ${email} : ${JSON.stringify(f)}`);
  const jeton = await verifierLeFacteur(AUTH, faible, f.id, f.totp.secret);
  return { jeton, faible, id: a.user.id, email, motDePasse: MOT_DE_PASSE, facteur: f.id, secret: f.totp.secret };
}

/** Un client complet : inscrit, codes de secours notés, compte ouvert avec ce numéro. */
export async function client(AUTH, REST, { email, telephone, prenom = "Client", nom = "Essai" }) {
  const s = await inscrireParEmail(AUTH, email);
  const appel = async (fn, args) => {
    const r = await fetch(`${REST}/rpc/${fn}`, { method: "POST", headers: entetes(s.jeton), body: JSON.stringify(args) });
    const j = await json(r);
    if (!r.ok) throw new Error(`${fn} ${r.status} ${JSON.stringify(j)}`);
    return j;
  };
  await appel("generer_codes_de_secours", {});
  await appel("confirmer_codes_de_secours", {});
  await appel("ouvrir_mon_compte", { p_prenom: prenom, p_nom: nom, p_naissance: "1990-05-14", p_telephone: telephone,
                                     p_ville: "Douala", p_pays: "CM", p_conditions: "2026-10-29" });
  /** Une sortie, comme l'écran la fait : la vérification préparée (le code part par e-mail), le TOTP retapé,
   *  le mot de passe et le code e-mail. `lireLeCode(id)` joue la boîte de réception. */
  const sortir = async (fn, operation, parametres, args, lireLeCode) => {
    const v = await appel("preparer_verification", { p_operation: operation, p_parametres: parametres });
    s.jeton = await verifierLeFacteur(AUTH, s.jeton, s.facteur, s.secret);
    const r = await appel(fn, { ...args, p_verification: v.id, p_mot_de_passe: s.motDePasse, p_code_email: lireLeCode(v.id) });
    if (r && r.ok === false) throw new Error(`${fn} : ${JSON.stringify(r)}`);
    return r;
  };
  return { ...s, get jeton() { return s.jeton; }, appel, sortir };
}
