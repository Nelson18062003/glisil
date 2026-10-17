import type { Parite } from "./types";
import type { ATraiter, Client, ClientDetail, Declaration, Entree, LigneJournal, Marche, Parametres, Profil, Retenue, Sortie, SortieNonExpliquee, StatsClients, Equipe, Tableau, Terminal, Wallets, ReseauRegistre } from "./types";

/** LE GUICHET DE L'ADMINISTRATION : tout ce que les écrans demandent au moteur. */
export interface GuichetAdmin {
  readonly mode: "supabase" | "demo";

  session(): Promise<Profil | null>;
  /** Pas de mot de passe : un code à six chiffres part à cette adresse. */
  demanderCode(email: string): Promise<void>;
  /** Le code prouve l'adresse ; une adresse invitée devient administrateur ici. Refuse une adresse qui n'administre pas. */
  verifierCode(email: string, code: string): Promise<Profil>;
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
  /** Les remboursements payés à la main (0014). */
  prendreSortie(reference: string): Promise<void>;
  /** L'ID du paiement fait, et la capture déjà déposée. Au-delà du seuil, la sortie attend une autre personne. */
  payerSortie(reference: string, transactionId: string, preuve: string | null): Promise<{ etat: string; a_confirmer?: boolean; rapprochement?: Sortie["rapprochement"] }>;
  confirmerSortie(reference: string): Promise<{ etat: string; rapprochement?: Sortie["rapprochement"] }>;
  refuserSortie(reference: string, motif: string): Promise<void>;
  /** Déposer la capture d'un paiement : image ou PDF, 10 Mo au plus ; rend son chemin. */
  deposerPreuve(reference: string, fichier: File): Promise<string>;
  /** Un lien de dix minutes vers une capture. */
  lienPreuve(chemin: string): Promise<string>;
  sortiesNonExpliquees(): Promise<SortieNonExpliquee[]>;
  aTraiter(): Promise<ATraiter>;

  terminaux(): Promise<Terminal[]>;
  creerTerminal(p: { id: string; nom: string; lieu: string }): Promise<{ id: string; cle: string }>;
  renouvelerCle(id: string): Promise<{ cle: string }>;
  creerFloat(p: { operateur: string; numero: string; terminal: string; codeAgent?: string | null; titulaire?: string | null }): Promise<void>;
  activerFloat(id: number, actif: boolean): Promise<void>;

  /** Les chiffres d'ensemble : total, actifs, connectés, nouveaux, inscriptions inachevées… */
  statistiquesClients(): Promise<StatsClients>;
  /** filtre : null (tous) · actifs · inactifs · nouveaux · verifications · desactives — cherchés dans TOUS les comptes. */
  clients(recherche?: string, filtre?: string | null): Promise<Client[]>;
  client(id: string): Promise<ClientDetail>;
  changerPalier(id: string, palier: number, note?: string): Promise<void>;
  validerVerification(id: string, ok: boolean, note?: string): Promise<{ palier: number }>;
  desactiverCompte(id: string, actif: boolean, note?: string): Promise<void>;

  /** L'équipe : le droit « administrateurs » seulement (le super admin). */
  equipe(): Promise<Equipe>;
  inviterAdministrateur(p: { email: string; nom: string; role: string }): Promise<void>;
  retirerInvitation(email: string): Promise<void>;
  changerRole(id: string, role: string): Promise<void>;
  activerAdministrateur(id: string, actif: boolean): Promise<void>;

  marche(): Promise<Marche>;
  parametres(): Promise<Parametres>;
  modifierParametre(cle: string, valeur: unknown): Promise<void>;
  journal(): Promise<LigneJournal[]>;
  /** Les wallets de la plateforme : ce que le veilleur de chaîne voit, et ce qu'on doit en face. */
  wallets(): Promise<Wallets>;
  /** Le registre des réseaux : lesquels sont ouverts aux clients, lesquels pourraient l'être. */
  reseaux(): Promise<ReseauRegistre[]>;
  /** Ouvrir ou fermer un réseau aux clients (droit « parametres ») : le moteur refuse ce qui n'est pas prêt. */
  activerReseau(id: string, actif: boolean): Promise<void>;

  /** La parité à trois colonnes (0016) : floats, registre, chaîne — et chaque ligne rapprochée. */
  parite(): Promise<Parite>;
  /** Refaire le relevé tout de suite (il se fait seul toutes les cinq minutes). */
  rapprocherMaintenant(): Promise<void>;
  /** Le solde du relevé officiel de l'opérateur, avec son fichier déjà déposé. */
  saisirReleve(floatId: number, solde: number, annonceLe: string, preuve: string, note?: string): Promise<void>;
  /** Déposer le relevé d'un opérateur : image ou PDF, 10 Mo au plus ; rend son chemin. */
  deposerReleve(floatId: number, fichier: File): Promise<string>;
  lienReleve(chemin: string): Promise<string>;

  surChangement(cb: () => void): () => void;
}
