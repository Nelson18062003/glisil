// LES E-MAILS DE GLISIL (hors Auth) : la boîte d'envoi de la base, vidée par
// la fonction « courriel », envoyée par Resend.
//
// Supabase Auth envoie lui-même ses e-mails (code d'inscription, mot de passe
// oublié) par le SMTP de Resend, avec les gabarits de supabase/templates. Tout
// le reste — le code avant une sortie d'argent, le verrou après trop d'essais —
// est écrit par la base dans courriels_a_envoyer (0036), et c'est ici qu'il
// devient un e-mail.
//
// Une langue par e-mail : celle du compte (0037), l'anglais par défaut. Chaque
// valeur venue de la base est échappée : un nom de bénéficiaire, une adresse
// crypto, c'est le client qui les a tapés.
//
// Rien ici ne parle à Supabase ni à Resend directement : la fonction lui passe
// `rpc` et `envoyer`. Le harnais (verifier-les-courriels.ts) passe des faux.

export type Langue = "fr" | "en";
export type Rendu = { sujet: string; html: string; texte: string };
type Donnees = Record<string, unknown>;

/* ------------------------------------------------------------ l'écriture */

export function echapper(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const langueDe = (l: unknown): Langue => (l === "fr" ? "fr" : "en");
const t = (l: Langue, fr: string, en: string) => (l === "fr" ? fr : en);

/** 1250000 → « 1 250 000 » (fr, espaces insécables) ou « 1,250,000 » (en) ; 12.5 → « 12,5 » / « 12.5 ». */
export function montant(v: unknown, l: Langue): string {
  const brut = String(v ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(brut)) throw new Error(`montant illisible : ${brut}`);
  const [entier, decimales] = brut.split(".");
  const signe = entier.startsWith("-") ? "-" : "";
  const chiffres = entier.replace("-", "");
  const groupes = chiffres.replace(/\B(?=(\d{3})+(?!\d))/g, l === "fr" ? " " : ",");
  return signe + groupes + (decimales ? (l === "fr" ? "," : ".") + decimales : "");
}

/** Un numéro camerounais à neuf chiffres se lit par tranches, comme dans l'application : 6 77 12 34 56. */
export function numero(v: unknown): string {
  const n = String(v ?? "").replace(/\D/g, "");
  return n.length === 9 ? `${n[0]} ${n.slice(1, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}` : String(v ?? "");
}

/** L'heure de Douala (UTC+1, sans heure d'été), là où vivent les clients. */
export function heureDeDouala(iso: unknown, l: Langue, avecDate = false): string {
  const ms = Date.parse(String(iso ?? ""));
  if (Number.isNaN(ms)) throw new Error("date illisible");
  const d = new Date(ms + 3600_000);
  const hh = String(d.getUTCHours()).padStart(2, "0"), mm = String(d.getUTCMinutes()).padStart(2, "0");
  const heure = `${hh}:${mm}`;
  if (!avecDate) return heure;
  const MOIS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return l === "fr"
    ? `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()} à ${heure}`
    : `${MOIS_EN[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}, ${heure}`;
}

/* ------------------------------------------------------------- l'habit */

type Ligne = [string, string];

/** Le même habit que supabase/templates/code-par-email.html : en-tête vert, point ambre, carte blanche. */
function habit(l: Langue, titre: string, corps: string): string {
  return `<!doctype html>
<html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${echapper(titre)}</title></head>
<body style="margin:0;padding:0;background:#F4F7F4;font-family:Arial,Helvetica,sans-serif;color:#191C1A;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7F4;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:24px;">
<tr><td style="background:#0B6B3A;border-radius:24px 24px 0 0;padding:28px 32px;"><span style="font-size:28px;font-weight:bold;letter-spacing:-1px;color:#FFFFFF;">glisil</span><span style="display:inline-block;width:12px;height:12px;border-radius:6px;background:#E8A33D;margin-left:6px;"></span></td></tr>
<tr><td style="padding:32px 32px 8px 32px;">
<p style="margin:0 0 16px 0;font-size:20px;font-weight:bold;">${echapper(titre)}</p>
${corps}
</td></tr>
<tr><td style="padding:0 32px 28px 32px;border-top:1px solid #E3E7E3;"><p style="margin:20px 0 0 0;font-size:12px;line-height:18px;color:#5B615E;">${t(l, "Glisil · le XAFe, et le marché où il s'échange.", "Glisil · XAFe, and the market where it trades.")}</p></td></tr>
</table></td></tr></table></body></html>`;
}

const paragraphe = (texte: string, petit = false) =>
  `<p style="margin:0 0 ${petit ? 16 : 20}px 0;font-size:${petit ? 14 : 15}px;line-height:${petit ? 21 : 22}px;color:#5B615E;">${texte}</p>`;

const tableau = (lignes: Ligne[]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;border:1px solid #E3E7E3;border-radius:16px;">${lignes
    .map(([k, v]) => `<tr><td style="padding:10px 14px;font-size:14px;color:#5B615E;vertical-align:top;">${echapper(k)}</td><td style="padding:10px 14px;font-size:14px;font-weight:bold;text-align:right;word-break:break-all;">${echapper(v)}</td></tr>`)
    .join("")}</table>`;

const grandCode = (code: string) =>
  `<p style="margin:0 0 20px 0;padding:18px 0;background:#CDEFD9;border-radius:16px;text-align:center;font-size:36px;font-weight:bold;letter-spacing:10px;color:#06331B;font-family:'Courier New',Courier,monospace;">${echapper(code)}</p>`;

const texteDeLignes = (lignes: Ligne[]) => lignes.map(([k, v]) => `${k} : ${v}`).join("\n");

/* -------------------------------------------------------- les gabarits */

/** Ce que l'opération fait, en mots, et ses lignes : le client doit lire le montant ET la destination. */
function operation(d: Donnees, l: Langue): { quoi: string; lignes: Ligne[] } {
  switch (d.operation) {
    case "sortie_momo": {
      const lignes: Ligne[] = [
        [t(l, "Montant", "Amount"), `${montant(d.montant, l)} XAFe`],
        [t(l, "Frais", "Fees"), `${montant(d.frais ?? 0, l)} XAFe`],
        [t(l, "Vous recevez", "You receive"), `${montant(d.recu ?? d.montant, l)} XAF`],
        [t(l, "Vers", "To"), `${String(d.operateur_nom ?? d.operateur ?? "")} · ${numero(d.numero)}`],
      ];
      if (d.nom) lignes.push([t(l, "Au nom de", "Account name"), String(d.nom)]);
      return { quoi: t(l, `un retrait de ${montant(d.montant, l)} XAFe vers Mobile Money`, `a withdrawal of ${montant(d.montant, l)} XAFe to Mobile Money`), lignes };
    }
    case "retrait_crypto": {
      const actif = String(d.actif ?? "");
      const reseau = [d.reseau_nom ?? d.reseau, d.norme ? `(${d.norme})` : ""].filter(Boolean).join(" ");
      return {
        quoi: t(l, `un retrait de ${montant(d.montant, l)} ${actif} sur la blockchain`, `a withdrawal of ${montant(d.montant, l)} ${actif} on the blockchain`),
        lignes: [
          [t(l, "Montant", "Amount"), `${montant(d.montant, l)} ${actif}`],
          [t(l, "Frais", "Fees"), `${montant(d.frais ?? 0, l)} ${actif}`],
          [t(l, "Réseau", "Network"), reseau],
          [t(l, "Adresse", "Address"), String(d.adresse ?? "")],
        ],
      };
    }
    case "fermer_compte":
      return { quoi: t(l, "la fermeture de votre compte Glisil", "closing your Glisil account"), lignes: [] };
    case "retirer_numero":
      return {
        quoi: t(l, "le retrait d'un numéro Mobile Money de votre compte", "removing a Mobile Money number from your account"),
        lignes: [[t(l, "Numéro", "Number"), `${String(d.operateur_nom ?? d.operateur ?? "")} · ${numero(d.numero)}`]],
      };
    default:
      throw new Error(`opération inconnue : ${String(d.operation)}`);
  }
}

function verification(d: Donnees, l: Langue): Rendu {
  const code = String(d.code ?? "");
  if (!/^\d{6}$/.test(code)) throw new Error("code absent ou illisible");
  const { quoi, lignes } = operation(d, l);
  const expire = heureDeDouala(d.expire_le, l);
  const titre = t(l, "Confirmez votre opération", "Confirm your transaction");
  /* le code n'est jamais dans l'objet : l'objet s'affiche sur l'écran verrouillé du téléphone */
  const sujet = t(l, `Glisil · confirmez ${quoi}`, `Glisil · confirm ${quoi}`);
  const introduction = t(l, `Vous avez demandé ${quoi}. Pour confirmer, recopiez ce code dans Glisil :`, `You asked for ${quoi}. To confirm, enter this code in Glisil:`);
  const validite = t(l, `Valable jusqu'à ${expire} (heure de Douala), une seule fois, et seulement pour cette opération.`, `Valid until ${expire} (Douala time), once, and only for this transaction.`);
  const alerte = t(l,
    "Ce n'est pas vous ? Ne donnez ce code à personne et changez votre mot de passe tout de suite. L'équipe Glisil ne vous demandera <b>jamais</b> ce code, ni par téléphone, ni par WhatsApp.",
    "Not you? Do not share this code and change your password right away. The Glisil team will <b>never</b> ask you for this code, by phone or on WhatsApp.");
  const html = habit(l, titre,
    paragraphe(echapper(introduction)) + grandCode(code) + (lignes.length ? tableau(lignes) : "") + paragraphe(echapper(validite), true) + paragraphe(alerte, true));
  const texte = [titre, "", introduction, "", code, "", texteDeLignes(lignes), "", validite, "",
    alerte.replace(/<\/?b>/g, "")].filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n");
  return { sujet, html, texte };
}

