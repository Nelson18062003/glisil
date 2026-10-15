/*
 * LE VEILLEUR DE CHAÎNE — la logique d'argent, une seule fois pour tous les
 * réseaux. À chaque tour (toutes les quelques secondes), sur chaque réseau :
 *   1. garder des adresses de dépôt prêtes (dérivées de la graine) ;
 *   2. créditer les dépôts assez confirmés — une fois ;
 *   3. balayer les adresses de dépôt vers le wallet chaud (le chaud avance les frais) ;
 *   4. envoyer les retraits : signer, NOTER, puis diffuser ; reprendre ce qui est noté ;
 *   5. mettre au froid ce qui dépasse le plafond du chaud, et crier quand il manque ;
 *   6. publier son état pour l'administration (page « Wallets »).
 *
 * La configuration du service : voir README.md (variables XAFE_GRAINE, MOTEUR_*,
 * BEP20_*, TRC20_*, FROID_*). `npm run veilleur`.
 */
import { formatUnits, keccak256, parseUnits, toUtf8Bytes } from "ethers";
import type { Actif, Appel, Chaine } from "./chaine.ts";
import { versMoteur } from "./chaine.ts";
import { CHAUD, deriver, graineValide } from "./cles.ts";
import { moteur, type Rpc } from "./moteur.ts";

export type ConfigVeilleur = {
  graine: string;
  /** combien d'adresses libres garder prêtes, par actif */
  reserve?: number;
  /** au-delà de ce solde (en USDT), une adresse de dépôt est balayée vers le chaud */
  seuilBalayage?: number;
  /** le wallet froid : au-delà de `plafondChaud` USDT sur le chaud, on y envoie de quoi redescendre à `garderChaud` */
  froid?: { adresse: string; plafondChaud: number; garderChaud: number };
  /** en dessous, le veilleur réclame de la monnaie native pour les frais (BNB, TRX), en unités entières */
  natifMinimum?: number;
  journal?: (ligne: string) => void;
  /** pour l'épreuve : ce qui se passe entre la signature notée et la diffusion */
  apresSignature?: (reference: string) => void;
  /** pour l'épreuve : combien de temps attendre qu'une transaction à nous entre dans un bloc */
  attenteMs?: number;
};
type Attribuee = { adresse: string; actif: Actif; indice: number | null; compte_id: string };
type Retrait = { reference: string; actif: Actif; adresse: string; montant: number; tx_hash: string | null; tx_brut: string | null };
type Bilan = { envoyes: number; confirmes: number; echoues: number };

export class Veilleur {
  readonly chaine: Chaine;
  readonly c: ConfigVeilleur;
  readonly alertes: string[] = [];
  private journal: (l: string) => void;

  constructor(chaine: Chaine, c: ConfigVeilleur) {
    this.chaine = chaine;
    this.c = c;
    this.journal = c.journal ?? ((l) => console.log(`[${chaine.reseau}] ${l}`));
  }

  private alerte(texte: string) { this.alertes.push(texte); this.journal(`ALERTE ${texte}`); }

  /** Signer, diffuser, attendre le bloc : pour NOS mouvements internes (gaz, balayage, froid, destruction). */
  private async envoyerEtAttendre(indice: number, appel: Appel): Promise<boolean> {
    const { hash, brut } = await this.chaine.signer(indice, appel);
    await this.chaine.diffuser(brut);
    const fin = Date.now() + (this.c.attenteMs ?? 120_000);
    while (Date.now() < fin) {
      const r = await this.chaine.recu(hash);
      if (r) return r.ok;
      await new Promise((ok) => setTimeout(ok, 500));
    }
    throw new Error(`transaction ${hash} toujours pas dans un bloc`);
  }

  /* -------------------------------------------------------- les adresses */

  /** Garder `reserve` adresses libres par actif. Les XAFe n'entrent qu'inscrites au contrat (par l'admin). */
  async preparerAdresses(rpc: Rpc): Promise<{ ajoutees: number; aInscrire: string[] }> {
    const r = this.chaine.reseau;
    const etat = await rpc("chaine_adresses", { p_reseau: r });
    const reserve = this.c.reserve ?? 20;
    let indice = Number(etat.indice_max ?? 0);
    let ajoutees = 0;
    const aInscrire: string[] = [];
    for (const actif of ["USDT", "XAFe"] as Actif[]) {
      const manque = reserve - Number(etat.libres?.[actif] ?? 0);
      if (manque <= 0) continue;
      const lot: { adresse: string; indice: number }[] = [];
      for (let i = 0; i < manque; i++) {
        indice += 1;
        const { adresse } = deriver(this.c.graine, r, indice);
        if (actif === "XAFe" && !(await this.chaine.estAdresseDeDepot(adresse))) { aInscrire.push(adresse); continue; }
        lot.push({ adresse, indice });
      }
      if (lot.length) ajoutees += Number(await rpc("chaine_ajouter_adresses", { p_actif: actif, p_reseau: r, p_adresses: lot }));
    }
    if (aInscrire.length) this.journal(`${aInscrire.length} adresse(s) XAFe attendent leur inscription au contrat par l'admin`);
    return { ajoutees, aInscrire };
  }

