/*
 * « Continuer avec Google » : où il marche, et où il vaut mieux le taire.
 *
 *   le navigateur                   une redirection ordinaire, retour sur /bienvenue/retour
 *   la coque Android, pont v2+      la coque ouvre Google dans un onglet du système
 *                                   (Google refuse une WebView : disallowed_useragent)
 *                                   et rend le retour par glisil://auth-retour
 *   la coque d'avant (pont v1)      caché : la session ne reviendrait jamais
 *   un navigateur d'application     caché, avec un conseil : WhatsApp, Facebook,
 *   (WhatsApp, Facebook, Instagram)  Instagram ouvrent les liens dans une WebView
 *   la démonstration                caché : pas de Google sans projet
 *
 * DEUX CHEMINS VERS GOOGLE (décision du propriétaire, 30/10) :
 *
 *   direct      l'application va elle-même chez Google, avec SON adresse de retour
 *               (app.glisil.com/bienvenue/retour) : l'écran de Google dit « glisil.com ».
 *               Google rend un jeton d'identité (id_token) que Supabase vérifie
 *               (signInWithIdToken) : sa signature, son destinataire (notre Client ID),
 *               et le nonce — tiré ici, haché pour Google, gardé en clair dans l'onglet.
 *               Il faut VITE_GOOGLE_CLIENT_ID (public : il voyage dans chaque adresse)
 *               et, dans la coque, le pont v3 qui sait ouvrir cette adresse.
 *   par Supabase  l'ancien chemin, gardé pour ce qui n'a pas encore le direct (sans
 *               Client ID, coque v2) : Google y montre « …supabase.co ».
 *
 * L'« état » (state) relie le retour à SON départ : un retour qu'on n'a pas demandé
 * (un lien piégé qui porterait le jeton d'un autre) est refusé. Il porte aussi la
 * voie : « c. » = la coque. Dans l'onglet du système, la page de retour n'a ni le
 * nonce ni la session : elle rend simplement l'adresse à l'application
 * (glisil://auth-retour#…), qui finit la connexion là où le nonce attend.
 */

export type Coque = { version?: number; google?: boolean } | undefined;

export type VoieGoogle =
  | { voie: "web"; direct: boolean }
  | { voie: "coque"; direct: boolean }
  | { voie: "aucune"; raison: "demo" | "coque_ancienne" | "navigateur_integre" };

const NAVIGATEUR_INTEGRE = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp/i;

/** `direct` : un Client ID est configuré. La coque n'y va que si son pont sait ouvrir l'adresse de Google (v3). */
export function voieGoogle(p: { demo: boolean; coque: Coque; agent: string; clientId?: string }): VoieGoogle {
  if (p.demo) return { voie: "aucune", raison: "demo" };
  const direct = Boolean(p.clientId);
  if (p.coque) {
    const v = p.coque.version ?? 1;
    return v >= 2 && p.coque.google ? { voie: "coque", direct: direct && v >= 3 } : { voie: "aucune", raison: "coque_ancienne" };
  }
  if (NAVIGATEUR_INTEGRE.test(p.agent)) return { voie: "aucune", raison: "navigateur_integre" };
  return { voie: "web", direct };
}

/** Le pont posé par la coque (coque/src/pont.ts), lu au moment où l'on en a besoin. */
export function coqueActuelle(): Coque {
  return typeof window === "undefined" ? undefined : (window as unknown as { __xafeCoque?: Coque }).__xafeCoque;
}

/** Ce qu'un retour porte : le code (par Supabase), le jeton d'identité et l'état (direct), ou la raison d'un refus. */
export function lireRetourOAuth(url: string): { code: string | null; jeton: string | null; etat: string | null; erreur: string | null } {
  try {
    const u = new URL(url);
    const hash = new URLSearchParams(u.hash.replace(/^#/, ""));
    const lire = (k: string) => u.searchParams.get(k) ?? hash.get(k);
    return { code: lire("code"), jeton: lire("id_token"), etat: lire("state"), erreur: lire("error_description") ?? lire("error") };
  } catch {
    return { code: null, jeton: null, etat: null, erreur: null };
  }
}

/* ------------------------------------------------------------ le chemin direct */

/** Le chemin de retour : une adresse de l'application, déclarée chez Google (Clients → Authorized redirect URIs). */
export const CHEMIN_DE_RETOUR = "/bienvenue/retour";
/** L'adresse que la coque guette (coque/src/pont.ts, RETOUR_GOOGLE). */
export const RETOUR_DE_LA_COQUE = "glisil://auth-retour";
const MARQUE_COQUE = "c.";
const MARQUE_WEB = "w.";

/** L'adresse de Google, sans passer par Supabase. `nonceHache` : le SHA-256 (hex) du nonce, comme Supabase l'attend. */
export function adresseGoogleDirecte(p: { clientId: string; origine: string; nonceHache: string; etat: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: `${p.origine}${CHEMIN_DE_RETOUR}`,
    response_type: "id_token",
    scope: "openid email profile",
    nonce: p.nonceHache,
    state: p.etat,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

/** Un état neuf, qui dit d'où l'on part. */
export const nouvelEtat = (coque: boolean, hasard: string) => `${coque ? MARQUE_COQUE : MARQUE_WEB}${hasard}`;

/**
 * Dans l'onglet du système, la page de retour rend la main à la coque : la même réponse de Google
 * (jeton, état ou refus), sous l'adresse que la coque guette. `null` : ce retour n'est pas pour la coque.
 */
export function retourVersLaCoque(url: string): string | null {
  const { etat } = lireRetourOAuth(url);
  if (!etat?.startsWith(MARQUE_COQUE)) return null;
  const u = new URL(url);
  const reponse = u.hash.replace(/^#/, "") || u.search.replace(/^\?/, "");
  return `${RETOUR_DE_LA_COQUE}#${reponse}`;
}

/** Du hasard en base64url (crypto du navigateur). */
export function hasard(octets = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(octets));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 en hexadécimal : le nonce part haché chez Google, Supabase compare au nonce en clair. */
export async function empreinteHex(texte: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
  return Array.from(new Uint8Array(d), (o) => o.toString(16).padStart(2, "0")).join("");
}

/** Ce que l'onglet garde pendant l'aller-retour chez Google. Dix minutes : au-delà, on recommence. */
export type AttenteGoogle = { etat: string; nonce: string; quand: number };
export const ATTENTE_MAX_MS = 10 * 60 * 1000;

/** Le retour correspond-il au départ ? Rend le nonce, ou la raison du refus (jamais le jeton d'un autre). */
export function verifierLeRetour(attente: AttenteGoogle | null, retour: { etat: string | null; jeton: string | null; erreur: string | null }, maintenant: number):
  { nonce: string; jeton: string } | { refus: string } {
  if (retour.erreur) return { refus: retour.erreur };
  if (!attente) return { refus: "aucune connexion Google en cours" }; // langue-ok
  if (!retour.etat || retour.etat !== attente.etat) return { refus: "retour inattendu" }; // langue-ok
  if (maintenant - attente.quand > ATTENTE_MAX_MS) return { refus: "trop tard" }; // langue-ok
  if (!retour.jeton) return { refus: "Google n'a pas rendu de jeton" }; // langue-ok
  return { nonce: attente.nonce, jeton: retour.jeton };
}
