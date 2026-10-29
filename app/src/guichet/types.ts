/*
 * Les objets que les écrans manipulent. Ce sont les lignes du moteur, telles
 * que ses RPC les rendent (_depot_json, _sortie_json, _ordre_json…), nommées
 * en français comme dans la base.
 */

export type Actif = "XAFe" | "USDT";
export type IdOperateur = "mtn" | "om";
/** L'identifiant d'un réseau du registre (bep20, trc20, base…) : la liste vient du moteur (0018). */
export type Reseau = string;

export type Compte = {
  id: string;
  /** au format international (+237677123456) ; un compte ancien garde son numéro local */
  telephone: string;
  /** prénom et nom réunis, tels que les reçus les montrent */
  nom: string | null;
  email: string | null;
  prenom: string | null;
  nomDeFamille: string | null;
  /** AAAA-MM-JJ */
  dateNaissance: string | null;
  ville: string | null;
  /** code ISO à deux lettres (CM, GA, FR…) */
  pays: string | null;
  entreprise: string | null;
  palier: 0 | 1 | 2;
  verificationEnCours: "identite" | "entreprise" | null;
  /** XAF déjà crédités aujourd'hui (journée de Douala) : ce qui reste du plafond s'en déduit */
  entreDuJour: number;
  /** la version des conditions acceptée est celle en vigueur ; sinon, à relire avant de continuer */
  conditionsAJour: boolean;
  /** fermé par son titulaire : plus aucun geste, l'équipe peut le rouvrir */
  fermeLe: string | null;
  /** suspendu par l'équipe (ou fermé) */
  desactive: boolean;
};

/** Ce que la personne donne pour ouvrir son compte : tout est obligatoire. */
export type ProfilInscription = {
  prenom: string;
  nom: string;
  /** AAAA-MM-JJ */
  naissance: string;
  /** au format international */
  telephone: string;
  ville: string;
  pays: string;
  /** la version des conditions lues et acceptées (VERSION_CONDITIONS) */
  conditions: string;
};

export type Soldes = Record<Actif, { disponible: number; bloque: number }>;

export type Numero = {
  id: string;
  operateur: IdOperateur;
  numero: string;
  verifieLe: string | null;
  actifDes: string;
  retireLe: string | null;
};

export type EtatDepot = "en_attente" | "credite" | "annule" | "expire";
export type EtatDeclaration = "attendu" | "credite" | "refuse";
/** Un transaction ID que le client a tapé, et ce que TOTEM en a trouvé. */
export type Declaration = {
  id: string;
  transactionId: string;
  etat: EtatDeclaration;
  /** le montant lu dans le SMS du float, quand il est trouvé */
  montant: number | null;
  numeroPayeur: string | null;
  motif: string | null;
  declareLe: string;
  crediteLe: string | null;
  /** quand TOTEM a lu le SMS qui a payé */
  luLe?: string | null;
  /** ce que le client a déclaré : le numéro qui a payé, le montant exact, le nom */
  numeroDeclare?: string | null;
  montantDeclare?: number | null;
  nomDeclare?: string | null;
  /** refusée pour un écart (numéro ou montant) : le client peut corriger */
  corrigible?: boolean;
};
export type Depot = {
  reference: string;
  operateur: IdOperateur;
  floatNumero: string;
  /** le nom que le client lit sur son téléphone avant de confirmer : s'il en lit un autre, il ne paie pas */
  titulaire: string | null;
  codeAgent: string | null;
  /** Le numéro reçoit-il ENCORE ? « retardee » : son boîtier se tait, le
   *  crédit attendra son retour ; « fermee » : l'équipe a retiré ce float,
   *  on ne paie plus à ce numéro (un paiement déjà fait reste traité). */
  reception: "ouverte" | "retardee" | "fermee";
  montantRecu: number;
  etat: EtatDepot;
  creeLe: string;
  expireLe: string;
  crediteLe: string | null;
  declarations: Declaration[];
  /** Ses XAFe sur la blockchain : chaque crédit frappé dans la réserve Glisil, sous la référence du dossier (0015, 0016). */
  chaine?: TraceChaine[];
};

/** Une frappe (ou une destruction) du contrat XAFe, rattachée à un mouvement de compte. */
export type TraceChaine = {
  reseau: Reseau;
  operation: "frapper" | "detruire";
  montant: number;
  /** la référence scellée dans la transaction (son empreinte keccak256 est sur la chaîne) */
  reference: string;
  /** a_faire : pas encore signée ; envoye : diffusée, attend son bloc ; confirme : dans un bloc assez confirmé ; echoue : refusée */
  etat: "a_faire" | "envoye" | "confirme" | "echoue";
  txHash: string | null;
  bloc: number | null;
  /** réseau d'essai : les jetons n'ont pas de valeur */
  essai: boolean;
  contrat: string | null;
  /** le wallet de la réserve Glisil sur ce réseau */
  reserve: string | null;
  /** https://testnet.bscscan.com, https://nile.tronscan.org/# … */
  explorateur: string | null;
  empreinte: string | null;
  /** le veilleur l'a relue sur la chaîne, indépendamment de ses propres notes */
  relue: boolean;
  confirmeLe: string | null;
};