  /* ----------------------------------------------------------- les dépôts */

  /** Du curseur jusqu'au dernier bloc assez confirmé. Rend combien de dépôts ont été crédités. */
  async crediterDepots(rpc: Rpc): Promise<number> {
    const r = this.chaine.reseau;
    const jusqua = (await this.chaine.tete()) - this.chaine.confirmations + 1;
    const curseur = await rpc("chaine_curseur", { p_reseau: r });
    const depuis = curseur == null ? Math.max(0, jusqua - 5000) : Number(curseur) + 1;
    if (jusqua < depuis) return 0;
    const { attribuees, reserve } = await rpc("chaine_adresses", { p_reseau: r });
    // la réserve aussi se surveille : un dépôt sur une adresse jamais montrée ne crédite personne, mais il se voit
    const surveillees: Attribuee[] = [...attribuees, ...(reserve ?? [])];
    let credites = 0;
    for (const actif of ["USDT", "XAFe"] as Actif[]) {
      const vers = surveillees.filter((a) => a.actif === actif).map((a) => a.adresse);
      if (!vers.length) continue;
      for (const d of await this.chaine.transferts(actif, vers, depuis, jusqua)) {
        const montant = versMoteur(d.brut, this.chaine.decimales[actif]);
        if (montant <= 0) continue;
        const attribuee = (attribuees as Attribuee[]).some((a) => a.adresse.toLowerCase() === d.adresse.toLowerCase() && a.actif === actif);
        try {
          // des XAFe ne se détruisent que sur une adresse attribuée ; sur la réserve, ils restent et l'alerte part
          if (actif === "XAFe" && attribuee) await this.detruireRetour(d.adresse, d.brut, d.preuve);
          const res = await rpc("chaine_crediter_depot", { p_reseau: r, p_adresse: d.adresse, p_actif: actif, p_montant: montant, p_preuve: d.preuve });
          if (!res?.deja) { credites += 1; this.journal(`dépôt ${actif} crédité : ${montant} sur ${d.adresse} (${d.preuve})`); }
        } catch (e) {
          const raison = (e as Error).message;
          // une panne (le moteur ne répond pas, la chaîne refuse la destruction) : le curseur NE bouge PAS, on relira
          // ce bloc au tour suivant — créditer est idempotent par la preuve. Seule une adresse que personne n'a reçue
          // est définitive : le dépôt est gardé dans la base, pour l'équipe, et la lecture continue.
          if (!/adresse non attribuée/.test(raison)) throw new Error(`dépôt ${actif} ${montant} sur ${d.adresse} (${d.preuve}) en attente : ${raison}`);
          this.alerte(`dépôt non crédité : ${actif} ${montant} sur ${d.adresse} (${d.preuve}) — adresse jamais attribuée à un client`);
          await rpc("chaine_signaler_orphelin", { p_reseau: r, p_actif: actif, p_adresse: d.adresse, p_montant: montant, p_preuve: d.preuve, p_raison: "adresse jamais attribuée à un client" });
        }
      }
    }
    await rpc("chaine_curseur", { p_reseau: r, p_bloc: jusqua });
    return credites;
  }

  /** Des XAFe rendus : détruits LÀ où ils sont arrivés, sous la référence du dépôt. Déjà détruits : rien à refaire. */
  private async detruireRetour(adresse: string, brut: bigint, preuve: string) {
    const empreinte = keccak256(toUtf8Bytes(preuve));
    if (await this.chaine.dejaDetruit(empreinte)) return;
    if (!(await this.envoyerEtAttendre(CHAUD, { type: "detruireDepot", adresse, montant: brut, empreinte }))) throw new Error("la destruction a été refusée par la chaîne");
  }

  /* ---------------------------------------------------------- les retraits */

