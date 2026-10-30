/*
 * LE VEILLEUR DE CHAÎNE — la logique d'argent, une seule fois pour tous les
 * réseaux. À chaque tour (toutes les quelques secondes), sur chaque réseau :
 *   1. garder des adresses de dépôt prêtes (dérivées de la graine) ;
 *   2. créditer les dépôts assez confirmés — une fois ;
 *   3. balayer les adresses de dépôt vers le wallet chaud (le chaud avance les frais) ;
 *   4. envoyer les retraits : signer, NOTER, puis diffuser ; reprendre ce qui est noté ;
 *   5. mettre au froid ce qui dépasse le plafond du chaud, et crier quand il manque ;
 *   6. jouer la RÉSERVE : chaque XAFe des comptes Glisil existe aussi sur la
 *      chaîne, DANS LE CONTRAT du réseau qui la porte (migration 0015 ; le
 *      contrat la tient, intransférable — une clé chaude volée ne l'emporte pas) ;
 *   7. LIRE le jeton sur la chaîne, sans se fier à ce qu'il a lui-même écrit :
 *      chaque frappe et chaque destruction depuis le déploiement du contrat,
 *      l'offre totale et la réserve, au même bloc — la colonne « chaîne » du
 *      rapprochement à trois colonnes (migration 0016) ;
 *   8. publier son état pour l'administration (page « Wallets »).
 *
 * La configuration du service : voir README.md (variables XAFE_GRAINE, MOTEUR_*,
 * BEP20_*, TRC20_*, FROID_*). `npm run veilleur`.
 */
import { formatUnits, keccak256, parseUnits, toUtf8Bytes } from "ethers";
import type { Actif, Appel, Chaine, Dollar, EtatDuJeton, MouvementJeton } from "./chaine.ts";
import { estDollar, versMoteur } from "./chaine.ts";
import { CHAUD, deriver, fiche } from "./cles.ts";
import type { Rpc } from "./moteur.ts";

