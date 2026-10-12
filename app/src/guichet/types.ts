/*
 * Les objets que les écrans manipulent. Ce sont les lignes du moteur, telles
 * que ses RPC les rendent (_depot_json, _sortie_json, _ordre_json…), nommées
 * en français comme dans la base.
 */

export type Actif = "XAFe" | "USDT";
export type IdOperateur = "mtn" | "om";
export type Reseau = "bep20" | "trc20";

export type Compte = {
  id: string;
  telephone: string;
  nom: string | null;
  entreprise: string | null;
  palier: 0 | 1 | 2;
  /** le code secret des gestes d'argent est posé */
  aCode: boolean;
  verrouJusqua: string | null;
  verificationEnCours: "identite" | "entreprise" | null;
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
};
export type Depot = {
  reference: string;
  operateur: IdOperateur;
  floatNumero: string;
  codeAgent: string | null;
  montantRecu: number;
  etat: EtatDepot;
  creeLe: string;
  expireLe: string;
  crediteLe: string | null;
  declarations: Declaration[];
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
  releveLe: string;
};

export type Chandelle = { t: string; o: number; h: number; l: number; c: number; v: number };

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
  | { nature: "crypto"; reference: string; quand: string; etat: "confirme" | "en_attente" | "echoue"; montant: number; actif: Actif; detail: TransfertCrypto | RetraitCrypto };

export type Notification = {
  id: string;
  quand: string;
  titre: string;
  texte: string;
  cible: string;
  lue: boolean;
};

export type ResultatCode = { ok: boolean; essaisRestants?: number; verrouJusqua?: string | null };