  async envoyerRetraits(rpc: Rpc): Promise<Bilan> {
    const bilan: Bilan = { envoyes: 0, confirmes: 0, echoues: 0 };
    const liste: Retrait[] = await rpc("chaine_retraits_a_envoyer", { p_reseau: this.chaine.reseau });
    for (const r of liste) {
      // un retrait qui casse ne retient pas les autres : chacun le sien, l'erreur au journal
      // (un chaud sans rôle FRAPPEUR, un compte Tron jamais activé, un nœud qui refuse : l'équipe doit le voir, pas seulement le journal)
      try { await this.unRetrait(rpc, r, bilan); } catch (e) { this.alerte(`retrait ${r.reference} bloqué : ${(e as Error).message.slice(0, 300)}`); }
    }
    return bilan;
  }

  private async unRetrait(rpc: Rpc, r: Retrait, bilan: Bilan) {
    const ch = this.chaine;
    if (r.tx_hash) {
      const recu = await ch.recu(r.tx_hash);
      if (!recu) {
        if (r.tx_brut && (await ch.perimee(r.tx_hash, r.tx_brut))) {
          // elle ne pourra plus jamais entrer dans un bloc (Tron : échue ; EVM : nonce pris) — on en signe une autre, en le disant au moteur
          await this.signerNoterDiffuser(rpc, r, r.tx_hash);
          this.journal(`retrait ${r.reference} : la transaction ${r.tx_hash} a expiré sans partir, une nouvelle la remplace`);
          return;
        }
        // signé et noté, peut-être jamais parti (coupure) : la MÊME transaction, rediffusée
        if (r.tx_brut) await ch.diffuser(r.tx_brut);
        return;
      }
      if ((await ch.tete()) - recu.bloc + 1 < ch.confirmations) return;
      await rpc("chaine_resultat_retrait", { p_reference: r.reference, p_ok: recu.ok, p_tx_hash: r.tx_hash, p_resultat: recu.ok ? `bloc ${recu.bloc}` : "transaction refusée par la chaîne" });
      if (recu.ok) bilan.confirmes += 1; else bilan.echoues += 1;
      return;
    }
    // une adresse dont la somme de contrôle est fausse est une faute de frappe : on n'envoie pas, l'argent revient
    if (!ch.adresseValable(r.adresse)) {
      await rpc("chaine_resultat_retrait", { p_reference: r.reference, p_ok: false, p_tx_hash: null, p_resultat: "adresse invalide : la somme de contrôle ne correspond pas (faute de frappe ?)" });
      bilan.echoues += 1;
      this.journal(`retrait ${r.reference} refusé : adresse ${r.adresse} invalide, les fonds reviennent au client`);
      return;
    }
    if (r.actif === "USDT" && (await ch.solde("USDT", ch.chaud)) < parseUnits(String(r.montant), ch.decimales.USDT)) {
      this.alerte(`le wallet chaud n'a pas assez d'USDT pour ${r.reference} (${r.montant}) : balayage ou réapprovisionnement depuis le froid`);
      return;
    }
    await this.signerNoterDiffuser(rpc, r, null);
    bilan.envoyes += 1;
  }

  private async signerNoterDiffuser(rpc: Rpc, r: Retrait, remplace: string | null) {
    const ch = this.chaine;
    const vers = ch.adresseValable(r.adresse)!;
    const montant = parseUnits(String(r.montant), ch.decimales[r.actif]);
    const appel: Appel = r.actif === "USDT"
      ? { type: "jeton", actif: "USDT", vers, montant }
      : { type: "frapper", vers, montant, empreinte: keccak256(toUtf8Bytes(r.reference)) };
    const { hash, brut } = await ch.signer(CHAUD, appel);
    // NOTÉ avant d'être diffusé : après une coupure, c'est cette transaction-là qui repart
    await rpc("chaine_marquer_envoi", { p_reference: r.reference, p_tx_hash: hash, p_brut: brut, p_remplace: remplace });
    this.c.apresSignature?.(r.reference);
    await ch.diffuser(brut);
    this.journal(`retrait ${r.reference} envoyé : ${r.montant} ${r.actif} vers ${r.adresse} (${hash})`);
  }

  /* ------------------------------------------------------------ le balayage */

  /** Les USDT des adresses de dépôt rejoignent le wallet chaud (qui avance les frais). */
  async balayer(rpc: Rpc): Promise<number> {
    const ch = this.chaine;
    const { attribuees } = await rpc("chaine_adresses", { p_reseau: ch.reseau });
    const seuil = parseUnits(String(this.c.seuilBalayage ?? 50), ch.decimales.USDT);
    let balayees = 0;
    for (const a of (attribuees as Attribuee[]).filter((x) => x.actif === "USDT" && x.indice != null)) {
      const solde = await ch.solde("USDT", a.adresse);
      if (solde < seuil) continue;
      const besoin = await ch.fraisJeton("USDT", a.indice!, ch.chaud, solde);
      const natif = await ch.solde("natif", a.adresse);
      if (natif < besoin) await this.envoyerEtAttendre(CHAUD, { type: "natif", vers: a.adresse, montant: besoin - natif });
      if (!(await this.envoyerEtAttendre(a.indice!, { type: "jeton", actif: "USDT", vers: ch.chaud, montant: solde }))) throw new Error(`le balayage de ${a.adresse} a été refusé`);
      balayees += 1;
      this.journal(`balayé : ${formatUnits(solde, ch.decimales.USDT)} USDT de ${a.adresse} vers le wallet chaud`);
    }
    return balayees;
  }