function verificationVerrouillee(d: Donnees, l: Langue): Rendu {
  const jusqua = heureDeDouala(d.verrou_jusqua, l, true);
  const titre = t(l, "Vos retraits sont bloqués pour une heure", "Your withdrawals are blocked for one hour");
  const corps = t(l,
    `Il y a eu trop d'essais incorrects (mot de passe ou code) avant une sortie d'argent. Pour vous protéger, les retraits sont bloqués jusqu'au ${jusqua} (heure de Douala). Votre argent reste sur votre compte.`,
    `There were too many incorrect attempts (password or code) before a withdrawal. To protect you, withdrawals are blocked until ${jusqua} (Douala time). Your money stays in your account.`);
  const conseil = t(l,
    "Ce n'est pas vous ? Changez votre mot de passe dans Glisil (Compte → Sécurité) et écrivez au support.",
    "Not you? Change your password in Glisil (Account → Security) and contact support.");
  return {
    sujet: t(l, "Glisil · vos retraits sont bloqués pour une heure", "Glisil · your withdrawals are blocked for one hour"),
    html: habit(l, titre, paragraphe(echapper(corps)) + paragraphe(echapper(conseil), true)),
    texte: [titre, "", corps, "", conseil].join("\n"),
  };
}

/** La double authentification retirée (0035) : par un code de secours, ou par l'équipe après vérification d'identité. */
function deuxFacteursRetires(d: Donnees, l: Langue): Rendu {
  const quand = heureDeDouala(d.quand, l, true);
  const parLEquipe = d.cause === "administration";
  const titre = t(l, "Votre application d'authentification a été retirée", "Your authenticator app was removed");
  const corps = parLEquipe
    ? t(l, `À votre demande, l'équipe Glisil a retiré l'application d'authentification de votre compte le ${quand} (heure de Douala), après avoir vérifié votre identité.`,
        `At your request, the Glisil team removed the authenticator app from your account on ${quand} (Douala time), after verifying your identity.`)
    : t(l, `Un code de secours a servi à retirer l'application d'authentification de votre compte le ${quand} (heure de Douala).`,
        `A recovery code was used to remove the authenticator app from your account on ${quand} (Douala time).`);
  const suite = t(l,
    "À la prochaine connexion, Glisil vous demandera d'ajouter une nouvelle application, puis vous donnera dix nouveaux codes de secours. Les anciens ne valent plus rien.",
    "At your next sign-in, Glisil will ask you to add a new authenticator app, then give you ten new recovery codes. The old ones no longer work.");
  const alerte = t(l,
    "Ce n'est pas vous ? Écrivez au support tout de suite et changez votre mot de passe : quelqu'un a peut-être accès à votre compte.",
    "Not you? Contact support right away and change your password: someone may have access to your account.");
  return {
    sujet: t(l, "Glisil · votre application d'authentification a été retirée", "Glisil · your authenticator app was removed"),
    html: habit(l, titre, paragraphe(echapper(corps)) + paragraphe(echapper(suite)) + paragraphe(echapper(alerte), true)),
    texte: [titre, "", corps, "", suite, "", alerte].join("\n"),
  };
}

