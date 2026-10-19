/*
 * LA PORTE DE TOTEM, sans rien qui dépende de Deno : la signature, le routage,
 * les réponses. Les deux fonctions (totem-sms, totem-commandes) ne font que
 * brancher ceci sur Supabase ; le harnais (verifier-la-porte.ts) le fait
 * tourner sous Node contre un faux moteur. Ce qui est éprouvé est ce qui
 * tourne.
 *
 * Chaque requête porte trois en-têtes :
 *   x-totem-terminal    l'identifiant du boîtier ('akwa-1')
 *   x-totem-horodatage  les secondes Unix au moment de l'envoi
 *   x-totem-signature   hex( HMAC-SHA256( clé du terminal,
 *                         horodatage + "." + MÉTHODE + " " + cible + "." + corps ) )
 * La cible est le chemin à partir du nom de la porte, requête comprise :
 * « totem-commandes/7 », « totem-commandes?type=sms », « totem-sms ».
 * Signer le corps seul ne suffisait pas : « {"etat":"en_cours"} » signé pour
 * la commande 7 valait, pendant cinq minutes, pour TOUTES les commandes du
 * terminal — et un GET signé pour un guichet valait pour les deux autres.
 * Une signature vaut cinq minutes : au-delà, une requête rejouée est refusée.
 * Un boîtier ne voit que SES commandes et n'écrit que pour SES cartes.
 */

export type Rpc = (nom: string, args: Record<string, unknown>) => Promise<unknown>;
export type Reponse = { statut: number; corps: unknown };

export const FENETRE_SECONDES = 300;

const encodeur = new TextEncoder();

function hex(octets: ArrayBuffer): string {
  return Array.from(new Uint8Array(octets), (o) => o.toString(16).padStart(2, "0")).join("");
}

export async function signer(cle: string, horodatage: number | string, methode: string, cible: string, corps: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", encodeur.encode(cle), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, encodeur.encode(`${horodatage}.${methode.toUpperCase()} ${cible}.${corps}`)));
}

/**
 * Ce qu'une requête vise, tel que le boîtier l'a écrit : le chemin à partir
 * du nom de la porte (« totem-… »), et la requête telle qu'elle est arrivée.
 * Selon l'hébergement, l'adresse que voit la fonction commence par
 * « /functions/v1/ » ou directement par son nom : on part du nom, des deux
 * côtés pareil.
 */
export function cibleDe(url: URL): string {
  const morceaux = url.pathname.split("/").filter(Boolean);
  const i = morceaux.findIndex((m) => m.startsWith("totem-"));
  return (i >= 0 ? morceaux.slice(i) : morceaux).join("/") + url.search;
}