  /* ------------------------------------------------------------- le froid */

  /** Au-delà du plafond, le surplus du chaud part au froid. En dessous de ce que les retraits demandent, l'alerte. */
  async mettreAuFroid(rpc: Rpc): Promise<number> {
    const ch = this.chaine;
    const usdt = await ch.solde("USDT", ch.chaud);
    const natif = await ch.solde("natif", ch.chaud);
    const dec = ch.decimales.USDT;
    if (this.c.natifMinimum != null && natif < parseUnits(String(this.c.natifMinimum), ch.reseau === "trc20" ? 6 : 18)) {
      this.alerte(`le wallet chaud ${ch.chaud} manque de ${ch.reseau === "trc20" ? "TRX" : "BNB"} pour les frais : il en reste ${formatUnits(natif, ch.reseau === "trc20" ? 6 : 18)}`);
    }
    const attente: Retrait[] = await rpc("chaine_retraits_en_attente", { p_reseau: ch.reseau }).catch(() => []);
    const du = attente.filter((r) => r.actif === "USDT").reduce((s, r) => s + parseUnits(String(r.montant), dec), 0n);
    if (du > usdt) this.alerte(`réapprovisionner le wallet chaud depuis le froid : ${formatUnits(du - usdt, dec)} USDT manquent pour les retraits en attente`);
    const f = this.c.froid;
    if (!f || !ch.adresseValable(f.adresse)) return 0;
    const plafond = parseUnits(String(f.plafondChaud), dec);
    const garder = parseUnits(String(f.garderChaud), dec);
    if (usdt <= plafond || usdt - garder <= du) return 0;
    const montant = usdt - garder - du;  // ce qui est promis aux retraits en attente reste au chaud
    if (!(await this.envoyerEtAttendre(CHAUD, { type: "jeton", actif: "USDT", vers: ch.adresseValable(f.adresse)!, montant }))) throw new Error("l'envoi au froid a été refusé");
    this.journal(`mis au froid : ${formatUnits(montant, dec)} USDT vers ${f.adresse}`);
    return Number(formatUnits(montant, dec));
  }

  /* --------------------------------------------------------------- l'état */

  /** Ce que la plateforme tient sur la chaîne : le chaud, le froid et les adresses attribuées (pas la réserve), et l'offre XAFe. */
  async avoirs(rpc: Rpc): Promise<{ usdt: bigint; xafeEnCirculation: bigint }> {
    const ch = this.chaine;
    const { attribuees } = await rpc("chaine_adresses", { p_reseau: ch.reseau });
    let usdt = await ch.solde("USDT", ch.chaud);
    const froid = this.c.froid && ch.adresseValable(this.c.froid.adresse);
    if (froid) usdt += await ch.solde("USDT", froid);
    for (const a of (attribuees as Attribuee[]).filter((x) => x.actif === "USDT" && x.indice != null)) usdt += await ch.solde("USDT", a.adresse);
    return { usdt, xafeEnCirculation: await ch.offreXafe() };
  }