/* Chaque gabarit que la base met en file (les migrations) a son rendu ici : verifier-les-courriels.ts le vérifie. */
const GABARITS: Record<string, (d: Donnees, l: Langue) => Rendu> = {
  verification,
  verification_verrouillee: verificationVerrouillee,
  deux_facteurs_retires: deuxFacteursRetires,
};

export const GABARITS_CONNUS = Object.keys(GABARITS);

/** Le rendu d'une ligne de la boîte. Un gabarit inconnu LÈVE : jamais d'e-mail vide. */
export function rendre(gabarit: string, donnees: Donnees, langue: unknown): Rendu {
  const f = Object.prototype.hasOwnProperty.call(GABARITS, gabarit) ? GABARITS[gabarit] : undefined;
  if (!f) throw new Error(`gabarit inconnu : ${gabarit}`);
  return f(donnees ?? {}, langueDe(langue));
}

/* ------------------------------------------------------------- l'envoi */

export type Message = { a: string; sujet: string; html: string; texte: string; idempotence: string };
/** ok ; sinon `reessayer` dit si l'échec passera peut-être plus tard (réseau, 429, 5xx) ou jamais (4xx). */
export type ResultatEnvoi = { ok: true; id: string | null } | { ok: false; reessayer: boolean; erreur: string };
export type Envoyer = (m: Message) => Promise<ResultatEnvoi>;

