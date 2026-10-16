/*
 * Le vrai moteur : connexion par e-mail et code à six chiffres (Supabase Auth,
 * sans mot de passe), puis
 * les RPC admin_* — chacune gardée en base par admin_a_droit().
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GuichetAdmin } from "./guichet";
import type { Client, ClientDetail, Declaration, Entree, LigneJournal, Marche, Parametres, Profil, Retenue, Sortie, StatsClients, Tableau, Terminal, Wallets } from "./types";

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
  async annulerSortie(reference: string, note: string) {
    const r = await this.rpc<{ rendu: number; etat: string }>("admin_annuler_sortie", { p_reference: reference, p_note: note });
    return { rendu: Number(r.rendu), etat: String(r.etat) };
  }
  terminaux() { return this.rpc<Terminal[]>("admin_terminaux"); }
  creerTerminal({ id, nom, lieu }: { id: string; nom: string; lieu: string }) { return this.rpc<{ id: string; cle: string }>("admin_creer_terminal", { p_id: id, p_nom: nom, p_lieu: lieu }); }
  renouvelerCle(id: string) { return this.rpc<{ cle: string }>("admin_renouveler_cle", { p_id: id }); }
  async creerFloat({ operateur, numero, terminal, codeAgent }: { operateur: string; numero: string; terminal: string; codeAgent?: string | null }) {
    await this.rpc("admin_creer_float", { p_operateur: operateur, p_numero: numero, p_terminal: terminal, p_code_agent: codeAgent ?? null });
  }
  async activerFloat(id: number, actif: boolean) { await this.rpc("admin_activer_float", { p_id: id, p_actif: actif }); }
  statistiquesClients() { return this.rpc<StatsClients>("admin_statistiques_clients"); }
  clients(recherche?: string, filtre?: string | null) { return this.rpc<Client[]>("admin_clients", { p_recherche: recherche ?? null, p_n: 200, p_filtre: filtre ?? null }); }
  client(id: string) { return this.rpc<ClientDetail>("admin_client", { p_id: id }); }
  async changerPalier(id: string, palier: number, note?: string) { await this.rpc("admin_changer_palier", { p_id: id, p_palier: palier, p_note: note ?? null }); }
  validerVerification(id: string, ok: boolean, note?: string) { return this.rpc<{ palier: number }>("admin_valider_verification", { p_id: id, p_ok: ok, p_note: note ?? null }); }
  async desactiverCompte(id: string, actif: boolean, note?: string) { await this.rpc("admin_desactiver_compte", { p_id: id, p_actif: actif, p_note: note ?? null }); }
  marche() { return this.rpc<Marche>("admin_marche"); }
  parametres() { return this.rpc<Parametres>("admin_parametres"); }
  async modifierParametre(cle: string, valeur: unknown) { await this.rpc("admin_modifier_parametre", { p_cle: cle, p_valeur: valeur }); }
  journal() { return this.rpc<LigneJournal[]>("admin_journal", { p_n: 200 }); }
  wallets() { return this.rpc<Wallets>("admin_wallets"); }

  surChangement(cb: () => void) { this.auditeurs.add(cb); return () => { this.auditeurs.delete(cb); }; }
}