/** Deux chaînes comparées en temps constant : une signature ne se devine pas octet par octet. */
function memes(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type Entetes = { terminal: string | null; horodatage: string | null; signature: string | null };

export function lireEntetes(h: { get(nom: string): string | null }): Entetes {
  return { terminal: h.get("x-totem-terminal"), horodatage: h.get("x-totem-horodatage"), signature: h.get("x-totem-signature") };
}

/**
 * Vérifie la signature d'une requête. `cleDuTerminal` va chercher la clé en
 * base (null si le terminal est inconnu). Rend null si tout va bien, sinon la
 * réponse de refus — toujours 401, toujours la même forme : un attaquant
 * n'apprend pas si c'est le terminal ou la clé qui cloche.
 */
export async function verifier(
  entetes: Entetes,
  methode: string,
  url: URL,
  corps: string,
  cleDuTerminal: (terminal: string) => Promise<string | null>,
  maintenant: () => number = () => Math.floor(Date.now() / 1000),
): Promise<Reponse | null> {
  const refus: Reponse = { statut: 401, corps: { erreur: "signature refusée" } };
  const { terminal, horodatage, signature } = entetes;
  if (!terminal || !horodatage || !signature || !/^[0-9]{1,12}$/.test(horodatage) || !/^[0-9a-f]{64}$/.test(signature)) return refus;
  if (Math.abs(maintenant() - Number(horodatage)) > FENETRE_SECONDES) return refus;
  const cle = await cleDuTerminal(terminal);
  if (!cle) return refus;
  const attendue = await signer(cle, horodatage, methode, cibleDe(url), corps);
  return memes(attendue, signature) ? null : refus;
}

/* ---------------------------------------------------------------- SMS */

type Ligne = Record<string, unknown>;

const nombre = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const texte = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/**
 * Un SMS d'argent (ou un lot) lu par TOTEM. Chaque ligne va au moteur
 * (`totem_sms_recu`), qui crédite, retient, ou reconnaît un SMS déjà vu.
 * Un lot est traité ligne par ligne : une ligne malformée ne fait pas
 * tomber les autres, et dit pourquoi elle est refusée.
 */
export async function traiterSms(rpc: Rpc, terminal: string, charge: unknown): Promise<Reponse> {
  /* des soldes seuls (une consultation USSD, un SMS de relevé) : {"soldes": [...]} */
  if (charge && typeof charge === "object" && !Array.isArray(charge) && Array.isArray((charge as Ligne).soldes) && !(charge as Ligne).lignes) {
    const soldes = (charge as Ligne).soldes as Ligne[];
    if (soldes.length === 0 || soldes.length > 50) return { statut: 400, corps: { erreur: "un lot va de 1 à 50 soldes" } };
    const resultats: unknown[] = [];
    for (const x of soldes) resultats.push(await noterSolde(rpc, terminal, x, x?.source === "sms" ? "sms" : "ussd"));
    return { statut: 200, corps: { soldes: resultats } };
  }
  const lignes: Ligne[] = Array.isArray(charge) ? (charge as Ligne[]) : charge && typeof charge === "object" && Array.isArray((charge as Ligne).lignes) ? ((charge as Ligne).lignes as Ligne[]) : [charge as Ligne];
  if (lignes.length === 0 || lignes.length > 200) return { statut: 400, corps: { erreur: "un lot va de 1 à 200 lignes" } };
  const resultats: unknown[] = [];
  for (const l of lignes) {
    if (!l || typeof l !== "object") { resultats.push({ resultat: "refuse", motif: "ligne vide" }); continue; }
    if (l.terminal !== undefined && l.terminal !== terminal) { resultats.push({ resultat: "refuse", motif: "la ligne n'est pas de ce terminal" }); continue; }
    const source_id = nombre(l.source_id);
    if (source_id === null) { resultats.push({ resultat: "refuse", motif: "source_id manquant" }); continue; }
    if (l.sens !== undefined && l.sens !== "entree" && l.sens !== "sortie") { resultats.push({ source_id, resultat: "ignore", motif: "seules les entrées et les sorties d'argent comptent" }); continue; }
    try {
      /* une sortie du float (un paiement fait par l'équipe) : la preuve d'un remboursement, rapprochée par son transaction ID */
      if (l.sens === "sortie") {
        const r = await rpc("totem_sms_sortant", {
          p_terminal: terminal,
          p_source_id: source_id,
          p_operateur: texte(l.operateur),
          p_float_numero: texte(l.float_numero),
          p_numero: texte(l.numero),
          p_montant: nombre(l.montant),
          p_reference: texte(l.reference),
          p_texte: texte(l.texte),
          p_emis_le: texte(l.emis_le),
        });
        resultats.push({ source_id, ...(r as Record<string, unknown>), ...(await soldeDeLaLigne(rpc, terminal, l, source_id)) });
        continue;
      }
      const r = await rpc("totem_sms_recu", {
        p_terminal: terminal,
        p_source_id: source_id,
        p_operateur: texte(l.operateur),
        p_float_numero: texte(l.float_numero),
        p_numero_payeur: texte(l.numero),
        p_montant: nombre(l.montant),
        p_reference: texte(l.reference),
        p_texte: texte(l.texte),
        p_emis_le: texte(l.emis_le),
      });
      resultats.push({ source_id, ...(r as Record<string, unknown>), ...(await soldeDeLaLigne(rpc, terminal, l, source_id)) });
    } catch (e) {
      resultats.push({ source_id, resultat: "erreur", motif: e instanceof Error ? e.message : String(e) });
    }
  }
  return { statut: 200, corps: Array.isArray(charge) || (charge as Ligne)?.lignes ? resultats : resultats[0] };
}

/**
 * La colonne « floats » de la parité (0016) : le solde que l'OPÉRATEUR
 * annonce, jamais un calcul. Il vient avec la ligne (« nouveau solde » du SMS
 * d'un encaissement ou d'un paiement), ou seul (une consultation USSD). Un
 * solde qui ne se note pas ne fait jamais tomber la ligne qui le portait :
 * l'argent d'abord, le relevé ensuite.
 */
async function noterSolde(rpc: Rpc, terminal: string, x: Ligne | null | undefined, source: "sms" | "ussd", source_id: number | null = null) {
  if (!x || typeof x !== "object") return { solde: "refuse", motif: "solde vide" };
  const solde = nombre(x.solde ?? x.solde_apres);
  if (solde === null || solde < 0) return { solde: "refuse", motif: "solde illisible" };
  try {
    const r = await rpc("totem_solde_float", {
      p_terminal: terminal, p_operateur: texte(x.operateur), p_float_numero: texte(x.float_numero), p_solde: solde,
      p_annonce_le: texte(x.annonce_le ?? x.emis_le ?? x.recu_le), p_source: source, p_source_id: source_id ?? nombre(x.source_id),
    }) as Record<string, unknown>;
    return { solde: r?.resultat ?? "note", ...(r?.motif ? { motif_solde: r.motif } : {}) };
  } catch (e) {
    return { solde: "erreur", motif_solde: e instanceof Error ? e.message : String(e) };
  }
}

async function soldeDeLaLigne(rpc: Rpc, terminal: string, l: Ligne, source_id: number) {
  if (l.solde_apres === undefined || l.solde_apres === null) return {};
  return noterSolde(rpc, terminal, l, "sms", source_id);
}

/* ----------------------------------------------------------- commandes */

/** Les trois guichets : chacun relève, réclame et rend compte par ses propres RPC. */
const GUICHETS = {
  transferts: { relever: "totem_commandes_en_attente", reclamer: "totem_reclamer_commande", rendre: "totem_resultat_commande", reference: true, tentative: true },
  sms: { relever: "totem_messages_en_attente", reclamer: "totem_reclamer_message", rendre: "totem_resultat_message", reference: false, tentative: false },
  remboursements: { relever: "totem_remboursements_en_attente", reclamer: "totem_reclamer_remboursement", rendre: "totem_resultat_remboursement", reference: true, tentative: false },
} as const;
type TypeDeGuichet = keyof typeof GUICHETS;

/**
 * Ce que ce terminal doit faire : les transferts à composer, les SMS à
 * envoyer, les remboursements à renvoyer au payeur.
 *   GET   ?type=transferts|sms|remboursements   → ce qui attend
 *   PATCH /:id  {type, etat: "en_cours"}          → réclamer (refusé si déjà pris)
 *   PATCH /:id  {type, etat: "faite"|"envoye"|"fait", resultat, reference_operateur, tentative}
 *   PATCH /:id  {type, etat: "echouee"|"echoue", resultat, tentative}
 * `type` vaut "transferts" par défaut. `tentative` (transferts) est la valeur
 * de « reprises » rendue par la réclamation : un résultat ne vaut que pour la
 * tentative qu'il décrit, et un échec renvoyé faute d'accusé n'en est pas un
 * second. Le même protocole que la table `commandes` de TOTEM : relever,
 * réclamer, composer, rendre compte.
 */
export async function traiterCommandes(rpc: Rpc, terminal: string, methode: string, url: URL, charge: unknown): Promise<Reponse> {
  const morceaux = url.pathname.split("/").filter(Boolean);
  const id = morceaux.length > 0 && /^[0-9]+$/.test(morceaux[morceaux.length - 1]) ? Number(morceaux[morceaux.length - 1]) : null;
  const corps = (charge && typeof charge === "object" ? charge : {}) as Ligne;
  const type = String(corps.type ?? url.searchParams.get("type") ?? "transferts");
  if (type === "sorties_demo") {
    try { return await traiterSortiesDemo(rpc, terminal, methode, corps); }
    catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { statut: message.includes("déjà prise") ? 409 : 400, corps: { erreur: message } };
    }
  }
  if (!Object.hasOwn(GUICHETS, type)) return { statut: 400, corps: { erreur: "type inconnu : transferts, sms, remboursements ou sorties_demo" } };
  const g = GUICHETS[type as TypeDeGuichet];

  try {
    if (methode === "GET") {
      const r = await rpc(g.relever, { p_terminal: terminal });
      return { statut: 200, corps: r ?? [] };
    }
    if (methode === "PATCH" && id !== null) {
      const etat = String(corps.etat ?? "");
      if (etat === "en_cours") {
        const r = await rpc(g.reclamer, { p_id: id, p_terminal: terminal });
        return { statut: 200, corps: r };
      }
      const ok = etat === "faite" || etat === "envoye" || etat === "fait";
      const ko = etat === "echouee" || etat === "echoue";
      if (ok || ko) {
        const args: Record<string, unknown> = { p_id: id, p_terminal: terminal, p_ok: ok, p_resultat: texte(corps.resultat) };
        if (g.reference) args.p_reference_operateur = texte(corps.reference_operateur);
        if (g.tentative && corps.tentative !== undefined && corps.tentative !== null) {
          const t = nombre(corps.tentative);
          if (t === null || !Number.isInteger(t) || t < 0) return { statut: 400, corps: { erreur: "tentative : un entier, la valeur de « reprises » à la réclamation" } };
          args.p_tentative = t;
        }
        const r = await rpc(g.rendre, args);
        return { statut: 200, corps: r };
      }
      return { statut: 400, corps: { erreur: "etat inconnu : en_cours, puis faite / envoye / fait, ou echouee / echoue" } };
    }
    return { statut: 405, corps: { erreur: "GET ?type=… ou PATCH /:id" } };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    /* une commande déjà prise par un autre tour n'est pas une panne : c'est la règle qui tient */
    return { statut: message.includes("déjà prise") ? 409 : 400, corps: { erreur: message } };
  }
}