/** Resend : une clé d'idempotence par ligne de la boîte — un même e-mail repris ne part jamais deux fois. */
export function envoyerParResend(cle: string, expediteur: string, fetchFn: typeof fetch = fetch): Envoyer {
  return async (m) => {
    let r: Response;
    try {
      r = await fetchFn("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${cle}`, "content-type": "application/json", "idempotency-key": m.idempotence },
        body: JSON.stringify({ from: expediteur, to: [m.a], subject: m.sujet, html: m.html, text: m.texte }),
      });
    } catch (e) {
      return { ok: false, reessayer: true, erreur: `réseau : ${e instanceof Error ? e.message : String(e)}`.slice(0, 200) };
    }
    const corps = await r.text().catch(() => "");
    if (r.ok) {
      let id: string | null = null;
      try { id = (JSON.parse(corps) as { id?: string }).id ?? null; } catch { /* l'envoi est fait ; l'identifiant n'est qu'une trace */ }
      return { ok: true, id };
    }
    /* le message d'erreur de Resend ne contient ni le code ni l'adresse : seulement son nom et sa raison */
    let raison = `HTTP ${r.status}`;
    try { const j = JSON.parse(corps) as { name?: string; message?: string }; raison = `HTTP ${r.status} ${j.name ?? ""} ${j.message ?? ""}`.trim(); } catch { /* le statut suffit */ }
    return { ok: false, reessayer: r.status === 429 || r.status >= 500, erreur: raison.slice(0, 200) };
  };
}

