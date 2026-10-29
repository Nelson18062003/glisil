import type { Parite } from "./types";
import type { EtatAuth } from "../noyau/entree";
import type { SecuriteUtilisateur } from "./types";

/** Ce que l'application d'authentification doit recevoir : la clé, en lien (otpauth://), en texte et en image. */
export type Enrolement = { facteurId: string; secret: string; uri: string; qr: string };
import type { ATraiter, Client, ClientDetail, Declaration, Entree, LigneJournal, Marche, Parametres, Profil, Retenue, Sortie, SortieNonExpliquee, StatsClients, Equipe, Tableau, Terminal, Wallets, ReseauRegistre, Beta, Signalement } from "./types";

/** LE GUICHET DE L'ADMINISTRATION : tout ce que les écrans demandent au moteur. */
export interface GuichetAdmin {
  readonly mode: "supabase" | "demo";

  /** Le profil, seulement pour une session complète (mot de passe + application d'authentification). */
  session(): Promise<Profil | null>;

  /* ---- l'entrée (0035) : mot de passe, code e-mail à la première fois, application d'authentification, codes de secours */
  /** Où en est la session, d'après Auth et la base (mon_etat_d_entree). */
  etatAuth(): Promise<EtatAuth>;
  connecter(email: string, motDePasse: string): Promise<void>;
  /** Une adresse invitée choisit son mot de passe ; un code part pour confirmer l'adresse. */
  premiereConnexion(email: string, motDePasse: string): Promise<void>;
  /** Le code reçu à la première connexion ; on entre aussitôt avec le mot de passe encore en mémoire. */
  confirmerEmail(email: string, code: string, motDePasse: string | null): Promise<void>;
  renvoyerConfirmation(email: string): Promise<void>;
  enrolerDeuxFacteurs(): Promise<Enrolement>;
  confirmerDeuxFacteurs(facteurId: string, code: string): Promise<void>;
  verifierDeuxFacteurs(code: string): Promise<void>;
  genererCodesDeSecours(): Promise<string[]>;
  confirmerCodesDeSecours(): Promise<void>;
  /** Téléphone perdu : un code de secours retire l'application (fonction deux-facteurs) ; on en enrôle une nouvelle. */
  utiliserCodeDeSecours(code: string): Promise<void>;
  motDePasseOublie(email: string): Promise<void>;
  verifierCodeDeReinitialisation(email: string, code: string): Promise<void>;
  /** Le nouveau mot de passe, puis toutes les sessions fermées : on rentre avec lui. */
  nouveauMotDePasse(motDePasse: string): Promise<void>;
  /** La session est complète : une adresse invitée devient administrateur ici ; une autre est refusée (et la session fermée). */
  entrer(): Promise<Profil>;
  deconnecter(portee?: "local" | "global"): Promise<void>;

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
  /** La double authentification d'une personne : active, codes restants, ce qui s'est passé. */
  securite(utilisateur: string): Promise<SecuriteUtilisateur>;
  /** Super admin : après avoir vérifié l'identité, retirer l'application d'une personne (le motif dit comment). */
  reinitialiserDeuxFacteurs(utilisateur: string, motif: string): Promise<{ facteurs: number }>;
  changerPalier(id: string, palier: number, note?: string): Promise<void>;
  /** La bêta : donner de l'argent de test à un compte (droit « parametres ») ; refusé hors bêta. */
  doter(id: string, xafe: number, usdt: number, motif?: string): Promise<{ reference: string }>;
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

  /** La bêta (0021–0024) : testeurs, argent de test, robots, vrai dollar, signalements. */
  beta(): Promise<Beta>;
  signalements(etat?: Signalement["etat"] | null): Promise<Signalement[]>;
  /** Marquer un signalement vu ou réglé (droit « clients ») ; la note reste avec lui. */
  traiterSignalement(id: number, etat: Signalement["etat"], note?: string): Promise<void>;
  /** Relever le vrai dollar tout de suite (il se relève seul toutes les heures). */
  releverLeCours(): Promise<{ pose: boolean; erreur?: string | null }>;
  /** Poser à la main un cours EUR/USD vérifié : confirme un saut que le relevé a refusé. */
  poserLeCours(eurUsd: number): Promise<{ prix: number }>;

  surChangement(cb: () => void): () => void;
}
