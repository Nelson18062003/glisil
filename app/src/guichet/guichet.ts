import type { PreuveDeReserve } from "./types";
import type {
  DevisRapide,
  SensRapide,
  Actif,
  Carnet,
  Chandelle,
  Intervalle,
  PageDeBougies,
  Compte,
  Cote,
  Cotation,
  Declaration,
  Depot,
  Execution,
  IdOperateur,
  Notification,
  Numero,
  Operation,
  ProfilInscription,
  Ordre,
  Reseau,
  ResultatCode,
  ResultatOrdre,
  RetraitCrypto,
  Soldes,
  Sortie,
  Transaction,
  TypeOrdre,
} from "./types";

/**
 * LE GUICHET : tout ce que l'application demande au moteur, et rien d'autre.
 * Deux guichets tiennent ce contrat : `supabase.ts` (le vrai moteur) et
 * `demo.ts` (un moteur en mémoire pour la démonstration et les harnais).
 * Les écrans ne connaissent que ce contrat.
 */
export interface Guichet {
  readonly mode: "supabase" | "demo";

  /* ---- session : une adresse e-mail et un code reçu par e-mail, pas de mot de passe */
  session(): Promise<{ compteId: string } | null>;
  /** Envoie un code à six chiffres à cette adresse ; une adresse inconnue crée l'utilisateur. */
  demanderCode(email: string): Promise<void>;
  /** Le code prouve l'adresse ; `nouveau` : la personne n'a pas encore ouvert son compte. */
  verifierCode(email: string, code: string): Promise<{ nouveau: boolean }>;
  seDeconnecter(): Promise<void>;

  /* ---- compte */
  compte(): Promise<Compte>;
  /** Le compte de la personne connectée, ou null si elle n'a pas encore fini son inscription. */
  monCompte(): Promise<Compte | null>;
  /** Ouvre le compte, une fois, avec le profil complet ; la base vérifie tout. */
  ouvrirCompte(p: ProfilInscription): Promise<Compte>;
  /** Le code secret des gestes d'argent ; `nom` est celui que les reçus montrent. */
  completerProfil(p: { nom: string; codeSecret: string }): Promise<Compte>;
  verifierCodeSecret(code: string): Promise<ResultatCode>;
  /** Accepte la version des conditions en vigueur (quand elle a changé depuis l'inscription). */
  accepterConditions(version: string): Promise<Compte>;
  /** Ferme le compte : tout l'argent sorti, rien en cours, avec le code secret. */
  fermerCompte(p: { codeSecret: string; motif: string }): Promise<Compte>;
  changerCodeSecret(p: { ancien: string; nouveau: string }): Promise<void>;
  /** les pièces d'un passage de palier ; l'équipe vérifie, l'état se lit dans `compte.verificationEnCours` */
  demanderVerification(p: { type: "identite" | "entreprise"; pieces: File[] }): Promise<Compte>;
  notifications(): Promise<Notification[]>;
  marquerLues(): Promise<void>;

  /* ---- soldes */
  soldes(): Promise<Soldes>;

  /* ---- entrer des XAF : on paie le float, puis on tape le transaction ID du SMS */
  ouvrirDepot(p: { operateur: IdOperateur; cle: string }): Promise<Depot>;
  depot(reference: string): Promise<Depot>;
  /** Un paiement fait : son transaction ID, le numéro qui a payé, le montant exact, le nom du titulaire.
   *  Redéclarer le même ID corrige une déclaration refusée pour un écart. */
  declarerTransaction(p: { reference: string; transactionId: string; numero: string; montant: number; nom: string }): Promise<Declaration>;
  /** Retirer un ID mal recopié, tant qu'il attend son SMS. */
  retirerDeclaration(p: { reference: string; transactionId: string }): Promise<Depot>;
  terminerDepot(reference: string): Promise<Depot>;
  annulerDepot(reference: string): Promise<Depot>;
  depotsEnAttente(): Promise<Depot[]>;

  /* ---- numéros et sorties */
  numeros(): Promise<Numero[]>;
  ajouterNumero(p: { operateur: IdOperateur; numero: string }): Promise<Numero>;
  confirmerNumero(p: { id: string; code: string }): Promise<Numero>;
  /** Un nouveau code SMS pour un numéro pas encore vérifié (une minute entre deux). */
  renvoyerCodeNumero(id: string): Promise<Numero>;
  /** Les frais, pas et plafonds posés par l'équipe (parametres_publics) ; null s'ils ne se lisent pas. */
  parametres(): Promise<unknown>;
  /** La bêta : dire un problème à l'équipe, depuis l'écran où il est arrivé (0024). Vingt par jour au plus. */
  signalerUnProbleme(p: { texte: string; ecran?: string | null }): Promise<{ reference: string }>;
  /** La preuve de réserve : floats, registre, chaîne — publique, elle se lit SANS compte. */
  preuveDeReserve(): Promise<PreuveDeReserve>;
  retirerNumero(p: { id: string; codeSecret: string }): Promise<void>;
  demanderSortie(p: { montant: number; numeroId: string; cle: string; codeSecret: string; nom?: string }): Promise<Sortie>;
  sortie(reference: string): Promise<Sortie>;

  /* ---- marché */
  cotation(): Promise<Cotation>;
  carnet(profondeur: number): Promise<Carnet>;
  transactions(n: number): Promise<Transaction[]>;
  chandelles(intervalleMinutes: number, n: number): Promise<Chandelle[]>;
  /** Les bougies du graphique, `n` au plus, toutes avant `avant` (null : jusqu'à maintenant) — page par page vers le passé. */
  bougies(intervalle: Intervalle, avant?: string | null, n?: number): Promise<PageDeBougies>;
  mesOrdres(): Promise<Ordre[]>;
  ordre(id: string): Promise<{ ordre: Ordre; executions: Execution[] }>;
  placerOrdre(p: { cote: Cote; type: TypeOrdre; quantite: number; prix?: number; cle: string }): Promise<ResultatOrdre>;
  annulerOrdre(id: string): Promise<Ordre>;
  /** ferme = false : une estimation, rien n'est écrit ; true : un prix tenu quelques secondes */
  devisRapide(p: { sens: SensRapide; montant: number; ferme: boolean }): Promise<DevisRapide>;
  executerDevis(id: string): Promise<DevisRapide>;

  /* ---- crypto */
  adresseDepot(actif: Actif, reseau: Reseau): Promise<string | null>;
  demanderRetraitCrypto(p: { actif: Actif; reseau: Reseau; adresse: string; montant: number; cle: string; codeSecret: string }): Promise<RetraitCrypto>;
  retraitCrypto(reference: string): Promise<RetraitCrypto>;

  /* ---- historique */
  historique(): Promise<Operation[]>;
  operation(reference: string): Promise<Operation | null>;

  /* ---- temps réel : appelle `cb` dès que quelque chose a bougé pour ce compte */
  surChangement(cb: () => void): () => void;
}