export type EtatSortie = "en_attente" | "en_cours" | "envoyee" | "partielle" | "echouee" | "annulee";
export type Sortie = {
  reference: string;
  operateur: IdOperateur;
  numero: string;
  montant: number;
  frais: number;
  montantXaf: number;
  montantEnvoye: number;
  montantRendu: number;
  etat: EtatSortie;
  creeLe: string;
  termineeLe: string | null;
  transferts: { etat: "en_attente" | "en_cours" | "faite" | "echouee"; montant: number; envoi: number; referenceOperateur: string | null }[];
  /** « manuel » : l'équipe paie elle-même, puis donne le transaction ID */
  mode: "totem" | "manuel";
  nomBeneficiaire: string | null;
  /** l'équipe a pris la demande en charge */
  prisLe: string | null;
  /** l'ID du paiement fait par l'équipe, et quand */
  transactionId: string | null;
  payeeLe: string | null;
  /** le motif d'un refus */
  motif: string | null;
};

export type Cote = "achat" | "vente";
export type TypeOrdre = "limite" | "marche";
export type EtatOrdre = "ouvert" | "partiel" | "execute" | "annule";
export type Ordre = {
  id: string;
  numero: string;
  cote: Cote;
  type: TypeOrdre;
  prix: number | null;
  quantite: number;
  restant: number;
  executee: number;
  totalXafe: number;
  bloque: number;
  prixMoyen: number | null;
  etat: EtatOrdre;
  creeLe: string;
  majLe: string;
  /** passé par l'achat rapide : ce que le client a payé (ou reçu), marge comprise */
  rapide?: { total: number; frais: number } | null;
};

export type Execution = {
  id: string;
  prix: number;
  quantite: number;
  montantXafe: number;
  frais: number;
  fraisActif: Actif;
  /** le côté de MON ordre dans cette exécution */
  cote: Cote;
  preneur: boolean;
  quand: string;
};

export type ResultatOrdre = {
  ordre: Ordre;
  executions: Execution[];
  autoNegociation: boolean;
  deja?: boolean;
};

export type Niveau = { prix: number; quantite: number };
export type Carnet = { achats: Niveau[]; ventes: Niveau[] };

export type Transaction = { quand: string; prix: number; quantite: number; cote: Cote };

export type Cotation = {
  dernier: number | null;
  variation24h: number | null;
  haut24h: number | null;
  bas24h: number | null;
  volume24hUsdt: number;
  meilleurAchat: number | null;
  meilleureVente: number | null;
  /** le prix de référence du moteur : la bande de prix se calcule autour de lui (0017) */
  reference: number | null;
  releveLe: string;
};

export type Chandelle = { t: string; o: number; h: number; l: number; c: number; v: number };
/** Les intervalles du graphique : de la minute au mois (0025). */
export type Intervalle = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1j" | "1s" | "1M";
/** Une bougie datée : « marche » vient des échanges du carnet, « reference » du cours BCE d'avant le premier échange. */
export type Bougie = Chandelle & { source: "marche" | "reference" };
/** Une page de bougies, de la plus ancienne à la plus récente ; `plusAncien` : il en reste avant. */
export type PageDeBougies = { bougies: Bougie[]; plusAncien: boolean; debutMarche: string | null };

export type RetraitCrypto = {
  reference: string;
  actif: Actif;
  reseau: Reseau;
  adresse: string;
  montant: number;
  frais: number;
  etat: "en_attente" | "envoye" | "echoue" | "annule";
  txHash: string | null;
  creeLe: string;
};

export type TransfertCrypto = {
  id: string;
  actif: Actif;
  reseau: Reseau;
  sens: "entree" | "sortie";
  montant: number;
  txHash: string;
  adresse: string;
  quand: string;
};

/** Une ligne d'historique : l'union de tout ce qui a bougé sur le compte. */
export type Operation =
  | { nature: "depot"; reference: string; quand: string; etat: EtatDepot; montant: number; detail: Depot }
  | { nature: "sortie"; reference: string; quand: string; etat: EtatSortie; montant: number; detail: Sortie }
  | { nature: "ordre"; reference: string; quand: string; etat: EtatOrdre; montant: number; detail: Ordre }
  | { nature: "crypto"; reference: string; quand: string; etat: "confirme" | "en_attente" | "echoue"; montant: number; actif: Actif; detail: TransfertCrypto | RetraitCrypto }
  | { nature: "dotation"; reference: string; quand: string; etat: "confirme"; montant: number; detail: Dotation };

/** La bêta : de l'argent de test reçu (à l'inscription, ou donné par l'équipe). */
export type Dotation = { reference: string; xafe: number; usdt: number; motif: string; creeLe: string };

