import type { PreuveDeReserve } from "./types";
import type {
  DevisRapide,
  SensRapide,
  Actif,
  Paire,
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
  ResultatOrdre,
  RetraitCrypto,
  Soldes,
  Sortie,
  Transaction,
  TypeOrdre,
  EtatDEntree,
  EnrolementTotp,
  EtatCodesDeSecours,
  OperationAVerifier,
  Verification,
  EtatVerification,
  PreuveDeVerification,
} from "./types";

/** Ce que la session doit savoir sans le demander : la session a été fermée, ou le moteur a refusé une session devenue faible. */
export type EvenementDEntree = "deconnecte" | "aal_perdu";

/**
 * LE GUICHET : tout ce que l'application demande au moteur, et rien d'autre.
 * Deux guichets tiennent ce contrat : `supabase.ts` (le vrai moteur) et
 * `demo.ts` (un moteur en mémoire pour la démonstration et les harnais).
 * Les écrans ne connaissent que ce contrat.
 */
export interface Guichet {
  readonly mode: "supabase" | "demo";

  /* ---- l'entrée : mot de passe (ou Google), code e-mail à l'inscription, application d'authentification, codes de secours */
  session(): Promise<{ compteId: string } | null>;
  /** Où en est la session : ce que dit Supabase Auth, et ce que dit la base (mon_etat_d_entree). */
  etatDEntree(): Promise<EtatDEntree>;
  /** Crée l'utilisateur ; un code à six chiffres part à cette adresse. `dejaInscrit` : l'adresse a déjà un compte. */
  inscrire(p: { email: string; motDePasse: string }): Promise<{ dejaInscrit: boolean; session: boolean }>;
  /** Le code reçu prouve l'adresse ; avec le mot de passe encore en mémoire, la session s'ouvre aussitôt. */
  confirmerEmail(p: { email: string; code: string; motDePasse?: string }): Promise<{ connecte: boolean }>;
  renvoyerConfirmation(email: string): Promise<void>;
  /** Adresse et mot de passe : la session s'ouvre à aal1, il reste le code de l'application. */
  connecter(p: { email: string; motDePasse: string }): Promise<void>;
  /** Google : une redirection dans le navigateur, un onglet du système dans la coque — en direct (l'écran dit « glisil.com ») ou par Supabase. */
  connecterGoogle(): Promise<void>;
  /** Le retour de Google (la page /bienvenue/retour, ou glisil://auth-retour dans la coque) : jeton d'identité ou code, contre la session. */
  terminerRetourOAuth(url: string): Promise<void>;
  /** Un compte Google n'a pas de mot de passe : il en choisit un, qui protège chaque sortie. */
  choisirMotDePasse(motDePasse: string): Promise<void>;
  enrolerDeuxFacteurs(): Promise<EnrolementTotp>;
  confirmerDeuxFacteurs(p: { facteurId: string; code: string }): Promise<void>;
  /** Un code de l'application, sur le facteur déjà enrôlé : la session passe (ou repasse, tout neuf) à aal2. */
  verifierDeuxFacteurs(code: string): Promise<void>;
  /** Dix codes, montrés cette fois seulement ; les anciens ne valent plus rien. */
  genererCodesDeSecours(): Promise<string[]>;
  confirmerCodesDeSecours(): Promise<void>;
  codesDeSecours(): Promise<EtatCodesDeSecours>;
  /** Téléphone perdu : un code de secours retire l'application ; on en enrôlera une nouvelle. */
  utiliserCodeDeSecours(code: string): Promise<void>;
  motDePasseOublie(email: string): Promise<void>;
  verifierCodeDeReinitialisation(p: { email: string; code: string }): Promise<void>;
  /** Le nouveau mot de passe, puis toutes les sessions fermées : on se reconnecte avec lui. */
  nouveauMotDePasse(motDePasse: string): Promise<void>;
  /** Depuis Compte → Sécurité, après un code tout neuf de l'application. `nonce` : le code e-mail, si Auth le demande. */
  changerMotDePasse(p: { nouveau: string; nonce?: string }): Promise<void>;
  /** Changer de téléphone : un nouveau facteur s'enrôle, se vérifie, puis l'ancien est retiré. */
  commencerChangementDeTelephone(): Promise<EnrolementTotp>;
  terminerChangementDeTelephone(p: { facteurId: string; code: string }): Promise<void>;
  seDeconnecter(portee?: "local" | "global"): Promise<void>;
  /** Le temps réel ne s'ouvre qu'à une session complète (aal2) : avant, la base ne montre rien. */
  tempsReel(actif: boolean): void;
  surEntree(cb: (e: EvenementDEntree) => void): () => void;