  /** Un tour complet ; une étape qui casse ne retient pas les autres, elle devient une alerte — et l'état est publié quand même. */
  async tour(rpc: Rpc) {
    this.alertes.length = 0;
    const etape = async <T>(nom: string, f: () => Promise<T>, defaut: T): Promise<T> => {
      try { return await f(); } catch (e) { this.alerte(`${nom} : ${(e as Error).message}`); return defaut; }
    };
    const adresses = await etape("adresses", () => this.preparerAdresses(rpc), { ajoutees: 0, aInscrire: [] as string[] });
    const credites = await etape("dépôts", () => this.crediterDepots(rpc), 0);
    const balayees = await etape("balayage", () => this.balayer(rpc), 0);
    const retraits = await etape("retraits", () => this.envoyerRetraits(rpc), { envoyes: 0, confirmes: 0, echoues: 0 });
    const auFroid = await etape("froid", () => this.mettreAuFroid(rpc), 0);
    const ch = this.chaine;
    await rpc("chaine_publier_etat", {
      p_reseau: ch.reseau,
      p_etat: {
        chaud: ch.chaud,
        usdt_chaud: Number(formatUnits(await ch.solde("USDT", ch.chaud), ch.decimales.USDT)),
        natif_chaud: Number(formatUnits(await ch.solde("natif", ch.chaud), ch.reseau === "trc20" ? 6 : 18)),
        froid: this.c.froid?.adresse ?? null,
        usdt_froid: this.c.froid && ch.adresseValable(this.c.froid.adresse) ? Number(formatUnits(await ch.solde("USDT", ch.adresseValable(this.c.froid.adresse)!), ch.decimales.USDT)) : null,
        plafond_chaud: this.c.froid?.plafondChaud ?? null,
        garder_chaud: this.c.froid?.garderChaud ?? null,
        // l'admin les inscrit au contrat avec SA clé : `npm run mise-en-service -- inscrire …`
        a_inscrire: adresses.aInscrire,
        alertes: [...this.alertes],
      },
    }).catch((e) => this.journal(`état non publié : ${(e as Error).message}`));
    return { ...adresses, credites, balayees, ...retraits, auFroid, alertes: [...this.alertes] };
  }
}

/* ------------------------------------------------------------ le service */

async function principal() {
  const env = process.env;
  const graine = env.XAFE_GRAINE ?? "";
  if (!graineValide(graine)) { console.error("✗ XAFE_GRAINE manque ou n'est pas une graine valide (12 ou 24 mots)"); process.exit(1); }
  if (!env.MOTEUR_URL || !env.MOTEUR_CLE) { console.error("✗ MOTEUR_URL et MOTEUR_CLE sont nécessaires"); process.exit(1); }
  const rpc = moteur(env.MOTEUR_URL, env.MOTEUR_CLE);
  const veilleurs: Veilleur[] = [];
  const commun = (prefixe: string): ConfigVeilleur => ({
    graine,
    reserve: Number(env.RESERVE_ADRESSES ?? 20),
    seuilBalayage: Number(env.SEUIL_BALAYAGE_USDT ?? 50),
    // les mêmes seuils que « mise-en-service verifier » : sous 0,01 BNB ou 50 TRX, quelques retraits seulement passent encore
    natifMinimum: Number(env[`${prefixe}_NATIF_MINIMUM`] ?? (prefixe === "BEP20" ? 0.01 : 50)),
    froid: env[`${prefixe}_FROID`] ? { adresse: env[`${prefixe}_FROID`]!, plafondChaud: Number(env[`${prefixe}_PLAFOND_CHAUD_USDT`] ?? 20000), garderChaud: Number(env[`${prefixe}_GARDER_CHAUD_USDT`] ?? 10000) } : undefined,
  });
  if (env.BEP20_RPC) {
    const { ChaineEvm } = await import("./evm.ts");
    const ch = new ChaineEvm({ rpcUrl: env.BEP20_RPC, usdt: env.BEP20_USDT!, xafe: env.BEP20_XAFE!, graine, confirmations: Number(env.BEP20_CONFIRMATIONS ?? 15) });
    await ch.demarrer();
    veilleurs.push(new Veilleur(ch, commun("BEP20")));
  }
  if (env.TRC20_NOEUD) {
    const { ChaineTron } = await import("./tron.ts");
    const ch = new ChaineTron({ noeud: env.TRC20_NOEUD, usdt: env.TRC20_USDT!, xafe: env.TRC20_XAFE!, graine, confirmations: Number(env.TRC20_CONFIRMATIONS ?? 20), cleApi: env.TRC20_CLE_API });
    await ch.demarrer();
    veilleurs.push(new Veilleur(ch, commun("TRC20")));
  }
  if (!veilleurs.length) { console.error("✗ aucun réseau : BEP20_RPC et/ou TRC20_NOEUD"); process.exit(1); }
  for (const v of veilleurs) console.log(`· veilleur ${v.chaine.reseau}, wallet chaud ${v.chaine.chaud}`);
  const pause = Number(env.PAUSE_SECONDES ?? 15) * 1000;
  for (;;) {
    for (const v of veilleurs) {
      try {
        const b = await v.tour(rpc);
        if (b.credites || b.envoyes || b.confirmes || b.echoues || b.balayees || b.ajoutees || b.auFroid) console.log(`· ${new Date().toISOString()} ${v.chaine.reseau} ${JSON.stringify(b)}`);
      } catch (e) {
        console.error(`✗ ${new Date().toISOString()} ${v.chaine.reseau} ${(e as Error).message}`);
      }
    }
    await new Promise((r) => setTimeout(r, pause));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void principal();