export type Notification = {
  id: string;
  quand: string;
  titre: string;
  texte: string;
  cible: string;
  lue: boolean;
};

/* ───────────────────── l'entrée : mot de passe, code e-mail, double authentification (0035) ───────────────────── */

/**
 * Où en est la personne qui ouvre l'application : ce que Supabase Auth dit de
 * sa session (le niveau atteint, le facteur par lequel elle est entrée) et ce
 * que la base dit du reste (mon_etat_d_entree, la seule lecture permise à aal1).
 */
export type EtatDEntree = {
  session: boolean;
  /** le premier facteur de la session : un code e-mail seul (« autre ») n'est jamais une entrée forte */
  premierFacteur: "password" | "oauth" | "autre" | null;
  aalActuel: "aal1" | "aal2" | null;
  /** aal2 : un facteur TOTP vérifié existe ; aal1 : il faut en enrôler un */
  aalSuivant: "aal1" | "aal2" | null;
  emailConfirme: boolean;
  motDePasse: boolean;
  /** les codes de secours sont générés ET notés */
  codesDeSecours: boolean;
  compte: boolean;
  facteurTotpId: string | null;
};

/** Un facteur TOTP en cours d'enrôlement : la clé ne se montre qu'à ce moment-là. */
export type EnrolementTotp = { facteurId: string; qr: string; secret: string; uri: string };

export type EtatCodesDeSecours = { confirmes: boolean; restants: number; creesLe: string | null };

/* ───────────────────── la vérification avant sortie (0036) ───────────────────── */

/** L'opération qu'un code e-mail confirme, et rien d'autre : un autre montant, une autre destination demandent un autre code. */
export type OperationAVerifier =
  | { operation: "sortie_momo"; montant: number; numeroId: string; nom?: string }
  | { operation: "retrait_crypto"; actif: Actif; reseau: Reseau; adresse: string; montant: number }
  | { operation: "fermer_compte" }
  | { operation: "retirer_numero"; numeroId: string };

/** Une vérification ouverte : le code est parti par e-mail ; il n'est jamais rendu à l'écran. */
export type Verification = { id: string; expireLe: string; renvoiDes: string; emailMasque: string };

export type EtatVerification = {
  courriel: "en_attente" | "en_cours" | "envoye" | "echoue" | "abandonne";
  essaisRestants: number;
};

/** Ce que l'écran apporte à l'opération : la vérification, le mot de passe, le code e-mail (le TOTP frais est dans la session). */
export type PreuveDeVerification = { verification: string; motDePasse: string; codeEmail: string };

/** L'achat (ou la vente) rapide : un prix ferme pris au carnet, marge comprise. */
export type SensRapide = "achat" | "vente";
export type DevisRapide = {
  /** null pour une estimation (rien n'est écrit) */
  id: string | null;
  sens: SensRapide;
  /** USDT reçus (achat) ou donnés (vente) */
  quantite: number;
  /** XAFe payés (achat) ou reçus (vente), marge comprise */
  total: number;
  prix: number;
  frais: number;
  marge: number;
  etat: "estimation" | "propose" | "execute";
  expireLe: string | null;
  ordre: string | null;
};

/* ───────────────────── la preuve de réserve (publique, 0016) ───────────────────── */
export type StatutParite = "juste" | "en_cours" | "ecart" | "incomplet";
/** Une opération du registre, rapprochée de sa transaction sur la chaîne. */
export type LignePreuve = {
  reference: string | null; nature: "reserve" | "retrait" | "retour" | "inconnue"; reseau: Reseau; genre: "frappe" | "destruction";
  montant: number | null; depuis: string; empreinte: string | null; tx_vu: string | null; bloc_vu: number | null; montant_vu: number | null;
  verdict: "concorde" | "en_route" | "en_retard" | "refusee" | "ecart" | "inconnue";
};
/** Ce que n'importe qui peut lire, sans compte : trois colonnes, et chaque transaction. */
export type PreuveDeReserve = {
  releve: {
    fait_le: string; statut: StatutParite; registre: number; dans_comptes: number; sur_wallets: number;
    chaine: number | null; offre_lue: number | null; en_route: number; ecart: number | null;
    floats: number | null; couverture: number | null; anomalies: number;
    reseaux: { reseau: Reseau; offre: number | null; reserve: number | null; bloc: number | null; a_jour: boolean; lu_le: string | null }[];
    /** null si l'équipe ne publie pas le détail des floats */
    floats_detail: { operateur: IdOperateur; solde: number | null; annonce_le: string | null; connu: boolean }[] | null;
  } | null;
  historique: { fait_le: string; statut: StatutParite; registre: number; chaine: number | null; ecart: number | null; floats: number | null }[];
  contrats: { reseau: Reseau; contrat: string | null; explorateur: string; reserve: string | null }[];
  essai: boolean;
  lignes: LignePreuve[];
  /** le nombre d'alarmes ouvertes (hors simples avis) */
  alertes: number;
};
