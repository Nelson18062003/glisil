import type {
  Actif,
  Carnet,
  Chandelle,
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

  /* ---- session */
  session(): Promise<{ compteId: string } | null>;
  demanderCode(telephone: string): Promise<void>;
  verifierCodeSms(telephone: string, code: string): Promise<{ compteId: string; nouveau: boolean }>;
  seDeconnecter(): Promise<void>;

  /* ---- compte */
  compte(): Promise<Compte>;
  completerProfil(p: { nom: string; codeSecret: string }): Promise<Compte>;
  verifierCodeSecret(code: string): Promise<ResultatCode>;
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
  declarerTransaction(p: { reference: string; transactionId: string }): Promise<Declaration>;
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
  retirerNumero(p: { id: string; codeSecret: string }): Promise<void>;
  demanderSortie(p: { montant: number; numeroId: string; cle: string; codeSecret: string }): Promise<Sortie>;
  sortie(reference: string): Promise<Sortie>;

  /* ---- marché */
  cotation(): Promise<Cotation>;
  carnet(profondeur: number): Promise<Carnet>;
  transactions(n: number): Promise<Transaction[]>;
  chandelles(intervalleMinutes: number, n: number): Promise<Chandelle[]>;
  mesOrdres(): Promise<Ordre[]>;
  ordre(id: string): Promise<{ ordre: Ordre; executions: Execution[] }>;
  placerOrdre(p: { cote: Cote; type: TypeOrdre; quantite: number; prix?: number; cle: string }): Promise<ResultatOrdre>;
  annulerOrdre(id: string): Promise<Ordre>;

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
