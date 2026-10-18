/*
 * Le vrai moteur : connexion par e-mail et code à six chiffres (Supabase Auth,
 * sans mot de passe), puis
 * les RPC admin_* — chacune gardée en base par admin_a_droit().
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GuichetAdmin } from "./guichet";
import type { ATraiter, Client, ClientDetail, Declaration, Entree, LigneJournal, Marche, Parametres, Profil, Retenue, Sortie, SortieNonExpliquee, StatsClients, Equipe, Tableau, Terminal, Wallets, ReseauRegistre, Beta, Signalement } from "./types";
import type { Parite } from "./types";
import { verifierPreuve } from "./preuve";

export class ErreurMoteur extends Error {
  detail?: string;
  constructor(message: string, detail?: string) { super(message); this.detail = detail; }
}

export class GuichetSupabase implements GuichetAdmin {
  readonly mode = "supabase" as const;
  private sb: SupabaseClient;
  private auditeurs = new Set<() => void>();

  constructor(url: string, cleAnon: string) {
    this.sb = createClient(url, cleAnon, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "xafe-admin-auth" } });
    this.sb.auth.onAuthStateChange(() => { for (const cb of this.auditeurs) cb(); });
  }

  private async rpc<T>(nom: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.sb.rpc(nom, args);
    if (error) throw new ErreurMoteur(error.message, error.details || undefined);
    return data as T;
  }

  async session() {
    const { data } = await this.sb.auth.getSession();
    if (!data.session) return null;
    return (await this.rpc<Profil | null>("mon_profil_admin")) ?? null;
  }
  async demanderCode(email: string) {
    const { error } = await this.sb.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true } });
    if (error) throw new ErreurMoteur(/rate limit|too many|seconds/i.test(error.message) ? "trop de codes demandés : attendez une minute" : error.message);
  }
  async verifierCode(email: string, code: string) {
    const { error } = await this.sb.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: "email" });
    if (error) throw new ErreurMoteur("code incorrect ou expiré");
    /* l'invitation devient la fiche d'administrateur ici, au premier passage */
    const p = await this.rpc<Profil | null>("entrer_administration");
    if (!p) { await this.sb.auth.signOut(); throw new ErreurMoteur("cette adresse n'administre pas Glisil", "demandez au super administrateur de vous inviter"); }
    return p;
  }
  async deconnecter() { await this.sb.auth.signOut(); }

  tableau() { return this.rpc<Tableau>("admin_tableau"); }
  entrees(etat?: string | null) { return this.rpc<Entree[]>("admin_entrees", { p_etat: etat ?? null, p_n: 200 }); }
  retenues(etat: "retenue" | "rapprochee" | "remboursee" = "retenue") { return this.rpc<Retenue[]>("admin_retenues", { p_etat: etat, p_n: 200 }); }
  rapprocher(id: number, reference: string) { return this.rpc<Declaration>("admin_rapprocher_retenue", { p_id: id, p_reference: reference }); }
  rembourser(id: number, note: string) { return this.rpc<{ montant: number; numero: string }>("admin_rembourser_retenue", { p_id: id, p_note: note }); }
  sorties(etat?: string | null) { return this.rpc<Sortie[]>("admin_sorties", { p_etat: etat ?? null, p_n: 200 }); }
  async libererCommande(id: number) { await this.rpc("admin_liberer_commande", { p_id: id }); }
  async reaffecterCommande(id: number, terminal: string) { await this.rpc("admin_reaffecter_commande", { p_id: id, p_terminal: terminal }); }
  async prendreSortie(reference: string) { await this.rpc("admin_prendre_sortie", { p_reference: reference }); }
  payerSortie(reference: string, transactionId: string, preuve: string | null) {
    return this.rpc<{ etat: string; a_confirmer?: boolean; rapprochement?: Sortie["rapprochement"] }>("admin_payer_sortie", { p_reference: reference, p_transaction_id: transactionId, p_preuve: preuve });
  }
  confirmerSortie(reference: string) { return this.rpc<{ etat: string; rapprochement?: Sortie["rapprochement"] }>("admin_confirmer_sortie", { p_reference: reference }); }
  async refuserSortie(reference: string, motif: string) { await this.rpc("admin_refuser_sortie", { p_reference: reference, p_motif: motif }); }
  async deposerPreuve(reference: string, fichier: File) {
    const ext = verifierPreuve(fichier);
    const chemin = `${reference}/${Date.now()}.${ext}`;
    const { error } = await this.sb.storage.from("preuves-sorties").upload(chemin, fichier, { contentType: fichier.type, upsert: false });
    if (error) throw new ErreurMoteur("la capture n'a pas pu être déposée", error.message);
    return chemin;
  }
  async lienPreuve(chemin: string) {
    const { data, error } = await this.sb.storage.from("preuves-sorties").createSignedUrl(chemin, 600);
    if (error || !data) throw new ErreurMoteur("capture introuvable", error?.message);
    return data.signedUrl;
  }
  sortiesNonExpliquees() { return this.rpc<SortieNonExpliquee[]>("admin_sorties_non_expliquees", { p_n: 100 }); }
  aTraiter() { return this.rpc<ATraiter>("admin_a_traiter"); }
  async annulerSortie(reference: string, note: string) {
    const r = await this.rpc<{ rendu: number; etat: string }>("admin_annuler_sortie", { p_reference: reference, p_note: note });
    return { rendu: Number(r.rendu), etat: String(r.etat) };
  }
  terminaux() { return this.rpc<Terminal[]>("admin_terminaux"); }
  creerTerminal({ id, nom, lieu }: { id: string; nom: string; lieu: string }) { return this.rpc<{ id: string; cle: string }>("admin_creer_terminal", { p_id: id, p_nom: nom, p_lieu: lieu }); }
  renouvelerCle(id: string) { return this.rpc<{ cle: string }>("admin_renouveler_cle", { p_id: id }); }
  async creerFloat({ operateur, numero, terminal, codeAgent, titulaire }: { operateur: string; numero: string; terminal: string; codeAgent?: string | null; titulaire?: string | null }) {
    await this.rpc("admin_creer_float", { p_operateur: operateur, p_numero: numero, p_terminal: terminal, p_code_agent: codeAgent ?? null, p_titulaire: titulaire ?? null });
  }
  async activerFloat(id: number, actif: boolean) { await this.rpc("admin_activer_float", { p_id: id, p_actif: actif }); }
  statistiquesClients() { return this.rpc<StatsClients>("admin_statistiques_clients"); }
  clients(recherche?: string, filtre?: string | null) { return this.rpc<Client[]>("admin_clients", { p_recherche: recherche ?? null, p_n: 200, p_filtre: filtre ?? null }); }
  client(id: string) { return this.rpc<ClientDetail>("admin_client", { p_id: id }); }
  async doter(id: string, xafe: number, usdt: number, motif?: string) { return this.rpc<{ reference: string }>("admin_doter", { p_compte: id, p_xafe: xafe, p_usdt: usdt, p_motif: motif ?? null }); }
  async changerPalier(id: string, palier: number, note?: string) { await this.rpc("admin_changer_palier", { p_id: id, p_palier: palier, p_note: note ?? null }); }
  validerVerification(id: string, ok: boolean, note?: string) { return this.rpc<{ palier: number }>("admin_valider_verification", { p_id: id, p_ok: ok, p_note: note ?? null }); }
  async desactiverCompte(id: string, actif: boolean, note?: string) { await this.rpc("admin_desactiver_compte", { p_id: id, p_actif: actif, p_note: note ?? null }); }
  equipe() { return this.rpc<Equipe>("admin_equipe"); }
  async inviterAdministrateur({ email, nom, role }: { email: string; nom: string; role: string }) { await this.rpc("admin_inviter_administrateur", { p_email: email, p_nom: nom, p_role: role }); }
  async retirerInvitation(email: string) { await this.rpc("admin_retirer_invitation", { p_email: email }); }
  async changerRole(id: string, role: string) { await this.rpc("admin_changer_role", { p_id: id, p_role: role }); }
  async activerAdministrateur(id: string, actif: boolean) { await this.rpc("admin_desactiver_administrateur", { p_id: id, p_actif: actif }); }
  marche() { return this.rpc<Marche>("admin_marche"); }
  parametres() { return this.rpc<Parametres>("admin_parametres"); }
  async modifierParametre(cle: string, valeur: unknown) { await this.rpc("admin_modifier_parametre", { p_cle: cle, p_valeur: valeur }); }
  journal() { return this.rpc<LigneJournal[]>("admin_journal", { p_n: 200 }); }
  wallets() { return this.rpc<Wallets>("admin_wallets"); }
  reseaux() { return this.rpc<ReseauRegistre[]>("admin_reseaux"); }
  async activerReseau(id: string, actif: boolean) { await this.rpc("admin_activer_reseau", { p_id: id, p_actif: actif }); }
  parite() { return this.rpc<Parite>("admin_parite"); }
  async rapprocherMaintenant() { await this.rpc("admin_rapprocher_maintenant"); }
  async saisirReleve(floatId: number, solde: number, annonceLe: string, preuve: string, note?: string) {
    await this.rpc("admin_saisir_releve", { p_float: floatId, p_solde: solde, p_annonce_le: annonceLe, p_preuve: preuve, p_note: note ?? null });
  }
  async deposerReleve(floatId: number, fichier: File) {
    const ext = verifierPreuve(fichier);
    const chemin = `${floatId}/${Date.now()}.${ext}`;
    const { error } = await this.sb.storage.from("releves-floats").upload(chemin, fichier, { contentType: fichier.type, upsert: false });
    if (error) throw new ErreurMoteur("le relevé n'a pas pu être déposé", error.message);
    return chemin;
  }
  async lienReleve(chemin: string) {
    const { data, error } = await this.sb.storage.from("releves-floats").createSignedUrl(chemin, 600);
    if (error || !data) throw new ErreurMoteur("relevé introuvable", error?.message);
    return data.signedUrl;
  }

  beta() { return this.rpc<Beta>("admin_beta"); }
  signalements(etat?: Signalement["etat"] | null) { return this.rpc<Signalement[]>("admin_signalements", { p_etat: etat ?? null, p_limite: 200 }); }
  async traiterSignalement(id: number, etat: Signalement["etat"], note?: string) { await this.rpc("admin_traiter_signalement", { p_id: id, p_etat: etat, p_note: note ?? null }); }
  releverLeCours() { return this.rpc<{ pose: boolean; erreur?: string | null }>("admin_relever_le_cours"); }
  poserLeCours(eurUsd: number) { return this.rpc<{ prix: number }>("admin_poser_le_cours", { p_eur_usd: eurUsd }); }

  surChangement(cb: () => void) { this.auditeurs.add(cb); return () => { this.auditeurs.delete(cb); }; }
}