  /* ---- compte */
  compte(): Promise<Compte>;
  /** Le compte de la personne connectée, ou null si elle n'a pas encore fini son inscription. */
  monCompte(): Promise<Compte | null>;
  /** Ouvre le compte, une fois, avec le profil complet ; la base vérifie tout. */
  ouvrirCompte(p: ProfilInscription): Promise<Compte>;
  /** Le prénom et le nom que Google a donnés, pour préremplir le profil (rien d'autre n'en est lu). */
  nomPropose(): Promise<{ prenom: string; nom: string } | null>;
  /** La langue du compte : celle de ses e-mails, et de l'écran sur un appareil neuf (0037). */
  choisirLangue(l: "fr" | "en"): Promise<void>;
  /** Accepte la version des conditions en vigueur (quand elle a changé depuis l'inscription). */
  accepterConditions(version: string): Promise<Compte>;
  /** Ferme le compte : tout l'argent sorti, rien en cours, avec la vérification avant sortie. */
  fermerCompte(p: { motif: string; preuve: PreuveDeVerification }): Promise<Compte>;

  /* ---- la vérification avant sortie : mot de passe + code e-mail lié à l'opération + code de l'application */
  /** Les mêmes contrôles que l'opération, puis un code part par e-mail. Un nouvel appel remplace le précédent. */
  preparerVerification(op: OperationAVerifier): Promise<Verification>;
  /** L'e-mail est-il parti ? null : la vérification n'est pas sur ce compte. */
  etatVerification(id: string): Promise<EtatVerification | null>;
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
  retirerNumero(p: { id: string; preuve: PreuveDeVerification }): Promise<void>;
  demanderSortie(p: { montant: number; numeroId: string; cle: string; preuve: PreuveDeVerification; nom?: string }): Promise<Sortie>;
  sortie(reference: string): Promise<Sortie>;

  /* ---- marché : deux carnets (0045), USDT/XAFe et USDC/XAFe ; chaque lecture et chaque ordre nomme le sien */
  cotation(paire: Paire): Promise<Cotation>;
  carnet(profondeur: number, paire: Paire): Promise<Carnet>;
  transactions(n: number, paire: Paire): Promise<Transaction[]>;
  chandelles(intervalleMinutes: number, n: number, paire: Paire): Promise<Chandelle[]>;
  /** Les bougies du graphique, `n` au plus, toutes avant `avant` (null : jusqu'à maintenant) — page par page vers le passé. */
  bougies(intervalle: Intervalle, avant: string | null | undefined, n: number | undefined, paire: Paire): Promise<PageDeBougies>;
  /** les ordres des deux carnets ; chacun dit le sien */
  mesOrdres(): Promise<Ordre[]>;
  ordre(id: string): Promise<{ ordre: Ordre; executions: Execution[] }>;
  placerOrdre(p: { cote: Cote; type: TypeOrdre; quantite: number; prix?: number; cle: string; paire: Paire }): Promise<ResultatOrdre>;
  annulerOrdre(id: string): Promise<Ordre>;
  /** ferme = false : une estimation, rien n'est écrit ; true : un prix tenu quelques secondes */
  devisRapide(p: { sens: SensRapide; montant: number; ferme: boolean; paire: Paire }): Promise<DevisRapide>;
  executerDevis(id: string): Promise<DevisRapide>;

  /* ---- crypto */
  adresseDepot(actif: Actif, reseau: Reseau): Promise<string | null>;
  demanderRetraitCrypto(p: { actif: Actif; reseau: Reseau; adresse: string; montant: number; cle: string; preuve: PreuveDeVerification }): Promise<RetraitCrypto>;
  retraitCrypto(reference: string): Promise<RetraitCrypto>;

  /* ---- historique */
  historique(): Promise<Operation[]>;
  operation(reference: string): Promise<Operation | null>;

  /* ---- temps réel : appelle `cb` dès que quelque chose a bougé pour ce compte */
  surChangement(cb: () => void): () => void;
}
