import type { Client, ClientDetail, Declaration, Entree, LigneJournal, Marche, Parametres, Profil, Retenue, Sortie, Tableau, Terminal, Wallets } from "./types";

/** LE GUICHET DE L'ADMINISTRATION : tout ce que les écrans demandent au moteur. */
export interface GuichetAdmin {
  readonly mode: "supabase" | "demo";

  session(): Promise<Profil | null>;
  connecter(email: string, motDePasse: string): Promise<Profil>;
  deconnecter(): Promise<void>;

  tableau(): Promise<Tableau>;

  entrees(etat?: string | null): Promise<Entree[]>;
  retenues(etat?: "retenue" | "rapprochee" | "remboursee"): Promise<Retenue[]>;
  rapprocher(id: number, reference: string): Promise<Declaration>;
  rembourser(id: number, note: string): Promise<{ montant: number; numero: string }>;

  sorties(etat?: string | null): Promise<Sortie[]>;
  libererCommande(id: number): Promise<void>;
  /** Donner un transfert EN ATTENTE à un autre boîtier qui porte une carte du même opérateur. */
  reaffecterCommande(id: number, terminal: string): Promise<void>;
  /** Annuler ce qui n'est pas encore parti d'une sortie : ses XAFe reviennent au client. */
  annulerSortie(reference: string, note: string): Promise<{ rendu: number; etat: string }>;

  terminaux(): Promise<Terminal[]>;
  creerTerminal(p: { id: string; nom: string; lieu: string }): Promise<{ id: string; cle: string }>;
  renouvelerCle(id: string): Promise<{ cle: string }>;
  creerFloat(p: { operateur: string; numero: string; terminal: string; codeAgent?: string | null }): Promise<void>;
  activerFloat(id: number, actif: boolean): Promise<void>;

  /** filtre = "verifications" : les pièces qui attendent l'équipe, cherchées dans TOUS les comptes. */
  clients(recherche?: string, filtre?: string | null): Promise<Client[]>;
  client(id: string): Promise<ClientDetail>;
  changerPalier(id: string, palier: number, note?: string): Promise<void>;
  validerVerification(id: string, ok: boolean, note?: string): Promise<{ palier: number }>;
  desactiverCompte(id: string, actif: boolean, note?: string): Promise<void>;

  marche(): Promise<Marche>;
  parametres(): Promise<Parametres>;
  modifierParametre(cle: string, valeur: unknown): Promise<void>;
  journal(): Promise<LigneJournal[]>;
  /** Les wallets de la plateforme : ce que le veilleur de chaîne voit, et ce qu'on doit en face. */
  wallets(): Promise<Wallets>;

  surChangement(cb: () => void): () => void;
}