export type ConfigVeilleur = {
  graine: string;
  /** combien d'adresses libres garder prêtes, par actif */
  reserve?: number;
  /** au-delà de ce solde (en dollars : USDT comme USDC), une adresse de dépôt est balayée vers le chaud */
  seuilBalayage?: number;
  /** le wallet froid : au-delà de `plafondChaud` dollars sur le chaud (par dollar), on y envoie de quoi redescendre à `garderChaud` */
  froid?: { adresse: string; plafondChaud: number; garderChaud: number };
  /** en dessous, le veilleur réclame de la monnaie native pour les frais (BNB, TRX), en unités entières */
  natifMinimum?: number;
  journal?: (ligne: string) => void;
  /** pour l'épreuve : ce qui se passe entre la signature notée et la diffusion */
  apresSignature?: (reference: string) => void;
  /** pour l'épreuve : combien de temps attendre qu'une transaction à nous entre dans un bloc */
  attenteMs?: number;
  /** combien d'adresses dériver au plus par tour et par actif (dans Supabase, le calcul d'un appel est compté) */
  parTour?: number;
  /** le bloc du déploiement du contrat XAFe : la lecture du jeton part de là, pour n'oublier aucune frappe */
  departJeton?: number;
  /** combien de blocs lire au plus par tour pour le jeton (le rattrapage se fait en plusieurs tours) */
  blocsJetonParTour?: number;
  /**
   * RÉSEAU D'ESSAI SEULEMENT : inscrire soi-même au contrat les adresses XAFe
   * préparées, avec une clé admin d'essai. En production, l'admin du contrat
   * est un wallet matériel : l'inscription est un geste de l'équipe.
   */
  inscrire?: (adresses: string[]) => Promise<void>;
  /** RÉSEAU D'ESSAI SEULEMENT : tenir le plafond de frappe du jour au chiffre du propriétaire (vrai s'il a fallu l'écrire) */
  plafondDEssai?: () => Promise<boolean>;
  /** en production : combien d'adresses XAFe d'avance doivent rester inscrites au contrat (l'alerte part en dessous) */
  stockXafe?: number;
};
/** Ce qu'il reste à frapper aujourd'hui pour les retraits XAFe de ce tour : la file attend plutôt que de faire refuser. */
type GardePlafond = { enPause: boolean; plafond: bigint; reste: bigint; arrete: boolean; pauseDite: boolean };
type Attribuee = { adresse: string; actif: Actif; indice: number | null; compte_id: string };
type Retrait = { reference: string; actif: Actif; adresse: string; montant: number; tx_hash: string | null; tx_brut: string | null };
type Bilan = { envoyes: number; confirmes: number; echoues: number };
type OperationReserve = { id: number; operation: "frapper" | "detruire"; montant: number; reference: string; etat: string; tx_hash: string | null; tx_brut: string | null };

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
  async preparerAdresses(rpc: Rpc): Promise<{ ajoutees: number; aInscrire: string[]; stockOk?: boolean }> {
    const r = this.chaine.reseau;
    const etat = await rpc("chaine_adresses", { p_reseau: r });
    const reserve = this.c.reserve ?? 20;
    let indice = Number(etat.indice_max ?? 0);
    let ajoutees = 0;
    let aInscrire: { adresse: string; indice: number }[] = [];
    for (const actif of this.chaine.actifs) {
      // un actif que la base ne porte pas sur ce réseau (une base d'avant 0045) : rien à préparer
      if (etat.libres && !(actif in etat.libres)) continue;
      const manque = Math.min(reserve - Number(etat.libres?.[actif] ?? 0), this.c.parTour ?? 20);
      if (manque <= 0) continue;
      const lot: { adresse: string; indice: number }[] = [];
      for (let i = 0; i < manque; i++) {
        indice += 1;
        const { adresse } = deriver(this.c.graine, r, indice);
        if (actif === "XAFe" && !(await this.chaine.estAdresseDeDepot(adresse))) { aInscrire.push({ adresse, indice }); continue; }
        lot.push({ adresse, indice });
      }
      if (lot.length) ajoutees += Number(await rpc("chaine_ajouter_adresses", { p_actif: actif, p_reseau: r, p_adresses: lot }));
    }
    if (aInscrire.length && this.c.inscrire) {
      // réseau d'essai : la clé admin d'essai les inscrit, et elles entrent dans la réserve au même tour
      await this.c.inscrire(aInscrire.map((a) => a.adresse));
      ajoutees += Number(await rpc("chaine_ajouter_adresses", { p_actif: "XAFe", p_reseau: r, p_adresses: aInscrire }));
      this.journal(`${aInscrire.length} adresse(s) XAFe inscrites au contrat (clé admin d'essai)`);
      aInscrire = [];
    }
    if (aInscrire.length) this.journal(`${aInscrire.length} adresse(s) XAFe attendent leur inscription au contrat par l'admin`);
    // en production, le stock est inscrit d'avance par une clé de mise en service qui y renonce ensuite : on regarde loin devant
    let stockOk: boolean | undefined;
    if (!this.c.inscrire) {
      const stock = this.c.stockXafe ?? 200;
      stockOk = await this.chaine.estAdresseDeDepot(deriver(this.c.graine, r, indice + stock).adresse);
      if (!stockOk) this.alerte(`moins de ${stock} adresses XAFe inscrites d'avance au contrat : l'admin doit en préinscrire (mise-en-service preinscrire)`);
    }
    return { ajoutees, aInscrire: aInscrire.map((a) => a.adresse), ...(stockOk === undefined ? {} : { stockOk }) };
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
    for (const actif of this.chaine.actifs) {
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
    // en pause, rien ne se signe : le curseur ne bouge pas, ce bloc se relira
    if ((await this.chaine.etatDuJeton()).enPause) throw new Error("contrat en pause");
    if (!(await this.envoyerEtAttendre(CHAUD, { type: "detruireDepot", adresse, montant: brut, empreinte }))) throw new Error("la destruction a été refusée par la chaîne");
  }

  /* ---------------------------------------------------------- les retraits */

  async envoyerRetraits(rpc: Rpc): Promise<Bilan> {
    const bilan: Bilan = { envoyes: 0, confirmes: 0, echoues: 0 };
    const liste: Retrait[] = await rpc("chaine_retraits_a_envoyer", { p_reseau: this.chaine.reseau });
    // le plafond de frappe du jour : un retrait XAFe qui n'y tient pas ATTEND (au lieu d'être refusé par le contrat, puis
    // remboursé au client). Ce qui est déjà signé compte contre le reste — par prudence, même s'il n'est pas encore miné.
    let garde: GardePlafond | null = null;
    if (liste.some((r) => r.actif === "XAFe" && !r.tx_hash)) {
      const j = await this.chaine.etatDuJeton();
      const dec = this.chaine.decimales.XAFe;
      const signe = liste.filter((r) => r.actif === "XAFe" && r.tx_hash).reduce((s, r) => s + parseUnits(String(r.montant), dec), 0n);
      garde = { enPause: j.enPause, plafond: j.plafondJour, reste: j.resteDuJour > signe ? j.resteDuJour - signe : 0n, arrete: false, pauseDite: false };
    }
    for (const r of liste) {
      // un retrait qui casse ne retient pas les autres : chacun le sien, l'erreur au journal
      // (un chaud sans rôle FRAPPEUR, un compte Tron jamais activé, un nœud qui refuse : l'équipe doit le voir, pas seulement le journal)
      try { await this.unRetrait(rpc, r, bilan, garde); } catch (e) { this.alerte(`retrait ${r.reference} bloqué : ${(e as Error).message.slice(0, 300)}`); }
    }
    return bilan;
  }

  private async unRetrait(rpc: Rpc, r: Retrait, bilan: Bilan, garde: GardePlafond | null = null) {
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
    // un actif que ce veilleur ne sait pas envoyer (l'USDC sans son contrat configuré) : le retrait ATTEND, il ne part
    // jamais sur un autre jeton — ni ne se rembourse tout seul : l'équipe configure le contrat ou le rembourse
    if (!ch.actifs.includes(r.actif)) {
      this.alerte(`retrait ${r.reference} (${r.montant} ${r.actif}) attend : ${r.actif} n'est pas configuré sur ce veilleur`);
      return;
    }
    if (estDollar(r.actif) && (await ch.solde(r.actif, ch.chaud)) < parseUnits(String(r.montant), ch.decimales[r.actif])) {
      this.alerte(`le wallet chaud n'a pas assez d'${r.actif} pour ${r.reference} (${r.montant}) : balayage ou réapprovisionnement depuis le froid`);
      return;
    }
    if (r.actif === "XAFe" && garde) {
      const dec = ch.decimales.XAFe;
      if (garde.enPause) {
        if (!garde.pauseDite) this.alerte("retraits XAFe en attente : le contrat est en pause");
        garde.pauseDite = true;
        return;
      }
      if (garde.arrete) return;   // la file est stricte : le gros retrait qui attend n'est pas doublé par les petits
      const u = parseUnits(String(r.montant), dec);
      if (u > garde.plafond) {
        // plus grand que le plafond entier : il n'y tiendra jamais, il ne retient pas la file
        this.alerte(`retrait ${r.reference} (${r.montant} XAFe) dépasse le plafond de frappe du jour (${formatUnits(garde.plafond, dec)}) : il ne partira qu'après que l'admin relève le plafond`);
        return;
      }
      if (u > garde.reste) {
        this.alerte(`retrait ${r.reference} attend le plafond du jour : il reste ${formatUnits(garde.reste, dec)} XAFe aujourd'hui (remis à zéro à 00:00 UTC) — ou relever le plafond (mise-en-service plafond)`);
        garde.arrete = true;
        return;
      }
      garde.reste -= u;
    }
    await this.signerNoterDiffuser(rpc, r, null);
    bilan.envoyes += 1;
  }

  private async signerNoterDiffuser(rpc: Rpc, r: Retrait, remplace: string | null) {
    const ch = this.chaine;
    const vers = ch.adresseValable(r.adresse)!;
    const montant = parseUnits(String(r.montant), ch.decimales[r.actif]);
    // un dollar se TRANSFÈRE depuis le chaud ; seul un retrait de XAFe se frappe — jamais « tout ce qui n'est pas l'USDT »
    let appel: Appel;
    if (estDollar(r.actif)) appel = { type: "jeton", actif: r.actif, vers, montant };
    else if (r.actif === "XAFe") appel = { type: "frapper", vers, montant, empreinte: keccak256(toUtf8Bytes(r.reference)) };
    else throw new Error(`actif inconnu : ${String(r.actif)}`);
    const { hash, brut } = await ch.signer(CHAUD, appel);
    // NOTÉ avant d'être diffusé : après une coupure, c'est cette transaction-là qui repart
    await rpc("chaine_marquer_envoi", { p_reference: r.reference, p_tx_hash: hash, p_brut: brut, p_remplace: remplace });
    this.c.apresSignature?.(r.reference);
    await ch.diffuser(brut);
    this.journal(`retrait ${r.reference} envoyé : ${r.montant} ${r.actif} vers ${r.adresse} (${hash})`);
  }

  /* ------------------------------------------------------------- la réserve */

  /**
   * Chaque mouvement de XAFe dans les comptes devient une transaction sur la
   * réserve, DANS L'ORDRE, sous la référence du mouvement (keccak256, que le
   * contrat n'accepte qu'une fois). Une opération à la fois : signée, NOTÉE,
   * diffusée, puis suivie jusqu'à ses confirmations avant la suivante — une
   * destruction ne passe jamais avant la frappe qui l'a rendue possible.
   * Rend ce qui a été confirmé à ce tour.
   */
  async jouerReserve(rpc: Rpc): Promise<{ frappees: number; detruites: number }> {
    const ch = this.chaine;
    const bilan = { frappees: 0, detruites: 0 };
    const liste: OperationReserve[] = await rpc("chaine_reserve_a_jouer", { p_reseau: ch.reseau, p_n: 20 });
    if (!liste.length) return bilan;
    const j: EtatDuJeton = await ch.etatDuJeton();
    if (j.enPause) { this.alerte("réserve : le contrat XAFe est en pause — rien n'est signé"); return bilan; }
    for (const o of liste) {
      if (o.tx_hash) {
        const recu = await ch.recu(o.tx_hash);
        if (!recu) {
          if (o.tx_brut && (await ch.perimee(o.tx_hash, o.tx_brut))) await this.signerReserve(rpc, o);
          else if (o.tx_brut) await ch.diffuser(o.tx_brut);
          return bilan;  // pas encore dans un bloc : la file attend
        }
        if ((await ch.tete()) - recu.bloc + 1 < ch.confirmations) return bilan;
        await rpc("chaine_reserve_resultat", { p_id: o.id, p_ok: recu.ok, p_bloc: recu.bloc, p_resultat: recu.ok ? `bloc ${recu.bloc}` : "refusée par la chaîne" });
        if (!recu.ok) { this.alerte(`réserve : ${o.operation} ${o.montant} XAFe (${o.reference}) refusée par la chaîne — à rejouer après examen`); return bilan; }
        if (o.operation === "frapper") bilan.frappees += 1; else bilan.detruites += 1;
        this.journal(`réserve : ${o.operation} ${o.montant} XAFe confirmée (${o.reference}, bloc ${recu.bloc})`);
        continue;
      }
      if (o.operation === "detruire" && j.reserve < parseUnits(String(o.montant), ch.decimales.XAFe)) {
        this.alerte(`réserve : ${o.montant} XAFe à détruire (${o.reference}) mais la réserve n'en a pas assez — une frappe manque avant`);
        return bilan;
      }
      await this.signerReserve(rpc, o);
      return bilan;  // la suivante attend la confirmation de celle-ci
    }
    return bilan;
  }

  private async signerReserve(rpc: Rpc, o: OperationReserve) {
    const ch = this.chaine;
    const montant = parseUnits(String(o.montant), ch.decimales.XAFe);
    const empreinte = keccak256(toUtf8Bytes(o.reference));
    // la réserve vit DANS le contrat : jamais plus une frappe vers le chaud
    const appel: Appel = o.operation === "frapper" ? { type: "frapperReserve", montant, empreinte } : { type: "detruireReserve", montant, empreinte };
    const { hash, brut } = await ch.signer(CHAUD, appel);
    // NOTÉ avant d'être diffusé : après une coupure, c'est cette transaction-là qui repart
    await rpc("chaine_reserve_marquer_envoi", { p_id: o.id, p_tx_hash: hash, p_brut: brut });
    await ch.diffuser(brut);
    this.journal(`réserve : ${o.operation} ${o.montant} XAFe envoyée (${o.reference}, ${hash})`);
  }

  /* ------------------------------------------------------- la lecture du jeton */

  /**
   * La colonne « chaîne » du rapprochement. Le veilleur ne s'y fie PAS à ses
   * propres notes : il relit sur la chaîne chaque frappe et chaque destruction
   * de XAFe depuis le déploiement du contrat, assez confirmées, et les remet à
   * la base telles quelles — c'est la base qui les rapproche, ligne par ligne,
   * de ce qu'elle attendait.
   *
   * Il rend aussi l'offre totale et la réserve AU BLOC LU : la lecture
   * s'arrête `confirmations` blocs avant la tête, l'offre se lit à la tête —
   * ce qui s'est passé entre les deux est retiré, pour que les deux chiffres
   * parlent du même instant. Tant que la lecture rattrape son retard, ces
   * chiffres valent null : un total d'avant la fin de la lecture ne se compare
   * à rien.
   */
  async lireLeJeton(rpc: Rpc): Promise<{ bloc: number | null; mouvements: number; offre: string | null; reserve: string | null; a_jour: boolean; xafe_chaud?: string }> {
    const ch = this.chaine;
    const dec = ch.decimales.XAFe;
    // les références sans empreinte : la base ne sait pas calculer keccak256, le veilleur le fait (et chacun peut le refaire)
    const sans: string[] = await rpc("chaine_references_sans_empreinte", { p_n: 500 });
    if (sans?.length) await rpc("chaine_noter_empreintes", { p_empreintes: sans.map((reference) => ({ reference, empreinte: keccak256(toUtf8Bytes(reference)) })) });
    const cle = `${ch.reseau}:jeton`;
    const jusqua = (await ch.tete()) - ch.confirmations + 1;
    const curseur = await rpc("chaine_curseur", { p_reseau: cle });
    const depuis = curseur == null ? (this.c.departJeton ?? Math.max(0, jusqua - 5000)) : Number(curseur) + 1;
    const fin = Math.min(jusqua, depuis + (this.c.blocsJetonParTour ?? 100_000) - 1);
    let n = 0;
    if (fin >= depuis) {
      const lus = await ch.mouvementsXafe(depuis, fin);
      // les mouvements ET le curseur dans le même appel : un tour coupé ne saute aucun bloc, et relire n'ajoute rien
      n = Number(await rpc("chaine_noter_mouvements", { p_reseau: ch.reseau, p_jusqua: fin, p_mouvements: lus.map((m) => ({ ...m, brut: undefined, montant: formatUnits(m.brut, dec) })) }));
      if (n) this.journal(`jeton : ${n} frappe(s)/destruction(s) relue(s) jusqu'au bloc ${fin}`);
    }
    const lu = Math.max(fin, depuis - 1);
    if (lu < jusqua) return { bloc: lu, mouvements: n, offre: null, reserve: null, a_jour: false };
    // l'offre et la réserve à la tête, moins ce qui s'est passé après le bloc lu
    const offre = await ch.offreXafe();
    // la réserve se lit AU CONTRAT, qui la tient
    const reserve = (await ch.etatDuJeton()).reserve;
    const tete = await ch.tete();
    const apres: MouvementJeton[] = tete > lu ? await ch.mouvementsXafe(lu + 1, tete) : [];
    const signe = (m: MouvementJeton) => (m.genre === "frappe" ? m.brut : -m.brut);
    const offreAuBloc = offre - apres.reduce((s, m) => s + signe(m), 0n);
    const contrat = ch.reserve.toLowerCase();
    const reserveAuBloc = reserve - apres.filter((m) => m.adresse.toLowerCase() === contrat).reduce((s, m) => s + signe(m), 0n);
    // rien ne doit jamais dormir sur le wallet chaud : des XAFe y sont arrivés par erreur (ou par une frappe volée)
    const xafeChaud = await ch.solde("XAFe", ch.chaud);
    if (xafeChaud > 0n) this.alerte(`des XAFe sont sur le wallet chaud (${formatUnits(xafeChaud, dec)}) : rien ne doit y être — envoi par erreur ? (gel puis reprise par l'admin)`);
    return { bloc: lu, mouvements: n, offre: formatUnits(offreAuBloc, dec), reserve: formatUnits(reserveAuBloc, dec), a_jour: true, xafe_chaud: formatUnits(xafeChaud, dec) };
  }

  /* ------------------------------------------------------------ le balayage */

  /** les dollars que ce veilleur porte (USDT, et l'USDC là où il est configuré) */
  private dollars(): Dollar[] { return this.chaine.actifs.filter(estDollar); }

  /** Les dollars des adresses de dépôt rejoignent le wallet chaud (qui avance les frais). */
  async balayer(rpc: Rpc): Promise<number> {
    const ch = this.chaine;
    const { attribuees } = await rpc("chaine_adresses", { p_reseau: ch.reseau });
    let balayees = 0;
    for (const d of this.dollars()) {
      const seuil = parseUnits(String(this.c.seuilBalayage ?? 50), ch.decimales[d]);
      for (const a of (attribuees as Attribuee[]).filter((x) => x.actif === d && x.indice != null)) {
        const solde = await ch.solde(d, a.adresse);
        if (solde < seuil) continue;
        const besoin = await ch.fraisJeton(d, a.indice!, ch.chaud, solde);
        const natif = await ch.solde("natif", a.adresse);
        if (natif < besoin) await this.envoyerEtAttendre(CHAUD, { type: "natif", vers: a.adresse, montant: besoin - natif });
        if (!(await this.envoyerEtAttendre(a.indice!, { type: "jeton", actif: d, vers: ch.chaud, montant: solde }))) throw new Error(`le balayage de ${a.adresse} a été refusé`);
        balayees += 1;
        this.journal(`balayé : ${formatUnits(solde, ch.decimales[d])} ${d} de ${a.adresse} vers le wallet chaud`);
      }
    }
    return balayees;
  }

  /* ------------------------------------------------------------- le froid */

  /** Au-delà du plafond, le surplus du chaud part au froid. En dessous de ce que les retraits demandent, l'alerte. */
  async mettreAuFroid(rpc: Rpc): Promise<number> {
    const ch = this.chaine;
    const natif = await ch.solde("natif", ch.chaud);
    const { natif: nomNatif, decimalesNatif } = fiche(ch.reseau);
    if (this.c.natifMinimum != null && natif < parseUnits(String(this.c.natifMinimum), decimalesNatif)) {
      this.alerte(`le wallet chaud ${ch.chaud} manque de ${nomNatif} pour les frais : il en reste ${formatUnits(natif, decimalesNatif)}`);
    }
    const attente: Retrait[] = await rpc("chaine_retraits_en_attente", { p_reseau: ch.reseau }).catch(() => []);
    const f = this.c.froid;
    let total = 0;
    // chaque dollar a son plafond au chaud, compté dans SES unités (l'USDC de BNB Chain a 18 décimales, celui d'Ethereum 6)
    for (const d of this.dollars()) {
      const dec = ch.decimales[d];
      const chaud = await ch.solde(d, ch.chaud);
      const du = attente.filter((r) => r.actif === d).reduce((s, r) => s + parseUnits(String(r.montant), dec), 0n);
      if (du > chaud) this.alerte(`réapprovisionner le wallet chaud depuis le froid : ${formatUnits(du - chaud, dec)} ${d} manquent pour les retraits en attente`);
      if (!f || !ch.adresseValable(f.adresse)) continue;
      const plafond = parseUnits(String(f.plafondChaud), dec);
      const garder = parseUnits(String(f.garderChaud), dec);
      if (chaud <= plafond || chaud - garder <= du) continue;
      const montant = chaud - garder - du;  // ce qui est promis aux retraits en attente reste au chaud
      if (!(await this.envoyerEtAttendre(CHAUD, { type: "jeton", actif: d, vers: ch.adresseValable(f.adresse)!, montant }))) throw new Error(`l'envoi d'${d} au froid a été refusé`);
      this.journal(`mis au froid : ${formatUnits(montant, dec)} ${d} vers ${f.adresse}`);
      total += Number(formatUnits(montant, dec));
    }
    return total;
  }

  /* --------------------------------------------------------------- l'état */

  /** Ce que la plateforme tient sur la chaîne : le chaud, le froid et les adresses attribuées, et les XAFe hors de la réserve. */
  async avoirs(rpc: Rpc): Promise<{ usdt: bigint; dollars: Partial<Record<Dollar, bigint>>; xafeEnCirculation: bigint }> {
    const ch = this.chaine;
    const { attribuees } = await rpc("chaine_adresses", { p_reseau: ch.reseau });
    const froid = this.c.froid && ch.adresseValable(this.c.froid.adresse);
    const dollars: Partial<Record<Dollar, bigint>> = {};
    for (const d of this.dollars()) {
      let n = await ch.solde(d, ch.chaud);
      if (froid) n += await ch.solde(d, froid);
      for (const a of (attribuees as Attribuee[]).filter((x) => x.actif === d && x.indice != null)) n += await ch.solde(d, a.adresse);
      dollars[d] = n;
    }
    // en circulation chez les clients : l'offre, moins la réserve que le contrat tient pour les comptes Glisil
    return { usdt: dollars.USDT ?? 0n, dollars, xafeEnCirculation: (await ch.offreXafe()) - (await ch.etatDuJeton()).reserve };
  }

  private async dollarsPublies() {
    const ch = this.chaine;
    const froid = this.c.froid && ch.adresseValable(this.c.froid.adresse);
    const sortie: Record<string, { chaud: number; froid: number | null }> = {};
    for (const d of this.dollars()) {
      sortie[d] = { chaud: Number(formatUnits(await ch.solde(d, ch.chaud), ch.decimales[d])),
                    froid: froid ? Number(formatUnits(await ch.solde(d, froid), ch.decimales[d])) : null };
    }
    return sortie;
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
    // avant les retraits : une frappe vers un wallet au-delà du plafond du jour attendrait (la réserve, elle, n'y compte pas)
    if (this.c.plafondDEssai && await etape("plafond du jour", () => this.c.plafondDEssai!(), false)) {
      this.journal("plafond de frappe du jour réglé au chiffre du propriétaire (clé admin d'essai)");
    }
    const retraits = await etape("retraits", () => this.envoyerRetraits(rpc), { envoyes: 0, confirmes: 0, echoues: 0 });
    const auFroid = await etape("froid", () => this.mettreAuFroid(rpc), 0);
    const reserve = await etape("réserve", () => this.jouerReserve(rpc), { frappees: 0, detruites: 0 });
    const jeton = await etape("lecture du jeton", () => this.lireLeJeton(rpc), null);
    const ch = this.chaine;
    const etatJeton = await etape("état du jeton", () => ch.etatDuJeton(), null);
    const decX = ch.decimales.XAFe;
    await rpc("chaine_publier_etat", {
      p_reseau: ch.reseau,
      p_etat: {
        chaud: ch.chaud,
        usdt_chaud: Number(formatUnits(await ch.solde("USDT", ch.chaud), ch.decimales.USDT)),
        // chaque dollar porté, au chaud et au froid (l'USDT reste aussi à son ancienne place : l'écran d'hier le lit)
        dollars: await this.dollarsPublies(),
        natif_chaud: Number(formatUnits(await ch.solde("natif", ch.chaud), fiche(ch.reseau).decimalesNatif)),
        froid: this.c.froid?.adresse ?? null,
        usdt_froid: this.c.froid && ch.adresseValable(this.c.froid.adresse) ? Number(formatUnits(await ch.solde("USDT", ch.adresseValable(this.c.froid.adresse)!), ch.decimales.USDT)) : null,
        plafond_chaud: this.c.froid?.plafondChaud ?? null,
        garder_chaud: this.c.froid?.garderChaud ?? null,
        // l'admin les inscrit au contrat avec SA clé : `npm run mise-en-service -- inscrire …`
        a_inscrire: adresses.aInscrire,
        alertes: [...this.alertes],
        // la colonne « chaîne » du rapprochement : l'offre et la réserve AU bloc lu (null pendant le rattrapage)
        jeton: jeton && { ...jeton, lu_le: new Date().toISOString() },
        // la réserve, tenue par le contrat ; le plafond de frappe du jour ; la pause ; le stock d'adresses d'avance
        reserve_adresse: ch.reserve,
        reserve_xafe: etatJeton ? Number(formatUnits(etatJeton.reserve, decX)) : null,
        xafe_chaud: jeton?.xafe_chaud != null ? Number(jeton.xafe_chaud) : null,
        plafond_jour: etatJeton ? Number(formatUnits(etatJeton.plafondJour, decX)) : null,
        reste_du_jour: etatJeton ? Number(formatUnits(etatJeton.resteDuJour, decX)) : null,
        en_pause: etatJeton ? etatJeton.enPause : null,
        stock_xafe_ok: adresses.stockOk ?? null,
      },
    }).catch((e) => this.journal(`état non publié : ${(e as Error).message}`));
    return { ...adresses, credites, balayees, ...retraits, auFroid, ...reserve, jeton, alertes: [...this.alertes] };
  }
}

/* ------------------------------------------------------------ le service */

async function principal() {
  const { moteurDepuis, veilleursDepuis } = await import("./service.ts");
  const env = process.env;
  let veilleurs: Veilleur[];
  let rpc: Rpc;
  try { rpc = moteurDepuis(env); veilleurs = await veilleursDepuis(env); } catch (e) { console.error(`✗ ${(e as Error).message}`); process.exit(1); }
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

// lancé par Node (`npm run veilleur`) ; importé ailleurs (la fonction Supabase), il ne démarre rien. Le nom du
// fichier compte aussi : une fois la fonction mise en UN fichier (esbuild), import.meta.url EST le script lancé —
// la fonction de production démarrait alors ce service, sans MOTEUR_URL, et tombait en 503 à chaque appel.
if (typeof process !== "undefined" && /\/veilleur\.ts$/.test(process.argv?.[1] ?? "") && import.meta.url === `file://${process.argv[1]}`) void principal();