/**
 * Les sorties de démo (0032) : le terminal de démo paie lui-même les retraits
 * des testeurs vers un numéro de démo. Une sortie se désigne par sa référence.
 *   GET   ?type=sorties_demo                                         → à payer
 *   PATCH {type: "sorties_demo", reference, etat: "en_cours"}          → la prendre (409 si déjà prise)
 *   PATCH {type: "sorties_demo", reference, etat: "envoyee", transaction_id} → payée
 *   PATCH {type: "sorties_demo", reference, etat: "echouee", motif}   → rien n'est parti : les XAFe reviennent
 */
async function traiterSortiesDemo(rpc: Rpc, terminal: string, methode: string, corps: Ligne): Promise<Reponse> {
  if (methode === "GET") return { statut: 200, corps: (await rpc("totem_sorties_demo", { p_terminal: terminal })) ?? [] };
  if (methode !== "PATCH") return { statut: 405, corps: { erreur: "GET ?type=sorties_demo ou PATCH {reference, etat}" } };
  const reference = texte(corps.reference);
  if (!reference) return { statut: 400, corps: { erreur: "reference manquante" } };
  const etat = String(corps.etat ?? "");
  if (etat === "en_cours") return { statut: 200, corps: await rpc("totem_prendre_sortie_demo", { p_terminal: terminal, p_reference: reference }) };
  if (etat === "envoyee") {
    return { statut: 200, corps: await rpc("totem_sortie_demo_payee", { p_terminal: terminal, p_reference: reference, p_transaction_id: texte(corps.transaction_id) }) };
  }
  if (etat === "echouee") {
    return { statut: 200, corps: await rpc("totem_sortie_demo_echouee", { p_terminal: terminal, p_reference: reference, p_motif: texte(corps.motif) }) };
  }
  return { statut: 400, corps: { erreur: "etat inconnu : en_cours, envoyee ou echouee" } };
}

/* ----------------------------------------------------------- en-tête HTTP */

export function reponseHttp(r: Reponse): globalThis.Response {
  return new Response(JSON.stringify(r.corps), { status: r.statut, headers: { "content-type": "application/json; charset=utf-8" } });
}