/* ------------------------------------------------------- vider la boîte */

export type Rpc = (nom: string, args: Record<string, unknown>) => Promise<unknown>;
export type Bilan = { vus: number; envoyes: number; a_reessayer: number; echoues: number };

type Prise = { id: number; gabarit: string; donnees: Donnees; email: string; langue?: string; idempotence: string };

/**
 * Prend ce que la base dit d'envoyer, un par un : prendre (la base verrouille
 * la ligne et donne l'adresse), rendre, envoyer, dire le résultat. L'échec
 * d'un e-mail n'arrête jamais les autres. Le journal ne reçoit que des
 * numéros de ligne et des raisons — ni code, ni adresse.
 */
export async function traiterLaBoite(deps: { rpc: Rpc; envoyer: Envoyer; lot?: number; journal?: (m: string) => void }): Promise<Bilan> {
  const journal = deps.journal ?? (() => {});
  const bilan: Bilan = { vus: 0, envoyes: 0, a_reessayer: 0, echoues: 0 };
  const ids = ((await deps.rpc("courriels_a_traiter", { p_n: deps.lot ?? 20 })) ?? []) as unknown[];
  for (const brut of ids) {
    const id = Number(typeof brut === "object" && brut !== null ? Object.values(brut)[0] : brut);
    if (!Number.isFinite(id)) continue;
    bilan.vus++;
    try {
      const p = (await deps.rpc("courriel_prendre", { p_id: id })) as Prise | null;
      if (!p) continue; // pris par un autre, expiré, déjà servi : la base a tranché
      let rendu: Rendu;
      try {
        rendu = rendre(p.gabarit, p.donnees, p.langue);
      } catch (e) {
        bilan.echoues++;
        journal(`courriel ${id} : rendu impossible (${e instanceof Error ? e.message : String(e)})`);
        await deps.rpc("courriel_resultat", { p_id: id, p_ok: false, p_erreur: `rendu : ${e instanceof Error ? e.message : String(e)}`, p_definitif: true });
        continue;
      }
      const r = await deps.envoyer({ a: p.email, sujet: rendu.sujet, html: rendu.html, texte: rendu.texte, idempotence: p.idempotence });
      if (r.ok) {
        bilan.envoyes++;
        await deps.rpc("courriel_resultat", { p_id: id, p_ok: true, p_fournisseur_id: r.id });
      } else {
        if (r.reessayer) bilan.a_reessayer++; else bilan.echoues++;
        journal(`courriel ${id} : ${r.erreur}${r.reessayer ? " (repris plus tard)" : ""}`);
        await deps.rpc("courriel_resultat", { p_id: id, p_ok: false, p_erreur: r.erreur, p_definitif: !r.reessayer });
      }
    } catch (e) {
      /* la base injoignable pour CETTE ligne : elle redevient prenable après deux minutes (courriels_a_traiter) */
      bilan.a_reessayer++;
      journal(`courriel ${id} : ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
    }
  }
  return bilan;
}

/* ----------------------------------------------------------- la porte */

/** Le jeton du réveil (Vault « courriel_jeton » = secret COURRIEL_JETON), comparé en temps constant. Sans jeton attendu : personne. */
export function jetonValide(recu: string | null | undefined, attendu: string | null | undefined): boolean {
  if (!attendu || attendu.length < 16 || !recu) return false;
  const a = new TextEncoder().encode(recu), b = new TextEncoder().encode(attendu);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}
